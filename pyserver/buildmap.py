# Tilemap Town
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

import json, asyncio
from buildglobal import *

DirX = [ 1,  1,  0, -1, -1, -1,  0,  1]
DirY = [ 0,  1,  1,  1,  0, -1, -1, -1]

# Filtering chat text
def escapeTags(text):
	return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

class Map(object):
	def __init__(self,width=100,height=100):
		# map stuff
		self.owner = None
		self.default_turf = "grass"
		self.start_pos = [5, 5]
		self.name = "Map"
		self.id = 0
		self.users = set()

		# permissions
		self.entry_whitelist = False
		self.build_whitelist = False
		self.full_sandbox = True

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

	def load(self, mapId):
		""" Load a map from a file """
		self.id = mapId
		name = "maps/"+str(mapId)+".txt";
		try:
			with open(name, 'r') as f:
				lines = f.readlines()
				mai = False
				map = False
				for line in lines:
					if line == "MAI\n":   # Map info signal
						mai = True
					elif line == "MAP\n": # Map data signal
						map = True
					elif mai:           # Receive map info
						s = json.loads(line)
						self.name = s["name"]
						self.owner = s["owner"]
						self.id = int(s["id"])
						self.default_turf = s["default"]
						mai = False
					elif map:           # Receive map data
						s = json.loads(line)
						self.blank_map(s["pos"][2]+1, s["pos"][3]+1)
						for t in s["turf"]:
							self.turfs[t[0]][t[1]] = t[2]
						for o in s["obj"]:
							self.objs[o[0]][o[1]] = o[2]
						map = False
		except:
			print("Couldn't load map "+name)

	def save(self):
		""" Save the map to a file """
		name = "maps/"+str(self.id)+".txt";
		try:
			with open(name, 'w') as f:
				f.write("MAI\n")
				f.write(json.dumps(self.map_info())+"\n")
				f.write("MAP\n")
				f.write(json.dumps(self.map_section(0, 0, self.width-1, self.height-1))+"\n")
		except:
			print("Couldn't save map "+name)

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

	def map_info(self):
		""" MAI message data """
		return {'name': self.name, 'id': self.id, 'owner': self.owner, 'default': self.default_turf, 'size': [self.width, self.height]}

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
		if command == "MOV":
			self.broadcast("MOV", {'id': client.id, 'from': arg["from"], 'to': arg["to"]})
			client.x = arg["to"][0]
			client.y = arg["to"][1]
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
				self.broadcast("MSG", {'text': client.name+" is now known as "+escapeTags(arg2)})
				client.name = escapeTags(arg2)
				self.broadcast("WHO", {'add': client.who()}) # update client view
			elif command2 == "map":
				try:
					client.switch_map(int(arg2))
				except:
					print("Can't switch to map "+arg2)
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
						print(client.pic)
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
					names += '%s (%s)' % (u.name, str(u.username or '?'))
				client.send("MSG", {'text': 'List of users connected: '+names})
			elif command2 == "who":
				names = ''
				for u in self.users:
					if len(names) > 0:
						names += ', '
					names += '%s (%s)' % (u.name, str(u.username or '?'))
				client.send("MSG", {'text': 'List of users here: '+names})
			elif command2 == "savemap":
				self.save()
				self.broadcast("MSG", {'text': client.name+" saved the map"})
			else:
				client.send("ERR", {'text': 'Invalid command?'})
		elif command == "MSG":
			text = arg["text"]
			self.broadcast("MSG", {'name': client.name, 'text': escapeTags(text)})
		elif command == "DEL":
			x1 = arg["pos"][0]
			y1 = arg["pos"][1]
			x2 = arg["pos"][2]
			y2 = arg["pos"][3]
			for x in range(x1, x2+1):
				for y in range(y1, y2+1):
					if arg["turf"]:
						self.turfs[x][y] = None;
					if arg["obj"]:
						self.objs[x][y] = None;
			self.broadcast("MAP", self.map_section(x1, y1, x2, y2))
		elif command == "PUT":
			x = arg["pos"][0]
			y = arg["pos"][1]
			if arg["obj"]:
				self.objs[x][y] = arg["atom"]
			else:
				self.turfs[x][y] = arg["atom"]
			self.broadcast("MAP", self.map_section(x, y, x, y))

	def clean_up(self):
		""" Clean up everything before a map unload """
		pass
