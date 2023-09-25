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

import asyncio, datetime, time, random, websockets, json, hashlib, ipaddress
from .buildglobal import *
from .buildentity import *

userCounter = 1

class Client(Entity):
	def __init__(self,websocket):
		super().__init__(entity_type['user'])

		global userCounter
		self.ws = websocket
		self.name = 'Guest '+ str(userCounter)
		userCounter += 1
		self.pic = [0, 2, 25]

		self.ping_timer = 180
		self.idle_timer = 0
		self.connected_time = int(time.time())
		self.ip = None           # for IP ban purposes

		self.client_settings = ""

		# account stuff
		self.username = None
		self.password = None # actually the password hash

		self.status_type = None
		self.status_message = None

		self.ignore_list = set()
		self.watch_list = set()
		self.user_flags = 0

		self.sent_resources_yet = False
		self.no_inventory_messages = False # don't send BAG updates when adding or removing items

		# Information for /undodel
		self.undo_delete_data = None
		self.undo_delete_when = None

		self.features = set() # list of feature names

		# see_past_map_edge variables
		self.see_past_map_edge = False
		self.loaded_maps = set() # maps the client should have loaded currently

		# "batch" extension variables
		self.can_batch_messages = False
		self.messages_in_batch = []
		self.make_batch = 0 # Integer instead of bool. Allows layering batches on top of each other and waiting until the bottom level is done.

		# Other extensions
		self.receive_build_messages = False
		self.can_forward_messages_to = False

		# Clients keep the entities they're using for message forwarding alive by keeping strong references to them in this set
		self.forwarding_messages_from = set()

		self.identified = False

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
		for p in self.listening_maps:
			BotWatch[p[0]][p[1]].remove(self)
		super().clean_up()

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

	def test_server_banned(self):
		""" Test for and take action on IP bans """
		# Look for IP bans
		if self.ip != '':
			c = Database.cursor()
			ip = ipaddress.ip_address(self.ip)
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
					print("Ban expired for user %s" % self.ip)
					c.execute('DELETE FROM Server_Ban WHERE id=?', (result[0],))
				else:
					print("Denied access to banned user %s" % self.ip)
					self.disconnect('Banned from the server until %s (%s)' % (str(result[1]), result[2]))
					return True
		return False

	def disconnect(self, text=None):
		if self.ws != None:
			if text != None:
				# Does not actually seem to go through, might need some refactoring
				self.send("ERR", {'text': text})
			asyncio.ensure_future(self.ws.close())

	def username_or_id(self):
		return self.username or self.protocol_id()

	def who(self):
		w = super().who()
		w.update({
			'username': self.username,
			'status': self.status_type,
			'status_message': self.status_message
		})
		if self.user_flags & userflag['bot']:
			w['bot'] = True
		return w

	def save(self):
		""" Save user information to the database """
		super().save()
		if self.db_id == None:
			return

		# Create new user if user doesn't already exist
		c = Database.cursor()
		c.execute('SELECT entity_id FROM User WHERE entity_id=?', (self.db_id,))
		if c.fetchone() == None:
			c.execute("INSERT INTO User (entity_id) VALUES (?)", (self.db_id,))
			self.db_id = c.lastrowid
			if self.db_id == None:
				return

		# Update the user
		values = (self.username, self.password, "sha512", dumps_if_not_empty(list(self.watch_list)), dumps_if_not_empty(list(self.ignore_list)), self.client_settings, datetime.datetime.now(), self.user_flags, self.db_id)
		c.execute("UPDATE User SET username=?, passhash=?, passalgo=?, watch=?, ignore=?, client_settings=?, last_seen_at=?, flags=? WHERE entity_id=?", values)

	def load(self, username, password, override_map=None):
		""" Load an account from the database """
		c = Database.cursor()
		
		c.execute('SELECT entity_id, passhash, passalgo, watch, ignore, client_settings, flags FROM User WHERE username=?', (username,))
		result = c.fetchone()
		if result == None:
			return None

		passalgo = result[2] # Algorithm used, allows more options later
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
			self.password = passhash

		# If the password is good, copy the other stuff over
		self.username = username
		self.assign_db_id(result[0])
		self.watch_list = set(json.loads(result[3] or "[]"))
		self.ignore_list = set(json.loads(result[4] or "[]"))
		self.client_settings = result[5]
		self.user_flags = result[6]
		if self.user_flags == None:
			self.user_flags = 0
		# And copy over the base entity stuff
		return super().load(self.db_id, override_map=override_map)

	def refresh_client_inventory(self):
		self.send("BAG", {'list': [child.bag_info() for child in self.all_children()], 'clear': True})

	def login(self, username, password, override_map=None):
		""" Attempt to log the client into an account """
		username = filter_username(username)
		self.no_inventory_messages = True      # because load() will load in objects contained by this one
		result = self.load(username, password, override_map=override_map)
		self.no_inventory_messages = False
		if result == True:
			print("login: \"%s\" from %s" % (self.username, self.ip))

			#self.switch_map(self.map_id, goto_spawn=False)
			if self.map:
				self.map.broadcast("MSG", {'text': self.name+" has logged in ("+self.username+")"})
				self.map.broadcast("WHO", {'add': self.who()}, remote_category=botwatch_type['entry']) # update client view
			else:
				self.send("MSG", {'text': "Your last map wasn't saved correctly. Sending you to the default one..."})
				self.switch_map(get_database_meta('default_map'))

			# send the client their inventory
			self.refresh_client_inventory()

			c = Database.cursor()
			# send the client their mail
			mail = []
			for row in c.execute('SELECT id, sender_id, recipients, subject, contents, flags FROM Mail WHERE owner_id=?', (self.db_id,)):
				item = {'id': row[0], 'from': find_username_by_db_id(row[1]),
				'to': [find_username_by_db_id(int(x)) for x in row[2].split(',')],
				'subject': row[3], 'contents': row[4], 'flags': row[5]}
				mail.append(item)
			if len(mail):
				self.send("EML", {'list': mail})

			return True
		elif result == False:
			self.send("ERR", {'text': 'Login fail, bad password for account'})
		else:
			self.send("ERR", {'text': 'Login fail, nonexistent account'})
		return False

	def changepass(self, password):
		# Generate a random salt and append it to the password
		salt = str(random.random())
		combined = password+salt
		self.password = "%s:%s" % (salt, hashlib.sha512(combined.encode()).hexdigest())
		self.save_and_commit()

	def register(self, username, password):
		username = str(filter_username(username))
		# User can't already exist
		if find_db_id_by_username(username) != None:
			return False
		self.username = username
		self.changepass(password)
		# db_id will be set because changepass calls save_and_commit()
		return True

	def is_client(self):
		return True
