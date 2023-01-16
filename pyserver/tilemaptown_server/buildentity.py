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

import asyncio, datetime, random, websockets, json, os.path, hashlib
from .buildglobal import *

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

		self.id = entityCounter  # temporary ID for referring to different objects in RAM
		self.db_id = None        # more persistent ID: the database key
		entityCounter += 1

		self.map_allow = 0       # Cache map allows and map denys to avoid excessive SQL queries
		self.map_deny = 0
		self.oper_override = False

		# other info
		self.tags = {}    # description, species, gender and other things
		self.data = None
		self.flags = 0
		self.contents = set()

		# temporary information
		self.requests = {} # indexed by username, array with [timer, type]
		# valid types are "tpa", "tpahere", "carry"
		self.tp_history = []

		# allow cleaning up BotWatch info
		self.listening_maps = set() # tuples of (category, map)

		# riding information
		self.vehicle = None     # user being ridden
		self.passengers = set() # users being carried
		self.is_following = False # if true, follow behind instead of being carried

		# permissions
		self.creator_id = creator_id
		self.owner_id = creator_id
		self.allow = 0
		self.deny = 0
		self.guest_deny = 0

		# Make this entity easy to find
		AllEntitiesByID[self.id] = self

	def __del__(self):
		self.cleanup()

	def cleanup(self):
		AllEntitiesByDB.pop(self.db_id, None)
		AllEntitiesByID.pop(self.id,    None)

		temp = set(self.passengers)
		for u in temp:
			u.dismount()
		if self.vehicle:
			self.dismount()

	def send(self, commandType, commandParams):
		# Not supported by default
		return

	# Send a message to all contents
	def broadcast(self, command_type, command_params, remote_category=None, remote_only=False):
		""" Send a message to everyone on the map """
		if not remote_only:
			for client in self.contents:
				client.send(command_type, command_params)

		""" Also send it to any registered listeners """
		if remote_category != None and self.id in BotWatch[remote_category]:
			if command_params == None:
				command_params = {}
			command_params['remote_map'] = self.db_id
			for client in BotWatch[remote_category][self.db_id]:
				if (client.map_id != self.db_id) or remote_only: # don't send twice to people on the map
					client.send(command_type, command_params)

	# Allow other classes to respond to having things added to them

	def add_to_contents(self, item):
		self.contents.add(item)

	def remove_from_contents(self, item):
		self.contents.discard(item)

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
		for row in c.execute('SELECT p.allow, FROM Permission p, Group_Member m\
			WHERE m.member_id=? AND p.actor_id=m.group_id AND p.subject_id=? AND m.accepted_at != NULL', (self.db_id, other_id)):
			allow |= row[0]
		return (allow, deny)

	def update_map_permissions(self):
		""" Searches PERMISSION table and update map_allow and map_deny for the entity, so SQL queries can be skipped for the map they're on """
		self.map_allow, self.map_deny = self.get_allow_deny_for_other_entity(self.map_id)

	# Entity has permission to act on some other entity
	def has_permission(self, other, perm, default):
		# Oper override bypasses permission checks
		if self.oper_override:
			return True

		# If you pass in an ID, see if the entity with that ID is already loaded
		if isinstance(other, int) and other in AllEntitiesByDB:
			other = AllEntitiesByDB[other]

		# Is it loaded?
		if isinstance(other, Entity):
			# If you're the owner, you automatically have permission
			if self.db_id == other.owner_id:
				return True

			# Start with the server default
			map_value = default
			# and let the map override that default
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
				user_allow, user_deny = self.get_allow_deny_for_other_entity(self, other)
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
		result = c.execute('SELECT allow, deny, guest_deny FROM Entity WHERE id=?', (other_id, self.db_id,))
		if result == None: # Oops, entity doen't even exist
			return False
		allow = result[0]
		deny = result[1]
		guest_deny = result[2]

		# Start with the server default
		map_value = default
		# and let the map override that default
		if allow & perm:
			map_value = True
		if deny & perm:
			map_value = False

		# If guest, apply guest_deny
		if self.db_id == None:
			if guest_deny & perm:
				has = False
			return has

		user_allow, user_deny = self.get_allow_deny_for_other_entity(self, other_id)
		if user_deny & perm:
			return False
		if user_allow & perm:
			return True
		return has

	# Will be used by protocol message handlers
	def must_be_server_admin(self, give_error=True):
		return False

	# Used by protocol message handlers
	def must_be_owner(self, admin_okay, give_error=True):
		if self.map == None:
			return False
		if self.map.owner_id == self.db_id or self.oper_override or (admin_okay and self.has_permission(self, permission['admin'], False)):
			return True
		elif give_error:
			self.send("ERR", {'text': 'You don\'t have permission to do that'})
		return False

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

		self.send("MSG", {'text': 'You get on %s (/hopoff to get off)' % other.nameAndUsername()})
		other.send("MSG", {'text': 'You carry %s' % self.nameAndUsername()})

		self.vehicle = other
		other.passengers.add(self)

		self.map.broadcast("WHO", {'add': self.who()}, remote_category=botwatch_type['move'])
		other.map.broadcast("WHO", {'add': other.who()}, remote_category=botwatch_type['move'])

		self.switch_map(other.map_id, new_pos=[other.x, other.y])

	def dismount(self):
		if self.vehicle == None:
			self.send("ERR", {'text': 'You\'re not being carried'})
		else:
			self.send("MSG", {'text': 'You get off %s' % self.vehicle.nameAndUsername()})
			self.vehicle.send("MSG", {'text': '%s gets off of you' % self.nameAndUsername()})

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
				if u.is_following and not isTeleport: # If "from" isn't present, it's a teleport, not normal movement
					u.moveTo(old_y, old_x, old_dir if new_dir != None else None)
				else:
					u.moveTo(x, y, newDir)
				u.map.broadcast("MOV", {'id': u.id, 'to': [u.x, u.y], 'dir': u.dir}, remote_category=botwatch_type['move'])

	# Other movement

	def switch_map(self, map_id, new_pos=None, goto_spawn=True, update_history=True):
		""" Teleport the user to another map """
		if update_history and self.map_id != None:
			# Add a new teleport history entry if new map
			if self.map_id != map_id:
				self.tp_history.append([self.map_id, self.x, self.y])
			if len(self.tp_history) > 20: # Only keep 20 most recent entries
				self.tp_history.pop(0)

		if self.map_id != map_id:
			# First check if you can even go to that map
			map_load = get_entity_by_db_id(map_id)
			if map_load == None:
				self.send("ERR", {'text': 'Couldn\'t load map %d' % map_id})
				return False
			if not map_load.has_permission(self, permission['entry'], True):
				self.send("ERR", {'text': 'You don\'t have permission to go to map %d' % map_id})
				return False

			if self.map:
				# Remove the user for everyone on the map
				self.map.remove_from_contents(self)
				self.map.broadcast("WHO", {'remove': self.id}, remote_category=botwatch_type['entry'])

			# Get the new map and send it to the client
			self.map_id = map_id
			self.map = map_load
			self.update_map_permissions()

			self.map.add_to_contents(self)
			if self.map.is_map():
				self.send("MAI", self.map.map_info())
				self.send("MAP", self.map.map_section(0, 0, self.map.width-1, self.map.height-1))
			self.send("WHO", {'list': self.map.who_contents(), 'you': self.id})

			# Tell everyone on the new map the user arrived
			self.map.broadcast("WHO", {'add': self.who()}, remote_category=botwatch_type['entry'])

			# Warn about chat listeners, if present
			if map_id in BotWatch[botwatch_type['chat']]:
				self.send("MSG", {'text': 'A bot has access to messages sent here ([command]listeners[/command])'})

		# Move player's X and Y coordinates if needed
		if new_pos != None:
			self.move_to(new_pos[0], new_pos[1], is_teleport=True)
			self.map.broadcast("MOV", {'id': self.id, 'to': [self.x, self.y]}, remote_category=botwatch_type['move'])
		elif goto_spawn:
			self.move_to(self.map.start_pos[0], self.map.start_pos[1], is_teleport=True)
			self.map.broadcast("MOV", {'id': self.id, 'to': [self.x, self.y]}, remote_category=botwatch_type['move'])

		# Move any passengers too
		for u in self.passengers:
			u.switch_map(map_id, new_pos=[self.x, self.y])
		return True

	def send_home(self):
		""" If player has a home, send them there. If not, to map zero """
		if self.home != None:
			self.switch_map(self.home[0], new_pos=[self.home[1], self.home[2]])
		else:
			self.switch_map(get_database_meta('default_map'))

	# Information

	def who(self):
		""" A dictionary of information for the WHO command """
		return {
			'name': self.name,
			'pic': self.pic,
			'x': self.x,
			'y': self.y,
			'dir': self.dir,
			'id': self.id,
			'passengers': [passenger.id for passenger in self.passengers],
			'vehicle': self.vehicle.id if self.vehicle else None,
			'is_following': self.is_following
		}

	def who_contents(self):
		""" WHO message data """
		return {str(e.id):e.who() for e in self.contents}

	def username_or_id(self):
		return str(self.id)

	def name_and_username(self):
		return '%s (%s)' % (self.name, self.username_or_id())

	def set_tag(self, name, value):
		self.tags[name] = value

	def get_tag(self, name, default=None):
		if name in self.tags:
			return self.tags[name]
		return default

	# Database access

	def load(self, id):
		""" Load an account from the database """
		self.db_id = id

		c = Database.cursor()
		c.execute('SELECT type, name, desc, pic, location, position, home_location, home_position, tags, owner_id, allow, deny, guest_deny, data, creator_id FROM Entity WHERE id=?', (self.db_id,))
		result = c.fetchone()
		if result == None:
			return False

		self.entity_type = result[0]
		self.name = result[1]
		self.desc = result[2]
		self.pic = loads_if_not_none(result[3])
		self.map_id = result[4]
		position = loads_if_not_none(result[5])
		if position != None:
			self.x = position[0]
			self.y = position[1]
			if len(position) == 3:
				self.dir = position[2]
		self.home_id = result[6]
		self.home_position = loads_if_not_none(result[7])
		self.tags = loads_if_not_none(result[8])
		self.owner_id = result[9]
		self.allow = result[10]
		self.deny = result[11]
		self.guest_deny = result[12]
		self.data = loads_if_not_none(result[13])
		self.creator_id = result[14]

		# Make this entity easy to find
		AllEntitiesByDB[self.db_id] = self
		return True

	def save(self):
		""" Save entity information to the database """
		c = Database.cursor()

		if self.db_id == None:
			c.execute("INSERT INTO Entity (created_at, creator_id) VALUES (?, ?)", (datetime.datetime.now(), self.creator_id))
			self.db_id = c.lastrowid
			if self.db_id == None:
				return

		values = (self.entity_type, self.name, self.desc, dumps_if_not_none(self.pic), self.map_id, json.dumps([self.x, self.y] + ([self.dir] if self.dir != 2 else [])), self.home_id, dumps_if_not_none(self.home_position), dumps_if_condition(self.tags, self.tags != {}), self.owner_id, self.allow, self.deny, self.guest_deny, dumps_if_not_none(self.data), self.db_id)
		c.execute("UPDATE Entity SET type=?, name=?, desc=?, pic=?, location=?, position=?, home_location=?, home_position=?, tags=?, owner_id=?, allow=?, deny=?, guest_deny=?, data=? WHERE id=?", values)

		# Make this entity easy to find
		AllEntitiesByDB[self.db_id] = self

	def save_and_commit(self):
		self.save()
		Database.commit()

	def is_client(self):
		return False

	def is_map(self):
		return False
