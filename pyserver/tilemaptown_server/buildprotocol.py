# Tilemap Town
# Copyright (C) 2017-2023 NovaSquirrel
#
# This program is free software: you can redistribute it and/or
# modify it under the terms of the GNU General Public License as
# published by the Free Software Foundation; either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import json, datetime
from .buildglobal import *
from .buildcommand import handle_user_command, escape_tags
from .buildentity import Entity

handlers = {}
command_privilege_level = {} # minimum required privilege level required for the command; see user_privilege in buildglobal.py
map_only_commands = set()

# Adds a command handler
def protocol_command(privilege_level='guest', map_only=False):
	def decorator(f):
		command_name = f.__name__[3:]
		handlers[command_name] = f
		if map_only:
			map_only_commands.add(command_name)
		command_privilege_level[command_name] = privilege_level
	return decorator

# -------------------------------------

def tile_is_okay(tile):
	# convert to a dictionary to check first if necessary
	if type(tile) == str and len(tile) and tile[0] == '{':
		tile = json.loads(tile)

	# Strings refer to tiles in tilesets and are
	# definitely OK as long as they're not excessively long.
	if type(tile) == str:
		if len(tile) <= 32:
			return (True, None)
		else:
			return (False, 'Identifier too long')
	# If it's not a string it must be a dictionary
	if type(tile) != dict:
		return (False, 'Invalid type')

	if "pic" not in tile or len(tile["pic"]) != 3:
		return (False, 'No/invalid picture')

	return (True, None)

CLIENT_WHO_WHITELIST = {
	"typing": bool
}

def validate_client_who(id, data):
	validated_data = {"id": id}
	for key, value in data.items():
		if key in CLIENT_WHO_WHITELIST:
			validated_data[key] = CLIENT_WHO_WHITELIST[key](value)
	return validated_data

def must_be_map_owner(client, admin_okay, give_error=True):
	if client.map == None:
		return False
	if client.map.owner_id == self.db_id or self.oper_override or (admin_okay and self.has_permission(self, permission['admin'], False)):
		return True
	elif give_error:
		client.send("ERR", {'text': 'You don\'t have permission to do that'})
	return False

def must_be_server_admin(client, give_error=True):
	if not client.is_client():
		return False
	if client.username in Config["Server"]["Admins"]:
		return True
	elif give_error:
		client.send("ERR", {'text': 'You don\'t have permission to do that'})
	return False

# -------------------------------------

@protocol_command(map_only=True)
def fn_MOV(map, client, arg):
	data = {'id': client.protocol_id()}
	for valid_field in ('from', 'to', 'dir'):
		if valid_field in arg:
			data[valid_field] = arg[valid_field]
	map.broadcast("MOV", data, remote_category=botwatch_type['move'])

	new_dir = data['dir'] if 'dir' in data else None
	if 'to' in data:
		client.move_to(data['to'][0], data['to'][1], new_dir=new_dir)
	else:
		client.move_to(None, None, new_dir=new_dir)		

@protocol_command()
def fn_CMD(map, client, arg):
	handle_user_command(map, client, arg["text"])

@protocol_command()
def fn_BAG(map, client, arg):
	if client.db_id != None:
		c = Database.cursor()
		if "create" in arg:
			# restrict type variable
			if arg['create']['type'] not in ('text', 'image', 'map_tile', 'tileset', 'reference', 'folder', 'landmark'):
				client.send("ERR", {'text': 'Invalid type of item to create (%s)' % arg['create']['type']})
				return
			e = Entity(entity_type[arg['create']['type']], creator_id=client.db_id)
			e.name = arg['create']['name']
			e.map_id = client.db_id
			e.save()
			client.add_to_contents(e)

		elif "clone" in arg:
			if arg['clone'] not in AllEntitiesByDB:
				client.send("ERR", {'text': 'Can\'t clone %s - not already loaded' % arg['clone']})
				return
			clone_me = AllEntitiesByDB[arg['clone']]
			if clone_me.owner_id != client.db_id and not client.has_permission(clone_me, permission['copy'], False):
				client.send("ERR", {'text': 'You don\'t have permission to clone %s' % arg['clone']})
				return

			# Create a new entity and copy over the properties
			new_item = Entity(clone_me.entity_type)
			clone_me.copy_onto(new_item)
			new_item.owner_id = client.db_id

			# Put it in the player's inventory now
			new_item.map_id = client.db_id
			new_item.save()
			client.add_to_contents(new_item)

			# Update created_at and acquired_at
			if new_item.db_id:
				c.execute('SELECT created_at FROM Entity WHERE id=?', (arg['clone'],))
				result = c.fetchone()
				if result != None:
					c.execute('UPDATE Entity SET created_at=?, acquired_at=? WHERE id=?', (result[0], datetime.datetime.now(), new_item.db_id))

		elif "update" in arg:
			update = arg['update']
			if update['id'] not in AllEntitiesByDB:
				client.send("ERR", {'text': 'Can\'t update %s - not already loaded' % update['id']})
				return
			update_me = AllEntitiesByDB[update['id']]
			if update_me.owner_id != client.db_id and not client.has_permission(update_me, permission['modify_properties'], False):
				client.send("ERR", {'text': 'You don\'t have permission to update %s' % update['id']})
				return

			if 'data' in update:
				if update_me.entity_type == entity_type['image'] and not image_url_is_okay(update['data']):
					client.send("ERR", {'text': 'Image asset URL doesn\'t match any whitelisted sites'})
					return
				if update_me.entity_type == entity_type['map_tile']:
					tile_ok, tile_reason = tile_is_okay(update['data'])
					if not tile_ok:
						client.send("ERR", {'text': 'Tile [tt]%s[/tt] rejected (%s)' % (arg['update']['data'], tile_reason)})
						return
				update_me.data = update['data']
			if 'folder' in update:
				if client.has_permission(update['folder'], permission['persistent_object_entry'], False):
					update_me.switch_map(update['folder'])
			if 'name' in update:
				update_me.name = update['name']
			if 'desc' in update:
				update_me.desc = update['desc']
			if 'pic' in update:
				update_me.pic = update['pic']
			if 'tags' in update:
				update_me.tags = update['tags']
			update_me.save()

			# send back confirmation
			client.send("BAG", {'update': update})

		elif "delete" in arg:
			delete = arg['delete']
			if delete not in AllEntitiesByDB:
				client.send("ERR", {'text': 'Can\'t delete %s - not already loaded' % delete})
				return
			delete_entity = AllEntitiesByDB[delete]
			if delete_entity.owner_id != client.db_id:
				client.send("ERR", {'text': 'You don\'t have permission to delete %s' % delete})
				return

			# Move things that were in this object to the object's parent
			c.execute('UPDATE Entity SET location=? WHERE location=?', (delete_entity.map_id, delete))
			# Actually delete it now
			c.execute('DELETE FROM Entity WHERE owner_id=? AND id=?', (client.db_id, delete))
			if delete_entity.map:
				delete_entity.map.remove_from_contents(delete_entity)
			client.send("BAG", {'remove': arg['delete']})
	else:
		client.send("ERR", {'text': 'Guests don\'t have an inventory currently. Use [tt]/register username password[/tt]'})

@protocol_command()
def fn_EML(map, client, arg):
	if client.db_id != None:
		c = Database.cursor()
		if "send" in arg:
			# todo: definitely needs some limits in place to prevent abuse!

			# get a list of all the people to mail
			recipient_id = set(find_db_id_by_username(x) for x in arg['send']['to'])
			recipient_string = ','.join([str(x) for x in recipient_id])

			if any(x == None for x in recipient_id):
				client.send("ERR", {'text': 'Couldn\'t find one or more users you wanted to mail'})
				return

			# let the client know who sent it, since the 'send' argument will get passed along directly
			arg['send']['from'] = client.username

			# send everyone their mail
			for id in recipient_id:
				if id == None:
					continue
				c.execute("INSERT INTO Mail (owner_id, sender_id, recipients, subject, contents, created_at, flags) VALUES (?, ?, ?, ?, ?, ?, ?)", (id, client.db_id, recipient_string, arg['send']['subject'], arg['send']['contents'], datetime.datetime.now(), 0))

				# is that person online? tell them!
				find = find_client_by_db_id(id)
				if find:
					arg['send']['id'] = c.execute('SELECT last_insert_rowid()').fetchone()[0]
					find.send("EML", {'receive': arg['send']})

			client.send("EML", {'sent': {'subject': arg['send']['subject']}}) #acknowledge
			client.send("MSG", {'text': 'Sent mail to %d users' % len(recipient_id)})

		elif "read" in arg:
			c.execute('UPDATE Mail SET flags=1 WHERE owner_id=? AND id=?', (client.db_id, arg['read']))
		elif "delete" in arg:
			c.execute('DELETE FROM Mail WHERE owner_id=? AND id=?', (client.db_id, arg['delete']))

	else:
		client.send("ERR", {'text': 'Guests don\'t have mail. Use [tt]/register username password[/tt]'})

@protocol_command()
def fn_MSG(map, client, arg):
	if map:
		text = arg["text"]
		map.broadcast("MSG", {'name': client.name, 'username': client.username_or_id(), 'text': escape_tags(text)}, remote_category=botwatch_type['chat'])

@protocol_command()
def fn_TSD(map, client, arg):
	c = Database.cursor()
	c.execute('SELECT data FROM Asset_Info WHERE type=4 AND aid=?', (arg['id'],))
	result = c.fetchone()
	if result == None:
		client.send("ERR", {'text': 'Invalid item ID'})
	else:
		client.send("TSD", {'id': arg['id'], 'data': result[0]})

@protocol_command()
def fn_IMG(map, client, arg):
	c = Database.cursor()
	c.execute('SELECT data FROM Entity WHERE type=? AND id=?', (entity_type['image'], arg['id'],))
	result = c.fetchone()
	if result == None:
		client.send("ERR", {'text': 'Invalid item ID'})
	else:
		client.send("IMG", {'id': arg['id'], 'url': loads_if_not_none(result[0])})

@protocol_command(map_only=True)
def fn_MAI(map, client, arg):
	send_all_info = must_be_map_owner(client, True, give_error=False)
	client.send("MAI", map.map_info(all_info=send_all_info))

@protocol_command(map_only=True)
def fn_DEL(map, client, arg):
	x1 = arg["pos"][0]
	y1 = arg["pos"][1]
	x2 = arg["pos"][2]
	y2 = arg["pos"][3]
	if client.has_permission(map, permission['build'], True) or must_be_map_owner(client, True, give_error=False):
		map.save_on_clean_up = True

		for x in range(x1, x2+1):
			for y in range(y1, y2+1):
				if arg["turf"]:
					map.turfs[x][y] = None;
				if arg["obj"]:
					map.objs[x][y] = None;
		map.broadcast("MAP", map.map_section(x1, y1, x2, y2))

		# make username available to listeners
		arg['username'] = client.username_or_id()
		map.broadcast("DEL", arg, remote_only=True, remote_category=botwatch_type['build'])
	else:
		client.send("MAP", map.map_section(x1, y1, x2, y2))
		client.send("ERR", {'text': 'Building is disabled on this map'})

@protocol_command(map_only=True)
def fn_PUT(map, client, arg):
	def notify_listeners():
		# make username available to listeners
		arg['username'] = client.username_or_id()
		map.broadcast("PUT", arg, remote_only=True, remote_category=botwatch_type['build'])

	x = arg["pos"][0]
	y = arg["pos"][1]
	if client.has_permission(map, permission['build'], True) or must_be_map_owner(client, True, give_error=False):
		map.save_on_clean_up = True

		# verify the the tiles you're attempting to put down are actually good
		if arg["obj"]: #object
			tile_test = [tile_is_okay(x) for x in arg["atom"]]
			if all(x[0] for x in tile_test): # all tiles pass the test
				map.objs[x][y] = arg["atom"]
				map.broadcast("MAP", map.map_section(x, y, x, y))
				notify_listeners()
			else:
				# todo: give a reason?
				client.send("MAP", map.map_section(x, y, x, y))
				client.send("ERR", {'text': 'Placed objects rejected'})
		else: #turf
			tile_test = tile_is_okay(arg["atom"])
			if tile_test[0]:
				map.turfs[x][y] = arg["atom"]
				map.broadcast("MAP", map.map_section(x, y, x, y))
				notify_listeners()
			else:
				client.send("MAP", map.map_section(x, y, x, y))
				client.send("ERR", {'text': 'Tile [tt]%s[/tt] rejected (%s)' % (arg["atom"], tile_test[1])})
	else:
		client.send("MAP", map.map_section(x, y, x, y))
		client.send("ERR", {'text': 'Building is disabled on this map'})

@protocol_command(map_only=True)
def fn_BLK(map, client, arg):
	if client.has_permission(map, permission['bulk_build'], False) or must_be_map_owner(client, True, give_error=False):
		map.save_on_clean_up = True

		# verify the tiles
		for turf in arg["turf"]:
			if not tile_is_okay(turf[2])[0]:
				client.send("ERR", {'text': 'Bad turf in bulk build'})
				return
		for obj in arg["obj"]:
			tile_test = [tile_is_okay(x) for x in obj[2]]
			if any(not x[0] for x in tile_test): # any tiles don't pass the test
				client.send("ERR", {'text': 'Bad obj in bulk build'})
				return
		# make username available to other clients
		arg['username'] = client.username_or_id()

		# place the tiles
		for turf in arg["turf"]:
			x = turf[0]
			y = turf[1]
			a = turf[2]
			width = 1
			height = 1
			if len(turf) == 5:
				width = turf[3]
				height = turf[4]
			for w in range(0, width):
				for h in range(0, height):
					map.turfs[x+w][y+h] = a
		# place the object lists
		for obj in arg["obj"]:
			x = obj[0]
			y = obj[1]
			a = obj[2]
			width = 1
			height = 1
			if len(turf) == 5:
				width = turf[3]
				height = turf[4]
			for w in range(0, width):
				for h in range(0, height):
					map.objs[x+w][y+h] = a
		map.broadcast("BLK", arg, remote_category=botwatch_type['build'])
	else:
		client.send("ERR", {'text': 'Bulk building is disabled on this map'})

@protocol_command()
def fn_WHO(map, client, arg):
	if arg["update"]:
		valid_data = validate_client_who(client.protocol_id(), arg["update"])
		for key,value in valid_data.items():
			if key != 'id':
				setattr(client,key,value)
		map.broadcast("WHO", {"update": valid_data})
	else:
		client.send("ERR", {'text': 'not implemented'})

# -------------------------------------

def handle_protocol_command(map, client, command, arg):
	# Attempt to run the command handler if it exists
	if command in handlers:
		if command in map_only_commands and (client.map == None or not client.map.is_map()):
			client.send("ERR", {'text': 'Protocol command must be done on a map: %s' % command})
		else:
			return handlers[command](map, client, arg)
	else:
		client.send("ERR", {'text': 'Bad protocol command: %s' % command})
