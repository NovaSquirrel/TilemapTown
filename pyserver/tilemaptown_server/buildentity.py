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

import asyncio, datetime, json, copy, zlib, random
from .buildglobal import *
from collections import deque

entityCounter = 1

class Entity(object):
	def __init__(self, entity_type, creator_id=None):
		global entityCounter

		self.entity_type = entity_type

		self.name = '?'
		self.desc = None
		self.dir = 2 # South
		self.map = None

		self.pic = None

		self.map_id = None         # Map the entity is currently on
		self.x = 0
		self.y = 0

		self.home_id = None        # Map that is the entity's "home"
		self.home_position = None

		# Identification
		self.id = entityCounter  # Temporary ID for referring to different objects in RAM
		entityCounter += 1
		self.db_id = None        # More persistent ID: the database key

		self.temporary = False   # If true, don't save the entity to the database

		# Other info
		self.tags = {}    # Description, species, gender and other things
		self.data = None  # Data that gets stored in the database
		self.contents = set()
		self.flags = 0

		# temporary information
		self.requests = {} # Indexed by username, array with [timer, type]
		# valid types are "tpa", "tpahere", "carry"
		self.tp_history = deque(maxlen=20)

		# allow cleaning up BotWatch info
		self.listening_maps = set() # tuples of (category, map)

		# riding information
		self.vehicle = None     # User being ridden
		self.passengers = set() # Users being carried
		self.is_following = False # If true, follow behind instead of being carried

		# permissions
		self.creator_id = creator_id
		self.owner_id = creator_id
		self.creator_temp_id = None # Temporary ID of the creator of the object, for guests. Not saved to the database.
		self.allow = 0
		self.deny = 0
		self.guest_deny = 0

		self.map_allow = 0       # Used to cache the map allows and map denys to avoid excessive SQL queries
		self.map_deny = 0
		self.oper_override = False

		# Save when clean_up() is called
		self.save_on_clean_up = False
		self.cleaned_up_already = False

		# Make this entity easy to find
		AllEntitiesByID[self.id] = self

	def __del__(self):
		#print("Unloading %d: %s" % (self.db_id or -1, self.name))
		self.clean_up()

	def clean_up(self):
		if not self.cleaned_up_already:

			if self.save_on_clean_up:
				self.save_and_commit()
				self.save_on_clean_up = False

			# Remove from the container
			if self.map != None:
				self.map.remove_from_contents(self)

			# Let go of all passengers
			temp = set(self.passengers)
			for u in temp:
				u.dismount()
			if self.vehicle:
				self.dismount()

			# Get rid of any contents that don't have persistent_object_entry permission
			if self.db_id != get_database_meta('default_map'):
				temp = set(self.contents)
				for u in temp:
					if not u.is_client() and u.home_id != self.db_id and not u.has_permission(self, permission['persistent_object_entry'], False):
						u.send_home()

			cleaned_up_already = True

	def send(self, commandType, commandParams):
		# Not supported by default
		return

	# Send a message to all contents
	def broadcast(self, command_type, command_params, remote_category=None, remote_only=False, send_to_links=False):
		""" Send a message to everyone on the map """
		if not remote_only:
			for client in self.contents:
				client.send(command_type, command_params)

		# Add remote map on the params if needed
		do_linked = send_to_links and self.is_map() and self.edge_ref_links
		do_listeners = remote_category != None and self.db_id in BotWatch[remote_category]
		if do_linked or do_listeners:
			if command_params == None:
				command_params = {}
			command_params['remote_map'] = self.db_id
		else:
			return

		""" Send it to any maps linked from this one, if send_to_links """
		if do_linked: # Assume it's a map if do_linked is true
			for linked_map in self.edge_ref_links:
				if linked_map == None:
					continue
				for client in linked_map.contents:
					if not client.is_client() or not client.see_past_map_edge:
						continue
					client.send(command_type, command_params)

		""" Also send it to any registered listeners """
		if do_listeners:
			for client in BotWatch[remote_category][self.db_id]:
				if (client.map_id != self.db_id) or remote_only: # don't send twice to people on the map
					client.send(command_type, command_params)

	# Allow other classes to respond to having things added to them

	def add_to_contents(self, item):
		if item.map and item.map is not self:
			item.map.remove_from_contents(item)
		self.contents.add(item)
		item.map_id = self.db_id
		item.map = self
		item.update_map_permissions()

		# Give the item a list of the other stuff in the container it was put in
		if item.is_client():
			item.send("WHO", {'list': self.who_contents(), 'you': item.protocol_id()})

		# Tell everyone in the container that the new item was added
		self.broadcast("WHO", {'add': item.who()}, remote_category=botwatch_type['entry'])

		# Warn about chat listeners, if present
		if item.is_client():
			if self.db_id in BotWatch[botwatch_type['chat']]:
				item.send("MSG", {'text': 'A bot has access to messages sent here ([command]listeners[/command])'})
			self.send_map_info(item)

		# Notify parents
		for parent in self.all_parents():
			parent.added_to_child_contents(item)

	def remove_from_contents(self, item):
		self.contents.discard(item)
		item.map_id = None
		item.map = None

		# Tell everyone in the container that the item was removed
		self.broadcast("WHO", {'remove': item.protocol_id()}, remote_category=botwatch_type['entry'])

		# Notify parents
		for parent in self.all_parents():
			parent.removed_from_child_contents(item)

	def added_to_child_contents(self, item):
		""" Called on parents when add_to_contents is called here """
		pass

	def removed_from_child_contents(self, item):
		""" Called on parents when remove_from_contents is called here """
		pass

	def all_parents(self):
		already_found = set()
		current = self.map
		while current:
			yield current
			already_found.add(current)
			if current.map in already_found:
				return
			current = current.map

	def all_children(self):
		already_found = set()
		queue = deque()
		queue.append(self)
		while queue:
			item = queue.popleft()
			for child in item.contents:
				yield child
				if child.id not in already_found:
					already_found.add(child.id)
					if len(child.contents):
						queue.append(child)

	def send_map_info(self, item):
		item.send("MAI", {
			'name': self.name,
			'id': self.protocol_id(),
			'owner_id': self.owner_id,
			'owner_username': find_username_by_db_id(self.owner_id) or '?',
			'default': 'colorfloor13',
			'size': [10,10],
			'build_enabled': False
		})
		item.send("MAP", {
			'pos': [0, 0, 9, 9],
			'default': 'colorfloor13',
			'turf': [],
			'obj': []
		})
		self.broadcast("MOV", {'id': item.protocol_id(), 'to': [random.randint(0, 9), random.randint(0, 9)]})

	# Permission checking

	def get_allow_deny_for_other_entity(self, other_id):
		allow = 0
		deny = 0
		# If a guest, don't bother looking up any queries
		if self.db_id == None:
			return (0, 0)

		c = Database.cursor()
		c.execute('SELECT allow, deny FROM Permission WHERE subject_id=? AND actor_id=?', (other_id, self.db_id,))
		result = c.fetchone()
		if result != None:
			allow = result[0]
			deny = result[1]

		# Turn on permissions granted by groups too
		for row in c.execute('SELECT p.allow FROM Permission p, Group_Member m\
			WHERE m.member_id=? AND p.actor_id=m.group_id AND p.subject_id=? AND m.accepted_at IS NOT NULL', (self.db_id, other_id)):
			allow |= row[0]
		return (allow, deny)

	def update_map_permissions(self):
		""" Searches PERMISSION table and update map_allow and map_deny for the entity, so SQL queries can be skipped for the map they're on """
		self.map_allow, self.map_deny = self.get_allow_deny_for_other_entity(self.map_id)

	# Entity has permission to act on some other entity
	def has_permission(self, other, perm, default):
		if isinstance(perm, tuple):
			return any(self.has_permission(other, x, default) for x in perm)

		# Oper override bypasses permission checks
		if self.oper_override:
			return True

		map_value = default

		# If you pass in an ID, see if the entity with that ID is already loaded
		if isinstance(other, str):
			if other.isnumeric():
				other = int(other)
			# You can use a temporary ID too, which will have its own code path
			elif other.startswith(temporary_id_marker) and other[1:].isnumeric():
				temp_id = int(other[1:])
				if temp_id not in AllEntitiesByID:
					return False
				other = AllEntitiesByID[temp_id]
				if self is other or self.id == other.creator_temp_id:
					return True
				if other.owner_id == self.db_id and self.db_id != None:
					return True

				# Let the entity override the default
				if other.allow & perm:
					map_value = True
				if other.deny & perm:
					map_value = False

				# If guest, apply guest_deny
				if self.db_id == None and other.guest_deny & perm:
					has = False
				return map_value

		if isinstance(other, int) and other in AllEntitiesByDB:
			other = AllEntitiesByDB[other]

		# Is it loaded?
		if isinstance(other, Entity):
			# You have permission if the object is you
			if self is other:
				return True
			if self.db_id:
				# If you're the owner, you automatically have permission
				if self.db_id == other.owner_id or self.id == other.creator_temp_id:
					return True
				# Also if it's you, you have permission
				if self.db_id == other.db_id:
					return True

			# Let the entity override the default
			if other.allow & perm:
				map_value = True
			if other.deny & perm:
				map_value = False

			# If guest, apply guest_deny
			if self.db_id == None:
				if other.guest_deny & perm:
					has = False
				return map_value

			# If user is on the map, use the user's cached value
			if self.map_id == other.db_id:
				if self.map_deny & perm:
					return False
				if self.map_allow & perm:
					return True
			else:
				user_allow, user_deny = self.get_allow_deny_for_other_entity(other.db_id)
				if user_deny & perm:
					return False
				if user_allow & perm:
					return True
			return map_value # Return default for the map

		#############################################################
		# If it's not loaded, a query is unavoidable
		other_id = other
		if isinstance(other_id, Entity):
			other_id = other.db_id

		# Get the basic allow/deny/guest_deny
		c = Database.cursor()
		c.execute('SELECT allow, deny, guest_deny FROM Entity WHERE id=?', (other_id,))
		result = c.fetchone()
		if result == None: # Oops, entity doen't even exist
			return False
		allow = result[0]
		deny = result[1]
		guest_deny = result[2]

		# Let the entity override the default
		if allow & perm:
			map_value = True
		if deny & perm:
			map_value = False

		# If guest, apply guest_deny
		if self.db_id == None:
			if guest_deny & perm:
				map_value = False
			return map_value

		user_allow, user_deny = self.get_allow_deny_for_other_entity(other_id)
		if user_deny & perm:
			return False
		if user_allow & perm:
			return True
		return map_value

	def change_permission_for_entity(self, actor_id, perm, value):
		if actor_id == None:
			return
		# Start blank
		allow = 0
		deny = 0

		# Let the current database value override the that
		c = Database.cursor()
		c.execute('SELECT allow, deny FROM Permission WHERE subject_id=? AND actor_id=?', (self.db_id, actor_id,))
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

		# Delete if all permissions were removed
		if not (allow | deny):
			c.execute('DELETE FROM Permission WHERE subject_id=? AND actor_id=?', (self.db_id, actor_id,))
			return

		# Update or insert depending on needs
		if result != None:
			c.execute('UPDATE Permission SET allow=?, deny=? WHERE subject_id=? AND actor_id=?', (allow, deny, self.db_id, actor_id,))
		else:
			c.execute("INSERT INTO Permission (subject_id, actor_id, allow, deny) VALUES (?, ?, ?, ?)", (self.db_id, actor_id, allow, deny,))

	# Riding

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

		self.send("MSG", {'text': 'You get on %s (/hopoff to get off)' % other.name_and_username()})
		other.send("MSG", {'text': 'You carry %s' % self.name_and_username()})

		self.vehicle = other
		other.passengers.add(self)

		self.map.broadcast("WHO", {'add': self.who()}, remote_category=botwatch_type['move'])
		other.map.broadcast("WHO", {'add': other.who()}, remote_category=botwatch_type['move'])

		self.switch_map(other.map_id, new_pos=[other.x, other.y])

	def dismount(self):
		if self.vehicle == None:
			self.send("ERR", {'text': 'You\'re not being carried'})
		else:
			self.send("MSG", {'text': 'You get off %s' % self.vehicle.name_and_username()})
			self.vehicle.send("MSG", {'text': '%s gets off of you' % self.name_and_username()})

			other = self.vehicle

			self.vehicle.passengers.discard(self)
			self.vehicle = None

			self.map.broadcast("WHO", {'add': self.who()}, remote_category=botwatch_type['move'])
			other.map.broadcast("WHO", {'add': other.who()}, remote_category=botwatch_type['move'])

	# Apply information from a MOV message to someone

	def move_to(self, x, y, new_dir=None, is_teleport=False):
		old_dir = self.dir

		if new_dir != None:
			self.dir = new_dir
		if x != None: # Assume y is good too
			# Save the old position because following moves to the old position, not the new one
			old_x = self.x
			old_y = self.y

			# Set the new position, and update any passengers
			self.x = x
			self.y = y
			for u in self.passengers:
				if u.is_following and not is_teleport: # If "from" isn't present, it's a teleport, not normal movement
					u.move_to(old_x, old_y, old_dir if new_dir != None else None)
				else:
					u.move_to(x, y, new_dir)
				u.map.broadcast("MOV", {'id': u.protocol_id(), 'to': [u.x, u.y], 'dir': u.dir}, remote_category=botwatch_type['move'])

	# Other movement

	def switch_map(self, map_id, new_pos=None, goto_spawn=True, update_history=True, edge_warp=False):
		""" Teleport the user to another map """
		if self.is_client() and not self.sent_resources_yet:
			self.sent_resources_yet = True
			if LoadedAnyServerResources:
				self.send("RSC", ServerResources)

		added_new_history = False
		if update_history and self.map_id != None:
			# Add a new teleport history entry if new map
			if self.map_id != map_id:
				self.tp_history.append([self.map_id, self.x, self.y])
				added_new_history = True

		if self.map_id != map_id:
			# First check if you can even go to that map
			map_load = get_entity_by_id(map_id)
			if map_load == None:
				self.send("ERR", {'text': 'Couldn\'t load map %s' % map_id})
				if added_new_history:
					self.tp_history.pop()
				return False
			if not self.has_permission(map_load, permission['entry'] if self.is_client() else permission['object_entry'], True): # probably don't need to check persistent_object_entry
				self.send("ERR", {'text': 'You don\'t have permission to go to map %d' % map_id})
				if added_new_history:
					self.tp_history.pop()
				return False

			# Remove first, so the container can tell everyone
			# (though add_to_contents() should do this too)
			if self.map:
				self.map.remove_from_contents(self)

			# Add the entity to the map, which will tell the clients there that the entity arrived,
			# and give the entity the status for the other entities that are already there.
			map_load.add_to_contents(self)

		# Move player's X and Y coordinates if needed
		if new_pos != None:
			self.move_to(new_pos[0], new_pos[1], is_teleport=True)
			params = {'id': self.protocol_id(), 'to': [self.x, self.y]}
			if edge_warp:
				params['edge_warp'] = True
			self.map.broadcast("MOV", params, remote_category=botwatch_type['move'])
		elif new_pos == None and goto_spawn and self.map.is_map():
			self.move_to(self.map.start_pos[0], self.map.start_pos[1], is_teleport=True)
			self.map.broadcast("MOV", {'id': self.protocol_id(), 'to': [self.x, self.y]}, remote_category=botwatch_type['move'])

		# Move any passengers too
		for u in self.passengers:
			u.switch_map(map_id, new_pos=[self.x, self.y])
		return True

	def send_home(self):
		""" If entity has a home, send it there. If not, find somewhere else suitable. """
		if self.home_id != None and self.switch_map(self.home_id,
			new_pos=[self.home_position[0], self.home_position[1]] if (self.home_position and len(self.home_position) == 2) else None
		):
			return
		if self.is_client() and self.switch_map(get_database_meta('default_map')):
			return
		if self.owner_id:
			# Try to put it into the owner's inventory, if they're online
			if self.switch_map(self.owner_id):
				return
			if self.db_id:
				# Move it to the owner's inventory
				if self.map:
					self.map.remove_from_contents(self)
				self.map_id = self.owner_id
				self.save_and_commit()
				self.clean_up() # Owner isn't online so item should be unloaded
				return
		if self.db_id:
			print("Entity %d was sent home, but there wasn't a suitable place to go" % self.db_id)
		self.clean_up()

	# Information

	def protocol_id(self):
		""" Returns database ID if it exists, or temp ID (with a marker to say that it's a temp ID) if it doesn't.
		Used to identify the entity in protocol messages. """
		return self.db_id if (self.db_id != None) else ("~"+str(self.id))

	def broadcast_who(self):
		if self.map:
			self.map.broadcast("WHO", {'add': self.who()})

	def who(self):
		""" A dictionary of information for the WHO command """
		return {
			'name': self.name,
			'pic': self.pic,
			'x': self.x,
			'y': self.y,
			'dir': self.dir,
			'id': self.protocol_id(),
			'passengers': [passenger.protocol_id() for passenger in self.passengers],
			'vehicle': self.vehicle.protocol_id() if self.vehicle else None,
			'is_following': self.is_following,
			'type': entity_type_name[self.entity_type],
			'in_user_list': self.is_client()
		}

	def bag_info(self):
		""" Dictionary used to describe an object for a BAG protocol message """		
		out = {
			'id': self.protocol_id(),
			'name': self.name,
			'desc': self.desc,
			'pic': self.pic,
			'type': entity_type_name[self.entity_type],
			'folder': self.map.protocol_id() if self.map else None,
			'data': self.data,
			'tags': self.tags,
			'allow': permission_list_from_bitfield(self.allow),
			'deny': permission_list_from_bitfield(self.deny),
			'guest_deny': permission_list_from_bitfield(self.guest_deny),
			'owner_id': self.owner_id,
			'temporary': self.temporary
		}
		if self.is_client():
			out['username'] = self.username
		if self.owner_id:
			owner_username = find_username_by_db_id(self.owner_id)
			if owner_username:
				out['owner_username'] = owner_username
		return out

	def who_contents(self):
		""" WHO message data """
		return {str(e.protocol_id()):e.who() for e in self.contents}

	def username_or_id(self):
		return self.protocol_id()

	def name_and_username(self):
		return '%s (%s)' % (self.name, self.username_or_id())

	def set_tag(self, name, value):
		if self.tags == None:
			self.tags = {}
		self.tags[name] = value

	def get_tag(self, name, default=None):
		if self.tags == None:
			return default
		if name in self.tags:
			return self.tags[name]
		return default

	def del_tag(self, name):
		if self.tags == None:
			return
		self.tags.pop(name, None)

	# Database access

	def assign_db_id(self, id):
		if self.db_id:
			return
		if self.map:
			self.map.broadcast("WHO", {'new_id': {'id': self.protocol_id(), 'new_id': id}}, remote_category=botwatch_type['move'])
		self.db_id = id
		AllEntitiesByDB[self.db_id] = self

	def load(self, load_id, override_map=None):
		""" Load an entity from the database """
		c = Database.cursor()
		c.execute('SELECT type, name, desc, pic, location, position, home_location, home_position, tags, owner_id, allow, deny, guest_deny, creator_id FROM Entity WHERE id=?', (load_id,))
		result = c.fetchone()
		if result == None:
			return False

		self.assign_db_id(load_id)

		self.entity_type = result[0]
		self.name = result[1]
		self.desc = result[2]
		self.pic = loads_if_not_none(result[3])
		map_id = result[4]
		if override_map:
			if not self.switch_map(override_map[0], new_pos=None if (len(override_map) == 1) else (override_map[1:])):
				self.map_id = override_map[0]
		elif map_id:
			position = loads_if_not_none(result[5])
			if position != None:
				self.x = position[0]
				self.y = position[1]
				if len(position) == 3:
					self.dir = position[2]
			if not self.switch_map(result[4], goto_spawn=False):
				self.map_id = result[4]
		#print("Loading %d: %s" % (self.db_id or -1, self.name))

		self.home_id = result[6]
		self.home_position = loads_if_not_none(result[7])
		self.tags = loads_if_not_none(result[8])
		self.owner_id = result[9]
		self.allow = result[10]
		self.deny = result[11]
		self.guest_deny = result[12]
		self.creator_id = result[13]

		if not self.load_data():
			return False

		# Load the contents too
		c.execute('SELECT id FROM Entity WHERE location=?', (self.db_id,))
		result = c.fetchall()
		for child in result:
			load_child = get_entity_by_id(child[0])
			if load_child and load_child.map_id == self.db_id:
				self.add_to_contents(load_child)

		return True

	def load_data_as_text(self):
		""" Get the data and return it as a string """
		c = Database.cursor()
		c.execute('SELECT data, compressed_data FROM Entity WHERE id=?', (self.db_id,))
		result = c.fetchone()
		if result != None:
			if result[1] == None:
				return result[0]
			elif result[0] == 'zlib':
				return zlib.decompress(result[1]).decode()
		return None

	def load_data(self):
		""" Load the entity's data to the database, using JSON unless overridden """
		self.data = loads_if_not_none(self.load_data_as_text())
		return True

	def save(self):
		""" Save entity information to the database """
		if self.temporary:
			return
		c = Database.cursor()

		if self.db_id == None:
			c.execute("INSERT INTO Entity (created_at, creator_id) VALUES (?, ?)", (datetime.datetime.now(), self.creator_id))
			self.assign_db_id(c.lastrowid)
			if self.db_id == None:
				return

		values = (self.entity_type, self.name, self.desc, dumps_if_not_none(self.pic), self.map_id, json.dumps([self.x, self.y] + ([self.dir] if self.dir != 2 else [])), self.home_id, dumps_if_not_none(self.home_position), dumps_if_condition(self.tags, self.tags != {}), self.owner_id, self.allow, self.deny, self.guest_deny, self.db_id)
		c.execute("UPDATE Entity SET type=?, name=?, desc=?, pic=?, location=?, position=?, home_location=?, home_position=?, tags=?, owner_id=?, allow=?, deny=?, guest_deny=? WHERE id=?", values)

		self.save_data()

	def save_data_as_text(self, text):
		""" Save the data to the database, provided as a string """
		c = Database.cursor()
		if text == None:
			c.execute("UPDATE Entity SET data=NULL, compressed_data=NULL WHERE id=?", (self.db_id,))
		elif len(text) >= 4096:
			c.execute("UPDATE Entity SET data='zlib', compressed_data=? WHERE id=?", (zlib.compress(text.encode(), level = 5), self.db_id,))
		else:
			c.execute("UPDATE Entity SET data=?, compressed_data=NULL WHERE id=?", (text, self.db_id,))

	def save_data(self):
		""" Save the entity's data to the database, using JSON unless overridden """
		self.save_data_as_text(dumps_if_not_none(self.data))

	def save_and_commit(self):
		self.save()
		Database.commit()

	def is_client(self):
		return False

	def is_map(self):
		return False

	def copy_onto(self, other):
		other.name = self.name
		other.desc = self.desc
		other.pic = self.pic
		other.tags = copy.deepcopy(self.tags)
		other.allow = self.allow
		other.deny = self.deny
		other.guest_deny = self.guest_deny
		other.data = self.data
		other.creator_id = self.creator_id
		other.temporary = self.temporary

