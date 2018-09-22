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

import sqlite3, json, glob
from .buildglobal import *

c = Database.cursor()

c.execute("""create table if not exists Meta (
item text,
value text
)""")

# Get/update version number
c.execute("SELECT value FROM Meta WHERE item='version'")
version = c.fetchone()
if version == None:
	c.execute("INSERT INTO Meta (item, value) VALUES ('version', '1')")
else:
	c.execute("UPDATE Meta SET value='1' WHERE item='version'")

c.execute("""create table if not exists Map (
mid integer primary key,
name text,
desc text,
owner integer,
flags integer,
regtime timestamp,
start_x integer,
start_y integer,
width integer,
height integer,
default_turf text,
allow integer,
deny integer,
guest_deny integer,
tags text,
data text
)""")

c.execute("""create table if not exists Map_Permission (
mid integer,
uid integer,
allow integer,
deny integer,
primary key(mid, uid)
)""")

c.execute("""create table if not exists Map_Log (
mid integer,
uid integer,
lid integer,
time timestamp,
action text,
info text,
primary key(mid, uid)
)""")

c.execute("""create table if not exists User (
uid integer primary key autoincrement,
passhash text,
passalgo text,
regtime timestamp,
lastseen timestamp,
username text,
name text,
pic text,
mid integer,
map_x integer,
map_y integer,
home text,
watch text,
ignore text,
client_settings text,
flags integer,
tags text
)""")

c.execute("""create table if not exists Asset_Info (
aid integer primary key,
name text,
desc text,
type integer,
flags integer,
creator integer,
regtime timestamp,
owner integer,
folder integer,
data integer
)""")

# Migrate users
for fname in glob.glob("users/*.txt"):
	# Set out some defaults
	passhash = ""
	passalgo = ""
	username = ""
	name = ""
	pic = "[0, 2, 25]"
	mid = -1
	map_x = 0
	map_y = 0
	home = None
	watch = "[]"
	ignore = "[]"
	tags = "{}"

	try:
		with open(fname, 'r') as f:
			lines = f.readlines()
			iswho = False
			ispass = False
			istags = False
			isignore = False
			iswatch = False
			ishome = False
			for line in lines:
				if line == "PASS\n":
					ispass = True
				elif line == "WHO\n":
					iswho = True
				elif line == "TAGS\n":
					istags = True
				elif line == "IGNORE\n":
					isignore = True
				elif line == "WATCH\n":
					iswatch = True
				elif line == "HOME\n":
					ishome = True
				elif iswho:
					s = json.loads(line)
					name = s["name"]
					username = s["username"]
					pic = json.dumps(s["pic"])
					map_x = s["x"]
					map_y = s["y"]
					mid = s["map_id"]
					iswho = False
				elif ispass:
					s = json.loads(line)
					if "sha512" in s:
						passalgo = "sha512"
						passhash = s["sha512"]
					ispass = False
				elif istags:
					tags = line
					istags = False
				elif isignore:
					ignore = line
					isignore = False
				elif iswatch:
					watch = line
					iswatch = False
				elif ishome:
					home = line
					ishome = False
		# Insert into database if not already in it
		c.execute('SELECT * FROM User WHERE username=?', (username,))
		if c.fetchone() == None:
			values = (passhash, passalgo, username, name, pic, mid, map_x, map_y, home, watch, ignore, tags,)
			c.execute('INSERT INTO User (passhash, passalgo, username, name, pic, mid, map_x, map_y, home, watch, ignore, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', values)
	except:
		print("Couldn't load user "+name)
		raise

# Migrate maps
for fname in glob.glob("maps/*.txt"):
	# Set out some defaults
	mid = -1
	name = ""
	desc = ""
	owner = -1
	flags = 0
	start_x = 5
	start_y = 5
	width = 100
	height = 100
	default_turf = "grass"
	allow = 0
	deny = 0
	tags = "{}"
	data = "{}"

	try:
		with open(fname, 'r') as f:
			lines = f.readlines()
			mai = False
			map = False
			tag = False
			for line in lines:
				if line == "MAI\n":   # Map info signal
					mai = True
				elif line == "MAP\n": # Map data signal
					map = True
				elif line == "TAGS\n": # Map tags signal
					tag = True
				elif mai:           # Receive map info
					# does not actually translate the banlist or whitelist
					s = json.loads(line)
					# add in extra fields added later that may not have been included
					defaults = {'admins': [], 'public': False, 'private': False,
						'build_enabled': True, 'full_sandbox': True, 'entry_whitelist': [],
						'entry_banlist': [], 'build_banlist': [], 'start_pos': [5,5]}
					for k,v in defaults.items():
						if k not in s:
							s[k] = v
					name = s["name"]

					# Look up owner
					owner_name = s["owner"]
					if owner_name:
						owner = findDBIdByUsername(owner_name)

					mid = int(s["id"])
					if s["build_enabled"]:
						allow |= permission['build']
					if s["full_sandbox"]:
						allow |= permission['sandbox']
					if s["private"]:
						deny |= permission['entry']
					if s["public"]:
						flags |= mapflag['public']
					default_turf = s["default"]
					start_x = s["start_pos"][0]
					start_y = s["start_pos"][1]
					mai = False
				elif map:           # Receive map data
					data = line
					map = False
				elif tag:
					tags = line
					tag = False
		# Insert into database if not already in it
		c.execute('SELECT * FROM Map WHERE mid=?', (mid,))
		if c.fetchone() == None:
			values = (mid, name, desc, owner, flags, start_x, start_y, width, height, default_turf, allow, deny, deny, tags, data)
			c.execute('INSERT INTO Map (mid, name, desc, owner, flags, start_x, start_y, width, height, default_turf, allow, deny, guest_deny, tags, data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', values)
	except:
		print("Couldn't load map "+fname)
		raise

# Save everything
Database.commit()
