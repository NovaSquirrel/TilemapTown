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

import json, random, datetime
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
		command_privilege_level[command_name] = privilege_level
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

def sql_exists(query, data):
	c = Database.cursor()
	c.execute('SELECT EXISTS(%s)' % query, data)
	result = c.fetchone()
	return bool(result[0])

def is_entity_owner(id, client):
	""" Note that id is a string here """
	if not id.isnumeric() or not client.username:
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

def failed_to_find(user, username):
	if username == None or len(username) == 0:
		user.send("ERR", {'text': 'No username given'})
	else:
		user.send("ERR", {'text': 'Player '+username+' not found'})

def in_blocked_username_list(client, banlist, action):
	if client.username == None and '!guests' in banlist:
		client.send("ERR", {'text': 'Guests may not %s' % action})
		return True
	if client.username in banlist:
		client.send("ERR", {'text': 'You may not %s' % action})
		return True
	return False

# -------------------------------------

@cmd_command(category="Settings", syntax="newname")
def fn_nick(map, client, arg):
	if len(arg) > 0 and not arg.isspace():
		map.broadcast("MSG", {'text': "\""+client.name+"\" is now known as \""+escape_tags(arg)+"\""})
		client.name = escape_tags(arg)
		map.broadcast("WHO", {'add': client.who()}, remote_category=botwatch_type['entry']) # update client view
handlers['nick'] = fn_nick

@cmd_command(category="Settings", syntax="text")
def fn_client_settings(map, client, arg):
	client.client_settings = arg
handlers['client_settings'] = fn_client_settings

@cmd_command(category="Communication", alias=['msg', 'p'], syntax="username message")
def fn_tell(map, client, arg):
	if arg != "":
		username, privtext = separate_first_word(arg)
		if privtext.isspace() or privtext=="":
			client.send("ERR", {'text': 'Tell them what?'})
		else:
			u = find_client_by_username(username)
			if u:
				if not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
					client.send("PRI", {'text': privtext, 'name':u.name, 'username': u.username_or_id(), 'receive': False})
					u.send("PRI", {'text': privtext, 'name':client.name, 'username': client.username_or_id(), 'receive': True})
			else:
				failed_to_find(client, username)
	else:
		client.send("ERR", {'text': 'Private message who?'})

@cmd_command(category="Follow", syntax="username")
def fn_carry(map, client, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("ERR", {'text': 'You\'ve already sent them a request'})
		u.requests[my_username][0] = 600 #renew
	elif not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
		client.send("MSG", {'text': 'You requested to carry '+arg})
		u.send("MSG", {'text': client.name_and_username()+' wants to carry you', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'carry']

@cmd_command(category="Follow", syntax="username")
def fn_followme(map, client, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("ERR", {'text': 'You\'ve already sent them a request'})
		u.requests[my_username][0] = 600 #renew
	elif not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
		client.send("MSG", {'text': 'You requested to have '+arg+' follow you'})
		u.send("MSG", {'text': client.name_and_username()+' wants you to follow them', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'followme']

@cmd_command(category="Follow")
def fn_hopoff(map, client, arg):
	client.dismount()

@cmd_command(category="Follow")
def fn_dropoff(map, client, arg):
	u = find_client_by_username(arg, inside=client.passengers)
	if u:
		u.dismount()
	else:
		client.send("ERR", {'text': 'You aren\'t carrying %s' % arg})

@cmd_command(category="Follow")
def fn_carrywho(map, client, arg):
	if len(client.passengers):
		names = ''
		for u in client.passengers:
			if len(names) > 0:
				names += ', '
			names += '%s (%s)' % (u.name, u.username_or_id())
		client.send("MSG", {'text': "You are carrying %s" % names})
	else:
		client.send("MSG", {'text': "You aren\'t carrying anything"})

@cmd_command(category="Follow")
def fn_ridewho(map, client, arg):
	if client.vehicle:
		client.send("MSG", {'text': "You are riding %s" % client.vehicle.name_and_username()})
	else:
		client.send("MSG", {'text': "You aren\'t riding anything"})

@cmd_command(category="Follow")
def fn_rideend(map, client, arg):
	temp = set(client.passengers)
	for u in temp:
		u.dismount()

@cmd_command(category="Teleport", syntax="username")
def fn_tpa(map, client, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("ERR", {'text': 'You\'ve already sent them a request'})
		u.requests[my_username][0] = 600 #renew
	elif not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
		client.send("MSG", {'text': 'You requested a teleport to '+arg})
		u.send("MSG", {'text': client.name_and_username()+' wants to teleport to you', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'tpa']

@cmd_command(category="Teleport", syntax="username")
def fn_tpahere(map, client, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("ERR", {'text': 'You\'ve already sent them a request'})
		u.requests[my_username][0] = 600 #renew
	elif not in_blocked_username_list(client, u.ignore_list, 'message %s' % u.name):
		client.send("MSG", {'text': 'You requested that '+arg+' teleport to you'})
		u.send("MSG", {'text': client.name_and_username()+' wants you to teleport to them', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'tpahere']

@cmd_command(category="Teleport", alias=['hopon'], syntax="username")
def fn_tpaccept(map, client, arg):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	if arg not in client.requests:
		client.send("ERR", {'text': 'No pending request from '+arg})
	else:
		client.send("MSG", {'text': 'You accepted a teleport request from '+arg})
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
def fn_tpdeny(map, client, arg):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	if arg not in client.requests:
		client.send("ERR", {'text': 'No pending request from '+arg})
	else:
		client.send("MSG", {'text': 'You rejected a teleport request from '+arg})
		u.send("MSG", {'text': u.name_and_username()+" rejected your request"})
		del client.requests[arg]

@cmd_command(category="Teleport", syntax="username")
def fn_tpcancel(map, client, arg):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("MSG", {'text': 'Canceled request to '+arg})
		del u.requests[my_username]
	else:
		client.send("ERR", {'text': 'No request to cancel'})

@cmd_command
def fn_time(map, client, arg):
	client.send("MSG", {'text': datetime.datetime.today().strftime("Now it's %m/%d/%Y, %I:%M %p")})

@cmd_command(syntax="message")
def fn_away(map, client, arg):
	if len(arg) < 1:
		client.away = False
		client.send("MSG", {'text': 'You are no longer marked as away'})
	else:
		client.away = arg
		client.send("MSG", {'text': 'You are now marked as away ("%s")' % arg})

@cmd_command(syntax="dice sides")
def fn_roll(map, client, arg):
	param = arg.split('d')
	if len(param) != 2:
		param = arg.split(' ')
	if len(param) != 2 or (not param[0].isnumeric()) or (not param[1].isnumeric()):
		client.send("ERR", {'text': 'Syntax: /roll dice sides'})
	else:
		dice = int(param[0])
		sides = int(param[1])
		sum = 0
		if dice < 1 or dice > 1000:
			client.send("ERR", {'text': 'Bad number of dice'})
			return
		if sides < 1 or sides > 1000000000:
			client.send("ERR", {'text': 'Bad number of sides'})
			return
		for i in range(dice):
			sum += random.randint(1, sides)				
		map.broadcast("MSG", {'text': client.name+" rolled %dd%d and got %d"%(dice, sides, sum)})

@cmd_command(category="Map")
def fn_mapid(map, client, arg):
	client.send("MSG", {'text': 'Map ID is %d' % map.db_id})

@cmd_command(category="Map", privilege_level="registered")
def fn_newmap(map, client, arg):
	cursor.execute('SELECT COUNT(*) from Map')
	result = cursor.fetchone()
	if result == None:
		return
	if result[0] > Config["Server"]["MaxDBMaps"] and Config["Server"]["MaxDBMaps"] > 0:
		client.send("ERR", {'text': 'There are too many maps'})
		return

	new_map = Map(creator_id = client.db_id)
	new_map.save_and_commit()

	try:
		client.switch_map(new_map.db_id)
		client.send("MSG", {'text': 'Welcome to your new map (id %d)' % new_map.db_id})
	except: # Is it even possible for switch_map to throw an exception?
		client.send("ERR", {'text': 'Couldn\'t switch to the new map'})
		raise

# maybe combine the list add/remove/list commands together?
@cmd_command(category="Settings", syntax="username")
def fn_ignore(map, client, arg):
	arg = arg.lower()
	client.ignore_list.add(arg)
	client.send("MSG", {'text': '\"%s\" added to ignore list' % arg})

@cmd_command(category="Settings", syntax="username")
def fn_unignore(map, client, arg):
	arg = arg.lower()
	if arg in client.ignore_list:
		client.ignore_list.remove(arg)
	client.send("MSG", {'text': '\"%s\" removed from ignore list' % arg})

@cmd_command(category="Settings")
def fn_ignorelist(map, client, arg):
	client.send("MSG", {'text': 'Ignore list: '+str(client.ignore_list)})

@cmd_command(category="Settings", syntax="username")
def fn_watch(map, client, arg):
	arg = arg.lower()
	if arg in client.watch_list:
		client.watch_list.remove(arg)
	client.send("MSG", {'text': '\"%s\" added to watch list' % arg})

@cmd_command(category="Settings", syntax="username")
def fn_unwatch(map, client, arg):
	arg = arg.lower()
	client.watch_list.remove(arg)
	client.send("MSG", {'text': '\"%s\" removed from watch list' % arg})

@cmd_command(category="Settings")
def fn_watchlist(map, client, arg):
	client.send("MSG", {'text': 'Watch list: '+str(client.watch_list)})

def permission_change(map, client, arg, command2):
	# Check syntax
	param = arg.lower().split(' ')
	if len(param) < 2:
		client.send("ERR", {'text': 'Must specify a permission and a username'})
		return
	# Has to be a valid permission
	if param[0] not in permission:
		client.send("ERR", {'text': '"%s" Not a valid permission' % param[0]})
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

	# Group permissions
	if param[1].startswith("group:"):
		groupid = param[1][6:]
		if groupid.isnumeric():
			groupname = find_entity_name(int(groupid))
			if groupname != None:
				map.change_permission_for_entity(int(groupid), permission_value, True if command2=="grant" else None)
				map.broadcast("MSG", {'text': "%s sets group \"%s\"(%s) \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), groupname, groupid, param[0], command2)})
				return
		client.send("ERR", {'text': '"%s" Not a valid group number' % groupid})
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
		client.failed_to_find(param[1])
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
		u.updateMapPermissions()

@cmd_command(category="Map", privilege_level="map_admin", syntax="permission user/!default", map_only=True)
def fn_grant(map, client, arg):
	permission_change(map, client, arg, 'grant')

@cmd_command(category="Map", privilege_level="map_admin", syntax="permission user/!default/!guest", map_only=True)
def fn_deny(map, client, arg):
	permission_change(map, client, arg, 'deny')

@cmd_command(category="Map", privilege_level="map_admin", syntax="permission user/!default/!guest", map_only=True)
def fn_revoke(map, client, arg):
	permission_change(map, client, arg, 'revoke')

@cmd_command(category="Map", map_only=True)
def fn_permlist(map, client, arg):
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
	client.send("MSG", {'text': perms})
handlers['permlist'] = fn_permlist

@cmd_command(category="Map", privilege_level="registered")
def fn_mymaps(map, client, arg):
	c = Database.cursor()
	maps = "My maps: [ul]"
	for row in c.execute('SELECT m.id, m.name FROM Entity m WHERE m.owner_id=? AND m.type == ?', (client.db_id, entity_type['map'])):
		maps += "[li][b]%s[/b] [command]map %d[/command][/li]" % (row[1], row[0])
	maps += "[/ul]"
	client.send("MSG", {'text': maps})

@cmd_command(category="Map")
def fn_publicmaps(map, client, arg):
	c = Database.cursor()
	maps = "Public maps: [ul]"
	for row in c.execute('SELECT e.id, e.name, u.username FROM Entity e, Map m, User u WHERE e.owner_id=u.entity_id AND e.id=m.entity_id AND (m.flags&1)!=0'):
		maps += "[li][b]%s[/b] (%s) [command]map %d[/command][/li]" % (row[1], row[2], row[0])
	maps += "[/ul]"
	client.send("MSG", {'text': maps})

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="newname")
def fn_mapname(map, client, arg):
	map.name = arg
	client.send("MSG", {'text': 'Map name set to \"%s\"' % map.name})

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_mapdesc(map, client, arg):
	map.desc = arg
	client.send("MSG", {'text': 'Map description set to \"%s\"' % map.desc})

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="username")
def fn_mapowner(map, client, arg):
	newowner = find_db_id_by_username(arg)
	if newowner:
		map.owner = newowner
		client.send("MSG", {'text': 'Map owner set to \"%s\"' % map.owner})
	else:
		client.send("ERR", {'text': 'Nonexistent account'})

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="public/private/unlisted")
def fn_mapprivacy(map, client, arg):
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
		client.send("ERR", {'text': 'Map privacy must be public, private, or unlisted'})

@cmd_command(category="Map", privilege_level="map_admin", map_only=True, syntax="on/off")
def fn_mapprotect(map, client, arg):
	if arg == "off":
		map.allow |= permission['sandbox']
	elif arg == "on":
		map.allow &= ~permission['sandbox']
	else:
		client.send("ERR", {'text': 'Map sandbox must be on or off'})

@cmd_command(category="Map", privilege_level="map_admin", map_only=True, syntax="on/off")
def fn_mapbuild(map, client, arg):
	if arg == "on":
		map.allow |= permission['build']
	elif arg == "off":
		map.allow &= ~permission['build']
	else:
		client.send("ERR", {'text': 'Map building must be on or off'})

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_defaultfloor(map, client, arg):
	map.default_turf = arg
	client.send("MSG", {'text': 'Map floor changed to %s' % arg})

@cmd_command(category="Map", privilege_level="map_owner", map_only=True, syntax="text")
def fn_mapspawn(map, client, arg):
	map.start_pos = [client.x, client.y]
	client.send("MSG", {'text': 'Map start changed to %d,%d' % (client.x, client.y)})

@cmd_command
def fn_coords(map, client, arg):
	client.send("MSG", {'text': 'You\'re standing on %d,%d' % (client.x, client.y)})

@cmd_command
def fn_listeners(map, client, arg):
	if map == None:
		return
	out = ''
	for i in botwatch_type.keys():
		c = botwatch_type[i]
		if map.db_id in BotWatch[c]:
			for u in BotWatch[c][map.db_id]:
				out += '%s (%s), ' % (u.username, i)
	client.send("MSG", {'text': 'Listeners here: ' + out})
handlers['listeners'] = fn_listeners

@cmd_command(privilege_level="registered", syntax="category,category,category... id,id,id...")
def fn_listen(map, client, arg):
	params = arg.split()
	categories = set(params[0].split(','))
	maps = set([int(x) for x in params[1].split(',')])
	for c in categories:
		# find category number from name
		if c not in botwatch_type:
			client.send("ERR", {'text': 'Invalid listen category: %s' % c})
			return
		category = botwatch_type[c]

		for m in maps:
			if not client.has_permission(m, permission['map_bot'], False):
				client.send("ERR", {'text': 'Don\'t have permission to listen on map: %d' % m})
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

	client.send("MSG", {'text': 'Listening on maps now: ' + str(client.listening_maps)})

@cmd_command(privilege_level="registered", syntax="category,category,category... id,id,id...")
def fn_unlisten(map, client, arg):
	params = arg.split()
	categories = set(params[0].split(','))
	maps = [int(x) for x in params[1].split(',')]
	for c in categories:
		# find category number from name
		if c not in botwatch_type:
			client.send("ERR", {'text': 'Invalid listen category: "%s"' % c})
			return
		category = botwatch_type[c]

		for m in maps:
			if (m in BotWatch[category]) and (client in BotWatch[category][m]):
				BotWatch[category][m].remove(client)
				if not len(BotWatch[category][m]):
					del BotWatch[category][m]
			if (category, m) in client.listening_maps:
				client.listening_maps.remove((category, m))
	client.send("MSG", {'text': 'Stopped listening on maps: ' + str(client.listening_maps)})

def kick_and_ban(map, client, arg, ban):
	arg = arg.lower()
	u = find_client_by_username(arg)
	if u != None:
		if u.map_id == client.map_id:
			client.send("MSG", {'text': 'Kicked '+u.name_and_username()})
			u.send("MSG", {'text': 'Kicked by '+client.name_and_username()})
			u.send_home()
			if ban:
				map.change_permission_for_entity(find_db_id_by_username(arg), permission['entry'], False)
		else:
			client.send("ERR", {'text': 'User not on this map'})
	else:
		client.send("ERR", {'text': 'User not found'})

@cmd_command(category="Map", privilege_level="map_admin", syntax="username")
def fn_kick(map, client, arg):
	kick_and_ban(map, client, arg, False)

@cmd_command(category="Map", privilege_level="map_admin", syntax="username")
def fn_kickban(map, client, arg):
	kick_and_ban(map, client, arg, True)


@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_ipwho(map, client, arg):
	names = ''
	for u in AllClients:
		if len(names) > 0:
			names += ', '
		names += "%s [%s]" % (u.name_and_username(), u.ip or "?")
	client.send("MSG", {'text': 'List of users connected: '+names})

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="ip;reason;length")
def fn_ipban(map, client, arg):
	params = arg.split(';')
	if len(params) == 2: # Default to no expiration
		params.append('')
	if len(params) != 3 or len(params[0]) == 0:
		client.send("ERR", {'text': 'Format is ip;reason;length'})
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
	elif not expiry_value.isnumeric():
		client.send("ERR", {'text': 'Invalid time value "%s"' % expiry_value})
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
		client.send("ERR", {'text': 'Invalid time unit "%s"' % expiry_unit})
		return

	# If IPv4, split into four parts for masking
	ipsplit = ip.split('.')
	if len(ipsplit) != 4:
		ipsplit = (None, None, None, None)

	# Insert the ban
	c = Database.cursor()
	c.execute("INSERT INTO Server_Ban (ip, ip1, ip2, ip3, ip4, admin_id, created_at, expires_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",\
		(ip, ipsplit[0], ipsplit[1], ipsplit[2], ipsplit[3], client.db_id, now, expiry, reason))
	Database.commit()
	client.send("MSG", {'text': 'Banned %s for "%s"; unban at %s' % (ip, reason, expiry or "never")})

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="ip")
def fn_ipunban(map, client, arg):
	c = Database.cursor()
	c.execute('DELETE FROM Server_Ban WHERE ip=?', (arg,))
	c.execute('SELECT changes()')
	client.send("MSG", {'text': 'Bans removed: %d' % c.fetchone()[0]})
	Database.commit()

@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_ipbanlist(map, client, arg):
	c = Database.cursor()
	results = "IP bans: [ul]"
	for row in c.execute('SELECT b.ip, b.reason, b.time, b.expiry, a.username FROM Server_Ban b, USER a WHERE a.uid = b.admin'):
		results += "[li][b]%s[/b] banned by [tt]%s[/tt] for \"%s\" at [tt]%s[/tt] until [tt]%s[/tt] [command]ipunban %s[/command][/li]" % (row[0], row[4], row[1], row[2], row[3] or 'never', row[0])
	results += "[/ul]"
	client.send("MSG", {'text': results})

@cmd_command(category="Teleport")
def fn_goback(map, client, arg):
	if len(client.tp_history) > 0:
		pos = client.tp_history.pop()
		client.switch_map(pos[0], new_pos=[pos[1], pos[2]], update_history=False)
	else:
		client.send("ERR", {'text': 'Nothing in teleport history'})

@cmd_command(category="Teleport")
def fn_sethome(map, client, arg):
	client.home = [client.map_id, client.x, client.y]
	client.send("MSG", {'text': 'Home set'})

@cmd_command(category="Teleport")
def fn_home(map, client, arg):
	if client.home == None:
		client.send("ERR", {'text': 'You don\'t have a home set'})
	else:
		client.send("MSG", {'text': 'Teleported to your home'})
		client.send_home()

@cmd_command(category="Teleport", syntax="map")
def fn_map(map, client, arg):
	try:
		if map_id_exists(int(arg)):
			if client.switch_map(int(arg)):
				client.send("MSG", {'text': 'Teleported to map %s' % arg})
		else:
			client.send("MSG", {'text': 'Map %s doesn\'t exist' % arg})
	except:
		client.send("ERR", {'text': 'Couldn\'t go to map %s' % arg})

@cmd_command(category="Account", privilege_level="registered")
def fn_saveme(map, client, arg):
	client.save_and_commit()
	client.send("MSG", {'text': 'Account saved'})

@cmd_command(category="Account", privilege_level="registered", syntax="password")
def fn_changepass(map, client, arg):
	if len(arg):
		client.changepass(arg)
		client.send("MSG", {'text': 'Password changed'})
	else:
		client.send("ERR", {'text': 'No password given'})

@cmd_command(category="Account", syntax="username password")
def fn_register(map, client, arg):
	if client.db_id != None:
		client.send("ERR", {'text': 'Register fail, you already registered'})
	else:
		params = arg.split()
		if len(params) != 2:
			client.send("ERR", {'text': 'Syntax is: /register username password'})
		else:
			if client.register(filter_username(params[0]), params[1]):
				map.broadcast("MSG", {'text': client.name+" has now registered"})
				map.broadcast("WHO", {'add': client.who()}) # update client view, probably just for the username
			else:
				client.send("ERR", {'text': 'Register fail, account already exists'})

@cmd_command(category="Account", syntax="username password")
def fn_login(map, client, arg):
	params = arg.split()
	if len(params) != 2:
		client.send("ERR", {'text': 'Syntax is: /login username password'})
	else:
		client.login(filter_username(params[0]), params[1])
handlers['login'] = fn_login

@cmd_command(category="Settings", syntax='"x y" OR "url" OR "bunny/cat/hamster/fire"')
def fn_userpic(map, client, arg):
	arg = arg.split(' ')
	success = False

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
					client.send("ERR", {'text': 'URL doesn\'t match any whitelisted sites'})
					return
	elif len(arg) == 2:
		if arg[0].isnumeric() and arg[1].isnumeric():
			client.pic = [0, int(arg[0]), int(arg[1])]
			success = True
	if success:
		if map:
			map.broadcast("WHO", {'add': client.who()}) # update client view
	else:
		client.send("ERR", {'text': 'Syntax is: /userpic sheet x y'})

@cmd_command(category="Who")
def fn_gwho(map, client, arg):
	names = ''
	for u in AllClients:
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	client.send("MSG", {'text': 'List of users connected: '+names})

@cmd_command(category="Who")
def fn_who(map, client, arg):
	names = ''
	for u in map.contents:
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	client.send("MSG", {'text': 'List of users here: '+names})

@cmd_command(category="Who", alias=['wa'])
def fn_whereare(map, client, arg):
	names = 'Whereare: [ul]'
	for k, m in AllMaps.items():
		if m.flags & mapflag['public'] == 0:
			continue
		names += '[li][b]%s[/b] (%d): ' % (m.name, len(m.users))
		for u in m.users:
			names += u.name_and_username()+', '
		names = names.rstrip(', ') + ' [command]map %d[/command][/li]' % m.id
	names += '[/ul]'

	client.send("MSG", {'text': names})

@cmd_command(category="Map")
def fn_savemap(map, client, arg):
	map.save()
	map.broadcast("MSG", {'text': client.name+" saved the map"})

# Server admin commands
@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_operoverride(map, client, arg):
	client.oper_override = not client.oper_override
	client.send("MSG", {'text': "Oper override enabled" if client.oper_override else "Oper override disabled"})

@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_broadcast(map, client, arg):
	if len(arg) > 0:
		broadcast_to_all("Admin broadcast: "+arg)

@cmd_command(category="Server Admin", privilege_level="server_admin")
def fn_kill(map, client, arg):
	u = find_client_by_username(arg)
	if u != None:
		client.send("MSG", {'text': 'Killed '+u.name_and_username()})
		u.disconnect('Killed by '+client.name_and_username())

@cmd_command(category="Server Admin", privilege_level="server_admin", syntax="cancel/seconds")
def fn_shutdown(map, client, arg):
	global ServerShutdown
	if arg == "cancel":
		ServerShutdown[0] = -1
		broadcast_to_all("Server shutdown canceled")
	elif arg.isnumeric():
		ServerShutdown[0] = int(arg)
		broadcast_to_all("Server shutdown in %d seconds! (started by %s)" % (ServerShutdown[0], client.name))

# Group commands
@cmd_command(category="Group", privilege_level="registered")
def fn_newgroup(map, client, arg):
	group = Entity(entity_type['group'], creator_id = client.db_id)
	group.name = "Unnamed group"
	group.save_and_commit()
	group.cleanup()
	client.send("MSG", {'text': 'Created group %d' % group.db_id})

@cmd_command(category="Group", privilege_level="registered", syntax="group_id text")
def fn_namegroup(map, client, arg):
	groupid, name = separate_first_word(arg)
	if not groupid.isnumeric() or not client.db_id or not len(name):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET name=? WHERE id=? AND owner_id=? AND type=?', (name, int(groupid), client.db_id, entity_type['group']))
	client.send("MSG", {'text': 'Renamed group %s' % groupid})

@cmd_command(category="Group", privilege_level="registered", syntax="group_id text")
def fn_descgroup(map, client, arg):
	groupid, desc = separate_first_word(arg)
	if not groupid.isnumeric() or not client.username or not len(desc):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET desc=? WHERE id=? AND owner_id=? AND type=?', (desc, int(groupid), client.db_id, entity_type['group']))
	client.send("MSG", {'text': 'Described group %s' % groupid})

@cmd_command(category="Group", privilege_level="registered", syntax="group_id new_owner")
def fn_changegroupowner(map, client, arg):
	groupid, owner = separate_first_word(arg)
	if not groupid.isnumeric() or not client.username or not len(owner):
		return
	newowner = find_db_id_by_username(owner)
	if newowner:
		c = Database.cursor()
		c.execute('UPDATE Entity SET owner_id=? WHERE id=? AND owner_id=? AND type=?', (newowner, int(groupid), client.db_id, entity_type['group']))
		client.send("MSG", {'text': 'Group owner set to \"%s\"' % owner})
	else:
		client.send("ERR", {'text': 'Nonexistent account'})

@cmd_command(category="Group", privilege_level="registered", syntax="group_id password")
def fn_joinpassgroup(map, client, arg):
	groupid, joinpass = separate_first_word(arg)
	if not groupid.isnumeric() or not client.username or not len(joinpass):
		return
	c = Database.cursor()
	c.execute('UPDATE Entity SET data=? WHERE id=? AND owner_id=? AND type=?', (joinpass, int(groupid), client.db_id, entity_type['group']))
	client.send("MSG", {'text': 'Updated join password for group %s to [tt]%s[/tt]' % (groupid, joinpass)})
handlers['joinpassgroup'] = fn_joinpassgroup

@cmd_command(category="Group", privilege_level="registered", syntax="group_id")
def fn_deletegroup(map, client, arg):
	if is_entity_owner(arg, client):
		c = Database.cursor()
		c.execute('DELETE FROM Entity WHERE id=?',        (int(arg),))
		c.execute('DELETE FROM Group_Member WHERE group_id=?', (int(arg),))
		c.execute('DELETE FROM Permission WHERE gid=?',   (int(arg),))
		client.send("MSG", {'text': 'Deleted group %s' % arg})

@cmd_command(category="Group", privilege_level="registered")
def fn_invitetogroup(map, client, arg):
	pass

@cmd_command(category="Group", privilege_level="registered", syntax="group_id [password]")
def fn_joingroup(map, client, arg):
	groupid, password = separate_first_word(arg)
	if password != "" and groupid.isnumeric() and client.db_id and sql_exists('SELECT * FROM Entity WHERE data=? AND type=?', (password, entity_type['group'])):
		if not sql_exists('SELECT member_id from Group_Member WHERE member_id=? AND group_id=?', (client.db_id, int(groupid))):
			c = Database.cursor()
			c.execute("INSERT INTO Group_Member (group_id, user_id, flags) VALUES (?, ?, ?)", (int(groupid), client.db_id, 0,))
			client.send("MSG", {'text': 'Joined group %s' % groupid})
		else:
			client.send("ERR", {'text': 'Already in group %s' % groupid})
	else:
		client.send("ERR", {'text': 'Nonexistent group or wrong password'})

@cmd_command(category="Group", privilege_level="registered", syntax="group_id")
def fn_leavegroup(map, client, arg):
	if not arg.isnumeric() or not client.username:
		return
	c.execute('DELETE FROM Group_Member WHERE group_id=? AND uid=?', (int(arg), client.db_id,))
	client.send("MSG", {'text': 'Left group %s' % (arg)})

@cmd_command(category="Group", privilege_level="registered")
def fn_kickgroup(map, client, arg):
	groupid, person = separate_first_word(arg)
	if is_entity_owner(groupid, client):
		if not len(person):
			return
		personid = find_db_id_by_username(person)
		if personid:
			c = Database.cursor()
			c.execute('DELETE FROM Group_Member WHERE group_id=? AND user_id=?', (int(groupid), personid,))
			client.send("MSG", {'text': 'Kicked \"%s\" from group %s' % (person, groupid)})
		else:
			client.send("ERR", {'text': 'Nonexistent account'})

# Perhaps merge these two somehow?
@cmd_command(category="Group", privilege_level="registered")
def fn_ownedgroups(map, client, arg):
	if client.db_id == None:
		return
	c = Database.cursor()
	groups = "Groups you are own: [ul]"
	for row in c.execute('SELECT g.id, g.name FROM Entity g WHERE g.owner=? AND type=?', (client.db_id, entity_type['group'])):
		groups += "[li][b]%s[/b] (%d)[/li]" % (row[1], row[0])
	groups += "[/ul]"
	client.send("MSG", {'text': groups})
handlers['ownedgroups'] = fn_ownedgroups

@cmd_command(category="Group", privilege_level="registered")
def fn_mygroups(map, client, arg):
	if client.db_id == None:
		return
	c = Database.cursor()
	groups = "Groups you are in: [ul]"
	for row in c.execute('SELECT g.id, g.name FROM Entity g, Group_Member m WHERE g.id=m.group_id AND m.user_id=? AND m.accepted_at != NULL', (client.db_id,)):
		groups += "[li][b]%s[/b] (%d)[/li]" % (row[1], row[0])
	groups += "[/ul]"
	client.send("MSG", {'text': groups})
handlers['mygroups'] = fn_mygroups


# -------------------------------------

def handle_user_command(map, client, text):
	# Separate text into command and arguments
	command, arg = separate_first_word(text)

	# Attempt to run the command handler if it exists

	# Check aliases first
	if command in aliases:
		command = aliases[command]

	if command in handlers:
		# Restrict some commands to maps
		if command in map_only_commands and client.map == None or not client.map.is_map():
			client.send("ERR", {'text': 'Command can only be run while on a map'})
			return

		# Check permissions
		privilege_needed = command_privilege_level[command] # See user_privilege in buildglobal.py

		if privilege_needed == 1 and client.db_id == None: # Registered
			client.send("ERR", {'text': 'Only registered accounts can use "%s"' % command})
		elif privilege_needed == 2 and client.db_id != map.owner_id and (not client.is_client() or not client.oper_override) and not client.has_permission(map, permission['admin'], False): # Map admin
			client.send("ERR", {'text': 'Only the map owner or map admins can use "%s"' % command})
		elif privilege_needed == 3 and client.db_id != map.owner_id and (not client.is_client() or not client.oper_override): # Map owner
			client.send("ERR", {'text': 'Only the map owner can use "%s"' % command})
		elif privilege_needed == 4 and (not client.is_client() or client.username not in Config["Server"]["Admins"]):
			client.send("ERR", {'text': 'Only server admins can use "%s"' % command})
		else:
			return handlers[command](map, client, arg)
	else:
		client.send("ERR", {'text': 'Invalid command?'})
