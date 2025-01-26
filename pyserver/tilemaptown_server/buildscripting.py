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

import asyncio, json
from .buildglobal import *
from enum import IntEnum
from .buildcommand import handle_user_command, send_private_message

# -----------------------------------------------------------------------------
directions = ((1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1))

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

class ScriptingValueType(IntEnum):
	NIL = 0
	FALSE = 1,
	TRUE = 2,
	INTEGER = 3
	STRING = 4
	JSON = 5
	TABLE = 6

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
	send_private_message(e, (e, None, e), owner.protocol_id(), arg[0])

@script_api()
def fn_runitem(e, arg):
	text = text_from_text_item(arg[0])
	if text:
		self.send_scripting_message(VM_MessageType.RUN_CODE, data=text.encode())
		return True
	return False

@script_api()
def fn_readitem(e, arg):
	return text_from_item(arg[0])

@script_api()
def fn_e_new(e, arg):  #t
	return

@script_api()
def fn_m_who(e, arg):  #
	if e.map != None:
		return e.map.who_contents()

@script_api()
def fn_m_turf(e, arg): #ii
	if e.map != None or e.map.is_map():
		x = arg[0]
		y = arg[1]
		if x >= 0 and y >= 0 and x < e.map.width and y < e.map.height:
			return e.map.turfs[x][y] or e.map.default_turf

@script_api()
def fn_m_objs(e, arg): #ii
	if e.map != None or e.map.is_map():
		x = arg[0]
		y = arg[1]
		if x >= 0 and y >= 0 and x < e.map.width and y < e.map.height:
			return e.map.objs[x][y]

@script_api()
def fn_m_dense(e, arg): #iii
	if e.map != None or e.map.is_map():
		x = arg[0]
		y = arg[1]
		if x >= 0 and y >= 0 and x < e.map.width and y < e.map.height:
			return get_tile_density(self.gadget.map.turfs[x][y]) or any((get_tile_density(o) for o in (self.gadget.map.objs[x][y] or [])))
		else:
			return True

@script_api()
def fn_m_tilelookup(e, arg): #s
	return get_tile_properties(arg[0])

@script_api()
def fn_m_info(e, arg): #
	if e.map != None:
		return e.map.map_info()

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
		return None
	return [e.map.width, e.map.height]

def script_storage_value_cost(value):
	if value == None:
		return 0
	if isinstance(value, str):
		return len(value.encode()) + 1
	return None # Unsupported

def script_storage_item_cost(key, value):
	value_cost = script_storage_value_cost(key, value)
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
	return e.script_data.get(arg[0])

@script_api()
def fn_s_save(e, arg): #s.
	key       = arg[0]
	new_value = arg[1]

	if new_value == None:
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
		return True

@script_api()
def fn_s_list(e, arg): #s
	if len(arg) == 0:
		return list(e.script_data.keys())
	else:
		return [_ for _ in e.script_data.keys() if _.startswith(arg[0])]

@script_api()
def fn_e_who(e, arg): #E
	e2 = find_entity(arg[0])
	if e2:
		return e2.who()

@script_api()
def fn_e_xy(e, arg): #E
	e2 = find_entity(arg[0])
	if e2:
		return [e2.x, e2.y]

@script_api()
def fn_e_move(e, arg): #Eiii
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['move']):
		from_x = e2.x
		from_y = e2.y
		new_x = arg[0]
		new_y = arg[1]
		e2.move_to(new_x, new_y, new_dir=arg[2] if len(arg) == 3 else None)
		e2.map.broadcast("MOV", {'id': e2.protocol_id(), 'from': [from_x, from_y], 'to': [new_x, new_y], 'dir': e2.dir}, remote_category=maplisten_type['move'])

@script_api()
def fn_e_turn(e, arg): #Ei
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['move']):
		e2.move_to(e2.x, e2.y, new_dir=arg[0])
		e2.map.broadcast("MOV", {'id': e2.protocol_id(), 'dir': e2.dir}, remote_category=maplisten_type['move'])

@script_api()
def fn_e_step(e, arg): #Ei
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['move']):
		from_x = e2.x
		from_y = e2.y
		new_x = from_x + directions[arg[1]][0]
		new_y = from_y + directions[arg[1]][1]
		if e2.map and new_x >= 0 and new_y >= 0 and new_x < e2.map.width and new_y < e2.map.height and (not get_tile_density(e2.map.turfs[x][y]) and not any((get_tile_density(o) for o in (e2.map.objs[x][y] or [])))):
			e2.move_to(new_x, new_y, new_dir=arg[1])
			e2.map.broadcast("MOV", {'id': e2.protocol_id(), 'from': [from_x, from_y], 'to': [new_x, new_y], 'dir': e2.dir}, remote_category=maplisten_type['move'])

@script_api()
def fn_e_fly(e, arg): #Ei
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['move']):
		from_x = e2.x
		from_y = e2.y
		new_x = from_x + directions[arg[1]][0]
		new_y = from_y + directions[arg[1]][1]
		e2.move_to(new_x, new_y, new_dir=arg[1])
		e2.map.broadcast("MOV", {'id': e2.protocol_id(), 'from': [from_x, from_y], 'to': [new_x, new_y], 'dir': e2.dir}, remote_category=maplisten_type['move'])

@script_api()
def fn_e_say(e, arg): #Es
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['remote_command']):
		handle_user_command(e2.map, e2, e, None, "say "+arg[1], script_entity=e)

@script_api()
def fn_e_cmd(e, arg): #Es
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['remote_command']):
		handle_user_command(e2.map, e2, e, None, arg[1], script_entity=e)

@script_api()
def fn_e_tell(e, arg): #EIs
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['remote_command']):
		send_private_message(e2, (e, None, e), arg[1], arg[2])

@script_api()
def fn_e_typing(e, arg): #Eb
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['modify_appearance']):
		if e2.map == None:
			return
		e2.map.broadcast("WHO", {"update": {"id": e2.protocol_id(), "typing": arg[1]}})

@script_api()
def fn_e_set(e, arg): #Et
	e2 = find_entity(arg[0])
	if e.has_permission(e2, perm=permission['modify_properties']):
		p = arg[1]

@script_api()
def fn_e_clone(e, arg): #Et
	e2 = find_entity(arg[0])
	return

@script_api()
def fn_e_delete(e, arg): #E
	e2 = find_entity(arg[0])
	return

@script_api()
def fn_e_isloaded(e, arg): #E
	return find_entity(arg[0]) != None

@script_api()
def fn_e_havepermission(e, arg): #Es
	if arg[1] not in permission:
		return None
	return e.has_permission(arg[0], perm=0, default=False)

# -----------------------------------------------------------------------------

def encode_scripting_message_values(values):
	b = bytes()
	for x in values:
		if x == None:
			b += bytes([ScriptingValueType.NIL])
		elif x == True:
			b += bytes([ScriptingValueType.TRUE])
		elif x == False:
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
		else:
			print("Unknown scripting message value: %s" % t)
			break
	return values

def create_scripting_message(type, user_id=0, entity_id=0, other_id=0, status=0, data=None):
	return type.to_bytes(1, byteorder='little', signed=False) \
	+ (len(data) if data else 0).to_bytes(3, byteorder='little', signed=False) \
	+ user_id.to_bytes(4, byteorder='little', signed=False) \
	+ entity_id.to_bytes(4, byteorder='little', signed=False) \
	+ other_id.to_bytes(4, byteorder='little', signed=False) \
	+ status.to_bytes(1, byteorder='little', signed=False) \
	+ (data or bytes(0))

def send_scripting_message(type, user_id=0, entity_id=0, other_id=0, status=0, data=None):
	print("SENDING", create_scripting_message(type, user_id, entity_id, other_id, status, data))
	scripting_service_proc.stdin.write(create_scripting_message(type, user_id, entity_id, other_id, status, data))

# -----------------------------------------------------------------------------

def find_entity(e):
	if isinstance(e, str):
		if valid_id_format(e):
			return get_entity_by_id(e, load_from_db=False)
		return None
	if e > 0:
		return AllEntitiesByDB.get(e)
	return AllEntitiesByID.get(-e)

async def run_scripting_service():
	global scripting_service_proc

	print("Running scripting service")
	scripting_service_proc = await asyncio.create_subprocess_exec(Config["Scripting"]["ProgramPath"], stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
	print(scripting_service_proc)

	quit = False
	while not quit:
		type_and_size = await scripting_service_proc.stdout.read(4)
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
					continue
				if values[0] in script_api_handlers:
					out = script_api_handlers[values[0]](e, values[1:])
					if message_type == VM_MessageType.API_CALL_GET:
						if out == None:
							out = []
						if not isinstance(out, list):
							out = [out]
						send_scripting_message(VM_MessageType.API_CALL_GET, user_id=user_id, entity_id=entity_id, other_id=other_id, status=len(out), data=encode_scripting_message_values(out))
				else:
					print("Unimplemented API call: "+values[0])
			elif message_type == VM_MessageType.SET_CALLBACK:
				e = find_entity(entity_id)
				if e.entity_type == entity_type['gadget'] and other_id >= 0 and other_id < ScriptingCallbackType.COUNT:
					if other_id == ScriptingCallbackType.MAP_CHAT:
						e.listening_to_chat = bool(status)
						e.listening_to_chat_warning = e.listening_to_chat_warning or e.listening_to_chat
					e.script_callback_enabled[other_id] = bool(status)
			elif message_type == VM_MessageType.PING:
				send_scripting_message(VM_MessageType.PONG, user_id=user_id, entity_id=entity_id, other_id=other_id, status=status, data=None)
			elif message_type == VM_MessageType.SCRIPT_ERROR:
				e = find_entity(entity_id)
				if not e:
					continue
				owner = find_owner(e)
				if owner != None:
					if status == 1:
						owner.send("ERR", {'text': 'Script failed to load: %s' % data.decode()})
					else:
						owner.send("ERR", {'text': 'Script error: %s' % data.decode()})
		except Exception as e:
			print("Exception thrown")
			print(e)
		#print(message_type, user_id, entity_id, other_id, status, data)
		#print(type_and_size + rest_of_message)

	# Wait for the subprocess exit.
	await scripting_service_proc.wait()

def shutdown_scripting_service():
	send_scripting_message(VM_MessageType.SHUTDOWN)
