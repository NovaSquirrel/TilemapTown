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
from buildglobal import *

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
		self.ping_timer = 180
		self.inventory = []
		self.idle_timer = 0
		userCounter += 1

		# other user info
		self.server_admin = False
		self.ignore_list = set()
		self.watch_list = set()
		self.tags = {}    # description, species, gender and other things
		self.away = False # true, or a string if person is away
		self.home = None

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

	def ride(self, other):
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
		if self.server_admin:
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
		""" Save user information to a file """
		name = "users/"+str(self.username)+".txt";
		try:
			with open(name, 'w') as f:
				f.write("PASS\n")
				f.write(json.dumps({'sha512':self.password})+"\n")
				f.write("WHO\n")
				who = self.who()
				who["map_id"] = self.map.id # add the map ID
				f.write(json.dumps(who)+"\n")
				f.write("TAGS\n")
				f.write(json.dumps(self.tags)+"\n")
				f.write("HOME\n")
				f.write(json.dumps(self.home)+"\n")
				f.write("IGNORE\n")
				f.write(json.dumps(list(self.ignore_list))+"\n")
				f.write("WATCH\n")
				f.write(json.dumps(list(self.watch_list))+"\n")
				if self.server_admin:
					f.write("ADMIN\n");
		except:
			print("Couldn't save user "+name)

	def switch_map(self, map_id, new_pos=None, goto_spawn=True, update_history=True):
		""" Teleport the user to another map """
		if update_history and self.map_id >= 0:
			# Add a new teleport history entry if new map
			if self.map_id != map_id:
				self.tp_history.append([self.map_id, self.x, self.y])
			if len(self.tp_history) > 20:
				self.tp_history.pop(0)

		if not self.map or (self.map and self.map.id != map_id):
			if self.map:
				# Remove the user for everyone on the map
				self.map.users.remove(self)
				self.map.broadcast("WHO", {'remove': self.id})

			# Get the new map and send it to the client
			self.map_id = map_id
			self.map = getMapById(map_id)
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
		if os.path.isfile("users/"+str(username)+".txt"):
			return False
		self.username = username
		self.changepass(password)
		return True

	def load(self, username, password):
		password = hashlib.sha512(password.encode()).hexdigest()

		name = "users/"+str(username)+".txt";
		try:
			with open(name, 'r') as f:
				lines = f.readlines()
				iswho = False
				ispass = False
				istags = False
				isignore = False
				iswatch = False
				ishome = False
				for line in lines:
					if line == "PASS\n":
						ispass = True
					elif line == "WHO\n":
						iswho = True
					elif line == "TAGS\n":
						istags = True
					elif line == "IGNORE\n":
						isignore = True
					elif line == "WATCH\n":
						iswatch = True
					elif line == "HOME\n":
						ishome = True
					elif line == "ADMIN\n":
						self.server_admin = True
					elif iswho:
						s = json.loads(line)
						self.name = s["name"]
						self.pic = s["pic"]
						self.x = s["x"]
						self.y = s["y"]
						self.map_id = s["map_id"]
						iswho = False
					elif ispass:
						s = json.loads(line)
						if "sha512" in s:
							if s["sha512"] != password:
								return False
						ispass = False
					elif istags:
						self.tags = json.loads(line)
						istags = False
					elif isignore:
						self.ignore_list = set(json.loads(line))
						isignore = False
					elif iswatch:
						self.watch_list = set(json.loads(line))
						iswatch = False
					elif ishome:
						self.home = json.loads(line)
						ishome = False
				self.username = username
				self.password = password
				return True
		except:
			print("Couldn't load user "+name)
			return None
