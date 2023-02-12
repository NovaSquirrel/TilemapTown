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

import sqlite3, json, sys, os.path, weakref

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

# Read server resource file
ServerResources = {}
LoadedAnyServerResources = False

if "ResourceFiles" in Config["Server"]:
	for fn in Config["Server"]["ResourceFiles"]:
		if os.path.isfile(fn):
			with open(fn) as f:
				LoadedAnyServerResources = True
				for key,value in json.load(f).items():
					if key not in ServerResources:
						ServerResources[key] = {}
					ServerResources[key].update(value)
		else:
			print("Server resources file '%s' doesn't exist" % fn)

	# Fix up images to have the image base, if it's provided
	if "ResourceIMGBase" in Config["Server"] and "images" in ServerResources:
		base = Config["Server"]["ResourceIMGBase"]
		for i in ServerResources["images"]:
			url = ServerResources["images"][i]
			if not url.startswith("http://") and not url.startswith("https://"):
				ServerResources["images"][i] = base + url

# Open database connection
Database = sqlite3.connect(Config["Database"]["File"], detect_types=sqlite3.PARSE_DECLTYPES|sqlite3.PARSE_COLNAMES)
DatabaseMeta = {}

# Important information shared by each module
ServerShutdown = [-1]
AllClients      = set()
AllMaps         = weakref.WeakSet()             # Maps only; used by /whereare
AllEntitiesByDB = weakref.WeakValueDictionary() # All entities (indexed by database ID)
AllEntitiesByID = weakref.WeakValueDictionary() # All entities (indexed by temporary ID)

# Remote map-watching for bots
botwatch_type = {}
botwatch_type['move']  = 0
botwatch_type['build'] = 1
botwatch_type['entry'] = 2
botwatch_type['chat']  = 3
BotWatch = [{}, {}, {}, {}] # Indexed by client.db_id

# Map permissions
permission = {}
permission['entry']                   = 0x0001 # user can visit the map
permission['build']                   = 0x0002 # user can build on the map
permission['sandbox']                 = 0x0004 # users can delete any part of the map freely
permission['admin']                   = 0x0008 # user is an admin on the map
permission['copy']                    = 0x0010 # user can make copies of this object
permission['map_bot']                 = 0x0020 # user is given bot-related permissions
permission['move']                    = 0x0040 # user can move this object around within the same container
permission['move_new_map']            = 0x0080 # user can move this object to a new map
permission['bulk_build']              = 0x0100 # user can use the builk building protocol commands
permission['object_entry']            = 0x0200 # user can bring non-client entities here
permission['persistent_object_entry'] = 0x0400 # user can bring non-client entities here persistently (will kick clients out when unloading if not true)
permission['modify_properties']       = 0x0800 # user can modify the properties of this entity
permission['remote_command']          = 0x1000 # user can make this entity do arbitrary commands
permission['modify_appearance']       = 0x2000 # user can modify visual properties, like picture or description
permission['list_contents']           = 0x4000 # user can look at the contents of this entity
permission['all']                     = 0xffffffff # future proofing!

def permission_list_from_bitfield(bitfield):
	return [key for key in permission if ((permission[key] & bitfield) and (permission[key].bit_count() == 1))]

def bitfield_from_permission_list(permission_list):
	out = 0
	for p in permission_list:
		if p in permission:
			out |= permission[p]
	return out

# Map flags
mapflag = {}
mapflag['public'] = 1

# Entity types
entity_type = {}
entity_type['user'] = 1
entity_type['map'] = 2
entity_type['group'] = 3
entity_type['text'] = 4
entity_type['image'] = 5
entity_type['map_tile'] = 6
entity_type['tileset'] = 7
entity_type['reference'] = 8
entity_type['folder'] = 9
entity_type['landmark'] = 10
entity_type['generic'] = 11

# Make the reverse - put in the value, get the name
entity_type_name = {}
for k,v in entity_type.items():
	entity_type_name[v] = k

# User privilege levels, for commands and protocol messages
user_privilege = {}
user_privilege['guest'] = 0
user_privilege['registered'] = 1
user_privilege['map_admin'] = 2
user_privilege['map_owner'] = 3
user_privilege['server_admin'] = 4

# Used to mark IDs as being temporary, rather than being in the database
temporary_id_marker = "~"
# Used to mark IDs that belong to server-defined global entities (GLOBAL_ENTITY_KEY table)
global_entity_marker = "!"

creatable_entity_types = ('text', 'image', 'map_tile', 'tileset', 'reference', 'folder', 'landmark', 'generic')

# Important shared functions
def broadcast_to_all(text):
	for u in AllClients:
		u.send("MSG", {'text': text, 'class': 'broadcast_message'})

def find_client_by_db_id(id, inside=None):
	for u in inside or AllClients:
		if id == u.db_id:
			return u
	return None

def find_client_by_username(username, inside=None):
	username = username.lower()
	for u in inside or AllClients:
		if username == u.username or (username.isnumeric() and int(username) == u.id):
			return u
	return None

def find_username_by_db_id(dbid):
	c = Database.cursor()
	c.execute('SELECT username FROM User WHERE entity_id=?', (dbid,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def find_db_id_by_username(username):
	c = Database.cursor()
	username = str(username).lower()
	c.execute('SELECT entity_id FROM User WHERE username=?', (username,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def get_entity_type_by_db_id(id):
	c = Database.cursor()
	c.execute('SELECT type FROM Entity WHERE id=?', (id,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def get_entity_by_id(id, load_from_db=True):
	# If it's temporary, get it if it still exists
	if isinstance(id, str):
		if isinstance(id, str) and id[0] == temporary_id_marker and id[1:].isnumeric():
			id = int(id[1:])
			if id in AllEntitiesByID:
				return AllEntitiesByID[id]
			return None

		# Can use a global entity ID; look up what the actual entity ID is
		elif id[0] == global_entity_marker:
			global_key = id[1:]

			c = Database.cursor()
			c.execute('SELECT entity_id FROM Global_Entity_Key WHERE key=?', (global_key,))
			result = c.fetchone()
			if result == None:
				return None
			id = result[0]

		elif id.startswith('user:'):
			id = find_db_id_by_username(id[5:])

		elif isinstance(id, str) and id.isnumeric():
			id = int(id)

	# Fetch it from RAM if it's already loaded from the database
	if id in AllEntitiesByDB:
		return AllEntitiesByDB[id]

	if not load_from_db:
		return None

	# If it's not already loaded, attempt to load it from the database

	t = get_entity_type_by_db_id(id)
	if t == None:
		# Doesn't exist in the database
		return None
	if t == entity_type['user']:
		# Can't load users by ID
		return None
	if t == entity_type['map']:
		e = Map()
		if e.load(id):
			return e
		return None

	# Generic entity
	e = Entity(t)
	if e.load(id):
		return e

	return None

def filter_username(text):
	return ''.join([i for i in text if (i.isalnum() or i == '_')]).lower()

def image_url_is_okay(url):
	for w in Config["Images"]["URLWhitelist"]:
		if url.startswith(w):
			return True
	return False

def pic_is_okay(pic):
	if not isinstance(pic, list) and not isinstance(pic, tuple):
		return False
	if len(pic) != 3:
		return False
	if isinstance(pic[0], str):
		return image_url_is_okay(pic[0])
	return True

def valid_id_format(id):
	return isinstance(id, int) or id.isnumeric() or ((id.startswith(temporary_id_marker) or id.startswith(global_entity_marker)) and id[1:].isnumeric() or id.startswith('user:'))

def dumps_if_not_none(dump_me):
	if dump_me != None:
		return json.dumps(dump_me)
	return None

def dumps_if_not_empty(dump_me):
	if dump_me != None and len(dump_me):
		return json.dumps(dump_me)
	return None

def dumps_if_condition(dump_me, condition):
	if condition:
		return json.dumps(dump_me)
	return None

def loads_if_not_none(load_me):
	if load_me != None:
		return json.loads(load_me)
	return None

def get_database_meta(key, default=None):
	if key in DatabaseMeta:
		return DatabaseMeta[key]
	return default

def set_database_meta(key, value):
	c = Database.cursor()
	# Use the "flags" variable to indicate that it's an integer, not text
	flags = int(isinstance(value, int))

	if key not in DatabaseMeta:
		c.execute("INSERT INTO Meta (item, value, flags) VALUES (?, ?, ?)", (key, value, flags))
	elif DatabaseMeta[key] == value: # Already correct
		return
	else:
		c.execute("UPDATE Meta SET value=?, flags=? WHERE item=?", (value, flags, key,))
	DatabaseMeta[key] = value
	Database.commit()

def reload_database_meta():
	c = Database.cursor()
	for row in c.execute('SELECT item, value, flags FROM Meta'):
		v = row[1]
		# If the flag is set, it's an integer, not text
		if row[2] & 1:
			v = int(v)
		DatabaseMeta[row[0]] = v

from .buildentity import Entity
from .buildmap import Map
