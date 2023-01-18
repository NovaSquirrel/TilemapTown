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

import sqlite3, json, glob
from .buildglobal import *
from .buildmap import Map

c = Database.cursor()

c.execute("""create table if not exists Meta (
item text,
value text,
flags integer
)""")

reload_database_meta()

# Get/update version number

old_version = get_database_meta('version')
if old_version == 1:
	# TODO: migrate from v1 to v2
	pass
set_database_meta('version', 2)

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
tags text,
data text,
location integer,
position text,
home_location integer,
home_position text,
allow integer,
deny integer,
guest_deny integer,
foreign key(owner_id) references Entity(id) on delete set null,
foreign key(creator_id) references Entity(id) on delete set null
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
start_x integer,
start_y integer,
width integer,
height integer,
default_turf text,
foreign key(entity_id) references Entity(id) on delete cascade
)""")

c.execute("""create table if not exists Map_Log (
id integer,
map_id integer,
user_id integer,
time timestamp,
action text,
info text,
primary key(id),
foreign key(map_id) references Entity(id) on delete cascade,
foreign key(user_id) references Entity(id) on delete cascade
)""")

c.execute("""create table if not exists User (
entity_id integer primary key,
passhash text,
passalgo text,
last_seen_at timestamp,
username text,
watch text,
ignore text,
client_settings text,
flags integer,
foreign key(entity_id) references Entity(uid) on delete cascade
)""")

c.execute("""create table if not exists Mail (
id integer primary key,
owner_id integer,
sender_id integer,
recipients text,
subject text,
contents text,
created_at timestamp,
flags integer,
foreign key(owner_id) references Entity(id) on delete cascade,
foreign key(sender_id) references Entity(id) on delete set null
)""")

c.execute("""create table if not exists Server_Ban (
id integer primary key,
ip text,
ip1 text,
ip2 text,
ip3 text,
ip4 text,
account_id integer,
admin_id integer,
created_at timestamp,
expires_at timestamp,
reason text,
foreign key(account_id) references Entity(id) on delete cascade,
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

# Save everything
Database.commit()

# Make a default map if there isn't already one
if get_database_meta('default_map') == None:
	map = Map()
	map.name = "Default map"
	map.map_flags = mapflag['public']
	map.save()
	set_database_meta('default_map', map.db_id)
	# gets committed by the above call
