import json, sqlite3, zlib
from PIL import Image

def int_if_possible(n):
	if n.isnumeric():
		return int(n)
	return n

def decompress_entity_data(data, compressed_data):
	if compressed_data == None:
		return data
	elif data == 'zlib':
		return zlib.decompress(compressed_data).decode()
	return None

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

		for turf in turfs:
			if isinstance(turf[2], dict):
				used_pics.add(tuple(turf[2]['pic']))
		for obj in objs:
			for o in obj[2]:
				if isinstance(o, dict):
					used_pics.add(tuple(o['pic']))
	Database.close()

#################################################

tilesheet_filenames = {
	0: "potluck.png",
	-1: "extra.png"
}
tilesheet_images = {}
tilesheet_used_images = {}
used_pics = set()

for k,v in tilesheet_filenames.items():
	tilesheet_images[k] = Image.open(v).convert('RGBA')
	tilesheet_used_images[k] = Image.new(mode='RGBA', size=(tilesheet_images[k].width, tilesheet_images[k].height), color=(255, 255, 255, 0))

scan_database('tilemaptown.db')

for pic in used_pics:
	if pic[0] in tilesheet_used_images:
		tilesheet_used_images[pic[0]].alpha_composite(im=tilesheet_images[pic[0]].crop((pic[1]*16, pic[2]*16, pic[1]*16+16, pic[2]*16+16)), dest=(pic[1]*16, pic[2]*16))

for k,v in tilesheet_used_images.items():
	v.save("used_"+tilesheet_filenames[k], "PNG")
	v.show()
	#print(v, v.width, v.height)

