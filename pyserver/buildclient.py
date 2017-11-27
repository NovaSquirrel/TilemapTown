# Building game
# Copyright (C) 2017 NovaSquirrel
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
		self.pic = [0, 2, 25];
		self.id = userCounter
		self.ping_timer = 180
		userCounter += 1

		# account stuff
		self.username = None
		self.password = None # replace with a hash later

	def send(self, commandType, commandParams):
		asyncio.ensure_future(self.ws.send(makeCommand(commandType, commandParams)))

	def who(self):
		return {'name': self.name, 'pic': self.pic, 'x': self.x, 'y': self.y, 'id': self.id, 'username': self.username}

	def disconnect(self):
		asyncio.ensure_future(self.ws.close())

	def save(self):
		name = "users/"+str(self.username)+".txt";
		try:
			with open(name, 'w') as f:
				f.write("PASS\n")
				f.write(json.dumps({'sha512':self.password})+"\n")
				f.write("WHO\n")
				who = self.who()
				who["map_id"] = self.map.id
				f.write(json.dumps(who)+"\n")
		except:
			print("Couldn't save user "+name)

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

				for line in lines:
					if line == "PASS\n":
						ispass = True
					elif line == "WHO\n":
						iswho = True
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
				self.username = username
				self.password = password
				return True
		except:
			print("Couldn't load user "+name)
			return None
