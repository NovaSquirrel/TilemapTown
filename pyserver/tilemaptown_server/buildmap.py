# Tilemap Town
# Copyright (C) 2017-2018 NovaSquirrel
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

import json, asyncio, random, datetime
from .buildglobal import *

DirX = [ 1,  1,  0, -1, -1, -1,  0,  1]
DirY = [ 0,  1,  1,  1,  0, -1, -1, -1]

# Filtering chat text
def escapeTags(text):
	return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

class Map(object):
	def __init__(self,width=100,height=100):
		# map stuff
		self.default_turf = "grass"
		self.start_pos = [5, 5]
		self.name = "Map"
		self.desc = ""
		self.id = 0
		self.flags = 0
		self.users = set()

		self.tags = {}

		# permissions
		self.owner = -1
		self.allow = 0
		self.deny = 0
		self.guest_deny = 0

		# map scripting
		self.has_script = False
		#loop = asyncio.get_event_loop()
		#self.script_queue = asyncio.Queue(loop=loop)

		self.blank_map(width, height)

	def blank_map(self, width, height):
		""" Make a blank map of a given size """
		self.width = width
		self.height = height

		# construct the map
		self.turfs = []
		self.objs = []
		for x in range(0, width):
			self.turfs.append([None] * height)
			self.objs.append([None] * height)

	def set_permission(self, uid, perm, value):
		if uid == None:
			return
		# Start blank
		allow = 0
		deny = 0

		# Get current value
		c = Database.cursor()
		c.execute('SELECT allow, deny FROM Map_Permission WHERE mid=? AND uid=?', (self.id, uid,))
		result = c.fetchone()
		if result != None:
			allow = result[0]
			deny = result[1]

		# Alter the permissions
		if value == True:
			allow |= perm
			deny &= ~perm
		elif value == False:
			allow &= ~perm
			deny |= perm
		elif value == None:
			allow &= ~perm
			deny &= ~perm

		# Delete if permissions were removed
		if not (allow | deny):
			c.execute('DELETE FROM Map_Permission WHERE mid=? AND uid=?', (self.id, uid,))
			return

		# Update or insert depending on needs
		if result != None:
			c.execute('UPDATE Map_Permission SET allow=?, deny=? WHERE mid=? AND uid=?', (allow, deny, self.id, uid,))
		else:
			c.execute("INSERT INTO Map_Permission (mid, uid, allow, deny) VALUES (?, ?, ?, ?)", (self.id, uid, allow, deny,))

	def has_permission(self, user, perm, default):
		has = default
		if self.allow & perm:
			has = True
		if self.deny & perm:
			has = False

		# If guest, apply guest_deny
		if user.db_id == None:
			if self.guest_deny & perm:
				has = False
			return has

		# Search Map_Permission table
		c = Database.cursor()
		c.execute('SELECT allow, deny FROM Map_Permission WHERE mid=? AND uid=?', (self.id, user.db_id,))
		result = c.fetchone()
		if result == None:
			return has
		# Override the defaults
		if result[0] & perm:
			has = True
		if result[1] & perm:
			has = False

		return has

	def set_tag(self, name, value):
		self.tags[name] = value

	def get_tag(self, name, default=None):
		if name in self.tags:
			return self.tags[name]
		return default

	def load(self, mapId):
		""" Load a map from a file """
		self.id = mapId

		c = Database.cursor()

		c.execute('SELECT name, desc, owner, flags, start_x, start_y, width, height, default_turf, allow, deny, guest_deny, tags, data FROM Map WHERE mid=?', (mapId,))
		result = c.fetchone()
		if result == None:
			return False

		self.name = result[0]
		self.desc = result[1]
		self.owner = result[2]
		self.flags = result[3]
		self.start_pos = [result[4], result[5]]
		self.width = result[6]
		self.height = result[7]
		self.default_turf = result[8]
		self.allow = result[9]
		self.deny = result[10]
		self.guest_deny = result[11]
		self.tags = json.loads(result[12])

		# Parse map data
		s = json.loads(result[13])
		self.blank_map(s["pos"][2]+1, s["pos"][3]+1)
		for t in s["turf"]:
			self.turfs[t[0]][t[1]] = t[2]
		for o in s["obj"]:
			self.objs[o[0]][o[1]] = o[2]
		map = False
		return True

	def save(self):
		""" Save the map to a file """

		c = Database.cursor()

		# Create map if it doesn't already exist
		c.execute('SELECT mid FROM Map WHERE mid=?', (self.id,))
		result = c.fetchone()
		if result == None:
			c.execute("INSERT INTO Map (regtime, mid) VALUES (?, ?)", (datetime.datetime.now(), self.id,))

		# Update the map
		values = (self.name, self.desc, self.owner, self.flags, self.start_pos[0], self.start_pos[1], self.width, self.height, self.default_turf, self.allow, self.deny, self.guest_deny, json.dumps(self.tags), json.dumps(self.map_section(0, 0, self.width-1, self.height-1)), self.id)
		c.execute("UPDATE Map SET name=?, desc=?, owner=?, flags=?, start_x=?, start_y=?, width=?, height=?, default_turf=?, allow=?, deny=?, guest_deny=?, tags=?, data=? WHERE mid=?", values)
		Database.commit()

	def map_section(self, x1, y1, x2, y2):
		""" Returns a section of map as a list of turfs and objects """
		# clamp down the numbers
		x1 = min(self.width, max(0, x1))
		y1 = min(self.height, max(0, y1))
		x2 = min(self.width, max(0, x2))
		y2 = min(self.height, max(0, y2))

		# scan the map
		turfs = []
		objs  = []
		for x in range(x1, x2+1):
			for y in range(y1, y2+1):
				if self.turfs[x][y] != None:
					turfs.append([x, y, self.turfs[x][y]])
				if self.objs[x][y] != None:
					objs.append([x, y, self.objs[x][y]])
		return {'pos': [x1, y1, x2, y2], 'default': self.default_turf, 'turf': turfs, 'obj': objs}

	def map_info(self, all_info=False):
		""" MAI message data """
		out = {'name': self.name, 'id': self.id, 'owner': self.owner, 'default': self.default_turf, 'size': [self.width, self.height], 'public': self.flags & mapflag['public'] != 0, 'private': self.deny & permission['entry'] != 0, 'build_enabled': self.allow & permission['build'] != 0, 'full_sandbox': self.allow & permission['sandbox'] != 0}
		if all_info:
			out['start_pos'] = self.start_pos
		return out

	def broadcast(self, commandType, commandParams):
		""" Send a message to everyone on the map """
		for client in self.users:
			client.send(commandType, commandParams)

	def who(self):
		""" WHO message data """
		players = dict()
		for client in self.users:
			players[str(client.id)] = client.who()
		return players

	def receive_command(self, client, command, arg):
		""" Add a command from the client to a queue, or just execute it """
		self.execute_command(client, command, arg)

	def execute_command(self, client, command, arg):
		""" Actually run a command from the client after being processed """
		global ServerShutdown
		client.idle_timer = 0
		if command == "MOV":
			self.broadcast("MOV", {'id': client.id, 'from': arg["from"], 'to': arg["to"]})
			client.moveTo(arg["to"][0], arg["to"][1])
		elif command == "CMD":
			# separate into command and arguments
			text = arg["text"]
			space = text.find(" ")
			command2 = text.lower()
			arg2 = ""
			if space >= 0:
				command2 = text[0:space].lower()
				arg2 = text[space+1:]

			if command2 == "nick":
				if len(arg2) > 0 and not arg2.isspace():
					self.broadcast("MSG", {'text': "\""+client.name+"\" is now known as \""+escapeTags(arg2)+"\""})
					client.name = escapeTags(arg2)
					self.broadcast("WHO", {'add': client.who()}) # update client view
			elif command2 == "client_settings":
				self.client_settings = arg2
			elif command2 == "tell" or command2 == "msg" or command2 == "p":
				space2 = arg2.find(" ")
				if space2 >= 0:
					username = arg2[0:space2].lower()
					privtext = arg2[space2+1:]
					if privtext.isspace():
						client.send("ERR", {'text': 'Tell them what?'})
					else:
						u = findClientByUsername(username)
						if u:
							if not client.inBanList(u.ignore_list, 'message %s' % u.name):
								client.send("PRI", {'text': privtext, 'name':u.name, 'username': u.usernameOrId(), 'receive': False})
								u.send("PRI", {'text': privtext, 'name':client.name, 'username': client.usernameOrId(), 'receive': True})
						else:
							client.failedToFind(username)
				else:
					client.send("ERR", {'text': 'Private message who?'})

			# carrying
			elif command2 == "carry":
				u = findClientByUsername(arg2)
				if u == None:
					client.failedToFind(arg2)
					return
				my_username = client.usernameOrId()
				if my_username in u.requests:
					client.send("ERR", {'text': 'You\'ve already sent them a request'})
					u.requests[my_username][0] = 600 #renew
				elif not client.inBanList(u.ignore_list, 'message %s' % u.name):
					client.send("MSG", {'text': 'You requested to carry '+arg2})
					u.send("MSG", {'text': client.nameAndUsername()+' wants to carry you', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
					u.requests[my_username] = [600, 'carry']
			elif command2 == "hopoff":
				client.dismount()
			elif command2 == "dropoff":
				u = findClientByUsername(arg2, inside=client.passengers)
				if u:
					u.dismount()
				else:
					client.send("ERR", {'text': 'You aren\'t carrying %s' % arg2})
			elif command2 == "carrywho":
				if len(client.passengers):
					names = ''
					for u in client.passengers:
						if len(names) > 0:
							names += ', '
						names += '%s (%s)' % (u.name, u.usernameOrId())
					client.send("MSG", {'text': "You are carrying %s" % names})
				else:
					client.send("MSG", {'text': "You aren\'t carrying anything"})
			elif command2 == "ridewho":
				if client.vehicle:
					client.send("MSG", {'text': "You are riding %s" % client.vehicle.nameAndUsername()})
				else:
					client.send("MSG", {'text': "You aren\'t riding anything"})
			elif command2 == "rideend":
				temp = set(client.passengers)
				for u in temp:
					u.dismount()

			elif command2 == "tpa":
				u = findClientByUsername(arg2)
				if u == None:
					client.failedToFind(arg2)
					return
				my_username = client.usernameOrId()
				if my_username in u.requests:
					client.send("ERR", {'text': 'You\'ve already sent them a request'})
					u.requests[my_username][0] = 600 #renew
				elif not client.inBanList(u.ignore_list, 'message %s' % u.name):
					client.send("MSG", {'text': 'You requested a teleport to '+arg2})
					u.send("MSG", {'text': client.nameAndUsername()+' wants to teleport to you', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
					u.requests[my_username] = [600, 'tpa']

			elif command2 == "tpahere":
				u = findClientByUsername(arg2)
				if u == None:
					client.failedToFind(arg2)
					return
				my_username = client.usernameOrId()
				if my_username in u.requests:
					client.send("ERR", {'text': 'You\'ve already sent them a request'})
					u.requests[my_username][0] = 600 #renew
				elif not client.inBanList(u.ignore_list, 'message %s' % u.name):
					client.send("MSG", {'text': 'You requested that '+arg2+' teleport to you'})
					u.send("MSG", {'text': client.nameAndUsername()+' wants you to teleport to them', 'buttons': ['Accept', 'tpaccept '+my_username, 'Decline', 'tpdeny '+my_username]})
					u.requests[my_username] = [600, 'tpahere']

			elif command2 == "tpaccept" or command2 == "hopon":
				arg2 = arg2.lower()
				u = findClientByUsername(arg2)
				if u == None:
					client.failedToFind(arg2)
					return
				if arg2 not in client.requests:
					client.send("ERR", {'text': 'No pending request from '+arg2})
				else:
					client.send("MSG", {'text': 'You accepted a teleport request from '+arg2})
					u.send("MSG", {'text': u.nameAndUsername()+" accepted your request"})
					request = client.requests[arg2]
					if request[1] == 'tpa':
						u.switch_map(u.map_id, new_pos=[client.x, client.y])
					elif request[1] == 'tpahere':
						client.switch_map(u.map_id, new_pos=[u.x, u.y])
					elif request[1] == 'carry':
						client.ride(u)
					del client.requests[arg2]

			elif command2 == "tpdeny" or command2 == "tpdecline":
				arg2 = arg2.lower()
				u = findClientByUsername(arg2)
				if u == None:
					client.failedToFind(arg2)
					return
				if arg2 not in client.requests:
					client.send("ERR", {'text': 'No pending request from '+arg2})
				else:
					client.send("MSG", {'text': 'You rejected a teleport request from '+arg2})
					u.send("MSG", {'text': u.nameAndUsername()+" rejected your request"})
					del client.requests[arg2]

			elif command2 == "tpcancel":
				arg2 = arg2.lower()
				u = findClientByUsername(arg2)
				if u == None:
					client.failedToFind(arg2)
					return
				my_username = client.usernameOrId()
				if my_username in u.requests:
					client.send("MSG", {'text': 'Canceled request to '+arg2})
					del u.requests[my_username]
				else:
					client.send("ERR", {'text': 'No request to cancel'})

			elif command2 == "time":
					client.send("MSG", {'text': datetime.datetime.today().strftime("Now it's %m/%d/%Y, %I:%M %p")})

			elif command2 == "away":
				if len(arg2) < 1:
					client.away = False
					client.send("MSG", {'text': 'You are no longer marked as away'})
				else:
					client.away = arg2
					client.send("MSG", {'text': 'You are now marked as away ("%s")' % arg2})

			elif command2 == "roll":
				param = arg2.split('d')
				if len(param) != 2:
					param = arg2.split(' ')
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

			elif command2 == "mapid":
				client.send("MSG", {'text': 'Map ID is %d' % self.id})

			elif command2 == "newmap":
				if client.username:
					# Definitely change this to find the new map ID a better way, like making SQLite decide it
					new_id = 1
					while mapIdExists(new_id):
						new_id +=1
						if new_id > Config["Server"]["MaxDBMaps"] and Config["Server"]["MaxDBMaps"] > 0:
							client.send("ERR", {'text': 'There are too many maps'})
							return
					try:
						client.switch_map(int(new_id))
						client.map.owner = client.db_id
						client.send("MSG", {'text': 'Welcome to your new map (id %d)' % new_id})
					except:
						client.send("ERR", {'text': 'Couldn\'t switch to the new map'})
						raise
				else:
					client.send("ERR", {'text': 'You must be registered to make a new map.'})

			# maybe combine the list add/remove/list commands together?
			elif command2 == "ignore":
				arg2 = arg2.lower()
				client.ignore_list.add(arg2)
				client.send("MSG", {'text': '\"%s\" added to ignore list' % arg2})
			elif command2 == "unignore":
				arg2 = arg2.lower()
				if arg2 in client.ignore_list:
					client.ignore_list.remove(arg2)
				client.send("MSG", {'text': '\"%s\" removed from ignore list' % arg2})
			elif command2 == "ignorelist":
				client.send("MSG", {'text': 'Ignore list: '+str(client.ignore_list)})

			elif command2 == "watch":
				arg2 = arg2.lower()
				if arg2 in client.watch_list:
					client.watch_list.remove(arg2)
				client.send("MSG", {'text': '\"%s\" added to watch list' % arg2})
			elif command2 == "unwatch":
				arg2 = arg2.lower()
				client.watch_list.remove(arg2)
				client.send("MSG", {'text': '\"%s\" removed from watch list' % arg2})
			elif command2 == "watchlist":
				client.send("MSG", {'text': 'Watch list: '+str(client.watch_list)})




			elif command2 in ["grant", "deny", "revoke"]:
				if client.mustBeOwner(True):
					# Check syntax
					param = arg2.lower().split(' ')
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
						self.broadcast("MSG", {'text': "%s sets the default \"%s\" permission to [b]%s[/b]" % (client.nameAndUsername(), param[0], command2)})
						return

					if param[1] == '!guest':
						if command2 == "deny":
							self.guest_deny |= permission_value
						elif command2 == "revoke":
							self.guest_deny &= ~permission_value
						self.broadcast("MSG", {'text': "%s sets the guest \"%s\" permission to [b]%s[/b]" % (client.nameAndUsername(), param[0], command2)})
						return

					# Has to be a user that exists
					uid = findDBIdByUsername(param[1])
					if uid == None:
						client.failedToFind(param[1])
						return

					# Finally we know it's valid
					value = None
					if command2 == "grant":
						value = True
					if command2 == "deny":
						value = False
					self.set_permission(uid, permission_value, value)
					self.broadcast("MSG", {'text': "%s sets %s's \"%s\" permission to [b]%s[/b]" % (client.nameAndUsername(), param[1], param[0], command2)})

			elif command2 == "permlist":
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

				perms += "[ul]"
				for row in c.execute('SELECT username, allow, deny FROM Map_Permission mp, User u WHERE mp.mid=? AND mp.uid=u.uid', (self.id,)):
					perms += "[li][b]"+row[0] + "[/b]: "
					for k,v in permission.items():
						if (row[1] & v) == v: # allow
							perms += "+"+k+" "
						if (row[2] & v) == v: #deny
							perms += "-"+k+" "
					perms += "[/li]"
				perms += "[/ul]"
				client.send("MSG", {'text': perms})

			elif command2 == "publicmaps":
				c = Database.cursor()
				maps = "Public maps: [ul]"
				for row in c.execute('SELECT m.mid, m.name, u.username FROM Map m, User u WHERE m.owner=u.uid and (m.flags&1)!=0'):
					maps += "[li][b]%s[/b] (%s) [command]map %d[/command][/li]" % (row[1], row[2], row[0])
				maps += "[/ul]"
				client.send("MSG", {'text': maps})

			elif command2 == "mapname":
				if client.mustBeOwner(False):
					self.name = arg2
					client.send("MSG", {'text': 'Map name set to \"%s\"' % self.name})
			elif command2 == "mapdesc":
				if client.mustBeOwner(False):
					self.desc = arg2
					client.send("MSG", {'text': 'Map description set to \"%s\"' % self.desc})
			elif command2 == "mapowner":
				if client.mustBeOwner(False):
					newowner = findDBIdByUsername(arg2)
					if newowner:
						self.owner = newowner
						client.send("MSG", {'text': 'Map owner set to \"%s\"' % self.owner})
					else:
						client.send("MSG", {'text': 'Nonexistent account'})

			elif command2 == "mapprivacy":
				if client.mustBeOwner(False):
					if arg2 == "public":
						self.deny &= ~permission['entry']
						self.flags |= mapflag['public']
					elif arg2 == "private":
						self.deny |= permission['entry']
						self.flags &= ~mapflag['public']
					elif arg2 == "unlisted":
						self.deny &= ~permission['entry']
						self.flags &= ~mapflag['public']
					else:
						client.send("ERR", {'text': 'Map privacy must be public, private, or unlisted'})
			elif command2 == "mapprotect":
				if client.mustBeOwner(False):
					if arg2 == "off":
						self.allow |= permission['sandbox']
					elif arg2 == "on":
						self.allow &= ~permission['sandbox']
					else:
						client.send("ERR", {'text': 'Map building must be on or off'})
			elif command2 == "mapbuild":
				if client.mustBeOwner(True):
					if arg2 == "on":
						self.allow |= permission['build']
					elif arg2 == "off":
						self.allow &= ~permission['build']
					else:
						client.send("ERR", {'text': 'Map building must be on or off'})
			elif command2 == "defaultfloor":
				if client.mustBeOwner(False):
					self.default_turf = arg2
					client.send("MSG", {'text': 'Map floor changed to %s' % arg2})
			elif command2 == "mapspawn":
				if client.mustBeOwner(False):
					self.start_pos = [client.x, client.y]
					client.send("MSG", {'text': 'Map start changed to %d,%d' % (client.x, client.y)})

			elif command2 == "kick" or command2 == "kickban":
				arg2 = arg2.lower()
				if client.mustBeOwner(True):
					u = findClientByUsername(arg2)
					if u != None:
						if u.map_id == client.map_id:
							client.send("MSG", {'text': 'Kicked '+u.nameAndUsername()})
							u.send("MSG", {'text': 'Kicked by '+client.nameAndUsername()})
							u.send_home()
							if command2 == "kickban":
								self.set_permission(findDBIdByUsername(arg2), permission['entry'], False)
						else:
							client.send("ERR", {'text': 'User not on this map'})
					else:
						client.send("ERR", {'text': 'User not found'})

			elif command2 == "goback":
				if len(client.tp_history) > 0:
					pos = client.tp_history.pop()
					client.switch_map(pos[0], new_pos=[pos[1], pos[2]], update_history=False)
				else:
					client.send("ERR", {'text': 'Nothing in teleport history'})

			elif command2 == "sethome":
				client.home = [client.map_id, client.x, client.y]
				client.send("MSG", {'text': 'Home set'})
			elif command2 == "home":
				if client.home == None:
					client.send("ERR", {'text': 'You don\'t have a home set'})
				else:
					client.send("MSG", {'text': 'Teleported to your home'})
					client.send_home()
			elif command2 == "map":
				try:
					if mapIdExists(int(arg2)):
						if client.switch_map(int(arg2)):
							client.send("MSG", {'text': 'Teleported to map %s' % arg2})
					else:
						client.send("MSG", {'text': 'Map %s doesn\'t exist' % arg2})
				except:
					client.send("ERR", {'text': 'Couldn\'t go to map %s' % arg2})
			elif command2 == "saveme":
				if client.username == None:
					client.send("ERR", {'text': 'You are not logged in'})
				else:
					client.save()
					client.send("MSG", {'text': 'Account saved'})
			elif command2 == "changepass":
				if client.username == None:
					client.send("ERR", {'text': 'You are not logged in'})
				elif len(arg2):
					client.changepass(arg2)
					client.send("MSG", {'text': 'Password changed'})
				else:
					client.send("ERR", {'text': 'No password given'})
			elif command2 == "register":
				if client.username != None:
					client.send("ERR", {'text': 'Register fail, you already registered'})
				else:
					params = arg2.split()
					if len(params) != 2:
						client.send("ERR", {'text': 'Syntax is: /register username password'})
					else:
						if client.register(filterUsername(params[0]), params[1]):
							self.broadcast("MSG", {'text': client.name+" has now registered"})
							self.broadcast("WHO", {'add': client.who()}) # update client view, probably just for the username
						else:
							client.send("ERR", {'text': 'Register fail, account already exists'})
			elif command2 == "login":
				params = arg2.split()
				if len(params) != 2:
					client.send("ERR", {'text': 'Syntax is: /login username password'})
				else:
					client.login(filterUsername(params[0]), params[1])
			elif command2 == "userpic":
				arg2 = arg2.split(' ')
				success = False

				if len(arg2) == 1:
					defaults = {'bunny': [0, 2, 25], 'cat': [0, 2, 26], 'hamster': [0, 8, 25], 'fire': [0, 4,26]}
					if arg2[0] in defaults:
						client.pic = defaults[arg2[0]];
						success = True
					# temporary thing to allow custom avatars
					elif arg2[0][0:20] == 'https://i.imgur.com/':
						client.pic = [arg2[0], 0, 0];
						success = True
				elif len(arg2) == 2:
					if arg2[0].isnumeric() and arg2[1].isnumeric():
						client.pic = [0, int(arg2[0]), int(arg2[1])]
						success = True
				if success:
					self.broadcast("WHO", {'add': client.who()}) # update client view
				else:
					client.send("ERR", {'text': 'Syntax is: /userpic sheet x y'})

			elif command2 == "gwho":
				names = ''
				for u in AllClients:
					if len(names) > 0:
						names += ', '
					names += u.nameAndUsername()
				client.send("MSG", {'text': 'List of users connected: '+names})
			elif command2 == "who":
				names = ''
				for u in self.users:
					if len(names) > 0:
						names += ', '
					names += '%s (%s)' % (u.name, u.usernameOrId())
				client.send("MSG", {'text': 'List of users here: '+names})
			elif command2 == "savemap":
				self.save()
				self.broadcast("MSG", {'text': client.name+" saved the map"})

			# Server admin commands
			elif command2 == "broadcast":
				if client.mustBeServerAdmin() and len(arg2) > 0:
					broadcastToAll("Admin broadcast: "+arg2)
			elif command2 == "kill":
				if client.mustBeServerAdmin():
					u = findClientByUsername(arg2)
					if u != None:
						client.send("MSG", {'text': 'Killed '+u.nameAndUsername()})
						u.send("MSG", {'text': 'Killed by '+client.nameAndUsername()})
						u.disconnect()
			elif command2 == "shutdown":
				if client.mustBeServerAdmin():
					if arg2 == "cancel":
						ServerShutdown[0] = -1
						broadcastToAll("Server shutdown canceled")
					elif arg2.isnumeric():
						ServerShutdown[0] = int(arg2)
						broadcastToAll("Server shutdown in %d seconds! (started by %s)" % (ServerShutdown[0], client.name))
			else:
				client.send("ERR", {'text': 'Invalid command?'})
		elif command == "MSG":
			text = arg["text"]
			self.broadcast("MSG", {'name': client.name, 'text': escapeTags(text)})
		elif command == "MAI":
			send_all_info = client.mustBeOwner(True, giveError=False)
			client.send("MAI", self.map.map_info(all_info=send_all_info))
		elif command == "DEL":
			x1 = arg["pos"][0]
			y1 = arg["pos"][1]
			x2 = arg["pos"][2]
			y2 = arg["pos"][3]
			if self.has_permission(client, permission['build'], True) or client.mustBeOwner(True, giveError=False):
				for x in range(x1, x2+1):
					for y in range(y1, y2+1):
						if arg["turf"]:
							self.turfs[x][y] = None;
						if arg["obj"]:
							self.objs[x][y] = None;
				self.broadcast("MAP", self.map_section(x1, y1, x2, y2))
			else:
				client.send("MAP", self.map_section(x1, y1, x2, y2))
				client.send("ERR", {'text': 'Building is disabled on this map'})
		elif command == "PUT":
			x = arg["pos"][0]
			y = arg["pos"][1]
			if self.has_permission(client, permission['build'], True) or client.mustBeOwner(True, giveError=False):
				if arg["obj"]:
					self.objs[x][y] = arg["atom"]
				else:
					self.turfs[x][y] = arg["atom"]
				self.broadcast("MAP", self.map_section(x, y, x, y))
			else:
				client.send("MAP", self.map_section(x, y, x, y))
				client.send("ERR", {'text': 'Building is disabled on this map'})

	def clean_up(self):
		""" Clean up everything before a map unload """
		pass
