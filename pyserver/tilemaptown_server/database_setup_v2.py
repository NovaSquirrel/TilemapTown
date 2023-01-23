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

import sqlite3, json, glob, sys, shutil
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

upgrade_from_v1 = False
if old_version == 1:
	shutil.copyfile(Config["Database"]["File"], Config["Database"]["File"]+".bak")

	print("Upgrading database from version 1 to 2")
	upgrade_from_v1 = True

	c.execute("SELECT item, value FROM Meta")
	v1_meta = c.fetchall()

	c.execute("SELECT mid, name, desc, owner, flags, regtime, start_x, start_y, width, height, default_turf, allow, deny, guest_deny, tags, data FROM Map")
	v1_maps = c.fetchall()

	c.execute("SELECT mid, uid, allow, deny FROM Map_Permission")
	v1_map_permissions = c.fetchall()

	c.execute("SELECT mid, uid, lid, time, action, info FROM Map_Log")
	v1_map_log = c.fetchall()

	c.execute("SELECT uid, passhash, passalgo, regtime, lastseen, username, name, pic, mid, map_x, map_y, home, watch, ignore, client_settings, flags, tags FROM User")
	v1_users = c.fetchall()

	c.execute("SELECT aid, name, desc, type, flags, creator, regtime, owner, folder, data FROM Asset_Info")
	v1_asset_info = c.fetchall()

	c.execute("SELECT id, uid, sender, recipients, subject, contents, time, flags FROM Mail")
	v1_mail = c.fetchall()

	c.execute("SELECT id, ip, ip1, ip2, ip3, ip4, account, admin, time, expiry, reason FROM Server_Ban")
	v1_server_ban = c.fetchall()

	c.execute("SELECT gid, name, desc, regtime, owner, joinpass, flags FROM User_Group")
	v1_user_groups = c.fetchall()

	c.execute("SELECT gid, mid, allow FROM Group_Map_Permission")
	v1_group_map_permissions = c.fetchall()

	c.execute("SELECT gid, uid, flags FROM Group_Member")
	v1_group_members =  c.fetchall()

	c.execute("SELECT gid, uid FROM Group_Invite")
	v1_group_invites =  c.fetchall()

	c.execute("DROP TABLE Meta")
	c.execute("DROP TABLE Map")
	c.execute("DROP TABLE Map_Permission")
	c.execute("DROP TABLE Map_Log")
	c.execute("DROP TABLE User")
	c.execute("DROP TABLE Asset_Info")
	c.execute("DROP TABLE Mail")
	c.execute("DROP TABLE Server_Ban")
	c.execute("DROP TABLE User_Group")
	c.execute("DROP TABLE Group_Map_Permission")
	c.execute("DROP TABLE Group_Member")
	c.execute("DROP TABLE Group_Invite")
	make_meta()

elif old_version != 2 and old_version != None:
	print("Database is version %s, but version 1 or 2 is required!" % (old_version))
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
tags text,
data text,
compressed_data blob,
location integer,
position text,
home_location integer,
home_position text,
allow integer,
deny integer,
guest_deny integer,
foreign key(location) references Entity(id) on delete set null,
foreign key(home_location) references Entity(id) on delete set null,
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

ip4_1 text, ip4_2 text, ip4_3 text, ip4_4 text,

ip6_1 text, ip6_2 text, ip6_3 text, ip6_4 text,
ip6_5 text, ip6_6 text, ip6_7 text, ip6_8 text,

account_id integer,
admin_id integer,
created_at timestamp,
expires_at timestamp,
reason text,
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

if upgrade_from_v1:
	def create_entity(created_at, creator_id, etype, name, desc, pic, location, position, home_location, home_position, tags, owner_id, allow, deny, guest_deny, data):
		c.execute("INSERT INTO Entity (created_at, creator_id, type, name, desc, pic, location, position, home_location, home_position, tags, owner_id, allow, deny, guest_deny, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (created_at, creator_id, etype, name, desc, pic, location, position, home_location, home_position, tags, owner_id, allow, deny, guest_deny, data))
		return c.lastrowid

	def translate_permission_value(perm):
		if perm & permission['copy']:
			perm &= ~permission['copy'];
			perm |= permission['bulk_build']
		return perm
	def translate_pic(pic):
		if pic[0] == 1:
			pic[0] = -1
		elif isinstance(pic[0], int) and pic[0] > 0:
			pic[0] = new_asset_id.get(pic[0], 0)
		return pic

	translate_old_tile_types = ('', 'sign', 'door', 'container', 'ice', 'escalator', 'water')
	translate_old_asset_types = (0, entity_type['text'], entity_type['image'], entity_type['map_tile'], entity_type['tileset'], entity_type['reference'], entity_type['folder'])

	def translate_map_tile(tile):
		if isinstance(tile, str):
			return tile
		if 'pic' in tile:
			tile['pic'] = translate_pic(tile['pic'])
		if 'type' in tile:
			tile['type'] = translate_old_tile_types[tile['type']]
		return tile

	# -----------------------

	for meta in v1_meta:
		c.execute("INSERT INTO Meta (item, value, flags) VALUES (?, ?, 0)", (meta[0], meta[1]))
	reload_database_meta()

	# -------------------------------------------
	# Translate users first
	new_user_id = {}
	new_user_location = {} # Hold onto these until the maps are created
	new_user_home = {}
	for user in v1_users:
		home = json.loads(user[11])
		home_id = None
		home_x = None
		home_y = None
		if home != None:
			home_id, home_x, home_y = home
		new_pic = dumps_if_not_none(translate_pic(loads_if_not_none(user[7])))

		eid = create_entity(created_at=user[3], creator_id=None, etype=entity_type['user'], name=user[6], desc=None, pic=new_pic, location=None, position=json.dumps([user[9], user[10]]), home_location=None, home_position=json.dumps([home_x, home_y]) if home_id else None, tags=user[16], owner_id=None, allow=0, deny=0, guest_deny=0, data=None)
		c.execute("INSERT INTO User (entity_id, passhash, passalgo, last_seen_at, username, watch, ignore, client_settings, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", \
			(eid, user[1], user[2], user[4], user[5], user[12], user[13], user[14], user[15]) \
		)

		new_user_id[user[0]] = eid
		new_user_location[eid] = user[8]
		new_user_home[eid] = home_id

	# -------------------------------------------
	# Now translate assets
	new_asset_id = {}
	new_asset_folder = {}
	for asset in v1_asset_info:
		if asset[7] == None: # Ignore the reserved item slots
			continue
		owner = new_user_id.get(asset[7], None)
		creator = new_user_id.get(asset[5], None)
		if owner == None:
			continue

		# Re-encode data as JSON if it isn't already. Text and images previously weren't.
		new_data = asset[9]
		if new_data != None:
			try:
				json.loads(asset[9])
			except ValueError as err:
				new_data = json.dumps(asset[9])

		if asset[3] == 3 and new_data != None: # Map tile
			new_data = json.dumps(translate_map_tile(json.loads(new_data)))

		eid = create_entity(created_at=asset[6], creator_id=creator, etype=translate_old_asset_types[asset[3]], name=asset[1], desc=asset[2], pic=None, location=new_user_id.get(asset[7], None), position=None, home_location=None, home_position=None, tags=None, owner_id=owner, allow=0, deny=0, guest_deny=0, data=new_data)

		if asset[8] != None:
			new_asset_folder[eid] = asset[8]
		new_asset_id[asset[0]] = eid
	for key, value in new_asset_folder.items():
		c.execute("UPDATE Entity SET location=? WHERE id=?", (new_asset_id[value], key))

	# -------------------------------------------
	# Translate maps now
	new_map_id = {}
	for map in v1_maps:
		new_data = json.loads(map[15])

		for i in range(len(new_data['turf'])):
			new_data['turf'][i][2] = translate_map_tile(new_data['turf'][i][2])
		for i in range(len(new_data['obj'])):
			new_data['obj'][i][2] = [translate_map_tile(x) for x in new_data['obj'][i][2]]

		eid = create_entity(created_at=map[5], creator_id=new_user_id.get(map[3], None), etype=entity_type['map'], name=map[1], desc=map[2], pic=None, location=None, position=None, home_location=None, home_position=None, tags=map[14], owner_id=new_user_id.get(map[3], None), allow=translate_permission_value(map[11]), deny=translate_permission_value(map[12]), guest_deny=translate_permission_value(map[13]), data=json.dumps(new_data))
		new_map_id[map[0]] = eid

		c.execute("INSERT INTO Map (entity_id, flags, start_x, start_y, width, height, default_turf) VALUES (?, ?, ?, ?, ?, ?, ?)", (eid, map[4], map[6], map[7], map[8], map[9], map[10]))
	if 0 in new_map_id:
		set_database_meta('default_map', new_map_id[0])

	# Update user locations and homes
	for uid in new_user_id.values():
		location = new_user_location[uid]
		home = new_user_home[uid]
		if location == None:
			location = get_database_meta('default_map')
		else:
			location = new_map_id[location]
		if home != None:
			home = new_map_id[home]
		c.execute("UPDATE Entity SET location=?, home_location=? WHERE id=?", (location, home, uid))

	# -------------------------------------------
	# The other tables

	for perm in v1_map_permissions:
		map = new_map_id.get(perm[0], None)
		user = new_user_id.get(perm[1], None)
		if map == None or user == None:
			continue
		c.execute("INSERT INTO Permission (subject_id, actor_id, allow, deny) VALUES (?, ?, ?, ?)", (map, user, translate_permission_value(perm[2]), translate_permission_value(perm[3]) ))

	for log in v1_map_log:
		# Map logs were never implemented in v1 so there won't be any data
		c.execute("INSERT INTO Map_Log (map_id, user_id, time, action, info) VALUES (?, ?, ?, ?, ?)", (new_map_id[log[0]], new_user_id[log[1]], log[3], log[4], log[5]) )

	for mail in v1_mail:
		recipients = ','.join([str(new_user_id.get(x, 0)) for x in mail[3].split(',')])
		c.execute("INSERT INTO Mail (owner_id, sender_id, recipients, subject, contents, created_at, flags) VALUES (?, ?, ?, ?, ?, ?, ?)", (new_user_id[mail[1]], new_user_id[mail[2]], recipients, mail[4], mail[5], mail[6], mail[7]) )

	for ban in v1_server_ban:
		c.execute("INSERT INTO Server_Ban (ip, ip4_1, ip4_2, ip4_3, ip4_4, account_id, admin_id, created_at, expires_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (ban[1], ban[2], ban[3], ban[4], ban[5], None, new_user_id[ban[7]], ban[8], ban[9], ban[10]) )

	new_group_id = {}
	for group in v1_user_groups:
		eid = create_entity(created_at=group[3], creator_id=new_user_id.get(group[4], None), etype=entity_type['group'], name=group[1], desc=group[2], pic=None, location=None, position=None, home_location=None, home_position=None, tags=None, owner_id=new_user_id.get(group[4], None), allow=0, deny=0, guest_deny=0, data=group[5])
		new_group_id[group[0]] = eid

	for perm in v1_group_map_permissions:
		map = new_map_id.get(perm[0], None)
		group = new_group_id.get(perm[1], None)
		if map == None or user == None:
			continue
		c.execute("INSERT INTO Permission (subject_id, actor_id, allow, deny) VALUES (?, ?, ?, 0)", (map, group, translate_permission_value(perm[2]) ))

	for member in v1_group_members:
		c.execute("INSERT INTO Group_Member (group_id, member_id, flags, created_at, accepted_at) VALUES (?, ?, ?, ?, ?)", (new_group_id[member[0]], new_user_id[member[1]], member[2], datetime.datetime.now(), datetime.datetime.now() ))
		
	for member in v1_group_invites:
		# Invites were never implemented in v1 so there won't be any data
		c.execute("INSERT INTO Group_Member (group_id, member_id, flags, created_at, accepted_at) VALUES (?, ?, ?, ?, ?)", (new_group_id[member[0]], new_user_id[member[1]], member[2], datetime.datetime.now(), None ))

else:
	reload_database_meta()

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

set_database_meta('version', 2)
