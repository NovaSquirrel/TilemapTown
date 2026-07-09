# Tilemap Town
# Copyright (C) 2026 NovaSquirrel
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

import sqlite3, json, glob, sys, shutil, zlib
from .buildglobal import *
from .buildmap import Map

c = Database.cursor()

def make_meta():
	c.execute("""create table if not exists Meta (
	item text,
	value text,
	flags integer
	)""")
make_meta()

# Check on what the database file's current version is

c.execute("SELECT value FROM Meta WHERE item='version'")
old_version = c.fetchone()
if old_version != None:
	old_version = old_version[0]
	if old_version[0].isnumeric():
		old_version = int(old_version[0])

# Decide what to do based on the version

upgrade_from_v2 = False
if old_version == 2:
	shutil.copyfile(Config["Database"]["File"], Config["Database"]["File"]+".bak")

	print("Upgrading database from version 2 to 3")
	upgrade_from_v2 = True

	c.execute("ALTER TABLE Entity ADD COLUMN have_ext integer")

	c.execute("ALTER TABLE Map ADD COLUMN map_search_flags integer")
	c.execute("ALTER TABLE Map ADD COLUMN misc text")

	c.execute("ALTER TABLE User ADD COLUMN name text")
	c.execute("ALTER TABLE User ADD COLUMN misc text")

	c.execute("ALTER TABLE User_Profile RENAME COLUMN more_data TO misc")

	c.execute("ALTER TABLE Mail ADD COLUMN compressed_contents blob")
	c.execute("SELECT id, contents FROM Mail")
	v2_mail = c.fetchall()
	for mail in v2_mail:
		c.execute("UPDATE Mail SET contents='zlib', compressed_contents=? WHERE id=?", (zlib.compress(mail[1].encode()), mail[0],))

	c.execute("ALTER TABLE Server_Ban ADD COLUMN private_note text")

	c.execute("ALTER TABLE User_File_Upload ADD COLUMN hash text")

	c.execute("DROP TABLE Map_Log")

elif old_version == 1:
	print("Database is version 1 - use database_setup_v2.py first")
	sys.exit()
elif old_version != 3 and old_version != None:
	print("Database is version %s, but version 2 or 3 is required!" % (old_version))
	sys.exit()

# Table creation time!

c.execute("""create table if not exists Entity (
id integer primary key,
owner_id integer,
creator_id integer,
created_at timestamp,
acquired_at timestamp,
type integer,
name text,
desc text,
pic text,
flags integer,
data text,
compressed_data blob,
location integer,
position text,
home_location integer,
home_position text,
allow integer,
deny integer,
guest_deny integer,
have_ext integer,
foreign key(location) references Entity(id) on delete set null,
foreign key(home_location) references Entity(id) on delete set null,
foreign key(owner_id) references Entity(id) on delete set null,
foreign key(creator_id) references Entity(id) on delete set null
)""")

c.execute("""create table if not exists Entity_Ext (
id integer primary key,
extra_url text,
forward_messages_to integer,
tags text,
compressed_tags blob,
misc text,
compressed_misc blob,
foreign key(id) references Entity(id) on delete cascade,
foreign key(forward_messages_to) references Entity(id) on delete set null
)""")

c.execute("""create table if not exists Permission (
subject_id integer,
actor_id integer,
allow integer,
deny integer,
primary key(subject_id, actor_id),
foreign key(subject_id) references Entity(id) on delete cascade,
foreign key(actor_id) references Entity(id) on delete cascade
)""")

c.execute("""create table if not exists Map (
entity_id integer primary key,
flags integer,
map_search_flags integer,
start_x integer,
start_y integer,
width integer,
height integer,
default_turf text,
misc text,
foreign key(entity_id) references Entity(id) on delete cascade
)""")

c.execute("""create table if not exists User (
entity_id integer primary key,
passhash text,
passalgo text,
last_seen_at timestamp,
name text,
username text,
watch text,
ignore text,
client_settings text,
flags integer,
misc text,
foreign key(entity_id) references Entity(uid) on delete cascade
)""")

c.execute("""create table if not exists Mail (
id integer primary key,
owner_id integer,
sender_id integer,
recipients text,
subject text,
contents text,
compressed_contents text,
created_at timestamp,
flags integer,
foreign key(owner_id) references Entity(id) on delete cascade,
foreign key(sender_id) references Entity(id) on delete set null
)""")

c.execute("""create table if not exists Server_Ban (
id integer primary key,
ip text,

ip4_1 text, ip4_2 text, ip4_3 text, ip4_4 text,

ip6_1 text, ip6_2 text, ip6_3 text, ip6_4 text,
ip6_5 text, ip6_6 text, ip6_7 text, ip6_8 text,

account_id integer,
admin_id integer,
created_at timestamp,
expires_at timestamp,
reason text,
private_note text,
foreign key(account_id) references Entity(id) on delete set null,
foreign key(admin_id) references Entity(id) on delete set null
)""")

c.execute("""create table if not exists Group_Member (
group_id integer,
member_id integer,
flags integer,
created_at timestamp,
accepted_at timestamp,
primary key(group_id, member_id),
foreign key(group_id) references Entity(id) on delete cascade,
foreign key(member_id) references Entity(id) on delete cascade
)""")

c.execute("""create table if not exists Global_Entity_Key (
entity_id integer,
key text,
flags integer,
primary key(entity_id),
foreign key(entity_id) references Entity(id) on delete cascade
)""")


c.execute("""create table if not exists User_File_Folder (
folder_id integer,
user_id integer,
name text,
desc text,
location integer,
flags integer,
primary key(folder_id),
foreign key(user_id) references Entity(id) on delete cascade,
foreign key(location) references User_File_Folder(folder_id) on delete set null
)""")

c.execute("""create table if not exists User_File_Upload (
file_id integer,
user_id integer,
created_at timestamp,
updated_at timestamp,
name text,
desc text,
location integer,
size integer,
filename text,
flags integer,
hash text,
primary key(file_id),
foreign key(user_id) references Entity(id) on delete cascade,
foreign key(location) references User_File_Folder(folder_id) on delete set null
)""")

c.execute("""create table if not exists User_Profile (
user_id integer,
updated_at timestamp,
name text,
text text,
pronouns text,
picture_url text,
birthday text,
home_location integer,
home_position text,

interests text,
interest_flags integer,
interest_flags2 integer,
looking_for text,

email text,
website text,
contact text,

extra_fields text,
flags integer,
misc text,

foreign key(user_id) references Entity(id) on delete cascade,
foreign key(home_location) references Entity(id) on delete set null
)""")

if upgrade_from_v2:
	c.execute("SELECT id, tags FROM Entity")
	v2_tags = c.fetchall()
	for tags in v2_tags:
		tags_loaded = loads_if_not_none(tags[1])
		if not tags_loaded:
			continue
		real_tags = tags_loaded.get('tags')
		if not real_tags:
			continue
		c.execute("INSERT INTO Entity_Ext (id, tags) VALUES (?, ?)", (tags[0], json.dumps(real_tags)))
		c.execute("UPDATE Entity SET have_ext=1 WHERE id=?", (tags[0],))

	c.execute("ALTER TABLE Entity DROP COLUMN tags")

	Database.commit()
	c.execute("VACUUM")

reload_database_meta()

# Make a default map if there isn't already one
if get_database_meta('default_map') == None:
	map = Map()
	map.name = "Default map"
	map.map_flags = mapflag['public']
	map.save()
	set_database_meta('default_map', map.db_id)

set_database_meta('version', 3)

# Save everything
Database.commit()
