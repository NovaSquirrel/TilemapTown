# Tilemap Town
# Copyright (C) 2017 NovaSquirrel
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

ServerShutdown = False
AllClients = set()
AllMaps = set()

import os.path
def mapIdExists(id):
	return os.path.isfile("maps/"+str(id)+".txt")

def findClientByUsername(username):
	username = username.lower()
	for u in AllClients:
		if username == u.username or (username.isnumeric() and int(username) == u.id):
			return u
	return None

def filterUsername(text):
	return ''.join([i for i in text if (i.isalnum() or i == '_')]).lower()

from buildmap import *

MainMap = Map()
MainMap.load(0)
AllMaps.add(MainMap)

def getMapById(mapId):
	for m in AllMaps:
		if m.id == mapId:
			return m
	m = Map()
	m.load(mapId)
	AllMaps.add(m)
	return m
