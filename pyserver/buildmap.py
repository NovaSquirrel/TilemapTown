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

import json

DirX = [ 1,  1,  0, -1, -1, -1,  0,  1]
DirY = [ 0,  1,  1,  1,  0, -1, -1, -1]

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

		self.blank_map(width, height)

	def blank_map(self, width, height):
		self.width = width
		self.height = height

		# construct the map
		self.turfs = []
		self.objs = []
		for x in range(0, width):
			self.turfs.append([None] * height)
			self.objs.append([None] * height)

	def load(self, name):
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
						self.id = s["id"]
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

	def save(self, name):
		if name == '':
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
		return {'name': self.name, 'id': self.id, 'owner': self.owner, 'default': self.default_turf, 'size': [self.width, self.height]}

	def broadcast(self, commandType, commandParams):
		for client in self.users:
			client.send(commandType, commandParams)

	def who(self):
		players = dict()
		for client in self.users:
			players[str(client.id)] = client.who()
		return players
