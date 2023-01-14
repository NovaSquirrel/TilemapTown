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

# Filtering chat text
def escape_tags(text):
	return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def find_group_name(groupid):
	c = Database.cursor()
	c.execute('SELECT name FROM User_Group WHERE gid=?', (groupid,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def sql_exists(query, data):
	c = Database.cursor()
	c.execute('SELECT EXISTS(%s)' % query, data)
	result = c.fetchone()
	return bool(result[0])

def is_group_owner(groupid, client):
	""" Note that groupid is a string here """
	if not groupid.isnumeric() or not client.username:
		return False
	return sql_exists('SELECT owner FROM User_Group WHERE gid=? AND owner=?', (int(groupid), client.db_id))

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

# -------------------------------------

handlers = {}	# dictionary of functions to call for each command
aliases = {}	# dictionary of commands to change to other commands

def fn_nick(self, client, arg):
	if len(arg) > 0 and not arg.isspace():
		self.broadcast("MSG", {'text': "\""+client.name+"\" is now known as \""+escape_tags(arg)+"\""})
		client.name = escape_tags(arg)
		self.broadcast("WHO", {'add': client.who()}, remote_category=botwatch_type['entry']) # update client view
handlers['nick'] = fn_nick

def fn_client_settings(self, client, arg):
	client.client_settings = arg
handlers['client_settings'] = fn_client_settings

def fn_tell(self, client, arg):
	if arg != "":
		username, privtext = separate_first_word(arg)
		if privtext.isspace() or privtext=="":
			client.send("ERR", {'text': 'Tell them what?'})
		else:
			u = find_client_by_username(username)
			if u:
				if not client.in_ban_list(u.ignore_list, 'message %s' % u.name):
					client.send("PRI", {'text': privtext, 'name':u.name, 'username': u.username_or_id(), 'receive': False})
					u.send("PRI", {'text': privtext, 'name':client.name, 'username': client.username_or_id(), 'receive': True})
			else:
				failed_to_find(client, username)
	else:
		client.send("ERR", {'text': 'Private message who?'})
handlers['tell'] = fn_tell
aliases['msg'] = 'tell'
aliases['p'] = 'tell'

def fn_carry(self, client, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("ERR", {'text': 'You\'ve already sent them a request'})
		u.requests[my_username][0] = 600 #renew
	elif not client.in_ban_list(u.ignore_list, 'message %s' % u.name):
		client.send("MSG", {'text': 'You requested to carry '+arg})
		u.send("MSG", {'text': client.name_and_username()+' wants to carry you', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'carry']
handlers['carry'] = fn_carry

def fn_followme(self, client, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("ERR", {'text': 'You\'ve already sent them a request'})
		u.requests[my_username][0] = 600 #renew
	elif not client.in_ban_list(u.ignore_list, 'message %s' % u.name):
		client.send("MSG", {'text': 'You requested to have '+arg+' follow you'})
		u.send("MSG", {'text': client.name_and_username()+' wants you to follow them', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'followme']
handlers['followme'] = fn_followme

def fn_hopoff(self, client, arg):
	client.dismount()
handlers['hopoff'] = fn_hopoff

def fn_dropoff(self, client, arg):
	u = find_client_by_username(arg, inside=client.passengers)
	if u:
		u.dismount()
	else:
		client.send("ERR", {'text': 'You aren\'t carrying %s' % arg})
handlers['dropoff'] = fn_dropoff

def fn_carrywho(self, client, arg):
	if len(client.passengers):
		names = ''
		for u in client.passengers:
			if len(names) > 0:
				names += ', '
			names += '%s (%s)' % (u.name, u.username_or_id())
		client.send("MSG", {'text': "You are carrying %s" % names})
	else:
		client.send("MSG", {'text': "You aren\'t carrying anything"})
handlers['carrywho'] = fn_carrywho

def fn_ridewho(self, client, arg):
	if client.vehicle:
		client.send("MSG", {'text': "You are riding %s" % client.vehicle.name_and_username()})
	else:
		client.send("MSG", {'text': "You aren\'t riding anything"})
handlers['ridewho'] = fn_ridewho

def fn_rideend(self, client, arg):
	temp = set(client.passengers)
	for u in temp:
		u.dismount()
handlers['rideend'] = fn_rideend

def fn_tpa(self, client, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("ERR", {'text': 'You\'ve already sent them a request'})
		u.requests[my_username][0] = 600 #renew
	elif not client.in_ban_list(u.ignore_list, 'message %s' % u.name):
		client.send("MSG", {'text': 'You requested a teleport to '+arg})
		u.send("MSG", {'text': client.name_and_username()+' wants to teleport to you', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'tpa']
handlers['tpa'] = fn_tpa

def fn_tpahere(self, client, arg):
	u = find_client_by_username(arg)
	if u == None:
		failed_to_find(client, arg)
		return
	my_username = client.username_or_id()
	if my_username in u.requests:
		client.send("ERR", {'text': 'You\'ve already sent them a request'})
		u.requests[my_username][0] = 600 #renew
	elif not client.in_ban_list(u.ignore_list, 'message %s' % u.name):
		client.send("MSG", {'text': 'You requested that '+arg+' teleport to you'})
		u.send("MSG", {'text': client.name_and_username()+' wants you to teleport to them', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
		u.requests[my_username] = [600, 'tpahere']
handlers['tpahere'] = fn_tpahere

def fn_tpaccept(self, client, arg):
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
handlers['tpaccept'] = fn_tpaccept
aliases['hopon'] = 'tpaccept'

def fn_tpdeny(self, client, arg):
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
handlers['tpdeny'] = fn_tpdeny
aliases['tpdecline'] = 'tpdeny'

def fn_tpcancel(self, client, arg):
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
handlers['tpcancel'] = fn_tpcancel

def fn_time(self, client, arg):
	client.send("MSG", {'text': datetime.datetime.today().strftime("Now it's %m/%d/%Y, %I:%M %p")})
handlers['time'] = fn_time

def fn_away(self, client, arg):
	if len(arg) < 1:
		client.away = False
		client.send("MSG", {'text': 'You are no longer marked as away'})
	else:
		client.away = arg
		client.send("MSG", {'text': 'You are now marked as away ("%s")' % arg})
handlers['away'] = fn_away

def fn_roll(self, client, arg):
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
		self.broadcast("MSG", {'text': client.name+" rolled %dd%d and got %d"%(dice, sides, sum)})
handlers['roll'] = fn_roll

def fn_mapid(self, client, arg):
	client.send("MSG", {'text': 'Map ID is %d' % self.id})
handlers['mapid'] = fn_mapid

def fn_newmap(self, client, arg):
	if client.username:
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
	else:
		client.send("ERR", {'text': 'You must be registered to make a new map.'})
handlers['newmap'] = fn_newmap

# maybe combine the list add/remove/list commands together?
def fn_ignore(self, client, arg):
	arg = arg.lower()
	client.ignore_list.add(arg)
	client.send("MSG", {'text': '\"%s\" added to ignore list' % arg})
handlers['ignore'] = fn_ignore

def fn_unignore(self, client, arg):
	arg = arg.lower()
	if arg in client.ignore_list:
		client.ignore_list.remove(arg)
	client.send("MSG", {'text': '\"%s\" removed from ignore list' % arg})
handlers['unignore'] = fn_unignore

def fn_ignorelist(self, client, arg):
	client.send("MSG", {'text': 'Ignore list: '+str(client.ignore_list)})
handlers['ignorelist'] = fn_ignorelist

def fn_watch(self, client, arg):
	arg = arg.lower()
	if arg in client.watch_list:
		client.watch_list.remove(arg)
	client.send("MSG", {'text': '\"%s\" added to watch list' % arg})
handlers['watch'] = fn_watch

def fn_unwatch(self, client, arg):
	arg = arg.lower()
	client.watch_list.remove(arg)
	client.send("MSG", {'text': '\"%s\" removed from watch list' % arg})
handlers['unwatch'] = fn_unwatch

def fn_watchlist(self, client, arg):
	client.send("MSG", {'text': 'Watch list: '+str(client.watch_list)})
handlers['watchlist'] = fn_watchlist

def fn_permission_change(self, client, arg, command2):
	if client.must_be_owner(True):
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
				self.allow |= permission_value
				self.deny &= ~permission_value
			elif command2 == "deny":
				self.allow &= ~permission_value
				self.deny |= permission_value
			elif command2 == "revoke":
				self.allow &= ~permission_value
				self.deny &= ~permission_value
			self.broadcast("MSG", {'text': "%s sets the default \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), param[0], command2)})
			return

		# Group permissions
		if param[1].startswith("group:"):
			groupid = param[1][6:]
			if groupid.isnumeric():
				groupname = find_group_name(int(groupid))
				if groupname != None:
					self.set_group_permission(int(groupid), permission_value, True if command2=="grant" else None)
					self.broadcast("MSG", {'text': "%s sets group \"%s\"(%s) \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), groupname, groupid, param[0], command2)})
					return
			client.send("ERR", {'text': '"%s" Not a valid group number' % groupid})
			return

		# Guest permissions
		if param[1] == '!guest':
			if command2 == "deny":
				self.guest_deny |= permission_value
			elif command2 == "revoke":
				self.guest_deny &= ~permission_value
			self.broadcast("MSG", {'text': "%s sets the guest \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), param[0], command2)})
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
		self.set_permission(uid, permission_value, value)
		self.broadcast("MSG", {'text': "%s sets %s's \"%s\" permission to [b]%s[/b]" % (client.name_and_username(), param[1], param[0], command2)})

		# Refresh permissions of users on the map so changes take effect immediately
		# (probably only need to do it for the affected user, if they're even present)
		for u in self.users:
			u.updateMapPermissions()

def fn_grant(self, client, arg):
	fn_permission_change(self, client, arg, 'grant')
handlers['grant'] = fn_grant

def fn_deny(self, client, arg):
	fn_permission_change(self, client, arg, 'deny')
handlers['deny'] = fn_deny

def fn_revoke(self, client, arg):
	fn_permission_change(self, client, arg, 'revoke')
handlers['revoke'] = fn_revoke


def fn_permlist(self, client, arg):
	c = Database.cursor()
	perms = "Defaults: "

	# List map default permissions
	for k,v in permission.items():
		if (self.allow & v) == v:
			perms += "+"+k+" "
		if (self.deny & v) == v:
			perms += "-"+k+" "
		if (self.guest_deny & v) == v:
			perms += "-"+k+"(guest) "

	# User permissions
	perms += "[ul]"
	for row in c.execute('SELECT username, allow, deny FROM Map_Permission mp, User u WHERE mp.mid=? AND mp.uid=u.uid', (self.id,)):
		perms += "[li][b]"+row[0] + "[/b]: "
		for k,v in permission.items():
			if (row[1] & v) == v: # allow
				perms += "+"+k+" "
			if (row[2] & v) == v: #deny
				perms += "-"+k+" "
		perms += "[/li]"

	# Group permissions
	for row in c.execute('SELECT mp.allow, u.name, u.gid FROM Group_Map_Permission mp, User_Group u WHERE mp.mid=? AND mp.gid=u.gid', (self.id,)):
		perms += "[li][b]Group: %s(%s) [/b]: " % (row[2], row[1])
		for k,v in permission.items():
			if (row[0] & v) == v: # allow
				perms += "+"+k+" "
		perms += "[/li]"

	perms += "[/ul]"
	client.send("MSG", {'text': perms})
handlers['permlist'] = fn_permlist

def fn_mymaps(self, client, arg):
	if client.db_id == None:
		return
	c = Database.cursor()
	maps = "My maps: [ul]"
	for row in c.execute('SELECT m.mid, m.name FROM Map m WHERE m.owner=?', (client.db_id,)):
		maps += "[li][b]%s[/b] [command]map %d[/command][/li]" % (row[1], row[0])
	maps += "[/ul]"
	client.send("MSG", {'text': maps})
handlers['mymaps'] = fn_mymaps

def fn_publicmaps(self, client, arg):
	c = Database.cursor()
	maps = "Public maps: [ul]"
	for row in c.execute('SELECT m.mid, m.name, u.username FROM Map m, User u WHERE m.owner=u.uid and (m.flags&1)!=0'):
		maps += "[li][b]%s[/b] (%s) [command]map %d[/command][/li]" % (row[1], row[2], row[0])
	maps += "[/ul]"
	client.send("MSG", {'text': maps})
handlers['publicmaps'] = fn_publicmaps

def fn_mapname(self, client, arg):
	if client.must_be_owner(False):
		self.name = arg
		client.send("MSG", {'text': 'Map name set to \"%s\"' % self.name})
handlers['mapname'] = fn_mapname

def fn_mapdesc(self, client, arg):
	if client.must_be_owner(False):
		self.desc = arg
		client.send("MSG", {'text': 'Map description set to \"%s\"' % self.desc})
handlers['mapdesc'] = fn_mapdesc

def fn_mapowner(self, client, arg):
	if client.must_be_owner(False):
		newowner = find_db_id_by_username(arg)
		if newowner:
			self.owner = newowner
			client.send("MSG", {'text': 'Map owner set to \"%s\"' % self.owner})
		else:
			client.send("ERR", {'text': 'Nonexistent account'})
handlers['mapowner'] = fn_mapowner

def fn_mapprivacy(self, client, arg):
	if client.must_be_owner(False):
		if arg == "public":
			self.deny &= ~permission['entry']
			self.flags |= mapflag['public']
		elif arg == "private":
			self.deny |= permission['entry']
			self.flags &= ~mapflag['public']
		elif arg == "unlisted":
			self.deny &= ~permission['entry']
			self.flags &= ~mapflag['public']
		else:
			client.send("ERR", {'text': 'Map privacy must be public, private, or unlisted'})
handlers['mapprivacy'] = fn_mapprivacy

def fn_mapprotect(self, client, arg):
	if client.must_be_owner(False):
		if arg == "off":
			self.allow |= permission['sandbox']
		elif arg == "on":
			self.allow &= ~permission['sandbox']
		else:
			client.send("ERR", {'text': 'Map building must be on or off'})
handlers['mapprotect'] = fn_mapprotect

def fn_mapbuild(self, client, arg):
	if client.must_be_owner(True):
		if arg == "on":
			self.allow |= permission['build']
		elif arg == "off":
			self.allow &= ~permission['build']
		else:
			client.send("ERR", {'text': 'Map building must be on or off'})
handlers['mapbuild'] = fn_mapbuild

def fn_defaultfloor(self, client, arg):
	if client.must_be_owner(False):
		self.default_turf = arg
		client.send("MSG", {'text': 'Map floor changed to %s' % arg})
handlers['defaultfloor'] = fn_defaultfloor

def fn_mapspawn(self, client, arg):
	if client.must_be_owner(False):
		self.start_pos = [client.x, client.y]
		client.send("MSG", {'text': 'Map start changed to %d,%d' % (client.x, client.y)})
handlers['mapspawn'] = fn_mapspawn

def fn_coords(self, client, arg):
	client.send("MSG", {'text': 'You\'re standing on %d,%d' % (client.x, client.y)})
handlers['coords'] = fn_coords

def fn_listeners(self, client, arg):
	out = ''
	for i in botwatch_type.keys():
		c = botwatch_type[i]
		if self.id in BotWatch[c]:
			for u in BotWatch[c][self.id]:
				out += '%s (%s), ' % (u.username, i)
	client.send("MSG", {'text': 'Listeners here: ' + out})
handlers['listeners'] = fn_listeners

def fn_listen(self, client, arg):
	if client.db_id == None:
		return
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
			cursor = Database.cursor()
			cursor.execute('SELECT allow FROM Map_Permission WHERE mid=? AND uid=?', (m, client.db_id,))
			result = cursor.fetchone()
			if (result == None) or (result[0] & permission['map_bot'] == 0):
				client.send("ERR", {'text': 'Don\'t have permission to listen on map: %d' % m})
				return
			if m not in BotWatch[category]:
				BotWatch[category][m] = set()
			BotWatch[category][m].add(client)
			client.listening_maps.add((category, m))

			# Send initial data
			if c == 'build':
				map = get_map_by_id(m)
				data = map.map_info()
				data['remote_map'] = m
				client.send("MAI", data)

				data = map.map_section(0, 0, map.width-1, map.height-1)
				data['remote_map'] = m
				client.send("MAP", data)
			elif c == 'entry':
				client.send("WHO", {'list': get_map_by_id(m).who(), 'remote_map': m})

	client.send("MSG", {'text': 'Listening on maps now: ' + str(client.listening_maps)})
handlers['listen'] = fn_listen

def fn_unlisten(self, client, arg):
	if client.db_id == None:
		return
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
handlers['unlisten'] = fn_unlisten

def fn_kick_and_ban(self, client, arg, ban):
	arg = arg.lower()
	if client.must_be_owner(True):
		u = find_client_by_username(arg)
		if u != None:
			if u.map_id == client.map_id:
				client.send("MSG", {'text': 'Kicked '+u.name_and_username()})
				u.send("MSG", {'text': 'Kicked by '+client.name_and_username()})
				u.send_home()
				if ban:
					self.set_permission(find_db_id_by_username(arg), permission['entry'], False)
			else:
				client.send("ERR", {'text': 'User not on this map'})
		else:
			client.send("ERR", {'text': 'User not found'})

def fn_kick(self, client, arg):
	fn_kick_and_ban(self, client, arg, False)
handlers['kick'] = fn_kick

def fn_kickban(self, client, arg):
	fn_kick_and_ban(self, client, arg, True)
handlers['kickban'] = fn_kickban



def fn_ipwho(self, client, arg):
	if client.must_be_server_admin():
		names = ''
		for u in AllClients:
			if len(names) > 0:
				names += ', '
			names += "%s [%s]" % (u.name_and_username(), u.ip or "?")
		client.send("MSG", {'text': 'List of users connected: '+names})
handlers['ipwho'] = fn_ipwho

def fn_ipban(self, client, arg):
	if client.must_be_server_admin():
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
		c.execute("INSERT INTO Server_Ban (ip, ip1, ip2, ip3, ip4, admin, time, expiry, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",\
			(ip, ipsplit[0], ipsplit[1], ipsplit[2], ipsplit[3], client.db_id, now, expiry, reason))
		client.send("MSG", {'text': 'Banned %s for "%s"; unban at %s' % (ip, reason, expiry or "never")})

handlers['ipban'] = fn_ipban

def fn_ipunban(self, client, arg):
	if client.must_be_server_admin():
		c = Database.cursor()
		c.execute('DELETE FROM Server_Ban WHERE ip=?', (arg,))
		c.execute('SELECT changes()')
		client.send("MSG", {'text': 'Bans removed: %d' % c.fetchone()[0]})

handlers['ipunban'] = fn_ipunban

def fn_ipbanlist(self, client, arg):
	if client.must_be_server_admin():
		c = Database.cursor()
		results = "IP bans: [ul]"
		for row in c.execute('SELECT b.ip, b.reason, b.time, b.expiry, a.username FROM Server_Ban b, USER a WHERE a.uid = b.admin'):
			results += "[li][b]%s[/b] banned by [tt]%s[/tt] for \"%s\" at [tt]%s[/tt] until [tt]%s[/tt] [command]ipunban %s[/command][/li]" % (row[0], row[4], row[1], row[2], row[3] or 'never', row[0])
		results += "[/ul]"
		client.send("MSG", {'text': results})
handlers['ipbanlist'] = fn_ipbanlist


def fn_goback(self, client, arg):
	if len(client.tp_history) > 0:
		pos = client.tp_history.pop()
		client.switch_map(pos[0], new_pos=[pos[1], pos[2]], update_history=False)
	else:
		client.send("ERR", {'text': 'Nothing in teleport history'})
handlers['goback'] = fn_goback

def fn_sethome(self, client, arg):
	client.home = [client.map_id, client.x, client.y]
	client.send("MSG", {'text': 'Home set'})
handlers['sethome'] = fn_sethome

def fn_home(self, client, arg):
	if client.home == None:
		client.send("ERR", {'text': 'You don\'t have a home set'})
	else:
		client.send("MSG", {'text': 'Teleported to your home'})
		client.send_home()
handlers['home'] = fn_home

def fn_map(self, client, arg):
	try:
		if map_id_exists(int(arg)):
			if client.switch_map(int(arg)):
				client.send("MSG", {'text': 'Teleported to map %s' % arg})
		else:
			client.send("MSG", {'text': 'Map %s doesn\'t exist' % arg})
	except:
		client.send("ERR", {'text': 'Couldn\'t go to map %s' % arg})
handlers['map'] = fn_map

def fn_saveme(self, client, arg):
	if client.username == None:
		client.send("ERR", {'text': 'You are not logged in'})
	else:
		client.save()
		client.send("MSG", {'text': 'Account saved'})
handlers['saveme'] = fn_saveme

def fn_changepass(self, client, arg):
	if client.username == None:
		client.send("ERR", {'text': 'You are not logged in'})
	elif len(arg):
		client.changepass(arg)
		client.send("MSG", {'text': 'Password changed'})
	else:
		client.send("ERR", {'text': 'No password given'})
handlers['changepass'] = fn_changepass

def fn_register(self, client, arg):
	if client.username != None:
		client.send("ERR", {'text': 'Register fail, you already registered'})
	else:
		params = arg.split()
		if len(params) != 2:
			client.send("ERR", {'text': 'Syntax is: /register username password'})
		else:
			if client.register(filter_username(params[0]), params[1]):
				self.broadcast("MSG", {'text': client.name+" has now registered"})
				self.broadcast("WHO", {'add': client.who()}) # update client view, probably just for the username
			else:
				client.send("ERR", {'text': 'Register fail, account already exists'})
handlers['register'] = fn_register

def fn_login(self, client, arg):
	params = arg.split()
	if len(params) != 2:
		client.send("ERR", {'text': 'Syntax is: /login username password'})
	else:
		client.login(filter_username(params[0]), params[1])
handlers['login'] = fn_login

def fn_userpic(self, client, arg):
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
		self.broadcast("WHO", {'add': client.who()}) # update client view
	else:
		client.send("ERR", {'text': 'Syntax is: /userpic sheet x y'})
handlers['userpic'] = fn_userpic

def fn_gwho(self, client, arg):
	names = ''
	for u in AllClients:
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	client.send("MSG", {'text': 'List of users connected: '+names})
handlers['gwho'] = fn_gwho

def fn_who(self, client, arg):
	names = ''
	for u in self.users:
		if len(names) > 0:
			names += ', '
		names += u.name_and_username()
	client.send("MSG", {'text': 'List of users here: '+names})
handlers['who'] = fn_who

def fn_whereare(self, client, arg):
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
handlers['whereare'] = fn_whereare
aliases['wa'] = 'whereare'

def fn_savemap(self, client, arg):
	self.save()
	self.broadcast("MSG", {'text': client.name+" saved the map"})
handlers['savemap'] = fn_savemap

# Server admin commands
def fn_operoverride(self, client, arg):
	if client.must_be_server_admin():
		client.oper_override = not client.oper_override
		client.send("MSG", {'text': "Oper override enabled" if client.oper_override else "Oper override disabled"})
handlers['operoverride'] = fn_operoverride

def fn_broadcast(self, client, arg):
	if client.must_be_server_admin() and len(arg) > 0:
		broadcast_to_all("Admin broadcast: "+arg)
handlers['broadcast'] = fn_broadcast

def fn_kill(self, client, arg):
	if client.must_be_server_admin():
		u = find_client_by_username(arg)
		if u != None:
			client.send("MSG", {'text': 'Killed '+u.name_and_username()})
			u.disconnect('Killed by '+client.name_and_username())
handlers['kill'] = fn_kill

def fn_shutdown(self, client, arg):
	global ServerShutdown
	if client.must_be_server_admin():
		if arg == "cancel":
			ServerShutdown[0] = -1
			broadcast_to_all("Server shutdown canceled")
		elif arg.isnumeric():
			ServerShutdown[0] = int(arg)
			broadcast_to_all("Server shutdown in %d seconds! (started by %s)" % (ServerShutdown[0], client.name))
handlers['shutdown'] = fn_shutdown

# Group commands
def fn_newgroup(self, client, arg):
	if client.db_id:
		c = Database.cursor()
		c.execute("INSERT INTO User_Group (regtime, owner, name, desc, joinpass, flags) VALUES (?, ?, ?, ?, ?, ?)", (datetime.datetime.now(), client.db_id, "Unnamed group", "", "", 0))
		gid = c.execute('SELECT last_insert_rowid()').fetchone()[0]
		client.send("MSG", {'text': 'Created group %d' % gid})
handlers['newgroup'] = fn_newgroup

def fn_namegroup(self, client, arg):
	groupid, name = separate_first_word(arg)
	if not groupid.isnumeric() or not client.username or not len(name):
		return
	c = Database.cursor()
	c.execute('UPDATE User_Group SET name=? WHERE gid=? AND owner=?', (name, int(groupid), client.db_id,))
	client.send("MSG", {'text': 'Renamed group %s' % groupid})
handlers['namegroup'] = fn_namegroup

def fn_descgroup(self, client, arg):
	groupid, desc = separate_first_word(arg)
	if not groupid.isnumeric() or not client.username or not len(desc):
		return
	c = Database.cursor()
	c.execute('UPDATE User_Group SET desc=? WHERE gid=? AND owner=?', (desc, int(groupid), client.db_id,))
	client.send("MSG", {'text': 'Described group %s' % groupid})
handlers['descgroup'] = fn_descgroup

def fn_changegroupowner(self, client, arg):
	groupid, owner = separate_first_word(arg)
	if not groupid.isnumeric() or not client.username or not len(owner):
		return
	newowner = find_db_id_by_username(owner)
	if newowner:
		c = Database.cursor()
		c.execute('UPDATE User_Group SET owner=? WHERE gid=? AND owner=?', (newowner, int(groupid), client.db_id,))
		client.send("MSG", {'text': 'Group owner set to \"%s\"' % owner})
	else:
		client.send("ERR", {'text': 'Nonexistent account'})
handlers['changegroupowner'] = fn_changegroupowner

def fn_joinpassgroup(self, client, arg):
	groupid, joinpass = separate_first_word(arg)
	if not groupid.isnumeric() or not client.username or not len(joinpass):
		return
	c = Database.cursor()
	c.execute('UPDATE User_Group SET joinpass=? WHERE gid=? AND owner=?', (joinpass, int(groupid), client.db_id,))
	client.send("MSG", {'text': 'Updated join password for group %s to [tt]%s[/tt]' % (groupid, joinpass)})
handlers['joinpassgroup'] = fn_joinpassgroup

def fn_deletegroup(self, client, arg):
	if is_group_owner(arg, client):
		c = Database.cursor()
		c.execute('DELETE FROM User_Group WHERE gid=?',           (int(arg),))
		c.execute('DELETE FROM Group_Member WHERE gid=?',         (int(arg),))
		c.execute('DELETE FROM Group_Invite WHERE gid=?',         (int(arg),))
		c.execute('DELETE FROM Group_Map_Permission WHERE gid=?', (int(arg),))
		client.send("MSG", {'text': 'Deleted group %s' % arg})
handlers['deletegroup'] = fn_deletegroup

def fn_invitetogroup(self, client, arg):
	pass
handlers['invitetogroup'] = fn_invitetogroup

def fn_joingroup(self, client, arg):
	groupid, password = separate_first_word(arg)
	if password != "" and groupid.isnumeric() and client.db_id and sql_exists('SELECT * FROM User_Group WHERE joinpass=?', (password,)):
		if not sql_exists('SELECT uid from Group_Member WHERE uid=? AND gid=?', (client.db_id, int(groupid))):
			c = Database.cursor()
			c.execute("INSERT INTO Group_Member (gid, uid, flags) VALUES (?, ?, ?)", (int(groupid), client.db_id, 0,))
			client.send("MSG", {'text': 'Joined group %s' % groupid})
		else:
			client.send("ERR", {'text': 'Already in group %s' % groupid})
	else:
		client.send("ERR", {'text': 'Nonexistent group or wrong password'})

handlers['joingroup'] = fn_joingroup

def fn_leavegroup(self, client, arg):
	if not arg.isnumeric() or not client.username:
		return
	c.execute('DELETE FROM Group_Member WHERE gid=? AND uid=?', (int(arg), client.db_id,))
	client.send("MSG", {'text': 'Left group %s' % (arg)})
handlers['leavegroup'] = fn_leavegroup

def fn_kickgroup(self, client, arg):
	groupid, person = separate_first_word(arg)
	if is_group_owner(groupid, client):
		if not len(person):
			return
		personid = find_db_id_by_username(person)
		if personid:
			c = Database.cursor()
			c.execute('DELETE FROM Group_Member WHERE gid=? AND uid=?', (int(groupid), personid,))
			client.send("MSG", {'text': 'Kicked \"%s\" from group %s' % (person, groupid)})
		else:
			client.send("ERR", {'text': 'Nonexistent account'})
handlers['kickgroup'] = fn_kickgroup

# Perhaps merge these two somehow?
def fn_ownedgroups(self, client, arg):
	if client.db_id == None:
		return
	c = Database.cursor()
	groups = "Groups you are own: [ul]"
	for row in c.execute('SELECT g.gid, g.name FROM User_Group g WHERE g.owner=?', (client.db_id,)):
		groups += "[li][b]%s[/b] (%d)[/li]" % (row[1], row[0])
	groups += "[/ul]"
	client.send("MSG", {'text': groups})
handlers['ownedgroups'] = fn_ownedgroups

def fn_mygroups(self, client, arg):
	if client.db_id == None:
		return
	c = Database.cursor()
	groups = "Groups you are in: [ul]"
	for row in c.execute('SELECT g.gid, g.name FROM User_Group g, Group_Member m WHERE g.gid=m.gid AND m.uid=?', (client.db_id,)):
		groups += "[li][b]%s[/b] (%d)[/li]" % (row[1], row[0])
	groups += "[/ul]"
	client.send("MSG", {'text': groups})
handlers['mygroups'] = fn_mygroups


# -------------------------------------

def handle_user_command(self, client, text):
	# Separate text into command and arguments
	command, arg = separate_first_word(text)

	# Attempt to run the command handler if it exists
	if command in aliases:
		command = aliases[command]
	if command in handlers:
		return handlers[command](self, client, arg)
	else:
		client.send("ERR", {'text': 'Invalid command?'})
