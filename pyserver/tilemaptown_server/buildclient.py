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
from .buildentity import *

userCounter = 1

class Client(Entity):
	def __init__(self,websocket):
		super().__init__(entity_type['user'])

		global userCounter
		self.ws = websocket
		self.name = 'Guest '+ str(userCounter)
		self.pic = [0, 2, 25]

		self.ping_timer = 180
		self.idle_timer = 0
		self.ip = None           # for IP ban purposes

		self.client_settings = ""

		# account stuff
		self.username = None
		self.password = None # actually the password hash

		self.away = False # true (or a string) if person is away
		self.ignore_list = set()
		self.watch_list = set()
		self.user_flags = 0

		self.identified = False

		AllClients.add(self)

	def clean_up(self):
		AllClients.discard(self)
		for p in self.listening_maps:
			BotWatch[p[0]][p[1]].remove(self)
		super().clean_up()

	def send(self, command_type, command_params):
		""" Send a command to the client """
		if self.ws == None:
			return
		send_me = command_type
		if command_params != None:
			send_me += " " + json.dumps(command_params)
		asyncio.ensure_future(self.ws.send(send_me))

	def add_to_contents(self, item):
		super().add_to_contents(item)
		self.send("BAG", {'update': item.bag_info()})

	def remove_from_contents(self, item):
		super().remove_from_contents(item)
		self.send("BAG", {'remove': item.db_id})

	def test_server_banned(self):
		""" Test for and take action on IP bans """
		# Look for IP bans
		if self.ip != '':
			c = Database.cursor()
			split = self.ip.split('.')
			if len(split) == 4:
				c.execute("""SELECT id, expires_at, reason FROM Server_Ban WHERE
                          (ip=?) or (
                          (ip1=? or ip1='*') and
                          (ip2=? or ip2='*') and
                          (ip3=? or ip3='*') and
                          (ip4=? or ip4='*'))""", (self.ip, split[0], split[1], split[2], split[3]))
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
			'away': self.away
		})
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
		values = (self.password, "sha512", dumps_if_not_empty(list(self.watch_list)), dumps_if_not_empty(list(self.ignore_list)), self.client_settings, datetime.datetime.now(), self.user_flags, self.db_id)
		c.execute("UPDATE User SET passhash=?, passalgo=?, watch=?, ignore=?, client_settings=?, last_seen_at=?, flags=? WHERE id=?", values)

	def load(self, username, password):
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
		self.db_id = result[0]
		self.watch_list = set(json.loads(result[2]))
		self.ignore_list = set(json.loads(result[3]))
		self.client_settings = result[4]
		self.user_flags = result[5]
		# And copy over the base entity stuff
		return super().load(self.db_id)

	def login(self, username, password):
		inventory = []
		def recursively_get_inventory(container):
			for row in c.execute('SELECT id, name, desc, type, flags, location, data, pic, tags FROM Entity WHERE owner_id=? AND location=?', (self.db_id, container)):
				item = {'id': row[0], 'name': row[1], 'desc': row[2], 'type': entity_type_name[row[3]], 'flags': row[4], 'folder': row[5], 'data': row[6], 'tags': row[7]}
				inventory.append(item)

		""" Attempt to log the client into an account """
		username = filter_username(username)
		result = self.load(username, password)
		if result == True:
			print("login: \"%s\" from %s" % (self.username, self.ip))

			self.switch_map(self.map_id, goto_spawn=False)
			if self.map:
				self.map.broadcast("MSG", {'text': self.name+" has logged in ("+self.username+")"})
				self.map.broadcast("WHO", {'add': self.who()}, remote_category=botwatch_type['entry']) # update client view
			else:
				self.send("MSG", {'text': "You've logged in but you're not on a map. Try [command]map %d[/command]" % get_database_meta('default_map')})

			# send the client their inventory
			c = Database.cursor()
			inventory = []
			recursively_get_inventory(self.db_id)
			self.send("BAG", {'list': inventory})

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
