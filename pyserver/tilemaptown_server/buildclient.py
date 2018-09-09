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

import asyncio, datetime, random, websockets, json, os.path, hashlib
from .buildglobal import *

# Make a command to send
def makeCommand(commandType, commandParams):
	if commandParams != None:
		return commandType + " " + json.dumps(commandParams)
	else:
		return commandType

userCounter = 1

class Client(object):
	def __init__(self,websocket):
		global userCounter
		self.ws = websocket
		self.name = 'Guest '+ str(userCounter)
		self.x = 0
		self.y = 0
		self.map = None
		self.map_id = -1
		self.pic = [0, 2, 25]
		self.id = userCounter
		self.db_id = None        # database key
		self.ping_timer = 180
		self.inventory = []
		self.idle_timer = 0
		userCounter += 1

		# other user info
		self.ignore_list = set()
		self.watch_list = set()
		self.tags = {}    # description, species, gender and other things
		self.away = False # true, or a string if person is away
		self.home = None
		self.client_settings = ""

		# temporary information
		self.requests = {} # indexed by username, array with [timer, type]
		# valid types are "tpa", "tpahere", "carry"
		self.tp_history = []

		# riding information
		self.vehicle = None     # user being ridden
		self.passengers = set() # users being carried

		# account stuff
		self.username = None
		self.password = None # actually the password hash

	def send(self, commandType, commandParams):
		""" Send a command to the client """
		if self.ws == None:
			return
		asyncio.ensure_future(self.ws.send(makeCommand(commandType, commandParams)))

	def failedToFind(self, username):
		if username == None or len(username) == 0:
			self.send("ERR", {'text': 'No username given'})
		else:
			self.send("ERR", {'text': 'Player '+username+' not found'})

	def inBanList(self, banlist, action):
		if self.username == None and '!guests' in banlist:
			self.send("ERR", {'text': 'Guests may not %s' % action})
			return True
		if self.username in banlist:
			self.send("ERR", {'text': 'You may not %s' % action})
			return True
		return False

	def ride(self, other):
		# cannot ride yourself
		if self == other:
			return
		# remove the old ride before getting a new one
		if self.vehicle != None:
			self.dismount()
		# let's not deal with trees of passengers first
		if len(self.passengers):
			self.send("MSG", {'text': 'You let out all your passengers first'})
			temp = set(self.passengers)
			for u in temp:
				u.dismount()

		self.send("MSG", {'text': 'You get on %s (/hopoff to get off)' % other.nameAndUsername()})
		other.send("MSG", {'text': 'You carry %s' % self.nameAndUsername()})
		self.vehicle = other
		other.passengers.add(self)
		self.switch_map(other.map_id, new_pos=[other.x, other.y])

	def dismount(self):
		if self.vehicle == None:
			self.send("ERR", {'text': 'You\'re not being carried'})
		else:
			self.send("MSG", {'text': 'You get off %s' % self.vehicle.nameAndUsername()})
			self.vehicle.send("MSG", {'text': '%s gets off of you' % self.nameAndUsername()})
			self.vehicle.passengers.remove(self)
			self.vehicle = None

	def mustBeServerAdmin(self, giveError=True):
		if self.username in Config["Server"]["Admins"]:
			return True
		elif giveError:
			self.send("ERR", {'text': 'You don\'t have permission to do that'})
		return False

	def mustBeOwner(self, adminOkay, giveError=True):
		if self.map.owner == self.username or (adminOkay and self.username in self.map.admins):
			return True
		elif giveError:
			self.send("ERR", {'text': 'You don\'t have permission to do that'})
		return False

	def moveTo(self, x, y):
		self.x = x
		self.y = y
		for u in self.passengers:
			u.moveTo(x, y)
			u.map.broadcast("MOV", {'id': u.id, 'to': [u.x, u.y]})

	def who(self):
		""" A dictionary of information for the WHO command """
		return {'name': self.name, 'pic': self.pic, 'x': self.x, 'y': self.y, 'id': self.id, 'username': self.username}

	def disconnect(self):
		asyncio.ensure_future(self.ws.close())

	def usernameOrId(self):
		return self.username or str(self.id)

	def nameAndUsername(self):
		return '%s (%s)' % (self.name, self.usernameOrId())

	def set_tag(self, name, value):
		self.tags[name] = value

	def get_tag(self, name, default=None):
		if name in self.tags:
			return self.tags[name]
		return default

	def save(self):
		""" Save user information to the database """
		c = Database.cursor()

		# Create new user if user doesn't exist
		if findDBIdByUsername(self.username) == None:
			c.execute("INSERT INTO User (regtime, username) VALUES (?, ?)", (datetime.datetime.now(), self.username,))
		# Update database ID in RAM with the possibly newly created row
		self.db_id = findDBIdByUsername(self.username)

		# Update the user
		values = (self.password, "sha512", self.name, json.dumps(self.pic), self.map_id, self.x, self.y, json.dumps(self.home), json.dumps(list(self.watch_list)), json.dumps(list(self.ignore_list)), self.client_settings, json.dumps(self.tags), datetime.datetime.now(), self.db_id)
		c.execute("UPDATE User SET passhash=?, passalgo=?, name=?, pic=?, mid=?, map_x=?, map_y=?, home=?, watch=?, ignore=?, client_settings=?, tags=?, lastseen=? WHERE uid=?", values)
		Database.commit()

	def switch_map(self, map_id, new_pos=None, goto_spawn=True, update_history=True):
		""" Teleport the user to another map """
		if update_history and self.map_id >= 0:
			# Add a new teleport history entry if new map
			if self.map_id != map_id:
				self.tp_history.append([self.map_id, self.x, self.y])
			if len(self.tp_history) > 20:
				self.tp_history.pop(0)

		if not self.map or (self.map and self.map.id != map_id):
			# First check if you can even go to that map
			new_map = getMapById(map_id)
			if self.inBanList(new_map.entry_banlist, 'go to map %d' % map_id):
				return False

			if self.map:
				# Remove the user for everyone on the map
				self.map.users.remove(self)
				self.map.broadcast("WHO", {'remove': self.id})

			# Get the new map and send it to the client
			self.map_id = map_id
			self.map = new_map

			self.send("MAI", self.map.map_info())
			self.send("MAP", self.map.map_section(0, 0, self.map.width-1, self.map.height-1))
			self.map.users.add(self)
			self.send("WHO", {'list': self.map.who(), 'you': self.id})

			# Tell everyone on the new map the user arrived
			self.map.broadcast("WHO", {'add': self.who()})

		# Move player's X and Y coordinates if needed
		if new_pos != None:
			self.moveTo(new_pos[0], new_pos[1])
			self.map.broadcast("MOV", {'id': self.id, 'to': [self.x, self.y]})
		elif goto_spawn:
			self.moveTo(self.map.start_pos[0], self.map.start_pos[1])
			self.map.broadcast("MOV", {'id': self.id, 'to': [self.x, self.y]})

		# Move any passengers too
		for u in self.passengers:
			u.switch_map(map_id, new_pos=[self.x, self.y])
		return True

	def send_home(self):
		""" If player has a home, send them there. If not, to map zero """
		if self.home != None:
			self.switch_map(self.home[0], new_pos=[self.home[1], self.home[2]])
		else:
			self.switch_map(0)

	def cleanup(self):
		self.ws = None
		temp = set(self.passengers)
		for u in temp:
			u.dismount()
		if self.vehicle:
			self.dismount()

	def login(self, username, password):
		""" Attempt to log the client into an account """
		username = filterUsername(username)
		result = self.load(username, password)
		if result == True:
			self.switch_map(self.map_id, goto_spawn=False)
			self.map.broadcast("MSG", {'text': self.name+" has logged in ("+self.username+")"})
			self.map.broadcast("WHO", {'add': self.who()}) # update client view
			return True
		elif result == False:
			self.send("ERR", {'text': 'Login fail, bad password for account'})
		else:
			self.send("ERR", {'text': 'Login fail, nonexistent account'})
		return False

	def changepass(self, password):
		self.password = hashlib.sha512(password.encode()).hexdigest()
		self.save()

	def register(self, username, password):
		username = str(filterUsername(username))
		# User can't already exist
		if findDBIdByUsername(username) != None:
			return False
		self.username = username
		self.changepass(password)
		# db_id updated by changepass
		return True

	def load(self, username, password):
		""" Load an account from the database """
		password = hashlib.sha512(password.encode()).hexdigest()
		self.password = password

		c = Database.cursor()
		
		c.execute('SELECT uid, passhash, passalgo, username, name, pic, mid, map_x, map_y, home, watch, ignore, client_settings, tags FROM User WHERE username=?', (username,))
		result = c.fetchone()
		if result == None:
			return None
		# Refuse to load if incorrect password
		if result[2] == "sha512" and result[1] != password:
			return False

		self.username = result[3]
		self.name = result[4]
		self.pic = json.loads(result[5])
		self.map_id = result[6]
		self.x = result[7]
		self.y = result[8]
		self.home = json.loads(result[9] or "null")
		self.watch_list = set(json.loads(result[10]))
		self.ignore_list = set(json.loads(result[11]))
		self.client_settings = result[12]
		self.tags = json.loads(result[13])
		return True
