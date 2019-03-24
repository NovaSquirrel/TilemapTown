# Tilemap Town
# Copyright (C) 2017-2019 NovaSquirrel
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
from .buildprotocol import handle_protocol_command

# Unused currently
DirX = [ 1,  1,  0, -1, -1, -1,  0,  1]
DirY = [ 0,  1,  1,  1,  0, -1, -1, -1]

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

	def set_group_permission(self, gid, perm, value):
		if gid == None:
			return
		# Start blank
		allow = 0

		# Get current value
		c = Database.cursor()
		c.execute('SELECT allow FROM Group_Map_Permission WHERE mid=? AND gid=?', (self.id, gid,))
		result = c.fetchone()
		if result != None:
			allow = result[0]

		# Alter the permissions
		if value == True:
			allow |= perm
		elif value == None:
			allow &= ~perm

		# Delete if permissions were removed
		if not allow:
			c.execute('DELETE FROM Group_Map_Permission WHERE mid=? AND gid=?', (self.id, gid,))
			return

		# Update or insert depending on needs
		if result != None:
			c.execute('UPDATE Group_Map_Permission SET allow=? WHERE mid=? AND gid=?', (allow, self.id, gid,))
		else:
			c.execute("INSERT INTO Group_Map_Permission (mid, gid, allow) VALUES (?, ?, ?)", (self.id, gid, allow,))

	def has_permission(self, user, perm, default):
		# Start with the server default
		has = default
		# and let the map override that default
		if self.allow & perm:
			has = True
		if self.deny & perm:
			has = False

		# If guest, apply guest_deny
		if user.db_id == None:
			if self.guest_deny & perm:
				has = False
			return has

		# If user is on the map, use the cached value
		if user.map_id == self.id:
			if user.map_deny & perm:
				return False
			if user.map_allow & perm:
				return True
		else:
			# Search Map_Permission table
			c = Database.cursor()
			c.execute('SELECT allow, deny FROM Map_Permission WHERE mid=? AND uid=?', (self.id, user.db_id,))
			result = c.fetchone()
			# If they have a per-user override, use that
			if result != None:
				# Override the defaults
				if result[1] & perm:
					return False
				if result[0] & perm:
					return True

		# Is there any group the user is a member of, where the map has granted the permission?
		c = Database.cursor()
		c.execute('SELECT EXISTS(SELECT p.allow FROM Group_Map_Permission p, Group_Member m WHERE\
			m.uid=? AND\
			p.gid=m.gid AND\
			p.mid=? AND\
			(p.allow & ?)\
			!=0)', (user.db_id, self.id, perm))
		if c.fetchone()[0]:
			return True

		# Search for groups
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

	def broadcast(self, commandType, commandParams, remote_category=None, remote_only=False):
		""" Send a message to everyone on the map """
		if not remote_only:
			for client in self.users:
				client.send(commandType, commandParams)

		""" Also send it to any registered listeners """
		if remote_category != None and self.id in BotWatch[remote_category]:
			commandParams['remote_map'] = self.id
			for client in BotWatch[remote_category][self.id]:
				if (client.map_id != self.id) or remote_only: # don't send twice to people on the map
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
		client.idle_timer = 0
		handle_protocol_command(self, client, command, arg)

	def clean_up(self):
		""" Clean up everything before a map unload """
		pass
