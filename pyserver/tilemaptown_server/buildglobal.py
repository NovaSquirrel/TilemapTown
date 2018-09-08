# Tilemap Town
# Copyright (C) 2017-2018 NovaSquirrel
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
setConfigDefault("Database", "File",             "town.db")

# Important information shared by each module
ServerShutdown = [-1]
AllClients = set()
AllMaps = set()

def mapIdExists(id):
	for m in AllMaps:
		if m.id == id:
			return True
	return os.path.isfile("maps/"+str(id)+".txt")

# Important shared functions
def broadcastToAll(text):
	for u in AllClients:
		u.send("MSG", {'text': text, 'class': 'broadcast_message'})

def findClientByUsername(username, inside=None):
	username = username.lower()
	for u in inside or AllClients:
		if username == u.username or (username.isnumeric() and int(username) == u.id):
			return u
	return None

def filterUsername(text):
	return ''.join([i for i in text if (i.isalnum() or i == '_')]).lower()

from .buildmap import Map

def getMapById(mapId):
	for m in AllMaps:
		if m.id == mapId:
			return m
	# Map not found, so load it
	m = Map()
	m.load(mapId)
	AllMaps.add(m)
	return m
