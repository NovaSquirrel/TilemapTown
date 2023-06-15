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

import json, asyncio, random, datetime
from .buildglobal import *
from .buildentity import Entity

# Unused currently
DirX = [ 1,  1,  0, -1, -1, -1,  0,  1]
DirY = [ 0,  1,  1,  1,  0, -1, -1, -1]

class Map(Entity):
	def __init__(self,width=100,height=100,id=None,creator_id=None):
		super().__init__(entity_type['map'], creator_id = creator_id)

		# map stuff
		self.default_turf = "grass"
		self.start_pos = [5, 5]
		self.name = "Map"
		self.map_flags = 0

		# defaults that will get used if blank_map is used
		self.width = width
		self.height = height

		self.user_count = 0
		self.map_data_loaded = False
		self.map_data_modified = False

		# See also:
		# self.turfs[y][x]
		# self.objs[y][x]

		self.edge_id_links  = None
		self.edge_ref_links = None

		# map scripting
		self.has_script = False
		#loop = asyncio.get_event_loop()
		#self.script_queue = asyncio.Queue(loop=loop)

		AllMaps.add(self)

	def clean_up(self):
		""" Clean up everything before a map unload """
		super().clean_up()

	def add_to_contents(self, item):
		if item.is_client():
			self.user_count += 1
			# Don't load data here; wait until send_map_info()
		super().add_to_contents(item)

	def send_map_info(self, item):
		if not item.is_client(): # Map info should only get sent to clients, but it doesn't hurt to be sure
			return
		if not self.map_data_loaded:
			self.load_data()

		# Always send MAI for the map you move to, because it's the formal signal that you entered a new map
		item.send("MAI", self.map_info(user=item))
		# Skip the map data if the client should already have it
		if self.db_id not in item.loaded_maps:
			item.send("MAP", self.map_section(0, 0, self.width-1, self.height-1))

		if item.see_past_map_edge and self.edge_ref_links:
			for linked_map in self.edge_ref_links:
				if linked_map == None:
					continue
				# Only send the client maps they wouldn't have yet
				if linked_map.db_id in item.loaded_maps:
					continue

				# If map data is not loaded, it has to be read before MAI because MAI's edge_links comes from the map's data field
				if not linked_map.map_data_loaded:
					# If it's not loaded, load the json and parse it right here
					from_db = linked_map.load_data_as_text()
					if from_db == None:
						continue
					from_db = json.loads(from_db)

					# Patch in the edge ID links so linked_map.map_info() can include them
					if "edge_links" in from_db:
						linked_map.edge_id_links = from_db["edge_links"]

				info = linked_map.map_info(user=item)
				info['remote_map'] = linked_map.db_id
				item.send("MAI", info)

				if linked_map.map_data_loaded:
					section = linked_map.map_section(0, 0, linked_map.width-1, linked_map.height-1)
				else:
					section = {'pos': from_db['pos'], 'default': from_db['default'], 'turf': from_db['turf'], 'obj': from_db['obj']}
				section['remote_map'] = linked_map.db_id
				item.send("MAP", section)

			item.loaded_maps = set([x.db_id for x in self.edge_ref_links if x != None] + [self.db_id])
		if item.see_past_map_edge and not self.edge_ref_links:
			item.loaded_maps = set([self.db_id])

	def remove_from_contents(self, item):
		super().remove_from_contents(item)
		if item.is_client():
			self.user_count -= 1
			if self.user_count == 0 and self.map_data_loaded:
				# Save if the map was modified
				self.save_data()
				# Unload
				self.turfs = None
				self.objs = None
				
				self.map_data_loaded = False

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

	def load(self, map_id):
		""" Load a map from a file """
		c = Database.cursor()
		c.execute('SELECT flags, start_x, start_y, width, height, default_turf FROM Map WHERE entity_id=?', (map_id,))
		result = c.fetchone()
		if result == None:
			return False

		self.id = map_id
		self.map_flags = result[0]
		self.start_pos = [result[1], result[2]]
		self.width = result[3]  # Will be overwritten by the blank_map call but that's ok
		self.height = result[4]
		self.default_turf = result[5]

		return super().load(map_id)

	def load_data(self):
		if self.map_data_loaded:
			return True
		if self.user_count:
			d = loads_if_not_none(self.load_data_as_text())

			# Parse map data
			if d:
				self.blank_map(d["pos"][2]+1, d["pos"][3]+1) # pos is [firstX, firstY, lastX, lastY]
				for t in d["turf"]:
					self.turfs[t[0]][t[1]] = t[2]
				for o in d["obj"]:
					self.objs[o[0]][o[1]] = o[2]
				if "edge_links" in d:
					self.edge_id_links = d["edge_links"]
					self.edge_ref_links = [(get_entity_by_id(x) if x != None else None) for x in self.edge_id_links]
			else:
				self.blank_map(self.width, self.height)
			self.map_data_loaded = True
		return True

	def save(self):
		""" Save the map to the database """
		super().save()
		if self.db_id == None:
			return

		# Create new map if map doesn't already exist
		c = Database.cursor()
		c.execute('SELECT entity_id FROM Map WHERE entity_id=?', (self.db_id,))
		if c.fetchone() == None:
			c.execute("INSERT INTO Map (entity_id) VALUES (?)", (self.db_id,))

		# Update the map
		values = (self.map_flags, self.start_pos[0], self.start_pos[1], self.width, self.height, self.default_turf, self.db_id)
		c.execute("UPDATE Map SET flags=?, start_x=?, start_y=?, width=?, height=?, default_turf=? WHERE entity_id=?", values)

	def save_data(self):
		if self.map_data_modified and self.map_data_loaded:
			data = self.map_section(0, 0, self.width-1, self.height-1)
			if self.edge_id_links != None:
				data["edge_links"] = self.edge_id_links
			self.save_data_as_text(json.dumps(data))
			self.map_data_modified = False

	def apply_map_section(self, data, broadcast=True, username=None):
		x1, y1, x2, y2 = data['pos']

		# Delete the section first
		for x in range(x1, x2+1):
			for y in range(y1, y2+1):
				self.turfs[x][y] = None;
				self.objs[x][y] = None;
		for t in data["turf"]:
			self.turfs[t[0]][t[1]] = t[2]
		for o in data["obj"]:
			self.objs[o[0]][o[1]] = o[2]

		if broadcast:
			self.broadcast("DEL", {"undo": True, "pos": data["pos"], "username": username}, remote_only=True, remote_category=botwatch_type['build'])
			self.broadcast("MAP", data, send_to_links=True)

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

	def map_info(self, user=None, all_info=False):
		""" MAI message data """
		out = {'name': self.name, 'desc': self.desc, 'id': self.db_id, 'owner_id': self.owner_id, 'owner_username': find_username_by_db_id(self.owner_id) or '?', 'default': self.default_turf, 'size': [self.width, self.height], 'public': self.map_flags & mapflag['public'] != 0, 'private': self.deny & permission['entry'] != 0, 'build_enabled': self.allow & permission['build'] != 0, 'full_sandbox': self.allow & permission['sandbox'] != 0, 'edge_links': self.edge_id_links}

		if all_info:
			out['start_pos'] = self.start_pos
		if user:
			out['you_allow'] = permission_list_from_bitfield(self.map_allow)
			out['you_deny'] = permission_list_from_bitfield(self.map_deny)
		return out

	def count_users_inside(self, recursive=True):
		def search(inside):
			n = 0
			for e in inside.contents:
				if e.is_client():
					n += 1
				if recursive:
					n += search(e)
			return n
		return search(self)

	def is_map(self):
		return True
