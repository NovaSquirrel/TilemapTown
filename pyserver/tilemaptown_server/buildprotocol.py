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

import json, datetime, time, types
from .buildglobal import *
from .buildcommand import handle_user_command, escape_tags, tile_is_okay, data_disallowed_for_entity_type
from .buildentity import Entity

handlers = {}
command_privilege_level = {} # minimum required privilege level required for the command; see user_privilege in buildglobal.py
map_only_commands = set()
pre_identify_commands = set()
ext_handlers = {}

directions = ((1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1))

# Adds a command handler
def protocol_command(privilege_level='guest', map_only=False, pre_identify=False):
	def decorator(f):
		command_name = f.__name__[3:]
		handlers[command_name] = f
		if map_only:
			map_only_commands.add(command_name)
		if pre_identify:
			pre_identify_commands.add(command_name)
		command_privilege_level[command_name] = privilege_level
	return decorator

def ext_protocol_command(name):
	def decorator(f):
		if isinstance(name, str):
			ext_handlers[name] = f
		elif isinstance(name, tuple):
			for n in name:
				ext_handlers[n] = f
	return decorator

# -------------------------------------

def protocol_error(client, echo, text=None, code=None, detail=None, subject_id=None):
	out = {}
	if text != None:
		out['text'] = text
	if code != None:
		out['code'] = code
	if detail != None:
		out['detail'] = detail
	if subject_id != None:
		if isinstance(subject_id, Entity):
			out['subject_id'] = subject_id.protocol_id()
		else:
			out['subject_id'] = subject_id
	if echo != None:
		out['echo'] = echo
	client.send("ERR", out)

def find_remote_control_entity(client, rc, echo):
	if client.has_permission(rc, permission['remote_command'], False):
		actor = get_entity_by_id(rc, load_from_db=False)
		if actor == None:
			protocol_error(client, echo, text='Entity %s not loaded' % rc, code='not_loaded', subject_id=rc)
			return None
		else:
			return actor
	else:
		protocol_error(client, echo, text='Entity %s not loaded' % rc, code='missing_permission', detail='remote_command', subject_id=rc)
	return None

def remove_invalid_dict_fields(data, whitelist):
	out = {}
	for k,v in data.items():
		if k in whitelist:
			whitelist_entry = whitelist[k]
			if isinstance(whitelist_entry, types.FunctionType):
				if whitelist_entry(v):
					out[k] = data[k]
			elif isinstance(v, whitelist_entry):
				out[k] = data[k]
	return out
def is_list_with_two_ints(data):
	return isinstance(data, list) and len(data) == 2 and isinstance(data[0], int) and isinstance(data[1], int)
def who_mini_tilemap(data):
	if isinstance(data, dict):
		filtered = remove_invalid_dict_fields(data, {
			"visible":          bool,
			"clickable":        bool,
			"map_size":         lambda x: is_list_with_two_ints(x) and x[0] >= 1   and x[0] <= 16 and x[1] >= 1 and x[1] <= 16,
			"tile_size":        lambda x: is_list_with_two_ints(x) and x[0] >= 1   and x[0] <= 64 and x[1] >= 1 and x[1] <= 64,
			"offset":           lambda x: is_list_with_two_ints(x) and x[0] >= -16 and x[0] <= 16 and x[1] >= -16 and x[1] <= 16,
			"tileset_url":      image_url_is_okay,
			"transparent_tile": int,
		})
		if "map_size" not in filtered or "tile_size" not in filtered or "tileset_url" not in filtered:
			return None
		if (filtered["map_size"][0] * filtered["tile_size"][0] > 64) or (filtered["map_size"][1] * filtered["tile_size"][1] > 64):
			return None
		# Fill in default values
		if "visible" not in filtered:
			filtered["visible"] = True
		if "clickable" not in filtered:
			filtered["clickable"] = False
		if "transparent_tile" not in filtered:
			filtered["transparent_tile"] = 0
		return filtered
	return None
def who_mini_tilemap_data(data):
	if isinstance(data, dict):
		if ("data" not in data) or (len(data["data"]) > 256):
			return None
		return {"data": data["data"]}
	return None

CLIENT_WHO_WHITELIST = {
	"typing": bool,
	"clickable": bool,
	"mini_tilemap": who_mini_tilemap,
	"mini_tilemap_data": who_mini_tilemap_data,
}

def validate_client_who(id, data):
	validated_data = {"id": id}
	for key, value in data.items():
		if key in CLIENT_WHO_WHITELIST:
			validated_data[key] = CLIENT_WHO_WHITELIST[key](value)
	return validated_data

def must_be_map_owner(client, echo, admin_okay, give_error=True):
	if client.map == None:
		return False
	if (client.db_id != None and client.map.owner_id == client.db_id) or client.oper_override or (admin_okay and client.has_permission(client.map, permission['admin'], False)):
		return True
	elif give_error:
		protocol_error(client, echo, text='You don\'t have permission to do that', code='missing_permission', detail='admin' if admin_okay else None, subject_id=client.map)
	return False

# Not used?
"""
def must_be_server_admin(client, echo, give_error=True):
	if not client.is_client():
		return False
	if client.username in Config["Server"]["Admins"]:
		return True
	elif give_error:
		client.send("ERR", {'text': 'You don\'t have permission to do that', 'code': 'server_admin_only'})
	return False
"""

def set_entity_params_from_dict(e, d, client, echo):
	if e.creator_temp_id != client.id and e.owner_id != client.db_id and \
	not client.has_permission(e, permission['modify_properties'], False):
		# If you don't have permission for modify_properties you may still be able to do the update if you're only changing specific properties
		appearance_change_props = {'id', 'name', 'desc', 'pic', 'tags'}

		if any(key not in appearance_change_props for key in d) or not client.has_permission(e, permission['modify_appearance'], False):
			protocol_error(client, echo, text='You don\'t have permission to update %s' % d['id'], code='missing_permission', detail='modify_properties', subject_id=e)
			return
	if 'data' in d:
		bad = data_disallowed_for_entity_type(e.entity_type, d['data'])
		if bad != None:
			protocol_error(client, echo, text=bad, code='bad_value', detail='data', subject_id=e)
			del d['data']
		else:
			old_data = e.data
			e.data = d['data']
			if e.db_id != None and entity_type_name[e.entity_type] in ('image', 'tileset') and old_data != e.data:
				is_tileset = entity_type_name[e.entity_type] == 'tileset'
				for u in AllClients:
					if e.db_id in u.images_and_tilesets_received_so_far:
						if is_tileset:
							u.send("TSD", {'id': e.db_id, 'data': e.data, 'update': True})
						else:
							u.send("IMG", {'id': e.db_id, 'url': e.data, 'update': True})

	if 'owner_id' in d:
		if e.owner_id != client.db_id:
			protocol_error(client, echo, text='Can only reassign ownership on entities you own', code='owner_only', subject_id=e)
			del d['owner_id']
		elif client.has_permission(d['owner_id'], permission['set_owner_to_this'], False):
			e.owner_id = d['owner_id']
		else:
			protocol_error(client, echo, text='Don\'t have permission to set owner to ' % d['owner_id'], code='missing_permission', detail='set_owner_to_this', subject_id=e)
			del d['owner_id']
	if 'owner_username' in d:
		if e.owner_id != client.db_id:
			protocol_error(client, echo, text='Can only reassign ownership on entities you own', code='owner_only', subject_id=e)
			del d['owner_username']
		new_owner = find_db_id_by_username(d['owner_username'])
		if new_owner:
			if client.has_permission(new_owner, permission['set_owner_to_this'], False):
				e.owner_id = new_owner
			else:
				protocol_error(client, echo, text='Don\'t have permission to set owner to ' % d['owner_username'], code='missing_permission', detail='set_owner_to_this', subject_id=e)
				del d['owner_username']
		else:
			protocol_error(client, echo, text='Username \"%s\" not found' % d['owner_username'], code='not_found', subject_id=e)
			del d['owner_username']

	if 'folder' in d:
		if client.has_permission(d['folder'], (permission['entry']), False) \
		and client.has_permission(d['folder'], (permission['object_entry'], permission['persistent_object_entry']), False):
			if not e.switch_map(d['folder'], new_pos=d['pos'] if 'pos' in d else None, on_behalf_of=client):
				protocol_error(client, echo, text='Entity doesn\'t have permission to move there', code='missing_permission', subject_id=e)
				del d['folder']
		else:
			protocol_error(client, echo, text='Don\'t have permission to move entity there', code='missing_permission', subject_id=e)
			del d['folder']

	if 'home' in d:
		if d['home'] == True and client.has_permission(e.map_id, permission['persistent_object_entry'], False):
			e.home_id = e.map_id
			e.home_position = [e.x, e.y]
		elif d['home'] == None:
			e.home_id = None
			e.home_position = None
		elif client.has_permission(d['home'], permission['persistent_object_entry'], False):
			e.home_id = d['home']
			e.home_position = None
		else:
			protocol_error(client, echo, text='Don\'t have permission to set entity\'s home there', code='missing_permission', detail='persistent_object_entry', subject_id=e_id)
			del d['home']

	if 'home_position' in d and len(d['home_position']) == 2:
		e.home_position = d['home_position']
	if 'name' in d:
		e.name = d['name']
	if 'desc' in d:
		e.desc = d['desc']
	if 'pic' in d:
		if pic_is_okay(d['pic']):
			e.pic = d['pic']
		else:
			protocol_error(client, echo, text='Invalid picture: %s' % d['pic'], code='bad_value', detail='pic', subject_id=e_id)
			del d['pic']
	if 'tags' in d:
		e.tags = d['tags']
	if 'allow' in d:
		e.allow = bitfield_from_permission_list(d['allow'])
	if 'deny' in d:
		e.deny = bitfield_from_permission_list(d['deny'])
	if 'guest_deny' in d:
		e.guest_deny = bitfield_from_permission_list(d['guest_deny'])
	if 'temporary' in d and client.db_id:
		e.temporary = d['temporary']
	if 'temp' in d and client.db_id: # Allow short version too
		e.temporary = d['temp']
	if 'delete_on_logout' in d and client.has_permission(e):
		if d['delete_on_logout']:
			client.cleanup_entities_on_logout.add(e)
		else:
			client.cleanup_entities_on_logout.discard(e)

# -------------------------------------

@protocol_command()
def fn_MOV(map, client, arg, echo):
	# Can control a different entity if you have permission
	if 'rc' in arg:
		id = arg['rc']
		if ("new_map" in arg and not client.has_permission(id, (permission['move_new_map']), False)) \
			or ("new_map" not in arg and not client.has_permission(id, (permission['move'], permission['move_new_map']), False)):
			protocol_error(client, echo, text='You don\'t have permission to move entity %s' % id, code='missing_permission', detail='move_new_map', subject_id=id)
			return
		entity = get_entity_by_id(id, load_from_db=False)
		if entity is not client: # Make sure it's not actually just the client supplying their own ID
			if entity == None:
				protocol_error(client, echo, text='Can\'t move entity %s because it\'s not loaded' % id, code='not_loaded', subject_id=id)
				return
			if entity.map == None and "new_map" not in arg:
				protocol_error(client, echo, text='Can\'t move entity %s because it\'s not on a map' % id)
				return

			del arg['rc']
			handlers['MOV'](entity.map, entity, arg, echo)
			return

	if "if_map" in arg and map.db_id != arg["if_map"]:
		return

	# MOV can be used to switch maps
	if "new_map" in arg:
		client.switch_map(arg["new_map"], new_pos=arg["to"])
		return

	# Handle bumping into the map edge (for clients that don't implement see_past_map_edge)
	if "bump" in arg and map.is_map() and map.edge_ref_links != None:
		bump_pos    = arg["bump"]

		# Check if the bumped position is past one of the edges
		edge_sign_x = -1 if bump_pos[0] < 0 else (1 if bump_pos[0] >= map.width else 0)
		edge_sign_y = -1 if bump_pos[1] < 0 else (1 if bump_pos[1] >= map.height else 0)
		if edge_sign_x != 0 or edge_sign_y != 0:
			# Find what map link index to use
			edge_index = directions.index((edge_sign_x, edge_sign_y))
			new_map = map.edge_ref_links[edge_index]
			if new_map != None:
				new_x, new_y = bump_pos
				if edge_sign_x == 1:
					new_x = 0
				elif edge_sign_x == -1:
					new_x = new_map.width-1
				if edge_sign_y == 1:
					new_y = 0
				elif edge_sign_y == -1:
					new_y = new_map.height-1
				# Allow changing direction while changing maps
				if "dir" in arg:
					client.dir = arg["dir"]

				# If the client can move to the new map, then it'll remove them from this one,
				# and this function shouldn't continue.
				if client.switch_map(new_map, new_pos=(new_x, new_y), edge_warp=True):
					return

	# Broadcast that this entity moved
	data = {'id': client.protocol_id()}
	any_valid_fields = False
	for valid_field in ('from', 'to', 'dir', 'offset'):
		if valid_field in arg:
			any_valid_fields = True
			data[valid_field] = arg[valid_field]
	if not any_valid_fields:
		return
	map.broadcast("MOV", data, remote_category=botwatch_type['move'])

	if 'offset' in data:
		offset = data['offset']
		if offset == None:
			client.offset = None
		else:
			offset_x, offset_y = min(16, max(-16, offset[0])), min(16, max(-16, offset[1]))
			client.offset = [offset_x, offset_y]

	# Update this entity's position
	new_dir = data['dir'] if 'dir' in data else None
	if 'to' in data:
		client.move_to(data['to'][0], data['to'][1], new_dir=new_dir)
	else:
		client.move_to(None, None, new_dir=new_dir)		

@protocol_command()
def fn_CMD(map, client, arg, echo):
	actor = client
	echo = arg['echo'] if ('echo' in arg) else None

	if 'rc' in arg:
		actor = find_remote_control_entity(client, arg['rc'], echo)
		if actor == None:
			return
		else:
			map = actor.map

	handle_user_command(map, actor, client, echo, arg["text"])

@protocol_command()
def fn_BAG(map, client, arg, echo):
	def allow_special_ids(text):
		if text == 'here':
			return map.db_id
		if text == 'me':
			return client.db_id
		return text

	c = Database.cursor()
	if "create" in arg:
		create = arg['create']
		# restrict type variable
		if create['type'] not in creatable_entity_types:
			protocol_error(client, echo, text='Invalid type of item to create (%s)' % create['type'])
			return
		e = Entity(entity_type[arg['create']['type']], creator_id=client.db_id)
		e.name = "New item" # Default that will probably be overridden
		e.map_id = client.db_id
		e.creator_temp_id = client.id

		set_entity_params_from_dict(e, create, client, echo)

		if client.db_id == None:
			e.temporary = True
			# By default, let guests do whatever with it
			e.allow = permission['all']
			e.deny = 0
			e.guest_deny = 0

		if not e.temporary:
			e.save()
		client.add_to_contents(e)

		create["id"] = e.protocol_id()
		client.send("BAG", {'create': create}) # Acknowledge

	elif "clone" in arg:
		clone_me = get_entity_by_id(allow_special_ids(arg['clone']['id']))
		if clone_me == None:
			protocol_error(client, echo, text='Can\'t clone %s' % arg['clone']['id'], code='not_found', subject_id=arg['clone']['id'])
			return

		clone_type = clone_me.entity_type
		if clone_type == entity_type['user']:
			clone_type = entity_type['generic']
		else:
			clone_type_name = entity_type_name[clone_type]
			if clone_type_name not in creatable_entity_types:
				protocol_error(client, echo, text='Invalid type of item to clone (%s)' % clone_type_name)
				return

		if clone_me.creator_temp_id != client.id and (clone_me.owner_id != client.db_id or client.db_id == None) and \
		not client.has_permission(clone_me, permission['copy'], False):
			protocol_error(client, echo, text='You don\'t have permission to clone %s' % arg['clone']['id'], code='missing_permission', detail='copy', subject_id=arg['clone']['id'])
			return

		# Create a new entity and copy over the properties
		new_item = Entity(clone_me.entity_type)
		clone_me.copy_onto(new_item)
		new_item.owner_id = client.db_id
		new_item.creator_temp_id = client.id

		set_entity_params_from_dict(new_item, arg['clone'], client, echo)
		if client.db_id == None:
			new_item.temporary = True
			new_item.allow = permission['all']
			new_item.deny = 0
			new_item.guest_deny = 0

		if not new_item.temporary:
			new_item.save()
		# Put it in the player's inventory now, or wherever else they put it
		if 'folder' not in arg['clone']:
			client.add_to_contents(new_item)

		# Update created_at and acquired_at
		if new_item.db_id:
			c.execute('SELECT created_at FROM Entity WHERE id=?', (clone_me.db_id,))
			result = c.fetchone()
			if result != None:
				c.execute('UPDATE Entity SET created_at=?, acquired_at=? WHERE id=?', (result[0], datetime.datetime.now(), new_item.db_id))

		arg["clone"]["new_id"] = new_item.protocol_id()
		client.send("BAG", {'clone': arg['clone']}) # Acknowledge

	elif "update" in arg:
		update = arg['update']
		update_me = get_entity_by_id(allow_special_ids(update['id']))
		if update_me == None:
			protocol_error(client, echo, text='Can\'t update %s' % update['id'], code='not_found', subject_id=update['id'])
			return

		set_entity_params_from_dict(update_me, update, client, echo)

		if not update_me.is_client() and not update_me.temporary:
			update_me.save()
		update_me.broadcast_who()

		# send back confirmation
		client.send("BAG", {'update': update})

	elif "move" in arg:
		move = arg['move']
		move_me = get_entity_by_id(move['id'])
		if 'folder' not in move and client.has_permission(move['move']):
			move_me.move_to(x, y)
		elif 'folder' in move and client.has_permission(move['folder'], (permission['object_entry'], permission['persistent_object_entry']), False):
			if 'pos' in move:
				if client.has_permission(move_me, permission['move_new_map'], False):
					move_me.switch_map(move['folder'], new_pos=move['pos'])
					if not move_me.temporary:
						move_me.save()
					client.send('BAG', {'move': move})
				else:
					protocol_error(client, echo, text='Don\'t have permission to move entity', code='missing_permission', detail='move_new_map', subject_id=move['id'])
			else:
				if client.has_permission(move_me, (permission['move'], permission['move_new_map']), False):
					move_me.switch_map(move['folder'])
					if not move_me.temporary:
						move_me.save()
					client.send('BAG', {'move': move})
				else:
					protocol_error(client, echo, text='Don\'t have permission to move entity', code='missing_permission', detail='move', subject_id=move['id'])
		else:
			protocol_error(client, echo, text='Don\'t have permission to move entity there', code='missing_permission', detail='object_entry', subject_id=move['folder'])

	elif "kick" in arg:
		kick = arg['kick']
		kick_me = get_entity_by_id(kick['id'])
		if (kick_me.map_id == client.db_id and client.db_id != None) or (kick_me.map is client) or (kick_me.map and kick_me.map.owner_id == client.db_id and client.db_id != None) or client.has_permission(kick_me.map_id, (permission['admin'], permission['sandbox']), False):
			kick_me.send_home()
			client.send("BAG", {'kick': kick})

	elif "delete" in arg:
		delete = arg['delete']

		delete_me = get_entity_by_id(delete['id'])
		if delete_me == None or delete_me.is_client():
			protocol_error(client, echo, text='Can\'t delete %s' % delete['id'], code='not_found', subject_id=delete['id'])
			return
		elif client.oper_override:
			pass
		elif delete_me.owner_id == None and delete_me.creator_temp_id and delete_me.creator_temp_id not in AllEntitiesByID:
			pass
		elif delete_me.creator_temp_id == client.id:
			pass
		elif delete_me.owner_id == None or delete_me.owner_id != client.db_id:
			protocol_error(client, echo, text='You don\'t have permission to delete %s' % delete['id'], code='owner_id', subject_id=delete['id'])
			return

		# Move everything inside to the parent
		for child in delete_me.contents.copy():
			delete_me.remove_from_contents(child)
			delete_me.map.add_to_contents(child)

		# Delete from the database too
		if delete_me.db_id:
			c.execute('DELETE FROM Entity WHERE owner_id=? AND id=?', (client.db_id, delete['id']))
		if delete_me.map and delete_me.map != client:
			client.send("BAG", {'remove': {'id': delete['id']}})
		if delete_me.map:
			delete_me.map.remove_from_contents(delete_me)
		client.send("BAG", {'delete': delete})

	elif "info" in arg:
		info = arg['info']
		info_me = get_entity_by_id(info['id'])
		if info_me == None:
			protocol_error(client, echo, text='Can\'t get info for %s' % info['id'], code='not_found', subject_id=info['id'])
			return

		bag_info = info_me.bag_info()
		if info_me.is_client(): # No spying
			del bag_info['folder']
		client.send("BAG", {'info': bag_info})

	elif "list_contents" in arg:
		list_contents = arg['list_contents']
		list_me = get_entity_by_id(list_contents['id'])
		if list_me == None:
			protocol_error(client, echo, text='Can\'t list contents for %s' % list_contents['id'], subject_id=info['id'])
			return
		if list_me.owner_id != client.db_id and not client.has_permission(list_me, permission['list_contents'], False):
			protocol_error(client, echo, text='Don\'t have permission to list contents for %s' % list_contents['id'], code='missing_permission', detail='list_contents', subject_id=list_contents['id'])
			return

		if list_contents.get('recursive', False):
			list_contents['contents'] = [child.bag_info() for child in list_me.all_children()]
		else:
			list_contents['contents'] = [child.bag_info() for child in list_me.contents]
		client.send("BAG", {'list_contents': list_contents})

@protocol_command()
def fn_EML(map, client, arg, echo):
	if client.db_id != None:
		c = Database.cursor()
		if "send" in arg:
			# todo: definitely needs some limits in place to prevent abuse!

			# get a list of all the people to mail
			recipient_id = set(find_db_id_by_username(x) for x in arg['send']['to'])
			recipient_string = ','.join([str(x) for x in recipient_id])

			if any(x == None for x in recipient_id):
				protocol_error(client, echo, text='Couldn\'t find one or more users you wanted to mail', code='not_found')
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
		protocol_error(client, echo, text='Guests don\'t have mail. Use [tt]/register username password[/tt]', code='no_guests')

@protocol_command()
def fn_MSG(map, client, arg, echo):
	actor = client

	if 'rc' in arg:
		actor = find_remote_control_entity(client, arg['rc'], echo)
		if actor == None:
			return
		else:
			map = actor.map

	if map:
		text = arg["text"]
		fields = {'name': actor.name, 'id': actor.protocol_id(), 'username': actor.username_or_id(), 'text': escape_tags(text)}
		if 'rc' in arg:
			fields['rc_id'] = client.protocol_id()
			fields['rc_username'] = client.username_or_id()
		map.broadcast("MSG", fields, remote_category=botwatch_type['chat'])

@protocol_command()
def fn_TSD(map, client, arg, echo):
	if isinstance(arg['id'], list):
		tilesets = set(arg['id'])
	else:
		tilesets = (arg['id'],)

	client.start_batch()
	for t in tilesets:
		if isinstance(t, str) and string_is_int(t):
			t = int(t)
		c = Database.cursor()
		c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type('tileset'), t,))
		result = c.fetchone()
		if result == None:
			protocol_error(client, echo, text='Invalid item ID', code='not_found', subject_id=t)
		else:
			client.send("TSD", {'id': t, 'data': decompress_entity_data(result[0], result[1])})
			client.images_and_tilesets_received_so_far.add(t)
	client.finish_batch()

@protocol_command()
def fn_IMG(map, client, arg, echo):
	if isinstance(arg['id'], list):
		images = set(arg['id'])
	else:
		images = (arg['id'],)

	client.start_batch()
	for i in images:
		if isinstance(i, str) and string_is_int(i):
			i = int(i)
		c = Database.cursor()
		c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type['image'], i,))
		result = c.fetchone()
		if result == None:
			protocol_error(client, echo, text='Invalid item ID', code='not_found', subject_id=i)
		else:
			client.send("IMG", {'id': i, 'url': loads_if_not_none(decompress_entity_data(result[0], result[1]))})
			client.images_and_tilesets_received_so_far.add(i)
	client.finish_batch()

@protocol_command(map_only=True)
def fn_MAI(map, client, arg, echo):
	send_all_info = must_be_map_owner(client, echo, True, give_error=False)
	client.send("MAI", map.map_info(all_info=send_all_info))

@protocol_command(map_only=True)
def fn_DEL(map, client, arg, echo):
	x1 = arg["pos"][0]
	y1 = arg["pos"][1]
	x2 = arg["pos"][2]
	y2 = arg["pos"][3]
	if client.has_permission(map, permission['build'], True) or must_be_map_owner(client, echo, True, give_error=False):
		if not map.map_data_loaded:
			protocol_error(client, echo, text='Map isn\'t loaded, so it can\'t be modified', code='not_loaded', subject_id=map)
			return
		map.map_data_modified = True
		client.delete_count += 1

		# Save undo information
		old_data = None
		if client.is_client() and client.map == map:
			client.undo_delete_data = map.map_section(x1, y1, x2, y2)
			client.undo_delete_when = time.time()
			old_data = client.undo_delete_data
		write_to_build_log(map, client, "DEL", arg, old_data)

		# Do the delete and tell clients about it
		for x in range(x1, x2+1):
			for y in range(y1, y2+1):
				if arg["turf"]:
					map.turfs[x][y] = None;
				if arg["obj"]:
					map.objs[x][y] = None;
		# make username available to listeners
		arg['username'] = client.username_or_id()
		arg['id'] = client.protocol_id()
		map.broadcast("DEL", arg, remote_only=True, remote_category=botwatch_type['build'])
		map.broadcast("DEL", arg, require_extension="receive_build_messages")

		# send map update to everyone on the map
		map.broadcast("MAP", map.map_section(x1, y1, x2, y2), send_to_links=True)
	else:
		client.send("MAP", map.map_section(x1, y1, x2, y2))
		protocol_error(client, echo, text='Building is disabled on this map', code='missing_permission', detail='build', subject_id=map)

@protocol_command(map_only=True)
def fn_PUT(map, client, arg, echo):
	def notify_listeners():
		# make username available to listeners
		arg['username'] = client.username_or_id()
		arg['id'] = client.protocol_id()
		map.broadcast("PUT", arg, remote_only=True, remote_category=botwatch_type['build'])
		map.broadcast("PUT", arg, require_extension="receive_build_messages")

	temporary = arg.get('temp', False)
	x = arg["pos"][0]
	y = arg["pos"][1]
	if client.has_permission(map, permission['build'], True) or must_be_map_owner(client, echo, True, give_error=False):
		if not map.map_data_loaded:
			protocol_error(client, echo, text='Map isn\'t loaded, so it can\'t be modified', code='not_loaded', subject_id=map)
			return
		if not temporary:
			map.map_data_modified = True
		client.build_count += 1

		# verify the the tiles you're attempting to put down are actually good
		if arg.get("obj", False): #object
			tile_test = [tile_is_okay(x) for x in arg["atom"]]
			if all(x[0] for x in tile_test): # all tiles pass the test
				write_to_build_log(map, client, "PUT", arg, map.objs[x][y])
				map.objs[x][y] = arg["atom"]
				notify_listeners()
				map.broadcast("MAP", map.map_section(x, y, x, y), send_to_links=True)
			else:
				# todo: give a reason?
				client.send("MAP", map.map_section(x, y, x, y))
				protocol_error(client, echo, text='Placed objects rejected')
		else: #turf
			tile_test = tile_is_okay(arg["atom"])
			if tile_test[0]:
				write_to_build_log(map, client, "PUT", arg, map.turfs[x][y])
				map.turfs[x][y] = arg["atom"] if arg["atom"] != map.default_turf else None
				notify_listeners()
				map.broadcast("MAP", map.map_section(x, y, x, y), send_to_links=True)
			else:
				client.send("MAP", map.map_section(x, y, x, y))
				protocol_error(client, echo, text='Tile [tt]%s[/tt] rejected (%s)' % (arg["atom"], tile_test[1]))
	else:
		client.send("MAP", map.map_section(x, y, x, y))
		protocol_error(client, echo, text='Building is disabled on this map', code='missing_permission', detail='build', subject_id=map)

@protocol_command(map_only=True)
def fn_BLK(map, client, arg, echo):
	if client.has_permission(map, permission['bulk_build'], False) or must_be_map_owner(client, echo, True, give_error=False):
		if not map.map_data_loaded:
			protocol_error(client, echo, text='Map isn\'t loaded, so it can\'t be modified', code='not_loaded', subject_id=map)
			return
		temporary = arg.get('temp', False)
		if not temporary:
			map.map_data_modified = True

		# verify the tiles
		for turf in arg.get("turf", []):
			if not tile_is_okay(turf[2])[0]:
				protocol_error(client, echo, text='Bad turf in bulk build', subject_id=map)
				return
		for obj in arg.get("obj", []):
			tile_test = [tile_is_okay(x) for x in obj[2]]
			if any(not x[0] for x in tile_test): # any tiles don't pass the test
				protocol_error(client, echo, text='Bad obj in bulk build', subject_id=map)
				return
		# make username available to other clients
		arg['username'] = client.username_or_id()
		arg['id'] = client.protocol_id()

		# do copies
		for copy in arg.get("copy", []):
			do_turf = ("turf" not in copy) or copy["turf"]
			do_obj = ("obj" not in copy) or copy["obj"]
			x1, y1, width, height = copy["src"]
			x2, y2                = copy["dst"]

			# turf
			if do_turf:
				copied = []
				for w in range(width):
					row = []
					for h in range(height):
						row.append(map.turfs[x1+w][y1+h])
					copied.append(row)

				for w in range(width):
					for h in range(height):
						map.turfs[x2+w][y2+h] = copied[w][h]
			# obj
			if do_obj:
				copied = []
				for w in range(width):
					row = []
					for h in range(height):
						row.append(map.objs[x1+w][y1+h])
					copied.append(row)

				for w in range(width):
					for h in range(height):
						map.objs[x2+w][y2+h] = copied[w][h]

		# place the tiles
		for turf in arg.get("turf", []):
			x = turf[0]
			y = turf[1]
			a = turf[2]
			width = 1
			height = 1
			if len(turf) == 5:
				width = turf[3]
				height = turf[4]
			for w in range(width):
				for h in range(height):
					map.turfs[x+w][y+h] = a
		# place the object lists
		for obj in arg.get("obj", []):
			x = obj[0]
			y = obj[1]
			a = obj[2]
			width = 1
			height = 1
			if len(turf) == 5:
				width = turf[3]
				height = turf[4]
			for w in range(width):
				for h in range(height):
					map.objs[x+w][y+h] = a
		map.broadcast("BLK", arg, remote_category=botwatch_type['build'])
	else:
		protocol_error(client, echo, text='Bulk building is disabled on this map', code='missing_permission', detail='bulk_build', subject_id=map)

@protocol_command()
def fn_WHO(map, client, arg, echo):
	if "update" in arg:
		update = arg["update"]

		# Defaults
		actor = client
		id_to_use = client.protocol_id()

		if 'rc' in arg:
			actor = find_remote_control_entity(client, arg['rc'], echo)
			if actor == None:
				return
			else:
				map = actor.map
				id_to_use = arg['rc']

		if map == None:
			return

		valid_data = validate_client_who(id_to_use, arg["update"])
		for key,value in valid_data.items():
			if key != 'id':
				setattr(actor, key, value)
		map.broadcast("WHO", {"update": valid_data})
	else:
		protocol_error(client, echo, text='Not implemented')

@protocol_command(pre_identify=True)
def fn_PIN(map, client, arg, echo):
	client.ping_timer = 300

@protocol_command(pre_identify=True)
def fn_VER(map, client, arg, echo):
	# Also receives version info from the client, but ignore it for now
	client.send("VER", server_version_dict)

server_feature_attribute = {
	"see_past_map_edge": "see_past_map_edge",
	"batch": "can_batch_messages",
	"receive_build_messages": "receive_build_messages",
	"entity_message_forwarding": "can_forward_messages_to",
}

@protocol_command(pre_identify=True)
def fn_IDN(map, client, arg, echo):
	if client.identified:
		return

	override_map = None
	if "map" in arg:
		override_map = arg["map"]
	# Other overrides
	if "name" in arg:
		client.name = escape_tags(arg["name"])

	# Check the features the client requested
	ack_info = {}
	if arg != {} and "features" in arg:
		ack_info["features"] = {}
		for key, value in arg["features"].items():
			if key in available_server_features: # TODO: check if specified version is >= minimum version
				if key in server_feature_attribute:
					setattr(client, server_feature_attribute[key], True)

				# Add it to the set and acnowledge it too
				client.features.add(key)
				ack_info["features"][key] = {"version": available_server_features[key]["version"]}

	def login_successful():
		client.identified = True
		client.send("IDN", ack_info if ack_info != {} else None)

		if len(Config["Server"]["MOTD"]):
			client.send("MSG", {'text': Config["Server"]["MOTD"]})

		if Config["Server"]["BroadcastConnects"]:
			text = '%s has connected!' % client.name_and_username()
			for u in AllClients:
				if u is not client:
					u.send("MSG", {'text': text})

		# Bot and user counts
		if "bot" in arg:
			if arg["bot"]:
				client.user_flags |= userflag['bot']
			else:
				client.user_flags &= ~userflag['bot']

		bot_count = 0
		for c in AllClients:
			if c.user_flags & userflag['bot']:
				bot_count += 1
		client.send("MSG", {'text': 'Users connected: %d' % (len(AllClients)-bot_count) + ('' if bot_count == 0 else '. Bots connected: %d.' % bot_count)})
		client.login_successful_callback = None

	client.login_successful_callback = login_successful

	# Now check the username and password and actually log in
	if arg != {} and "username" in arg and "password" in arg:
		if not client.login(filter_username(arg["username"]), arg["password"], override_map=override_map):
			print("Failed login for "+filter_username(arg["username"]))
			client.disconnect(reason="BadLogin")
			return
	else:
		if not override_map or not client.switch_map(override_map[0], new_pos=None if (len(override_map) == 1) else (override_map[1:])):
			client.switch_map(get_database_meta('default_map'))

	if client.login_successful_callback: # Make sure this gets called even if the map switch fails
		client.login_successful_callback()

# -------------------------------------

def ext_error(context, text=None, data=None, code=None, detail=None, subject_id=None):
	respond_to, echo, ext_name = context
	args = {'ext_type': ext_name}

	if echo:
		args['echo'] = echo
	if text:
		args['text'] = text
	if data:
		args['data'] = data
	if code:
		args['code'] = code
	if detail:
		args['detail'] = detail
	if subject_id:
		args['subject_id'] = subject_id

	respond_to.send('ERR', args)

"""
def forward_ext_if_needed(entity_id, forward_message_type):
	e = get_entity_by_id(entity_id, load_from_db=False)
	if e == None:
		return None
	if forward_message_type and (forward_message_type in e.forward_message_types):
		return get_entity_by_id(e.forward_messages_to, load_from_db=False)
	return e
"""

@ext_protocol_command("entity_click")
def entity_click(map, client, context, arg, name):
	#e = forward_ext_if_needed(arg['id'], 'CLICK')
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e == None:
		ext_error(context, code="not_found", subject_id=arg['id'])
		return
	arg = remove_invalid_dict_fields(arg, {
		"x":                int, # Where 0,0 is the top left of the mini tilemap or the entity
		"y":                int,
		"button":           int, # Usually 0?
		"target":           lambda x: x in (None, "entity", "mini_tilemap"),
	})
	arg['id'] = client.protocol_id()
	e.send("EXT", {name: arg})

@ext_protocol_command("key_press")
def key_press(map, client, context, arg, name):
	#e = forward_ext_if_needed(arg['id'], 'KEYS')
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e == None:
		ext_error(context, code="not_found", subject_id=arg['id'])
		return
	arg = remove_invalid_dict_fields(arg, {
		"key":				str,
		"down":             bool,
	})
	arg['id'] = client.protocol_id()
	e.send("EXT", {name: arg})

@ext_protocol_command("take_controls")
def take_controls(map, client, context, arg, name):
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e == None:
		ext_error(context, code="not_found", subject_id=arg['id'])
	elif client.has_permission(e, permission['minigame']):
		arg = remove_invalid_dict_fields(arg, {
			"keys":             list, # Keys to ask for
			"pass_on":          bool, # Allow keys to do their normal actions
			"key_up":           bool, # Include key release events
		})
		arg['id'] = client.protocol_id()
		e.send("EXT", {name: arg})
	else:
		ext_error(context, code="missing_permission", detail="minigame", subject_id=arg['id'])

@ext_protocol_command("took_controls")
def took_controls(map, client, context, arg, name):
	#e = forward_ext_if_needed(arg['id'], 'KEYS')
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e == None:
		return
	arg = remove_invalid_dict_fields(arg, {
		"keys":             list,
		"accept":           bool,
	})
	arg['id'] = client.protocol_id()
	e.send("EXT", {name: arg})

@ext_protocol_command("bot_message_button")
def bot_message_button(map, client, context, arg, name):
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e == None:
		return
	arg = remove_invalid_dict_fields(arg, {
		"text":             str,
	})
	arg['id'] = client.protocol_id()
	arg['name'] = client.name
	arg['username'] = client.username_or_id()
	e.send("EXT", {name: arg})

@ext_protocol_command("list_available_ext_types")
def list_available_ext_types(map, client, context, arg, name):
	client.send("EXT", {name: list(ext_handlers.keys())})

@protocol_command()
def fn_EXT(map, client, arg, echo):
	actor = client
	if 'rc' in arg:
		actor = find_remote_control_entity(client, arg['rc'], echo)
		if actor == None:
			return
		else:
			map = actor.map

	echo = arg['echo'] if ('echo' in arg) else None
	for k,v in arg.items():
		if k in ext_handlers:
			context = (actor, echo, k)
			ext_handlers[k](map, actor, context, v, k)

# -------------------------------------

def handle_protocol_command(map, client, command, arg, echo):
	if not client.identified and command not in pre_identify_commands:
		protocol_error(client, echo, text='Protocol command requires identifying first: %s', code='identify')
		return

	# Attempt to run the command handler if it exists
	if command in handlers:
		if command in map_only_commands and (client.map == None or not client.map.is_map()):
			protocol_error(client, echo, text='Protocol command must be done on a map: %s' % command, code='map_only')
		else:
			return handlers[command](map, client, arg, echo)
	else:
		protocol_error(client, echo, text='Bad protocol command: %s' % command, code='invalid_command', detail=command)
