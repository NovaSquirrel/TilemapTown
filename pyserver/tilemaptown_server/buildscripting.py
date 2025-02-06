# Tilemap Town
# Copyright (C) 2025 NovaSquirrel
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

import asyncio, json, traceback
from .buildglobal import *
from enum import IntEnum
from .buildcommand import handle_user_command, send_private_message, send_message_to_map

# -----------------------------------------------------------------------------
directions = ((1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1))
SCRIPT_DEBUG_PRINTS = False

class VM_MessageType(IntEnum):
	PING = 0
	PONG = 1
	VERSION_CHECK = 2
	SHUTDOWN = 3
	START_SCRIPT = 4
	RUN_CODE = 5
	STOP_SCRIPT = 6
	API_CALL = 7
	API_CALL_GET = 8
	CALLBACK = 9
	SET_CALLBACK = 10
	SCRIPT_ERROR = 11
	STATUS_QUERY = 12

class ScriptingValueType(IntEnum):
	NIL = 0
	FALSE = 1,
	TRUE = 2,
	INTEGER = 3
	STRING = 4
	JSON = 5
	TABLE = 6
	MINI_TILEMAP = 7

class ScriptingCallbackType(IntEnum):
	MISC_SHUTDOWN = 0
	MAP_JOIN = 1
	MAP_LEAVE = 2
	MAP_CHAT = 3
	MAP_BUMP = 4
	SELF_PRIVATE_MESSAGE = 5
	SELF_GOT_PERMISSION = 6
	SELF_TOOK_CONTROLS = 7
	SELF_KEY_PRESS = 8
	SELF_CLICK = 9
	SELF_BOT_COMMAND_BUTTON = 10
	SELF_REQUEST_RECEIVED = 11
	SELF_USE = 12
	SELF_SWITCH_MAP = 13
	COUNT = 14

# -----------------------------------------------------------------------------

def find_owner(entity):
	return AllEntitiesByDB.get(entity.owner_id)

def same_owner_gadget(actor, target):
	return actor is target or (target.entity_type == entity_type['gadget'] and (actor.owner_id == target.owner_id or (actor.db_id == target.owner_id and actor.db_id != None)))

script_api_handlers = {}
def script_api():
	def decorator(f):
		command_name = f.__name__[3:]
		script_api_handlers[command_name] = f
	return decorator

@script_api()
def fn_ownersay(e, arg):
	owner = find_owner(e)
	if owner == None:
		return
	send_private_message(e, (e, None, e), owner.protocol_id(), arg[0], lenient_rate_limit=True)

@script_api()
def fn_runitem(e, arg):
	text = text_from_text_item(arg[0])
	if text:
		send_scripting_message(VM_MessageType.RUN_CODE, user_id=e.owner_id, entity_id=e.db_id if e.db_id else -e.id, data=text.encode())
		return True
	return False

@script_api()
def fn_readitem(e, arg):
	return text_from_text_item(arg[0])

@script_api()
def fn_stopscript(e, arg):
	if e.entity_type == entity_type['gadget']:
		e.stop_scripts()

@script_api()
def fn_e_new(e, arg):  #t
	return

@script_api()
def fn_m_who(e, arg):  #
	if e.map != None:
		return e.map.who_contents()
	else:
		return None

@script_api()
def fn_m_turf(e, arg): #ii
	if e.map != None or e.map.is_map():
		x = arg[0]
		y = arg[1]
		if x >= 0 and y >= 0 and x < e.map.width and y < e.map.height:
			return [e.map.turfs[x][y] or e.map.default_turf]
	else:
		return None

@script_api()
def fn_m_objs(e, arg): #ii
	if e.map != None or e.map.is_map():
		x = arg[0]
		y = arg[1]
		if x >= 0 and y >= 0 and x < e.map.width and y < e.map.height:
			return [e.map.objs[x][y]]
	else:
		return None

@script_api()
def fn_m_dense(e, arg): #iii
	if e.map != None or e.map.is_map():
		x = arg[0]
		y = arg[1]
		if x >= 0 and y >= 0 and x < e.map.width and y < e.map.height:
			return [get_tile_density(self.gadget.map.turfs[x][y]) or any((get_tile_density(o) for o in (self.gadget.map.objs[x][y] or [])))]
		else:
			return True
	else:
		return None

@script_api()
def fn_m_tilelookup(e, arg): #s
	return get_tile_properties(arg[0])

@script_api()
def fn_m_info(e, arg): #
	if e.map != None and hasattr(e.map, "map_info"):
		return e.map.map_info()
	else:
		return None

@script_api()
def fn_m_within(e, arg): #ii
	if e.map == None or not e.map.is_map():
		return False
	x = arg[0]
	y = arg[1]
	return x >= 0 and y >= 0 and x < e.map.width and y < e.map.height

@script_api()
def fn_m_size(e, arg): #
	if e.map == None or not e.map.is_map():
		return [None, None]
	return [e.map.width, e.map.height]

def script_storage_value_cost(value):
	if value == None:
		return 0
	if isinstance(value, str):
		return len(value.encode()) + 1
	return None # Unsupported

def script_storage_item_cost(key, value):
	value_cost = script_storage_value_cost(value)
	if value_cost == None:
		return None
	key_cost = len(key.encode())
	return key_cost + value_cost

@script_api()
def fn_s_reset(e, arg): #s
	if len(arg) == 0:
		old_size = len(e.script_data)
		e.script_data.clear()
		e.script_data_size = 0
		return old_size
	else:
		remove_me = [_ for _ in e.script_data.keys() if _.startswith(arg[0])]
		for k in remove_me:
			e.script_data_size -= script_storage_item_cost(k, e.script_data[k])
			del e.script_data[k]
		if e.script_data_size < 0:
			e.script_data_size = 0
		return len(remove_me)

@script_api()
def fn_s_load(e, arg): #s
	return e.script_data.get(arg[0]) or ""

@script_api()
def fn_s_save(e, arg): #s.
	key       = arg[0]
	new_value = arg[1]

	if new_value == None or new_value == "":
		if key in e.script_data:
			e.script_data_size -= script_storage_item_cost(key, e.script_data[key])
			del e.script_data[key]
		return True
	else:
		new_cost = script_storage_item_cost(key, new_value)
		previous_cost = 0
		if key in e.script_data:
			previous_cost = script_storage_item_cost(key, e.script_data[key])
		if (e.script_data_size - previous_cost + new_cost) >= Config["Scripting"]["DataStorageLimit"]:
			return False
		e.script_data[key] = new_value
		e.script_data_size = e.script_data_size - previous_cost + new_cost
		if e.script_data_size < 0:
			e.script_data_size = 0
		e.save_on_clean_up = True
		return True

@script_api()
def fn_es_load(e, arg): #Es
	e2 = find_entity(arg[0])
	if e2 and same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['remote_command']):
		return script_api_handlers["s_load"](e2, arg[1:])
	else:
		return None

@script_api()
def fn_es_save(e, arg): #Es$
	e2 = find_entity(arg[0])
	if e2 and same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['remote_command']):
		return script_api_handlers["s_save"](e2, arg[1:])
	else:
		return None

@script_api()
def fn_s_list(e, arg): #s
	if len(arg) == 0:
		return [list(e.script_data.keys())]
	else:
		return [[_ for _ in e.script_data.keys() if _.startswith(arg[0])]]

@script_api()
def fn_s_count(e, arg): #s
	if len(arg) == 0:
		return [len(e.script_data.keys())]
	else:
		count = 0
		for _ in e.script_data.keys():
			if _.startswith(arg[0]):
				count += 1
		return count

@script_api()
def fn_e_who(e, arg): #E
	e2 = find_entity(arg[0])
	if e2:
		return e2.who()
	else:
		return None

@script_api()
def fn_e_xy(e, arg): #E
	e2 = find_entity(arg[0])
	if e2:
		return [e2.x, e2.y]
	else:
		return [None, None]

@script_api()
def fn_e_mapid(e, arg): #E
	e2 = find_entity(arg[0])
	if e2:
		if e2.is_client() and \
			((e2.connection_attr('user_flags') & userflag['hide_location'] != 0) or (e2.map and e2.map.is_map() and (e2.map.map_flags & mapflag['public'] == 0))):
			return None
		return e2.map_id
	else:
		return None

@script_api()
def fn_e_here(e, arg): #
	if e.map:
		return e.map.protocol_id()
	else:
		return None

@script_api()
def fn_e_move(e, arg): #Eiii
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['move']):
		from_x = e2.x
		from_y = e2.y
		new_x = arg[0]
		new_y = arg[1]
		e2.move_to(new_x, new_y, new_dir=arg[2] if len(arg) == 3 else None)
		e2.map.broadcast("MOV", {'id': e2.protocol_id(), 'from': [from_x, from_y], 'to': [new_x, new_y], 'dir': e2.dir}, remote_category=maplisten_type['move'])

@script_api()
def fn_e_turn(e, arg): #Ei
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['move']):
		e2.move_to(e2.x, e2.y, new_dir=arg[0])
		e2.map.broadcast("MOV", {'id': e2.protocol_id(), 'dir': e2.dir}, remote_category=maplisten_type['move'])

@script_api()
def fn_e_step(e, arg): #Ei
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['move']):
		from_x = e2.x
		from_y = e2.y
		new_x = from_x + directions[arg[1]][0]
		new_y = from_y + directions[arg[1]][1]
		if e2.map and (not e2.map.is_map() or (new_x >= 0 and new_y >= 0 and new_x < e2.map.width and new_y < e2.map.height and (not get_tile_density(e2.map.turfs[new_x][new_y]) and not any((get_tile_density(o) for o in (e2.map.objs[new_x][new_y] or [])))))):
			e2.move_to(new_x, new_y, new_dir=arg[1])
			e2.map.broadcast("MOV", {'id': e2.protocol_id(), 'from': [from_x, from_y], 'to': [new_x, new_y], 'dir': e2.dir}, remote_category=maplisten_type['move'])

@script_api()
def fn_e_fly(e, arg): #Ei
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['move']):
		from_x = e2.x
		from_y = e2.y
		new_x = from_x + directions[arg[1]][0]
		new_y = from_y + directions[arg[1]][1]
		e2.move_to(new_x, new_y, new_dir=arg[1])
		e2.map.broadcast("MOV", {'id': e2.protocol_id(), 'from': [from_x, from_y], 'to': [new_x, new_y], 'dir': e2.dir}, remote_category=maplisten_type['move'])

@script_api()
def fn_e_say(e, arg): #Es
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['remote_command']):
		handle_user_command(e2.map, e2, e, None, "say "+arg[1], script_entity=e)

@script_api()
def fn_e_cmd(e, arg): #Es
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['remote_command']):
		handle_user_command(e2.map, e2, e, None, arg[1], script_entity=e)

@script_api()
def fn_e_tell(e, arg): #EIs
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['remote_command']):
		send_private_message(e2, (e, None, e), arg[1], arg[2])

@script_api()
def fn_e_botmessagebutton(e, arg): #EIs
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['remote_command']):
		e3 = find_entity(arg[1])
		if e3 == None:
			return
		bmb_arg = {
			'text': arg[2],
			'id': e2.protocol_id(),
			'name': e2.name,
			'username': e2.username_or_id(),
			'rc_id': e.owner_id,
			'gadget_id': e.gadget.protocol_id(),
		}
		if e3.entity_type == entity_type['gadget']:
			e3.receive_bot_message_button(client, bmb_arg)
		else:
			e3.send("EXT", {'bot_message_button': bmb_arg})

@script_api()
def fn_e_typing(e, arg): #Eb
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['modify_appearance']):
		if e2.map == None:
			return
		e2.map.broadcast("WHO", {"update": {"id": e2.protocol_id(), "typing": arg[1]}})

@script_api()
def fn_e_set(e, arg): #Et
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['modify_properties']):
		p = arg[1]

@script_api()
def fn_e_minitilemap(e, arg): #Et
	entity_id, tile_sheet_url, visible, clickable, transparent_tile, tile_width, tile_height, offset_x, offset_y, map = arg
	map_width, map_height, map_data = map

	e2 = find_entity(arg[0])
	if e2 == None:
		return
	if same_owner_gadget(e, e2) or e.has_permission(e2, perm=permission['modify_appearance']):
		if not tile_sheet_url.startswith("https://") and not tile_sheet_url.startswith("http://"):
			tile_sheet_url = Config["Server"]["ResourceIMGBase"] + "mini_tilemap/" + tile_sheet_url

		mini_tilemap = GlobalData['who_mini_tilemap']({
			"visible": visible,
			"clickable": clickable,
			"map_size": [map_width, map_height],
			"tile_size": [tile_width, tile_height],
			"offset": [offset_x, offset_y],
			"transparent_tile": transparent_tile,
			"tileset_url": tile_sheet_url,
		})
		mini_tilemap_data = GlobalData['who_mini_tilemap_data']({
			"data": map_data
		})

		out = {}
		if not hasattr(e2, "mini_tilemap") or e2.mini_tilemap != mini_tilemap:
			e2.mini_tilemap = mini_tilemap
			out['mini_tilemap'] = mini_tilemap
		if not hasattr(e2, "mini_tilemap_data") or e2.mini_tilemap_data != mini_tilemap_data:
			e2.mini_tilemap_data = mini_tilemap_data
			out['mini_tilemap_data'] = mini_tilemap_data
		if e2.map == None:
			return
		if out == {}:
			return
		out["id"] = e2.protocol_id()
		e2.map.broadcast("WHO", {"update": out})

@script_api()
def fn_e_clone(e, arg): #Et
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	return

@script_api()
def fn_e_delete(e, arg): #E
	e2 = find_entity(arg[0])
	if e2 == None:
		return
	return

@script_api()
def fn_e_isloaded(e, arg): #E
	return find_entity(arg[0]) != None

@script_api()
def fn_e_havepermission(e, arg): #Es
	if arg[1] not in permission:
		return None
	return e.has_permission(arg[0], perm=0, default=False)

@script_api()
def fn_e_havecontrolsfor(e, arg): #EI
	e2 = find_entity(arg[0])
	if e2 is not e:
		return False
	return find_entity(arg[1]) in e.have_controls_for

@script_api()
def fn_e_havecontrolslist(e, arg): #E
	e2 = find_entity(arg[0])
	if e2 is not e:
		return None
	return [[x.protocol_id() for x in e.have_controls_for]]

@script_api()
def fn_e_takecontrols(e, arg): #EIsbb
	e2 = find_entity(arg[0])
	if e is not e2: # For now, limit it to the script taking controls for itself, not on behalf of something else
		return
	client = find_client_by_username(arg[1])
	if client == None:
		return
	if e2.has_permission(client, permission['minigame']):
		e.take_controls(client, arg[2], pass_on=arg[3], key_up=arg[4])
	else:
		# Save the details about the request for later
		e.want_controls_for.add(client)
		e.want_controls_key_set = arg[2]
		e.want_controls_pass_on = arg[3]
		e.want_controls_key_up  = arg[4]
		handle_user_command(e2.map, e2, e, None, "requestpermission %s minigame" % client.protocol_id(), script_entity=e)

@script_api()
def fn_e_releasecontrols(e, arg): #EI
	e2 = find_entity(arg[0])
	if e is not e2: # For now, limit it to the script taking controls for itself, not on behalf of something else
		return
	client = find_client_by_username(arg[1])
	if client == None:
		return
	e.release_controls(client)

@script_api()
def fn_releasecontrols(e, arg): #EI
	e.release_all_controls()

# -----------------------------------------------------------------------------

def encode_scripting_message_values(values):
	b = bytes()
	for x in values:
		if x == None:
			b += bytes([ScriptingValueType.NIL])
		elif isinstance(x, bool) and x == True:
			b += bytes([ScriptingValueType.TRUE])
		elif isinstance(x, bool) and x == False:
			b += bytes([ScriptingValueType.FALSE])
		elif isinstance(x, int):
			b += bytes([ScriptingValueType.INTEGER]) + x.to_bytes(4, byteorder='little')
		elif isinstance(x, str):
			d = x.encode()
			b += bytes([ScriptingValueType.STRING]) + len(d).to_bytes(4, byteorder='little') + d
		else:
			d = json.dumps(x).encode()
			b += bytes([ScriptingValueType.JSON]) + len(d).to_bytes(4, byteorder='little') + d
	return b

def decode_scripting_message_values(b):
	values = []
	i = 0
	while i < len(b):
		t = b[i]
		i += 1
		if t == ScriptingValueType.NIL:
			values.append(None)
		elif t == ScriptingValueType.FALSE:
			values.append(False)
		elif t == ScriptingValueType.TRUE:
			values.append(True)
		elif t == ScriptingValueType.INTEGER:
			values.append(int.from_bytes(b[i:i+4], byteorder='little', signed=True))
			i += 4
		elif t == ScriptingValueType.STRING:
			size = int.from_bytes(b[i:i+4], byteorder='little')
			i += 4
			values.append(b[i:i+size].decode())
			i += size
		elif t == ScriptingValueType.JSON:
			size = int.from_bytes(b[i:i+4], byteorder='little')
			i += 4
			values.append(json.loads(b[i:i+size]).decode())
			i += size
		elif t == ScriptingValueType.MINI_TILEMAP:
			width  = b[i+0]
			height = b[i+1]
			i += 2
			length = int.from_bytes(b[i:i+2], byteorder='little', signed=False)
			i += 2
			map = []
			for j in range(length):
				map.append(int.from_bytes(b[i:i+4], byteorder='little', signed=False))
				i += 4
			values.append((width, height, map))
		else:
			print("Unknown scripting message value: %s" % t)
			break
	return values

def create_scripting_message(type, user_id=0, entity_id=0, other_id=0, status=0, data=None):
	return type.to_bytes(1, byteorder='little', signed=False) \
	+ (len(data) if data else 0).to_bytes(3, byteorder='little', signed=False) \
	+ user_id.to_bytes(4, byteorder='little', signed=True) \
	+ entity_id.to_bytes(4, byteorder='little', signed=True) \
	+ other_id.to_bytes(4, byteorder='little', signed=True) \
	+ status.to_bytes(1, byteorder='little', signed=False) \
	+ (data or bytes(0))

def send_scripting_message(type, user_id=0, entity_id=0, other_id=0, status=0, data=None):
	if scripting_service_proc == None:
		return
	if SCRIPT_DEBUG_PRINTS:
		print("SENDING", create_scripting_message(type, user_id, entity_id, other_id, status, data))
	scripting_service_proc.stdin.write(create_scripting_message(type, user_id, entity_id, other_id, status, data))

# -----------------------------------------------------------------------------

def find_owner_by_db_id(db_id):
	c = Database.cursor()
	c.execute('SELECT owner_id FROM Entity WHERE entity_id=?', (id,))
	result = c.fetchone()
	if result:
		return result[0]
	return None

def find_entity(e):
	if isinstance(e, str):
		if valid_id_format(e):
			return get_entity_by_id(e, load_from_db=False)
		return None
	if e > 0:
		return AllEntitiesByDB.get(e)
	return AllEntitiesByID.get(-e)

scripting_service_proc = None
async def run_scripting_service():
	global scripting_service_proc, GlobalData
	GlobalData['request_script_status'] = request_script_status # Try to work around a circular dependency
	GlobalData['shutdown_scripting_service'] = shutdown_scripting_service

	print("Running scripting service")
	scripting_service_proc = await asyncio.create_subprocess_exec(Config["Scripting"]["ProgramPath"], stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
	print(scripting_service_proc)

	quit = False
	while not quit:
		type_and_size = await scripting_service_proc.stdout.read(4)
		if len(type_and_size) == 0:
			break
		message_type = type_and_size[0]
		data_size = int.from_bytes(type_and_size[1:], byteorder='little')
		rest_of_message = await scripting_service_proc.stdout.read((4*3+1) + data_size)
		user_id   = int.from_bytes(rest_of_message[0:4], byteorder='little', signed=True)
		entity_id = int.from_bytes(rest_of_message[4:8], byteorder='little', signed=True)
		other_id  = int.from_bytes(rest_of_message[8:12], byteorder='little', signed=True)
		status    = rest_of_message[12]
		data      = rest_of_message[13:]

		try:
			if message_type == VM_MessageType.API_CALL or message_type == VM_MessageType.API_CALL_GET:
				values = decode_scripting_message_values(data)
				e = find_entity(entity_id)
				if not e:
					e = get_entity_by_id(entity_id, load_from_db=True, do_not_load_scripts=True)
				if not e:
					continue
				if values[0] in script_api_handlers:
					out = script_api_handlers[values[0]](e, values[1:])
					if message_type == VM_MessageType.API_CALL_GET:
						if not isinstance(out, list):
							out = [out]
						send_scripting_message(VM_MessageType.API_CALL_GET, user_id=user_id, entity_id=entity_id, other_id=other_id, status=len(out), data=encode_scripting_message_values(out))
				else:
					print("Unimplemented API call: "+values[0])
				del e
			elif message_type == VM_MessageType.SET_CALLBACK:
				e = find_entity(entity_id)
				if e.entity_type == entity_type['gadget'] and other_id >= 0 and other_id < ScriptingCallbackType.COUNT:
					if other_id == ScriptingCallbackType.MAP_CHAT:
						e.listening_to_chat = bool(status)
						if not e.listening_to_chat_warning and e.map:
							e.map.broadcast("WHO", {"update": {"id": e.protocol_id(), "chat_listener": True}})
						e.listening_to_chat_warning = e.listening_to_chat_warning or e.listening_to_chat
					elif other_id == ScriptingCallbackType.SELF_CLICK:
						e.clickable = bool(status)
						e.map.broadcast("WHO", {"update": {"id": e.protocol_id(), "clickable": bool(status)}})
					e.script_callback_enabled[other_id] = bool(status)
				del e
			elif message_type == VM_MessageType.PING:
				send_scripting_message(VM_MessageType.PONG, user_id=user_id, entity_id=entity_id, other_id=other_id, status=status, data=None)
			elif message_type == VM_MessageType.SCRIPT_ERROR:
				e = find_entity(entity_id)
				if e:
					owner_id = e.owner_id
				else:
					owner_id = find_owner_by_db_id(entity_id)
				if owner_id == None:
					continue
				owner = AllEntitiesByDB.get(owner_id)
				if owner != None:
					if status == 1:
						owner.send("ERR", {'text': 'Script failed to load: %s' % data.decode()})
					else:
						owner.send("ERR", {'text': 'Script error: %s' % data.decode()})
				del e
			elif message_type == VM_MessageType.STATUS_QUERY:
				e = find_entity(other_id)
				if not e:
					continue
				e.send("MSG", {'text': 'Scripting status: %s' % data.decode()})
				del e
		except Exception as e:
			print("Exception thrown from scripting:", sys.exc_info()[0])
			print(sys.exc_info()[1])
			traceback.print_tb(sys.exc_info()[2])
		#print(message_type, user_id, entity_id, other_id, status, data)
		#print(type_and_size + rest_of_message)

	# Wait for the subprocess exit.
	await scripting_service_proc.wait()

def shutdown_scripting_service(user_id=0):
	send_scripting_message(VM_MessageType.SHUTDOWN, user_id=user_id)

def request_script_status(client, arg):
	if arg == "s":
		send_scripting_message(VM_MessageType.STATUS_QUERY, status=1, other_id=client.db_id)
		return
	if len(arg) == 0:
		send_scripting_message(VM_MessageType.STATUS_QUERY, other_id=client.db_id)
		return
	send_scripting_message(VM_MessageType.STATUS_QUERY, user_id=int(arg), other_id=client.db_id)
