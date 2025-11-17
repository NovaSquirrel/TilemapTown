#!/usr/bin/env python3
#
# Tilemap Town tileset version migrator
# Copyright 2025 NovaSquirrel
#
# Copying and distribution of this file, with or without
# modification, are permitted in any medium without royalty
# provided the copyright notice and this notice are preserved.
# This file is offered as-is, without any warranty.
#
import json, sqlite3, zlib

dry_run = False

def int_if_possible(n):
	if n.isnumeric():
		return int(n)
	return n

def search_map_for_replacement(input_pic):
	if input_pic == None or input_pic[0] != tileset_id:
		return None
	for line in translate_tileset_map:
		if len(line) < 6:
			continue
		if input_pic[1] >= line[0] and input_pic[2] >= line[1] and input_pic[1] <= line[2] and input_pic[2] <= line[3]:
			find_x = line[4] + (input_pic[1]-line[0])
			find_y = line[5] + (input_pic[2]-line[1])
			tileset = tileset_id
			if len(line) >= 7 and line[6].startswith("!extras"):
				tileset = extras_id
			return [tileset, find_x, find_y]		
	return invisible_wall_pic

def decompress_entity_data(data, compressed_data):
	if compressed_data == None:
		return data
	elif data == 'zlib':
		return zlib.decompress(compressed_data).decode()
	return None

def fix_tile(tile_data):
	fixed_anything = False
	replacement_pic = search_map_for_replacement(tile_data.get('pic'))
	replacement_menu_pic = search_map_for_replacement(tile_data.get('menu_pic'))
	if replacement_pic:
		tile_data['pic'] = replacement_pic
		fixed_anything = True
	if replacement_menu_pic:
		tile_data['menu_pic'] = replacement_menu_pic
		fixed_anything = True
	return fixed_anything

def convert_rsc(path):
	with open(path) as f:
		rsc = json.load(f)
	for tileset_name, tileset_data in rsc["tilesets"].items():
		for tile_name, tile_data in tileset_data.items():
			fix_tile(tile_data)
	if not dry_run:
		with open(path, 'w') as f:
			print("Converting resources file", path)
			json.dump(rsc, f, indent="\t")
	else:
		print(json.dumps(rsc, indent="\t"))

def convert_database(path):
	Database = sqlite3.connect(path, detect_types=sqlite3.PARSE_DECLTYPES|sqlite3.PARSE_COLNAMES)
	c = Database.cursor()
	c2 = Database.cursor()
	for row in c.execute('SELECT id, data, compressed_data FROM Entity WHERE type=2'):
		data = decompress_entity_data(row[1], row[2])
		if not data:
			continue
		data = json.loads(data)
		turfs = data.get("turf")
		objs = data.get("obj")
		fixed_anything = False
		for turf in turfs:
			if isinstance(turf[2], dict):
				old_pic = list(turf[2]['pic'])
				fixed_this = fix_tile(turf[2])
				fixed_anything = fixed_anything or fixed_this
		for obj in objs:
			for o in obj[2]:
				if isinstance(o, dict):
					fixed_this = fix_tile(o)
					fixed_anything = fixed_anything or fixed_this
		if fixed_anything:
			print("Fixed map", row[0])
			text = json.dumps(data)

			if not dry_run:
				c2.execute("UPDATE Entity SET data='zlib', compressed_data=? WHERE id=?", (zlib.compress(text.encode(), level = 5), row[0],))
				print(c2.rowcount)

	if not dry_run:
		Database.commit()
	Database.close()

#################################################

tileset_id = -3
extras_id = -1
invisible_wall_pic = [-1, 3, 5]

with open('translate_tileset_map.txt') as f:
	translate_tileset_map = [[int_if_possible(y.strip()) for y in x.split(',')] for x in f.readlines()]

#convert_rsc('../pyserver/server_resources3.json')
convert_database('tilemaptown.db')
