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
import time, os, random, json, html
from aiohttp import web, ClientSession
from string import Template
from .buildglobal import *
from .buildentity import Entity

start_time = int(time.time())

MAIN_API_CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET"
}
MAIN_API_CORS_HEADERS_CACHED = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET"
}

routes = web.RouteTableDef()
@routes.get('/v1/town_info')
async def town_info(request):
	global connection_count
	now = int(time.time())

	where_are = {}
	for m in AllMaps:
		if m.map_flags & mapflag['public'] == 0:
			continue
		user_count = m.count_users_inside(recursive=False)
		if user_count == 0:
			continue

		map_users = []
		for u in m.contents:
			if u.is_client():
				connection = u.connection()
				if connection and (connection.user_flags & (userflag['hide_location'] | userflag['hide_api']) == 0):
					map_users.append(u.protocol_id())
		where_are[m.db_id] = {'name': m.name, 'desc': m.desc, 'user_count': user_count, 'id': m.db_id, 'users': map_users}
	
	stats = {}	
	bot_count = 0
	for c in AllClients:
		connection = c.connection()
		if not connection:
			continue
		if connection.user_flags & userflag['bot']:
			bot_count += 1
	stats['user_count'] = (len(AllClients)-bot_count)
	stats['bot_count'] = bot_count
	stats['total_connections'] = shared_total_connections[0]
	stats['time_online'] = now - start_time

	users = {}
	for u in AllClients:
		connection = u.connection()
		if not connection:
			continue
		if (connection.user_flags & userflag['hide_api'] != 0):
			continue
		user_data = {'name': u.name, 'username': u.username, 'id': u.protocol_id(), 'time_online': now - connection.connected_time}
		if connection.user_flags & userflag['bot']:
			user_data['bot'] = True
		users[u.protocol_id()] = user_data

	server = {'name': Config['Server']['Name'], 'motd': Config['Server']['MOTD'], 'default_map': get_database_meta('default_map')}

	park_text = GlobalData.get('park_text')
	park_map = GlobalData.get('park_map')
	if park_text and len(park_text):
		server['park_text'] = park_text
		if park_map and len(park_map):
			server['park_map'] = park_map

	data = {}
	data['stats']  = stats
	data['users']  = users
	data['maps']   = where_are
	data['server'] = server
	return web.json_response(data, headers=MAIN_API_CORS_HEADERS)

@routes.get('/v1/server_version')
async def server_version(request):
	return web.json_response(server_version_dict, headers=MAIN_API_CORS_HEADERS)

@routes.get('/v1/server_resources')
async def server_resources(request):
	return web.json_response(ServerResources, headers=MAIN_API_CORS_HEADERS_CACHED)

def map_from_id(map_id):
	if not map_id.isdecimal():
		return (False,web.Response(status=400, text="Map ID is invalid", headers=MAIN_API_CORS_HEADERS))
	map_id = int(map_id)

	if not map_id_exists(map_id):
		return (False,web.Response(status=404, text="Couldn't find map", headers=MAIN_API_CORS_HEADERS))
	map = get_entity_by_id(map_id)

	if map == None:
		return (False,web.Response(status=400, text="Couldn't load map", headers=MAIN_API_CORS_HEADERS))
	#if map.map_flags & mapflag['public'] == 0:
	#	return (False,web.Response(status=401, text="Map isn't public", headers=MAIN_API_CORS_HEADERS))
	if map.deny & permission['entry']:
		return (False,web.Response(status=401, text="That map is private", headers=MAIN_API_CORS_HEADERS))

	return (True,map)

@routes.get('/v1/map/{map_id}')
async def map_info(request):
	map_ok, map = map_from_id(request.match_info['map_id'])
	if not map_ok:
		return map

	data = {}
	if int(request.query.get('info', 1)):
		data["info"] = map.map_info()
	try:
		if int(request.query.get('data', 0)):
			if map.map_data_loaded:
				data["data"] = map.map_section(0, 0, map.width-1, map.height-1)
			else:
				from_db = map.load_data_as_text()
				if from_db != None:
					from_db = json.loads(from_db)

					# Patch in the edge ID links and wallpaper so map.map_info() can include them
					if "edge_links" in from_db:
						map.edge_id_links = from_db["edge_links"]
					if "wallpaper" in from_db:
						map.wallpaper = from_db["wallpaper"]

					data["info"] = map.map_info()
					data["data"] = {'pos': from_db['pos'], 'default': from_db['default'], 'turf': from_db['turf'], 'obj': from_db['obj']}
	except:
		pass
	return web.json_response(data, headers=MAIN_API_CORS_HEADERS)

@routes.get('/v1/tsd/{id}')
async def get_tsd(request):
	entity_id = request.match_info['id']
	if not s:
		return web.Response(status=400, text="No image IDs provided", headers=MAIN_API_CORS_HEADERS)
	if len(s) == 1:
		if not entity_id.isdecimal():
			return web.Response(status=400, text="Tileset ID is invalid", headers=MAIN_API_CORS_HEADERS)
		entity_id = int(entity_id)

		# Get and return the data
		c = Database.cursor()
		c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type('tileset'), entity_id,))
		result = c.fetchone()
		if result == None:
			return web.Response(status=404, text="Couldn't find tileset", headers=MAIN_API_CORS_HEADERS)
		else:
			return web.json_response({'id': entity_id, 'data': decompress_entity_data(result[0], result[1])}, headers=MAIN_API_CORS_HEADERS_CACHED)
	else:
		out = {}
		for i in s:
			if not i.isdecimal():
				continue
			i = int(i)

			# Get and return the data
			c = Database.cursor()
			c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type('tileset'), entity_id,))
			result = c.fetchone()
			if result == None:
				continue
			else:
				out[i] = {'id': i, 'data': loads_if_not_none(decompress_entity_data(result[0], result[1]))}
		return web.json_response(out, headers=MAIN_API_CORS_HEADERS_CACHED)

@routes.get('/v1/img/{id}')
async def get_img(request):
	s = request.match_info['id'].split(",")
	if not s:
		return web.Response(status=400, text="No image IDs provided", headers=MAIN_API_CORS_HEADERS)
	if len(s) == 1:
		entity_id = s[0]
		if not entity_id.isdecimal():
			return web.Response(status=400, text="Image ID is invalid", headers=MAIN_API_CORS_HEADERS)
		entity_id = int(entity_id)

		# Get and return the data
		c = Database.cursor()
		c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type['image'], entity_id,))
		result = c.fetchone()
		if result == None:
			return web.Response(status=404, text="Couldn't find image", headers=MAIN_API_CORS_HEADERS)
		else:
			return web.json_response({'id': entity_id, 'url': loads_if_not_none(decompress_entity_data(result[0], result[1]))}, headers=MAIN_API_CORS_HEADERS_CACHED)
	else:
		out = {}
		for i in s:
			if not i.isdecimal():
				continue
			i = int(i)

			# Get and return the data
			c = Database.cursor()
			c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type['image'], i,))
			result = c.fetchone()
			if result == None:
				continue
			else:
				out[i] = {'id': i, 'url': loads_if_not_none(decompress_entity_data(result[0], result[1]))}
		return web.json_response(out, headers=MAIN_API_CORS_HEADERS_CACHED)

# ---------------------------------------------------------
global_file_upload_size = 0
allowed_file_extensions = {".png", ".mod", ".s3m", ".xm", ".it", ".mptm"}

if Config["FileUpload"]["AllowCrossOrigin"]:
	CORS_HEADERS = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Headers": "Authorization, *",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE"
	}
else:
	CORS_HEADERS = {}

def write_to_file_log(connection, text):
	now = datetime.datetime.today().strftime("(%Y-%m-%d) %I:%M %p")
	message = (connection.ip if connection != None else "?") + " | " + now + ": " + text
	TempLogs[2].append(message)

	# Write to a file too
	if UploadLog:
		UploadLog.write(message + "\n")

def get_connection_from_api_key(request):
	if not Config["FileUpload"]["Enabled"]:
		raise web.HTTPServiceUnavailable(text="File uploads currently disabled", headers=CORS_HEADERS)
	authorization = request.headers.get("Authorization")
	if isinstance(authorization, str) and authorization.startswith("Bearer "):
		token = authorization[7:]
		connection = ConnectionsByApiKey.get(token)
		if connection:
			return connection
	raise web.HTTPUnauthorized(headers=CORS_HEADERS)

def url_for_user_file(db_id, filename):
	return "%s%s/%s" % (Config["FileUpload"]["URLPrefix"], str(db_id), filename)

def path_for_user_file(db_id, filename):
	return os.path.join(Config["FileUpload"]["StoragePath"], str(db_id), filename)

def storage_limit_for_connection(connection):
	if connection.username in Config["FileUpload"]["SizeLimitOverride"]:
		return Config["FileUpload"]["SizeLimitOverride"][connection.username]*1024
	if connection.user_flags & userflag['file_uploads']:
		return Config["FileUpload"]["SizeLimitTrustedUser"]*1024
	if connection.username:
		return Config["FileUpload"]["SizeLimitUser"]*1024
	return Config["FileUpload"]["SizeLimitGuest"]*1024

def file_is_probably_png(data):
	return data.startswith(bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))

multipart_text_names = {"name", "desc", "folder"}
multipart_bool_names = {"keep_url", "set_my_pic", "create_entity"}
multipart_file_names = {"file"}
async def get_info_from_multipart(request):
	out = {}
	reader = await request.multipart()
	while True:
		field = await reader.next()
		if field is None:
			break
		if field.name in multipart_text_names:
			out[field.name] = await field.text()
		elif field.name in multipart_bool_names:
			lowered = (await field.text()).lower()
			if lowered == "":
				continue
			if lowered != "true" and lowered != "false":
				raise web.HTTPBadRequest(text="Boolean field not 'true' or 'false'", headers=CORS_HEADERS)
			out[field.name] = lowered == "true"
		elif field.name in multipart_file_names:
			max_size = Config["FileUpload"]["MaximumFileSize"]*1024
			data = await field.read_chunk(size=max_size + 1)
			if len(data) >= max_size+1:
				raise web.HTTPRequestEntityTooLarge(text="Files may be %d KiB at most" % Config["FileUpload"]["MaximumFileSize"], max_size=Config["FileUpload"]["MaximumFileSize"], actual_size=content_length, headers=CORS_HEADERS) # actual_size isn't going to be correct but that's OK for now
			out[field.name] = data
			base_name, file_extension = os.path.splitext(field.filename)
			file_extension = file_extension.lower()
			out[field.name + "_original"]  = field.filename
			out[field.name + "_name"]      = base_name
			out[field.name + "_extension"] = file_extension
			if file_extension not in allowed_file_extensions:
				raise web.HTTPUnsupportedMediaType(text="Uploaded file is not an allowed type", headers=CORS_HEADERS)
			if file_extension == 'png' and not file_is_probably_png(data):
				raise web.HTTPUnsupportedMediaType(text="Uploaded file is not a valid image", headers=CORS_HEADERS)
	return out

def storage_info_for_connection(connection):
	return {"used_space": connection.total_file_upload_size, "free_space": storage_limit_for_connection(connection) - connection.total_file_upload_size}

def generate_filename(db_id, extension=".png"):
	for i in range(10): # Try 10 times
		# Numbers have less of a chance of accidentally being unpleasant than letters
		possible = str(random.randint(0, 999)) + extension
		if not os.path.isfile(path_for_user_file(db_id, possible)):
			return possible
	return None

def update_image_url_everywhere(connection, old_url, new_url):
	c = Database.cursor()
	for row in c.execute('SELECT id FROM Entity WHERE data=? AND type=?', (json.dumps(old_url), entity_type['image'])):
		img_id = row[0]

		img_entity = get_entity_by_id(img_id)
		if img_entity != None:
			img_entity.data = new_url
			if not img_entity.temporary:
				img_entity.save()
			if connection != None:
				connection.send("BAG", {'update': {'id': img_id, 'data': new_url}})

		for c in AllConnections:
			if img_id in c.images_and_tilesets_received_so_far:
				c.send("IMG", {'id': img_id, 'url': new_url, 'update': True})

	# Update all of the loaded entities that are using this URL as a pic
	for temp_id, entity in AllEntitiesByID.items():
		if entity.pic and entity.pic[0] == old_url:
			entity.pic[0] = new_url
			entity.save_on_clean_up = True
			entity.broadcast_who()

		if is_client_and_entity(entity): # If it's a client, update saved pics and morphs
			for k, saved_pic in entity.saved_pics.items():
				if saved_pic == old_url:
					entity.saved_pics[k] = new_url
			for k, morph in entity.morphs.items():
				morph_pic = morph.get('pic')
				if morph_pic and morph_pic[0] == old_url:
					morph_pic[0] = new_url

	# Try to get entities that aren't loaded too
	old_url_json = json.dumps([old_url, 0, 0])
	new_url_json = json.dumps([new_url, 0, 0])
	c = Database.cursor()
	c.execute('UPDATE Entity SET pic=? WHERE pic=?', (new_url_json, old_url_json))

def fix_uploaded_file_sizes(user_id):
	c = Database.cursor()

	if user_id:
		c.execute('SELECT file_id, user_id, size, filename FROM User_File_Upload WHERE user_id=?', (user_id,))
	else:
		c.execute('SELECT file_id, user_id, size, filename FROM User_File_Upload')
	results = c.fetchall()

	fixed = 0
	removed = 0
	for row in results:
		try:
			file_path = path_for_user_file(row[1], row[3])
			if not os.path.isfile(file_path):
				print("File %d no longer exists" % row[0])
				c.execute('DELETE FROM User_File_Upload WHERE file_id=?', (row[0],))
				removed += 1
				continue

			real_size = os.path.getsize(file_path)
			if real_size != row[2]:
				print("Fixing size for %d" % row[0])
				c.execute('UPDATE User_File_Upload SET size=? WHERE file_id=?', (real_size, file_id))
				fixed += 1
		except:
			print("Failed to check size for %d" % row[0])
	return (fixed, removed)

@routes.get('/v1/my_files')
async def file_list(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)

	storage_info = storage_info_for_connection(connection)
	storage_info["max_file_size"] = Config["FileUpload"]["MaximumFileSize"]
	storage_info["max_file_count"] = Config["FileUpload"]["AllowedFileCount"]
	storage_info["max_folder_count"] = Config["FileUpload"]["AllowedFolderCount"]
	out = {
		"files": {},
		"folders": {}, 
		"info": storage_info,
	}
	c = Database.cursor()
	for row in c.execute('SELECT file_id, created_at, updated_at, name, desc, location, filename, size FROM User_File_Upload WHERE user_id=?', (db_id,)):
		out["files"][row[0]] = {
			"id": row[0],
			"name": row[3],
			"desc": row[4],
			"folder": row[5],
			"created_at": row[1].isoformat(),
			"updated_at": row[2].isoformat(),
			"size": row[7],
			"url": url_for_user_file(db_id, row[6]),
		}
	for row in c.execute('SELECT folder_id, name, desc, location FROM User_File_Folder WHERE user_id=?', (db_id,)):
		out["folders"][row[0]] = {
			"id": row[0],
			"name": row[1],
			"desc": row[2],
			"folder": row[3],
		}
	return web.json_response(out, headers=CORS_HEADERS)

@routes.post('/v1/my_files/file')
async def post_file(request):
	global global_file_upload_size
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)

	# Check if the user has too many files
	c = Database.cursor()
	c.execute('SELECT COUNT(*) from User_File_Upload WHERE user_id=?', (db_id,))
	result = c.fetchone()
	if result == None:
		return
	if (result[0] or 0) >= Config["FileUpload"]["AllowedFileCount"]:
		raise web.HTTPInsufficientStorage(text="You have too many files (maximum is %d)" % Config["FileUpload"]["AllowedFileCount"], headers=CORS_HEADERS)

	# Get info from form data
	info = await get_info_from_multipart(request)
	if "file" not in info:
		raise web.HTTPBadRequest(text="Must include a file to upload", headers=CORS_HEADERS)
	file_data = info["file"]
	file_extension = info["file_extension"]

	# Check the size of the file
	if len(file_data) + connection.total_file_upload_size > storage_limit_for_connection(connection):
		raise web.HTTPInsufficientStorage(text="This upload would put you over your storage limit", headers=CORS_HEADERS)
	if len(file_data) + global_file_upload_size > Config["FileUpload"]["SizeLimitTotal"]*1024:
		raise web.HTTPInsufficientStorage(text="This upload would put the server over its storage limit", headers=CORS_HEADERS)

	random_filename = generate_filename(db_id, extension=file_extension)
	if random_filename == None:
		print("Failed to generate a filename for post_file")
		raise web.HTTPInternalServerError(headers=CORS_HEADERS)
	folder = int_if_numeric(info.get("folder")) if info.get("folder") != None else None
	if folder == 0:
		folder = None

	# Save to the storage
	try:
		os.makedirs(path_for_user_file(db_id, ''), exist_ok=True)
		with open(path_for_user_file(db_id, random_filename), 'wb') as f:
			f.write(file_data)
		connection.total_file_upload_size += len(file_data)
		global_file_upload_size += len(file_data)
	except:
		write_to_file_log(connection, "Upload failed")
		raise web.HTTPInternalServerError(text="Couldn't write the file", headers=CORS_HEADERS)

	if random_filename.endswith(".png"):
		if info.get("set_my_pic") and hasattr(connection.entity, 'pic'):
			connection.entity.pic = [url_for_user_file(db_id, random_filename), 0, 0]
			connection.entity.save_on_clean_up = True
			connection.entity.broadcast_who()
		if info.get("create_entity") and is_client_and_entity(connection.entity):
			e = Entity(entity_type['image'], creator_id=db_id)
			e.name = info.get('name') or "Image"
			e.map_id = db_id
			e.creator_temp_id = connection.entity.id
			e.data = url_for_user_file(db_id, random_filename)
			e.save()
			connection.entity.add_to_contents(e)

	# Add a database entry
	c.execute("INSERT INTO User_File_Upload (user_id, created_at, updated_at, name, desc, location, size, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (db_id, datetime.datetime.now(), datetime.datetime.now(), info.get("name"), info.get("desc"), folder, len(file_data), random_filename))
	file_id = c.lastrowid
	write_to_file_log(connection, "Upload %d by %s, (size=%d KiB, [url=%s]file[/url], name=%s, original=%s)" % (file_id, connection.entity.name_and_username(), len(file_data)//1024, url_for_user_file(db_id, random_filename), info.get("name"), info.get("file_original")))

	return web.json_response({
		"file": {
			"id": file_id,
			"name": info.get("name"),
			"desc": info.get("desc"),
			"folder": folder,
			"size": len(file_data),
			"url": url_for_user_file(db_id, random_filename),
		},
		"info": storage_info_for_connection(connection),
	}, headers=CORS_HEADERS)

@routes.get('/v1/my_files/file/{id}')
async def get_file(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)
	file_id = request.match_info['id']
	if not file_id.isdecimal():
		raise web.HTTPBadRequest(text="File ID is invalid", headers=CORS_HEADERS)
	file_id = int(file_id)

	c = Database.cursor()
	c.execute('SELECT created_at, updated_at, name, desc, location, filename, size FROM User_File_Upload WHERE user_id=? AND file_id=?', (db_id, file_id))
	result = c.fetchone()
	if result != None:
		return web.json_response({
			"name": result[2],
			"desc": result[3],
			"folder": result[4],
			"created_at": result[0].isoformat(),
			"updated_at": result[1].isoformat(),
			"size": result[6],
			"url": url_for_user_file(db_id, result[5]),
		}, headers=CORS_HEADERS)
	else:
		raise web.HTTPNotFound(text="File not found", headers=CORS_HEADERS)

@routes.put('/v1/my_files/file/{id}')
async def put_file(request):
	global global_file_upload_size
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)
	file_id = request.match_info['id']
	if not file_id.isdecimal():
		raise web.HTTPBadRequest(text="File ID is invalid", headers=CORS_HEADERS)
	file_id = int(file_id)

	# Get the original information from the database, and see if the file exists in the first place
	c = Database.cursor()
	c.execute('SELECT name, desc, location, filename, size FROM User_File_Upload WHERE user_id=? AND file_id=?', (db_id, file_id))
	result = c.fetchone()
	if result == None:
		raise web.HTTPNotFound(text="File not found", headers=CORS_HEADERS)
	name, desc, location, original_filename, original_size = result
	new_filename = original_filename
	new_size = original_size
	info = await get_info_from_multipart(request)

	if "file" in info:
		file_data = info["file"]
		file_extension = info["file_extension"]
		new_size = len(file_data)
		if (-original_size + new_size + connection.total_file_upload_size) > storage_limit_for_connection(connection):
			raise web.HTTPInsufficientStorage(text="This upload would put you over your storage limit", headers=CORS_HEADERS)
		if (-original_size + new_size + global_file_upload_size) > Config["FileUpload"]["SizeLimitTotal"]*1024:
			raise web.HTTPInsufficientStorage(text="This upload would put the server over its storage limit", headers=CORS_HEADERS)
		if not info.get("keep_url"):
			random_filename = generate_filename(db_id, extension=file_extension)
			if random_filename == None:
				print("Failed to generate a filename for put_file")
				raise web.HTTPInternalServerError(headers=CORS_HEADERS)
			original_path = path_for_user_file(db_id, original_filename)
			new_path = path_for_user_file(db_id, random_filename)
			if not os.path.isfile(path_for_user_file(db_id, original_path)):
				print("Tried to rename "+original_path+" but it doesn't exist")
			else:
				os.rename(original_path, new_path)
			new_filename = random_filename

		try:
			with open(path_for_user_file(db_id, new_filename), 'wb') as f:
				f.write(file_data)
			connection.total_file_upload_size = connection.total_file_upload_size + new_size - original_size
			global_file_upload_size = global_file_upload_size + new_size - original_size
			write_to_file_log(connection, "Reupload %d by %s, (size=%d KiB, [url=%s]file[/url], name=%s, original=%s)" % (file_id, connection.entity.name_and_username(), len(file_data)//1024, url_for_user_file(db_id, new_filename), name, info.get("file_original")))
		except:
			write_to_file_log(connection, "Reupload failed %d" % file_id)
			raise web.HTTPInternalServerError(text="Couldn't write the file", headers=CORS_HEADERS)

		if new_filename.endswith(".png"):
			if info.get("set_my_pic") and hasattr(connection.entity, 'pic'):
				connection.entity.pic = [url_for_user_file(db_id, new_filename), 0, 0]
				connection.entity.save_on_clean_up = True
				connection.entity.broadcast_who()
			update_image_url_everywhere(connection, url_for_user_file(db_id, original_filename), url_for_user_file(db_id, new_filename))

	if "name" in info:
		name = info["name"]
	if "desc" in info:
		desc = info["desc"]
	if "folder" in info:
		location = int_if_numeric(info["folder"]) if info.get("folder") != None else None
		if location == 0:
			location = None

	c = Database.cursor()
	c.execute('UPDATE User_File_Upload SET updated_at=?, name=?, desc=?, location=?, filename=?, size=? WHERE file_id=?', (datetime.datetime.now(), name, desc, location, new_filename, new_size, file_id))

	return web.json_response({
		"file": {
			"id": file_id,
			"name": name,
			"desc": desc,
			"folder": location,
			"size": new_size,
			"url": url_for_user_file(db_id, new_filename),
		},
		"info": storage_info_for_connection(connection),
	}, headers=CORS_HEADERS)

def admin_delete_uploaded_file(file_id):
	global global_file_upload_size
	c = Database.cursor()
	c.execute('SELECT name, desc, location, filename, size, user_id FROM User_File_Upload WHERE file_id=?', (file_id,))
	result = c.fetchone()
	if result == None:
		return None

	try:
		os.remove(path_for_user_file(result[5], result[3]))
	except:
		return False
	c.execute('DELETE FROM User_File_Upload WHERE file_id=?', (file_id,))
	write_to_file_log(None, "Admin delete %d (name=%s)" % (file_id, result[0]))

	# Should probably remove from user upload usage if they're online
	global_file_upload_size -= result[4]
	return True

async def download_and_reupload(download_url, new_file_name, user_id):
	async with ClientSession() as session:
		async with session.get(download_url, headers={'User-Agent': 'curl/7.84.0', 'Accept': '*/*'}) as resp:
			if resp.status != 200:
				print("Bad status %s" % resp.status)
				return None
			file_data = await resp.read()
			file_size = len(file_data)

			if file_size > 1024*1024: # Be careful about files that are too big
				return None

			random_filename = generate_filename(user_id, extension=".png")
			if random_filename == None:
				return None

			# Save to the storage
			try:
				os.makedirs(path_for_user_file(user_id, ''), exist_ok=True)
				with open(path_for_user_file(user_id, random_filename), 'wb') as f:
					f.write(file_data)
				global global_file_upload_size
				global_file_upload_size += file_size
			except:
				return None

			# Add a database entry
			c = Database.cursor()
			c.execute("INSERT INTO User_File_Upload (user_id, created_at, updated_at, name, desc, location, size, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (user_id, datetime.datetime.now(), datetime.datetime.now(), new_file_name, "Copied from "+download_url, None, file_size, random_filename))

			file_id = c.lastrowid
			url = url_for_user_file(user_id, random_filename)
			write_to_file_log(None, "Admin file reupload %d, (size=%d KiB, [url=%s]file[/url], name=%s)" % (file_id, file_size, url, new_file_name))
			update_image_url_everywhere(None, download_url, url)
			return (url, file_id)

def is_hosted_locally(url):
	return url.startswith(Config["FileUpload"]["URLPrefix"])

async def reupload_entity_images(client, args):
	args = args.split()
	if len(args) >= 3 and args[0] == "!": # Upload that's not associated with an entity
		user_id = find_db_id_by_str(args[1])
		if user_id == None:
			client.send("ERR", {'text': "Couldn't find user %s" % args[1]})
			return
		download_url = args[2]
		new_url = await download_and_reupload(download_url, "Image" if len(args) < 4 else args[3], user_id)
		if new_url == None:
			client.send("ERR", {'text': "Couldn't copy file [url]%s[/url]" % download_url})
		else:
			client.send("MSG", {'text': "[url]%s[/url] reuploaded as [url]%s[/url] (%d)" % (download_url, new_url[0], new_url[1])})
	elif len(args) == 1 and string_is_int(args[0]):
		entity_id = int(args[0])
		loaded_entity = get_entity_by_id(entity_id, load_from_db=False)
		c = Database.cursor()

		entity_owner_id = None

		if loaded_entity != None:
			this_entity_type  = loaded_entity.entity_type
			entity_pic        = loaded_entity.pic
			entity_owner_id   = loaded_entity.owner_id or loaded_entity.creator_id
			entity_data       = loaded_entity.data
			entity_compressed = None
			entity_name       = loaded_entity.name
		else:
			c.execute('SELECT type, pic, owner_id, creator_id, data, compressed_data, name FROM Entity WHERE id=?', (entity_id,))
			result = c.fetchone()
			if result == None:
				return "Couldn't find entity"
			this_entity_type, entity_pic, entity_owner_id, entity_creator_id, entity_data, entity_compressed, entity_name = result
			entity_data = loads_if_not_none(entity_data)
			entity_pic = loads_if_not_none(entity_pic)
			entity_owner_id = entity_owner_id or entity_creator_id

		if entity_owner_id == None:
			client.send("ERR", {'text': "Couldn't find entity, or entity has no owner"})
			return

		report = ""
		if this_entity_type == entity_type['image'] and entity_compressed == None and isinstance(entity_data, str) and not is_hosted_locally(entity_data):
			new_image_url = await download_and_reupload(entity_data, entity_name, entity_owner_id)
			if new_image_url == None:
				report = "Couldn't copy image ([url]%s[/url])" % entity_data
			else:
				report = "Reuploaded image; was [url]%s[/url], now [url]%s[/url] (%d)" % (entity_data, new_image_url[0], new_image_url[1])
		if entity_pic != None and isinstance(entity_pic[0], str) and not is_hosted_locally(entity_pic[0]):
			original_pic = entity_pic[0]
			if report != "":
				report += "\n"
			new_image_url = await download_and_reupload(original_pic, entity_name + " pic", entity_owner_id)
			if new_image_url == None:
				report += "Couldn't copy entity pic ([url]%s[/url])" % entity_data
			else:
				report += "Reuploaded entity pic; was [url]%s[/url], now [url]%s[/url] (%d)" % (original_pic, new_image_url[0], new_image_url[1])

			# Don't need to update entities since download_and_reupload will call update_image_url_everywhere

		if report == "":
			client.send("ERR", {'text': 'Nothing to reupload for %d' % entity_id})
		else:
			client.send("MSG", {'text': 'Reupload for %d: %s' % (entity_id, report)})
	else:
		client.send("ERR", {'text': 'Bad arguments for /rehostuserfile'})

@routes.delete('/v1/my_files/file/{id}')
async def delete_file(request):
	global global_file_upload_size
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)
	file_id = request.match_info['id']
	if not file_id.isdecimal():
		raise web.HTTPBadRequest(text="File ID is invalid", headers=CORS_HEADERS)
	file_id = int(file_id)

	c = Database.cursor()
	c.execute('SELECT name, desc, location, filename, size FROM User_File_Upload WHERE user_id=? AND file_id=?', (db_id, file_id))
	result = c.fetchone()
	if result == None:
		raise web.HTTPNotFound(text="File not found", headers=CORS_HEADERS)

	try:
		os.remove(path_for_user_file(db_id, result[3]))
	except:
		pass
	c.execute('DELETE FROM User_File_Upload WHERE file_id=?', (file_id,))
	write_to_file_log(connection, "Delete %d by %s (name=%s)" % (file_id, connection.entity.name_and_username(), result[0]))

	connection.total_file_upload_size -= result[4]
	global_file_upload_size -= result[4]
	raise web.HTTPNoContent(headers=CORS_HEADERS)

@routes.post('/v1/my_files/folder')
async def post_folder(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)

	c = Database.cursor()
	c.execute('SELECT COUNT(*) from User_File_Folder WHERE user_id=?', (db_id,))
	result = c.fetchone()
	if result == None:
		return
	if (result[0] or 0) >= Config["FileUpload"]["AllowedFolderCount"]:
		raise web.HTTPInsufficientStorage(text="You have too many folders (maximum is %d)" % Config["FileUpload"]["AllowedFolderCount"], headers=CORS_HEADERS)

	info = await get_info_from_multipart(request)
	folder = int_if_numeric(info.get("folder")) if info.get("folder") != None else None
	if folder == 0:
		folder = None

	c.execute("INSERT INTO User_File_Folder (user_id, name, desc, location) VALUES (?, ?, ?, ?)", (db_id, info.get("name"), info.get("desc"), folder))
	folder_id = c.lastrowid

	return web.json_response({
		"folder": {
			"id": folder_id,
			"name": info.get("name"),
			"desc": info.get("desc"),
			"folder": folder,
		},
	}, headers=CORS_HEADERS)

@routes.get('/v1/my_files/folder/{id}')
async def get_folder(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)
	folder_id = request.match_info['id']
	if not folder_id.isdecimal():
		raise web.HTTPBadRequest(text="Folder ID is invalid", headers=CORS_HEADERS)
	folder_id = int(file_id)

	c = Database.cursor()
	c.execute('SELECT name, desc, location FROM User_File_Folder WHERE user_id=? AND folder_id=?', (db_id, folder_id))
	result = c.fetchone()
	if result != None:
		return web.json_response({
			"id": file_id,
			"name": result[0],
			"desc": result[1],
			"folder": result[2],
		}, headers=CORS_HEADERS)
	else:
		raise web.HTTPNotFound(text="Folder not found", headers=CORS_HEADERS)

@routes.put('/v1/my_files/folder/{id}')
async def put_folder(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)
	folder_id = request.match_info['id']
	if not folder_id.isdecimal():
		raise web.HTTPBadRequest(text="Folder ID is invalid", headers=CORS_HEADERS)
	folder_id = int(folder_id)

	info = await get_info_from_multipart(request)

	c = Database.cursor()
	c.execute('SELECT name, desc, location FROM User_File_Folder WHERE user_id=? AND folder_id=?', (db_id, folder_id))
	result = c.fetchone()
	if result == None:
		raise web.HTTPNotFound(text="Folder not found", headers=CORS_HEADERS)
	name, desc, location = result

	if "name" in info:
		name = info["name"]
	if "desc" in info:
		desc = info["desc"]
	if "folder" in info:
		location = int_if_numeric(info["folder"]) if info.get("folder") != None else None
		if location == 0:
			location = None

	c = Database.cursor()
	c.execute('UPDATE User_File_Folder SET name=?, desc=?, location=? WHERE folder_id=?', (name, desc, location, folder_id))
	return web.json_response({
		"folder": {
			"id": folder_id,
			"name": name,
			"desc": desc,
			"folder": location,
		},
	}, headers=CORS_HEADERS)

@routes.delete('/v1/my_files/folder/{id}')
async def delete_folder(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden(headers=CORS_HEADERS)
	folder_id = request.match_info['id']
	if not folder_id.isdecimal():
		raise web.HTTPBadRequest(text="Folder ID is invalid", headers=CORS_HEADERS)
	folder_id = int(folder_id)

	c = Database.cursor()
	c.execute('SELECT name, desc, location FROM User_File_Folder WHERE user_id=? AND folder_id=?', (db_id, folder_id))
	result = c.fetchone()
	if result == None:
		raise web.HTTPNotFound(text="Folder not found", headers=CORS_HEADERS)
	c.execute('DELETE FROM User_File_Folder WHERE folder_id=?', (folder_id,))
	raise web.HTTPNoContent(headers=CORS_HEADERS)

if Config["FileUpload"]["AllowCrossOrigin"]:
	@routes.options('/v1/my_files')
	async def list_options(_: web.Request) -> web.Response:
		return web.json_response({"message": "Accept all hosts"}, headers=CORS_HEADERS)
	@routes.options('/v1/my_files/file')
	async def file_options(_: web.Request) -> web.Response:
		return web.json_response({"message": "Accept all hosts"}, headers=CORS_HEADERS)
	@routes.options('/v1/my_files/file/{id}')
	async def file_id_options(_: web.Request) -> web.Response:
		return web.json_response({"message": "Accept all hosts"}, headers=CORS_HEADERS)
	@routes.options('/v1/my_files/folder')
	async def folder_options(_: web.Request) -> web.Response:
		return web.json_response({"message": "Accept all hosts"}, headers=CORS_HEADERS)
	@routes.options('/v1/my_files/folder/{id}')
	async def folder_id_options(_: web.Request) -> web.Response:
		return web.json_response({"message": "Accept all hosts"}, headers=CORS_HEADERS)

# ---------------------------------------------------------

@routes.get('/v1/moderation/rrb')
async def get_rrb(request):
	if (request.query.get('pass') != Config["API"]["AdminPassword"]) or (not Config["API"]["AdminPassword"]):
		return web.Response(status=401, text="🔨🐇")
	css = """summary {
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -khtml-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
	}"""
	response = "<!DOCTYPE html><html><style>%s</style><body>" % css

	item_count = 0
	for r in TempLogs[3]:
		if not r.maps:
			continue
		item_count += 1
		inside = "<kbd>/rrb R %s</kbd> <input></input>" % r.temp_id

		for map_key, map_val in r.maps.items():
			map_inside = "<kbd>/rrb r %s %s</kbd> <input></input><ul>" % (r.temp_id, map_key)
			for row in map_val:
				a = row.splitlines()
				if a[0] == 't':
					map_inside += "<li>T %s,%s: %s | %s</li>" % (escape_tags(a[1]), escape_tags(a[2]), escape_tags(a[3]), escape_tags(a[4]))
				elif a[0] == 'o':
					map_inside += "<li>O %s,%s: %s | %s</li>" % (escape_tags(a[1]), escape_tags(a[2]), escape_tags(a[3]), escape_tags(a[4]))
				elif a[0] == 'd':
					if a[6] == "null" and a[7] == "null":
						map_inside += "<li>D %s,%s,%s,%s | %s</li>" % (escape_tags(a[1]), escape_tags(a[2]), escape_tags(a[3]), escape_tags(a[4]), escape_tags(a[5]))
					else:
						map_inside += "<li>D %s,%s,%s,%s | %s &#8594; %s,%s</li>" % (escape_tags(a[1]), escape_tags(a[2]), escape_tags(a[3]), escape_tags(a[4]), escape_tags(a[5]), escape_tags(a[6]), escape_tags(a[7]))

			map_inside += "</ul>"
			map_header = "%s \"%s\" - #%d" % (map_key, get_entity_name_by_db_id(map_key), len(map_val))
			inside += "<details><summary>%s</summary>%s</details>" % (map_header, map_inside)

		header = escape_tags("%s: %s (%s) @ %s: Built %d, Deleted %d - #%d" % (r.time.strftime("(%Y-%m-%d)"), r.name or "?", r.username or "?", r.ip, r.total_put, r.total_delete, len(r.maps)))
		response += "<details><summary><strong>%s</strong></summary>%s</details><hr>" % (header, inside)
	if item_count == 0:
		response += "Nothing so far!"

	response += "</body></html>"
	return web.Response(text=response, content_type="text/html", charset="utf-8")


# ---------------------------------------------------------

@routes.get('/v1/map_page/{map_id}')
async def get_map_page(request):
	if not Config["MapPage"]["Enabled"]:
		web.Response(status=503, text="Map pages are disabled", headers=MAIN_API_CORS_HEADERS)
	map_ok, map = map_from_id(request.match_info['map_id'])
	if not map_ok:
		return map

	map_x = request.query.get('x', '')
	if map_x.isdecimal():
		map_x = int(map_x)
	else:
		map_x = None
	map_y = request.query.get('y', '')
	if map_y.isdecimal():
		map_y = int(map_y)
	else:
		map_y = None

	map_info = map.map_info()
	MapName  = html.escape(map_info.get("name", ""))
	MapID    = html.escape(str(map_info.get("id", "")))
	MapDesc  = html.escape(map_info.get("desc") or "") or "No description set"
	MetaMapDesc = html.escape(map_info.get("desc") or (map_info.get("owner_username", "Someone")+"'s map"))
	MapOwner = html.escape(map_info.get("owner_username", ""))
	WebClientURL = "%s?map=%s"%(Config["Server"]["WebClientURL"],MapID)
	WebClientTouchURL = "%s?map=%s"%(Config["Server"]["WebClientTouchURL"],MapID)
	if map_x != None and map_y != None:
		params = "%%20%d%%20%d" % (map_x, map_y)
		WebClientURL += params
		WebClientTouchURL += params
	response = Config["MapPage"]["Template"].substitute(
		MapName=MapName,
		MapID=MapID,
		MapDesc=MapDesc,
		MetaMapDesc=MetaMapDesc,
		MapOwner=MapOwner,
		WSURL=Config["Server"]["WSURL"],
		APIURL=Config["API"]["URL"],
		AssetsBaseURL=Config["MapPage"]["AssetsBaseURL"],
		WebClientURL=WebClientURL,
		WebClientTouchURL=WebClientTouchURL,
		ThisPageURL="%s/%s"%(Config["MapPage"]["PageBaseURL"], MapID)
	)
	return web.Response(text=response, content_type="text/html", charset="utf-8")

# ---------------------------------------------------------

async def start_api(loop, port, total_connections):
	global shared_total_connections
	shared_total_connections = total_connections

	app = web.Application()
	app.add_routes(routes)

	runner = web.AppRunner(app)
	await runner.setup()
	site = web.TCPSite(runner, port=port)
	await site.start()

	global global_file_upload_size
	if global_file_upload_size != None:
		return global_file_upload_size
	c = Database.cursor()
	c.execute('SELECT SUM(size) FROM User_File_Upload')
	result = c.fetchone()
	if result != None:
		global_file_upload_size = result[0] or 0
	return global_file_upload_size
