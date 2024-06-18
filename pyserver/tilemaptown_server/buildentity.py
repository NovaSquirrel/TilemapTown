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

import asyncio, datetime, json, copy, zlib, random, weakref
from .buildglobal import *
from collections import deque

entityCounter = 1

# Allow things that are not entities to do permission checking like entities (like FakeClient)
class PermissionsMixin(object):
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

	# Check if this entity is specifically disallowed from doing something, rather than being disallowed because something uses an allowlist
	def is_banned_from(self, other_id, perm):
		# If an entity is passed in, get its ID
		if isinstance(other_id, Entity):
			other_id = other_id.db_id
		if other_id == None:
			return False

		c = Database.cursor()
		c.execute('SELECT deny FROM Permission WHERE subject_id=? AND actor_id=?', (other_id, self.db_id,))
		result = c.fetchone()
		return result != None and bool(result[0] & perm)

	# Entity has permission to act on some other entity
	def has_permission(self, other, perm=0, default=False):
		if isinstance(perm, tuple):
			return any(self.has_permission(other, x, default) for x in perm)
		map_value = default

		# Oper override bypasses permission checks
		if hasattr(self, 'connection') and self.connection_attr('oper_override'):
			return True

		# If you pass in an ID, see if the entity with that ID is already loaded
		if not isinstance(other, Entity):
			try_load = get_entity_by_id(other, load_from_db=False)
			if try_load != None:
				other = try_load
			elif isinstance(other, str):
				other = find_db_id_by_str(other)
				if other == None:
					return False
			elif not isinstance(other, int):
				return None
		
		if isinstance(other, Entity):
			# You have permission if the object is you
			if isinstance(self, Entity):
				if self is other or self.id == other.creator_temp_id:
					return True
				# Temporary permissions
				if self.temp_permissions.get(other, 0) & perm:
					return True
			if self.db_id:
				# If you're the owner, you automatically have permission
				if self.db_id == other.owner_id:
					return True
				# Also if you're checking permission to act on yourself, it always works
				if self.db_id == other.db_id:
					return True
			if perm == 0: # perm = 0 is an owner check
				return False

			# Let the entity override the default
			if other.allow & perm:
				map_value = True
			if other.deny & perm:
				map_value = False

			# If guest, apply guest_deny
			if self.db_id == None:
				if other.guest_deny & perm:
					return False
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

		# Get the basic allow/deny/guest_deny
		c = Database.cursor()
		c.execute('SELECT allow, deny, guest_deny, owner_id FROM Entity WHERE id=?', (other_id,))
		result = c.fetchone()
		if result == None: # Oops, entity doen't even exist
			return False
		allow = result[0]
		deny = result[1]
		guest_deny = result[2]
		owner_id = result[3]

		# If you're the owner, you have permission
		if self.db_id and self.db_id == owner_id:
			return True
		if perm == 0:
			return False

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

class Entity(PermissionsMixin, object):
	def __init__(self, entity_type, creator_id=None):
		global entityCounter

		self.entity_type = entity_type

		# Appearance
		self.name = '?'
		self.desc = None
		self.pic = None

		# Location
		self.dir = 2 # South
		self.map_ref = None        # Storage for self.map, which is a property
		self.map_id = None         # Map the entity is currently on
		self.x = 0
		self.y = 0
		self.offset = None         # Visual offset in pixels

		self.home_id = None        # Map that is the entity's "home"
		self.home_position = None

		# Identification
		self.id = entityCounter  # Temporary ID for referring to different objects in RAM
		entityCounter += 1
		self.db_id = None        # More persistent ID: the database key

		self.temporary = False   # If true, don't save the entity to the database
		self.delete_on_logout = False # If true, delete entity when the owner logs out

		# Other info
		self.tags = {}    # Description, species, gender and other things
		self.data = None  # Data that gets stored in the database
		self.contents = set() # Entities stored inside this one
		self.flags = 0        # Entity flags, like "public"?

		# Status
		self.status_type = None
		self.status_message = None

		# Temporary information
		self.requests = {} # Indexed by tuple: (username, type). Each item is an array with [timer, id, data]; data may be None. Timer decreases each second, then the request is deleted.
		# valid types are "tpa", "tpahere", "carry", "followme"
		self.tp_history = deque(maxlen=20)

		# Message forwarding; for bringing bot entities onto different maps, that can listen to messages
		self.forward_message_types = set()
		self.forward_messages_to = None

		# Riding information
		self.vehicle = None     # User being ridden
		self.passengers = set() # Users being carried
		self.is_following = False # If true, follow behind instead of being carried

		self.follow_map_vehicle = None
		self.follow_map_passengers = set()

		# Permissions
		self.creator_id = creator_id
		self.owner_id = creator_id
		self.creator_temp_id = None # Temporary ID of the creator of the object, for guests. Not saved to the database.

		# Default permissions for when entity is the subject
		self.allow = 0
		self.deny = 0
		self.guest_deny = 0

		# Permissions for when entity is the actor
		self.map_allow = 0       # Used to cache the map allows and map denys to avoid excessive SQL queries
		self.map_deny = 0

		self.temp_permissions_given_to = weakref.WeakSet()
		self.temp_permissions = weakref.WeakKeyDictionary() # temp_permissions[subject] = permission bits

		# Save when clean_up() is called
		self.save_on_clean_up = False
		self.cleaned_up_already = False

		# Make this entity easy to find
		AllEntitiesByID[self.id] = self

	def __repr__(self):
		return "%s(%r, type=%r, id=%r, db=%r)" % (self.__class__.__name__, self.name, self.entity_type, self.id, self.db_id)

	def __del__(self):
		#print("Unloading %r" % self)
		self.clean_up()

	# Non-client entities have a weak reference to their containers
	@property
	def map(self):
		return self.map_ref() if self.map_ref != None else None
	@map.setter
	def map(self, value):
		self.map_ref = weakref.ref(value) if value != None else None

	def clean_up(self):
		if not self.cleaned_up_already:

			if self.save_on_clean_up and not self.temporary:
				self.save_and_commit()
				self.save_on_clean_up = False

			# Remove from the container
			if self.map != None:
				self.map.remove_from_contents(self)

			# Let go of all passengers
			self.stop_current_ride()

			# Get rid of any contents that don't have persistent_object_entry permission
			if self.db_id != get_database_meta('default_map'):
				temp = set(self.contents)
				for u in temp:
					if not u.is_client() \
					and u.home_id != self.db_id \
					and (u.owner_id != self.owner_id or u.owner_id == None) \
					and u.map_id != u.owner_id \
					and not u.has_permission(self, permission['persistent_object_entry'], False):
						u.send_home()

			self.cleaned_up_already = True

	def send(self, commandType, commandParams):
		# Treat chat as a separate pseudo message type
		is_chat = commandType == 'MSG' and commandParams != None and ("name" in commandParams)
		if is_chat and 'CHAT' not in self.forward_message_types:
			return

		# Normal entities don't get messages, but they can if there's a forward
		if is_chat or (self.forward_messages_to != None and commandType in self.forward_message_types):
			c = get_entity_by_id(self.forward_messages_to, load_from_db=False)
			if c != None and c.is_client():
				connection = c.connection()
				if connection != None and connection.ws != None and connection.can_forward_messages_to:
					asyncio.ensure_future(connection.ws.send("FWD %s %s" % (self.protocol_id(), make_protocol_message_string(commandType, commandParams))))

	def send_string(self, raw, is_chat=False):
		# Directly send a string, so you can json.dumps once and reuse it for everyone

		# Treat chat as a separate pseudo message type
		if is_chat and 'CHAT' not in self.forward_message_types:
			return

		# Normal entities don't get messages, but they can if there's a forward
		if is_chat or (self.forward_messages_to != None and raw[0:3] in self.forward_message_types):
			c = get_entity_by_id(self.forward_messages_to, load_from_db=False)
			if c != None and c.is_client():
				connection = c.connection()
				if connection != None and connection.ws != None and connection.can_forward_messages_to:
					asyncio.ensure_future(connection.ws.send("FWD %s %s" % (self.protocol_id(), raw)))

	def start_batch(self):
		# Only for clients
		pass

	def finish_batch(self):
		# Only for clients
		pass

	# Send a message to all contents
	def broadcast(self, command_type, command_params, remote_category=None, remote_only=False, send_to_links=False, require_extension=None):
		""" Send a message to everyone on the map """
		if not remote_only and self.contents:
			is_chat = command_type == 'MSG' and command_params and 'name' in command_params
			send_me = make_protocol_message_string(command_type, command_params) # Get the string once and reuse it
			for client in self.contents:
				if require_extension == None:
					client.send_string(send_me, is_chat=is_chat)
				elif client.is_client() and client.connection_attr(require_extension):
					client.send_string(send_me, is_chat=is_chat)

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
					if not client.is_client():
						continue
					if not client.connection_attr('see_past_map_edge') or (require_extension != None and not client.connection_attr(require_extension)):
						continue
					client.send(command_type, command_params)

		""" Also send it to any registered listeners """
		if do_listeners:
			for connection in BotWatch[remote_category][self.db_id]:
				# don't send twice to people on the map
				if not remote_only and (connection.map_id == self.db_id):
					continue
				if require_extension == None or getattr(connection, require_extension):
					connection.send(command_type, command_params)

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

	def has_in_contents_tree(self, other):
		already_found = set()
		current = other
		while current:
			already_found.add(current)
			if current.map is self:
				return True
			if current.entity_type == entity_type['user']: # Don't return true for items in the inventory of another user, even if they're in your inventory
				return False
			if current.map in already_found:
				return False
			current = current.map
		return False

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

		item.loaded_maps = set([self.db_id])

		self.broadcast("MOV", {'id': item.protocol_id(), 'to': [random.randint(0, 9), random.randint(0, 9)]})

	# Permissions

	def update_map_permissions(self):
		""" Searches PERMISSION table and update map_allow and map_deny for the entity, so SQL queries can be skipped for the map they're on """
		self.map_allow, self.map_deny = self.get_allow_deny_for_other_entity(self.map_id)

	# Riding

	def stop_current_ride(self):
		self.start_batch()
		# remove the old ride before getting a new one
		if self.vehicle != None or self.follow_map_vehicle != None:
			self.dismount()
		# let's not deal with trees of passengers first
		if len(self.passengers) or len(self.follow_map_passengers):
			self.send("MSG", {'text': 'You let out all your passengers'})
			temp = set(self.passengers).union(self.follow_map_passengers)
			for u in temp:
				u.dismount()
		self.finish_batch()

	def ride(self, other):
		# cannot ride yourself
		if self is other:
			return

		self.start_batch()
		self.stop_current_ride()

		self.send("MSG", {'text': 'You get on %s (/hopoff to get off)' % other.name_and_username()})
		other.send("MSG", {'text': 'You carry %s' % self.name_and_username()})

		self.vehicle = other
		other.passengers.add(self)

		if self.map != None:
			self.map.broadcast("WHO", {'add': self.who()}, remote_category=botwatch_type['move'])
		if other.map != None:
			other.map.broadcast("WHO", {'add': other.who()}, remote_category=botwatch_type['move'])

		self.switch_map(other.map_id, new_pos=[other.x, other.y], on_behalf_of=other)
		self.finish_batch()

	def dismount(self):
		no_error = False
		if self.follow_map_vehicle:
			other = self.follow_map_vehicle

			self.send("MSG", {'text': 'You stop following %s to other maps' % other.name_and_username()})
			other.send("MSG", {'text': '%s stops following you to other maps' % self.name_and_username()})

			other.follow_map_passengers.discard(self)
			self.follow_map_vehicle = None

			no_error = True
		if self.vehicle:
			other = self.vehicle

			self.send("MSG", {'text': 'You get off %s' % other.name_and_username()})
			other.send("MSG", {'text': '%s gets off of you' % self.name_and_username()})

			other.passengers.discard(self)
			self.vehicle = None

			# Notify other people
			if self.map != None:
				self.map.broadcast("WHO", {'add': self.who()}, remote_category=botwatch_type['move'])
			if other.map != None:
				other.map.broadcast("WHO", {'add': other.who()}, remote_category=botwatch_type['move'])
		elif not no_error:
			self.send("ERR", {'text': 'You\'re not being carried'})

	# Apply information from a MOV message to someone

	def move_to(self, x, y, new_dir=None, is_teleport=False, already_moved=None):
		self.save_on_clean_up = True
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
		if self.passengers:
			# Avoid endless recursion
			if already_moved == None:
				already_moved = {self}
			else:
				already_moved.add(self)
			for u in self.passengers:
				if u in already_moved:
					continue
				if x != None and u.is_following and not is_teleport: # If "from" isn't present, then it's a teleport, not normal movement
					u.move_to(old_x, old_y, old_dir if new_dir != None else None, already_moved=already_moved)
				else:
					u.move_to(x, y, new_dir, already_moved=already_moved)
				u.map.broadcast("MOV", {'id': u.protocol_id(), 'to': [u.x, u.y], 'dir': u.dir}, remote_category=botwatch_type['move'])

	# Other movement

	def switch_map(self, map_id, new_pos=None, goto_spawn=True, update_history=True, edge_warp=False, on_behalf_of=None, already_moved=None):
		""" Teleport the user to another map """

		self.start_batch()

		self.save_on_clean_up = True
		if self.is_client():
			connection = self.connection()
			if connection:
				connection.undo_delete_data = None
				if not connection.sent_resources_yet:
					if connection.login_successful_callback:
						connection.login_successful_callback()
					connection.sent_resources_yet = True
					if LoadedAnyServerResources[0]:
						connection.send("RSC", ServerResources)

		added_new_history = False
		if update_history and self.map_id != None:
			# Add a new teleport history entry if new map
			if self.map_id != map_id:
				self.tp_history.append([self.map_id, self.x, self.y])
				added_new_history = True

		if self.map_id != map_id:
			# Find the entity (map_id may also directly be an entity)
			if isinstance(map_id, Entity):
				map_load = map_id
			else:
				map_load = get_entity_by_id(map_id)
				if map_load == None:
					self.send("ERR", {'text': 'Couldn\'t load map %s' % map_id})
					if added_new_history:
						self.tp_history.pop()
					self.finish_batch()
					return False

			# First check if you can even go to that map
			which_permission = permission['entry'] if self.is_client() else permission['object_entry']
			have_permission = (self if on_behalf_of == None else on_behalf_of).has_permission(map_load, which_permission, True) # probably don't need to check persistent_object_entry
			if have_permission and on_behalf_of and self.is_banned_from(map_id, which_permission):
				have_permission = False
			if not have_permission:
				self.send("ERR", {'text': 'You don\'t have permission to go to map %d' % map_id})
				if added_new_history:
					self.tp_history.pop()
				self.finish_batch()
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
				params['dir'] = self.dir
			self.map.broadcast("MOV", params, remote_category=botwatch_type['move'])
		elif new_pos == None and goto_spawn and self.map.is_map():
			self.move_to(self.map.start_pos[0], self.map.start_pos[1], is_teleport=True)
			self.map.broadcast("MOV", {'id': self.protocol_id(), 'to': [self.x, self.y]}, remote_category=botwatch_type['move'])

		self.finish_batch()

		# Move any passengers too
		if already_moved == None:
			already_moved = {self}
		else:
			already_moved.add(self)
		for u in self.passengers.union(self.follow_map_passengers):
			if u not in already_moved:
				u.switch_map(map_id, new_pos=[self.x, self.y], on_behalf_of=self, already_moved=already_moved)

		return True

	def send_home(self):
		""" If entity has a home, send it there. If not, find somewhere else suitable. """
		self.save_on_clean_up = True
		if self.home_id != None and self.switch_map(self.home_id,
			new_pos=[self.home_position[0], self.home_position[1]] if (self.home_position and len(self.home_position) == 2) else None
		):
			return
		if self.is_client() and self.switch_map(get_database_meta('default_map')):
			return
		owner = self.owner_id if self.owner_id != None else self.creator_id # TODO: Figure out how a null owner ID can happen
		if owner:
			# Try to put it into the owner's inventory, if they're online
			if self.switch_map(owner):
				return
			if self.db_id:
				# Move it to the owner's inventory
				if self.map:
					self.map.remove_from_contents(self)
				self.map_id = owner
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
		out = {
			'name': self.name,
			'pic': self.pic,
			'desc': self.desc,
			'x': self.x,
			'y': self.y,
			'dir': self.dir,
			'id': self.protocol_id(),
			'passengers': [passenger.protocol_id() for passenger in self.passengers],
			'vehicle': self.vehicle.protocol_id() if self.vehicle else None,
			'is_following': self.is_following,
			'type': entity_type_name[self.entity_type],
			'in_user_list': self.is_client(),
			'status': self.status_type,
			'status_message': self.status_message
		}

		if hasattr(self, "mini_tilemap") and self.mini_tilemap != None:
			out['mini_tilemap'] = self.mini_tilemap
		if hasattr(self, "mini_tilemap_data") and self.mini_tilemap_data != None:
			out['mini_tilemap_data'] = self.mini_tilemap_data
		if (hasattr(self, "clickable") and self.clickable) or 'CLICK' in self.forward_message_types:
			out['clickable'] = True

		if self.offset and self.offset != [0,0]:
			out['offset'] = self.offset
		if self.forward_messages_to:
			out['is_forwarding'] = True
			if 'CHAT' in self.forward_message_types:
				out['chat_listener'] = True
		return out

	def remote_who(self):
		""" Like who() but without map information """
		out = {
			'name': self.name,
			'pic': self.pic,
			'desc': self.desc,
			'id': self.protocol_id()
		}
		return out

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
			out['username'] = self.connection_attr('username')
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

	def set_tag(self, group, name, value):
		if self.tags == None:
			self.tags = {}
		if group != None and group not in self.tags:
			self.tags[group] = {name: value}
			return
		if group != None:
			self.tags[group][name] = value
		else:
			self.tags[name] = value

	def get_tag(self, group, name, default=None):
		if self.tags == None:
			return default
		look_in = self.tags.get(group, None) if group != None else self.tags
		if look_in == None:
			return default
		return look_in.get(name, default)

	def del_tag(self, group, name):
		if self.tags == None:
			return
		if group == None:
			self.tags.pop(name, None)
		else:
			look_in = self.tags.get(group, None)
			if look_in == None:
				return
			look_in.pop(name, None)
			if look_in == {}:
				self.tags.pop(group, None)
		if self.tags == {}:
			self.tags = None

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

		# "tags" column can be reused to store other things
		tags_column = loads_if_not_none(result[8])
		if tags_column:
			self.tags = tags_column.get('tags', {})

		self.owner_id = result[9]
		self.allow = result[10]
		self.deny = result[11]
		self.guest_deny = result[12]
		self.creator_id = result[13]
		if self.owner_id == None and self.creator_id != None:
			# TODO: Figure out how null owner IDs are even able to happen
			print("Correcting null owner ID for loaded entity %s to %s" % (load_id, self.creator_id))
			self.owner_id = self.creator_id

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
			return decompress_entity_data(result[0], result[1])
		return None

	def load_data(self):
		""" Load the entity's data to the database, using JSON unless overridden """
		try:
			self.data = loads_if_not_none(self.load_data_as_text())
			return True
		except:
			return False

	def save(self):
		""" Save entity information to the database """
		if self.temporary:
			return
		save_on_clean_up = False
		c = Database.cursor()

		if self.db_id == None:
			c.execute("INSERT INTO Entity (created_at, creator_id) VALUES (?, ?)", (datetime.datetime.now(), self.creator_id))
			self.assign_db_id(c.lastrowid)
			if self.db_id == None:
				return

		if self.owner_id == None and self.creator_id != None:
			# TODO: Figure out how null owner IDs are even able to happen
			print("Correcting null owner ID for saved entity %s to %s" % (load_id, self.creator_id))
			self.owner_id = self.creator_id

		# "tags" column can be reused to store other things
		tags_column = {}
		if self.tags:
			tags_column['tags'] = self.tags

		values = (self.entity_type, self.name, self.desc, dumps_if_not_none(self.pic), self.map_id, json.dumps([self.x, self.y] + ([self.dir] if self.dir != 2 else [])), self.home_id, dumps_if_not_none(self.home_position), dumps_if_condition(tags_column, tags_column != {}), self.owner_id if self.owner_id != None else self.creator_id, self.allow, self.deny, self.guest_deny, self.db_id)
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

class EntityWithPlainData(Entity):
	def load_data(self):
		""" Load the entity's data to the database, using plain text """
		try:
			self.data = self.load_data_as_text()
			return True
		except:
			return False
	def save_data(self):
		""" Save the entity's data to the database, using plain text """
		self.save_data_as_text(self.data)

# If the entity is truly generic, then use the data field (when it would've otherwise gone unused) in a useful way
class GenericEntity(Entity):
	def __init__(self,websocket):
		super().__init__(entity_type['generic'])

	def load_data(self):
		try:
			data = loads_if_not_none(self.load_data_as_text())
			if data == None:
				return True
			if 'forward_message_types' in data:
				self.forward_message_types = set()
			self.forward_messages_to = data.get('forward_messages_to', None)

			self.status_type = data.get('status_type', None)
			self.status_message = data.get('status_message', None)
			return True
		except:
			return False

	def save_data(self):
		data = {}
		if len(self.forward_message_types):
			data['forward_message_types'] = list(self.forward_message_types)
		if self.forward_messages_to != None:
			data['forward_messages_to'] = self.forward_messages_to
		if self.status_type != None:
			data['status_type'] = self.status_type
		if self.status_message != None:
			data['status_message'] = self.status_message
		if not data:
			data = None
		self.save_data_as_text(dumps_if_not_none(data))

	def who(self):
		w = super().who()
		return w
