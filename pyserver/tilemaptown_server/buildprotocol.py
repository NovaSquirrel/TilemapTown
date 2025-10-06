# Tilemap Town
# Copyright (C) 2017-2025 NovaSquirrel
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

import json, datetime, time, types, weakref, secrets
from .buildglobal import *
from .buildcommand import handle_user_command, tile_is_okay, data_disallowed_for_entity_type, send_private_message, send_message_to_map, entity_types_users_can_change_data_for, apply_rate_limiting, attach_result_to_context, respond, separate_first_word
from .buildentity import Entity, GenericEntity
from .buildclient import Client
from .buildgadget import Gadget

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

def find_remote_control_entity(connection, client, rc, context):
	if client.has_permission(rc, permission['remote_command'], False):
		actor = get_entity_by_id(rc, load_from_db=False)
		if actor == None:
			connection.protocol_error(context, text='Entity %s not loaded' % rc, code='not_loaded', subject_id=rc)
			return None
		else:
			return actor
	else:
		connection.protocol_error(context, text='Entity %s not loaded' % rc, code='missing_permission', detail='remote_command', subject_id=rc)
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
			"map_size":         lambda x: is_list_with_two_ints(x) and x[0] >= 1   and x[0] <= 24 and x[1] >= 1 and x[1] <= 24,
			"tile_size":        lambda x: is_list_with_two_ints(x) and x[0] >= 1   and x[0] <= 64 and x[1] >= 1 and x[1] <= 64,
			"offset":           lambda x: is_list_with_two_ints(x) and x[0] >= -32 and x[0] <= 32 and x[1] >= -32 and x[1] <= 32,
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
		if ("data" not in data) or (len(data["data"]) > 576): # 24*24
			return None
		return {"data": data["data"]}
	return None
GlobalData['who_mini_tilemap'] = who_mini_tilemap
GlobalData['who_mini_tilemap_data'] = who_mini_tilemap_data

CLIENT_WHO_WHITELIST = {
	"typing": bool,
	"clickable": bool,
	"mini_tilemap": who_mini_tilemap,
	"mini_tilemap_data": who_mini_tilemap_data,
	"usable": bool,
}

def validate_client_who(id, data):
	validated_data = {"id": id}
	for key, value in data.items():
		if key in CLIENT_WHO_WHITELIST:
			validated_data[key] = CLIENT_WHO_WHITELIST[key](value)
	return validated_data

def must_be_map_owner(connection, actor, context, admin_okay, give_error=True):
	if actor.map == None:
		return False
	if (actor.db_id != None and actor.map.owner_id == actor.db_id) or connection.oper_override or (admin_okay and actor.has_permission(actor.map, permission['admin'], False)):
		return True
	elif give_error:
		connection.protocol_error(context, text='You don\'t have permission to do that', code='missing_permission', detail='admin' if admin_okay else None, subject_id=actor.map)
	return False

def default_build_permission_for_connection(connection):
	level = Config["Security"]["DefaultBuildingPermission"]
	if level == 0:
		return True
	if level == 1:
		return connection.db_id != None
	if level == 2:
		return (connection.user_flags & userflag['trusted_builder']) != 0
	if level == 3:
		return False

def check_trusted_only_building(connection, map):
	level = Config["Security"]["TrustedOnlyBuilding"]
	if level == 0:
		return True
	if level == 1:
		return (connection.db_id != None and connection.db_id == map.owner_id) or (connection.user_flags & userflag['trusted_builder']) != 0 or connection.username in Config["Server"]["Admins"]
	if level == 2:
		return (connection.user_flags & userflag['trusted_builder']) != 0 or connection.username in Config["Server"]["Admins"]
	if level == 3:
		return connection.username in Config["Server"]["Admins"]

# Not used?
"""
def must_be_server_admin(client, context, give_error=True):
	if not client.is_client():
		return False
	if client.username in Config["Server"]["Admins"]:
		return True
	elif give_error:
		client.send("ERR", {'text': 'You don\'t have permission to do that', 'code': 'server_admin_only'})
	return False
"""

def set_entity_params_from_dict(e, d, connection, client, context):
	if e.creator_temp_id != client.id and e.owner_id != client.db_id and \
	not client.has_permission(e, permission['modify_properties'], False):
		# If you don't have permission for modify_properties you may still be able to do the update if you're only changing specific properties
		appearance_change_props = {'id', 'name', 'desc', 'pic', 'tags'}

		if any(key not in appearance_change_props for key in d) or not client.has_permission(e, permission['modify_appearance'], False):
			connection.protocol_error(context, text='You don\'t have permission to update %s' % d['id'], code='missing_permission', detail='modify_properties', subject_id=e)
			return
	if 'data' in d:
		bad = data_disallowed_for_entity_type(e.entity_type, d['data'])
		if bad != None:
			connection.protocol_error(context, text=bad, code='bad_value', detail='data', subject_id=e)
			del d['data']
		else:
			old_data = e.data
			e.data = d['data']
			if e.db_id != None and entity_type_name[e.entity_type] in ('image', 'tileset') and old_data != e.data:
				is_tileset = entity_type_name[e.entity_type] == 'tileset'
				for c in AllConnections:
					if e.db_id in c.images_and_tilesets_received_so_far:
						if is_tileset:
							c.send("TSD", {'id': e.db_id, 'data': e.data, 'update': True})
						else:
							c.send("IMG", {'id': e.db_id, 'url': e.data, 'update': True})
			if isinstance(e, Gadget):
				e.reload_traits()
	if 'owner_id' in d:
		if e.owner_id != client.db_id:
			connection.protocol_error(context, text='Can only reassign ownership on entities you own', code='owner_only', subject_id=e)
			del d['owner_id']
		elif client.has_permission(d['owner_id'], permission['set_owner_to_this'], False):
			e.owner_id = d['owner_id']
		else:
			connection.protocol_error(context, text='Don\'t have permission to set owner to ' % d['owner_id'], code='missing_permission', detail='set_owner_to_this', subject_id=e)
			del d['owner_id']
	if 'owner_username' in d:
		if e.owner_id != client.db_id:
			connection.protocol_error(context, text='Can only reassign ownership on entities you own', code='owner_only', subject_id=e)
			del d['owner_username']
		new_owner = find_db_id_by_username(d['owner_username'])
		if new_owner:
			if client.has_permission(new_owner, permission['set_owner_to_this'], False):
				e.owner_id = new_owner
			else:
				connection.protocol_error(context, text='Don\'t have permission to set owner to ' % d['owner_username'], code='missing_permission', detail='set_owner_to_this', subject_id=e)
				del d['owner_username']
		else:
			connection.protocol_error(context, text='Username \"%s\" not found' % d['owner_username'], code='not_found', subject_id=e)
			del d['owner_username']

	if 'folder' in d:
		if client.has_permission(d['folder'], (permission['entry']), False) \
		and client.has_permission(d['folder'], (permission['object_entry'], permission['persistent_object_entry']), False):
			if not e.switch_map(d['folder'], new_pos=d['pos'] if 'pos' in d else None, on_behalf_of=client):
				connection.protocol_error(context, text='Entity doesn\'t have permission to move there', code='missing_permission', subject_id=e)
				del d['folder']
		else:
			connection.protocol_error(context, text='Don\'t have permission to move entity there', code='missing_permission', subject_id=e)
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
			connection.protocol_error(context, text='Don\'t have permission to set entity\'s home there', code='missing_permission', detail='persistent_object_entry', subject_id=e)
			del d['home']

	if 'home_position' in d and len(d['home_position']) == 2:
		e.home_position = d['home_position']
	if 'name' in d:
		e.name = filter_displayname(d['name'])
	if 'desc' in d:
		e.desc = d['desc']
	if 'pic' in d:
		if pic_is_okay(d['pic']):
			e.pic = d['pic']
		else:
			connection.protocol_error(context, text='Invalid picture: %s' % d['pic'], code='bad_value', detail='pic', subject_id=e)
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
			connection.cleanup_entities_on_logout.add(e)
		else:
			connection.cleanup_entities_on_logout.discard(e)

# -------------------------------------

@protocol_command()
def fn_MOV(connection, map, client, arg, context):
	if not map:
		return

	# Can control a different entity if you have permission
	if 'rc' in arg:
		id = arg['rc']
		if ("new_map" in arg and not client.has_permission(id, (permission['move_new_map']), False)) \
			or ("new_map" not in arg and not client.has_permission(id, (permission['move'], permission['move_new_map']), False)):
			connection.protocol_error(context, text='You don\'t have permission to move entity %s' % id, code='missing_permission', detail='move_new_map', subject_id=id)
			return
		entity = get_entity_by_id(id, load_from_db=False)
		if entity is not client: # Make sure it's not actually just the client supplying their own ID
			if entity == None:
				connection.protocol_error(context, text='Can\'t move entity %s because it\'s not loaded' % id, code='not_loaded', subject_id=id)
				return
			if entity.map == None and "new_map" not in arg:
				connection.protocol_error(context, text='Can\'t move entity %s because it\'s not on a map' % id)
				return

			del arg['rc']
			handlers['MOV'](connection, entity.map, entity, arg, context)
			return

	if "if_map" in arg and map.db_id != arg["if_map"]:
		return

	# MOV can be used to switch maps
	if "new_map" in arg:
		client.switch_map(arg["new_map"], new_pos=arg["to"])
		return

	# Handle bumping into the map edge (for clients that don't implement see_past_map_edge)
	if "bump" in arg and map.is_map() and map.edge_id_links != None:
		bump_pos    = arg["bump"]

		# Check if the bumped position is past one of the edges
		edge_sign_x = -1 if bump_pos[0] < 0 else (1 if bump_pos[0] >= map.width else 0)
		edge_sign_y = -1 if bump_pos[1] < 0 else (1 if bump_pos[1] >= map.height else 0)
		if edge_sign_x != 0 or edge_sign_y != 0:
			# Find what map link index to use
			edge_index = directions.index((edge_sign_x, edge_sign_y))
			new_map = get_entity_by_id(map.edge_id_links[edge_index])
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
	data = remove_invalid_dict_fields(arg, {
			"from":				is_list_with_two_ints,
			"to":				is_list_with_two_ints,
			"dir":				int,
			"offset": 			lambda x: is_list_with_two_ints(x) and x[0] >= -32 and x[0] <= 32 and x[1] >= -32 and x[1] <= 32,
		})
	if not data:
		return
	data['id'] = client.protocol_id()
	map.broadcast("MOV", data, remote_category=maplisten_type['move'], mov_user=client)

	if 'offset' in data:
		offset = data['offset']
		if offset == None:
			client.offset = None
		else:
			offset_x, offset_y = min(32, max(-32, offset[0])), min(32, max(-32, offset[1]))
			client.offset = [offset_x, offset_y]
		if client.vehicle != None and client in client.vehicle.passengers and client.vehicle.vehicle is client:
			client.vehicle.offset = client.offset
			map.broadcast("MOV", {"id": client.vehicle.protocol_id(), "offset": client.offset}, remote_category=maplisten_type['move'])

	# Update this entity's position
	new_dir = data['dir'] if 'dir' in data else None
	if 'to' in data:
		client.move_to(data['to'][0], data['to'][1], new_dir=new_dir)
	else:
		client.move_to(None, None, new_dir=new_dir)

@protocol_command()
def fn_CMD(connection, map, client, arg, context):
	if len(arg['text']) > Config["MaxProtocolSize"]["Command"]:
		connection.protocol_error(context, text='Tried to send command that was too big: (%d, max is %d)' % (len(arg['text']), Config["MaxProtocolSize"]["Command"]), code='command_too_big', detail=Config["MaxProtocolSize"]["Command"])
		return
	actor = client

	if 'rc' in arg:
		actor = find_remote_control_entity(connection, client, arg['rc'], context)
		if actor == None:
			return
		else:
			map = actor.map

	handle_user_command(map, actor, context, arg["text"])

@protocol_command()
def fn_PRI(connection, map, client, arg, context):
	actor = client
	if 'rc' in arg:
		actor = find_remote_control_entity(connection, client, arg['rc'], context)
		if actor == None:
			return
	send_private_message(actor, context, arg['username'], arg['text'])

@protocol_command()
def fn_BAG(connection, map, client, arg, context):
	def allow_special_ids(text):
		if text == 'here':
			return map.protocol_id()
		if text == 'me':
			return client.protocol_id()
		return text

	c = Database.cursor()
	if "create" in arg:
		create = arg['create']
		# restrict type variable
		if create['type'] not in creatable_entity_types:
			connection.protocol_error(context, text='Invalid type of item to create (%s)' % create['type'])
			return
		create_class = Entity
		if create['type'] == 'gadget':
			create_class = Gadget
		elif create['type'] == 'generic':
			create_class = GenericEntity
		e = create_class(entity_type[create['type']], creator_id=client.db_id)
		e.name = "New item" # Default that will probably be overridden
		e.map_id = client.db_id
		e.creator_temp_id = client.id

		set_entity_params_from_dict(e, create, connection, client, context)

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
			connection.protocol_error(context, text='Can\'t clone %s' % arg['clone']['id'], code='not_found', subject_id=arg['clone']['id'])
			return

		clone_type = clone_me.entity_type
		create_class = Entity
		if clone_type == entity_type['user']:
			clone_type = entity_type['generic']
			create_class = GenericEntity
		elif clone_type == entity_type['gadget']:
			create_class = Gadget
		else:
			clone_type_name = entity_type_name[clone_type]
			if clone_type_name not in creatable_entity_types:
				connection.protocol_error(context, text='Invalid type of item to clone (%s)' % clone_type_name)
				return

		if clone_me.creator_temp_id != client.id and (clone_me.owner_id != client.db_id or client.db_id == None) and \
		not client.has_permission(clone_me, permission['copy'], False):
			connection.protocol_error(context, text='You don\'t have permission to clone %s' % arg['clone']['id'], code='missing_permission', detail='copy', subject_id=arg['clone']['id'])
			return

		# Create a new entity and copy over the properties
		new_item = create_class(clone_me.entity_type)
		clone_me.copy_onto(new_item)
		new_item.owner_id = client.db_id
		new_item.creator_temp_id = client.id

		set_entity_params_from_dict(new_item, arg['clone'], connection, client, context)
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
		update_me = get_entity_by_id(allow_special_ids(update['id']), do_not_load_scripts=True)
		if update_me == None:
			connection.protocol_error(context, text='Can\'t update %s' % update['id'], code='not_found', subject_id=update['id'])
			return

		set_entity_params_from_dict(update_me, update, connection, client, context)

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
					connection.protocol_error(context, text='Don\'t have permission to move entity', code='missing_permission', detail='move_new_map', subject_id=move['id'])
			else:
				if client.has_permission(move_me, (permission['move'], permission['move_new_map']), False):
					move_me.switch_map(move['folder'])
					if not move_me.temporary:
						move_me.save()
					client.send('BAG', {'move': move})
				else:
					connection.protocol_error(context, text='Don\'t have permission to move entity', code='missing_permission', detail='move', subject_id=move['id'])
		else:
			connection.protocol_error(context, text='Don\'t have permission to move entity there', code='missing_permission', detail='object_entry', subject_id=move['folder'])

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
			connection.protocol_error(context, text='Can\'t delete %s' % delete['id'], code='not_found', subject_id=delete['id'])
			return
		elif connection.oper_override:
			pass
		elif delete_me.owner_id == None and delete_me.creator_temp_id and delete_me.creator_temp_id not in AllEntitiesByID:
			pass
		elif delete_me.creator_temp_id == client.id:
			pass
		elif delete_me.owner_id == None or delete_me.owner_id != client.db_id:
			connection.protocol_error(context, text='You don\'t have permission to delete %s' % delete['id'], code='owner_id', subject_id=delete['id'])
			return

		# Move everything inside to the parent
		for child in delete_me.contents.copy():
			delete_me.remove_from_contents(child)
			if delete_me.map:
				delete_me.map.add_to_contents(child)

		# Delete from the database too
		if delete_me.db_id:
			c.execute('DELETE FROM Entity WHERE owner_id=? AND id=?', (client.db_id, delete_me.db_id))
		if delete_me.map and delete_me.map != client:
			client.send("BAG", {'remove': {'id': delete['id']}})
		if delete_me.map:
			delete_me.map.remove_from_contents(delete_me)
		client.send("BAG", {'delete': delete})

		delete_me.save_on_clean_up = False
		delete_me.clean_up()

	elif "info" in arg:
		info = arg['info']
		info_me = get_entity_by_id(info['id'], do_not_load_scripts=True)
		if info_me == None:
			connection.protocol_error(context, text='Can\'t get info for %s' % info['id'], code='not_found', subject_id=info['id'])
			return

		bag_info = info_me.bag_info()
		if info_me.is_client(): # No spying
			bag_info.pop('folder')
			if (info_me.connection_attr('user_flags') or 0) & userflag['secret_pic']:
				bag_info.pop('pic', None)
				bag_info.pop('desc', None)
		if bag_info['type'] not in entity_types_users_can_change_data_for:
			bag_info.pop('data')
		client.send("BAG", {'info': bag_info})

	elif "list_contents" in arg:
		list_contents = arg['list_contents']
		list_me = get_entity_by_id(list_contents['id'])
		if list_me == None:
			connection.protocol_error(context, text='Can\'t list contents for %s' % list_contents['id'], subject_id=info['id'])
			return
		if list_me.owner_id != client.db_id and not client.has_permission(list_me, permission['list_contents'], False):
			connection.protocol_error(context, text='Don\'t have permission to list contents for %s' % list_contents['id'], code='missing_permission', detail='list_contents', subject_id=list_contents['id'])
			return

		if list_contents.get('recursive', False):
			list_contents['contents'] = [child.bag_info() for child in list_me.all_children()]
		else:
			list_contents['contents'] = [child.bag_info() for child in list_me.contents]
		client.send("BAG", {'list_contents': list_contents})

@protocol_command()
def fn_EML(connection, map, client, arg, context):
	if client.db_id != None:
		c = Database.cursor()
		if "send" in arg:
			# todo: definitely needs some limits in place to prevent abuse!

			# Get a list of all the people to mail
			recipient_ids = set(find_db_id_by_username(x) for x in arg['send']['to'])
			recipient_string = ','.join([str(x) for x in recipient_ids])
			arg["send"] = remove_invalid_dict_fields(arg["send"], {
				"to":       str,
				"subject":  str,
				"contents": str,
			})
			arg["send"]["to"] = [find_username_by_db_id(x) for x in recipient_ids]

			if any(x == None for x in recipient_ids):
				connection.protocol_error(context, text='Couldn\'t find one or more users you wanted to mail', code='not_found')
				return

			# Let the client know who sent it, since the 'send' argument will get passed along directly
			arg["send"]["from"] = client.username
			arg["send"]["timestamp"] = datetime.datetime.now().isoformat()

			failed_count = 0

			# Send everyone their mail
			for id in recipient_ids:
				if id == None:
					continue

				recipient_connection = None
				for find_connection in AllConnections:
					if find_connection.db_id == id:
						recipient_connection = find_connection
						break

				# Drop mail sent to people who have you ignored
				if recipient_connection:
					if client.username in recipient_connection.ignore_list:
						connection.protocol_error(context, text='You cannot mail '+recipient_connection.username)
						print("Dropping mail sent to "+str(id))
						failed_count += 1
						continue
				else:
					c.execute('SELECT ignore FROM User WHERE entity_id=?', (id,))
					result = c.fetchone()
					if result != None and (client.username in json.loads(result[0] or "[]")):
						connection.protocol_error(context, text='You cannot mail '+find_username_by_db_id(id))
						print("Dropping mail sent to "+str(id))
						failed_count += 1
						continue

				c.execute("INSERT INTO Mail (owner_id, sender_id, recipients, subject, contents, created_at, flags) VALUES (?, ?, ?, ?, ?, ?, ?)", (id, client.db_id, recipient_string, arg['send']['subject'], arg['send']['contents'], datetime.datetime.now(), 0))

				# Is that person online? tell them!
				if recipient_connection:
					arg['send']['id'] = c.execute('SELECT last_insert_rowid()').fetchone()[0]
					recipient_connection.send("EML", {'receive': arg['send']})

			# Give the sender a copy of the mail that was sent, and tell them about it
			c.execute("INSERT INTO Mail (owner_id, sender_id, recipients, subject, contents, created_at, flags) VALUES (?, ?, ?, ?, ?, ?, ?)", (client.db_id, client.db_id, recipient_string, arg['send']['subject'], arg['send']['contents'], datetime.datetime.now(), 2))
			arg['send']['id'] = c.execute('SELECT last_insert_rowid()').fetchone()[0]
			client.send("EML", {'sent': arg["send"] }) # Tell the sender their mail sent

			client.send("MSG", {'text': 'Sent mail to %d user%s' % (len(recipient_ids)-failed_count, "s" if (len(recipient_ids)-failed_count) != 1 else "")})

		elif "read" in arg:
			c.execute('UPDATE Mail SET flags=1 WHERE owner_id=? AND id=? AND flags=0', (client.db_id, arg['read']))
		elif "delete" in arg:
			c.execute('DELETE FROM Mail WHERE owner_id=? AND id=?', (client.db_id, arg['delete']))

	else:
		connection.protocol_error(context, text='Guests don\'t have mail. Use [tt]/register username password[/tt]', code='no_guests')

@protocol_command()
def fn_MSG(connection, map, client, arg, context):
	actor = client
	if 'rc' in arg:
		actor = find_remote_control_entity(connection, client, arg['rc'], context)
		if actor == None:
			return
		else:
			map = actor.map

	send_message_to_map(map, actor, arg["text"], context)

@protocol_command()
def fn_TSD(connection, map, client, arg, context):
	if isinstance(arg['id'], list):
		tilesets = set(arg['id'])
	else:
		tilesets = (arg['id'],)

	client.start_batch()
	for t in tilesets:
		if isinstance(t, str) and string_is_int(t):
			t = int(t)
		c = Database.cursor()
		c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type['tileset'], t,))
		result = c.fetchone()
		if result == None:
			connection.protocol_error(context, text='Invalid item ID', code='not_found', subject_id=t)
		else:
			client.send("TSD", {'id': t, 'data': decompress_entity_data(result[0], result[1])})
			connection.images_and_tilesets_received_so_far.add(t)
	client.finish_batch()

@protocol_command()
def fn_IMG(connection, map, client, arg, context):
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
			connection.protocol_error(context, text='Invalid item ID', code='not_found', subject_id=i)
		else:
			client.send("IMG", {'id': i, 'url': loads_if_not_none(decompress_entity_data(result[0], result[1]))})
			connection.images_and_tilesets_received_so_far.add(i)
	client.finish_batch()

@protocol_command(map_only=True)
def fn_MAP(connection, map, client, arg, context):
	if "pos" not in arg:
		connection.protocol_error(context, text='No "pos" provided')
		return
	pos = arg["pos"]
	if pos[2] < pos[0] or pos[3] < pos[1]:
		connection.protocol_error(context, text='Invalid "pos"')
		return
	if (pos[2]-pos[0]) > 10 or (pos[3]-pos[1]) > 10: # Limit it to small sections of the map for now?
		connection.protocol_error(context, text='Requested area too big')		
		return
	client.send("MAP", map.map_section(pos[0], pos[1], pos[2], pos[3]))

@protocol_command(map_only=True)
def fn_MAI(connection, map, client, arg, context):
	send_all_info = must_be_map_owner(connection, client, context, True, give_error=False)
	client.send("MAI", map.map_info(all_info=send_all_info))

@protocol_command(map_only=True)
def fn_DEL(connection, map, client, arg, context):
	x1 = arg["pos"][0]
	y1 = arg["pos"][1]
	x2 = arg["pos"][2]
	y2 = arg["pos"][3]
	if not check_trusted_only_building(connection, map):
		client.send("MAP", map.map_section(x1, y1, x2, y2))
		connection.protocol_error(context, text='Building is currently disabled on this server', code='disabled_feature', detail='build', subject_id=map)
		return
	if client.has_permission(map, permission['build'], default_build_permission_for_connection(connection)) or must_be_map_owner(connection, client, context, True, give_error=False):
		if not map.map_data_loaded:
			connection.protocol_error(context, text='Map isn\'t loaded, so it can\'t be modified', code='not_loaded', subject_id=map)
			return

		# Allow using DEL as a rectangle fill by overriding which tile gets put in the deleted area
		turf_replace = None
		objs_replace = None
		custom_turf = isinstance(arg["turf"], str) or isinstance(arg["turf"], dict)
		custom_objs = isinstance(arg["obj"], list)
		if "turf" in arg and custom_turf:
			tile_test = tile_is_okay(arg["turf"])
			if not tile_test[0]:
				connection.protocol_error(context, text='Tile [tt]%s[/tt] rejected (%s)' % (arg["turf"], tile_test[1]))
				return
			turf_replace = arg["turf"]
		if "obj" in arg and custom_objs:
			tile_test = [tile_is_okay(x) for x in arg["obj"]]
			if all(_[0] for _ in tile_test): # all tiles pass the test
				objs_replace = arg["obj"]
			else:
				connection.protocol_error(context, text='Obj tiles rejected')
				return

		map.map_data_modified = True

		# Save undo information
		old_data = None
		if client.is_client() and client.map == map:
			connection.undo_delete_data = map.map_section(x1, y1, x2, y2)
			connection.undo_delete_when = time.time()
			connection.delete_count += 1
			old_data = connection.undo_delete_data
		write_to_build_log(map, client, "DEL", arg, old_data)
		connection.build_session.write_del(map.protocol_id(), x1, y1, x2, y2, old_data, turf_replace, objs_replace)

		# Do the delete and tell clients about it
		for x in range(x1, x2+1):
			for y in range(y1, y2+1):
				if arg["turf"]:
					map.turfs[x][y] = turf_replace;
				if arg["obj"]:
					map.objs[x][y] = objs_replace;
		# make username available to listeners
		arg['username'] = client.username_or_id()
		arg['id'] = client.protocol_id()
		map.broadcast("DEL", arg, remote_only=True, remote_category=maplisten_type['build'])
		map.broadcast("DEL", arg, require_extension="receive_build_messages")

		# send map update to everyone on the map
		map.broadcast("MAP", map.map_section(x1, y1, x2, y2), send_to_links=True)
	else:
		client.send("MAP", map.map_section(x1, y1, x2, y2))
		connection.protocol_error(context, text='Building is disabled on this map', code='missing_permission', detail='build', subject_id=map)

@protocol_command(map_only=True)
def fn_PUT(connection, map, client, arg, context):
	def notify_listeners():
		# make username available to listeners
		arg['username'] = client.username_or_id()
		arg['id'] = client.protocol_id()
		map.broadcast("PUT", arg, remote_only=True, remote_category=maplisten_type['build'])
		map.broadcast("PUT", arg, require_extension="receive_build_messages")

	temporary = arg.get('temp', False)
	x = arg["pos"][0]
	y = arg["pos"][1]
	if not check_trusted_only_building(connection, map):
		client.send("MAP", map.map_section(x, y, x, y))
		connection.protocol_error(context, text='Building is currently disabled on this server', code='disabled_feature', detail='build', subject_id=map)
		return
	if client.has_permission(map, permission['build'], default_build_permission_for_connection(connection)) or must_be_map_owner(connection, client, context, True, give_error=False):
		if not map.map_data_loaded:
			connection.protocol_error(context, text='Map isn\'t loaded, so it can\'t be modified', code='not_loaded', subject_id=map)
			return
		if not temporary:
			map.map_data_modified = True
		connection.build_count += 1

		# verify the the tiles you're attempting to put down are actually good
		if arg.get("obj", False): #object
			tile_test = [tile_is_okay(x) for x in arg["atom"]]
			if all(_[0] for _ in tile_test): # all tiles pass the test
				write_to_build_log(map, client, "PUT", arg, map.objs[x][y])
				connection.build_session.write_put_objs(map.protocol_id(), x, y, arg["atom"], map.objs[x][y])
				map.objs[x][y] = arg["atom"]
				notify_listeners()
				map.broadcast("MAP", map.map_section(x, y, x, y), send_to_links=True)
			else:
				# todo: give a reason?
				client.send("MAP", map.map_section(x, y, x, y))
				connection.protocol_error(context, text='Placed objects rejected')
		else: #turf
			tile_test = tile_is_okay(arg["atom"])
			if tile_test[0]:
				written_turf = arg["atom"] if arg["atom"] != map.default_turf else None
				if map.turfs[x][y] != written_turf:
					write_to_build_log(map, client, "PUT", arg, map.turfs[x][y])
					connection.build_session.write_put_turf(map.protocol_id(), x, y, arg["atom"], map.turfs[x][y])
					map.turfs[x][y] = written_turf
					notify_listeners()
					map.broadcast("MAP", map.map_section(x, y, x, y), send_to_links=True)
				else:
					client.send("MAP", map.map_section(x, y, x, y))
			else:
				client.send("MAP", map.map_section(x, y, x, y))
				connection.protocol_error(context, text='Tile [tt]%s[/tt] rejected (%s)' % (arg["atom"], tile_test[1]))
	else:
		client.send("MAP", map.map_section(x, y, x, y))
		connection.protocol_error(context, text='Building is disabled on this map', code='missing_permission', detail='build', subject_id=map)

@protocol_command(map_only=True)
def fn_BLK(connection, map, client, arg, context):
	if not check_trusted_only_building(connection, map):
		connection.protocol_error(context, text='Building is currently disabled on this server', code='disabled_feature', detail='build', subject_id=map)
		return
	if client.has_permission(map, permission['bulk_build'], False) or must_be_map_owner(connection, client, context, True, give_error=False):
		if not map.map_data_loaded:
			connection.protocol_error(context, text='Map isn\'t loaded, so it can\'t be modified', code='not_loaded', subject_id=map)
			return
		temporary = arg.get('temp', False)
		if not temporary:
			map.map_data_modified = True

		# verify the tiles
		for turf in arg.get("turf", []):
			if not tile_is_okay(turf[2])[0]:
				connection.protocol_error(context, text='Bad turf in bulk build', subject_id=map)
				return
		for obj in arg.get("obj", []):
			tile_test = [tile_is_okay(x) for x in obj[2]]
			if any(not x[0] for x in tile_test): # any tiles don't pass the test
				connection.protocol_error(context, text='Bad obj in bulk build', subject_id=map)
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
		map.broadcast("BLK", arg, remote_category=maplisten_type['build'])
	else:
		connection.protocol_error(context, text='Bulk building is disabled on this map', code='missing_permission', detail='bulk_build', subject_id=map)

@protocol_command()
def fn_WHO(connection, map, client, arg, context):
	if "update" in arg:
		update = arg["update"]

		# Defaults
		actor = client
		id_to_use = client.protocol_id()

		if 'rc' in arg:
			actor = find_remote_control_entity(connection, client, arg['rc'], context)
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
		connection.protocol_error(context, text='Not implemented')

@protocol_command(pre_identify=True)
def fn_PIN(connection, map, client, arg, context):
	connection.ping_timer = 300

@protocol_command(pre_identify=True)
def fn_ACK(connection, map, client, arg, context):
	cmd = arg.get("type")
	if cmd == "PRI":
		try:
			if connection.db_id not in OfflineMessages:
				return
			timestamp = datetime.datetime.fromisoformat(arg["key"])

			new_offline_messages = {}
			for sender_db_id, queue in OfflineMessages[client.db_id].items():
				new_offline_messages[sender_db_id] = [_ for _ in queue if timestamp < _[1]]
				if new_offline_messages[sender_db_id] == []:
					del new_offline_messages[sender_db_id]

			if new_offline_messages == {}:
				del OfflineMessages[client.db_id]
			else:
				OfflineMessages[client.db_id] = new_offline_messages
		except:
			pass

@protocol_command(pre_identify=True)
def fn_VER(connection, map, client, arg, context):
	# Also receives version info from the client, but ignore it for now
	client.send("VER", server_version_dict)

server_feature_attribute = {
	"see_past_map_edge": "see_past_map_edge",
	"batch": "can_batch_messages",
	"receive_build_messages": "receive_build_messages",
	"entity_message_forwarding": "can_forward_messages_to",
	"user_watch_with_who": "user_watch_with_who",
	"message_acknowledgement": "can_acknowledge",
}

@protocol_command(pre_identify=True)
def fn_IDN(connection, map, client, arg, context):
	if connection.identified: # Already identified
		return

	# Ideally MaxConnectionsPerIP would get checked earlier, but doing it here means the disconnect reason actually gets sent
	if sum(int(connection2.ip == connection.ip) for connection2 in AllConnections) > Config["Security"]["MaxConnectionsPerIP"]:
		connection.disconnect(reason="TooManyConnections")
		return
	if (("username" not in arg) or (arg["username"] not in Config["Server"]["Admins"])) and len(AllConnections) > Config["Server"]["MaxUsers"]:
		connection.disconnect(reason="ServerTooFull")
		return

	override_map = None
	if "map" in arg:
		override_map = arg["map"]
	messaging_only_mode = "client_mode" in arg and arg["client_mode"] == "messaging"

	# Check if an entity exists already; only used for the broadcasted connection message
	had_old_entity = False
	if arg != {} and "username" in arg:
		entity_id = find_db_id_by_username(arg["username"])
		if entity_id != None:
			had_old_entity = entity_id in AllEntitiesByDB

	def login_successful():
		# Will be sent within a batch
		connection.identified = True
		connection.send("IDN", ack_info if ack_info != {} else None)
		connection.client_name = arg.get("client_name")

		if len(Config["Server"]["MOTD"]):
			connection.send("MSG", {'text': Config["Server"]["MOTD"], 'class': 'server_motd'})
		park_text = GlobalData.get('park_text')
		park_map = GlobalData.get('park_map')
		if park_text and len(park_text):
			if park_map and len(park_map):
				connection.send("MSG", {'text': park_text, 'class': 'event_notice', 'buttons': [GlobalData.get('park_map_button') or 'Go!', park_map]})
			else:
				connection.send("MSG", {'text': park_text, 'class': 'event_notice'})

		if Config["Server"]["BroadcastConnects"] and not messaging_only_mode:
			if had_old_entity:
				text = '[small](switching %s over to a new connection)[/small]' % new_client.name_and_username()
			else:
				text = '%s has connected!' % new_client.name_and_username()
			for u in AllClients:
				if u is not new_client:
					u.send("MSG", {'text': text, 'class': 'server_userconnect'})

		# Bot and user counts
		if "bot" in arg:
			if arg["bot"]:
				connection.user_flags |= userflag['bot']
			else:
				connection.user_flags &= ~userflag['bot']

		bot_count = 0
		for c in AllClients:
			if (c.connection_attr('user_flags') or 0) & userflag['bot']:
				bot_count += 1
		im_count = 0
		for c in AllConnections:
			if c is not connection and hasattr(c, 'entity') and not isinstance(c.entity, Entity) and c.identified:
				im_count += 1
		user_count = len(AllClients)-bot_count
		connected_text = 'Users connected: %d' % (user_count) + ('' if bot_count == 0 else '. Bots connected: %d.' % bot_count)
		if user_count > 1:
			connected_text += ('.' if bot_count == 0 else '') + ' Use the [tt]/wa[/tt] command to see where people are at!'
		connection.send("MSG", {'text': connected_text, 'class': 'server_stats'})

		# Tell messaging clients their username and protocol
		if messaging_only_mode:
			connection.send("WHO", {'list': {connection.db_id: {'name': get_entity_name_by_db_id(connection.db_id), 'username': arg["username"]}}, 'you': connection.db_id})

		if connection.username in Config["Server"]["Admins"]:
			connection.send("MSG", {'text': '[command]connectlog[/command] size: %d, [command]buildlog[/command] size: %d, [command]filelog[/command] size: %d' % (len(TempLogs[0]), len(TempLogs[1]), len(TempLogs[2])), 'class': 'secret_message'})
		connection.login_successful_callback = None
		connection.build_session.name = connection.entity.name

	#######################################################
	if not messaging_only_mode:
		new_client = Client(connection)
		connection.entity = new_client
	else:
		new_client = connection.entity
	connection.login_successful_callback = login_successful

	# Allow disabling all of your scripts while logging in
	# should happen before the entity gets loaded
	connection.disable_scripts = "disable_scripts" in arg and arg["disable_scripts"]

	# Check the features the client requested
	ack_info = {}
	if arg != {} and "features" in arg:
		ack_info["features"] = {}
		for key, value in arg["features"].items():
			if key in available_server_features: # TODO: check if specified version is >= minimum version
				if key in server_feature_attribute:
					setattr(connection, server_feature_attribute[key], True)

				# Add it to the set and acknowledge it too
				connection.features.add(key)
				ack_info["features"][key] = {"version": available_server_features[key]["version"]}
	
	# Pick a secure API key, if the API is enabled
	if Config["API"]["Enabled"]:
		while True:
			api_key = secrets.token_urlsafe(40)
			if api_key not in ConnectionsByApiKey:
				break
		ConnectionsByApiKey[api_key] = connection
		connection.api_key = api_key
		ack_info["api_key"] = api_key
		ack_info["api_url"] = Config["API"]["URL"]
		ack_info["api_version"] = 1

	# Now check the username and password and actually log in
	connection.start_batch()
	if arg != {} and "username" in arg and "password" in arg:
		# Log into an existing account
		if not connection.login(filter_username(arg["username"]), arg["password"], new_client, override_map=override_map, announce_login=False):
			write_to_connect_log("Failed login for "+filter_username(arg["username"]))
			connection.finish_batch()
			if hasattr(connection, 'login_fail_reason'):
				connection.disconnect(reason="BadLogin " + connection.login_fail_reason)
			else:
				connection.disconnect(reason="BadLogin")
			connection.login_successful_callback = None
			return
	elif Config["Security"]["NoGuests"]:
		connection.finish_batch()
		connection.disconnect("Server currently doesn't allow guests to connect; check in later?", reason="BadLogin\nServer currently doesn't allow guests")
		return
	elif messaging_only_mode:
		connection.finish_batch()
		connection.disconnect("Messaging mode currently requires you to log into an account", reason="BadLogin\nAn account is required for messaging mode")
		return
	else:
		# Become a guest
		if "name" in arg:
			new_client.name = filter_displayname(arg["name"])
		if not override_map or not new_client.switch_map(override_map[0], new_pos=None if (len(override_map) == 1) else (override_map[1:])):
			connection.entity.switch_map(get_database_meta('default_map'))

	if connection.login_successful_callback: # Be 100% sure this gets called
		connection.login_successful_callback()
	connection.finish_batch()

@protocol_command()
def fn_USE(connection, map, client, arg, context):
	actor = client
	if 'rc' in arg:
		actor = find_remote_control_entity(connection, client, arg['rc'], context)
		if actor == None:
			return
		else:
			map = actor.map

	if 'id' not in arg:
		return
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e != None and e.entity_type == entity_type['gadget']:
		e.receive_use(client)

# -------------------------------------

def ext_error(context, text=None, data=None, code=None, detail=None, subject_id=None):
	args = {'ext_type': context['ext_type']}
	respond_to = context['client']
	echo = context['echo']

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
def entity_click(connection, map, client, context, arg, name):
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
	if "button" not in arg:
		arg["button"] = 0
	arg['id'] = client.protocol_id()

	if e.entity_type == entity_type['gadget']:
		e.receive_entity_click(client, arg)
	else:
		e.send("EXT", {name: arg})

@ext_protocol_command("key_press")
def key_press(connection, map, client, context, arg, name):
	#e = forward_ext_if_needed(arg['id'], 'KEYS')
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e == None:
		ext_error(context, code="not_found", subject_id=arg['id'])
		return
	arg = remove_invalid_dict_fields(arg, {
		"key":				str,
		"down":             bool,
	})
	if "down" not in arg:
		arg["down"] = True
	arg['id'] = client.protocol_id()

	if e.entity_type == entity_type['gadget']:
		e.receive_key_press(client, arg.get("key"), arg.get("down", False))
	else:
		e.send("EXT", {name: arg})

@ext_protocol_command("take_controls")
def take_controls(connection, map, client, context, arg, name):
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
def took_controls(connection, map, client, context, arg, name):
	#e = forward_ext_if_needed(arg['id'], 'KEYS')
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e == None:
		return
	arg = remove_invalid_dict_fields(arg, {
		"keys":             list,
		"accept":           bool,
	})
	arg['id'] = client.protocol_id()

	if e.entity_type == entity_type['gadget']:
		e.receive_took_controls(client, arg)
	else:
		e.send("EXT", {name: arg})

@ext_protocol_command("bot_message_button")
def bot_message_button(connection, map, client, context, arg, name):
	e = get_entity_by_id(arg['id'], load_from_db=False)
	if e == None:
		return
	arg = remove_invalid_dict_fields(arg, {
		"text":             str,
	})
	arg['id'] = client.protocol_id()
	arg['name'] = client.name
	arg['username'] = client.username_or_id()

	if e.entity_type == entity_type['gadget']:
		e.receive_bot_message_button(client, arg)
	else:
		e.send("EXT", {name: arg})

@ext_protocol_command("typing")
def pm_typing_notification(connection, map, client, context, arg, name):
	# Primary purpose is to let you send a typing notice related to private messages
	if "username" in arg:
		target = find_connection_by_username(arg['username'])
		if target == None:
			return
		arg = remove_invalid_dict_fields(arg, {
			"status":             bool,
		})
		arg['id'] = client.protocol_id()
		arg['name'] = client.name
		arg['username'] = client.username_or_id()
		target.send("EXT", {name: arg})

	# Can also send a typing notification to the people listening for chat on a map (as long as you are also listening for chat on a map)
	elif "map" in arg:
		map_id = arg["map"]
		if (maplisten_type['chat_listen'], map_id) not in connection.listening_maps:
			return
		for other_connection in MapListens[maplisten_type['chat_listen']].get(map_id, tuple()):
			other_connection.send("WHO", {'type': 'chat_listeners', 'update': {'id': client.protocol_id(), 'typing': bool(arg['status']) }, 'remote_map': map_id})

@ext_protocol_command("list_available_ext_types")
def list_available_ext_types(connection, map, client, context, arg, name):
	client.send("EXT", {name: list(ext_handlers.keys())})

@ext_protocol_command("listen")
def ext_listen(connection, map, client, context, arg, name):
	categories = arg["types"]
	maps = set((int_if_numeric(x) if isinstance(x, str) else x) for x in arg["list"])

	client.start_batch()
	for category_name in categories:
		# find category id from name
		if category_name not in maplisten_type:
			continue
		category_id = maplisten_type[category_name]

		for map_id in maps:
			client.try_to_listen(map_id, category_id)
	client.finish_batch()
	send_ext_listen_status(connection)

@ext_protocol_command("unlisten")
def ext_unlisten(connection, map, client, context, arg, name):
	categories = arg["types"]
	maps = set((int_if_numeric(x) if isinstance(x, str) else x) for x in arg["list"])

	client.start_batch()
	for category_name in categories:
		# find category id from name
		if category_name not in maplisten_type:
			continue
		category_id = maplisten_type[category_name]

		for map_id in maps:
			client.unlisten(map_id, category_id)
	client.finish_batch()
	send_ext_listen_status(connection)

def get_entity_name_and_desc(user_id, out):
	entity = get_entity_by_id(user_id, load_from_db=False)
	if entity:
		out['entity_name'] = entity.name
		out['entity_desc'] = entity.desc
		out['entity_pronouns'] = entity.get_tag("who", "pronouns")
	else:
		c = Database.cursor()
		c.execute('SELECT name, desc FROM Entity WHERE id=?', (user_id,))
		result = c.fetchone()
		if result != None:
			out['entity_name'] = result[0]
			out['entity_desc'] = result[1]
			# Would it be worth it to fetch and parse the tags just to get the pronouns for an unloaded entity?

def get_user_profile_data(user_id):
	c = Database.cursor()
	c.execute('SELECT user_id, updated_at, name, text, pronouns, picture_url, birthday, home_location, home_position, interests, looking_for, email, website, contact, extra_fields, flags, more_data FROM User_Profile WHERE user_id=?', (user_id,))
	result = c.fetchone()
	if result == None:
		return None
	else:
		flags = result[15] or 0
		more_data = result[16]
		out = {
			"id": result[0],
			"username": find_username_by_db_id(user_id),
			"name": result[2],
			"text": result[3],
			"pronouns": result[4],
			"picture_url": result[5],
			"birthday": result[6],
			"home": [result[7]] + (loads_if_not_none(result[8]) or []),
			"email": result[11],
			"website": result[12],
			"contact": loads_if_not_none(result[13]),
			"fields": loads_if_not_none(result[14]),
			"looking_for": result[10],
			"interests": result[9],
			"hide_birthday": (flags & 1) != 0,
			"hide_email": (flags & 2) != 0,
			"updated_at": result[1].isoformat() if result[1] != None else None,
		}
		get_entity_name_and_desc(user_id, out)
		return out

@ext_protocol_command("set_user_profile")
def ext_set_user_profile(connection, map, client, context, arg, name):
	if connection.db_id == None:
		connection.send("EXT", {name: False})
		return

	# Create new user if user doesn't already exist
	c = Database.cursor()
	c.execute('SELECT user_id FROM User_Profile WHERE user_id=?', (connection.db_id,))
	if c.fetchone() == None:
		c.execute("INSERT INTO User_Profile (user_id) VALUES (?)", (connection.db_id,))

	data = get_user_profile_data(connection.db_id)
	if data == None:
		data = {
			"name": None,
			"text": None,
			"pronouns": None,
			"picture_url": None,
			"birthday": None,
			"home": None,
			"email": None,
			"website": None,
			"contact": None,
			"fields": None,
			"looking_for": None,
			"interests": None,
			"hide_birthday": False,
			"hide_email": False,
			"extra_fields": None,
		}
	if arg.get('picture_url') and not image_url_is_okay(arg['picture_url']):
		del arg['picture_url']
	if 'entity_desc' in arg:
		client.desc = arg['entity_desc']
	if 'entity_name' in arg and arg['entity_name'] != client.name:
		handle_user_command(client.map, client, context, "nick "+arg['entity_name'])
	if 'entity_pronouns' in arg:
		entity_pronouns = arg['entity_pronouns'][:20]
		if entity_pronouns:
			client.set_tag('who', 'pronouns', entity_pronouns)
		else:
			client.del_tag('who', 'pronouns')

	def fallback(name, c):
		value = arg.get(name, data[name])
		if value != None and isinstance(value, c):
			return value
		return None

	# Update the profile
	home = arg.get("home", data["home"])
	if isinstance(home, list):
		home_location = home[0] if len(home) >= 1 else None
		home_position = home[1:] if len(home) == 3 else None
	flags = int((arg.get('hide_birthday', data['hide_birthday']) * 1) + (arg.get('hide_email', data['hide_email']) * 2))
	values = (datetime.datetime.now(), fallback('name', str), fallback('text', str), fallback('pronouns', str), fallback('picture_url', str), fallback('birthday', str), home_location, dumps_if_not_empty(home_position), fallback('interests', str), fallback('looking_for', str), fallback('email', str), fallback('website', str), dumps_if_not_empty(fallback('contact', list)), dumps_if_not_empty(fallback('fields', list)), flags, connection.db_id)
	c.execute("UPDATE User_Profile SET updated_at=?, name=?, text=?, pronouns=?, picture_url=?, birthday=?, home_location=?, home_position=?, interests=?, looking_for=?, email=?, website=?, contact=?, extra_fields=?, flags=? WHERE user_id=?", values)
	connection.send("EXT", {name: True})

@ext_protocol_command("get_user_profile")
def ext_get_user_profile(connection, map, client, context, arg, name):
	db_id = int_if_numeric(arg['username'])
	if isinstance(db_id, str):
		db_id = find_db_id_by_username(db_id)
	if db_id == None:
		connection.send("EXT", {name: {'username': arg['username'], 'not_found': True}})
		return

	data = get_user_profile_data(db_id)
	if data == None:
		out = {'id': db_id, 'username': arg['username'], 'not_found': True}
		get_entity_name_and_desc(db_id, out)
		connection.send("EXT", {name: out})
		return

	getting_own_profile = db_id == connection.db_id
	if data.get('birthday'):
		try:
			birthday = datetime.datetime.strptime(data['birthday'], '%Y-%m-%d')
			today = datetime.date.today()
			years = today.year - birthday.year
			if today.month < birthday.month or (today.month == birthday.month and today.day < birthday.day):
				years -= 1
			data['age'] = years
		except:
			pass
	if data.get('hide_birthday') and not getting_own_profile:
		data['birthday'] = None
	if data.get('hide_email') and not getting_own_profile:
		data['email'] = None
	if data.get('home'):
		map_id = data['home'][0]
		c = Database.cursor()
		c.execute('SELECT name FROM Entity WHERE id=?', (map_id,))
		result = c.fetchone()
		if result != None:
			data['home_name'] = result[0]

	connection.send("EXT", {name: data})

@ext_protocol_command("delete_user_profile")
def ext_delete_user_profile(connection, map, client, context, arg, name):
	if connection.db_id == None:
		return
	c = Database.cursor()
	c.execute('DELETE FROM User_Profile WHERE user_id=?', (connection.db_id,))
	connection.send("EXT", {name: True})

@ext_protocol_command("user_particle")
def ext_user_particle(connection, map, client, context, arg, name):
	if map == None:
		return
	arg = remove_invalid_dict_fields(arg, {
		"pic":              pic_is_okay,
		"size":             lambda x: is_list_with_two_ints(x) and x[0] >= 1 and x[0] <= 4 and x[1] >= 1 and x[1] <= 4,
		"at":               lambda x: x == "me" or is_list_with_two_ints(x),
		"offset":           lambda x: is_list_with_two_ints(x) and x[0] >= -48 and x[0] <= 48 and x[1] >= -48 and x[1] <= 48,
		"duration":         lambda x: isinstance(x, int) and x >= 1 and x <= 50,
		"anim_loops":       int,
		"anim_frames":      int,
		"anim_speed":       int,
		"anim_mode":        int,
		"anim_offset":      int,
		"hide_me":          bool,
		"action":           lambda x: isinstance(x, str) and x == "play",
	})
	if 'duration' not in arg:
		arg['duration'] = 50 if "anim_loops" in arg else 10
	arg['id'] = client.protocol_id()
	arg['name'] = client.name
	arg['username'] = client.username_or_id()
	map.broadcast("EXT", {name: arg})

@protocol_command()
def fn_EXT(connection, map, client, arg, context):
	actor = client
	if 'rc' in arg:
		actor = find_remote_control_entity(connection, client, arg['rc'], context)
		if actor == None:
			return
		else:
			map = actor.map

	context['actor'] = actor
	for k,v in arg.items():
		if k in ext_handlers:
			context['ext_type'] = k
			ext_handlers[k](connection, map, actor, context, v, k)

# -------------------------------------

def handle_protocol_command(connection, map, client, command, arg, echo, ack_req):
	if ack_req:
		connection.send("ACK", {"key": ack_req, "type": command})
	context = {
		'echo': echo or ack_req,
		'ack_req': ack_req,
		'actor': client,
		'client': client,
	}
	if not isinstance(client, Client) and not connection.username and command not in pre_identify_commands:
		connection.protocol_error(context, text='Protocol command requires identifying first: %s' % command, code='identify')
		return

	# Attempt to run the command handler if it exists
	if command in handlers:
		attach_result_to_context(context, None)

		if command in map_only_commands and (client.map == None or not client.map.is_map()):
			connection.protocol_error(context, text='Protocol command must be done on a map: %s' % command, code='map_only')
		else:
			return handlers[command](connection, map, client, arg, context)
	else:
		connection.protocol_error(context, text='Bad protocol command: %s' % command, code='invalid_command', detail=command)

def protocol_command_already_received(connection, map, client, command, arg, echo, ack_req, ack_result):
	context = {
		'echo': echo or ack_req,
		'ack_req': ack_req,
		'actor': client,
		'client': client,
		'already_received': True,
	}

	# These three types accept "rc" so put this common code here
	actor = client
	if 'rc' in arg:
		actor = find_remote_control_entity(connection, client, arg['rc'], context)
		if actor == None:
			return
		else:
			map = actor.map

	# Send the client some acknowledgement the user can see, that's appropriate for the message type being sent
	if command == "PRI":
		send_private_message(actor, context, arg['username'], arg['text'], acknowledge_only=True)
	elif command == "MSG":
		send_message_to_map(map, actor, arg["text"], context, acknowledge_only=True)
	elif command == "CMD":
		command, arg = separate_first_word(arg["text"])
		if command in ("tell", "p", "msg"):
			username, privtext = separate_first_word(arg)
			send_private_message(client, context, username, privtext, acknowledge_only=True)
		else:
			if ack_result == 'err':
				respond(context, 'Already received /%s (it failed)' % command, error=False)
			elif ack_result == 'ok':
				respond(context, 'Already received /%s (it succeeded)' % command)
			else:
				respond(context, 'Already received /%s' % command)
