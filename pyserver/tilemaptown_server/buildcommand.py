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

import json, random, datetime, time, ipaddress, hashlib, weakref, asyncio
from .buildglobal import *
from .buildentity import Entity, GenericEntity
from .buildmap import Map
from .buildapi import admin_delete_uploaded_file, fix_uploaded_file_sizes, reupload_entity_images, update_image_url_everywhere
from collections import deque

handlers = {}	# dictionary of functions to call for each command
aliases = {}	# dictionary of commands to change to other commands
command_categories = {}	# categories
command_about = {}		# help text (description of the command)
command_syntax = {}     # help text (syntax only)
command_privilege_level = {} # minimum required privilege level required for the command; see user_privilege in buildglobal.py
map_only_commands = set()
no_entity_needed_commands = set()
next_request_id = 1

# Adds a command handler
def cmd_command(alias=[], category="Miscellaneous", hidden=False, about=None, syntax=None, privilege_level='guest', map_only=False, no_entity_needed=False):
	def decorator(f):
		command_name = f.__name__[3:]
		handlers[command_name] = f
		if not hidden and privilege_level != 'admin':
			if category not in command_categories:
				command_categories[category] = set()
			command_categories[category].add(command_name)
		if about:
			command_about[command_name] = about
		if syntax:
			command_syntax[command_name] = syntax
		for a in alias:
			aliases[a] = command_name
		if map_only:
			map_only_commands.add(command_name)
		if no_entity_needed:
			no_entity_needed_commands.add(command_name)
		command_privilege_level[command_name] = user_privilege[privilege_level]
	return decorator

# -------------------------------------

# Filtering chat text
def find_entity_name(id):
	c = Database.cursor()
	c.execute('SELECT name FROM Entity WHERE id=?', (id,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def sql_exists(query, data):
	c = Database.cursor()
	c.execute('SELECT EXISTS(%s)' % query, data)
	result = c.fetchone()
	return bool(result[0])

def is_entity_owner(id, client):
	""" Note that id is a string here """
	if not id.isdecimal() or not client.username:
		return False
	if client.oper_override:
		return True
	return sql_exists('SELECT owner_id FROM Entity WHERE id=? AND owner_id=?', (int(id), client.db_id))

def separate_first_word(text, lowercaseFirst=True):
	space = text.find(" ")
	command = text
	arg = ""
	if space >= 0:
		command = text[0:space]
		arg = text[space+1:]
	if lowercaseFirst:
		command = command.lower()
	return (command, arg)

def failed_to_find(context, username):
	if username == None or len(username) == 0:
		respond(context, 'No name given', error=True)
	else:
		respond(context, '"'+username+'" not found', error=True)

def in_blocked_username_list(client, banlist, action):
	# Use the player, instead of whatever entity they're acting through
	if not client.is_client():
		if '!objects' in banlist:
			client.send("ERR", {'text': 'Only clients may %s' % action, 'code': 'clients_only'})
			return True
		username = find_username_by_db_id(client.owner_id)
		if username != None and username in banlist:
			return True
		return False
	username = client.username
	if username == None and '!guests' in banlist:
		client.send("ERR", {'text': 'Guests may not %s' % action, 'code': 'no_guests', 'detail': action})
		return True
	if username in banlist:
		client.send("ERR", {'text': 'You may not %s' % action, 'code': 'blocked', 'detail': action})
		return True
	return False

def respond(context, text, data=None, error=False, code=None, detail=None, subject_id=None, buttons=None, class_type=None):
	args = {}
	client = context['client']
	if client == None:
		return
	echo = context.get('echo')

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
	if buttons:
		args['buttons'] = buttons
	if class_type:
		args['class'] = class_type
	client.send('ERR' if error else 'CMD', args)
	if not context.get('already_received'):
		if error:
			attach_result_to_context(context, 'err')
		else:
			attach_result_to_context(context, 'ok')

def parse_equal_list(text):
	return (x.split('=') for x in text.split())

entity_types_users_can_change_data_for = ('text', 'image', 'map_tile', 'tileset', 'landmark', 'gadget')
def data_disallowed_for_entity_type(type, data):
	if entity_type_name[type] not in entity_types_users_can_change_data_for:
		return 'Not a valid type to change data for'
	if type == entity_type['gadget']:
		if not isinstance(data, list):
			return 'Invalid gadget data'
		for step in data:
			if not isinstance(step, list) or len(step) != 2 or not isinstance(step[0], str):
				return 'Invalid gadget step'
	if type == entity_type['image'] and not image_url_is_okay(data):
		return 'Image asset URL doesn\'t match any allowlisted sites'
	if type == entity_type['map_tile']:
		tile_ok, tile_reason = tile_is_okay(data, parse_json=True)
		if not tile_ok:
			return 'Tile [tt]%s[/tt] rejected (%s)' % (data, tile_reason)
	return None

def tile_is_okay(tile, parse_json=False):
	if type(tile) == str:
		if not len(tile):
			return (False, 'Empty string')
		if tile.strip() != tile:
			return (False, '')

		# Sometimes it's a string containing JSON 
		if tile[0] == '{':
			if parse_json:
				tile = json.loads(tile)
			else:
				return (False, 'JSON string')

		# Strings that aren't JSON refer to tiles in tilesets and are
		# definitely OK as long as they're not excessively long.
		elif len(tile) <= 32:
			return (True, None)
		else:
			return (False, 'Identifier too long')

	# If it's not a string it must be a dictionary
	if type(tile) != dict:
		return (False, 'Invalid type')

	if "pic" not in tile or len(tile["pic"]) != 3:
		return (False, 'No/invalid picture')
	if not pic_is_okay(tile["pic"]):
		return (False, 'Invalid picture')

	return (True, None)

def load_json_if_valid(j):
	try:
		return json.loads(j)
	except ValueError as err:
		pass
	return None

def find_local_entity_by_name(map, name):
	if map == None:
		return None
	name = name.lower()
	for e in map.contents:
		if str(e.protocol_id()) == name:
			return e
	for e in map.contents:
		if e.name.strip().lower() == name:
			return e
	for e in map.contents:
		if e.name.strip().lower().startswith(name):
			return e
	return None

def attach_result_to_context(context, result):
	ack_req = context['ack_req']
	if not ack_req:
		return
	client = context['client']
	if not client.db_id:
		return
	if client.db_id not in AcknowlegeRequestResult:
		AcknowlegeRequestResult[client.db_id] = deque(maxlen=5)
	for i, value in enumerate(AcknowlegeRequestResult[client.db_id]):
		if value[0] == ack_req:
			AcknowlegeRequestResult[client.db_id][i] = (ack_req, result)
			return
	else:
		AcknowlegeRequestResult[client.db_id].append((ack_req, result))

# -------------------------------------

@cmd_command(category="Settings", syntax="newname", no_entity_needed=True)
def fn_nick(map, client, context, arg):
	arg = arg[:50].replace('\n', '')
	if len(arg) == 0 or arg.isspace():
		return

	if is_entity(client):
		map.broadcast("MSG", {'text': "\""+noparse(client.name)+"\" is now known as \""+noparse(arg)+"\""})
		client.name = arg
		session = client.connection_attr('build_session')
		if session:
			session.name = client.name
		map.broadcast("WHO", {'add': client.who()}, remote_category=maplisten_type['entry']) # update client view

		# If this client is listening to any map's chat, tell any clients listening to changes in the listener list the name has changed
		if client.is_client():
			listening_maps = client.connection_attr('listening_maps')
			if listening_maps:
				for category, map_id in listening_maps:
					if category != maplisten_type['chat']:
						continue
					for other_connection in MapListens[maplisten_type['chat_listen']].get(map_id, tuple()):
						other_connection.send("WHO", {'type': 'chat_listeners', 'add': client.connection_attr('listener_who')(), 'remote_map': map_id})
	elif hasattr(client, 'connection') and client.db_id: # If it's a fake client, just update it in the database
		client.send("MSG", {'text': "\""+noparse(client.name)+"\" is now known as \""+noparse(arg)+"\""})
		client.name = arg
		c = Database.cursor()
		c.execute("UPDATE Entity SET name=? WHERE id=?", (arg, client.db_id))

@cmd_command(category="Settings", syntax="description")
def fn_userdesc(map, client, context, arg):
	client.desc = arg

@cmd_command(category="Settings", syntax="text", no_entity_needed=True, privilege_level="no_scripts")
def fn_client_settings(map, client, context, arg):
	connection = client.connection()
	if connection:
		connection.client_settings = arg

@cmd_command(category="Communication")
def fn_say(map, client, context, arg):
	send_message_to_map(map, client, arg, context)

@cmd_command(category="Communication")
def fn_me(map, client, context, arg):
	if arg == '':
		return
	send_message_to_map(map, client, "/me "+arg, context)

def apply_rate_limiting(client, limit_type, count_limits):
	current_minute = int(time.monotonic() // 60)

	# Increase the counter for the current minute
	if limit_type not in client.rate_limiting:
		client.rate_limiting[limit_type] = deque()
		AllEntitiesWithRateLimiting.add(client)
	for minutes in client.rate_limiting[limit_type]:
		if minutes[0] == current_minute:
			minutes[1] += 1
			break
	else:
		client.rate_limiting[limit_type].append([current_minute, 1])	

	# Check against every limit supplied here
	for limit in count_limits:
		amount_of_minutes, max_count_allowed = limit

		total = 0
		for counts in client.rate_limiting[limit_type]:
			if counts[0] > (current_minute - amount_of_minutes):
				total += counts[1]
		if total > max_count_allowed:
			return True
	return False

def send_message_to_map(map, actor, text, context, acknowledge_only=False):
	if text == '':
		return
	if not acknowledge_only and Config["RateLimit"]["MSG"] and apply_rate_limiting(actor, 'msg', ( (1, Config["RateLimit"]["MSG1"]),(5, Config["RateLimit"]["MSG5"])) ):
		respond_to = context['client']
		if hasattr(respond_to, 'connection') and respond_to.connection():
			respond_to.connection().protocol_error(context, text='You\'re sending too many messages too quickly!')
		return
	if len(text) > Config["MaxProtocolSize"]["Chat"]:
		respond_to = context['client']
		if hasattr(respond_to, 'connection') and respond_to.connection():
			respond_to.connection().protocol_error(context, text='Tried to send chat message that was too big: (%d, max is %d)' % (len(text), Config["MaxProtocolSize"]["Chat"]), code='chat_too_big', detail=Config["MaxProtocolSize"]["Chat"])
		return
	if map == None:
		map = actor.map
	if map:
		fields = {'name': actor.name, 'id': actor.protocol_id(), 'username': actor.username_or_id(), 'text': text}
		if context.get('script_entity'):
			script_entity = context.get('script_entity')
			fields['rc_username'] = find_username_by_db_id(script_entity.owner_id)
			fields['rc_id'] = script_entity.owner_id
		elif context['client'] != None and actor is not context['client']:
			fields['rc_id'] = context['client'].protocol_id()
			fields['rc_username'] = context['client'].username_or_id()
		if acknowledge_only:
			if isinstance(map, int):
				fields['remote_map'] = map
			elif map is not actor.map:
				fields['remote_map'] = map.protocol_id()
			actor.send("MSG", fields)
		else:
			if isinstance(map, int):
				if map not in MapListens[maplisten_type['chat']]:
					return
				fields['remote_map'] = map
				for connection in MapListens[maplisten_type['chat']][map]:
					connection.send('MSG', fields)
				return
			else:
				map.broadcast("MSG", fields, remote_category=maplisten_type['chat'])
				for e in map.contents:
					if e.entity_type == entity_type['gadget'] and hasattr(e, 'listening_to_chat') and e.listening_to_chat and e is not actor and e is not context['client']:
						e.receive_chat(actor, text)

def queue_offline_private_message(client, recipient_db_id, text):
	if recipient_db_id not in OfflineMessages:
		OfflineMessages[recipient_db_id] = {}
	if client.db_id not in OfflineMessages[recipient_db_id]:
		OfflineMessages[recipient_db_id][client.db_id] = []
	queue = OfflineMessages[recipient_db_id][client.db_id]
	if len(queue) >= 10:
		return False
	queue.append((text, datetime.datetime.now(), client.name, client.username_or_id()))
	return True

#respond(context, 'You have too many messages queued up for \"%s\" already' % recipient_username, error=True)

def send_private_message(client, context, recipient_username, text, lenient_rate_limit=False, acknowledge_only=False):
	respond_to = context['client']
	rate_limit_multiplier = 1 + int(lenient_rate_limit)*2
	if not acknowledge_only and Config["RateLimit"]["PRI"] and apply_rate_limiting(client, 'pri', ( (1, Config["RateLimit"]["PRI1"]*rate_limit_multiplier),(5, Config["RateLimit"]["PRI5"]*rate_limit_multiplier)) ):
		if hasattr(respond_to, 'connection') and respond_to.connection():
			respond_to.connection().protocol_error(context, text='You\'re sending too many messages too quickly!')
		return
	if len(text) > Config["MaxProtocolSize"]["Private"]:
		if hasattr(respond_to, 'connection') and respond_to.connection():
			respond_to.connection().protocol_error(context, text='Tried to send private message that was too big: (%d, max is %d)' % (len(text), Config["MaxProtocolSize"]["Private"]), code='private_too_big', detail=Config["MaxProtocolSize"]["Private"])
		return
	if recipient_username != "":
		if text.isspace() or text=="":
			respond(context, 'Tell them what?', error=True)
		else:
			recipient_connection = find_connection_by_username(recipient_username)
			u = None
			if recipient_connection != None:
				u = recipient_connection.entity
			else:
				u = find_client_by_username(recipient_username)

			if u:
				if u.entity_type == entity_type['gadget']:
					client.send("PRI", {'text': text, 'name': u.name, 'id': u.protocol_id(), 'username': u.username_or_id(), 'receive': False})
					if not acknowledge_only:
						u.receive_tell(client, text)
				elif u.is_client() or "PRI" in u.forward_message_types:
					if not u.is_client() or not in_blocked_username_list(client, u.connection_attr('ignore_list'), 'message %s' % u.name):
						client.send("PRI", {'text': text, 'name': u.name, 'id': u.protocol_id(), 'username': u.username_or_id(), 'receive': False})
						recipient_params = {'text': text, 'name': client.name, 'id': client.protocol_id(), 'username': client.username_or_id(), 'receive': True}
						if respond_to is not client:
							recipient_params['rc_username'] = respond_to.username_or_id()
							recipient_params['rc_id'] = respond_to.protocol_id()
						if context.get('script_entity'): # Script entity
							recipient_params['rc_username'] = find_username_by_db_id(context['script_entity'].owner_id)
							recipient_params['rc_id'] = context['script_entity'].owner_id
						if not acknowledge_only:
							if u.is_client() and u.db_id and u.connection_attr('can_acknowledge'):
								queue_offline_private_message(client, u.db_id, text)
								recipient_params['ack_req'] = datetime.datetime.now().isoformat()
							u.send("PRI", recipient_params)
				else:
					respond(context, 'That entity isn\'t a user', error=True)
			else:
				recipient_db_id = find_db_id_by_username(recipient_username)
				if recipient_db_id:
					if not client.db_id:
						respond(context, 'You can\'t send offline messages as a guest', error=True)
						return
					respond_to = context['client']
					if (respond_to is not client) or context.get('script_entity'):
						respond(context, 'You can\'t send offline messages via remote control', error=True)
						return

					c = Database.cursor()
					c.execute('SELECT ignore FROM User WHERE entity_id=?', (recipient_db_id,))
					result = c.fetchone()
					if result != None and (client.username in json.loads(result[0] or "[]")):
						respond(context, 'You can\'t message that person', error=True)
						return False

					if not acknowledge_only:
						if not queue_offline_private_message(client, recipient_db_id, text):
							respond(context, 'You have too many messages queued up for \"%s\" already' % recipient_username, error=True)
							return

					# Notify the sender
					recipient_name = get_entity_name_by_db_id(recipient_db_id) or find_username_by_db_id(recipient_db_id) or "?"
					client.send("PRI", {'text': text, 'name': recipient_name, 'id': recipient_db_id, 'username': find_username_by_db_id(recipient_db_id), 'receive': False, 'offline': True})
					return

				failed_to_find(context, recipient_username)
	else:
		respond(context, 'Private message who?', error=True)

@cmd_command(category="Communication", alias=['msg', 'p'], syntax="username message", no_entity_needed=True)
def fn_tell(map, client, context, arg):
	username, privtext = separate_first_word(arg)
	send_private_message(client, context, username, privtext)

@cmd_command(category="Communication", alias=['oq'], privilege_level="registered", no_entity_needed=True)
def fn_offlinequeue(map, client, context, arg):
	if arg == "":
		return
	recipient_username, arg = separate_first_word(arg)
	recipient_db_id = find_db_id_by_username(recipient_username)
	if recipient_db_id == None:
		failed_to_find(context, recipient_username)
		return
	queue = OfflineMessages.get(recipient_db_id)
	if queue:
		queue = queue.get(client.db_id)
	if queue == None or len(queue) == 0:
		respond(context, 'You don\'t have any messages queued for "%s"' % recipient_username)
		return

	if arg.lower() == "clear":
		count = len(queue)
		del OfflineMessages[recipient_db_id][client.db_id]
		if len(OfflineMessages[recipient_db_id]) == 0:
			del OfflineMessages[recipient_db_id]
		respond(context, 'Cleared %d messages queued for "%s"' % (count, recipient_username))
		return
	respond(context, '%d message%s queued for "%s": [ul]%s[/ul]' % (len(queue), "s" if len(queue) != 1 else "", recipient_username, ''.join(["[li]%s: %s[/li]" % (_[1].strftime("%Y-%m-%d"), _[0]) for _ in queue])))

def send_request_to_user(client, context, arg, request_type, request_data, accept_command, decline_command, you_message, them_message):
	global next_request_id

	# Find the user by name
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return
	my_username = client.protocol_id()
	request_key = (my_username, request_type)

	if request_key in u.requests:
		if u.requests[request_key][2] == request_data:
			# Renew it
			respond(context, 'You\'ve already sent them a request', error=True)
			u.requests[request_key][0] = 600
			return
	if not is_client_and_entity(u) or not in_blocked_username_list(client, u.connection_attr('ignore_list'), 'message %s' % u.name):
		respond(context, you_message % arg)

		u.requests[request_key] = [600 if u.is_client() else 60, next_request_id, request_data]
		AllEntitiesWithRequests.add(u)

		if u.entity_type == entity_type['gadget']:
			u.receive_request(client, request_type, request_data, accept_command, decline_command)
		else:
			u.send("MSG", {'text': them_message % client.name_and_username(), 'buttons': ['Accept', '%s %s %s %d' % (accept_command, my_username, request_type, next_request_id), 'Decline', '%s %s %s %d' % (decline_command, my_username, request_type, next_request_id)]})
		next_request_id += 1

@cmd_command(category="Follow", syntax="username")
def fn_carry(map, client, context, arg):
	send_request_to_user(client, context, arg, "carry", None, "tpaccept", "tpdeny", "You requested to carry %s", "%s wants to carry you")

@cmd_command(category="Follow", syntax="username")
def fn_followme(map, client, context, arg):
	send_request_to_user(client, context, arg, "followme", None, "tpaccept", "tpdeny", "You requested to have %s follow you", "%s wants you to follow them")

@cmd_command(category="Follow", syntax="username", alias=['followmemap'])
def fn_followmap(map, client, context, arg):
	send_request_to_user(client, context, arg, "followmap", None, "tpaccept", "tpdeny", "You requested to have %s follow you onto other maps", "%s wants you to follow them onto other maps")

@cmd_command(category="Follow", syntax="username", alias=['uppies'])
def fn_carryme(map, client, context, arg):
	send_request_to_user(client, context, arg, "carryme", None, "tpaccept", "tpdeny", "You requested to have %s carry you", "%s wants you to carry them")

@cmd_command(category="Follow", syntax="username")
def fn_followyou(map, client, context, arg):
	send_request_to_user(client, context, arg, "followyou", None, "tpaccept", "tpdeny", "You requested to follow %s", "%s wants to follow behind you")

@cmd_command(category="Follow", syntax="username")
def fn_followyoumap(map, client, context, arg):
	send_request_to_user(client, context, arg, "followyoumap", None, "tpaccept", "tpdeny", "You requested to have %s bring you to other maps", "%s wants to follow you onto other maps")

@cmd_command(category="Follow", syntax="username")
def fn_syncmove(map, client, context, arg):
	send_request_to_user(client, context, arg, "syncmove", None, "tpaccept", "tpdeny", "You requested to synchronize movement with %s", "%s wants to synchronize movement with you")

@cmd_command(category="Teleport", syntax="username")
def fn_tpa(map, client, context, arg):
	send_request_to_user(client, context, arg, "tpa", None, "tpaccept", "tpdeny", "You requested a teleport to %s", "%s wants to teleport to you")

@cmd_command(category="Teleport", syntax="username")
def fn_tpahere(map, client, context, arg):
	send_request_to_user(client, context, arg, "tpahere", None, "tpaccept", "tpdeny", "You requested that %s teleport to you", "%s wants you to teleport to them")


permission_grant_description = {
	"move":              "Teleport you around this map",
	"move_new_map":      "Teleport you to another map",
	"minigame":          "Act on your control inputs, and/or show you a custom hotbar",
	"set_owner_to_this": "Set you as the owner of any of their items",
	"modify_appearance": "Change your name, description, appearance, or tags",
}
@cmd_command(syntax="username permission,permission")
def fn_requestpermission(map, client, context, arg):
	args = arg.split(' ')
	if len(args) != 2:
		respond(context, "That command needs a username and permission list", error=True)
		return
	arg_name  = args[0]
	arg_perms = args[1]

	deduplicated = set(list(arg_perms.split(',')))
	permission_grant_text = "%s wants temporary permissions: [b]" + ", ".join(deduplicated) + "[/b]. This would allow them to: [ul]"
	for perm in deduplicated:
		if (perm not in permission) or (perm not in permission_grant_description):
			respond(context, "Invalid or disallowed permission: "+perm, error=True)
			return
		permission_grant_text += "[li]%s[/li]" % permission_grant_description[perm]
	arg_perms = ','.join(deduplicated)
	permission_grant_text += "[/ul]"
	send_request_to_user(client, context, arg_name, "tempgrant", arg_perms, "tpaccept", "tpdeny", "You requested permissions("+", ".join(deduplicated)+") from %s", permission_grant_text)

givetype_text = {
	"transfer": "make you the new owner of an item",
	"move":     "put an item in your inventory",
	"copy":     "give you a copy of an item",
	"tempcopy": "give you a copy of an item",
}
givetype_text2 = {
	"transfer": "change ownership on",
	"move":     "give",
	"copy":     "give a copy of",
	"tempcopy": "give a temporary copy of",
}
@cmd_command(alias=['itemgive', 'senditem'], syntax="user item transfer/move/copy/tempcopy")
def fn_giveitem(map, client, context, arg):
	args = arg.split(' ')
	if len(args) != 3:
		respond(context, "Syntax is /giveitem user item transfer/move/copy/tempcopy", error=True)
		return
	arg_name = args[0]
	arg_item = args[1]
	arg_givetype = args[2].lower()

	e = get_entity_by_id(arg_item, load_from_db=False)
	if e == None:
		respond(context, "Can't find item ID: "+arg_item, error=True)
		return
	if not client.has_permission(e):
		# Is it at least in their inventory?
		if arg_givetype == 'transfer' or not client.has_in_contents_tree(e):
			respond(context, "That isn't your item", error=True)
			return
	if arg_givetype not in ("transfer", "move", "copy", "tempcopy"):
		respond(context, "Give type must be transfer, move, copy, or tempcopy", error=True)
		return

	text_for_them = "%s wants to "+givetype_text[arg_givetype]+": "+e.name+" ("+entity_type_name[e.entity_type]+")"
	text_for_you  = "You offered to "+givetype_text2[arg_givetype]+" \""+e.name+"\" to %s"

	send_request_to_user(client, context, arg_name, "giveitem", (weakref.ref(e), arg_givetype), "tpaccept", "tpdeny", text_for_you, text_for_them)

def find_request_from_arg(client, context, arg):
	args = arg.split(' ')
	if len(args) == 0:
		return False

	subject_id = args[0]
	if not valid_id_format(subject_id):
		subject_id = find_db_id_by_username(subject_id)
		if subject_id == None:
			failed_to_find(context, args[0])
			return False
	if isinstance(subject_id, str) and subject_id.isdecimal():
		subject_id = int(subject_id)

	# Gather up request information
	if len(args) == 1: # Just a username/id
		requests_from_user = [_ for _ in client.requests.keys() if _[0] == subject_id]
		if len(requests_from_user) == 0:
			respond(context, "You have no requests from " + args[0], error=True)
			return False
		# Try to find which request type has the most recent request (that is, the one with the highest ID)
		request_type = max(client.requests, key=lambda k: client.requests[k][1])[1]
	else:
		request_type = args[1]
	request_id = int(args[2]) if len(args) >= 3 else None

	request_key = (subject_id, request_type)
	if request_key not in client.requests or (request_id != None and client.requests[request_key][1] != request_id):
		respond(context, "Request not found", error=True)
		return False

	request_data = client.requests[request_key]
	del client.requests[request_key]
	return request_key, request_type, request_data[2], subject_id, args[0]


request_type_to_friendly = {
	"tpa":       "teleport",
	"tpahere":   "teleport",
	"carry":     "carry",
	"carryme":   "carryme",
	"followme":  "follow",
	"followmap": "follow",
	"followyou":    "follow",
	"followyoumap": "follow",
	"tempgrant": "permission",
	"giveitem":  "item give",
	"syncmove":  "movement",
}

@cmd_command(category="Teleport", alias=['hopon'], syntax="username")
def fn_tpaccept(map, client, context, arg):
	request = find_request_from_arg(client, context, arg)
	if request == False:
		return
	request_key, request_type, request_data, subject_id, username = request

	subject = find_client_by_username(subject_id)
	if subject == None:
		respond(context, "User " + username + " isn't online", error=True)
		return

	respond(context, 'You accepted a %s request from %s' % (request_type_to_friendly[request_type], username))

	request_data_for_message = request_data
	if request_type == 'giveitem': # Get the original item ID
		e = request_data[0]()
		if e != None:
			e = e.protocol_id()
		request_data_for_message = [e, request_data[1]]

	subject.send("MSG", {'text': "%s accepted your %s request" % (client.name_and_username(), request_type_to_friendly[request_type]), "data":
			{"request_accepted": {"id": client.protocol_id(), "type": request_type, "data": request_data_for_message}}
		}
	)

	def clone_item(item, temp):
		c = Entity
		if item.entity_type == entity_type['gadget']:
			c = GlobalData["gadget_class"]
		elif item.entity_type == entity_type['generic']:
			c = GenericEntity
		new_item = c(item.entity_type)

		item.copy_onto(new_item)
		new_item.owner_id = client.db_id
		new_item.creator_temp_id = client.id
		if client.db_id == None:
			new_item.temporary = True
			new_item.allow = permission['all']
			new_item.deny = 0
			new_item.guest_deny = 0
		if temp: # Force it to be temporary
			new_item.temporary = True
		if not new_item.temporary:
			new_item.save()
		client.add_to_contents(new_item)

	if request_type == 'tpa':
		subject.switch_map(client.map_id, new_pos=[client.x, client.y], on_behalf_of=client)
	elif request_type == 'tpahere':
		client.switch_map(subject.map_id, new_pos=[subject.x, subject.y], on_behalf_of=subject)
	elif request_type == 'carry':
		client.is_following = False
		client.ride(subject)
	elif request_type == 'carryme':
		subject.is_following = False
		subject.ride(client)
	elif request_type == 'followme':
		client.is_following = True
		client.ride(subject)
	elif request_type == 'followyou':
		subject.is_following = True
		subject.ride(client)
	elif request_type == 'followmap':
		if client != subject:
			client.stop_current_ride()
			client.follow_map_vehicle = subject
			subject.follow_map_passengers.add(client)
			client.send("MSG", {'text': 'You start following %s to other maps ([command]hopoff[/command] to stop)' % subject.name_and_username()})
			subject.send("MSG", {'text': 'You will bring %s to other maps' % client.name_and_username()})
	elif request_type == 'followyoumap':
		if client != subject:
			subject.stop_current_ride()
			subject.follow_map_vehicle = client
			client.follow_map_passengers.add(subject)
			subject.send("MSG", {'text': 'You start following %s to other maps ([command]hopoff[/command] to stop)' % client.name_and_username()})
			client.send("MSG", {'text': 'You will bring %s to other maps' % subject.name_and_username()})
	elif request_type == 'tempgrant':
		handlers['entity'](map, client, context, "me tempgrant %s %s" % (request_data, subject_id))
	elif request_type == 'giveitem':
		is_script = context.get('script_entity') != None
		item, givetype = request_data
		item = item()
		if item == None:
			respond(context, "Unfortunately that item doesn't seem to exist anymore?")
		elif givetype == 'transfer':
			item.switch_map(client, on_behalf_of=client)
			if client.db_id:
				item.owner_id = client.db_id
			item.creator_temp_id = client.id
		elif givetype == 'move':
			item.switch_map(client, on_behalf_of=client)
		elif givetype == 'copy' and not is_script:
			clone_item(item, False)
		elif givetype == 'tempcopy' and not is_script:
			clone_item(item, True)
	elif request_type == "syncmove":
		if client is subject:
			return

		client.start_batch()
		client.stop_current_ride()
		subject.start_batch()
		subject.stop_current_ride()

		client.send("MSG", {'text': 'You start moving with %s ([command]rideend[/command] to stop)' % subject.name_and_username()})
		subject.send("MSG", {'text': 'You start moving with %s ([command]rideend[/command] to stop)' % client.name_and_username()})

		client.vehicle = subject
		subject.vehicle = client
		client.passengers.add(subject)
		subject.passengers.add(client)

		if client.map != None:
			client.map.broadcast("WHO", {'add': client.who()}, remote_category=maplisten_type['move'])
		if subject.map != None:
			subject.map.broadcast("WHO", {'add': subject.who()}, remote_category=maplisten_type['move'])

		client.switch_map(subject.map_id, new_pos=[subject.x, subject.y], on_behalf_of=subject)
		client.finish_batch()
		subject.finish_batch()

@cmd_command(category="Teleport", alias=['tpdecline'], syntax="username")
def fn_tpdeny(map, client, context, arg):
	request = find_request_from_arg(client, context, arg)
	if request == False:
		return
	request_key, request_type, request_data, subject_id, username = request

	respond(context, 'You rejected a %s request from %s' % (request_type_to_friendly[request_type], username))

	request_data_for_message = request_data
	if request_type == 'giveitem': # Get the original item ID
		e = request_data[0]()
		if e != None:
			e = e.protocol_id()
		request_data_for_message = [e, request_data[1]]

	subject = find_client_by_username(subject_id)
	if subject != None:
		subject.send("MSG", {'text': "%s rejected your %s request" % (client.name_and_username(), request_type_to_friendly[request_type]), "data":
				{"request_rejected": {"id": client.protocol_id(), "type": request_type, "data": request_data_for_message}}
			}
		)

@cmd_command(category="Teleport", syntax="username")
def fn_tpcancel(map, client, context, arg):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return

	my_id = client.protocol_id()
	remove_keys = set()
	for k in u.requests:
		if k[0] == my_id:
			remove_keys.add(k)
	for k in remove_keys:
		del u.requests[k]

	if len(remove_keys):
		respond(context, 'Canceled request to '+arg)
		del u.requests[my_username]
	else:
		respond(Context, 'No request to cancel', error=True)

@cmd_command(category="Follow")
def fn_hopoff(map, client, context, arg):
	client.dismount()

@cmd_command(category="Follow")
def fn_dropoff(map, client, context, arg):
	if arg == '':
		client.stop_current_ride()
	else:
		u = find_client_by_username(arg, inside=client.passengers.union(client.follow_map_passengers))
		if u:
			u.dismount()
		else:
			respond(context, 'You aren\'t carrying %s' % arg, error=True)

@cmd_command(category="Follow")
def fn_carrywho(map, client, context, arg):
	no_error = False
	if len(client.follow_map_passengers):
		respond(context, 'You are bringing %s to other maps' % ', '.join(['%s (%s)' % (u.name, u.username_or_id()) for u in client.follow_map_passengers]))
		no_error = True
	if len(client.passengers):
		respond(context, 'You are carrying %s' % ', '.join(['%s (%s)' % (u.name, u.username_or_id()) for u in client.passengers]))
	elif no_error == False:
		respond(context, 'You aren\'t carrying anything')

@cmd_command(category="Follow")
def fn_ridewho(map, client, context, arg):
	if client.follow_map_vehicle:
		respond(context, "You are following %s to other maps" % client.follow_map_vehicle.name_and_username())	
	elif client.vehicle:
		respond(context, "You are riding %s" % client.vehicle.name_and_username())
	else:
		respond(context, "You aren\'t riding anything")

@cmd_command(category="Follow")
def fn_rideend(map, client, context, arg):
	client.stop_current_ride()

@cmd_command(no_entity_needed=True)
def fn_time(map, client, context, arg):
	respond(context, datetime.datetime.today().strftime("Now it's %Y-%m-%d, %I:%M %p"))

def broadcast_status_change(map, client, status_type, message):
	client.status_type = status_type
	client.status_message = message
	if map and map.is_map():
		map.broadcast("WHO", {"update": {'id': client.protocol_id(), 'status': status_type, 'status_message': message}})

	# Let watchers know
	if hasattr(client, 'connection'):
		connection = client.connection()
		if connection != None:
			connection.status_type = status_type
			connection.status_message = message
			connection.broadcast_who_to_watchers()

@cmd_command(syntax="message", no_entity_needed=True)
def fn_away(map, client, context, arg):
	if len(arg) < 1:
		broadcast_status_change(map, client, None, None)
		respond(context, 'You are no longer marked as away')
	else:
		broadcast_status_change(map, client, 'away', arg)
		respond(context, 'You are now marked as away ("%s")' % arg)

@cmd_command(alias=['stat'], syntax="message", no_entity_needed=True)
def fn_status(map, client, context, arg):
	if len(arg) < 1:
		broadcast_status_change(map, client, None, None)
		respond(context, 'Your status has been cleared')
	else:
		status_type, status_message = separate_first_word(arg)
		broadcast_status_change(map, client, status_type[0:16], status_message if status_message != '' else None)

		if client.status_message:
			respond(context, 'Your status is now \"%s\" ("%s")' % (client.status_type, client.status_message))
		else:
			respond(context, 'Your status is now \"%s\"' % (client.status_type))

@cmd_command(alias=['findrp'])
def fn_findiic(map, client, context, arg):
	formatted = []
	for u in AllClients:
		if u.status_type == None or u.status_type.lower() not in ('iic', 'irp', 'lfrp'):
			continue
		formatted.append(u.name_and_username())
	respond(context, 'These users are looking for RP: '+(", ".join(sorted(formatted, key=str.casefold))))

@cmd_command()
def fn_findic(map, client, context, arg):
	formatted = []
	for u in AllClients:
		if u.status_type == None or u.status_type.lower() not in ('ic', 'rp'):
			continue
		formatted.append(u.name_and_username())
	respond(context, 'These users are currently in character (or roleplaying): '+(", ".join(sorted(formatted, key=str.casefold))))

@cmd_command(syntax="dice sides", no_entity_needed=True, alias=['proll'])
def fn_privateroll(map, client, context, arg):
	param = arg.split('d')
	if len(param) != 2:
		param = arg.split(' ')
	if len(param) != 2 or (not param[0].isdecimal()) or (not param[1].isdecimal()):
		respond(context, 'Syntax: /privateroll dice sides', error=True)
	else:
		dice = int(param[0])
		sides = int(param[1])
		sum = 0
		if dice < 1 or dice > 1000:
			respond(context, 'Bad number of dice', error=True)
			return
		if sides < 1 or sides > 1000000000:
			respond(context, 'Bad number of sides', error=True)
			return
		for i in range(dice):
			sum += random.randint(1, sides)
		client.send("MSG", {'text': "You roll %dd%d and get %d"%(dice, sides, sum)})

@cmd_command(syntax="dice sides")
def fn_roll(map, client, context, arg):
	param = arg.split('d')
	if len(param) != 2:
		param = arg.split(' ')
	if len(param) != 2 or (not param[0].isdecimal()) or (not param[1].isdecimal()):
		respond(context, 'Syntax: /roll dice sides', error=True)
	else:
		dice = int(param[0])
		sides = int(param[1])
		sum = 0
		if dice < 1 or dice > 1000:
			respond(context, 'Bad number of dice', error=True)
			return
		if sides < 1 or sides > 1000000000:
			respond(context, 'Bad number of sides', error=True)
			return
		for i in range(dice):
			sum += random.randint(1, sides)
		map.broadcast("MSG", {'text': client.name+" rolled %dd%d and got %d"%(dice, sides, sum)})

@cmd_command(category="Map")
def fn_mapid(map, client, context, arg):
	respond(context, 'Map ID is %d' % map.db_id)

@cmd_command(category="Map", privilege_level="registered")
def fn_newmap(map, client, context, arg):
	level = Config["Security"]["TrustedOnlyMapCreation"]
	if (level == 2 and ((client.connection_attr("user_flags") or 0) & userflag['trusted_builder'] == 0 ) \
		and client.connection_attr('username') not in Config["Server"]["Admins"]) \
		or (level == 3 and client.connection_attr('username') not in Config["Server"]["Admins"]):
		respond(context, 'Map creation is currently disabled', error=True)
		return

	c = Database.cursor()
	c.execute('SELECT COUNT(*) from Map')
	result = c.fetchone()
	if result == None:
		return
	if result[0] > Config["Server"]["MaxDBMaps"] and Config["Server"]["MaxDBMaps"] > 0:
		respond(context, 'There are too many maps', error=True)
		return

	new_map = Map(creator_id = client.db_id)
	new_map.save_and_commit()

	try:
		client.switch_map(new_map)
		respond(context, 'Welcome to your new map (id %d)' % new_map.db_id)
	except: # Is it even possible for switch_map to throw an exception?
		respond(context, 'Couldn\'t switch to the new map', error=True)
		raise

# maybe combine the list add/remove/list commands together?
@cmd_command(category="Settings", syntax="username", no_entity_needed=True, privilege_level="no_scripts")
def fn_ignore(map, client, context, arg):
	arg = arg.lower().strip()
	if not arg:
		return
	connection = client.connection()
	if connection:
		connection.ignore_list.add(arg)
		respond(context, '\"%s\" added to ignore list' % arg)

@cmd_command(category="Settings", syntax="username", no_entity_needed=True, privilege_level="no_scripts")
def fn_unignore(map, client, context, arg):
	arg = arg.lower().strip()
	if not arg:
		return
	connection = client.connection()
	if connection and arg in connection.ignore_list:
		connection.ignore_list.discard(arg)
		respond(context, '\"%s\" removed from ignore list' % arg)

@cmd_command(category="Settings", no_entity_needed=True, privilege_level="no_scripts")
def fn_ignorelist(map, client, context, arg):
	respond(context, 'Ignore list: '+str(client.connection_attr('ignore_list')))

@cmd_command(category="Settings", syntax="username", no_entity_needed=True, privilege_level="no_scripts")
def fn_watch(map, client, context, arg):
	connection = client.connection()
	if connection == None:
		return
	arg = arg.lower().strip()
	if not arg:
		users = []
		for other in connection.watch_list:
			other_connection = ConnectionsByUsername.get(other, None)
			if other_connection == None or not other_connection.can_be_watched():
				continue
			users.append(other_connection.username if isinstance(other_connection.entity, Entity) else (other_connection.username +"✉️"))
		respond(context, 'Players currently online: %s' % ', '.join(sorted(users, key=str.casefold)))
		return

	# Add to watch list
	connection.watch_list.add(arg)
	respond(context, '\"%s\" added to watch list' % arg)

	# Update watch list
	if connection.user_watch_with_who:
		other = ConnectionsByUsername[arg]
		if other.can_be_watched():
			connection.send("WHO", {"add": other.watcher_who(), "type": "watch"})

@cmd_command(category="Settings", syntax="username", no_entity_needed=True, privilege_level="no_scripts")
def fn_unwatch(map, client, context, arg):
	arg = arg.lower().strip()
	if not arg:
		return
	connection = client.connection()
	if connection:
		connection.watch_list.discard(arg)
		respond(context, '\"%s\" removed from watch list' % arg)

		# Update watch list
		if connection.user_watch_with_who:
			other = ConnectionsByUsername[arg]
			if other.can_be_watched():
				connection.send("WHO", {"remove": other.db_id, "type": "watch"})

@cmd_command(category="Settings", no_entity_needed=True, privilege_level="no_scripts")
def fn_watchlist(map, client, context, arg):
	respond(context, 'Watch list: '+str(client.connection_attr('watch_list')))

user_changeable_flags = ('bot', 'hide_location', 'hide_api', 'no_watch', 'secret_pic')
@cmd_command(category="Settings", alias=['userflag'], privilege_level="no_scripts")
def fn_userflags(map, client, context, arg):
	connection = client.connection()
	if connection == None:
		return
	def flags_list():
		return ', '.join([key for key in userflag if ((userflag[key] & connection.user_flags) and (userflag[key].bit_count() == 1))])

	arg = arg.lower()
	if arg == "" or arg == "list":
		respond(context, 'Your user flags: '+flags_list())
		return
	param = arg.lower().split(' ')
	if len(param) >= 2:
		if param[0] in ('add', 'set'):
			for flag in param[1:]:
				if flag in user_changeable_flags:
					connection.user_flags |= userflag[flag]
		elif param[0] in ('del', 'remove'):
			for flag in param[1:]:
				if flag in user_changeable_flags:
					connection.user_flags &= ~userflag[flag]
		else:
			respond(context, 'Unrecognized subcommand "%s"' % param[0], code='invalid_subcommand', detail=param[0], error=True)
			return
		respond(context, 'Your new user flags: '+flags_list())
	else:
		respond(context, 'Syntax: add/del list of flags', error=True)


admin_changeable_flags = ('bot', 'hide_location', 'hide_api', 'no_watch', 'secret_pic', 'file_uploads', 'trusted_builder', 'scripter', 'no_login')
@cmd_command(category="Settings", alias=['adminuserflag'])
def fn_adminuserflags(map, client, context, arg):
	username, arg = separate_first_word(arg)
	connection = find_connection_by_username(username)

	def flags_list(flags):
		return ', '.join([key for key in userflag if ((userflag[key] & flags) and (userflag[key].bit_count() == 1))])

	def apply_arg(flags, arg):
		arg = arg.lower()
		if arg == "" or arg == "list":
			respond(context, 'Their user flags: '+flags_list(flags))
			return None
		param = arg.lower().split(' ')
		if len(param) >= 2:
			if param[0] in ('add', 'set'):
				for flag in param[1:]:
					if flag in admin_changeable_flags:
						flags |= userflag[flag]
			elif param[0] in ('del', 'remove'):
				for flag in param[1:]:
					if flag in admin_changeable_flags:
						flags &= ~userflag[flag]
			else:
				respond(context, 'Unrecognized subcommand "%s"' % param[0], code='invalid_subcommand', detail=param[0], error=True)
				return None
			respond(context, 'Their new user flags: '+flags_list(flags))
			return flags
		else:
			respond(context, 'Syntax: username add/del list of flags', error=True)
			return None

	if connection == None:
		# Do it directly on the database then
		c = Database.cursor()
		c.execute('SELECT flags FROM User WHERE username=?', (username.lower(),))
		result = c.fetchone()
		if result == None:
			respond(context, 'User '+username+" not found", error=True)
			return
		new_flags = apply_arg(result[0], arg)
		if new_flags != None:
			c.execute('UPDATE User SET flags=? WHERE username=?', (new_flags, username.lower(),))
		return

	new_flags = apply_arg(connection.user_flags, arg)
	if new_flags != None:
		connection.user_flags = new_flags

def permission_change(map, client, context, arg, command2):
	# Check syntax
	param = arg.lower().split(' ')
	if len(param) < 2:
		respond(context, 'Must specify a permission and a username', error=True)
		return
	# Has to be a valid permission
	if param[0] not in permission:
		respond(context, '"%s" not a valid permission' % param[0], error=True)
		return
	permission_value = permission[param[0]]
	
	# Special usernames for map defaults
	if param[1] == '!default':
		if command2 == "grant":
			map.allow |= permission_value
			map.deny &= ~permission_value
		elif command2 == "deny":
			map.allow &= ~permission_value
			map.deny |= permission_value
		elif command2 == "revoke":
			map.allow &= ~permission_value
			map.deny &= ~permission_value
		map.broadcast("MSG", {'text': "%s sets the default \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), param[0], command2)})
		map.save_on_clean_up = True
		if map.is_map():
			map.resend_map_info_to_users(mai_only=True)
		return

	# Group permissions and entity permissions are the same thing
	if param[1].isdecimal():
		as_int = int(param[1])
		ename = find_entity_name(as_int)
		if ename != None:
			map.change_permission_for_entity(as_int, permission_value, True if command2=="grant" else None)
			map.broadcast("MSG", {'text': "%s sets entity \"%s\"(%d) \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), ename, as_int, param[0], command2)})
			return
		respond(context, '"%d" Not a valid entity ID' % as_int, error=True)
		return

	if param[1].startswith("group:"):
		groupid = param[1][6:]
		if groupid.isdecimal():
			groupname = find_entity_name(int(groupid))
			if groupname != None:
				map.change_permission_for_entity(int(groupid), permission_value, True if command2=="grant" else None)
				map.broadcast("MSG", {'text': "%s sets group \"%s\"(%s) \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), groupname, groupid, param[0], command2)})
				return
		respond(context, '"%s" Not a valid group number' % groupid, error=True)
		return

	# Guest permissions
	if param[1] == '!guest' or param[1] == '!guests':
		if command2 == "deny":
			map.guest_deny |= permission_value
		elif command2 == "revoke":
			map.guest_deny &= ~permission_value
		map.broadcast("MSG", {'text': "%s sets the guest \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), param[0], command2)})
		return

	# Has to be a user that exists
	uid = find_db_id_by_username(param[1])
	if uid == None:
		failed_to_find(context, param[1])
		return

	# Finally we know it's valid
	value = None
	if command2 == "grant":
		value = True
	if command2 == "deny":
		value = False
	map.change_permission_for_entity(uid, permission_value, value)
	map.broadcast("MSG", {'text': "%s sets %s's \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), param[1], param[0], command2)})

	# Refresh permissions of users on the map so changes take effect immediately
	# (probably only need to do it for the affected user, if they're even present)
	for u in map.contents:
		u.update_map_permissions()

@cmd_command(category="Map", privilege_level="map_admin", syntax="permission user/!default", map_only=True)
def fn_grant(map, client, context, arg):
	permission_change(map, client, context, arg, 'grant')

@cmd_command(category="Map", privilege_level="map_admin", syntax="permission user/!default/!guest", map_only=True)
def fn_deny(map, client, context, arg):
	permission_change(map, client, context, arg, 'deny')

@cmd_command(category="Map", privilege_level="map_admin", syntax="permission user/!default/!guest", map_only=True)
def fn_revoke(map, client, context, arg):
	permission_change(map, client, context, arg, 'revoke')

@cmd_command(category="Map", map_only=True)
def fn_permlist(map, client, context, arg):
	c = Database.cursor()
	perms = "Defaults: "

	# List map default permissions
	for k,v in permission.items():
		if (map.allow & v) == v:
			perms += "+"+k+" "
		if (map.deny & v) == v:
			perms += "-"+k+" "
		if (map.guest_deny & v) == v:
			perms += "-"+k+"(guest) "

	# User permissions
	formatted = []
	for row in c.execute('SELECT username, allow, deny FROM Permission mp, User u WHERE mp.subject_id=? AND mp.actor_id=u.entity_id', (map.db_id,)):
		perms = "[li][b]"+noparse(row[0]) + "[/b]: "
		for k,v in permission.items():
			if (row[1] & v) == v: # allow
				perms += "+"+k+" "
			if (row[2] & v) == v: #deny
				perms += "-"+k+" "
		perms += "[/li]"
		formatted.append(perms)

	# Group (or anything that isn't a user) permissions
	for row in c.execute('SELECT u.name, u.type, mp.allow, mp.deny, u.id FROM Permission mp, Entity u WHERE mp.subject_id=? AND mp.actor_id=u.id AND u.type != ?', (map.db_id, entity_type['user'])):
		perms = "[li][b]%s: %s(%s) [/b]: " % (entity_type_name[row[1]].title(), row[4], noparse(row[0]))
		for k,v in permission.items():
			if (row[2] & v) == v: # allow
				perms += "+"+k+" "
			if (row[3] & v) == v: # deny
				perms += "-"+k+" "
		perms += "[/li]"
		formatted.append(perms)

	# Temporary
	for v in map.temp_permissions_given_to:
		perms = "[li][b]Temp: %s(%s)[/b]" % (noparse(v.name), v.protocol_id())
		perm_bits = v.temp_permissions.get(map)
		for k,v in permission.items():
			if (perm_bits & v) == v: # allow
				perms += "+"+k+" "
		perms += "[/li]"
		formatted.append(perms)

	perms = "[ul]"+("".join(sorted(formatted, key=str.casefold)))+"[/ul]"
	respond(context, perms)

@cmd_command(privilege_level="registered", no_entity_needed=True)
def fn_findmyitems(map, client, context, arg):
	connection = client.connection()
	if connection == None:
		return
	c = Database.cursor()
	formatted = []
	for row in c.execute('SELECT m.id, m.name, m.type FROM Entity m WHERE m.owner_id=? AND m.type != ? AND m.type != ? AND m.location == NULL', (connection.db_id, entity_type['map'], entity_type['group'])):
		formatted.append("[li][b]%s[/b] (%s) [command]e %d take[/command][/li]" % (row[1], noparse(entity_type_name[row[2]]), row[0]))
	respond(context, "My items: [ul]" + (", ".join(sorted(formatted, key=str.casefold))) + "[/ul]")

@cmd_command()
def fn_deletemytempitems(map, client, context, arg):
	arg = arg.lower()
	if arg == 'all' or arg == '':
		where = AllEntitiesByID.values()
	elif arg == 'here' and map:
		where = map.contents
	elif arg == 'inventory':
		where = client.contents
	else:
		respond(context, 'Valid options are: all, here, inventory', error=True)
		return

	deleted = 0
	for e in where.copy():
		if e.db_id or e.is_client():
			continue
		elif e.creator_temp_id == client.id:
			pass
		elif e.owner_id == None or e.owner_id != client.db_id:
			continue

		# Move everything inside to the parent
		for child in e.contents.copy():
			e.remove_from_contents(child)
			if e.map:
				e.map.add_to_contents(child)

		if e.map:
			e.map.remove_from_contents(e)
		e.save_on_clean_up = False
		e.clean_up()

@cmd_command(category="Map", privilege_level="registered", no_entity_needed=True)
def fn_mymaps(map, client, context, arg):
	connection = client.connection()
	if connection == None:
		return
	c = Database.cursor()
	formatted = []
	for row in c.execute('SELECT m.id, m.name FROM Entity m WHERE m.owner_id=? AND m.type == ?', (connection.db_id, entity_type['map'])):
		formatted.append("[li][b]%s[/b] [command]map %d[/command][/li]" % (row[1], row[0]))
	maps = "My maps: [ul]"+("".join(sorted(formatted, key=str.casefold )))+"[/ul]"
	respond(context, maps)

@cmd_command(category="Map", hidden=True, privilege_level="server_admin", no_entity_needed=True)
def fn_allmaps(map, client, context, arg):
	c = Database.cursor()
	formatted = []
	for row in c.execute('SELECT e.id, e.name, u.username FROM Entity e, Map m, User u WHERE e.owner_id=u.entity_id AND e.id=m.entity_id'):
		formatted.append("[li][b]%s[/b] (%s) [command]map %d[/command][/li]" % (row[1], row[2], row[0]))
	maps = "All maps: [ul]"+("".join(sorted(formatted, key=str.casefold )))+"[/ul]"
	respond(context, maps)

@cmd_command(category="Map", no_entity_needed=True)
def fn_publicmaps(map, client, context, arg):
	c = Database.cursor()
	formatted = []
	for row in c.execute('SELECT e.id, e.name, u.username FROM Entity e, Map m, User u WHERE e.owner_id=u.entity_id AND e.id=m.entity_id AND (m.flags&1)!=0'):
		formatted.append("[li][b]%s[/b] (%s) [command]map %d[/command][/li]" % (row[1], row[2], row[0]))
	maps = "Public maps: [ul]"+("".join(sorted(formatted, key=str.casefold )))+"[/ul]"
	respond(context, maps)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="newname")
def fn_mapname(map, client, context, arg):
	map.name = arg.replace('\n', '')
	map.save_on_clean_up = True
	respond(context, 'Map name set to \"%s\"' % map.name)
	map.resend_map_info_to_users(mai_only=True)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_mapdesc(map, client, context, arg):
	if arg == "":
		arg = None
	map.desc = arg
	map.save_on_clean_up = True
	respond(context, 'Map description set to \"%s\"' % (map.desc or ""))
	map.resend_map_info_to_users(mai_only=True)

@cmd_command(category="Map", privilege_level="no_scripts", map_only=True, syntax="text")
def fn_topic(map, client, context, arg):
	if arg == None:
		arg = ""
	arg = arg.strip()

	if arg:
		if not client.db_id:
			respond(context, 'Only registered users can set topics', error=True)
		elif client.is_client() and client.has_permission(map, permission['set_topic'], True):
			map.topic = arg[:250]
			map.topic_username = client.username_or_id()
			map.broadcast("MSG", {'text': 'Map\'s current topic is now: "%s" (set by %s)' % (map.topic, client.name_and_username())})
		else:
			respond(context, 'Don\t have permission to set a topic for this map', error=True)
	else:
		if map.topic:
			respond(context, 'Map\'s current topic: "%s" (set by %s)' % (map.topic, map.topic_username))
		else:
			respond(context, 'There is no topic set for this map')

@cmd_command(category="Map", privilege_level="no_scripts", map_only=True)
def fn_cleartopic(map, client, context, arg):
	if client.is_client() and client.has_permission(map, permission['set_topic'], True):
		map.topic = None
		map.topic_username = None
		map.broadcast("MSG", {'text': 'Map\'s current topic was cleared by %s' % (map.topic, client.name_and_username())})
	else:
		respond(context, 'Don\t have permission to set a topic for this map', error=True)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="edge id")
def fn_mapedgelink(map, client, context, arg):
	s = arg.split()
	if len(s) == 2 and s[0].isdecimal() and (s[1].isdecimal() or s[1] == 'none'):
		edge = int(s[0])
		if edge < 0 or edge >= 8:
			respond(context, 'Edge number should be in the 0-7 range', error=True)
			return
		if s[1] == 'none':
			map_id = None
		else:
			map_id = int(s[1])

		# Make sure it's a list, so I can write to one of the items
		if map.edge_id_links == None:
			map.edge_id_links = [None] * 8
		map.edge_id_links[edge] = map_id

		# If it's all None, change it to None instead of being a list at all
		if all(x == None for x in map.edge_id_links):
			map.edge_id_links = None

		map.map_data_modified = True
		respond(context, 'Map edge %d set to %s; links: %s' % (edge, map_id, map.edge_id_links))
	else:
		respond(context, 'Syntax is /mapedgelink edge id', error=True)


@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="username")
def fn_mapowner(map, client, context, arg):
	newowner = find_db_id_by_username(arg)
	if newowner:
		map.owner_id = newowner
		respond(context, 'Map owner set to \"%s\"' % map.owner)
	else:
		respond(context, 'Nonexistent account', error=True)
		return
	map.resend_map_info_to_users(mai_only=True)
	map.save_on_clean_up = True

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="public/private/unlisted")
def fn_mapprivacy(map, client, context, arg):
	if arg == "public":
		map.deny &= ~permission['entry']
		map.map_flags |= mapflag['public']
	elif arg == "private":
		map.deny |= permission['entry']
		map.map_flags &= ~mapflag['public']
	elif arg == "unlisted":
		map.deny &= ~permission['entry']
		map.map_flags &= ~mapflag['public']
	else:
		respond(context, 'Map privacy must be public, private, or unlisted', error=True)
		return
	map.resend_map_info_to_users(mai_only=True)
	map.save_on_clean_up = True

@cmd_command(category="Map", privilege_level="map_admin", map_only=True, syntax="on/off")
def fn_mapprotect(map, client, context, arg):
	if arg == "off":
		map.allow |= permission['sandbox']
	elif arg == "on":
		map.allow &= ~permission['sandbox']
	else:
		respond(context, 'Map sandbox must be on or off', error=True)
		return
	map.resend_map_info_to_users(mai_only=True)

@cmd_command(category="Map", privilege_level="map_admin", map_only=True, syntax="on/off")
def fn_mapbuild(map, client, context, arg):
	if arg == "on":
		map.deny &= ~permission['build']
	elif arg == "off":
		map.deny |= permission['build']
	else:
		respond(context, 'Map building must be on or off', error=True)
		return
	map.resend_map_info_to_users(mai_only=True)

@cmd_command(category="Map", privilege_level="map_admin", map_only=True, syntax="on/off")
def fn_mapdisablesave(map, client, context, arg):
	if arg == "on":
		map.temporary = True
	elif arg == "off":
		map.temporary = False
	else:
		respond(context, 'Map save disabling must be on or off', error=True)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text", alias=['defaultfloor'])
def fn_mapdefaultfloor(map, client, context, arg):
	as_json = load_json_if_valid(arg)
	if as_json != None:
		if tile_is_okay(as_json):
			map.default_turf = as_json
			map.save_on_clean_up = True
			respond(context, 'Map floor changed to custom tile %s' % arg)
		else:
			respond(context, 'Map floor not changed, custom tile not ok: %s' % arg)
	else:
		map.default_turf = arg
		map.save_on_clean_up = True
		respond(context, 'Map floor changed to %s' % arg)
	map.resend_map_info_to_users(mai_only=True)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="url")
def fn_mapwallpaper(map, client, context, arg):
	arg = arg.split(' ')
	if len(arg) == 0:
		return
	if arg[0].lower() in ("none", "off"):
		if map.map_wallpaper != None:
			map.map_wallpaper = None
			map.map_data_modified = True # Because wallpapers get saved in with the rest of the data
			map.save_on_clean_up = True
			respond(context, 'Wallpaper removed')
		else:
			respond(context, 'No wallpaper to remove', error=True)
			return
	elif arg[0].startswith("http"):
		if image_url_is_okay(arg[0]):
			wallpaper = {"url": arg[0], "center": True, "offset": [0,0]}
			for a in arg[1:]:
				lowered = a.lower()
				if lowered == "absolute":
					wallpaper["center"] = False
				elif lowered in ("repeat", "repeat_x", "repeat_y", "over_turf", "center"):
					wallpaper[lowered] = True
				elif lowered.startswith("offset="):
					offset_arg = a[7:].split(',')
					if len(offset_arg) == 2 and string_is_int(offset_arg[0]) and string_is_int(offset_arg[1]):
						wallpaper["offset"] = [int(offset_arg[0]), int(offset_arg[1])]
				else:
					respond(context, 'Unrecognized parameter "%s"' % a, error=True)
					return
			map.map_wallpaper = wallpaper
			map.map_data_modified = True # Because wallpapers get saved in with the rest of the data
			map.save_on_clean_up = True

			respond(context, 'Wallpaper changed to "%s"' % arg[0])
		else:
			respond(context, 'URL doesn\'t match any allowlisted sites, or is not a PNG', error=True)
			return
	else:
		respond(context, 'Please provide a URL', error=True)
		return
	map.resend_map_info_to_users(mai_only=True)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="url")
def fn_mapmusic(map, client, context, arg):
	arg = arg.split(' ')
	if len(arg) == 0:
		return
	if arg[0].lower() in ("none", "off"):
		if map.map_music != None:
			map.map_music = None
			map.map_data_modified = True # Because music gets saved in with the rest of the data
			map.save_on_clean_up = True
			respond(context, 'Music removed')
		else:
			respond(context, 'No music to remove', error=True)
			return
	elif arg[0].startswith("http"):
		if user_file_url_is_ok(arg[0]):
			lower = arg[0].lower()
			if lower.endswith(".mod") or lower.endswith(".s3m") or lower.endswith(".xm") or lower.endswith(".it") or lower.endswith(".mptm"):
				music = {"url": arg[0]}
				map.map_music = music
				map.map_data_modified = True # Because music gets saved in with the rest of the data
				map.save_on_clean_up = True
				respond(context, 'Music changed to "%s"' % arg[0])
			else:
				respond(context, 'Allowed music formats are MOD, S3M, XM, IT, MPTM', error=True)
				return
		else:
			respond(context, 'URL doesn\t match any allowlisted sites', error=True)
			return
	else:
		respond(context, 'Please provide a URL', error=True)
		return
	map.resend_map_info_to_users(mai_only=True)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_mapspawn(map, client, context, arg):
	map.start_pos = [client.x, client.y]
	map.save_on_clean_up = True
	respond(context, 'Map start changed to %d,%d' % (client.x, client.y))

@cmd_command(category="Map", map_only=True,)
def fn_getmapsize(map, client, context, arg):
	respond(context, 'This map\'s size is %d,%d' % (map.width, map.height))

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="width height")
def fn_mapsize(map, client, context, arg):
	width_height = arg.split(' ')
	if len(width_height) != 2 or not width_height[0].isdecimal() or not width_height[1].isdecimal():
		respond(context, 'Syntax: /mapsize width height', error=True)
		return
	width = int(width_height[0])
	height = int(width_height[1])
	if width > Config["Server"]["MaxMapSize"] or height > Config["Server"]["MaxMapSize"]:
		respond(context, 'Map is too big (Max width/height is %d)' % Config["Server"]["MaxMapSize"], error=True)
		return

	if width < map.width:
		# Check if it would delete anything
		for y in range(map.height):
			for x in range(map.width - width):
				if map.turfs[x + width][y] or map.objs[x + width][y]:
					respond(context, 'Can\'t shrink map horizontally, there\'s something at %d,%d' % (x + width, y))
					return
	if height < map.height:
		# Check if it would delete anything
		for y in range(map.height - height):
			for x in range(map.width):
				if map.turfs[x][y + height] or map.objs[x][y + height]:
					respond(context, 'Can\'t shrink map vertically, there\'s something at %d,%d' % (x, y + height))
					return

	# Array is [x][y]
	if width > map.width:
		for i in range(width - map.width):
			map.turfs.append([None] * map.height)
			map.objs.append([None] * map.height)
	elif width < map.width:
		del map.turfs[width:]
		del map.objs[width:]
	map.width = width
		
	if height > map.height:
		for i in range(map.width):
			map.turfs[i].extend([None] * (height-map.height))
			map.objs[i].extend([None] * (height-map.height))
	elif height < map.height:
		for i in range(map.width):
			del map.turfs[i][height:]
			del map.objs[i][height:]
	map.height = height

	respond(context, 'This map\'s size is now %d,%d' % (map.width, map.height))
	map.resend_map_info_to_users()
	map.map_data_modified = True
	map.save_on_clean_up = True

@cmd_command()
def fn_coords(map, client, context, arg):
	respond(context, 'You\'re standing on %d,%d' % (client.x, client.y))

@cmd_command()
def fn_tpherecommand(map, client, context, arg):
	respond(context, 'You can teleport here with [tt]/map %d %d %d[/tt]' % (map.db_id, client.x, client.y))

def clone_tile_into_inventory(client, tile):
	e = Entity(entity_type['map_tile'], creator_id=client.db_id)
	if isinstance(tile, dict):
		e.name = tile['name']
	elif isinstance(tile, str):
		e.name = tile
	else:
		e.name = "copied"
	e.map_id = client.db_id
	e.creator_temp_id = client.id
	e.temporary = True
	e.allow = permission['all']
	e.data = tile
	client.add_to_contents(e)

@cmd_command(category="Map", map_only=True)
def fn_getturf(map, client, context, arg):
	turf = map.turfs[client.x][client.y]
	if turf == None:
		respond(context, 'You\'re not standing on a non-default turf', error=True)
		return
	clone_tile_into_inventory(client, turf)

@cmd_command(category="Map", map_only=True)
def fn_getobj(map, client, context, arg):
	objs = map.objs[client.x][client.y]
	if objs == None:
		respond(context, 'You\'re not standing on any objs', error=True)
		return
	for obj in objs:
		clone_tile_into_inventory(client, obj)

@cmd_command()
def fn_listeners(map, client, context, arg):
	if map == None:
		return

	out = []
	for i in maplisten_type.keys():
		c = maplisten_type[i]
		if map.db_id in BotWatch[c]:
			for u in BotWatch[c][map.db_id]:
				out.append('%s (%s)' % (u.username, i))
	out_forward = []
	for e in map.contents:
		if e.forward_messages_to:
			out_forward.append('%s (%s) → [%s]' % (e.name_and_username(), ', '.join(list(e.forward_message_types)), ', '.join([p.name_and_username() for p in e.forward_messages_to])))

	parts = []
	if out:
		parts.append('Remote listeners here: ' + (", ".join(sorted(out, key=str.casefold))))
	if out_forward:
		parts.append('Forwarders here: ' + (", ".join(sorted(out_forward, key=str.casefold))))
	if not parts:
		parts = ['Nothing is listening to this map']
	respond(context, ' | '.join(parts))

@cmd_command(no_entity_needed=True)
def fn_kicklisten(map, client, context, arg):
	params = arg.split()
	if len(params) != 3:
		return
	categories = set(params[0].split(','))
	maps = set((int_if_numeric(x) if isinstance(x, str) else x) for x in params[1].split(','))
	kick_all = params[2] == '!all'
	if not kick_all:
		users = set(params[2].split(','))
		users_to_notify = set()

	client.start_batch()
	kicked = 0
	for category_name in categories:
		# find category id from name
		if category_name not in maplisten_type:
			respond(context, 'Invalid listen category: %s' % category_name, error=True)
			continue
		category_id = maplisten_type[category_name]

		for map_id in maps:
			if not client.has_permission(map_id, permission['admin'], False):
				respond(context, 'Don\'t have admin permission for %s' % map_id, error=True)
				continue
			for username in users:
				user = find_client_by_username(username)
				if user and hasattr(user, 'connection'):
					if user.unlisten(map_id, category_id):
						users_to_notify.add(user)
						kicked += 1
	respond(context, 'Kicked %d listens' % (kicked))

	for user in users_to_notify:
		connection = user.connection()
		if connection:
			send_ext_listen_status(connection)

	client.finish_batch()

@cmd_command(syntax="category,category,category... id,id,id...", no_entity_needed=True, privilege_level="no_scripts")
def fn_listen(map, client, context, arg):
	if arg == "":
		return
	params = arg.split()
	categories = set(params[0].split(','))
	maps = set((int_if_numeric(x) if isinstance(x, str) else x) for x in params[1].split(','))

	client.start_batch()
	for category_name in categories:
		# find category id from name
		if category_name not in maplisten_type:
			respond(context, 'Invalid listen category: %s' % category_name, error=True)
			continue
		category_id = maplisten_type[category_name]

		for map_id in maps:
			if not client.try_to_listen(map_id, category_id):
				respond(context, 'Don\'t have permission to listen on "%s" in %s' % (category_name, map_id), error=True)
				continue

	if hasattr(client, 'connection'):
		connection = client.connection()
		if connection:
			send_ext_listen_status(connection)
	client.finish_batch()

@cmd_command(syntax="category,category,category... id,id,id...", no_entity_needed=True, privilege_level="no_scripts")
def fn_unlisten(map, client, context, arg):
	params = arg.split()
	categories = set(params[0].split(','))
	maps = set((int_if_numeric(x) if isinstance(x, str) else x) for x in params[1].split(','))

	client.start_batch()
	for category_name in categories:
		# find category id from name
		if category_name not in maplisten_type:
			respond(context, 'Invalid listen category: %s' % category_name, error=True)
			continue
		category_id = maplisten_type[category_name]

		for map_id in maps:
			client.unlisten(map_id, category_id)

	if hasattr(client, 'connection'):
		connection = client.connection()
		if connection:
			send_ext_listen_status(connection)
	client.finish_batch()

def kick_and_ban(map, client, context, arg, ban):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u != None:
		if u.map_id == client.map_id:
			respond(context, 'Kicked '+u.name_and_username())
			u.send("MSG", {'text': 'Kicked by '+client.name_and_username()})
			u.send_home()
			if ban and u.db_id:
				map.change_permission_for_entity(u.db_id, permission['entry'], False)
		else:
			respond(context, 'User not on this map', error=True)
	else:
		respond(context, 'User not found', error=True)

@cmd_command(category="Map", privilege_level="map_admin", syntax="username")
def fn_kick(map, client, context, arg):
	kick_and_ban(map, client, context, arg, False)

@cmd_command(category="Map", privilege_level="map_admin", syntax="username")
def fn_kickban(map, client, context, arg):
	kick_and_ban(map, client, context, arg, True)

@cmd_command(category="Map", privilege_level="map_admin")
def fn_kickallusers(map, client, context, arg):
	if not map:
		return
	returned = 0
	for e in map.contents.copy():
		if e.is_client() and not e.has_permission(map, permission['admin'], False):
			e.send("MSG", {'text': 'Kicked by '+client.name_and_username()})
			e.send_home()
			returned += 1
	respond(context, "Sent %d users home" % returned)	

@cmd_command(category="Map", privilege_level="map_admin")
def fn_returnall(map, client, context, arg):
	if not map:
		return
	returned = 0

	if len(arg): # Return all from a specific user
		owner_id = find_db_id_by_username(arg)
		if owner_id == None:
			failed_to_find(context, arg)
			return
		for e in map.contents.copy():
			if not e.is_client() and e.owner_id != owner_id:
				continue
			e.send_home()
			returned += 1
	else: # Return all from everyone meeting specific criteria
		for e in map.contents.copy():
			if e.is_client():
				continue
			if e.owner_id == client.owner_id:
				continue
			if e.vehicle and e.vehicle.is_client():
				continue
			if any(x.is_client() for x in client.passengers):
				continue
			e.send_home()
			returned += 1
	respond(context, "Sent %d entities home" % returned)

@cmd_command(category="Server Admin", privilege_level="server_admin", no_entity_needed=True)
def fn_ipwho(map, client, context, arg):
	names = ''
	for u in AllClients:
		if len(names) > 0:
			names += ', '
		connection = u.connection()
		if not connection:
			continue
		names += "%s [%s]" % (u.name_and_username(), ipaddress.ip_address(connection.ip).exploded or "?")
	respond(context, 'List of users connected: '+names)

@cmd_command(category="Server Admin", privilege_level="server_admin", no_entity_needed=True)
def fn_ipwho2(map, client, context, arg):
	names = ''
	for u in AllConnections:
		if len(names) > 0:
			names += ', '
		names += "%s [%s]" % (u.username, ipaddress.ip_address(u.ip).exploded or "?")
	respond(context, 'List of connections: '+names)

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="ip;reason;length", no_entity_needed=True)
def fn_ipban(map, client, context, arg):
	params = arg.split(';')
	if len(params) == 2: # Default to no expiration
		params.append('')
	if len(params) != 3 or len(params[0]) == 0:
		respond(context, 'Format is ip;reason;length', error=True)
		return
	# Parse the parameters
	ip = params[0]
	if ip == '*.*.*.*': # oh no you don't
		return

	reason = params[1]
	now = datetime.datetime.now()
	expiry = params[2]
	expiry_value = expiry[:-1]
	expiry_unit = expiry[-1:]

	if expiry == '':
		expiry = None
	elif not expiry_value.isdecimal():
		respond(context, 'Invalid time value "%s"', error=True)
		return
	elif expiry_unit == 'm':
		expiry = now + datetime.timedelta(minutes=int(expiry_value))
	elif expiry_unit == 'h':
		expiry = now + datetime.timedelta(hours=int(expiry_value))
	elif expiry_unit == 'd':
		expiry = now + datetime.timedelta(days=int(expiry_value))
	elif expiry_unit == 'w':
		expiry = now + datetime.timedelta(weeks=int(expiry_value))
	elif expiry_unit == 'y':
		expiry = now + datetime.timedelta(weeks=52*int(expiry_value))
	else:
		respond(context, 'Invalid time unit "%s"' % expiry_unit, error=True)
		return

	# If IPv4, split into four parts for masking
	ipv4 = ip.split('.')
	ipv6 = ip.split(':')
	if len(ipv4) == 4:
		# Insert the ban
		c = Database.cursor()
		c.execute("INSERT INTO Server_Ban (ip, ip4_1, ip4_2, ip4_3, ip4_4, admin_id, created_at, expires_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",\
			(ip, ipv4[0], ipv4[1], ipv4[2], ipv4[3], client.db_id, now, expiry, reason))

	elif len(ipv6) == 8:
		# Insert the ban
		c = Database.cursor()
		c.execute("INSERT INTO Server_Ban (ip, ip6_1, ip6_2, ip6_3, ip6_4, ip6_5, ip6_6, ip6_7, ip6_8, admin_id, created_at, expires_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",\
			(ip, ipv6[0], ipv6[1], ipv6[2], ipv6[3], ipv6[4], ipv6[5], ipv6[6], ipv6[7], client.db_id, now, expiry, reason))
	else:
		respond(context, 'Invalid IP format "%s"' % ip, error=True)
		return

	Database.commit()
	respond(context, 'Banned %s for "%s"; unban at %s' % (ip, reason, expiry or "never"))

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="ip", no_entity_needed=True)
def fn_ipunban(map, client, context, arg):
	c = Database.cursor()
	c.execute('DELETE FROM Server_Ban WHERE ip=?', (arg,))
	c.execute('SELECT changes()')
	respond(context, 'Bans removed: %d' % c.fetchone()[0])
	Database.commit()

@cmd_command(category="Server Admin", privilege_level="server_admin", no_entity_needed=True)
def fn_ipbanlist(map, client, context, arg):
	c = Database.cursor()
	results = "IP bans: [ul]"
	for row in c.execute('SELECT b.ip, b.reason, b.created_at, b.expires_at, a.username FROM Server_Ban b, USER a WHERE a.entity_id = b.admin_id'):
		results += "[li][b]%s[/b] banned by [tt]%s[/tt] for \"%s\" at [tt]%s[/tt] until [tt]%s[/tt] [command]ipunban %s[/command][/li]" % (noparse(row[0]), noparse(row[4]), row[1], row[2], row[3] or 'never', row[0])
	results += "[/ul]"
	respond(context, results)

@cmd_command(category="Teleport", privilege_level="no_scripts")
def fn_goback(map, client, context, arg):
	if len(client.tp_history) > 0:
		pos = client.tp_history.pop()
		client.switch_map(pos[0], new_pos=[pos[1], pos[2]], update_history=False)
	else:
		respond(context, 'Nothing in teleport history', error=True)

@cmd_command(category="Teleport", privilege_level="no_scripts")
def fn_sethome(map, client, context, arg):
	client.home_id = client.map_id
	client.home_position = [client.x, client.y]
	respond(context, 'Home set')

@cmd_command(category="Teleport", privilege_level="no_scripts")
def fn_home(map, client, context, arg):
	if client.home_id == None:
		respond(context, 'You don\'t have a home set', error=True)
	else:
		respond(context, 'Teleported to your home')
		client.send_home()

@cmd_command(category="Teleport", syntax="map", privilege_level="no_scripts")
def fn_defaultmap(map, client, context, arg):
	client.switch_map(get_database_meta('default_map'))

@cmd_command(alias=['tpi'], category="Teleport", syntax="map", privilege_level="no_scripts")
def fn_map(map, client, context, arg):
	try:
		s = arg.split()
		if len(s) == 0:
			respond(context, 'Map ID is %d' % map.db_id)
			return
		if len(s) == 1 and string_is_int(s[0]):
			map_id = int(s[0])
			new_pos = None
		elif len(s) == 3 and string_is_int(s[0]) and string_is_int(s[1]) and string_is_int(s[2]):
			map_id = int(s[0])
			new_pos = (int(s[1]), int(s[2]))
		else:
			respond(context, 'Syntax is [tt]/map id[/tt] or [tt]/map id x y[/tt]', error=True)
			return
		if map_id == 0:
			map_id = get_database_meta('default_map')

		if client.switch_map(map_id, new_pos=new_pos):
			respond(context, 'Teleported to map %s' % map_id)
		else:
			respond(context, 'Couldn\'t go to map %s' % map_id, error=True)
	except:
		raise
		respond(context, 'Couldn\'t go to map %s' % map_id, error=True)

@cmd_command(category="Account", privilege_level="registered")
def fn_saveme(map, client, context, arg):
	client.save_and_commit()
	respond(context, 'Account saved')

@cmd_command(category="Account", privilege_level="server_admin", syntax="password", hidden=True, no_entity_needed=True)
def fn_resetpassfor(map, client, context, arg):
	if len(arg):
		id = find_db_id_by_username(arg)
		if id == None:
			failed_to_find(context, arg)
			return
		c = Database.cursor()

		salt = str(random.random())
		randpass = "password"+str(random.random())
		combined = randpass+salt
		hash = "%s:%s" % (salt, hashlib.sha512(combined.encode()).hexdigest())

		c.execute('UPDATE User SET passhash=?, passalgo=? WHERE username=?', (hash, "sha512", filter_username(arg),))
		respond(context, 'Password for %s reset to [tt]%s[/tt]' % (arg, randpass))

@cmd_command(category="Account", privilege_level="registered", syntax="oldpassword password password", no_entity_needed=True)
def fn_changepass(map, client, context, arg):
	if not client.is_client() or context['client'] is not client:
		return
	connection = client.connection()
	if not connection:
		return
	if len(arg):
		connection.changepass(arg)
		respond(context, 'Password changed')
	else:
		respond(context, 'No password given', error=True)

registration_count_by_ip = {}
@cmd_command(category="Account", syntax="username password")
def fn_register(map, client, context, arg):
	if Config["Security"]["NoRegistration"]:
		respond(context, 'Registration is currently disabled', error=True)
		return
	if not client.is_client():
		return
	connection = client.connection()
	if not connection:
		return
	if registration_count_by_ip.get(connection.ip, 0) >= Config["Security"]["MaxRegistrationsPerIP"]:
		respond(context, 'Register fail, your IP has registered too many accounts recently', error=True)
		return
	if connection.db_id != None:
		respond(context, 'Register fail, you already registered', error=True)
	else:
		params = arg.split()
		if len(params) != 2:
			respond(context, 'Syntax is: /register username password', error=True)
		else:
			filtered = filter_username(params[0])
			if valid_id_format(filtered):
				respond(context, 'Can\'t register a username that\'s just a number', error=True)
			elif connection.register(filtered, params[1]):
				map.broadcast("MSG", {'text': client.name+" has now registered"})
				map.broadcast("WHO", {'add': client.who()}) # update client view, probably just for the username
				write_to_connect_log("New account: %s (%s) @ %s" % (client.name, client.username, connection.ip))

				if connection.ip not in registration_count_by_ip:
					registration_count_by_ip[connection.ip] = 0
				registration_count_by_ip[connection.ip] += 1
			else:
				respond(context, 'Register fail, account already exists', error=True)

@cmd_command(category="Account", syntax="username password", no_entity_needed=True, privilege_level="no_scripts")
def fn_login(map, client, context, arg):
	if not client.is_client():
		respond(context, 'Not a client', error=True)
		return
	if client.db_id:
		respond(context, 'You are already logged in', error=True)
		return
	params = arg.split()
	if len(params) != 2:
		respond(context, 'Syntax is /login username password', error=True)
	else:
		connection = client.connection()
		if connection:
			connection.login(filter_username(params[0]), params[1], client)

@cmd_command(no_entity_needed=True, privilege_level="no_scripts")
def fn_disconnect(map, client, context, arg):
	respond(context, 'Goodbye!')
	client.disconnect(reason="Quit")

@cmd_command(category="Settings", syntax='"x y" OR "url" OR "bunny/cat/hamster/fire"')
def fn_userpic(map, client, context, arg):
	arg = arg.split(' ')
	success = False

	client.save_on_clean_up = True

	if len(arg) == 1:
		defaults = {'bunny': [0, 2, 25], 'cat': [0, 2, 26], 'hamster': [0, 8, 25], 'fire': [0, 4,26], 'invisible': [-1, 3, 5], 'snail': [0, 6, 26], 'turtle': [0, 5, 25]}
		if arg[0] in defaults:
			client.pic = defaults[arg[0]];
			success = True
		# Allow custom avatars
		else:
			if arg[0].startswith("http"):
				if image_url_is_okay(arg[0]):
					client.pic = [arg[0], 0, 0];
					success = True
				else:
					respond(context, 'URL doesn\t match any allowlisted sites', error=True)
					return
	elif len(arg) == 2:
		if arg[0].isdecimal() and arg[1].isdecimal():
			client.pic = [0, int(arg[0]), int(arg[1])]
			success = True
	elif len(arg) == 3:
		if string_is_int(arg[0]) and arg[1].isdecimal() and arg[2].isdecimal():
			client.pic = [int(arg[0]), int(arg[1]), int(arg[2])]
			success = True
	if success:
		client.broadcast_who()
	else:
		respond(context, 'Syntax is: /userpic sheet x y', error=True)

# Saved pic functions
def show_saved_pic_list(context, client):
	if client.saved_pics == {}:
		respond(context, "You don't have any saved pics")
	else:
		buttons = []
		for pic in sorted(client.saved_pics.keys(), key=str.casefold):
			buttons.append(pic)
			buttons.append('sp ' + pic)
		respond(context, "Saved pics:", buttons=buttons)

@cmd_command(category="Settings", syntax='state name', alias=['sp', 'savpic', 'savepic'])
def fn_savedpic(map, client, context, arg):
	if not client.is_client():
		respond(context, 'Only clients can use /savedpic', error=True)
		return
	arg = arg.strip().lower()
	if arg == '':
		show_saved_pic_list(context, client)
	elif client.saved_pics and arg in client.saved_pics:
		handlers['userpic'](map, client, context, client.saved_pics[arg])
	else:
		respond(context, "You don't have a saved pic named \"%s\"" % arg, error=True)

@cmd_command(category="Settings", alias=['savepiclist', 'spl', 'savedpics'])
def fn_savedpiclist(map, client, context, arg):
	if not client.is_client():
		respond(context, 'Only clients can use /savedpiclist', error=True)
		return
	if arg == '' or arg.lower() == 'list':
		show_saved_pic_list(context, client)
		return

	subcommand, subarg = separate_first_word(arg)
	if subcommand in ('set', 'add') and subarg:
		picname, picvalue = separate_first_word(subarg)
		if subarg == '':
			picvalue = str(client.pic[0])
		if picvalue.startswith("http"):
			if image_url_is_okay(picvalue):
				client.saved_pics[picname] = picvalue
				respond(context, "Saved pic \"%s\": %s" % (picname, picvalue))
			else:
				respond(context, 'URL doesn\t match any allowlisted sites', error=True)
		else:
			respond(context, 'Not a URL', error=True)
	elif subcommand == 'list2': # Provide it as text just in case
		if client.saved_pics == {}:
			respond(context, "You don't have any saved pics")
		else:
			respond(context, "Saved pics: %s" % ', '.join(sorted(client.saved_pics.keys(), key=str.casefold)))
	elif subcommand in ('del', 'delete', 'remove') and subarg:
		subarg = subarg.lower()
		was = client.saved_pics.pop(subarg, None)
		if was:
			respond(context, 'Deleted saved pic \"%s" (it was %s)' % (subarg, was))
		else:
			respond(context, "You don't have a saved pic named \"%s\"" % subarg, error=True)
	elif subcommand == 'peek' and subarg:
		p = client.saved_pics.get(subarg)
		if p:
			respond(context, 'Saved pic \"%s" is %s' % (subarg, p))
		else:
			respond(context, "You don't have a saved pic named \"%s\"" % subarg, error=True)
	elif subcommand == 'clear':
		client.saved_pics = {}
		respond(context, 'Cleared save pic list')
	else:
		respond(context, 'Unrecognized subcommand "%s"' % subcommand, code='invalid_subcommand', detail=subcommand, error=True)

# Morph functions
def show_morph_list(context, client, quiet=False):
	if client.morphs == {}:
		respond(context, "You don't have any morphs")
	else:
		buttons = []
		for morph in sorted(client.morphs.keys(), key=str.casefold):
			buttons.append(morph)
			buttons.append(('q' if quiet else '') + 'morph ' + morph)
		respond(context, "Morphs:", buttons=buttons)

def morph_shared(map, client, context, arg, quiet):
	if not client.is_client():
		respond(context, 'Only clients can use /morph', error=True)
		return
	arg = arg.strip().lower()
	if arg == '':
		show_morph_list(context, client, quiet)
	elif client.morphs and arg in client.morphs:
		old_name = client.name
		morph = client.morphs[arg]
		client.name = morph.get('name', client.name)
		client.pic = morph.get('pic', client.pic)
		client.desc = morph.get('desc', None)
		client.saved_pics = morph.get('saved_pics', None)
		client.tags = morph.get('tags', {})

		connection = client.connection()
		if connection:
			if morph.get('secret_pic', False):
				connection.user_flags |= userflag['secret_pic']
			else:
				connection.user_flags &= ~userflag['secret_pic']

		client.broadcast_who()
		if client.name != old_name and not quiet:
			map.broadcast("MSG", {'text': "\""+old_name+"\" switches to \""+client.name+"\""})
	else:
		respond(context, "You don't have a morph named \"%s\"" % arg, error=True)

@cmd_command(category="Settings", syntax='morph name', privilege_level="no_scripts")
def fn_morph(map, client, context, arg):
	morph_shared(map, client, context, arg, False)

@cmd_command(category="Settings", syntax='morph name', privilege_level="no_scripts")
def fn_qmorph(map, client, context, arg):
	morph_shared(map, client, context, arg, True)

@cmd_command(category="Settings", alias=['morphs'], privilege_level="no_scripts")
def fn_morphlist(map, client, context, arg):
	if not client.is_client():
		respond(context, 'Only clients can use /morphlist', error=True)
		return
	if arg == '' or arg.lower() == 'list':
		show_morph_list(context, client)
		return

	subcommand, subarg = separate_first_word(arg)
	if subcommand in ('set', 'add') and subarg:
		client.morphs[subarg.lower()] = {
			'name': client.name,
			'pic': client.pic,
			'desc': client.desc,
			'saved_pics': client.saved_pics,
			'tags': client.tags,
			'secret_pic': bool((client.connection_attr('user_flags') or 0) & userflag['secret_pic']),
		}
		respond(context, "Saved morph \"%s\"" % (subarg))
	elif subcommand == 'list2': # Provide it as text just in case
		if client.morphs == {}:
			respond(context, "You don't have any morphs")
		else:
			respond(context, "Morphs: %s" % ', '.join(sorted(client.morphs.keys(), key=str.casefold)))
	elif subcommand in ('del', 'delete', 'remove') and subarg:
		subarg = subarg.lower()
		was = client.morphs.pop(subarg, None)
		if was:
			respond(context, 'Deleted morph \"%s" (it was %s)' % (subarg, was))
		else:
			respond(context, "You don't have a morph named \"%s\"" % subarg, error=True)
	elif subcommand == 'peek' and subarg:
		p = client.morphs.get(subarg)
		if p:
			respond(context, 'Morph \"%s" is %s' % (subarg, p))
		else:
			respond(context, "You don't have a morph named \"%s\"" % subarg, error=True)
	elif subcommand == 'clear':
		client.morphs = {}
		respond(context, 'Cleared morph list')
	else:
		respond(context, 'Unrecognized subcommand "%s"' % subcommand, code='invalid_subcommand', detail=subcommand, error=True)


def synchronize_offset(map, client):
	if client.vehicle != None and client in client.vehicle.passengers and client.vehicle.vehicle is client:
		client.vehicle.offset = client.offset
		map.broadcast("MOV", {"id": client.vehicle.protocol_id(), "offset": client.offset}, remote_category=maplisten_type['move'])

@cmd_command(category="Settings", syntax='"x y"')
def fn_offset(map, client, context, arg):
	arg = arg.split(' ')
	if len(arg) == 2:
		offset_x, offset_y = min(32, max(-32, int(arg[0]))), min(32, max(-32, int(arg[1])))
		client.offset = [offset_x, offset_y]
		map.broadcast("MOV", {"id": client.protocol_id(), "offset": [offset_x, offset_y]}, remote_category=maplisten_type['move'])
	else:
		client.offset = None
		map.broadcast("MOV", {"id": client.protocol_id(), "offset": None}, remote_category=maplisten_type['move'])
	synchronize_offset(map, client)

@cmd_command(category="Settings", syntax='"x y"')
def fn_roffset(map, client, context, arg):
	arg = arg.split(' ')
	if len(arg) == 2:
		offset = client.offset
		if offset == None:
			offset = [0, 0]
		offset_x, offset_y = min(32, max(-32, offset[0] + int(arg[0]))), min(32, max(-32, offset[1] + int(arg[1])))
		client.offset = [offset_x, offset_y]
		map.broadcast("MOV", {"id": client.protocol_id(), "offset": [offset_x, offset_y]}, remote_category=maplisten_type['move'])
	else:
		client.offset = None
		map.broadcast("MOV", {"id": client.protocol_id(), "offset": None}, remote_category=maplisten_type['move'])
	synchronize_offset(map, client)

@cmd_command(category="Settings", syntax='index')
def fn_z(map, client, context, arg):
	if arg == "":
		client.z_index = 0
	elif string_is_int(arg):
		client.z_index = min(10, max(-10, int(arg)))
	map.broadcast("MOV", {"id": client.protocol_id(), "z_index": client.z_index}, remote_category=maplisten_type['move'])

@cmd_command(category="Who", no_entity_needed=True)
def fn_gwho(map, client, context, arg):
	formatted = []
	for u in AllClients:
		formatted.append(u.name_and_username())
	respond(context, 'List of users connected: '+(", ".join(sorted(formatted, key=str.casefold))))

@cmd_command(category="Who", no_entity_needed=True)
def fn_imwho(map, client, context, arg):
	formatted = []
	for c in AllConnections:
		if isinstance(c.entity, Entity) and c.identified:
			continue
		formatted.append(c.username)
	respond(context, 'List of messaging users: '+(", ".join(sorted(formatted, key=str.casefold))))

@cmd_command(category="Who", no_entity_needed=True)
def fn_clientwho(map, client, context, arg):
	all_client_names = {}
	for u in AllClients:
		client_name = u.connection_attr('client_name')
		if client_name not in all_client_names:
			all_client_names[client_name] = set()
		all_client_names[client_name].add(u)

	out = ''
	for k,v in all_client_names.items():
		out += "[li][b]%s[/b]: " % noparse(k or "?")

		users = []
		for u in v:
			users.append(u.name_and_username())
		out += (", ".join(sorted(users, key=str.casefold)))+"[/li]"
	respond(context, 'List of clients in use: [ul]'+out+'[/ul]')

@cmd_command(category="Who")
def fn_who(map, client, context, arg):
	names = ''
	formatted = []
	for u in map.contents:
		if not u.is_client():
			continue
		formatted.append(u.name_and_username())
	respond(context, 'List of users here: '+(", ".join(sorted(formatted, key=str.casefold))))

@cmd_command(category="Who", syntax="name")
def fn_look(map, client, context, arg):
	if not len(arg):
		return
	e = find_local_entity_by_name(map, arg)
	if e != None:
		respond(context, 'Description of [b]%s[/b]: %s' % (e.name, e.desc))
	else:
		respond(context, '[b]%s[/b] not found' % arg, error=True)

@cmd_command(category="Who", syntax="name", no_entity_needed=True)
def fn_last(map, client, context, arg):
	if len(arg):
		id = find_db_id_by_username(arg)
		if id == None:
			failed_to_find(context, arg)
			return
		if id in AllEntitiesByDB:
			respond(context, '%s is online right now!' % arg)
		else:
			on_messaging = False
			for connection in AllConnections:
				if connection.db_id == id:
					on_messaging = True
					break

			c = Database.cursor()
			c.execute('SELECT last_seen_at FROM User WHERE entity_id=?', (id,))
			result = c.fetchone()
			if result == None:
				return
			respond(context, '%s last seen at %s%s' % (arg, result[0].strftime("%Y-%m-%d, %I:%M %p"), " (but is connected)" if on_messaging else "" ))

@cmd_command(category="Who", alias=['wa'], no_entity_needed=True)
def fn_whereare(map, client, context, arg):
	override = hasattr(client, 'connection') and client.connection_attr('oper_override')

	formatted = []
	for m in AllMaps:
		names = ''
		if not override and (m.map_flags & mapflag['public'] == 0):
			continue
		user_count = m.count_users_inside()
		if user_count == 0:
			continue

		names += '[li][b]%s[/b] (%d): ' % (noparse(m.name), user_count)
		users = []
		for u in m.contents:
			if u.is_client() and (override or (u.connection_attr('user_flags') & userflag['hide_location'] == 0)):
				if arg == 'c' or arg == 'C':
					users.append('%s<%d,%d>, ' % (u.name_and_username(), u.x, u.y))
				else:
					users.append(u.name_and_username())
		names += ", ".join(sorted(users, key=str.casefold)) + ' | [command]map %d[/command]' % m.db_id
		if m.topic:
			names += ' (📅[i]"%s" by %s[/i])' % (m.topic, m.topic_username)
		names += '[/li]'
		formatted.append(names)

	names = 'Whereare: [ul]'+("".join(sorted(formatted, key=str.casefold)))+'[/ul]'
	respond(context, names)

@cmd_command(alias=['ewho'], category="Who")
def fn_entitywho(map, client, context, arg):
	formatted = []
	for u in map.contents:
		formatted.append(u.name_and_username())
	respond(context, 'List of entities here: '+(", ".join(sorted(formatted, key=str.casefold))))

@cmd_command(category="Map")
def fn_savemap(map, client, context, arg):
	if not map.temporary:
		map.save_and_commit()
		map.broadcast("MSG", {'text': client.name+" saved the map"})
	else:
		respond(context, 'This map has map saving turned off')

# Server admin commands
@cmd_command(category="Server Admin", privilege_level="server_admin", no_entity_needed=True)
def fn_operoverride(map, client, context, arg):
	connection = client.connection()
	if connection:
		connection.oper_override = not connection.oper_override
		respond(context, "Oper override enabled" if connection.oper_override else "Oper override disabled")

@cmd_command(category="Server Admin", privilege_level="server_admin", no_entity_needed=True)
def fn_broadcast(map, client, context, arg):
	if len(arg) > 0:
		broadcast_to_all("Admin broadcast: "+arg)

@cmd_command(category="Server Admin", privilege_level="server_admin", no_entity_needed=True)
def fn_kill(map, client, context, arg):
	u = find_client_by_username(arg)
	if u != None:
		respond(context, 'Kicked '+u.name_and_username())
		u.disconnect('Kicked by '+client.name_and_username(), reason="Kick")
	else:
		u = find_connection_by_username(arg)
		if u != None:
			respond(context, 'Kicked connection '+arg)
			u.disconnect('Kicked by '+client.name_and_username(), reason="Kick")

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="cancel/seconds", no_entity_needed=True)
def fn_shutdown(map, client, context, arg):
	global ServerShutdown
	if arg == "cancel" and ServerShutdown[0] != -1:
		ServerShutdown[0] = -1
		broadcast_to_all("Server shutdown canceled")
	elif arg.isdecimal():
		ServerShutdown[0] = int(arg)
		ServerShutdown[1] = False
		broadcast_to_all("Server shutdown in %d seconds! (started by %s)" % (ServerShutdown[0], client.username))

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="cancel/seconds", alias=['serverrestart'], no_entity_needed=True)
def fn_restartserver(map, client, context, arg):
	global ServerShutdown
	if arg == "cancel" and ServerShutdown[0] != -1:
		ServerShutdown[0] = -1
		broadcast_to_all("Server restart canceled")
	elif arg.isdecimal():
		ServerShutdown[0] = int(arg)
		ServerShutdown[1] = True
		broadcast_to_all("Server restarting in %d seconds! (started by %s)" % (ServerShutdown[0], client.username))

# Experimental
@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="text", no_entity_needed=True)
def fn_parktext(map, client, context, arg):
	GlobalData['park_text'] = arg
	if not len(arg):
		GlobalData['park_map'] = None
		GlobalData['park_map_button'] = None
	respond(context, 'Park text="%s"' % (GlobalData.get('park_text')))

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="text")
def fn_parkhere(map, client, context, arg):
	GlobalData['park_map_button'] = arg if len(arg) else None
	GlobalData['park_map'] = "map %d %d %d" % (client.map_id, client.x, client.y)
	respond(context, 'Park map="%s"' % (GlobalData.get('park_map')))

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="text", no_entity_needed=True)
def fn_parkmap(map, client, context, arg):
	if len(arg):
		GlobalData['park_map'] = "map "+arg
	else:
		GlobalData['park_map'] = None
	respond(context, 'Park map="%s"' % (GlobalData.get('park_map')))

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="text", no_entity_needed=True)
def fn_parkmapbutton(map, client, context, arg):
	GlobalData['park_map_button'] = arg or None
	respond(context, 'Park map button="%s"' % (GlobalData.get('park_map_button')))

# Group commands
@cmd_command(category="Group", privilege_level="registered", no_entity_needed=True)
def fn_newgroup(map, client, context, arg):
	group = Entity(entity_type['group'], creator_id = client.db_id)
	group.name = "Unnamed group"
	group.save_and_commit()
	group.clean_up()
	respond(context, 'Created group %d' % group.db_id)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id text", no_entity_needed=True)
def fn_namegroup(map, client, context, arg):
	groupid, name = separate_first_word(arg)
	if not groupid.isdecimal() or not len(name):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET name=? WHERE id=? AND owner_id=? AND type=?', (name, int(groupid), client.db_id, entity_type['group']))
	respond(context, 'Renamed group %s' % groupid)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id text", no_entity_needed=True)
def fn_descgroup(map, client, context, arg):
	groupid, desc = separate_first_word(arg)
	if not groupid.isdecimal() or not len(desc):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET desc=? WHERE id=? AND owner_id=? AND type=?', (desc, int(groupid), client.db_id, entity_type['group']))
	respond(context, 'Described group %s' % groupid)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id new_owner", no_entity_needed=True)
def fn_changegroupowner(map, client, context, arg):
	groupid, owner = separate_first_word(arg)
	if not groupid.isdecimal() or not len(owner):
		return
	newowner = find_db_id_by_username(owner)
	if newowner:
		c = Database.cursor()
		c.execute('UPDATE Entity SET owner_id=? WHERE id=? AND owner_id=? AND type=?', (newowner, int(groupid), client.db_id, entity_type['group']))
		respond(context, 'Group owner set to \"%s\"' % owner)
	else:
		respond(context, 'Nonexistent account', error=True)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id password", no_entity_needed=True)
def fn_joinpassgroup(map, client, context, arg):
	groupid, joinpass = separate_first_word(arg)
	if not groupid.isdecimal() or not len(joinpass):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET data=? WHERE id=? AND owner_id=? AND type=?', (joinpass, int(groupid), client.db_id, entity_type['group']))
	respond(context, 'Updated join password for group %s to [tt]%s[/tt]' % (groupid, joinpass))

@cmd_command(category="Group", privilege_level="registered", syntax="group_id", no_entity_needed=True)
def fn_deletegroup(map, client, context, arg):
	if is_entity_owner(arg, client):
		c = Database.cursor()
		c.execute('DELETE FROM Entity WHERE id=?',        (int(arg),))
		c.execute('DELETE FROM Group_Member WHERE group_id=?', (int(arg),))
		c.execute('DELETE FROM Permission WHERE gid=?',   (int(arg),))
		respond(context, 'Deleted group %s' % arg)

@cmd_command(category="Group", privilege_level="registered", no_entity_needed=True)
def fn_invitetogroup(map, client, context, arg):
	pass

@cmd_command(category="Group", privilege_level="registered", syntax="group_id [password]", no_entity_needed=True)
def fn_joingroup(map, client, context, arg):
	groupid, password = separate_first_word(arg)
	if groupid.isdecimal() and client.db_id and sql_exists('SELECT * FROM Entity WHERE data=? AND type=?', (password, entity_type['group'])):
		if not sql_exists('SELECT member_id from Group_Member WHERE member_id=? AND group_id=?', (client.db_id, int(groupid))):
			c = Database.cursor()
			c.execute("INSERT INTO Group_Member (group_id, member_id, flags, accepted_at) VALUES (?, ?, ?, ?)", (int(groupid), client.db_id, 0, datetime.datetime.now(),))
			respond(context, 'Joined group %s' % groupid)
		else:
			respond(context, 'Already in group %s' % groupid, error=True)
	else:
		respond(context, 'Nonexistent group or wrong password', error=True)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id", no_entity_needed=True)
def fn_leavegroup(map, client, context, arg):
	if not arg.isdecimal():
		return
	c = Database.cursor()
	c.execute('DELETE FROM Group_Member WHERE group_id=? AND member_id=?', (int(arg), client.db_id,))
	respond(context, 'Left group %s' % (arg))

@cmd_command(category="Group", privilege_level="registered", no_entity_needed=True)
def fn_kickgroup(map, client, context, arg):
	groupid, person = separate_first_word(arg)
	if is_entity_owner(groupid, client):
		if not len(person):
			return
		personid = find_db_id_by_username(person)
		if personid:
			c = Database.cursor()
			c.execute('DELETE FROM Group_Member WHERE group_id=? AND user_id=?', (int(groupid), personid,))
			respond(context, 'Kicked \"%s\" from group %s' % (person, groupid))
		else:
			respond(context, 'Nonexistent account', error=True)

# Perhaps merge these two somehow?
@cmd_command(category="Group", privilege_level="registered", no_entity_needed=True)
def fn_ownedgroups(map, client, context, arg):
	c = Database.cursor()
	formatted = []
	for row in c.execute('SELECT g.id, g.name FROM Entity g WHERE g.owner_id=? AND type=?', (client.db_id, entity_type['group'])):
		groups += "[li][b]%s[/b] (%d)[/li]" % (noparse(row[1]), row[0])
	groups = "Groups you are own: [ul]" + ("".join(sorted(formatted, key=str.casefold))) + "[/ul]"
	respond(context, groups)

@cmd_command(category="Group", privilege_level="registered", no_entity_needed=True)
def fn_mygroups(map, client, context, arg):
	c = Database.cursor()
	formatted = []
	for row in c.execute('SELECT g.id, g.name, m.accepted_at FROM Entity g, Group_Member m WHERE g.id=m.group_id AND m.member_id=?', (client.db_id,)):
		if row[2]:
			formatted.append("[li][b]%s[/b] (%d)[/li]" % (noparse(row[1]), row[0]))
		else:
			formatted.append("[li][b]%s[/b] (%d)[/li] - Invited" % (noparse(row[1]), row[0]))
	groups = "Groups you are in: [ul]"+("".join(sorted(formatted, key=str.casefold)))+"[/ul]"
	respond(context, groups)

@cmd_command(category="Group")
def fn_groupmembers(map, client, context, arg, no_entity_needed=True):
	if not arg.isdecimal():
		respond(context, "Group ID should be an integer", error=True)
		return
	group_id = int(arg)
	group_name = find_entity_name(group_id)
	if group_name == None:
		respond(context, "Group ID %s not found" % arg, error=True)
		return
	c = Database.cursor()
	formatted = []
	for row in c.execute('SELECT g.id, g.name, m.accepted_at FROM Entity g, Group_Member m WHERE m.group_id=? AND m.member_id=g.id', (group_id,)):
		if row[2] == None:
			formatted.append("[li][b]%s[/b] (%d) - Invited[/li]" % (row[1], row[0]))
		else:
			formatted.append("[li][b]%s[/b] (%d)[/li]" % (row[1], row[0]))
	groups = "Group %d (%s) members: [ul]%s[/ul]" % (group_id, group_name, "".join(sorted(formatted, key=str.casefold)))
	respond(context, groups)

@cmd_command(privilege_level="registered", hidden=True)
def fn_selfown(map, client, context, arg):
	if client.is_client():
		if arg == '!':
			client.owner_id = None
			respond(context, "Reset your ownership to none")
		elif len(arg):
			id = find_db_id_by_username(arg)
			if id == None:
				failed_to_find(context, arg)
			elif not client.has_permission(id, permission['set_owner_to_this'], False):
				respond(context, "You don't have permission to change ownership to %s" % arg)
			else:
				client.owner_id = id
				respond(context, "Changed your ownership to %s" % arg)
			return
		elif client.db_id:
			client.owner_id = client.db_id
			respond(context, "Reset your ownership to yourself")
		else:
			client.owner_id = None
			respond(context, "Reset your ownership to none")	

@cmd_command(alias=['myid', 'userid'], privilege_level="registered", no_entity_needed=True)
def fn_whoami(map, client, context, arg):
	if client.username == None:
		respond(context, "Your [b]%s[/b]! Your ID is [b]%s[/b] and you have not registered" % (client.name, client.protocol_id()))
	else:
		respond(context, "Your [b]%s[/b]! Your ID is [b]%s[/b] and your username is [b]%s[/b]" % (client.name, client.protocol_id(), client.username))

@cmd_command(alias=['undodelete', 'delundo'], map_only=True)
def fn_undodel(map, client, context, arg):
	if not client.is_client() or not map.is_map():
		return
	connection = client.connection()
	if not connection:
		return
	if not connection.undo_delete_data:
		respond(context, "There's nothing to undo")
		return
	if time.time() - connection.undo_delete_when > 300: # 5 Minute limit
		respond(context, "Last undo was more than 5 minutes ago")
		return
	pos = connection.undo_delete_data["pos"]
	write_to_build_log(map, client, "DEL", "undo:%d,%d,%d,%d" % (pos[0], pos[1], pos[2], pos[3]))

	map.apply_map_section(connection.undo_delete_data)
	map.broadcast("DEL", {"undo": True, "pos": connection.undo_delete_data["pos"], "username": client.username_or_id()}, remote_only=True, remote_category=maplisten_type['build'])
	connection.undo_delete_data = None

	respond(context, "🐶 Undid the delete!")

@cmd_command(privilege_level="map_admin", map_only=True)
def fn_applymapsection(map, client, context, arg):
	map.apply_map_section(json.loads(arg))

import gc
@cmd_command(alias=['debugref'], privilege_level="server_admin", no_entity_needed=True)
def fn_debugrefs(map, client, context, arg):
	if len(arg) == 0:
		return
	e = get_entity_by_id(arg, load_from_db=False)
	if e == None:
		respond(context, '"%s" not a valid ID' % arg, error=True)
		return
	respond(context, '🍕'.join(repr(x) for x in gc.get_referrers(e)))

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_debugref2(map, client, context, arg):
	if len(arg) == 0:
		return
	e = get_entity_by_id(arg, load_from_db=False)
	if e == None:
		respond(context, '"%s" not a valid ID' % arg, error=True)
		return
	respond(context, '🍕'.join(repr(x) for x in gc.get_referents(e)))

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_pyeval(map, client, context, arg):
	if len(arg) == 0:
		return
	respond(context, str(eval(arg.replace("✨", "\n"))))

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_pyexec(map, client, context, arg):
	if len(arg) == 0:
		return
	respond(context, str(exec(compile(arg.replace("✨", "\n"), "test", "exec"))))

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_scriptstatus(map, client, context, arg):
	GlobalData['request_script_status'](client, arg)

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_scriptstop(map, client, context, arg):
	if len(arg) == 0:
		return
	GlobalData['shutdown_scripting_service'](int(arg))

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_flushlogs(map, client, context, arg):
	if ConnectLog:
		ConnectLog.flush()
	if BuildLog:
		BuildLog.flush()
	if UploadLog:
		UploadLog.flush()

@cmd_command(privilege_level="server_admin", alias=['connecthistory'], no_entity_needed=True)
def fn_connectlog(map, client, context, arg):
	if arg != 'c':
		respond(context, "Connection log (%d):[ul]%s[/ul]" % (len(TempLogs[0]), ''.join("[li]%s[/li]" % noparse(_) for _ in TempLogs[0])), class_type="secret_message")
	if arg != 'k':
		TempLogs[0].clear()
		registration_count_by_ip.clear()

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_buildlog(map, client, context, arg):
	if arg != 'c':
		respond(context, "Build log (%d):[ul]%s[/ul]" % (len(TempLogs[1]), ''.join("[li]%s[/li]" % noparse(_) for _ in TempLogs[1])), class_type="secret_message")
	if arg != 'k':
		TempLogs[1].clear()

@cmd_command(privilege_level="server_admin", no_entity_needed=True, alias=['filelog', 'fileuploadlog'])
def fn_uploadlog(map, client, context, arg):
	if arg != 'c':
		respond(context, "Upload log (%d):[ul]%s[/ul]" % (len(TempLogs[2]), ''.join("[li]%s[/li]" % _ for _ in TempLogs[2])), class_type="secret_message")
	if arg != 'k':
		TempLogs[2].clear()

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_rrb(map, client, context, arg):
	def find_info(i):
		for r in TempLogs[3]:
			if r.temp_id == i:
				return r
		return None
	if arg == "":
		out = ""
		skipped = 0
		for r in TempLogs[3]:
			if not r.maps:
				skipped += 1
				continue
			out += "[li][b]%s: %s (%s) @ %s[/b]: Built %d, Deleted %d - %s | 💣[command]rrb R %d[/command][/li]" % (r.time.strftime("(%Y-%m-%d)"), noparse(r.name or "?"), noparse(r.username or "?"), r.ip, r.total_put, r.total_delete, ' '.join('[command]rrb i %d %s[/command](%d)' % (r.temp_id, _, len(r.maps[_])) for _ in r.maps.keys()), r.temp_id)
		respond(context, "Rollback data (%d):[ul]%s[/ul]" % (len(TempLogs[3])-skipped, out), class_type="secret_message")
		return
	elif arg == "c":
		TempLogs[3].clear()
		return
	elif arg == "?":
		respond(context, "i = map info, I = more info, r = rollback map, R = rollback all", class_type="secret_message")
		return
	elif arg == "a":
		respond(context, "[url]%s/v1/moderation/rrb?pass=%s[/url]" % (Config["API"]["URL"], Config["API"]["AdminPassword"]), class_type="secret_message")
		return

	args = arg.split()
	if len(args) == 0:
		return
	if args[0] == "i" or args[0] == "I" or args[0] == "II":
		info = find_info(int(args[1]))
		if info:
			amount = 500 if args[0] == "II" else (100 if args[0] == "I" else 25)
			m = info.maps.get(int(args[2]))
			if m:
				out = ""
				for e in m:
					a = e.splitlines()
					if a[0] == 't':
						out += "[li]T %s,%s: %s | %s[/li]" % (a[1], a[2], a[3], a[4])
					elif a[0] == 'o':
						out += "[li]O %s,%s: %s | %s[/li]" % (a[1], a[2], a[3], a[4])
					elif a[0] == 'd':
						out += "[li]D %s,%s,%s,%s | %s[/li]" % (a[1], a[2], a[3], a[4], a[5])

					amount -= 1
					if amount == 0:
						break
				respond(context, "Rollback data [command]rrb r %s %s[/command][command]map %s[/command]:[ul]%s[/ul]" % (args[1], args[2], args[2], out), class_type="secret_message")
			else:
				respond(context, "Session %s map %s not found" % (args[1], args[2]), class_type="secret_message")
		else:
			respond(context, "Session %s not found" % args[1], class_type="secret_message")
	elif args[0] == "r":
		info = find_info(int(args[1]))
		if info:
			non_matching_tiles = info.rollback_map(int(args[2]))
			if non_matching_tiles == None:
				respond(context, "Rollback data not present for %s map %s" % (args[1], args[2]), class_type="secret_message")
			else:
				respond(context, "Rolled back session %s map %s (conflicts: %s)" % (args[1], args[2], non_matching_tiles), class_type="secret_message")
		else:
			respond(context, "Session %s not found" % args[1], class_type="secret_message")
	elif args[0] == "R":
		info = find_info(int(args[1]))
		if info:
			respond(context, "Rolled back session %s (conflicts: %s)" % (args[1], info.rollback_all()), class_type="secret_message")
		else:
			respond(context, "Session %s not found" % args[1], class_type="secret_message")

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_deleteuserfile(map, client, context, arg):
	if arg == "":
		return
	arg = int(arg)
	result = admin_delete_uploaded_file(arg)
	if result == True:
		respond(context, "Deleted user file %d" % arg)
	elif result == False:
		respond(context, "Can't delete user file %d" % arg)
	elif result == None:
		respond(context, "Didn't find user file %d" % arg)

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_reuploaduserfile(map, client, context, arg):
	if arg == "":
		return
	asyncio.ensure_future(reupload_entity_images(client, arg))

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_updateimageeverywhere(map, client, context, arg):
	if arg == "":
		return
	arg = arg.split()
	if len(arg) != 2:
		respond(context, "Need to provide old and new URLs" % arg, error=True)
		return
	update_image_url_everywhere(None, arg[0], arg[1])
	print(arg)
	respond(context, "Switched entities using [url]%s[/url] to use [url]%s[/url]" % tuple(arg))

@cmd_command(privilege_level="server_admin", no_entity_needed=True, alias=['fixuserfilesize'])
def fn_fixuserfilesizes(map, client, context, arg):
	if arg == "":
		arg = None
	else:
		arg = int(arg)
	fixed, removed = fix_uploaded_file_sizes(arg)
	respond(context, "Fixed %d file sizes, removed %d files" % (fixed, removed))

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_rehash(map, client, context, arg):
	loadConfigJson(clearLogs=(arg == "c"))
	respond(context, 'Reloaded the config file')

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_debugkick(map, client, context, arg):
	if len(arg) == 0:
		return
	e = get_entity_by_id(arg, load_from_db=False)
	if e == None:
		respond(context, '"%s" not a valid ID' % arg, error=True)
		return
	if e.is_client():
		e.disconnect(reason="Kick")
	e.clean_up()
	AllEntitiesByID.pop(e.id, None)
	if e.db_id:
		AllEntitiesByDB.pop(e.db_id, None)

@cmd_command(alias=['e'], no_entity_needed=True, privilege_level="no_scripts")
def fn_entity(map, client, context, arg):
	self_is_entity = is_entity(client)

	# Parse
	provided_id, subcommand = separate_first_word(arg)
	subcommand, subarg = separate_first_word(subcommand)
	if subcommand == '':
		subcommand = 'info'

	# Can use "me" and "here" as special IDs
	e = None
	if provided_id == 'me' and self_is_entity:
		e = client
	elif provided_id == 'here':
		e = map
	elif valid_id_format(provided_id):
		e = get_entity_by_id(provided_id)

	if e == None:
		respond(context, '"%s" not a valid ID' % provided_id, error=True)
		return
	subcommand = subcommand.lower()

	# ---------------------------------

	def permission_check(perm, default=False, error=True):
		if client.has_permission(e, perm, default):
			return True
		elif error:
			respond(context, "Don\'t have permission to use \"/entity %s\" on %s" % (subcommand, provided_id), error=True)
			return False

	def temp_permission_args():
		param = subarg.lower().split(' ')
		if len(param) < 2:
			respond(context, 'Must specify a permission and a username', error=True)
			return False
		# Has to be a valid permission
		perm_values = 0
		for perm in param[0].split(','):
			if perm not in permission:
				respond(context, '"%s" not a valid permission' % perm, error=True)
				return False
			perm_values |= permission[perm]
		actor = find_client_by_username(param[1])
		if actor == None:
			respond(context, '"%s" not online' % param[1], error=True)
			return False
		return (actor, perm_values)

	save_entity = False

	if subcommand == 'info':
		info = '[b]%s (%s)[/b] - %s' % (e.name, e.protocol_id(), entity_type_name[e.entity_type])
		if e.desc:
			info += '\n[b]Description:[/b] %s' % e.desc

		if e.is_client() and e.username:
			info += '\n[b]Username:[/b] %s' % e.username
		if e.owner_id:
			owner_username = find_username_by_db_id(e.owner_id)
			info += '\n[b]Owner:[/b] %s' % owner_username
		if e.creator_id:
			creator_username = find_username_by_db_id(e.creator_id)
			info += '\n[b]Creator:[/b] %s' % creator_username
		if len(e.contents) and ((e.is_map() and (e.map_flags & mapflag['public'])) or client.has_permission(e, permission['list_contents'], False)):
			info += '\n[b]Contents:[/b] %s' % ', '.join(sorted((c.name_and_username() for c in e.contents), key=str.casefold))
		respond(context, info)
	elif subcommand == 'locate':
		if e.is_client() and not client.connection_attr('oper_override') and \
			((e.connection_attr('user_flags') & userflag['hide_location'] != 0) or (e.map and e.map.is_map() and (e.map.map_flags & mapflag['public'] == 0))):
			respond(context, "That user's location is private")
		else:
			info = '[b]%s (%s)[/b]' % (e.name, e.protocol_id())
			if e.map == None:
				info += " doesn't have a location"
			else:
				info += ' is at ' + e.map.name_and_username()
			if not e.map or (e.map and e.map.db_id != e.map_id):
				info += ' (or %s?)' % e.map_id
			respond(context, info)
	elif subcommand == 'name':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			e.name = subarg.replace('\n', '')
			e.broadcast_who()
		save_entity = True
	elif subcommand == 'desc':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			e.desc = subarg
		save_entity = True
	elif subcommand == 'pic':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			pic = load_json_if_valid(subarg)
			if pic and pic_is_okay(subarg):
				e.pic = pic
				e.broadcast_who()
			else:
				respond(context, "Invalid picture", error=True)
		save_entity = True

	elif subcommand == 'take' and self_is_entity:
		if permission_check(permission['move_new_map']):
			e.switch_map(client, on_behalf_of=client)
			save_entity = True
	elif subcommand in ('drop', 'summon') and self_is_entity:
		kick_from_inventory = (e.map_id == client.db_id and client.db_id != None) or (e.map is client) or (e.map and e.map.owner_id == client.db_id and client.db_id != None)
		if kick_from_inventory or permission_check( (permission['move'], permission['move_new_map']) ):
			if kick_from_inventory or (e.map_id is client.map_id or permission_check(permission['move_new_map'])):
				if not e.switch_map(client.map_id, new_pos=[client.x, client.y], on_behalf_of=client):
					respond(context, "Entity \"%s\" doesn't have permission to go to this map" % provided_id, error=True)
				save_entity = True
	elif subcommand == 'kick':
		if (e.map_id == client.db_id and client.db_id != None) or (e.map is client) or (e.map and e.map.owner_id == client.db_id and client.db_id != None) or client.has_permission(e.map_id, (permission['admin'], permission['sandbox']), False):
			e.send_home()
			save_entity = True

	elif subcommand == 'tags':
		respond(context, "Tags: %s" % dumps_if_not_empty(e.tags))

	elif subcommand in ('addtag_root', 'settag_root'):
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			key, value = separate_first_word(subarg)
			e.set_tag(None, key, value)
			save_entity = True
	elif subcommand == 'deltag_root':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			e.del_tag(None, subarg)
			save_entity = True

	elif subcommand in ('addtag', 'settag'):
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			group, sub2 = separate_first_word(subarg)
			key, value = separate_first_word(sub2)
			e.set_tag(group, key, value)
			save_entity = True
	elif subcommand == 'deltag':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			group, key = separate_first_word(subarg)
			e.del_tag(group, key)
			save_entity = True

	elif subcommand == 'do':
		if permission_check(permission['remote_command']):
			handle_user_command(e.map, e, context, subarg)
	elif subcommand == 'say':
		if permission_check(permission['remote_command']):
			handle_user_command(e.map, e, context, "say "+subarg)
	elif subcommand == 'me':
		if permission_check(permission['remote_command']):
			handle_user_command(e.map, e, context, "me "+subarg)
	elif subcommand == 'use':
		if e != None and e.entity_type == entity_type['gadget']:
			e.receive_use(client)

	elif subcommand == 'rmove':
		if permission_check(permission['move']):
			coords = subarg.split()
			if len(coords) >= 2 and string_is_int(coords[0]) and string_is_int(coords[1]):
				from_x = e.x
				from_y = e.y	
				new_x = e.x + int(coords[0])
				new_y = e.y + int(coords[1])
				if len(coords) >= 3 and string_is_int(coords[2]):
					e.dir = int(coords[2])
				e.move_to(new_x, new_y) # Will mark the entity for saving
				if e.map:
					if e.is_client():
						e.map.broadcast("MOV", {'id': e.protocol_id(), 'to': [new_x, new_y], 'dir': e.dir}, remote_category=maplisten_type['move'])
					else:
						e.map.broadcast("MOV", {'id': e.protocol_id(), 'from': [from_x, from_y], 'to': [new_x, new_y], 'dir': e.dir}, remote_category=maplisten_type['move'], mov_user=e)
	elif subcommand == 'move':
		if permission_check(permission['move']):
			coords = subarg.split()
			if len(coords) >= 2 and string_is_int(coords[0]) and string_is_int(coords[1]):
				from_x = e.x
				from_y = e.y
				new_x = int(coords[0])
				new_y = int(coords[1])
				if len(coords) >= 3 and string_is_int(coords[2]):
					e.dir = int(coords[2])
				e.move_to(new_x, new_y) # Will mark the entity for saving
				if e.map:
					if e.is_client():
						e.map.broadcast("MOV", {'id': e.protocol_id(), 'to': [new_x, new_y], 'dir': e.dir}, remote_category=maplisten_type['move'])
					else:
						e.map.broadcast("MOV", {'id': e.protocol_id(), 'from': [from_x, from_y], 'to': [new_x, new_y], 'dir': e.dir}, remote_category=maplisten_type['move'], mov_user=e)
	elif subcommand == 'perms':
		handlers['permlist'](e, client, context, subarg)
	elif subcommand == 'permsfor':
		if subarg.isdecimal():
			allow, deny = e.get_allow_deny_for_other_entity(int(subarg))
			text = 'Allow: %s\nDeny: %s' % (permission_list_from_bitfield(allow), permission_list_from_bitfield(deny))

			# Add temporary permissions if they're there
			other_entity = find_client_by_username(subarg)
			if other_entity != None and other_entity in e.temp_permissions:
				text += '\nAllow (temporary): %s' % permission_list_from_bitfield(e.temp_permissions[other_entity])
			response(context, text)
	elif subcommand == 'grant':
		if permission_check(permission['admin']):
			permission_change(e, client, context, subarg, 'grant')
	elif subcommand == 'revoke':
		if permission_check(permission['admin']):
			permission_change(e, client, context, subarg, 'revoke')
	elif subcommand == 'deny':
		if permission_check(permission['admin']):
			permission_change(e, client, context, subarg, 'deny')

	elif subcommand == 'tempgrant':
		if permission_check(permission['admin']):
			params = temp_permission_args()
			if params == False:
				return
			actor, permission_value = params
			actor.temp_permissions[e] = actor.temp_permissions.get(e, 0) | permission_value
			e.temp_permissions_given_to.add(actor)
			if permission_value == permission['minigame'] and actor.entity_type == entity_type['gadget'] and e in actor.want_controls_for:
				actor.take_controls(e, actor.want_controls_key_set, pass_on=actor.want_controls_pass_on, key_up=actor.want_controls_key_up)
	elif subcommand == 'temprevoke':
		if permission_check(permission['admin']):
			params = temp_permission_args()
			if params == False:
				return
			actor, permission_value = params
			if actor in e.temp_permissions:
				actor.temp_permissions[e] &= ~permission_value
				if actor.temp_permissions[e] == 0:
					del actor.temp_permissions[e]
					e.temp_permissions_given_to.discard(actor)
	elif subcommand == 'temprevokeall':
		if permission_check(permission['admin']):
			for other_entity in e.temp_permissions_given_to:
				other_entity.temp_permissions.pop(e, None)
			e.temp_permissions_given_to.clear()
	elif subcommand == 'temprelease':
		if permission_check(permission['admin']):
			actor = find_client_by_username(subarg)
			if actor != None:
				actor.temp_permissions_given_to.discard(e)
				e.temp_permissions.pop(actor, None)

	elif subcommand == 'delete':
		if e.is_client():
			respond(context, 'Can\'t delete "%s"' % provided_id, error=True)
			return
		elif client.connection_attr('oper_override'):
			pass
		elif e.owner_id == None and e.creator_temp_id and e.creator_temp_id not in AllEntitiesByID:
			pass
		elif e.creator_temp_id == client.id:
			pass
		elif e.owner_id == None or e.owner_id != client.db_id:
			respond(context, 'You don\'t have permission to deletes "%s"' % provided_id, error=True)
			return

		# Move everything inside to the parent
		for child in e.contents.copy():
			e.remove_from_contents(child)
			if e.map:
				e.map.add_to_contents(child)

		# Delete from the database too
		if e.db_id:
			c.execute('DELETE FROM Entity WHERE owner_id=? AND id=?', (client.db_id, e.db_id))
		if e.map:
			e.map.remove_from_contents(e)
		e.save_on_clean_up = False
		e.clean_up()

	elif subcommand == 'save':
		if permission_check(permission['remote_command']) and not e.temporary: # Maybe use a different permission? Or none
			e.save()

	else:
		respond(context, 'Unrecognized subcommand "%s"' % subcommand, code='invalid_subcommand', detail=subcommand, error=True)

	if save_entity:
		e.save_on_clean_up = True

@cmd_command(no_entity_needed=True)
def fn_test_entities_loaded(map, client, context, arg):
	if not len(arg):
		respond(context, 'Provide a list of entities', error=True)
		return
	# For the notice at the end
	entities_loaded = []
	entities_not_found = []

	# For all of the entities...
	for entity_id in arg.split(','):
		entity = get_entity_by_id(entity_id, load_from_db=False)
		if entity == None:
			entities_not_found.append(entity_id)
			continue
		entities_loaded.append(entity_id)
	respond(context, 'Loaded: %s. Not found: %s.' % (','.join(entities_loaded), ','.join(entities_not_found),), data={'loaded': entities_loaded, 'not_found': entities_not_found})

@cmd_command(no_entity_needed=True)
def fn_keep_entities_loaded(map, client, context, arg):
	if not len(arg):
		respond(context, 'Provide a list of entities', error=True)
		return
	# For the notice at the end
	entities_set = []
	entities_not_found = []
	entities_not_allowed = []

	new_keep_entities_loaded = set()

	# For all of the entities...
	for entity_id in arg.split(','):
		entity = get_entity_by_id(entity_id)
		if entity == None:
			entities_not_found.append(entity_id)
			continue
		if not client.has_permission(entity):
			entities_not_allowed.append(entity_id)
			continue
		entities_set.append(entity_id)
		new_keep_entities_loaded.add(entity)

	data = {'set': entities_set, 'not_found': entities_not_found, 'denied': entities_not_allowed}
	respond(context, 'Set: %s. Not found: %s. Denied: %s.' % (','.join(entities_set), ','.join(entities_not_found), ','.join(entities_not_allowed)), data=data)
	client.keep_entities_loaded = new_keep_entities_loaded

allowed_message_forward_types = set(['MOV', 'EXT', 'BAG', 'MSG', 'PRI', 'CMD', 'ERR', 'MAI', 'MAP', 'PUT', 'DEL', 'BLK', 'WHO', 'CHAT', 'KEYS', 'CLICK'])
@cmd_command(no_entity_needed=True, privilege_level="no_scripts")
def fn_message_forwarding(map, client, context, arg):
	#/message_forwarding set entity_id,entity_id,entity_id... MAP,MAI,PRI,...
	args = arg.split(' ')

	if len(args) >= 1:
		"""
		if args[0] == 'clear':
			respond(context, 'Clearing %d forwards' % len(client.forwarding_messages_from))
			for e in client.forwarding_messages_from:
				e.forward_messages_to = None
				e.forward_message_types.clear()
			client.forwarding_messages_from.clear()
			
		elif args[0] == 'list':
			data = {'list': [e.protocol_id() for e in client.forwarding_messages_from]}
			respond(context, ', '.join(['%s (%s)' % (e.name_and_username(), ', '.join(list(e.forward_message_types))) for e in client.forwarding_messages_from]), data=data)
		"""
		if args[0] == 'set':
			if len(args) == 1:
				respond(context, 'Provide a list of entities', error=True)
				return
			if len(args) >= 3:
				message_types = args[2].split(',')
			else:
				message_types = []

			# For the notice at the end
			entities_set = []
			entities_not_found = []
			entities_not_allowed = []

			# For all of the entities...
			for entity_id in args[1].split(','):
				entity = get_entity_by_id(entity_id)
				if entity == None:
					entities_not_found.append(entity_id)
					continue
				if not client.has_permission(entity, permission['remote_command']):
					entities_not_allowed.append(entity_id)
					continue

				entities_set.append(entity_id)

				entity.forward_message_types = set([x.upper() for x in message_types if allowed_message_forward_types])

				if entity.forward_message_types:
					entity.forward_messages_to = client.protocol_id()
					if entity.map:
						entity.map.broadcast("WHO", {"update": {"id": entity.protocol_id(), "is_forwarding": True, "clickable": "CLICK" in entity.forward_message_types, "chat_listener": "CHAT" in entity.forward_message_types or (hasattr(entity, 'listening_to_chat_warning') and entity.listening_to_chat_warning)}})
				else:
					entity.forward_messages_to = None
					if entity.map:
						entity.map.broadcast("WHO", {"update": {"id": entity.protocol_id(), "is_forwarding": False, "clickable": False, "chat_listener": (hasattr(entity, 'listening_to_chat_warning') and entity.listening_to_chat_warning)}})
				if not entity.temporary:
					entity.save()
			data = {'set': entities_set, 'not_found': entities_not_found, 'denied': entities_not_allowed}
			respond(context, 'Set: %s. Not found: %s. Denied: %s.' % (','.join(entities_set), ','.join(entities_not_found), ','.join(entities_not_allowed)), data=data)
		else:
			respond(context, 'Please provide a subcommand: set', error=True)
# -------------------------------------

def handle_user_command(map, actor, context, text, script_entity=None, respond_to=None):
	# Separate text into command and arguments
	command, arg = separate_first_word(text)
	if context == None:
		context = {'echo': None, 'ack_req': None, 'client': respond_to or script_entity or actor}
	context['actor'] = actor
	context["script_entity"] = script_entity

	# Attempt to run the command handler if it exists

	# Check aliases first
	if command in aliases:
		command = aliases[command]

	if command in handlers:
		# Most commands can only be done by entities, and not FakeClient
		if not isinstance(actor, Entity) and (command not in no_entity_needed_commands):
			respond(context, 'You need to be in the world to use that command!', error=True)
			return

		# Restrict some commands to maps
		if command in map_only_commands and (actor.map == None or not actor.map.is_map()):
			respond(context, 'Command can only be run while on a map', error=True)
			return

		# Check permissions
		privilege_needed = command_privilege_level[command] # See user_privilege in buildglobal.py

		if privilege_needed == 1 and script_entity != None: # Guests can use it, but scripts can't
			respond(context, 'Scripts may not can use "%s"' % command, error=True, code='real_users_only')
		elif privilege_needed == 2 and (actor.db_id == None or script_entity != None or not hasattr(actor, 'connection')): # Registered
			respond(context, 'Only registered accounts can use "%s"' % command, error=True, code='no_guests')
		elif privilege_needed == 3 and actor.db_id != map.owner_id and (not hasattr(actor, 'connection') or not actor.connection_attr('oper_override')) and not actor.has_permission(map, permission['admin'], False): # Map admin
			respond(context, 'Only the map owner or map admins can use "%s"' % command, error=True, code='missing_permission', detail='admin', subject_id=map.protocol_id())
		elif privilege_needed == 4 and actor.db_id != map.owner_id and (not hasattr(actor, 'connection') or not actor.connection_attr('oper_override')): # Map owner
			respond(context, 'Only the map owner can use "%s"' % command, error=True, code='owner_only', subject_id=map.protocol_id())
		elif privilege_needed == 5 and (not hasattr(actor, 'connection') or actor.username not in Config["Server"]["Admins"]):
			respond(context, 'Only server admins can use "%s"' % command, error=True, code='server_admin_only')
		else:
			return handlers[command](map, actor, context, arg)
	else:
		respond(context, 'Invalid command? "%s"' % command, code="invalid_command", detail=command, error=True)
