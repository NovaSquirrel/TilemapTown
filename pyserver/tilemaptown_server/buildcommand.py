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

import json, random, datetime, ipaddress, hashlib
from .buildglobal import *

handlers = {}	# dictionary of functions to call for each command
aliases = {}	# dictionary of commands to change to other commands
command_categories = {}	# categories
command_about = {}		# help text (description of the command)
command_syntax = {}     # help text (syntax only)
command_privilege_level = {} # minimum required privilege level required for the command; see user_privilege in buildglobal.py
map_only_commands = set()

# Adds a command handler
def cmd_command(alias=[], category="Miscellaneous", hidden=False, about=None, syntax=None, privilege_level='guest', map_only=False):
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
		command_privilege_level[command_name] = user_privilege[privilege_level]
	return decorator

# -------------------------------------

# Filtering chat text
def escape_tags(text):
	return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def find_entity_name(id):
	c = Database.cursor()
	c.execute('SELECT name FROM Entity WHERE id=?', (id,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def map_id_exists(id): # Used by /map
	if id in AllEntitiesByDB:
		return AllEntitiesByDB[id].entity_type == entity_type['map']
	c = Database.cursor()
	c.execute('SELECT entity_id FROM Map WHERE entity_id=?', (id,))
	result = c.fetchone()
	return result != None

def sql_exists(query, data):
	c = Database.cursor()
	c.execute('SELECT EXISTS(%s)' % query, data)
	result = c.fetchone()
	return bool(result[0])

def is_entity_owner(id, client):
	""" Note that id is a string here """
	if not id.isdecimal() or not client.username:
		return False
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
		respond(context, 'No username given', error=True)
	else:
		respond(context, 'Player '+username+' not found', error=True)

def in_blocked_username_list(client, banlist, action):
	# Use the player, instead of whatever entity they're acting through
	if client.username == None and '!guests' in banlist:
		client.send("ERR", {'text': 'Guests may not %s' % action})
		return True
	if client.username in banlist:
		client.send("ERR", {'text': 'You may not %s' % action})
		return True
	return False

def respond(context, text, data=None, error=False):
	args = {}
	respond_to, echo = context
	if echo:
		args['echo'] = echo
	if text:
		args['text'] = text
	if data:
		args['data'] = data
	respond_to.send('ERR' if error else 'CMD', args)

def parse_equal_list(text):
	return (x.split('=') for x in text.split())

def data_disallowed_for_entity_type(type, data):
	if type == entity_type['image'] and not image_url_is_okay(data):
		return 'Image asset URL doesn\'t match any allowlisted sites'
	if type == entity_type['map_tile']:
		tile_ok, tile_reason = tile_is_okay(data)
		if not tile_ok:
			return 'Tile [tt]%s[/tt] rejected (%s)' % (data, tile_reason)
	return None

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
	self.desc = arg

@cmd_command(category="Settings", syntax="text")
def fn_client_settings(map, client, context, arg):
	client.client_settings = arg

@cmd_command(category="Communication", alias=['msg', 'p'], syntax="username message")
def fn_tell(map, client, context, arg):
	if arg != "":
		username, privtext = separate_first_word(arg)
		if privtext.isspace() or privtext=="":
			respond(context, 'Tell them what?', error=True)
		else:
			u = find_client_by_username(username)
			if u:
				if not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
					client.send("PRI", {'text': privtext, 'name':u.name, 'username': u.username_or_id(), 'receive': False})
					u.send("PRI", {'text': privtext, 'name':client.name, 'username': client.username_or_id(), 'receive': True})
			else:
				failed_to_find(context, username)
	else:
		respond(context, 'Private message who?', error=True)

@cmd_command(category="Follow", syntax="username")
def fn_carry(map, client, context, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		respond(context, 'You\'ve already sent them a request', error=True)
		u.requests[my_username][0] = 600 #renew
	elif not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
		respond(context, 'You requested to carry '+arg)
		u.send("MSG", {'text': client.name_and_username()+' wants to carry you', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'carry']

@cmd_command(category="Follow", syntax="username")
def fn_followme(map, client, context, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		respond(context, 'You\'ve already sent them a request', error=True)
		u.requests[my_username][0] = 600 #renew
	elif not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
		respond(context, 'You requested to have '+arg+' follow you')
		u.send("MSG", {'text': client.name_and_username()+' wants you to follow them', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'followme']

@cmd_command(category="Follow")
def fn_hopoff(map, client, context, arg):
	client.dismount()

@cmd_command(category="Follow")
def fn_dropoff(map, client, context, arg):
	u = find_client_by_username(arg, inside=client.passengers)
	if u:
		u.dismount()
	else:
		respond(context, 'You aren\'t carrying %s' % arg, error=True)

@cmd_command(category="Follow")
def fn_carrywho(map, client, context, arg):
	if len(client.passengers):
		names = ''
		for u in client.passengers:
			if len(names) > 0:
				names += ', '
			names += '%s (%s)' % (u.name, u.username_or_id())
		respond(context, 'You are carrying %s' % names)
	else:
		respond(context, 'You aren\'t carrying anything')

@cmd_command(category="Follow")
def fn_ridewho(map, client, context, arg):
	if client.vehicle:
		respond(context, "You are riding %s" % client.vehicle.name_and_username())
	else:
		respond(context, "You aren\'t riding anything")

@cmd_command(category="Follow")
def fn_rideend(map, client, context, arg):
	temp = set(client.passengers)
	for u in temp:
		u.dismount()

@cmd_command(category="Teleport", syntax="username")
def fn_tpa(map, client, context, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		respond(context, 'You\'ve already sent them a request', error=True)
		u.requests[my_username][0] = 600 #renew
	elif not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
		respond(context, 'You requested a teleport to '+arg)
		u.send("MSG", {'text': client.name_and_username()+' wants to teleport to you', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'tpa']

@cmd_command(category="Teleport", syntax="username")
def fn_tpahere(map, client, context, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		respond(context, 'You\'ve already sent them a request', error=True)
		u.requests[my_username][0] = 600 #renew
	elif not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
		respond(context, 'You requested that '+arg+' teleport to you')
		u.send("MSG", {'text': client.name_and_username()+' wants you to teleport to them', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'tpahere']

@cmd_command(category="Teleport", alias=['hopon'], syntax="username")
def fn_tpaccept(map, client, context, arg):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return
	if arg not in client.requests:
		respond(context, 'No pendint request from '+arg, error=True)
	else:
		respond(context, 'You accepted a teleport request from '+arg)
		u.send("MSG", {'text': u.name_and_username()+" accepted your request"})
		request = client.requests[arg]
		if request[1] == 'tpa':
			u.switch_map(u.map_id, new_pos=[client.x, client.y])
		elif request[1] == 'tpahere':
			client.switch_map(u.map_id, new_pos=[u.x, u.y])
		elif request[1] == 'carry':
			client.is_following = False
			client.ride(u)
		elif request[1] == 'followme':
			client.is_following = True
			client.ride(u)
		del client.requests[arg]

@cmd_command(category="Teleport", alias=['tpdecline'], syntax="username")
def fn_tpdeny(map, client, context, arg):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return
	if arg not in client.requests:
		respond(context, 'No pending request from '+arg, error=True)
	else:
		respond(context, 'You rejected a teleport request from '+arg)
		u.send("MSG", {'text': u.name_and_username()+" rejected your request"})
		del client.requests[arg]

@cmd_command(category="Teleport", syntax="username")
def fn_tpcancel(map, client, context, arg):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(context, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		respond(context, 'Canceled request to '+arg)
		del u.requests[my_username]
	else:
		respond(Context, 'No request to cancel', error=True)

@cmd_command()
def fn_time(map, client, context, arg):
	respond(context, datetime.datetime.today().strftime("Now it's %m/%d/%Y, %I:%M %p"))

@cmd_command(syntax="message")
def fn_away(map, client, context, arg):
	if len(arg) < 1:
		client.status_type = None
		client.status_message = None
		respond(context, 'You are no longer marked as away')
	else:
		client.status_type = 'away'
		client.status_message = arg
		respond(context, 'You are now marked as away ("%s")' % arg)

@cmd_command(alias=['stat'], syntax="message")
def fn_status(map, client, context, arg):
	if len(arg) < 1:
		client.status_type = None
		client.status_message = None
		respond(context, 'Your status has been cleared')
		map.broadcast("WHO", {"update": {'id': client.protocol_id(), 'status': None, 'status_message': None}})
	else:
		status_type, status_message = separate_first_word(arg)
		client.status_type = status_type[0:16]
		client.status_message = status_message if status_message != '' else None

		if client.status_message:
			respond(context, 'Your status is now \"%s\" ("%s")' % (client.status_type, client.status_message))
		else:
			respond(context, 'Your status is now \"%s\"' % (client.status_type))
		map.broadcast("WHO", {"update": {'id': client.protocol_id(), 'status': client.status_type, 'status_message': client.status_message}})

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
		client.switch_map(new_map.db_id)
		respond(context, 'Welcome to your new map (id %d)' % new_map.db_id)
	except: # Is it even possible for switch_map to throw an exception?
		respond(context, 'Couldn\'t switch to the new map', error=True)
		raise

# maybe combine the list add/remove/list commands together?
@cmd_command(category="Settings", syntax="username")
def fn_ignore(map, client, context, arg):
	arg = arg.lower()
	client.ignore_list.add(arg)
	respond(context, '\"%s\" added to ignore list' % arg)

@cmd_command(category="Settings", syntax="username")
def fn_unignore(map, client, context, arg):
	arg = arg.lower()
	if arg in client.ignore_list:
		client.ignore_list.remove(arg)
	respond(context, '\"%s\" removed from ignore list' % arg)

@cmd_command(category="Settings")
def fn_ignorelist(map, client, context, arg):
	respond(context, 'Ignore list: '+str(client.ignore_list))

@cmd_command(category="Settings", syntax="username")
def fn_watch(map, client, context, arg):
	arg = arg.lower()
	if arg in client.watch_list:
		client.watch_list.remove(arg)
	respond(context, '\"%s\" added to watch list' % arg)

@cmd_command(category="Settings", syntax="username")
def fn_unwatch(map, client, context, arg):
	arg = arg.lower()
	client.watch_list.remove(arg)
	respond(context, '\"%s\" removed from watch list' % arg)

@cmd_command(category="Settings")
def fn_watchlist(map, client, context, arg):
	respond(context, 'Watch list: '+str(client.watch_list))

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
		failed_to_find(param[1])
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

	# Group permissions
	for row in c.execute('SELECT u.name, u.type, mp.allow, mp.deny, u.id FROM Permission mp, Entity u WHERE mp.subject_id=? AND mp.actor_id=u.id AND u.type != ?', (map.db_id, entity_type['user'])):
		perms += "[li][b]Group: %s(%s) [/b]: " % (row[4], row[0])
		for k,v in permission.items():
			if (row[2] & v) == v: # allow
				perms += "+"+k+" "
			if (row[3] & v) == v: # deny
				perms += "-"+k+" "
		perms += "[/li]"

	perms += "[/ul]"
	respond(context, perms)

@cmd_command(category="Map", privilege_level="registered")
def fn_mymaps(map, client, context, arg):
	c = Database.cursor()
	maps = "My maps: [ul]"
	for row in c.execute('SELECT m.id, m.name FROM Entity m WHERE m.owner_id=? AND m.type == ?', (client.db_id, entity_type['map'])):
		maps += "[li][b]%s[/b] [command]map %d[/command][/li]" % (row[1], row[0])
	maps += "[/ul]"
	respond(context, maps)

@cmd_command(category="Map", hidden=True, privilege_level="server_admin")
def fn_allmaps(map, client, context, arg):
	c = Database.cursor()
	maps = "All maps: [ul]"
	for row in c.execute('SELECT e.id, e.name, u.username FROM Entity e, Map m, User u WHERE e.owner_id=u.entity_id AND e.id=m.entity_id'):
		maps += "[li][b]%s[/b] (%s) [command]map %d[/command][/li]" % (row[1], row[2], row[0])
	maps += "[/ul]"
	respond(context, maps)

@cmd_command(category="Map")
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
	respond(context, 'Map name set to \"%s\"' % map.name)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_mapdesc(map, client, context, arg):
	map.desc = arg
	respond(context, 'Map description set to \"%s\"' % map.desc)

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
		map.owner = newowner
		respond(context, 'Map owner set to \"%s\"' % map.owner)
	else:
		respond(context, 'Nonexistent account', error=True)

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
		map.allow |= permission['build']
	elif arg == "off":
		map.allow &= ~permission['build']
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

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_defaultfloor(map, client, context, arg):
	as_json = load_json_if_valid(arg)
	if as_json != None:
		if tile_is_okay(as_json):
			map.default_turf = as_json
			respond(context, 'Map floor changed to custom tile %s' % arg)
		else:
			respond(context, 'Map floor not changed, custom tile not ok: %s' % arg)
	else:
		map.default_turf = arg
		respond(context, 'Map floor changed to %s' % arg)

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_mapspawn(map, client, context, arg):
	map.start_pos = [client.x, client.y]
	respond(context, 'Map start changed to %d,%d' % (client.x, client.y))

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
	respond(context, 'Listeners here: ' + out)

@cmd_command(privilege_level="registered", syntax="category,category,category... id,id,id...")
def fn_listen(map, client, context, arg):
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
			client.listening_maps.add((category, m))

			# Send initial data
			if c == 'build':
				if get_entity_type_by_db_id(m) == entity_type['map']:
					map = get_entity_by_id(m)
					data = map.map_info()
					data['remote_map'] = m
					client.send("MAI", data)

					data = map.map_section(0, 0, map.width-1, map.height-1)
					data['remote_map'] = mh
					client.send("MAP", data)
			elif c == 'entry':
				if m in AllEntitiesByDB:
					client.send("WHO", {'list': AllEntitiesByDB[m].who_contents(), 'remote_map': m})
				else:
					client.send("WHO", {'list': [], 'remote_map': m})

	respond(context, 'Listening on maps now: ' + str(client.listening_maps))

@cmd_command(privilege_level="registered", syntax="category,category,category... id,id,id...")
def fn_unlisten(map, client, context, arg):
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
				client.listening_maps.remove((category, m))
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
			if any(x.is_client() for x in self.passengers):
				continue
			e.send_home()
			returned += 1
	respond(context, "Sent %d entities home" % returned)

@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_ipwho(map, client, context, arg):
	names = ''
	for u in AllClients:
		if len(names) > 0:
			names += ', '
		names += "%s [%s]" % (u.name_and_username(), ipaddress.ip_address(u.ip).exploded or "?")
	respond(context, 'List of users connected: '+names)

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="ip;reason;length")
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

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="ip")
def fn_ipunban(map, client, context, arg):
	c = Database.cursor()
	c.execute('DELETE FROM Server_Ban WHERE ip=?', (arg,))
	c.execute('SELECT changes()')
	respond(context, 'Bans removed: %d' % c.fetchone()[0])
	Database.commit()

@cmd_command(category="Server Admin", privilege_level="server_admin")
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
	client.home = [client.map_id, client.x, client.y]
	respond(context, 'Home set')

@cmd_command(category="Teleport")
def fn_home(map, client, context, arg):
	if client.home == None:
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
		if len(s) == 1:
			map_id = int(s[0])
			new_pos = None
		elif len(s) == 3:
			map_id = int(s[0])
			new_pos = (int(s[1]), int(s[2]))
		else:
			respond(context, 'Syntax is [tt]/map id[/tt] or [tt]/map id x y[/tt]' % arg, error=True)
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

@cmd_command(category="Account", privilege_level="server_admin", syntax="password", hidden=True)
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

@cmd_command(category="Account", privilege_level="registered", syntax="password")
def fn_changepass(map, client, context, arg):
	if not client.is_client() or context[0] != client:
		return
	if len(arg):
		client.changepass(arg)
		respond(context, 'Password changed')
	else:
		respond(context, 'No password given', error=True)

@cmd_command(category="Account", syntax="username password")
def fn_register(map, client, context, arg):
	if not client.is_client():
		return
	if client.db_id != None:
		respond(context, 'Register fail, you already registered', error=True)
	else:
		params = arg.split()
		if len(params) != 2:
			respond(context, 'Syntax is: /register username password', error=True)
		else:
			filtered = filter_username(params[0])
			if valid_id_format(filtered):
				respond(context, 'Can\'t register a username that\'s just a number', error=True)
			elif client.register(filtered, params[1]):
				map.broadcast("MSG", {'text': client.name+" has now registered"})
				map.broadcast("WHO", {'add': client.who()}) # update client view, probably just for the username
			else:
				respond(context, 'Register fail, account already exists', error=True)

@cmd_command(category="Account", syntax="username password")
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
		client.login(filter_username(params[0]), params[1])

@cmd_command(category="Settings", syntax='"x y" OR "url" OR "bunny/cat/hamster/fire"')
def fn_userpic(map, client, context, arg):
	arg = arg.split(' ')
	success = False

	if not client.is_client() and not client.temporary:
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
	if success:
		client.broadcast_who()
	else:
		respond(context, 'Syntax is: /userpic sheet x y', error=True)

@cmd_command(category="Who")
def fn_gwho(map, client, context, arg):
	names = ''
	for u in AllClients:
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	respond(context, 'List of users connected: '+names)

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
		respond(context, '[b]%s[/b] not found', error=True)

@cmd_command(category="Who", syntax="name")
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

@cmd_command(category="Who", alias=['wa'])
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
			if u.is_client():
				names += u.name_and_username()+', '
		names = names.rstrip(', ') + ' [command]map %d[/command][/li]' % m.id
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
@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_operoverride(map, client, context, arg):
	client.oper_override = not client.oper_override
	respond(context, "Oper override enabled" if client.oper_override else "Oper override disabled")

@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_broadcast(map, client, context, arg):
	if len(arg) > 0:
		broadcast_to_all("Admin broadcast: "+arg)

@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_kill(map, client, context, arg):
	u = find_client_by_username(arg)
	if u != None:
		respond(context, 'Killed '+u.name_and_username())
		u.disconnect('Killed by '+client.name_and_username())

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="cancel/seconds")
def fn_shutdown(map, client, context, arg):
	global ServerShutdown
	if arg == "cancel":
		ServerShutdown[0] = -1
		broadcast_to_all("Server shutdown canceled")
	elif arg.isdecimal():
		ServerShutdown[0] = int(arg)
		broadcast_to_all("Server shutdown in %d seconds! (started by %s)" % (ServerShutdown[0], client.name))

# Group commands
@cmd_command(category="Group", privilege_level="registered")
def fn_newgroup(map, client, context, arg):
	group = Entity(entity_type['group'], creator_id = client.db_id)
	group.name = "Unnamed group"
	group.save_and_commit()
	group.clean_up()
	respond(context, 'Created group %d' % group.db_id)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id text")
def fn_namegroup(map, client, context, arg):
	groupid, name = separate_first_word(arg)
	if not groupid.isdecimal() or not client.db_id or not len(name):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET name=? WHERE id=? AND owner_id=? AND type=?', (name, int(groupid), client.db_id, entity_type['group']))
	respond(context, 'Renamed group %s' % groupid)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id text")
def fn_descgroup(map, client, context, arg):
	groupid, desc = separate_first_word(arg)
	if not groupid.isdecimal() or not client.username or not len(desc):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET desc=? WHERE id=? AND owner_id=? AND type=?', (desc, int(groupid), client.db_id, entity_type['group']))
	respond(context, 'Described group %s' % groupid)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id new_owner")
def fn_changegroupowner(map, client, context, arg):
	groupid, owner = separate_first_word(arg)
	if not groupid.isdecimal() or not client.username or not len(owner):
		return
	newowner = find_db_id_by_username(owner)
	if newowner:
		c = Database.cursor()
		c.execute('UPDATE Entity SET owner_id=? WHERE id=? AND owner_id=? AND type=?', (newowner, int(groupid), client.db_id, entity_type['group']))
		respond(context, 'Group owner set to \"%s\"' % owner)
	else:
		respond(context, 'Nonexistent account', error=True)

@cmd_command(category="Group", privilege_level="registered", syntax="group_id password")
def fn_joinpassgroup(map, client, context, arg):
	groupid, joinpass = separate_first_word(arg)
	if not groupid.isdecimal() or not client.username or not len(joinpass):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET data=? WHERE id=? AND owner_id=? AND type=?', (joinpass, int(groupid), client.db_id, entity_type['group']))
	respond(context, 'Updated join password for group %s to [tt]%s[/tt]' % (groupid, joinpass))

@cmd_command(category="Group", privilege_level="registered", syntax="group_id")
def fn_deletegroup(map, client, context, arg):
	if is_entity_owner(arg, client):
		c = Database.cursor()
		c.execute('DELETE FROM Entity WHERE id=?',        (int(arg),))
		c.execute('DELETE FROM Group_Member WHERE group_id=?', (int(arg),))
		c.execute('DELETE FROM Permission WHERE gid=?',   (int(arg),))
		respond(context, 'Deleted group %s' % arg)

@cmd_command(category="Group", privilege_level="registered")
def fn_invitetogroup(map, client, context, arg):
	pass

@cmd_command(category="Group", privilege_level="registered", syntax="group_id [password]")
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

@cmd_command(category="Group", privilege_level="registered", syntax="group_id")
def fn_leavegroup(map, client, context, arg):
	if not arg.isdecimal() or not client.username:
		return
	c = Database.cursor()
	c.execute('DELETE FROM Group_Member WHERE group_id=? AND member_id=?', (int(arg), client.db_id,))
	respond(context, 'Left group %s' % (arg))

@cmd_command(category="Group", privilege_level="registered")
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
@cmd_command(category="Group", privilege_level="registered")
def fn_ownedgroups(map, client, context, arg):
	c = Database.cursor()
	groups = "Groups you are own: [ul]"
	for row in c.execute('SELECT g.id, g.name FROM Entity g WHERE g.owner_id=? AND type=?', (client.db_id, entity_type['group'])):
		groups += "[li][b]%s[/b] (%d)[/li]" % (row[1], row[0])
	groups += "[/ul]"
	respond(context, groups)

@cmd_command(category="Group", privilege_level="registered")
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
def fn_groupmembers(map, client, context, arg):
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

@cmd_command(alias=['myid', 'userid'], privilege_level="registered")
def fn_whoami(map, client, context, arg):
	if client.username == None:
		respond(context, "Your [b]%s[/b]! Your ID is [b]%s[/b] and you have not registered" % (client.name, client.protocol_id()))
	else:
		respond(context, "Your [b]%s[/b]! Your ID is [b]%s[/b] and your username is [b]%s[/b]" % (client.name, client.protocol_id(), client.username))

@cmd_command(alias=['e'])
def fn_entity(map, client, context, arg):
	# Parse
	provided_id, subcommand = separate_first_word(arg)
	subcommand, subarg = separate_first_word(subcommand)
	if subcommand == '':
		subcommand = 'info'

	# Can use "me" and "here" as special IDs
	e = None
	if provided_id == 'me':
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

	if subcommand == 'info':
		info = '[b]%s (%s)[/b] - %s' % (e.name, e.protocol_id(), entity_type_name[e.entity_type])
		if e.desc:
			info += '\n[b]Description:[/b] %s' % e.desc
		if e.owner_id:
			owner_username = find_username_by_db_id(e.owner_id)
			info += '\n[b]Owner:[/b] %s' % owner_username
		if e.creator_id:
			creator_username = find_username_by_db_id(e.creator_id)
			info += '\n[b]Creator:[/b] %s' % creator_username
		if len(e.contents):
			info += '\n[b]Contents:[/b] %s' % ', '.join(c.name_and_username() for c in e.contents)
		respond(context, info)
	elif subcommand == 'name':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			e.name = subarg
			e.broadcast_who()
	elif subcommand == 'desc':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			e.desc = subarg
	elif subcommand == 'pic':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			pic = load_json_if_valid(subarg)
			if pic and pic_is_okay(subarg):
				e.pic = pic
				e.broadcast_who()
			else:
				respond(context, "Invalid picture", error=True)

	elif subcommand == 'take':
		if permission_check(permission['move_new_map']):
			e.switch_map(client.db_id or client.protocol_id())
	elif subcommand in ('drop', 'summon'):
		if permission_check( (permission['move'], permission['move_new_map']) ):
			if e.map_id is client.map_id or permission_check(permission['move_new_map']):
				if not e.switch_map(client.map_id, new_pos=[client.x, client.y]):
					respond(context, "Entity \"%s\" doesn't have permission to go to this map" % provided_id, error=True)
	elif subcommand == 'kick':
		if (e.map_id == client.db_id and client.db_id != None) or (e.map is client) or (e.map and e.map.owner_id == client.db_id and client.db_id != None) or client.has_permission(e.map_id, (permission['admin'], permission['sandbox']), False):
			e.send_home()

	elif subcommand == 'tags':
		respond(context, "Tags: %s" % dumps_if_not_empty(e.tags))
	elif subcommand in ('addtag', 'settag'):
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			key, value = separate_first_word(subarg)
			e.set_tag(key, value)
	elif subcommand == 'deltag':
		if permission_check( (permission['modify_properties'], permission['modify_appearance']) ):
			e.del_tag(subarg)

	elif subcommand == 'do':
		if permission_check(permission['remote_command']):
			handle_user_command(e.map, e, client, context[1], subarg)
	elif subcommand == 'move':
		if permission_check(permission['move']):
			coords = subarg.split()
			if len(coords) == 2 and coords[0].isdecimal() and coords[1].isdecimal():
				e.move_to(int(coords[0]), int(coords[1]))
	elif subcommand == 'perms':
		handlers['permlist'](e, client, context, subarg)
	elif subcommand == 'permsfor':
		if subarg.isdecimal():
			allow, deny = e.get_allow_deny_for_other_entity(other_id)
			response(context, 'Allow: %s\nDeny: %s' % (permission_list_from_bitfield(allow), permission_list_from_bitfield(deny)))
	elif subcommand == 'grant':
		if permission_check(permission['admin']):
			permission_change(e, client, context, subarg, 'grant')
	elif subcommand == 'revoke':
		if permission_check(permission['admin']):
			permission_change(e, client, context, subarg, 'deny')
	elif subcommand == 'deny':
		if permission_check(permission['admin']):
			permission_change(e, client, context, subarg, 'revoke')

	else:
		respond(context, 'Unrecognized subcommand "%s"' % subcommand, error=True)

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
		# Restrict some commands to maps
		if command in map_only_commands and (client.map == None or not client.map.is_map()):
			respond(context, 'Command can only be run while on a map', error=True)
			return

		# Check permissions
		privilege_needed = command_privilege_level[command] # See user_privilege in buildglobal.py

		if privilege_needed == 1 and client.db_id == None: # Registered
			respond(context, 'Only registered accounts can use "%s"' % command, error=True)
		elif privilege_needed == 2 and client.db_id != map.owner_id and (not client.is_client() or not client.oper_override) and not client.has_permission(map, permission['admin'], False): # Map admin
			respond(context, 'Only the map owner or map admins can use "%s"' % command, error=True)
		elif privilege_needed == 3 and client.db_id != map.owner_id and (not client.is_client() or not client.oper_override): # Map owner
			respond(context, 'Only the map owner can use "%s"' % command, error=True)
		elif privilege_needed == 4 and (not client.is_client() or client.username not in Config["Server"]["Admins"]):
			respond(context, 'Only server admins can use "%s"' % command, error=True)
		else:
			return handlers[command](map, client, context, arg)
	else:
		respond(context, 'Invalid command? "%s"' % command, error=True)
