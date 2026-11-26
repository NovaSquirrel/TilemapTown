import json, sqlite3, zlib

def decompress_entity_data(data, compressed_data):
	if compressed_data == None:
		return data
	elif data == 'zlib':
		return zlib.decompress(compressed_data).decode()
	return None

dry_run = True

def scan_database(path):
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
			if turf[2] == "easyrpg:house_wall7a":
				turf[2] = "easyrpg:house_wall5a"
				fixed_anything = True
			if turf[2] == "easyrpg:house_wall7b":
				turf[2] = "easyrpg:house_wall5b"
				fixed_anything = True
		for obj in objs:
			obj[2] = ["mushrooms" if _ == "rocks1" else _ for _ in obj[2]]
			fixed_anything = fixed_anything or "mushrooms" in obj[2]
		if fixed_anything:
			print("Fixed map %d" % row[0])
			text = json.dumps(data)
			if not dry_run:
				c2.execute("UPDATE Entity SET data='zlib', compressed_data=? WHERE id=?", (zlib.compress(text.encode(), level = 5), row[0],))

	if not dry_run:
		Database.commit()
	Database.close()

#################################################

scan_database('tilemaptown.db')
