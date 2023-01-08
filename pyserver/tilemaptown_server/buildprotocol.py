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

import json, datetime
from .buildglobal import *
from .buildcommand import handle_user_command, escapeTags

handlers = {}

def tileIsOkay(tile):
	# convert to a dictionary to check first if necessary
	if type(tile) == str and len(tile) and tile[0] == '{':
		tile = json.loads(tile)

	# Strings refer to tiles in tilesets and are
	# definitely OK as long as they're not excessively long.
	if type(tile) == str:
		if len(tile) <= 32:
			return (True, None)
		else:
			return (False, 'Identifier too long')
	# If it's not a string it must be a dictionary
	if type(tile) != dict:
		return (False, 'Invalid type')

	if "pic" not in tile or len(tile["pic"]) != 3:
		return (False, 'No/invalid picture')

	return (True, None)

CLIENT_WHO_WHITELIST = {
	"typing": bool
}

def validate_client_who(id, data):
	validated_data = {"id": id}
	for key, value in data.items():
		if key in CLIENT_WHO_WHITELIST:
			validated_data[key] = CLIENT_WHO_WHITELIST[key](value)
	return validated_data

# -------------------------------------

def fn_MOV(self, client, arg):
	data = {'id': client.id}
	for valid_field in ('from', 'to', 'dir'):
		if valid_field in arg:
			data[valid_field] = arg[valid_field]
	self.broadcast("MOV", data, remote_category=botwatch_type['move'])

	newDir = data['dir'] if 'dir' in data else None
	if 'to' in data:
		client.moveTo(data['to'][0], data['to'][1], newDir=newDir)
	else:
		client.moveTo(None, None, newDir=newDir)		
handlers['MOV'] = fn_MOV

def fn_CMD(self, client, arg):
	handle_user_command(self, client, arg["text"])
handlers['CMD'] = fn_CMD

def fn_BAG(self, client, arg):
	if client.db_id != None:
		c = Database.cursor()
		if "create" in arg:
			# restrict type variable
			if arg['create']['type'] < 0 or arg['create']['type'] > 6:
				arg['create']['type'] = 0
			c.execute("INSERT INTO Asset_Info (creator, owner, name, type, regtime, flags) VALUES (?, ?, ?, ?, ?, ?)", (client.db_id, client.db_id, arg['create']['name'], arg['create']['type'], datetime.datetime.now(), 0))
			c.execute('SELECT last_insert_rowid()')
			client.send("BAG", {'update': {'id': c.fetchone()[0], 'name': arg['create']['name'], 'type': arg['create']['type']}})

		elif "clone" in arg:
			c.execute('SELECT name, desc, type, flags, creator, folder, data FROM Asset_Info WHERE owner=? AND aid=?', (client.db_id, arg['clone']))
			row = c.fetchone()
			if row == None:
				client.send("ERR", {'text': 'Invalid item ID'})
				return

			c.execute("INSERT INTO Asset_Info (name, desc, type, flags, creator, folder, data, owner, regtime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", \
			  (row[0], row[1], row[2], row[3], row[4], row[5], row[6], client.db_id, datetime.datetime.now()))
			c.execute('SELECT last_insert_rowid()')
			client.send("BAG", {'update': {'id': c.fetchone()[0], 'name': row[0], 'desc': row[1], 'type': row[2], 'flags': row[3], 'folder': row[5], 'data': row[6]}})

		elif "update" in arg:
			# get the initial data
			c.execute('SELECT name, desc, flags, folder, data, type FROM Asset_Info WHERE owner=? AND aid=?', (client.db_id, arg['update']['id']))
			result = c.fetchone()
			if result == None:
				client.send("ERR", {'text': 'Invalid item ID'})
				return
			out = {'name': result[0], 'desc': result[1], 'flags': result[2], 'folder': result[3], 'data': result[4]}
			asset_type = result[5]
			if asset_type == 2 and "data" in arg['update'] and not imageURLIsOkay(arg['update']['data']):
				client.send("ERR", {'text': 'Image asset URL doesn\'t match any whitelisted sites'})
				return
			if asset_type == 3 and "data" in arg['update']:
				tile_test = tileIsOkay(arg['update']['data'])
				if not tile_test[0]:
					client.send("ERR", {'text': 'Tile [tt]%s[/tt] rejected (%s)' % (arg['update']['data'], tile_test[1])})
					return

			# overwrite any specified columns
			for key, value in arg['update'].items():
				out[key] = value
				if type(out[key]) == dict:
					out[key] = json.dumps(out[key]);
			c.execute('UPDATE Asset_Info SET name=?, desc=?, flags=?, folder=?, data=? WHERE owner=? AND aid=?', (out['name'], out['desc'], out['flags'], out['folder'], out['data'], client.db_id, arg['update']['id']))

			# send back confirmation
			client.send("BAG", {'update': arg['update']})

		elif "delete" in arg:
			# move deleted contents of a deleted folder outside the folder
			c.execute('SELECT folder FROM Asset_Info WHERE owner=? AND aid=?', (client.db_id, arg['delete']))
			result = c.fetchone()
			if result == None:
				client.send("ERR", {'text': 'Invalid item ID'})
				return
			# probably better to handle this with a foreign key constraint and cascade?
			# it's NOT updated client-side but it shouldn't matter
			c.execute('UPDATE Asset_Info SET folder=? WHERE owner=? AND folder=?', (result[0], client.db_id, arg['delete']))

			# actually delete
			c.execute('DELETE FROM Asset_Info WHERE owner=? AND aid=?', (client.db_id, arg['delete']))
			client.send("BAG", {'remove': arg['delete']})
	else:
		client.send("ERR", {'text': 'Guests don\'t have an inventory currently. Use [tt]/register username password[/tt]'})
handlers['BAG'] = fn_BAG

def fn_EML(self, client, arg):
	if client.db_id != None:
		c = Database.cursor()
		if "send" in arg:
			# todo: definitely needs some limits in place to prevent abuse!

			# get a list of all the people to mail
			recipient_id = set([findDBIdByUsername(x) for x in arg['send']['to']])
			recipient_string = ','.join([str(x) for x in recipient_id])

			if any([x == None for x in recipient_id]):
				client.send("ERR", {'text': 'Couldn\'t find one or more users you wanted to mail'})
				return

			# let the client know who sent it, since the 'send' argument will get passed along directly
			arg['send']['from'] = client.username

			# send everyone their mail
			for id in recipient_id:
				if id == None:
					continue
				c.execute("INSERT INTO Mail (uid, sender, recipients, subject, contents, time, flags) VALUES (?, ?, ?, ?, ?, ?, ?)", (id, client.db_id, recipient_string, arg['send']['subject'], arg['send']['contents'], datetime.datetime.now(), 0))

				# is that person online? tell them!
				find = findClientByDBId(id)
				if find:
					arg['send']['id'] = c.execute('SELECT last_insert_rowid()').fetchone()[0]
					find.send("EML", {'receive': arg['send']})

			client.send("EML", {'sent': {'subject': arg['send']['subject']}}) #acknowledge
			client.send("MSG", {'text': 'Sent mail to %d users' % len(recipient_id)})

		elif "read" in arg:
			c.execute('UPDATE Mail SET flags=1 WHERE uid=? AND id=?', (client.db_id, arg['read']))
		elif "delete" in arg:
			c.execute('DELETE FROM Mail WHERE uid=? AND id=?', (client.db_id, arg['delete']))

	else:
		client.send("ERR", {'text': 'Guests don\'t have mail. Use [tt]/register username password[/tt]'})
handlers['EML'] = fn_EML

def fn_MSG(self, client, arg):
	text = arg["text"]
	self.broadcast("MSG", {'name': client.name, 'username': client.usernameOrId(), 'text': escapeTags(text)}, remote_category=botwatch_type['chat'])
handlers['MSG'] = fn_MSG

def fn_TSD(self, client, arg):
	c = Database.cursor()
	c.execute('SELECT data FROM Asset_Info WHERE type=4 AND aid=?', (arg['id'],))
	result = c.fetchone()
	if result == None:
		client.send("ERR", {'text': 'Invalid item ID'})
	else:
		client.send("TSD", {'id': arg['id'], 'data': result[0]})
handlers['TSD'] = fn_TSD

def fn_IMG(self, client, arg):
	c = Database.cursor()
	c.execute('SELECT data FROM Asset_Info WHERE type=2 AND aid=?', (arg['id'],))
	result = c.fetchone()
	if result == None:
		client.send("ERR", {'text': 'Invalid item ID'})
	else:
		client.send("IMG", {'id': arg['id'], 'url': result[0]})
handlers['IMG'] = fn_IMG

def fn_MAI(self, client, arg):
	send_all_info = client.mustBeOwner(True, giveError=False)
	client.send("MAI", self.map.map_info(all_info=send_all_info))
handlers['MAI'] = fn_MAI

def fn_DEL(self, client, arg):
	x1 = arg["pos"][0]
	y1 = arg["pos"][1]
	x2 = arg["pos"][2]
	y2 = arg["pos"][3]
	if self.has_permission(client, permission['build'], True) or client.mustBeOwner(True, giveError=False):
		for x in range(x1, x2+1):
			for y in range(y1, y2+1):
				if arg["turf"]:
					self.turfs[x][y] = None;
				if arg["obj"]:
					self.objs[x][y] = None;
		self.broadcast("MAP", self.map_section(x1, y1, x2, y2))

		# make username available to listeners
		arg['username'] = client.usernameOrId()
		self.broadcast("DEL", arg, remote_only=True, remote_category=botwatch_type['build'])
	else:
		client.send("MAP", self.map_section(x1, y1, x2, y2))
		client.send("ERR", {'text': 'Building is disabled on this map'})
handlers['DEL'] = fn_DEL

def fn_PUT(self, client, arg):
	def notify_listeners():
		# make username available to listeners
		arg['username'] = client.usernameOrId()
		self.broadcast("PUT", arg, remote_only=True, remote_category=botwatch_type['build'])

	x = arg["pos"][0]
	y = arg["pos"][1]
	if self.has_permission(client, permission['build'], True) or client.mustBeOwner(True, giveError=False):
		# verify the the tiles you're attempting to put down are actually good
		if arg["obj"]: #object
			tile_test = [tileIsOkay(x) for x in arg["atom"]]
			if all(x[0] for x in tile_test): # all tiles pass the test
				self.objs[x][y] = arg["atom"]
				self.broadcast("MAP", self.map_section(x, y, x, y))
				notify_listeners()
			else:
				# todo: give a reason?
				client.send("MAP", self.map_section(x, y, x, y))
				client.send("ERR", {'text': 'Placed objects rejected'})
		else: #turf
			tile_test = tileIsOkay(arg["atom"])
			if tile_test[0]:
				self.turfs[x][y] = arg["atom"]
				self.broadcast("MAP", self.map_section(x, y, x, y))
				notify_listeners()
			else:
				client.send("MAP", self.map_section(x, y, x, y))
				client.send("ERR", {'text': 'Tile [tt]%s[/tt] rejected (%s)' % (arg["atom"], tile_test[1])})
	else:
		client.send("MAP", self.map_section(x, y, x, y))
		client.send("ERR", {'text': 'Building is disabled on this map'})
handlers['PUT'] = fn_PUT

def fn_BLK(self, client, arg):
	if self.has_permission(client, permission['bulk_build'], False) or client.mustBeOwner(True, giveError=False):
		# verify the tiles
		for turf in arg["turf"]:
			if not tileIsOkay(turf[2])[0]:
				client.send("ERR", {'text': 'Bad turf in bulk build'})
				return
		for obj in arg["obj"]:
			tile_test = [tileIsOkay(x) for x in obj[2]]
			if any(not x[0] for x in tile_test): # any tiles don't pass the test
				client.send("ERR", {'text': 'Bad obj in bulk build'})
				return
		# make username available to other clients
		arg['username'] = client.usernameOrId()

		# place the tiles
		for turf in arg["turf"]:
			x = turf[0]
			y = turf[1]
			a = turf[2]
			width = 1
			height = 1
			if len(turf) == 5:
				width = turf[3]
				height = turf[4]
			for w in range(0, width):
				for h in range(0, height):
					self.turfs[x+w][y+h] = a
		# place the object lists
		for obj in arg["obj"]:
			x = obj[0]
			y = obj[1]
			a = obj[2]
			width = 1
			height = 1
			if len(turf) == 5:
				width = turf[3]
				height = turf[4]
			for w in range(0, width):
				for h in range(0, height):
					self.objs[x+w][y+h] = a
		self.broadcast("BLK", arg, remote_category=botwatch_type['build'])
	else:
		client.send("ERR", {'text': 'Bulk building is disabled on this map'})
handlers['BLK'] = fn_BLK

def fn_WHO(self, client, arg):
	if arg["update"]:
		valid_data = validate_client_who(client.id, arg["update"])
		for key,value in valid_data.items():
			setattr(client,key,value)
		client.map.broadcast("WHO", {"update": valid_data})
	else:
		client.send("ERR", {'text': 'not implemented'})
handlers['WHO'] = fn_WHO

# -------------------------------------

def handle_protocol_command(self, client, command, arg):
	# Attempt to run the command handler if it exists
	if command in handlers:
		return handlers[command](self, client, arg)
	else:
		client.send("ERR", {'text': 'Bad protocol command: %s' % command})
