# Tilemap Town
# Copyright (C) 2017-2025 NovaSquirrel
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

import asyncio, datetime, time, random, websockets, json, hashlib, ipaddress, weakref
from .buildglobal import *
from .buildentity import *
from collections import deque

userEntityCounter = 1

class BuildSession(object):
	def __init__(self, temp_id, ip):
		self.temp_id = temp_id
		self.ip = ip
		self.name = "?"
		self.username = None
		self.maps = {}
		self.in_global_list_yet = False
		self.time = datetime.datetime.now()

		# Stats
		self.total_put = 0
		self.total_delete = 0

	def init_map(self, map_id):
		if map_id not in self.maps:
			self.maps[map_id] = deque(maxlen=Config["TempLogs"]["RollbackItemsSize"])
		if not self.in_global_list_yet:
			TempLogs[3].append(self)
			self.in_global_list_yet = True

	def write_put_turf(self, map_id, x, y, new, old):
		self.init_map(map_id)
		self.maps[map_id].appendleft("t\n%d\n%d\n%s\n%s" % (x, y, json.dumps(new), json.dumps(old)))
		self.total_put += 1

	def write_put_objs(self, map_id, x, y, new, old):
		self.init_map(map_id)
		self.maps[map_id].appendleft("o\n%d\n%d\n%s\n%s" % (x, y, json.dumps(new), json.dumps(old)))
		self.total_put += 1

	def write_del(self, map_id, x1, y1, x2, y2, old):
		self.init_map(map_id)
		self.maps[map_id].appendleft("d\n%d\n%d\n%d\n%d\n%s" % (x1, y1, x2, y2, json.dumps(old)))
		self.total_delete += 1

	def rollback_all(self):
		different = {}
		for m in set(self.maps.keys()):
			different[m] = self.rollback_map(m)
		self.total_put = 0
		self.total_delete = 0
		return different

	def rollback_map(self, map_id):
		different = []
		if map_id not in self.maps:
			return
		map = get_entity_by_id(map_id)
		if map == None:
			return
		was_data_loaded = map.map_data_loaded
		if not was_data_loaded:
			map.load_data(load_anyway=True)

		for c in map.contents:
			if c.is_client():
				c.start_batch()

		for e in self.maps.pop(map_id, []):
			a = e.splitlines()
			if a[0] == 't':
				_, x, y, new, old = a
				x = int(x)
				y = int(y)
				if map.turfs[x][y] != json.loads(new):
					different.append((x,y))
				else:
					map.turfs[x][y] = json.loads(old)
					map.broadcast("MAP", map.map_section(x, y, x, y), send_to_links=True)
			elif a[0] == 'o':
				_, x, y, new, old = a
				x = int(x)
				y = int(y)
				if map.objs[x][y] != json.loads(new):
					different.append((x,y))
				else:
					map.objs[x][y] = json.loads(old)
					map.broadcast("MAP", map.map_section(x, y, x, y), send_to_links=True)
			elif a[0] == 'd':
				_, x1, y1, x2, y2, old = a
				map.apply_map_section(json.loads(old))

		# Save changes and unload if needed
		map.map_data_modified = True
		if not was_data_loaded:
			map.save_data()
			map.unload_data()
		for c in map.contents:
			if c.is_client():
				c.finish_batch()
		return different

class ClientMixin(object):
	def send(self, command_type, command_params):
		connection = self.connection()
		if connection:
			connection.send(command_type, command_params)

	def send_string(self, raw, is_chat=False):
		connection = self.connection()
		if connection:
			connection.send_string(raw, is_chat=is_chat)

	def start_batch(self):
		connection = self.connection()
		if connection:
			connection.start_batch()

	def finish_batch(self):
		connection = self.connection()
		if connection:
			connection.finish_batch()

	def disconnect(self, text=None, reason=''):
		connection = self.connection()
		if connection:
			connection.disconnect(text=text, reason=reason)

	def connection_attr(self, attribute):
		connection = self.connection()
		if connection:
			return getattr(connection, attribute)
		return None

	def try_to_listen(self, map_id, category_id, send_error=False):
		connection = self.connection()
		if not connection or not entity_id_exists(map_id):
			return False
		# If map_id is an alias, try to turn it into a real database ID, otherwise leave it as a temporary ID
		if isinstance(map_id, str):
			map_id = find_db_id_by_str(map_id) or map_id
		# Permission check
		if not self.has_permission(map_id, permission['map_bot'], False) \
		and not (category_id in (maplisten_type['chat'], maplisten_type['chat_listen'], maplisten_type['entry']) and self.has_permission(map_id, permission['remote_chat'], False)):
			return False
		connection.listen(map_id, category_id)
		return True

	def unlisten(self, map_id, category_id):
		connection = self.connection()
		if not connection:
			return False
		# If map_id is an alias, try to turn it into a real database ID, otherwise leave it as a temporary ID
		map_id = find_db_id_by_str(map_id) or map_id
		return connection.unlisten(map_id, category_id)

	@property
	def username(self):
		return self.connection_attr('username')

class Client(ClientMixin, Entity):
	def __init__(self, connection):
		super().__init__(entity_type['user'])

		global userEntityCounter
		self.connection = weakref.ref(connection)
		self.name = 'Guest '+ str(userEntityCounter)
		userEntityCounter += 1
		self.pic = [0, 2, 25]

		self.saved_pics = {}
		self.morphs = {}

		self.no_inventory_messages = False # don't send BAG updates when adding or removing items

		self.temporary = True # Temporary entity until they identify

		AllClients.add(self)

	# Unlike regular entities, clients have *strong* references to their containers
	@property
	def map(self):
		return self.map_ref
	@map.setter
	def map(self, value):
		self.map_ref = value

	def clean_up(self):
		AllClients.discard(self)
		super().clean_up()

	def add_to_contents(self, item):
		super().add_to_contents(item)
		self.added_to_child_contents(item) # Reuse since it's the same code

	def remove_from_contents(self, item):
		super().remove_from_contents(item)
		self.removed_from_child_contents(item) # Reuse since it's the same code

	def added_to_child_contents(self, item):
		""" Called on parents when add_to_contents is called here """
		if not self.no_inventory_messages:
			if self.has_permission(item, permission['list_contents'], False):
				self.send("BAG", {'list': [item.bag_info()] + [child.bag_info() for child in item.all_children()]})
			else:
				self.send("BAG", {'list': [item.bag_info()]})

	def removed_from_child_contents(self, item):
		""" Called on parents when remove_from_contents is called here """
		if not self.no_inventory_messages:
			self.send("BAG", {'remove': {'id': item.protocol_id()}})

	def load_data(self):
		d = loads_if_not_none(self.load_data_as_text())
		if d == None:
			return True
		self.saved_pics = d.get('saved_pics', {})
		self.morphs = d.get('morphs', {})
		return True

	def save_data(self):
		d = {}
		if self.saved_pics:
			d['saved_pics'] = self.saved_pics
		if self.morphs:
			d['morphs'] = self.morphs
		self.save_data_as_text(json.dumps(d))

	def username_or_id(self):
		return self.username or self.protocol_id()

	# Shared code for who() and remote_who()
	def add_who_info(self, w):
		connection = self.connection()
		if connection != None:
			w.update({
				'username': connection.username
			})
			if connection.user_flags & userflag['bot']:
				w['bot'] = True
		return w

	def who(self):
		return self.add_who_info(super().who())

	def remote_who(self):
		out = self.add_who_info(super().remote_who())
		if (self.connection_attr('user_flags') or 0) & userflag['secret_pic']:
			out.pop('pic', None)
			out.pop('desc', None)
		return out

	def save(self):
		""" Save user information to the database """
		super().save()
		if self.db_id == None:
			return
		connection = self.connection()
		if connection:
			connection.save_settings(self.db_id)

	def load(self, username, override_map=None):
		""" Load an account from the database """
		connection = self.connection()
		if not connection or not connection.load_settings(username):
			return False
		self.assign_db_id(connection.db_id)
	
		# And copy over the base entity stuff
		self.no_inventory_messages = True  # because load() will load in objects contained by this one
		result = super().load(self.db_id, override_map=override_map)
		self.no_inventory_messages = False
		return result

	def is_client(self):
		return True

class Connection(object):
	def __init__(self, websocket, ip):
		self.ws = websocket
		self.ip = ip
		self.entity = FakeClient(self)
		self.identified = False
		self.oper_override = False
		self.client_name = None

		self.ping_timer = 180
		self.idle_timer = 0
		self.connected_time = int(time.time())
		self.sent_resources_yet = False
		self.images_and_tilesets_received_so_far = set()

		# For being able to hold statuses separately from entities? May change this later
		self.status_type = None
		self.status_message = None

		# Settings
		self.client_settings = ""
		self.ignore_list = set()
		self.watch_list = set()
		self.user_flags = 0

		# Account info
		self.username = None
		self.db_id = None

		# File upload information
		self.total_file_upload_size = 0

		# Connections keep the entities they're using for message forwarding alive by keeping strong references to them in this set
		self.keep_entities_loaded = set()

		# Remove these entities when you log out
		self.cleanup_entities_on_logout = weakref.WeakSet()

		# Allow cleaning up MapListens info
		self.listening_maps = set() # tuples of (category, map)

		# Stats
		self.build_count = 0     # Amount this person has built
		self.delete_count = 0    # Amount this person has deleted

		# Information for /undodel and rollbacks
		self.undo_delete_data = None
		self.undo_delete_when = None
		self.build_session = BuildSession(userEntityCounter, ip)

		# "batch" extension variables
		self.can_batch_messages = False
		self.messages_in_batch = []
		self.make_batch = 0 # Integer instead of bool. Allows layering batches on top of each other and waiting until the bottom level is done.

		# "see_past_map_edge" variables
		self.see_past_map_edge = False
		self.loaded_maps = set() # maps the client should have loaded currently

		# Other extensions
		self.receive_build_messages = False
		self.can_forward_messages_to = False
		self.user_watch_with_who = False
		self.can_acknowledge = False
		self.features = set() # list of feature names

	def load_settings(self, username):
		if username == None:
			return
		c = Database.cursor()
		
		c.execute('SELECT entity_id, watch, ignore, client_settings, flags FROM User WHERE username=?', (username,))
		result = c.fetchone()
		if result == None:
			return False

		# If the password is good, copy the other stuff over
		self.username = username
		self.build_session.username = username
		self.build_session.name = self.entity.name
		self.db_id = result[0]
		self.watch_list = set(json.loads(result[1] or "[]"))
		self.ignore_list = set(json.loads(result[2] or "[]"))
		self.client_settings = result[3]
		self.user_flags = result[4]
		if self.user_flags == None:
			self.user_flags = 0

		# Avoid having to do a query every time the limit needs to be checked
		c.execute('SELECT SUM(size) FROM User_File_Upload WHERE user_id=?', (self.db_id,))
		result = c.fetchone()
		if result != None:
			self.total_file_upload_size = result[0] or 0
		return True

	def save_settings(self, db_id):
		if db_id == None:
			return

		# Create new user if user doesn't already exist
		c = Database.cursor()
		c.execute('SELECT entity_id FROM User WHERE entity_id=?', (db_id,))
		if c.fetchone() == None:
			c.execute("INSERT INTO User (entity_id) VALUES (?)", (db_id,))
			self.db_id = c.lastrowid
			if self.db_id == None:
				return

		# Update the user
		values = (self.username, dumps_if_not_empty(list(self.watch_list)), dumps_if_not_empty(list(self.ignore_list)), self.client_settings, datetime.datetime.now(), self.user_flags, db_id)
		c.execute("UPDATE User SET username=?, watch=?, ignore=?, client_settings=?, last_seen_at=?, flags=? WHERE entity_id=?", values)

	def changepass(self, password):
		# Generate a random salt and append it to the password
		salt = str(random.random())
		combined = password+salt
		passhash = "%s:%s" % (salt, hashlib.sha512(combined.encode()).hexdigest())

		c = Database.cursor()
		c.execute("UPDATE User SET passhash=?, passalgo=? WHERE entity_id=?", (passhash, "sha512", self.db_id))
		Database.commit()

	def register(self, username, password):
		username = str(filter_username(username))
		# User can't already exist
		if find_db_id_by_username(username) != None:
			return False
		self.entity.temporary = False
		self.username = username
		self.entity.save()
		self.changepass(password)
		# db_id will be set because of self.entity.save()
		return True

	def send(self, command_type, command_params):
		""" Send a command to the client """
		if self.ws == None:
			return
		self.send_string(make_protocol_message_string(command_type, command_params))

	def send_string(self, raw, is_chat=False):
		""" Send a command to the client that's already in string form """
		if self.ws == None:
			return
		if self.make_batch and self.can_batch_messages:
			self.messages_in_batch.append(raw)
		else:
			asyncio.ensure_future(self.ws.send(raw))

	def start_batch(self):
		""" Start batching messages """
		self.make_batch += 1 # Increase batch level

	def finish_batch(self):
		""" Send all of the queued messages and clear the queue """
		if self.make_batch > 0:
			self.make_batch -= 1
			# If it's not the bottom layer yet, wait until it is
			if self.make_batch > 0:
				return
		if self.ws == None:
			return
		n = len(self.messages_in_batch)
		if n == 0:
			return
		elif n == 1: # If there's one message, format it normally
			asyncio.ensure_future(self.ws.send(self.messages_in_batch[0]))
		else:
			asyncio.ensure_future(self.ws.send("BAT "+"\n".join(self.messages_in_batch)))
		# Clear out the batch
		self.messages_in_batch = []

	def test_login(self, username, password):
		c = Database.cursor()
		
		c.execute('SELECT passalgo, passhash FROM User WHERE username=?', (username,))
		result = c.fetchone()
		if result == None:
			return None

		passalgo = result[0] # Algorithm used; specifying it allows more options later
		passhash = result[1] # Hash that may be formatted "hash" or "salt:hash"

		if passalgo == "sha512":
			# Start with a default for no salt
			salt = ""
			comparewith = passhash

			# Is there a salt?
			split = passhash.split(':')
			if len(split) == 2:
				salt = split[0]
				comparewith = split[1]

			# Verify the password
			if hashlib.sha512((password+salt).encode()).hexdigest() != comparewith:
				return False
			return True

		write_to_connect_log("Unrecognized password algorithm \"%s\" for \"%s\"" % (passalgo, username))
		return False

	def login(self, username, password, client, override_map=None, announce_login=True):
		""" Attempt to log the client into an account """
		username = filter_username(username)

		c = Database.cursor()
		c.execute('SELECT flags FROM User WHERE username=?', (username,))
		result = c.fetchone()
		if result != None:
			if result[0] & userflag['no_login']:
				write_to_connect_log("Denied access to disabled account \"%s\" from %s" % (username, self.ip))
				self.login_fail_reason = "BadLogin|Account is currently disabled"
				self.send("ERR", {'text': 'Login fail, account is currently disabled'})
				return False

		login_successful = self.test_login(username, password)
		if login_successful == True:
			self.start_batch()
			self.username = username
			self.db_id = find_db_id_by_username(username)

			# Don't allow multiple connections to be tied to the same account at once
			if isinstance(client, Client): # Only load if it's actually a Client
				had_old_entity = self.db_id in AllEntitiesByDB
				if had_old_entity:
					old_entity = AllEntitiesByDB[self.db_id]
					old_connection = old_entity.connection()
					old_entity.save_on_clean_up = True
					old_entity.clean_up()
					if old_connection:
						old_connection.entity = None
						old_connection.disconnect(reason="LoggedInElsewhere")
					del old_entity
					del old_connection
				client.load(username, override_map=override_map)
				client.temporary = False

				if client.map:
					if announce_login:
						client.map.broadcast("MSG", {'text': client.name+" has logged in ("+username+")"})
					client.map.broadcast("WHO", {'add': client.who()}, remote_category=maplisten_type['entry']) # update client view
				else:
					client.send("MSG", {'text': "Your last map wasn't saved correctly. Sending you to the default one..."})
					client.switch_map(get_database_meta('default_map'))

				# send the client their inventory
				self.refresh_client_inventory(client)
				write_to_connect_log("login: \"%s\" from %s" % (username, self.ip))
			else:
				client.name = get_entity_name_by_db_id(self.db_id)

				old_connection = ConnectionsByUsername.get(username, None)
				if old_connection:
					old_entity = old_connection.entity
					if isinstance(old_entity, Entity):
						old_entity.save_on_clean_up = True
						old_entity.clean_up()
					old_connection.entity = None
					old_connection.disconnect(reason="LoggedInElsewhere")
					del old_entity
					del old_connection

				self.load_settings(username)
				write_to_connect_log("login: \"%s\" from %s (messaging)" % (username, self.ip))

			ConnectionsByUsername[username] = self
			self.broadcast_who_to_watchers()
			if self.user_watch_with_who:
				users = {}
				for u in self.watch_list:
					other = ConnectionsByUsername.get(u, None)
					if not other or not other.can_be_watched():
						continue
					users[str(other.db_id)] = other.watcher_who()
				self.send("WHO", {"list": users, "type": "watch"})

			if self.login_successful_callback: # Make sure this gets called even if the map switch didn't happen
				self.login_successful_callback()

			# Send the user's settings to them
			settings = {}
			if self.client_settings:
				settings["client_settings"] = self.client_settings
			if self.ignore_list:
				settings["ignore_list"] = list(self.ignore_list)
			if self.watch_list:
				settings["watch_list"] = list(self.watch_list)
			if settings != {}:
				self.send("EXT", {"settings": settings})

			# send the user their mail
			mail = []
			for row in c.execute('SELECT id, sender_id, recipients, subject, contents, flags, created_at FROM Mail WHERE owner_id=?', (self.db_id,)):
				item = {'id': row[0], 'from': find_username_by_db_id(row[1]),
				'to': [find_username_by_db_id(int(x)) for x in row[2].split(',')],
				'subject': row[3], 'contents': row[4], 'flags': ['read'] if row[5] == 1 else (['sent'] if row[5] == 2 else []), 'timestamp': row[6].isoformat()}
				mail.append(item)
			if len(mail):
				self.send("EML", {'list': mail})

			# Send the user any offline messages meant for them
			if self.db_id in OfflineMessages:
				for sender_db_id, queue in OfflineMessages[self.db_id].items():
					if not queue:
						continue
					last_item = queue[-1]
					for item in queue:
						text, time, sender_name, sender_username = item
						params = {'text': text, 'name': sender_name, 'id': sender_db_id, 'username': sender_username, 'receive': True, 'offline': True, 'timestamp': time.isoformat()}
						if item is last_item and self.can_acknowledge:
							params['ack_req'] = params['timestamp']
						self.send("PRI", params)
				if not self.can_acknowledge:
					del OfflineMessages[self.db_id]

			self.finish_batch()
			return True
		elif login_successful == False:
			self.login_fail_reason = "WrongPassword"
			self.send("ERR", {'text': 'Login fail, wrong password for account'})
		else:
			self.login_fail_reason = "NonexistentAccount"
			self.send("ERR", {'text': 'Login fail, nonexistent account'})
		return False

	def test_server_banned(self):
		""" Test for and take action on IP bans """
		# Look for IP bans
		if self.ip != '':
			c = Database.cursor()
			try:
				ip = ipaddress.ip_address(self.ip)
			except:
				write_to_connect_log("Bad IP: "+self.ip)
				return False
			if ip.version == 4:
				split = ip.exploded.split('.')
				c.execute("""SELECT id, expires_at, reason FROM Server_Ban WHERE
                          (ip=?) or (
                          (ip4_1=? or ip4_1='*') and
                          (ip4_2=? or ip4_2='*') and
                          (ip4_3=? or ip4_3='*') and
                          (ip4_4=? or ip4_4='*'))""", (self.ip, split[0], split[1], split[2], split[3]))
			elif ip.version == 6:
				split = ip.exploded.split(':')
				c.execute("""SELECT id, expires_at, reason FROM Server_Ban WHERE
                          (ip=?) or (
                          (ip6_1=? or ip6_1='*') and
                          (ip6_2=? or ip6_2='*') and
                          (ip6_3=? or ip6_3='*') and
                          (ip6_4=? or ip6_4='*') and
                          (ip6_5=? or ip6_5='*') and
                          (ip6_6=? or ip6_6='*') and
                          (ip6_7=? or ip6_7='*') and
                          (ip6_8=? or ip6_8='*'))""", (self.ip, split[0], split[1], split[2], split[3], split[4], split[5], split[6], split[7]))
			else:
				c.execute('SELECT id, expires_at, reason FROM Server_Ban WHERE ip=?', (self.ip,))

			# If there is a result, check to see if it's expired or not
			result = c.fetchone()
			if result != None:
				if result[1] != None and datetime.datetime.now() > result[1]:
					write_to_connect_log("Ban expired for user %s" % self.ip)
					c.execute('DELETE FROM Server_Ban WHERE id=?', (result[0],))
				else:
					write_to_connect_log("Denied access to banned user %s" % self.ip)
					self.disconnect('Banned from the server until %s (%s)' % (str(result[1]), result[2]), reason='Ban')
					return True
		return False

	def listener_who(self):
		return {
			'id': self.entity.protocol_id(),
			'name': self.entity.name if hasattr(self.entity, 'name') else None,
			'username': self.username,
		}

	def watcher_who(self):
		return {
			'id': self.db_id,
			'username': self.username,
			'status': self.status_type,
			'status_message': self.status_message,
			'in_world': isinstance(self.entity, Entity),
		}

	def can_be_watched(self):
		return self.user_flags & userflag['no_watch'] == 0

	def broadcast_who_to_watchers(self):
		if not self.can_be_watched():
			return
		who_info = {"add": self.watcher_who(), "type": "watch"}
		for other in AllConnections:
			if other.user_watch_with_who and self.username in other.watch_list:
				other.send("WHO", who_info)

	def refresh_client_inventory(self, entity):
		self.send("BAG", {'list': [child.bag_info() for child in entity.all_children()], 'clear': True})

	def protocol_error(self, context, text=None, code=None, detail=None, subject_id=None):
		out = {}
		if text != None:
			out['text'] = text
		if code != None:
			out['code'] = code
		if detail != None:
			out['detail'] = detail
		if subject_id != None:
			if isinstance(subject_id, Entity):
				out['subject_id'] = subject_id.protocol_id()
			else:
				out['subject_id'] = subject_id
		if context['echo'] != None:
			out['echo'] = context['echo']
		self.send("ERR", out)

	def disconnect(self, text=None, reason=''):
		if self.ws != None:
			if text != None:
				# Does not actually seem to go through, might need some refactoring
				self.send("ERR", {'text': text})
			asyncio.ensure_future(self.ws.close(reason=reason))

	def listen(self, map_id, category_id):
		# Create if it doesn't already exist
		if map_id not in MapListens[category_id]:
			MapListens[category_id][map_id] = weakref.WeakSet()

		MapListens[category_id][map_id].add(self)
		self.listening_maps.add((category_id, map_id))

		# Certain kinds of listens send initial data
		if category_id == maplisten_type['build']:
			if get_entity_type_by_db_id(m) == entity_type['map']:
				self.start_batch()
				map = get_entity_by_id(map_id)
				data = map.map_info()
				data['remote_map'] = map_id
				self.send("MAI", data)

				data = map.map_section(0, 0, map.width-1, map.height-1)
				data['remote_map'] = map_id
				self.send("MAP", data)
				self.finish_batch()
		elif category_id == maplisten_type['entry']:
			if map_id in AllEntitiesByDB: # Entity currently loaded
				self.send("WHO", {'list': AllEntitiesByDB[map_id].who_contents(), 'remote_map': map_id})
			else:                         # Entity is not loaded
				self.send("WHO", {'list': [], 'remote_map': map_id})
		elif category_id == maplisten_type['chat']:
			for connection in MapListens[maplisten_type['chat_listen']].get(map_id, tuple()):
				connection.send("WHO", {'type': 'chat_listeners', 'add': self.listener_who(), 'remote_map': map_id})

		elif category_id == maplisten_type['chat_listen']:
			self.send("WHO", {'type': 'chat_listeners', 'list': [connection.listener_who() for connection in MapListens[maplisten_type['chat']].get(map_id, tuple())], 'remote_map': map_id})

	def unlisten(self, map_id, category_id):
		# If you stop listening on chat, that itself is an event someone may be listening on
		if category_id == maplisten_type['chat']:
			for connection in MapListens[maplisten_type['chat_listen']].get(map_id, tuple()):
				connection.send("WHO", {'type': 'chat_listeners', 'remove': self.entity.protocol_id(), 'remote_map': map_id})

		removed = False
		if (map_id in MapListens[category_id]) and (self in MapListens[category_id][map_id]):
			removed = True
			MapListens[category_id][map_id].remove(self)
			if not len(MapListens[category_id][map_id]):
				del MapListens[category_id][map_id]

		self.listening_maps.discard((category_id, map_id))
		return removed

	def write_to_build_session(self):
		pass

class FakeClient(PermissionsMixin, ClientMixin, object):
	def __init__(self, connection):
		self.connection = weakref.ref(connection)

		# Placeholder stuff that'll be here for things that check for it
		self.map = None
		self.map_id = None
		self.entity_type = entity_type['user']

		self.name = "?"

		self.requests = {}
		self.rate_limiting = {}

	def is_client(self): # is_client_and_entity() will distinguish between this and a real Client
		return True

	def protocol_id(self):
		return self.connection_attr("db_id")

	def username_or_id(self):
		return self.connection_attr("username")

	def name_and_username(self):
		return self.connection_attr("username")

	#@property
	#def name(self):
	#	return self.connection_attr("username")

	@property
	def db_id(self):
		return self.connection_attr("db_id")
