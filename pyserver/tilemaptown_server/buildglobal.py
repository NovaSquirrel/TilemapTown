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

import sqlite3, json, sys, os.path

# Read configuration information
Config = {}
ConfigFile = 'config.json'
# Override the config filename as a command line argument
if len(sys.argv) >= 2:
	ConfigFile = sys.argv[1]

if os.path.isfile(ConfigFile):
	with open(ConfigFile) as f:
		Config = json.load(f)
else:
	print("Config file '%s' doesn't exist, using defaults" % ConfigFile)

# Initialize in defaults for any undefined values
def setConfigDefault(group, item, value):
	if group not in Config:
		Config[group] = {}
	if item not in Config[group]:
		Config[group][item] = value

# Set defaults for config items
setConfigDefault("Server",   "AlwaysLoadedMaps", [])
setConfigDefault("Server",   "Port",             12550)
setConfigDefault("Server",   "Name",             "Tilemap Town")
setConfigDefault("Server",   "MOTD",             "")
setConfigDefault("Server",   "Admins",           [])
setConfigDefault("Server",   "MaxUsers",         200)
setConfigDefault("Server",   "MaxDBMaps",        5000)
setConfigDefault("Server",   "WSMaxSize",        0x8000)
setConfigDefault("Server",   "WSMaxQueue",       32)
setConfigDefault("Database", "File",             "town.db")
setConfigDefault("Database", "Setup",            True)
setConfigDefault("Images",   "URLWhitelist",     ["https://i.imgur.com/"])

# Open database connection
Database = sqlite3.connect(Config["Database"]["File"], detect_types=sqlite3.PARSE_DECLTYPES|sqlite3.PARSE_COLNAMES)

# Important information shared by each module
ServerShutdown = [-1]
AllClients = set()
AllMaps = set()

# Remote map-watching for bots
botwatch_type = {}
botwatch_type['move']  = 0
botwatch_type['build'] = 1
botwatch_type['entry'] = 2
botwatch_type['chat']  = 3
BotWatch = [{}, {}, {}, {}]

# Map permissions
permission = {}
permission['entry'] = 1         # user can visit the map
permission['build'] = 2         # user can build on the map
permission['sandbox'] = 4       # users can delete any part of the map freely
permission['admin'] = 8         # user is an admin on the map
permission['bulk_build'] = 16   # user can use the builk building protocol commands
permission['map_bot'] = 32      # user is given bot-related permissions

# Map flags
mapflag = {}
mapflag['public'] = 1

def mapIdExists(id):
	for m in AllMaps:
		if m.id == id:
			return True
	c = Database.cursor()
	c.execute('SELECT mid FROM Map WHERE mid=?', (id,))
	result = c.fetchone()
	return result != None

# Important shared functions
def broadcastToAll(text):
	for u in AllClients:
		u.send("MSG", {'text': text, 'class': 'broadcast_message'})

def findClientByDBId(id, inside=None):
	for u in inside or AllClients:
		if id == u.db_id:
			return u
	return None

def findClientByUsername(username, inside=None):
	username = username.lower()
	for u in inside or AllClients:
		if username == u.username or (username.isnumeric() and int(username) == u.id):
			return u
	return None

def findUsernameByDBId(dbid):
	c = Database.cursor()
	c.execute('SELECT username FROM User WHERE uid=?', (dbid,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def findDBIdByUsername(username):
	c = Database.cursor()
	username = str(username).lower()
	c.execute('SELECT uid FROM User WHERE username=?', (username,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def filterUsername(text):
	return ''.join([i for i in text if (i.isalnum() or i == '_')]).lower()

def getMapById(mapId):
	for m in AllMaps:
		if m.id == mapId:
			return m
	# Map not found, so load it
	m = Map()
	m.load(mapId)
	AllMaps.add(m)
	return m

def imageURLIsOkay(url):
	for w in Config["Images"]["URLWhitelist"]:
		if url.startswith(w):
			return True
	return False

from .buildmap import Map
