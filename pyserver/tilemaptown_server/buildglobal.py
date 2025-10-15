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

import sqlite3, json, sys, os.path, weakref, datetime, zlib, re
from collections import deque

# Config information
Config = {}
ConfigFile = 'config.json'
ServerResources = {}
LoadedAnyServerResources = [False]
TempLogs = [None, None, None, None] # Connect, Build, Upload, Rollback info

# Information about the code itself
available_server_features = {
	"see_past_map_edge": {"version": "0.0.1", "minimum_version": "0.0.1"},
	"batch": {"version": "0.0.1", "minimum_version": "0.0.1"},
	"receive_build_messages": {"version": "0.0.1", "minimum_version": "0.0.1"},
	"entity_message_forwarding": {"version": "0.0.1", "minimum_version": "0.0.1"},
	"user_watch_with_who": {"version": "0.0.1", "minimum_version": "0.0.1"},
	"message_acknowledgement": {"version": "0.0.1", "minimum_version": "0.0.1"},
}
server_software_name = "Tilemap Town server"
server_software_version = "0.2.0"
server_software_code = "https://github.com/NovaSquirrel/TilemapTown"
server_version_dict = {'name': server_software_name, 'version': server_software_version, 'code': server_software_code, 'features': available_server_features}

# Override the config filename as a command line argument
if len(sys.argv) >= 2:
	ConfigFile = sys.argv[1]

# Initialize in defaults for any undefined values
def setConfigDefault(group, item, value):
	if group not in Config:
		Config[group] = {}
	if item not in Config[group]:
		Config[group][item] = value

def loadConfigJson(clearLogs=True):
	if os.path.isfile(ConfigFile):
		with open(ConfigFile) as f:
			try:
				j = json.load(f)
				Config.clear()
				Config.update(j)
			except:
				print("Bad config file!")
	else:
		print("Config file '%s' doesn't exist, using defaults" % ConfigFile)

	# Set defaults for config items
	setConfigDefault("Server",   "Port",             12550)
	setConfigDefault("Server",   "Name",             "Tilemap Town")
	setConfigDefault("Server",   "MOTD",             "")
	setConfigDefault("Server",   "Admins",           [])
	setConfigDefault("Server",   "MaxUsers",         200)
	setConfigDefault("Server",   "MaxDBMaps",        5000)
	setConfigDefault("Server",   "WSMaxSize",        0x40000) # 256K
	setConfigDefault("Server",   "WSMaxQueue",       32)
	setConfigDefault("Server",   "BroadcastConnects", True)
	setConfigDefault("Server",   "BroadcastDisconnects", True)
	setConfigDefault("Server",   "MaxMapSize",       256)
	setConfigDefault("Server",   "TempMapCopiesPerUser", 10)

	setConfigDefault("Security", "ProxyOnly",        False)
	setConfigDefault("Security", "AllowedOrigins",   None)
	setConfigDefault("Security", "AllowedOrigins2",  None)
	setConfigDefault("Security", "BannedOrigins",    None)
	setConfigDefault("Security", "DefaultBuildingPermission",  0)
	setConfigDefault("Security", "TrustedOnlyBuilding",        0)
	setConfigDefault("Security", "TrustedOnlyMapCreation",     1)
	setConfigDefault("Security", "NoGuests",         False)
	setConfigDefault("Security", "NoRegistration",   False)
	setConfigDefault("Security", "MaxRegistrationsPerIP", 3)
	setConfigDefault("Security", "MaxConnectionsPerIP", 10)

	setConfigDefault("RateLimit", "MSG",             True)
	setConfigDefault("RateLimit", "MSG1",            10)
	setConfigDefault("RateLimit", "MSG5",            50)
	setConfigDefault("RateLimit", "PRI",             True)
	setConfigDefault("RateLimit", "PRI1",            10)
	setConfigDefault("RateLimit", "PRI5",            50)
	setConfigDefault("RateLimit", "MiniTilemap",     True)
	setConfigDefault("RateLimit", "WhoUpdate",       True)
	setConfigDefault("RateLimit", "ScriptCommand",   True)
	setConfigDefault("RateLimit", "ScriptBotMessageButton", True)
	setConfigDefault("RateLimit", "ScriptTakeControls", True)
	setConfigDefault("RateLimit", "ScriptMove",      True)
	setConfigDefault("RateLimit", "ScriptCompile",   True)

	setConfigDefault("MaxProtocolSize", "Default", 32768)
	setConfigDefault("MaxProtocolSize", "Chat",    8192)
	setConfigDefault("MaxProtocolSize", "Private", 8192)
	setConfigDefault("MaxProtocolSize", "Command", 32768)
	#setConfigDefault("MaxProtocolSize", "MOV", 32768)
	#setConfigDefault("MaxProtocolSize", "CMD", 32768)
	#setConfigDefault("MaxProtocolSize", "PRI", 32768)
	#setConfigDefault("MaxProtocolSize", "BAG", 32768)
	#setConfigDefault("MaxProtocolSize", "EML", 32768)
	#setConfigDefault("MaxProtocolSize", "MSG", 32768)
	setConfigDefault("MaxProtocolSize", "TSD", 512)
	setConfigDefault("MaxProtocolSize", "IMG", 512)
	setConfigDefault("MaxProtocolSize", "MAI", 512)
	setConfigDefault("MaxProtocolSize", "MAP", 512)
	setConfigDefault("MaxProtocolSize", "DEL", 1024)
	setConfigDefault("MaxProtocolSize", "PUT", 2048)
	setConfigDefault("MaxProtocolSize", "BLK", 8192)
	setConfigDefault("MaxProtocolSize", "WHO", 2048)
	setConfigDefault("MaxProtocolSize", "PIN", 512)
	#setConfigDefault("MaxProtocolSize", "VER", 32768)
	#setConfigDefault("MaxProtocolSize", "IDN", 32768)
	setConfigDefault("MaxProtocolSize", "USE", 512)
	#setConfigDefault("MaxProtocolSize", "EXT", 32768)

	setConfigDefault("API",      "Port",             12551)
	setConfigDefault("API",      "Enabled",          True)
	setConfigDefault("API",      "URL",              "")
	setConfigDefault("API",      "AdminPassword",    "")

	setConfigDefault("Scripting","Enabled",          False)
	setConfigDefault("Scripting","ProgramPath",      None)
	setConfigDefault("Scripting","DataStorageLimit", 0x8000)

	setConfigDefault("Database", "File",             "town.db")
	setConfigDefault("Database", "Setup",            True)
	setConfigDefault("Images",   "URLWhitelist",     ["https://file.garden/", "https://i.postimg.cc/", "https://i.ibb.co/"])
	setConfigDefault("Logs",     "ConnectFile",      "")
	setConfigDefault("Logs",     "BuildFile",        "")
	setConfigDefault("Logs",     "UploadFile",       "")
	setConfigDefault("Logs",     "BuildDefault",     True)
	setConfigDefault("TempLogs", "ConnectSize",      200)
	setConfigDefault("TempLogs", "BuildSize",        100)
	setConfigDefault("TempLogs", "UploadSize",       100)
	setConfigDefault("TempLogs", "RollbackSize",     30)
	setConfigDefault("TempLogs", "RollbackItemsSize", 15000)

	setConfigDefault("FileUpload", "Enabled",        False)
	setConfigDefault("FileUpload", "URLPrefix",      "")
	setConfigDefault("FileUpload", "StoragePath",    "")
	setConfigDefault("FileUpload", "MaximumFileSize",      512)
	setConfigDefault("FileUpload", "SizeLimitTotal",       102400)
	setConfigDefault("FileUpload", "SizeLimitGuest",       0)
	setConfigDefault("FileUpload", "SizeLimitUser",        128)
	setConfigDefault("FileUpload", "SizeLimitTrustedUser", 5120)
	setConfigDefault("FileUpload", "SizeLimitOverride",    {})
	setConfigDefault("FileUpload", "AllowedFileCount",     100)
	setConfigDefault("FileUpload", "AllowedFolderCount",   100)
	setConfigDefault("FileUpload", "AllowCrossOrigin",     False)

	LoadedAnyServerResources[0] = False
	ServerResources.clear()

	if "ResourceFiles" in Config["Server"]:
		for fn in Config["Server"]["ResourceFiles"]:
			if os.path.isfile(fn):
				with open(fn) as f:
					LoadedAnyServerResources[0] = True
					for key,value in json.load(f).items():
						if key not in ServerResources:
							ServerResources[key] = {}

						if key == 'tilesets':
							for tileset in value:
								if tileset not in ServerResources['tilesets']:
									ServerResources['tilesets'][tileset] = {}
								ServerResources['tilesets'][tileset].update(value[tileset])
						else:
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
		if "ResourceIMGBase" in Config["Server"] and "sample_avatars" in ServerResources:
			base = Config["Server"]["ResourceIMGBase"]
			for i in ServerResources["sample_avatars"]:
				url = ServerResources["sample_avatars"][i]
				if not url.startswith("http://") and not url.startswith("https://"):
					ServerResources["sample_avatars"][i] = base + url
	if clearLogs:
		TempLogs[0] = deque(maxlen=Config["TempLogs"]["ConnectSize"])
		TempLogs[1] = deque(maxlen=Config["TempLogs"]["BuildSize"])
		TempLogs[2] = deque(maxlen=Config["TempLogs"]["UploadSize"])
		TempLogs[3] = deque(maxlen=Config["TempLogs"]["RollbackSize"])
loadConfigJson()
GlobalData = {}

# Open database connection
Database = sqlite3.connect(Config["Database"]["File"], detect_types=sqlite3.PARSE_DECLTYPES|sqlite3.PARSE_COLNAMES)
DatabaseMeta = {}

# Open logs
ConnectLog = None
if len(Config["Logs"]["ConnectFile"]):
	ConnectLog = open(Config["Logs"]["ConnectFile"], 'a', encoding="utf-8")
BuildLog = None
if len(Config["Logs"]["BuildFile"]):
	BuildLog = open(Config["Logs"]["BuildFile"], 'a', encoding="utf-8")
UploadLog = None
if len(Config["Logs"]["UploadFile"]):
	UploadLog = open(Config["Logs"]["UploadFile"], 'a', encoding="utf-8")

# Temporary log for moderation
def write_to_connect_log(text):
	print(text)
	now = datetime.datetime.today().strftime("(%Y-%m-%d) %I:%M %p")
	text = now + ": " + text
	TempLogs[0].append(text)
	if ConnectLog:
		ConnectLog.write(text + "\n")

# Important information shared by each module
ServerShutdown = [-1, False] # First value is seconds left, second value is true for restarts but false for shutdowns
AllClients      = weakref.WeakSet()             # All connections curently in the world
AllConnections  = weakref.WeakSet()             # All connections, regardless of if they're in the world
AllMaps         = weakref.WeakSet()             # Maps only; used by /whereare
AllEntitiesByDB = weakref.WeakValueDictionary() # All entities (indexed by database ID)
AllEntitiesByID = weakref.WeakValueDictionary() # All entities (indexed by temporary ID)
AllEntitiesWithRequests = weakref.WeakSet()     # All entities with active requests
AllEntitiesWithRateLimiting = weakref.WeakSet() # All entities with rate limiting information
ConnectionsByUsername = weakref.WeakValueDictionary() # Look up connections by lowercased username
ConnectionsByApiKey = weakref.WeakValueDictionary() # Look up connections by API key (supplied to clients in IDN)
OfflineMessages = {} # OfflineMessages[recipient_id][sender_id][index]
AcknowlegeRequestResult = {} # For implementing idempotency

# Remote map-watching for bots (and remote chat)
maplisten_type = {}
maplisten_type['move']  = 0
maplisten_type['build'] = 1
maplisten_type['entry'] = 2
maplisten_type['chat']  = 3       # Listen to MSG
maplisten_type['chat_listen'] = 4 # Listen to chat listens/unlistens

maplisten_type_name = {}
for k,v in maplisten_type.items():
	maplisten_type_name[v] = k

MapListens = [{}, {}, {}, {}, {}] # Key:Map ID, Value: A WeakSet of Connection objects

# Entity permissions
permission = {}                                    # (subject type)
permission['entry']                   = 0x00000001 # (map) user can visit the map
permission['build']                   = 0x00000002 # (map) user can build on the map
permission['sandbox']                 = 0x00000004 # (map) users can delete any part of the map freely
permission['admin']                   = 0x00000008 # (all) user is an admin on the map (also allows grant/revoke)
permission['copy']                    = 0x00000010 # (all) user can make copies of this object
permission['map_bot']                 = 0x00000020 # (all) user is given bot-related permissions
permission['move']                    = 0x00000040 # (all) user can move this object around within the same container
permission['move_new_map']            = 0x00000080 # (all) user can move this object to a new map
permission['bulk_build']              = 0x00000100 # (map) user can use the builk building protocol commands
permission['object_entry']            = 0x00000200 # (all) user can bring non-client entities here
permission['persistent_object_entry'] = 0x00000400 # (all) user can bring non-client entities here persistently (will kick clients out when unloading if not true)
permission['modify_properties']       = 0x00000800 # (all) user can modify the properties of this entity
permission['remote_command']          = 0x00001000 # (all) user can make this entity do arbitrary commands
permission['modify_appearance']       = 0x00002000 # (all) user can modify visual properties, like picture or description
permission['list_contents']           = 0x00004000 # (all) user can look at the contents of this entity
permission['set_owner_to_this']       = 0x00008000 # (all) user can set change the owner of any of their entities to this entity
permission['set_topic']               = 0x00010000 # (map) user can set the map's discussion topic
permission['remote_chat']             = 0x00020000 # (all) user is allowed to send chat to this entity, and listen to chat in this entity
                                    # = 0x00040000
                                    # = 0x00080000
                                    # = 0x00100000
                                    # = 0x00200000
                                    # = 0x00400000
                                    # = 0x00800000
                                    # = 0x01000000
                                    # = 0x02000000
                                    # = 0x04000000
# Permissions at the end are more meant for temporary use, and may be moved later
permission['minigame']                = 0x80000000 # (user) entity can capture this user's controls, and control their minigame hotbar
permission['all']                     = 0xffffffff # future proofing!

def permission_list_from_bitfield(bitfield):
	return [key for key in permission if ((permission[key] & bitfield) and (permission[key].bit_count() == 1))]

def bitfield_from_permission_list(permission_list):
	out = 0
	for p in permission_list:
		if p in permission:
			out |= permission[p]
	return out

# Generic entity flags
entityflag = {}
entityflag['public'] = 1

# Map flags
mapflag = {}
mapflag['public'] = 1
mapflag['build_logs'] = 2
mapflag['no_build_logs'] = 4

# User flags
userflag = {}
userflag['bot']             = 0x00000001 # Is a bot
userflag['file_uploads']    = 0x00000002 # Larger file upload limits
userflag['no_build_logs']   = 0x00000004 # Don't log when this user builds
userflag['hide_location']   = 0x00000008 # Don't show in /whereare and such
userflag['hide_api']        = 0x00000010 # Don't show in API
userflag['no_watch']        = 0x00000020 # Don't allow other users to have you on their watch list
userflag['secret_pic']      = 0x00000040 # Hide your pic from remote view
userflag['trusted_builder'] = 0x00000080 # User can still build when building is locked down
userflag['scripter']        = 0x00000100 # User can use server-side scripting
userflag['no_login']        = 0x80000000 # Account can't be logged into

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
entity_type['chatroom'] = 12
entity_type['gadget'] = 13
entity_type['client_data'] = 14

# Make the reverse - put in the value, get the name
entity_type_name = {}
for k,v in entity_type.items():
	entity_type_name[v] = k

# User privilege levels, for commands and protocol messages
user_privilege = {}
user_privilege['guest'] = 0
user_privilege['no_scripts'] = 1
user_privilege['registered'] = 2
user_privilege['map_admin'] = 3
user_privilege['map_owner'] = 4
user_privilege['server_admin'] = 5

# Used to mark IDs as being temporary, rather than being in the database
temporary_id_marker = "~"
# Used to mark IDs that belong to server-defined global entities (GLOBAL_ENTITY_KEY table)
global_entity_marker = "!"

creatable_entity_types = ('text', 'image', 'map_tile', 'tileset', 'reference', 'folder', 'landmark', 'generic', 'chatroom', 'gadget', 'client_data')

# Important shared functions
def is_entity(e):
	return isinstance(e, Entity)

def is_client_and_entity(e):
	return isinstance(e, Entity) and e.is_client()

def broadcast_to_all(text):
	for u in AllConnections:
		u.send("MSG", {'text': text, 'class': 'broadcast_message'})

def find_client_by_db_id(id, inside=None):
	for u in inside or AllClients:
		if id == u.db_id:
			return u
	return None

def find_client_by_username(username, inside=None):
	if valid_id_format(username):
		return get_entity_by_id(username, load_from_db=False)
	username = username.lower()
	for u in inside or AllClients:
		if not u.is_client():
			continue
		if username == u.username:
			return u
	return None

def find_connection_by_username(username):
	if valid_id_format(username):
		e = get_entity_by_id(username, load_from_db=False)
		if e != None and hasattr(e, "connection"):
			return e.connection()
		return None
	return ConnectionsByUsername.get(username.lower(), None)

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

def get_entity_name_by_db_id(id):
	c = Database.cursor()
	c.execute('SELECT name FROM Entity WHERE id=?', (id,))
	result = c.fetchone()
	if result == None:
		return None
	return result[0]

def find_db_id_by_str(id): # Generic; recognize and handle different prefixes
	# Can use a global entity ID; look up what the actual entity ID is
	if id[0] == global_entity_marker:
		c = Database.cursor()
		c.execute('SELECT entity_id FROM Global_Entity_Key WHERE key=?', (id[1:],))
		result = c.fetchone()
		if result == None:
			return None
		return result[0]
	elif id.startswith('user:'):
		return find_db_id_by_username(id[5:])
	elif isinstance(id, str) and id.isdecimal():
		return int(id)
	return None

def entity_id_exists(id):
	if not valid_id_format(id):
		return False

	# Replace string with database ID if possible
	if isinstance(id, str):
		try_db_id = find_db_id_by_str(id)
		if try_db_id != None:
			id = try_db_id
		if isinstance(id, str):
			id = int_if_numeric(id)
	if isinstance(id, int):
		return get_entity_type_by_db_id(id) != None
	if id[0] == temporary_id_marker and id[1:].isdecimal():
		return int(id[1:]) in AllEntitiesByID
	return False

def get_entity_by_id(id, load_from_db=True, do_not_load_scripts=False):
	# If it's temporary, get it if it still exists
	if isinstance(id, str):
		if id[0] == temporary_id_marker and id[1:].isdecimal():
			id = int(id[1:])
			if id in AllEntitiesByID:
				return AllEntitiesByID[id]
			return None
		id = find_db_id_by_str(id)
		if id == None:
			return None

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
	if t == entity_type['group']:
		e = EntityWithPlainData(t)
		if e.load(id):
			return e
		return None
	if t == entity_type['generic']:
		e = GenericEntity(t)
		if e.load(id):
			return e
		return None
	if t == entity_type['gadget']:
		e = Gadget(t, do_not_load_scripts=do_not_load_scripts)
		if e.load(id, do_not_switch_map=do_not_load_scripts):
			return e
		return None

	# Other entity types can use the base class
	e = Entity(t)
	if e.load(id):
		return e

	return None

def filter_username(text):
	return ''.join([i for i in text if (i.isalnum() or i == '_')]).lower()

def filter_displayname(text):
	return text.replace('\n', '').replace("\u202E", '')

def escape_tags(text):
	return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def unescape_tags(text):
	return text.replace("&gt;", ">").replace("&lt;", "<").replace("&amp;", "&")

remove_noparse = re.compile("\\[/?noparse\\]", re.IGNORECASE)
def noparse(text):
	text = text.replace("\n", "\\n")
	if "[" in text:
		return "[noparse]"+remove_noparse.sub("", text)+"[/noparse]"
	return text

def user_file_url_is_ok(url):
	if url == "":
		return True
	if Config["FileUpload"]["Enabled"] and len(Config["FileUpload"]["URLPrefix"]) and url.startswith(Config["FileUpload"]["URLPrefix"]):
		return True
	for w in Config["Images"]["URLWhitelist"]:
		if url.startswith(w):
			return True
	return False

def image_url_is_okay(url):
	return user_file_url_is_ok(url) and url.lower().endswith(".png")

def pic_is_okay(pic):
	if not isinstance(pic, list) and not isinstance(pic, tuple):
		return False
	if len(pic) != 3:
		return False
	if isinstance(pic[0], str):
		return image_url_is_okay(pic[0])
	return True

def valid_id_format(id):
	return isinstance(id, int) or id.isdecimal() or ((id.startswith(temporary_id_marker) or id.startswith(global_entity_marker)) and id[1:].isdecimal() or id.startswith('user:'))

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
	try:
		if load_me != None:
			return json.loads(load_me)
	except ValueError as err: # JSONDecodeError
		print("Attempting to load Invalid JSON: %s" % load_me)
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

def string_is_int(s):
	if len(s) == 0:
		return False
	if s[0] == '-':
		return s[1:].isdecimal()
	return s.isdecimal()

def int_if_numeric(text):
	if isinstance(text, int):
		return text
	return int(text) if string_is_int(text) else text

def make_protocol_message_string(command, params):
	if params != None:
		return command + " " + json.dumps(params)
	return command

def write_to_build_log(map, client, command, args, old_data = None):
	if not BuildLog:
		return

	# Should this map have logs?
	if not map.is_map():
		return
	if Config["Logs"]["BuildDefault"] and (map.map_flags & mapflag['no_build_logs']):
		return
	if not Config["Logs"]["BuildDefault"] and not (map.map_flags & mapflag['build_logs']):
		return

	# Get the IP, and determine if this client should not be logged
	ip = None
	if client.is_client():
		connection = client.connection()
		if connection == None:
			return
		ip = connection.ip
		if connection.user_flags & userflag['no_build_logs']:
			return
	else:
		# TODO: Try to get the creator's ID if they're present, but right now non-clients can't build anyway
		ip = "(owned by %d)" % client.owner_id

	if old_data == None:
		old_data = ""
	else:
		old_data = " | " + json.dumps(old_data)

	now = datetime.datetime.today().strftime("%Y-%m-%d %I:%M %p")
	message = '%s map=(%s, %s) ip=%s db=%s name=%s user=%s map=%s | %s %s%s' % (now, json.dumps(map.name), map.protocol_id(), ip, client.db_id if client.db_id != None else "", json.dumps(client.name), client.username if client.is_client() else "", map.protocol_id(), command, json.dumps(args), old_data)
	BuildLog.write(message + "\n")
	TempLogs[1].append(message)

def map_id_exists(id):
	if id in AllEntitiesByDB:
		return AllEntitiesByDB[id].entity_type == entity_type['map']
	c = Database.cursor()
	c.execute('SELECT entity_id FROM Map WHERE entity_id=?', (id,))
	result = c.fetchone()
	return result != None

def decompress_entity_data(data, compressed_data):
	if compressed_data == None:
		return data
	elif data == 'zlib':
		return zlib.decompress(compressed_data).decode()
	return None

def load_text_data_from_db(entity_id):
	c = Database.cursor()
	c.execute('SELECT data, compressed_data FROM Entity WHERE id=?', (entity_id,))
	result = c.fetchone()
	if result != None:
		return decompress_entity_data(result[0], result[1])
	return None

def text_from_text_item(entity_id):
	if isinstance(entity_id, str):
		entity_id = find_db_id_by_str(entity_id)
	if entity_id == None:
		return None
	if get_entity_type_by_db_id(entity_id) != entity_type['text']:
		return None
	return loads_if_not_none(load_text_data_from_db(entity_id))

def send_ext_listen_status(connection):
	all_maps = {}
	for category, map_id in connection.listening_maps:
		if map_id not in all_maps:
			all_maps[map_id] = []
		all_maps[map_id].append(maplisten_type_name[category])
	connection.send("EXT", {"listen_status": {"maps": all_maps}})

def get_tile_properties(name):
	if isinstance(name, dict):
		return name
	if name == None:
		return None
	s = name.split(':')
	if len(s) == 1:
		tileset = ''
		tilename = s[0]
	else:
		tileset = s[0]
		tilename = s[1]

	tileset = ServerResources['tilesets'].get(tileset)
	if tileset == None:
		return None
	return tileset.get(tilename)

def get_tile_density(name):
	properties = get_tile_properties(name)
	if properties == None:
		return False
	return properties.get('density', False)

def in_blocked_username_list(client, banlist, display_action=None, check_action="", friends_list=None, recipient=None):
	if client is recipient:
		return False
	if not banlist:
		return False
	if ("!watchonly" in banlist) or (check_action+':!watchonly' in banlist):
		if (not client.is_client()) or (client.username == None) or ( (client.username not in Config["Server"]["Admins"]) and (client.username not in (friends_list or tuple())) ):
			if display_action:
				client.send("ERR", {'text': 'Only certain people may %s' % display_action})
			return True
		return False
		
	# Use the player, instead of whatever entity they're acting through
	if not client.is_client():
		if ('!objects' in banlist) or (check_action+':!objects') in banlist:
			if display_action:
				client.send("ERR", {'text': 'Only clients may %s' % display_action, 'code': 'clients_only'})
			return True
		username = find_username_by_db_id(client.owner_id)
		if username != None and ((username in banlist) or (check_action+":"+username) in banlist):
			return True
		return False
	username = client.username
	if username in Config["Server"]["Admins"]:
		return False
	if username == None and (('!guests' in banlist) or ((check_action+':!guests') in banlist)):
		if display_action:
			client.send("ERR", {'text': 'Guests may not %s' % display_action, 'code': 'no_guests', 'detail': check_action})
		return True
	if username != None and ((username in banlist) or ((check_action+":"+username) in banlist)):
		if display_action:
			client.send("ERR", {'text': 'You may not %s' % display_action, 'code': 'blocked', 'detail': check_action})
		return True
	return False

from .buildentity import Entity, EntityWithPlainData, GenericEntity
from .buildgadget import Gadget
from .buildmap import Map
