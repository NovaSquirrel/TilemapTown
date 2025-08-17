#!/usr/bin/env python3
#
# Tilemap Town world snapshot maker
# Copyright 2024 NovaSquirrel
#
# Copying and distribution of this file, with or without
# modification, are permitted in any medium without royalty
# provided the copyright notice and this notice are preserved.
# This file is offered as-is, without any warranty.
#
import requests, json, io, datetime
from PIL import Image

# .--------------------------------------------------------
# | Utilities
# '--------------------------------------------------------

# Accesses a specific endpoint and expects it to have JSON
def get_api(url, params=None):
	r = requests.get("https://novasquirrel.com/townapi/v1/" + url, params=params)
	if r.status_code == 200:
		return r.json()
	else:
		print("Got status code %d for %s: %s" % (r.status_code, url, r.text))
		return None

# Get tile properties from a name, or leave it as-is if it's already properties
def get_tile_properties(tile):
	if isinstance(tile, dict):
		return tile
	s = tile.split(':')
	if len(s) == 2:
		tileset, name = s
	else:
		tileset = ''
		name = s[0]
	tileset = tilesets.get(tileset)
	if tileset == None:
		return None
	return tileset.get(name)

# Get the actual Pillow image from an image ID
def get_image(image_id):
	image = image_for_img_id.get(image_id)
	if image:
		return image

	url = url_for_img_id.get(image_id)
	if url == 'bad': # If the IMG call failed before, don't try again
		return None
	if url == None:
		url = get_api('img/%d' % image_id)
		if url == None:
			url_for_img_id[image_id] = 'bad'
			return None
		url = url['url']
		url_for_img_id[image_id] = url

	print('Downloading '+url)
	response = requests.get(url, headers={'User-Agent': 'curl/7.84.0', 'Accept': '*/*'})
	if response.status_code != 200:
		print('Download failed %d: %s' % (response.status_code, response.text))
		url_for_img_id[image_id] = "bad"
		return None
	try:
		image = Image.open(io.BytesIO(response.content)).convert('RGBA')
		image_for_img_id[image_id] = image
	except:
		print("Couldn't load image %d (%s)" % (image_id, url))
		url_for_img_id[image_id] = "bad"
	return image

# .--------------------------------------------------------
# | Global variables
# '--------------------------------------------------------

town_info = get_api('town_info')
resources = get_api('server_resources')

crawled_map_ids = set()
maps_by_id = {}
url_for_img_id = {}
image_for_img_id = {}
tilesets = {}

# .--------------------------------------------------------
# | Process server_resources
# '--------------------------------------------------------

for k,v in resources['images'].items():
	url_for_img_id[int(k)] = v

for k,v in resources['tilesets'].items():
	tilesets[k] = v

# .--------------------------------------------------------
# | Map data and rendering
# '--------------------------------------------------------

class Map(object):
	def __init__(self, response):
		self.info = response['info']
		self.data = response['data']

	def get_turf_for_autotile(self, t, x, y):
		if x < 0 or x >= self.width or y < 0 or y >= self.height:
			return t
		return self.turfs[x][y]

	def is_turf_autotile_match(self, t, x, y):
		other = get_tile_properties(self.get_turf_for_autotile(t, x, y))
		if t.get('autotile_class') and other.get('autotile_class_edge') and t['autotile_class'] == other['autotile_class_edge']:
			return True
		if t.get('autotile_class'):
			return t['autotile_class'] == other.get('autotile_class')
		if t.get('name'):
			return t['name'] == other.get('name')
		return False

	def get_turf_autotile_index(self, t, x, y):
		return (self.is_turf_autotile_match(t, x-1, y) << 0) \
			| (self.is_turf_autotile_match(t, x+1, y) << 1) \
			| (self.is_turf_autotile_match(t, x, y-1) << 2) \
			| (self.is_turf_autotile_match(t, x, y+1) << 3)

	def get_obj_for_autotile(self, o, x, y):
		if x < 0 or x >= self.width or y < 0 or y >= self.height:
			return o
		return self.objs[x][y]

	def is_obj_autotile_match(self, o, x, y):
		objs = self.get_obj_for_autotile(o, x, y)
		if objs == None or len(objs) == 0:
			return False
		if o.get('autotile_class'):
			for other_obj in objs:
				other = get_tile_properties(other_obj)
				if other == None:
					continue
				if o['autotile_class'] == other.get('autotile_class'):
					return True
		if o.get('name'):
			for other_obj in objs:
				other = get_tile_properties(other_obj)
				if other == None:
					continue
				if o['name'] == other.get('name'):
					return True
		return False

	def get_obj_autotile_index(self, o, x, y):
		return (self.is_obj_autotile_match(o, x-1, y) << 0) \
			| (self.is_obj_autotile_match(o, x+1, y) << 1) \
			| (self.is_obj_autotile_match(o, x, y-1) << 2) \
			| (self.is_obj_autotile_match(o, x, y+1) << 3)

	def render_tile(self, x, y, properties, index_function, match_function):
		if properties == None:
			return
		pic = properties.get('pic')
		if pic == None:
			return
		image_id, pic_x, pic_y = pic
		image = get_image(image_id)
		if image == None:
			return

		autotile_layout = properties.get('autotile_layout', 0)
		if autotile_layout == 1:                             # 9-slice
			pair = [[0,0], [0, 0], [0,  0], [0, 0], \
					[0,0], [1, 1], [-1, 1], [0, 1], \
					[0,0], [1,-1], [-1,-1], [0,-1], \
					[0,0], [1, 0], [-1, 0], [0, 0]][index_function(properties, x, y)]
			pic_x += pair[0]
			pic_y += pair[1]
		elif autotile_layout == 2 or autotile_layout == 3:   # 4 directions
			pair = [[2,-2], [1,-2], [-1,-2], [0,-2], \
					[2, 1], [1, 1], [-1, 1], [0, 1], \
					[2,-1], [1,-1], [-1,-1], [0,-1], \
					[2, 0], [1, 0], [-1, 0], [0, 0]][index_function(properties, x, y)]
			pic_x += pair[0]
			pic_y += pair[1]
			if autotile_layout == 3:
				pic_x -= 2
				pic_y += 2
		elif autotile_layout == 4 or autotile_layout == 5:   # RPG
			index = index_function(properties, x, y)
			quarters = [[[-2,-4],[-1,-4],[-2,-3],[-1,-3]], [[2,-2],[3,-2],[2, 3],[3, 3]], \
				[[-2,-2],[-1,-2],[-2, 3],[-1, 3]], [[0,-2],[1,-2],[0, 3],[1, 3]], \
				[[-2, 2],[ 3, 2],[-2, 3],[ 3, 3]], [[2, 2],[3, 2],[2, 3],[3, 3]], \
				[[-2, 2],[-1, 2],[-2, 3],[-1, 3]], [[0, 2],[1, 2],[0, 3],[1, 3]], \
				[[-2,-2],[ 3,-2],[-2,-1],[ 3,-1]], [[2,-2],[3,-2],[2,-1],[3,-1]], \
				[[-2,-2],[-1,-2],[-2,-1],[-1,-1]], [[0,-2],[1,-2],[0,-1],[1,-1]], \
				[[-2, 0],[ 3, 0],[-2, 1],[ 3, 1]], [[2, 0],[3, 0],[2, 1],[3, 1]], \
				[[-2, 0],[-1, 0],[-2, 1],[-1, 1]], [[0, 0],[1, 0],[0, 1],[1, 1]], \
			][index]

			# Add the inner parts of turns
			if ((index & 5) == 5) and not match_function(properties, x-1, y-1):
				quarters[0][0] = 2
				quarters[0][1] = -4
			if ((index & 6) == 6) and not match_function(properties, x+1, y-1):
				quarters[1][0] = 3
				quarters[1][1] = -4
			if ((index & 9) == 9) and not match_function(properties, x-1, y+1):
				quarters[2][0] = 2
				quarters[2][1] = -3
			if ((index & 10) == 10) and not match_function(properties, x+1, y+1):
				quarters[3][0] = 3
				quarters[3][1] = -3
			# Layout 5 has the origin point on the single tile instead of the middle tile
			if autotile_layout == 5:
				pic_x += 1
				pic_y += 2

			# Draw the four tiles
			src_x, src_y = pic_x*16 + quarters[0][0]*8, pic_y*16 + quarters[0][1]*8
			self.image.alpha_composite(im=image.crop((src_x, src_y, src_x+8, src_y+8)), dest=(x*16,   y*16))
			src_x, src_y = pic_x*16 + quarters[1][0]*8, pic_y*16 + quarters[1][1]*8
			self.image.alpha_composite(im=image.crop((src_x, src_y, src_x+8, src_y+8)), dest=(x*16+8, y*16))
			src_x, src_y = pic_x*16 + quarters[2][0]*8, pic_y*16 + quarters[2][1]*8
			self.image.alpha_composite(im=image.crop((src_x, src_y, src_x+8, src_y+8)), dest=(x*16,   y*16+8))
			src_x, src_y = pic_x*16 + quarters[3][0]*8, pic_y*16 + quarters[3][1]*8
			self.image.alpha_composite(im=image.crop((src_x, src_y, src_x+8, src_y+8)), dest=(x*16+8, y*16+8))
			return
		elif autotile_layout == 6:                           # horizontal - middle 3
			right = match_function(properties, x+1, y)
			left = match_function(properties, x-1, y)
			if not left and right:
				pic_x -= 1
			if left and not right:
				pic_x += 1
		elif autotile_layout == 7 or autotile_layout == 8:   # horizontal
			right = match_function(properties, x+1, y)
			left = match_function(properties, x-1, y)
			if not left and right:
				pic_x -= 1
			if left and not right:
				pic_x += 1
			if not left and not right:
				pic_x += 2
			if autotile_layout == 8:
				pic_x -= 2
		elif autotile_layout == 9:                           # vertical - middle 3
			bottom = match_function(properties, x, y+1)
			top = match_function(properties, x, y-1)
			if not top and bottom:
				pic_y -= 1
			if top and not bottom:
				pic_y += 1
		elif autotile_layout == 10 or autotile_layout == 11: # vertical
			bottom = match_function(properties, x, y+1)
			top = match_function(properties, x, y-1)
			if not top and bottom:
				pic_y -= 1
			if top and not bottom:
				pic_y += 1
			if not top and not bottom:
				pic_y -= 2
			if autotile_layout == 11:
				pic_y += 2
		self.image.alpha_composite(im=image.crop((pic_x*16, pic_y*16, pic_x*16+16, pic_y*16+16)), dest=(x*16, y*16))

	def render(self):
		self.width = self.info['size'][0]
		self.height = self.info['size'][1]

		# Load the map
		self.turfs = []
		self.objs = []
		for x in range(0, self.width):
			self.turfs.append([self.data['default']] * self.height)
			self.objs.append([None] * self.height)
		for t in self.data['turf']:
			self.turfs[t[0]][t[1]] = t[2]
		for o in self.data['obj']:
			self.objs[o[0]][o[1]] = o[2]

		# Render the map
		self.image = Image.new(mode='RGBA', size=(self.width*16, self.height*16), color=(255, 255, 255, 0))
		for y in range(self.height):
			for x in range(self.width):
				self.render_tile(x, y, get_tile_properties(self.turfs[x][y]), self.get_turf_autotile_index, self.is_turf_autotile_match)
				if self.objs[x][y] != None:
					for o in self.objs[x][y]:
						self.render_tile(x, y, get_tile_properties(o), self.get_obj_autotile_index, self.is_obj_autotile_match)
		#self.image.show()

# .--------------------------------------------------------
# | Collect all map information
# '--------------------------------------------------------

maps_by_grid_coords = {}
min_grid_x, min_grid_y, max_grid_x, max_grid_y = 0, 0, 0, 0
directions = ((1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1))

def crawl_map(map_id, grid_x, grid_y):
	global min_grid_x, min_grid_y, max_grid_x, max_grid_y
	if map_id in crawled_map_ids:
		return
	crawled_map_ids.add(map_id)

	print('Fetching map %d' % map_id)

	response = get_api('map/%d' % map_id, {'info': 1, 'data': 1})
	if response == None:
		print('Couldn\'t get map %d' % map_id)
		return

	# Parse and render map
	map = Map(response)
	maps_by_id[map_id] = map
	for n, link in enumerate(map.info.get('edge_links', []) or []):
		if link != None:
			crawl_map(link, grid_x+directions[n][0], grid_y+directions[n][1])
	map.render()

	# Update the coordinate map
	min_grid_x = min(min_grid_x, grid_x)
	min_grid_y = min(min_grid_y, grid_y)
	max_grid_x = max(max_grid_x, grid_x)
	max_grid_y = max(max_grid_y, grid_y)
	maps_by_grid_coords[(grid_x, grid_y)] = map

crawl_map(town_info['server']['default_map'], 0, 0)

# .--------------------------------------------------------
# | Put everything together
# '--------------------------------------------------------

grid_width  = max_grid_x - min_grid_x + 1
grid_height = max_grid_y - min_grid_y + 1

world_image = Image.new(mode='RGBA', size=(grid_width*100*16, grid_height*100*16), color=(255, 255, 255, 0))
for y in range(min_grid_y, max_grid_y+1):
	for x in range(min_grid_x, max_grid_x+1):
		map = maps_by_grid_coords.get((x, y))
		if map == None:
			continue
		image_x = x - min_grid_x
		image_y = y - min_grid_y
		world_image.paste(map.image, box=(image_x*100*16, image_y*100*16))

world_image.show()
world_image.save('world_map_%s.png' % (datetime.datetime.today().strftime("%Y-%m-%d")))
