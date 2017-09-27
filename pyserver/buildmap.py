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

DirX = [ 1,  1,  0, -1, -1, -1,  0,  1]
DirY = [ 0,  1,  1,  1,  0, -1, -1, -1]

class Map(object):
	def __init__(self,width=100,height=100):
		# map stuff
		self.width = width
		self.height = height
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

		# construct the map
		self.turfs = []
		self.objs = []
		for x in range(0, width):
			self.turfs.append([None] * height)
			self.objs.append([None] * height)

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
