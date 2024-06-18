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

import json, random, datetime, time, ipaddress, hashlib, weakref
from .buildglobal import *
from .buildentity import Entity

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
		return False
	username = client.username
	if username == None and '!guests' in banlist:
		client.send("ERR", {'text': 'Guests may not %s' % action, 'code': 'no_guests', 'detail': action})
		return True
	if username in banlist:
		client.send("ERR", {'text': 'You may not %s' % action, 'code': 'blocked', 'detail': action})
		return True
	return False

def respond(context, text, data=None, error=False, code=None, detail=None, subject_id=None, buttons=None):
	args = {}
	respond_to, echo = context
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

	respond_to.send('ERR' if error else 'CMD', args)

def parse_equal_list(text):
	return (x.split('=') for x in text.split())

def data_disallowed_for_entity_type(type, data):
	if entity_type_name[type] not in ('text', 'image', 'map_tile', 'tileset', 'landmark'):
		return 'Not a valid type to change data for'
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

# -------------------------------------

@cmd_command(category="Settings", syntax="newname")
def fn_nick(map, client, context, arg):
	if len(arg) > 0 and not arg.isspace():
		map.broadcast("MSG", {'text': "\""+client.name+"\" is now known as \""+escape_tags(arg)+"\""})
		client.name = escape_tags(arg)
		map.broadcast("WHO", {'add': client.who()}, remote_category=botwatch_type['entry']) # update client view

@cmd_command(category="Settings", syntax="description")
def fn_userdesc(map, client, context, arg):
	client.desc = arg

@cmd_command(category="Settings", syntax="text", no_entity_needed=True)
def fn_client_settings(map, client, context, arg):
	connection = client.connection()
	if connection:
		connection.client_settings = arg

@cmd_command(category="Communication")
def fn_say(map, client, context, arg):
	if arg != '':
		fields = {'name': client.name, 'id': client.protocol_id(), 'username': client.username_or_id(), 'text': escape_tags(arg)}
		map.broadcast("MSG", fields, remote_category=botwatch_type['chat'])

@cmd_command(category="Communication")
def fn_me(map, client, context, arg):
	if arg != '':
		fields = {'name': client.name, 'id': client.protocol_id(), 'username': client.username_or_id(), 'text': "/me "+escape_tags(arg)}
		map.broadcast("MSG", fields, remote_category=botwatch_type['chat'])

@cmd_command(category="Communication", alias=['msg', 'p'], syntax="username message", no_entity_needed=True)
def fn_tell(map, client, context, arg):
	if arg != "":
		username, privtext = separate_first_word(arg)
		if privtext.isspace() or privtext=="":
			respond(context, 'Tell them what?', error=True)
		else:
			u = find_connection_by_username(username)
			if u != None:
				u = u.entity
			else:
				u = find_client_by_username(username)
			if u:
				if u.is_client() or "PRI" in u.forward_message_types:
					if not u.is_client() or not in_blocked_username_list(client, u.connection_attr('ignore_list'), 'message %s' % u.name):
						client.send("PRI", {'text': privtext, 'name':u.name, 'id': u.protocol_id(), 'username': u.username_or_id(), 'receive': False})
						u.send("PRI", {'text': privtext, 'name':client.name, 'id': client.protocol_id(), 'username': client.username_or_id(), 'receive': True})
				else:
					respond(context, 'That entity isn\'t a user', error=True)
			else:
				failed_to_find(context, username)
	else:
		respond(context, 'Private message who?', error=True)

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
		u.send("MSG", {'text': them_message % client.name_and_username(), 'buttons': ['Accept', '%s %s %s %d' % (accept_command, my_username, request_type, next_request_id), 'Decline', '%s %s %s %d' % (decline_command, my_username, request_type, next_request_id)]})
		u.requests[request_key] = [600, next_request_id, request_data]
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
	if subject_id.isdecimal():
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
		new_item = Entity(item.entity_type)			
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
		elif givetype == 'copy':
			clone_item(item, False)
		elif givetype == 'tempcopy':
			clone_item(item, True)
	elif request_type == "syncmove":
		if client is subject:
			return

		client.start_batch()
		client.stop_current_ride()
		subject.start_batch()
		subject.stop_current_ride()

		client.send("MSG", {'text': 'You start moving with %s ([command]rideend[/command] to stop)' % client.name_and_username()})
		subject.send("MSG", {'text': 'You start moving with %s ([command]rideend[/command] to stop)' % subject.name_and_username()})

		client.vehicle = subject
		subject.vehicle = client
		client.passengers.add(subject)
		subject.passengers.add(client)

		if client.map != None:
			client.map.broadcast("WHO", {'add': client.who()}, remote_category=botwatch_type['move'])
		if subject.map != None:
			subject.map.broadcast("WHO", {'add': subject.who()}, remote_category=botwatch_type['move'])

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
	respond(context, datetime.datetime.today().strftime("Now it's %m/%d/%Y, %I:%M %p"))

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
	names = ''
	for u in AllClients:
		if client.status_type == None or client.status_type.lower() not in ('iic', 'irp', 'lfrp'):
			continue
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	respond(context, 'These users are looking for RP: '+names)

@cmd_command()
def fn_findic(map, client, context, arg):
	names = ''
	for u in AllClients:
		if client.status_type == None or client.status_type.lower() not in ('ic', 'rp'):
			continue
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	respond(context, 'These users are currently in character (or roleplaying): '+names)

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
@cmd_command(category="Settings", syntax="username", no_entity_needed=True)
def fn_ignore(map, client, context, arg):
	arg = arg.lower().strip()
	if not arg:
		return
	connection = client.connection()
	if connection:
		connection.ignore_list.add(arg)
		respond(context, '\"%s\" added to ignore list' % arg)

@cmd_command(category="Settings", syntax="username", no_entity_needed=True)
def fn_unignore(map, client, context, arg):
	arg = arg.lower().strip()
	if not arg:
		return
	connection = client.connection()
	if connection and arg in connection.ignore_list:
		connection.ignore_list.discard(arg)
		respond(context, '\"%s\" removed from ignore list' % arg)

@cmd_command(category="Settings", no_entity_needed=True)
def fn_ignorelist(map, client, context, arg):
	respond(context, 'Ignore list: '+str(client.connection_attr('ignore_list')))

@cmd_command(category="Settings", syntax="username", no_entity_needed=True)
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
		respond(context, 'Players currently online: %s' % ', '.join(users))
		return

	# Add to watch list
	connection.watch_list.add(arg)
	respond(context, '\"%s\" added to watch list' % arg)

	# Update watch list
	if connection.user_watch_with_who:
		other = ConnectionsByUsername[arg]
		if other.can_be_watched():
			connection.send("WHO", {"add": other.watcher_who(), "type": "watch"})

@cmd_command(category="Settings", syntax="username", no_entity_needed=True)
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

@cmd_command(category="Settings", no_entity_needed=True)
def fn_watchlist(map, client, context, arg):
	respond(context, 'Watch list: '+str(client.connection_attr('watch_list')))

user_changeable_flags = ('bot', 'hide_location', 'hide_api', 'no_watch')
@cmd_command(category="Settings", alias=['userflag'])
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
		elif param[0] == 'del':
			for flag in param[1:]:
				if flag in user_changeable_flags:
					connection.user_flags &= ~userflag[flag]
		else:
			respond(context, 'Unrecognized subcommand "%s"' % param[0], code='invalid_subcommand', detail=subcommand, error=True)
			return
		respond(context, 'Your new user flags: '+flags_list())
	else:
		respond(context, 'Syntax: add/del list of flags', error=True)

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
	if param[1] == '!guest':
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
	perms += "[ul]"
	for row in c.execute('SELECT username, allow, deny FROM Permission mp, User u WHERE mp.subject_id=? AND mp.actor_id=u.entity_id', (map.db_id,)):
		perms += "[li][b]"+row[0] + "[/b]: "
		for k,v in permission.items():
			if (row[1] & v) == v: # allow
				perms += "+"+k+" "
			if (row[2] & v) == v: #deny
				perms += "-"+k+" "
		perms += "[/li]"

	# Group (or anything that isn't a user) permissions
	for row in c.execute('SELECT u.name, u.type, mp.allow, mp.deny, u.id FROM Permission mp, Entity u WHERE mp.subject_id=? AND mp.actor_id=u.id AND u.type != ?', (map.db_id, entity_type['user'])):
		perms += "[li][b]%s: %s(%s) [/b]: " % (entity_type_name[row[1]].title(), row[4], row[0])
		for k,v in permission.items():
			if (row[2] & v) == v: # allow
				perms += "+"+k+" "
			if (row[3] & v) == v: # deny
				perms += "-"+k+" "
		perms += "[/li]"

	# Temporary
	for v in map.temp_permissions_given_to:
		perms += "[li][b]Temp: %s(%s)[/b]" % (v.name, v.protocol_id())
		perm_bits = v.temp_permissions.get(map)
		for k,v in permission.items():
			if (perm_bits & v) == v: # allow
				perms += "+"+k+" "
		perms += "[/li]"

	perms += "[/ul]"
	respond(context, perms)

@cmd_command(privilege_level="registered", no_entity_needed=True)
def fn_findmyitems(map, client, context, arg):
	connection = client.connection()
	if connection == None:
		return
	c = Database.cursor()
	maps = "My items: [ul]"
	for row in c.execute('SELECT m.id, m.name, m.type FROM Entity m WHERE m.owner_id=? AND m.type != ? AND m.type != ? AND m.location == NULL', (connection.db_id, entity_type['map'], entity_type['group'])):
		maps += "[li][b]%s[/b] (%s) [command]e %d take[/command][/li]" % (row[1], entity_type_name[row[2]], row[0])
	maps += "[/ul]"
	respond(context, maps)

@cmd_command(category="Map", privilege_level="registered", no_entity_needed=True)
def fn_mymaps(map, client, context, arg):
	connection = client.connection()
	if connection == None:
		return
	c = Database.cursor()
	maps = "My maps: [ul]"
	for row in c.execute('SELECT m.id, m.name FROM Entity m WHERE m.owner_id=? AND m.type == ?', (connection.db_id, entity_type['map'])):
		maps += "[li][b]%s[/b] [command]map %d[/command][/li]" % (row[1], row[0])
	maps += "[/ul]"
	respond(context, maps)

@cmd_command(category="Map", hidden=True, privilege_level="server_admin", no_entity_needed=True)
def fn_allmaps(map, client, context, arg):
	c = Database.cursor()
	maps = "All maps: [ul]"
	for row in c.execute('SELECT e.id, e.name, u.username FROM Entity e, Map m, User u WHERE e.owner_id=u.entity_id AND e.id=m.entity_id'):
		maps += "[li][b]%s[/b] (%s) [command]map %d[/command][/li]" % (row[1], row[2], row[0])
	maps += "[/ul]"
	respond(context, maps)

@cmd_command(category="Map", no_entity_needed=True)
def fn_publicmaps(map, client, context, arg):
	c = Database.cursor()
	maps = "Public maps: [ul]"
	for row in c.execute('SELECT e.id, e.name, u.username FROM Entity e, Map m, User u WHERE e.owner_id=u.entity_id AND e.id=m.entity_id AND (m.flags&1)!=0'):
		maps += "[li][b]%s[/b] (%s) [command]map %d[/command][/li]" % (row[1], row[2], row[0])
	maps += "[/ul]"
	respond(context, maps)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="newname")
def fn_mapname(map, client, context, arg):
	map.name = arg
	map.save_on_clean_up = True
	respond(context, 'Map name set to \"%s\"' % map.name)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_mapdesc(map, client, context, arg):
	map.desc = arg
	map.save_on_clean_up = True
	respond(context, 'Map description set to \"%s\"' % map.desc)

@cmd_command(category="Map", map_only=True, syntax="text")
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

@cmd_command(category="Map", privilege_level="registered", map_only=True)
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
			map_edge_ref_links = [None] * 8
		map.edge_id_links[edge] = map_id
		map.edge_ref_links[edge] = get_entity_by_id(map_id) if map_id != None else None

		# If it's all None, change it to None instead of being a list at all
		if all(x == None for x in map.edge_id_links):
			map.edge_id_links = None
			map.edge_ref_links = None

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
	map.save_on_clean_up = True

@cmd_command(category="Map", privilege_level="map_admin", map_only=True, syntax="on/off")
def fn_mapprotect(map, client, context, arg):
	if arg == "off":
		map.allow |= permission['sandbox']
	elif arg == "on":
		map.allow &= ~permission['sandbox']
	else:
		respond(context, 'Map sandbox must be on or off', error=True)

@cmd_command(category="Map", privilege_level="map_admin", map_only=True, syntax="on/off")
def fn_mapbuild(map, client, context, arg):
	if arg == "on":
		map.deny &= ~permission['build']
	elif arg == "off":
		map.deny |= permission['build']
	else:
		respond(context, 'Map building must be on or off', error=True)

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
			for user in map.contents:
				if user.is_client():
					user.send("MAI", map.map_info(user=user))
			respond(context, 'Wallpaper removed')
		else:
			respond(context, 'No wallpaper to remove', error=True)
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

			for user in map.contents:
				if user.is_client():
					user.send("MAI", map.map_info(user=user))
			respond(context, 'Wallpaper changed to "%s"' % arg[0])
		else:
			respond(context, 'URL doesn\t match any allowlisted sites', error=True)
	else:
		respond(context, 'Please provide a URL', error=True)

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

	out = ''
	for i in botwatch_type.keys():
		c = botwatch_type[i]
		if map.db_id in BotWatch[c]:
			for u in BotWatch[c][map.db_id]:
				out += '%s (%s), ' % (u.username, i)
	out_forward = ''
	for e in map.contents:
		if e.forward_messages_to:
			out_forward += '%s (%s) → [%s], ' % (e.name_and_username(), ', '.join(list(e.forward_message_types)), ', '.join([p.name_and_username() for p in e.forward_messages_to]))

	parts = []
	if out:
		parts.append('Remote listeners here: ' + out)
	if out_forward:
		parts.append('Forwarders here: ' + out_forward)
	if not parts:
		parts = ['Nothing is listening to this map']
	respond(context, ' | '.join(parts))

@cmd_command(privilege_level="registered", syntax="category,category,category... id,id,id...", no_entity_needed=True)
def fn_listen(map, client, context, arg):
	connection = client.connection()
	if not connection:
		return
	params = arg.split()
	categories = set(params[0].split(','))
	maps = set(int(x) for x in params[1].split(','))
	for c in categories:
		# find category number from name
		if c not in botwatch_type:
			respond(context, 'Invalid listen category: %s' % c, error=True)
			return
		category = botwatch_type[c]

		for m in maps:
			if not client.has_permission(m, permission['map_bot'], False):
				respond(context, 'Don\t have permission to listen on map: %d' % m, error=True)
				return
			if m not in BotWatch[category]:
				BotWatch[category][m] = set()
			BotWatch[category][m].add(client)
			connection.listening_maps.add((category, m))

			# Send initial data
			if c == 'build':
				if get_entity_type_by_db_id(m) == entity_type['map']:
					client.start_batch()
					map = get_entity_by_id(m)
					data = map.map_info()
					data['remote_map'] = m
					client.send("MAI", data)

					data = map.map_section(0, 0, map.width-1, map.height-1)
					data['remote_map'] = mh
					client.send("MAP", data)
					client.finish_batch()
			elif c == 'entry':
				if m in AllEntitiesByDB:
					client.send("WHO", {'list': AllEntitiesByDB[m].who_contents(), 'remote_map': m})
				else:
					client.send("WHO", {'list': [], 'remote_map': m})

	respond(context, 'Listening on maps now: ' + str(client.listening_maps))

@cmd_command(privilege_level="registered", syntax="category,category,category... id,id,id...", no_entity_needed=True)
def fn_unlisten(map, client, context, arg):
	connection = client.connection()
	if not connection:
		return
	params = arg.split()
	categories = set(params[0].split(','))
	maps = [int(x) for x in params[1].split(',')]
	for c in categories:
		# find category number from name
		if c not in botwatch_type:
			respond(context, 'Invalid listen category: "%s"' % c, error=True)
			return
		category = botwatch_type[c]

		for m in maps:
			if (m in BotWatch[category]) and (client in BotWatch[category][m]):
				BotWatch[category][m].remove(client)
				if not len(BotWatch[category][m]):
					del BotWatch[category][m]
			if (category, m) in client.listening_maps:
				connection.listening_maps.remove((category, m))
	respond(context, 'Stopped listening on maps: ' + str(client.listening_maps))

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
		ipsplit = parsed_ip.exploded.split('.')
		if len(ipsplit) != 4:
			ipsplit = (None, None, None, None)

		# Insert the ban
		c = Database.cursor()
		c.execute("INSERT INTO Server_Ban (ip, ip4_1, ip4_2, ip4_3, ip4_4, admin_id, created_at, expires_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",\
			(ip, ipv4[0], ipv4[1], ipv4[2], ipv4[3], client.db_id, now, expiry, reason))

	elif len(ipv6) == 6:
		# Insert the ban
		c = Database.cursor()
		c.execute("INSERT INTO Server_Ban (ip, ip6_1, ip6_2, ip6_3, ip6_4, ip6_5, ip6_6, ip6_7, ip6_7, admin_id, created_at, expires_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",\
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
	for row in c.execute('SELECT b.ip, b.reason, b.time, b.expiry, a.username FROM Server_Ban b, USER a WHERE a.uid = b.admin'):
		results += "[li][b]%s[/b] banned by [tt]%s[/tt] for \"%s\" at [tt]%s[/tt] until [tt]%s[/tt] [command]ipunban %s[/command][/li]" % (row[0], row[4], row[1], row[2], row[3] or 'never', row[0])
	results += "[/ul]"
	respond(context, results)

@cmd_command(category="Teleport")
def fn_goback(map, client, context, arg):
	if len(client.tp_history) > 0:
		pos = client.tp_history.pop()
		client.switch_map(pos[0], new_pos=[pos[1], pos[2]], update_history=False)
	else:
		respond(context, 'Nothing in teleport history', error=True)

@cmd_command(category="Teleport")
def fn_sethome(map, client, context, arg):
	client.home_id = client.map_id
	client.home_position = [client.x, client.y]
	respond(context, 'Home set')

@cmd_command(category="Teleport")
def fn_home(map, client, context, arg):
	if client.home_id == None:
		respond(context, 'You don\'t have a home set', error=True)
	else:
		respond(context, 'Teleported to your home')
		client.send_home()

@cmd_command(category="Teleport", syntax="map")
def fn_defaultmap(map, client, context, arg):
	client.switch_map(get_database_meta('default_map'))

@cmd_command(alias=['tpi'], category="Teleport", syntax="map")
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

		c.execute('UPDATE User SET passhash=?, passalgo=? WHERE username=?', (hash, "sha512", arg,))
		respond(context, 'Password for %s reset to [tt]%s[/tt]' % (arg, randpass))

@cmd_command(category="Account", privilege_level="registered", syntax="oldpassword password password", no_entity_needed=True)
def fn_changepass(map, client, context, arg):
	if not client.is_client() or context[0] != client:
		return
	connection = client.connection()
	if not connection:
		return
	if len(arg):
		connection.changepass(arg)
		respond(context, 'Password changed')
	else:
		respond(context, 'No password given', error=True)

@cmd_command(category="Account", syntax="username password")
def fn_register(map, client, context, arg):
	if not client.is_client():
		return
	connection = client.connection()
	if not connection:
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
			else:
				respond(context, 'Register fail, account already exists', error=True)

@cmd_command(category="Account", syntax="username password", no_entity_needed=True)
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

@cmd_command(no_entity_needed=True)
def fn_disconnect(map, client, context, arg):
	respond(context, 'Goodbye!')
	client.disconnect(reason="Quit")

@cmd_command(category="Settings", syntax='"x y" OR "url" OR "bunny/cat/hamster/fire"')
def fn_userpic(map, client, context, arg):
	arg = arg.split(' ')
	success = False

	client.save_on_clean_up = True

	if len(arg) == 1:
		defaults = {'bunny': [0, 2, 25], 'cat': [0, 2, 26], 'hamster': [0, 8, 25], 'fire': [0, 4,26]}
		if arg[0] in defaults:
			client.pic = defaults[arg[0]];
			success = True
		# temporary thing to allow custom avatars
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
		if arg[0].isdecimal() and arg[1].isdecimal() and arg[2].isdecimal():
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
		for pic in sorted(client.saved_pics.keys()):
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

@cmd_command(category="Settings", alias=['savepiclist', 'spl'])
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
			respond(context, "Saved pics: %s" % ', '.join(sorted(client.saved_pics.keys())))
	elif subcommand == 'del' and subarg:
		subarg = subarg.lower()
		was = client.saved_pics.pop(subarg, None)
		if was:
			respond(context, 'Deleted saved pic \"%s" (it was %s)' % (subarg, was))
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
		for morph in sorted(client.morphs.keys()):
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
		client.broadcast_who()
		if client.name != old_name and not quiet:
			map.broadcast("MSG", {'text': "\""+old_name+"\" switches to \""+client.name+"\""})
	else:
		respond(context, "You don't have a morph named \"%s\"" % arg, error=True)

@cmd_command(category="Settings", syntax='morph name')
def fn_morph(map, client, context, arg):
	morph_shared(map, client, context, arg, False)

@cmd_command(category="Settings", syntax='morph name')
def fn_qmorph(map, client, context, arg):
	morph_shared(map, client, context, arg, True)

@cmd_command(category="Settings", alias=['morphs'])
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
			'tags': client.tags
		}
		respond(context, "Saved morph \"%s\"" % (subarg))
	elif subcommand == 'list2': # Provide it as text just in case
		if client.morphs == {}:
			respond(context, "You don't have any morphs")
		else:
			respond(context, "Morphs: %s" % ', '.join(sorted(client.morphs.keys())))
	elif subcommand == 'del' and subarg:
		subarg = subarg.lower()
		was = client.morphs.pop(subarg, None)
		if was:
			respond(context, 'Deleted morph \"%s" (it was %s)' % (subarg, was))
		else:
			respond(context, "You don't have a morph named \"%s\"" % subarg, error=True)
	elif subcommand == 'clear':
		client.morphs = {}
		respond(context, 'Cleared morph list')
	else:
		respond(context, 'Unrecognized subcommand "%s"' % subcommand, code='invalid_subcommand', detail=subcommand, error=True)



@cmd_command(category="Settings", syntax='"x y"')
def fn_offset(map, client, context, arg):
	arg = arg.split(' ')
	if len(arg) == 2:
		offset_x, offset_y = min(32, max(-32, int(arg[0]))), min(32, max(-32, int(arg[1])))
		client.offset = [offset_x, offset_y]
		map.broadcast("MOV", {"id": client.protocol_id(), "offset": [offset_x, offset_y]}, remote_category=botwatch_type['move'])
	else:
		client.offset = None
		map.broadcast("MOV", {"id": client.protocol_id(), "offset": None}, remote_category=botwatch_type['move'])

@cmd_command(category="Settings", syntax='"x y"')
def fn_roffset(map, client, context, arg):
	arg = arg.split(' ')
	if len(arg) == 2:
		offset = client.offset
		if offset == None:
			offset = [0, 0]
		offset_x, offset_y = min(32, max(-32, offset[0] + int(arg[0]))), min(32, max(-32, offset[1] + int(arg[1])))
		client.offset = [offset_x, offset_y]
		map.broadcast("MOV", {"id": client.protocol_id(), "offset": [offset_x, offset_y]}, remote_category=botwatch_type['move'])
	else:
		client.offset = None
		map.broadcast("MOV", {"id": client.protocol_id(), "offset": None}, remote_category=botwatch_type['move'])

@cmd_command(category="Who", no_entity_needed=True)
def fn_gwho(map, client, context, arg):
	names = ''
	for u in AllClients:
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	respond(context, 'List of users connected: '+names)

@cmd_command(category="Who", no_entity_needed=True)
def fn_imwho(map, client, context, arg):
	names = ''
	for c in AllConnections:
		if isinstance(c.entity, Entity) and c.identified:
			continue
		if len(names) > 0:
			names += ', '
		names += c.username
	respond(context, 'List of messaging users: '+names)

@cmd_command(category="Who")
def fn_who(map, client, context, arg):
	names = ''
	for u in map.contents:
		if not u.is_client():
			continue
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	respond(context, 'List of users here: '+names)

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
			c = Database.cursor()
			c.execute('SELECT last_seen_at FROM User WHERE entity_id=?', (id,))
			result = c.fetchone()
			if result == None:
				return
			respond(context, '%s last seen at %s' % (arg, result[0].strftime("%m/%d/%Y, %I:%M %p") ))

@cmd_command(category="Who", alias=['wa'], no_entity_needed=True)
def fn_whereare(map, client, context, arg):
	names = 'Whereare: [ul]'
	for m in AllMaps:
		if m.map_flags & mapflag['public'] == 0:
			continue
		user_count = m.count_users_inside()
		if user_count == 0:
			continue
		names += '[li][b]%s[/b] (%d): ' % (m.name, user_count)
		for u in m.contents:
			if u.is_client() and (u.connection_attr('user_flags') & userflag['hide_location'] == 0):
				names += u.name_and_username()+', '
		names = names.rstrip(', ') + ' | [command]map %d[/command]' % m.db_id
		if m.topic:
			names += ' (📅[i]"%s" by %s[/i])' % (m.topic, m.topic_username)
		names += '[/li]'
	names += '[/ul]'

	respond(context, names)

@cmd_command(alias=['ewho'], category="Who")
def fn_entitywho(map, client, context, arg):
	names = ''
	for u in map.contents:
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	respond(context, 'List of entities here: '+names)

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
		broadcast_to_all("Server shutdown in %d seconds! (started by %s)" % (ServerShutdown[0], client.name))

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="cancel/seconds", alias=['serverrestart'], no_entity_needed=True)
def fn_restartserver(map, client, context, arg):
	global ServerShutdown
	if arg == "cancel" and ServerShutdown[0] != -1:
		ServerShutdown[0] = -1
		broadcast_to_all("Server restart canceled")
	elif arg.isdecimal():
		ServerShutdown[0] = int(arg)
		ServerShutdown[1] = True
		broadcast_to_all("Server restarting in %d seconds! (started by %s)" % (ServerShutdown[0], client.name))

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
	groups = "Groups you are own: [ul]"
	for row in c.execute('SELECT g.id, g.name FROM Entity g WHERE g.owner_id=? AND type=?', (client.db_id, entity_type['group'])):
		groups += "[li][b]%s[/b] (%d)[/li]" % (row[1], row[0])
	groups += "[/ul]"
	respond(context, groups)

@cmd_command(category="Group", privilege_level="registered", no_entity_needed=True)
def fn_mygroups(map, client, context, arg):
	c = Database.cursor()
	groups = "Groups you are in: [ul]"
	for row in c.execute('SELECT g.id, g.name, m.accepted_at FROM Entity g, Group_Member m WHERE g.id=m.group_id AND m.member_id=?', (client.db_id,)):
		if row[2]:
			groups += "[li][b]%s[/b] (%d)[/li]" % (row[1], row[0])
		else:
			groups += "[li][b]%s[/b] (%d)[/li] - Invited" % (row[1], row[0])
	groups += "[/ul]"
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
	groups = "Group %d (%s) members: [ul]" % (group_id, group_name)
	for row in c.execute('SELECT g.id, g.name, m.accepted_at FROM Entity g, Group_Member m WHERE m.group_id=? AND m.member_id=g.id', (group_id,)):
		if row[2] == None:
			groups += "[li][b]%s[/b] (%d) - Invited[/li]" % (row[1], row[0])
		else:
			groups += "[li][b]%s[/b] (%d)[/li]" % (row[1], row[0])
	groups += "[/ul]"
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
	map.broadcast("DEL", {"undo": True, "pos": connection.undo_delete_data["pos"], "username": client.username_or_id()}, remote_only=True, remote_category=botwatch_type['build'])
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
def fn_flushbuildlog(map, client, context, arg):
	if BuildLog:
		BuildLog.flush()

@cmd_command(privilege_level="server_admin", no_entity_needed=True)
def fn_rehash(map, client, context, arg):
	loadConfigJson()
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

@cmd_command(alias=['e'], no_entity_needed=True)
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
		if len(e.contents):
			info += '\n[b]Contents:[/b] %s' % ', '.join(c.name_and_username() for c in e.contents)
		respond(context, info)
	elif subcommand == 'locate':
		if e.is_client() and not client.oper_override and \
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
			e.name = subarg
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
		if permission_check( (permission['move'], permission['move_new_map']) ):
			if e.map_id is client.map_id or permission_check(permission['move_new_map']):
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
			handle_user_command(e.map, e, client, context[1], subarg)
	elif subcommand == 'move':
		if permission_check(permission['move']):
			coords = subarg.split()
			if len(coords) == 2 and coords[0].isdecimal() and coords[1].isdecimal():
				e.move_to(int(coords[0]), int(coords[1])) # Will mark the entity for saving
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
@cmd_command(no_entity_needed=True)
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
						entity.map.broadcast("WHO", {"update": {"id": entity.protocol_id(), "is_forwarding": True, "clickable": "CLICK" in entity.forward_message_types, "chat_listener": "CHAT" in entity.forward_message_types}})
				else:
					entity.forward_messages_to = None
					if entity.map:
						entity.map.broadcast("WHO", {"update": {"id": entity.protocol_id(), "is_forwarding": False, "clickable": False, "chat_listener": False}})
				if not entity.temporary:
					entity.save()
			data = {'set': entities_set, 'not_found': entities_not_found, 'denied': entities_not_allowed}
			respond(context, 'Set: %s. Not found: %s. Denied: %s.' % (','.join(entities_set), ','.join(entities_not_found), ','.join(entities_not_allowed)), data=data)
		else:
			respond(context, 'Please provide a subcommand: set', error=True)
# -------------------------------------

def handle_user_command(map, client, respond_to, echo, text):
	# Separate text into command and arguments
	command, arg = separate_first_word(text)

	# Attempt to run the command handler if it exists
	context = (respond_to, echo)

	# Check aliases first
	if command in aliases:
		command = aliases[command]

	if command in handlers:
		# Most commands can only be done by entities, and not FakeClient
		if not isinstance(client, Entity) and (command not in no_entity_needed_commands):
			respond(context, 'You need to be in the world to use that command!', error=True)
			return

		# Restrict some commands to maps
		if command in map_only_commands and (client.map == None or not client.map.is_map()):
			respond(context, 'Command can only be run while on a map', error=True)
			return

		# Check permissions
		privilege_needed = command_privilege_level[command] # See user_privilege in buildglobal.py

		if privilege_needed == 1 and client.db_id == None: # Registered
			respond(context, 'Only registered accounts can use "%s"' % command, error=True, code='no_guests')
		elif privilege_needed == 2 and client.db_id != map.owner_id and (not hasattr(client, 'connection') or not client.connection_attr('oper_override')) and not client.has_permission(map, permission['admin'], False): # Map admin
			respond(context, 'Only the map owner or map admins can use "%s"' % command, error=True, code='missing_permission', detail='admin', subject_id=map.protocol_id())
		elif privilege_needed == 3 and client.db_id != map.owner_id and (not hasattr(client, 'connection') or not client.connection_attr('oper_override')): # Map owner
			respond(context, 'Only the map owner can use "%s"' % command, error=True, code='owner_only', subject_id=map.protocol_id())
		elif privilege_needed == 4 and (not hasattr(client, 'connection') or client.username not in Config["Server"]["Admins"]):
			respond(context, 'Only server admins can use "%s"' % command, error=True, code='server_admin_only')
		else:
			return handlers[command](map, client, context, arg)
	else:
		respond(context, 'Invalid command? "%s"' % command, code="invalid_command", detail=command, error=True)
