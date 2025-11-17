#!/usr/bin/env python3
#
# Tilemap Town tileset version migrator v2
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
	if n.isnumeric() or (n and n[0] == '-' and n[1:].isnumeric()):
		return int(n)
	return n

def loads_if_not_none(load_me):
	try:
		if load_me != None:
			return json.loads(load_me)
	except ValueError as err: # JSONDecodeError
		print("Attempting to load Invalid JSON: %s" % load_me)
	return None

def search_map_for_replacement(input_pic):
	if input_pic == None or input_pic[0] not in translate_from_ids:
		return (None, None)
	for line in translate_tileset_map:
		if len(line) < 9:
			continue
		fromTileset = line[0]
		fromX = line[1]
		fromY = line[2]
		toX = line[3]
		toY = line[4]
		newTileset = line[5]
		newX = line[6]
		newY = line[7]
		becomeObj = line[8]

		if input_pic[0] == fromTileset and input_pic[1] >= fromX and input_pic[2] >= fromY and input_pic[1] <= toX and input_pic[2] <= toY:
			find_x = newX + (input_pic[1]-fromX)
			find_y = newY + (input_pic[2]-fromY)
			tileset = newTileset
			return ([tileset, find_x, find_y], becomeObj)
	print("Unrecognized pic", input_pic)
	return (invisible_wall_pic, None)

def decompress_entity_data(data, compressed_data):
	if compressed_data == None:
		return data
	elif data == 'zlib':
		return zlib.decompress(compressed_data).decode()
	return None

def fix_tile(tile_data):
	fixed_anything = False
	replacement_pic, replacement_pic_turf = search_map_for_replacement(tile_data.get('pic'))
	replacement_menu_pic, replacement_menu_pic_turf = search_map_for_replacement(tile_data.get('menu_pic'))

	# Remove unneeded fields while we're at it
	for field in ('autotile_layout', 'autotile_class', 'autotile_class_edge', 'anim_frames', 'anim_speed', 'anim_mode', 'anim_offset', 'density', 'obj', 'over'):
		if field in tile_data and not tile_data[field]:
			del tile_data[field]
			fixed_anything = True

	if replacement_pic:
		tile_data['pic'] = replacement_pic
		fixed_anything = True
		if replacement_pic_turf != None and replacement_pic_turf.startswith("A"):
			tile_data["autotile_layout"] = int(replacement_pic_turf[1:])
			replacement_pic_turf = ""
	if replacement_menu_pic:
		tile_data['menu_pic'] = replacement_menu_pic
		fixed_anything = True
	return (fixed_anything, replacement_pic_turf)

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

	for row in c.execute('SELECT id, pic FROM Entity'):
		e_id = row[0]
		pic = loads_if_not_none(row[1])
		new_pic, _ = search_map_for_replacement(pic)
		if new_pic:
			if not dry_run:
				c2.execute("UPDATE Entity SET pic=? WHERE id=?", (json.dumps(new_pic), e_id,))
			else:
				print(new_pic)

	for row in c.execute('SELECT id, data, compressed_data FROM Entity WHERE type=6'):
		e_id = row[0]
		if row[1] == None:
			continue
		data = json.loads(row[1])
		if isinstance(data, str) and data[0] == "{":
			data = json.loads(data)
		if isinstance(data, dict):
			fixed_anything, _ = fix_tile(data)
			if fixed_anything:
				if not dry_run:
					c2.execute("UPDATE Entity SET data=? WHERE id=?", (json.dumps(json.dumps(data)), e_id,))
				else:
					print(json.dumps(json.dumps(data)))

	for row in c.execute('SELECT id, data, compressed_data FROM Entity WHERE type=14'):
		def fix_command(s):
			if s.startswith("userparticle "):
				sp = s.split(" ")
				pt = int_if_possible(sp[1])
				px = int_if_possible(sp[2])
				py = int_if_possible(sp[3])
				replacement, _ = search_map_for_replacement([pt, px, py])
				if replacement:
					sp[1] = str(replacement[0])
					sp[2] = str(replacement[1])
					sp[3] = str(replacement[2])
					return " ".join(sp)
			return s
		e_id = row[0]
		data = decompress_entity_data(row[1], row[2])
		if not data:
			continue
		data = json.loads(data)
		if data.get("type") != "command_list":
			continue
		for d in data.get("data", []):
			command = d["command"]
			if isinstance(command, str):
				d["command"] = fix_command(command)
			elif isinstance(command, list):
				d["command"] = [fix_command(s) for s in command]
		if not dry_run:
			c2.execute("UPDATE Entity SET data='zlib', compressed_data=? WHERE id=?", (zlib.compress(json.dumps(data).encode()), row[0],))
		else:
			print(json.dumps(data))

	for row in c.execute('SELECT id, data, compressed_data FROM Entity WHERE type=2'):
		data = decompress_entity_data(row[1], row[2])
		if not data:
			continue
		data = json.loads(data)
		turfs = data.get("turf")
		objs = data.get("obj")
		fixed_anything = False

		for obj in objs:
			new_object_list = []
			did_add_obj = False
			for o in obj[2]:
				if isinstance(o, dict):
					fixed_this, become_obj = fix_tile(o)
					fixed_anything = fixed_anything or fixed_this
					if not did_add_obj:
						if become_obj and become_obj.startswith("\""):
							new_object_list.append(become_obj[1:])
							did_add_obj = True
						elif become_obj and become_obj.startswith("["):
							p = become_obj[1:].split("-")
							new_object_list.append({"name": o["name"], "pic": [int(p[0]), int(p[1]), int(p[2])] })
							did_add_obj = True
				new_object_list.append(o)
			obj[2] = new_object_list

		for turf in turfs:
			if isinstance(turf[2], dict):
				fixed_this, become_obj = fix_tile(turf[2])
				fixed_anything = fixed_anything or fixed_this

				add_obj = None
				if become_obj and become_obj.startswith("\""):
					add_obj = turf[2]
					turf[2] = become_obj[1:]
				elif become_obj and become_obj.startswith("["):
					add_obj = turf[2]
					p = become_obj[1:].split("-")
					turf[2] = {"name": turf[2]["name"], "pic": [int(p[0]), int(p[1]), int(p[2])] }

				if add_obj:
					for obj in objs:
						if obj[0] == turf[0] and obj[1] == turf[1]:
							obj[2].insert(0, add_obj)
							break
					else:
						objs.append([turf[0], turf[1], [add_obj]])

		if fixed_anything:
			print("Fixed map", row[0])
			text = json.dumps(data)

			if not dry_run:
				c2.execute("UPDATE Entity SET data='zlib', compressed_data=? WHERE id=?", (zlib.compress(text.encode(), level = 5), row[0],))
				print(c2.rowcount)

	# Fix map default turf
	for row in c.execute('SELECT entity_id, default_turf FROM Map'):
		if row[1] == None:
			continue
		if row[1].startswith("{"):
			t = json.loads(row[1])
			fix_tile(t)
			if not dry_run:
				c2.execute("UPDATE Map SET default_turf=? WHERE entity_id=?", (json.dumps(t), row[0],))

	if not dry_run:
		Database.commit()
	Database.close()

#################################################

translate_from_ids = (0, -1)
invisible_wall_pic = [0, 20, 0]

with open('translate-oct-2025.txt') as f:
	translate_tileset_map = [[int_if_possible(y.strip()) for y in x.split(',')] for x in f.readlines()]

#convert_rsc('server_resources.json')
#convert_rsc('server_resources3.json')
convert_database('tilemaptown.db')
