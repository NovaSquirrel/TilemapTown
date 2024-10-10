# Tilemap Town
# Copyright (C) 2017-2024 NovaSquirrel
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
import time, os, random, json
from aiohttp import web
from .buildglobal import *
from .buildentity import Entity

start_time = int(time.time())

routes = web.RouteTableDef()
@routes.get('/v1/town_info')
async def town_info(request):
	global connection_count
	now = int(time.time())

	where_are = {}
	for m in AllMaps:
		if m.map_flags & mapflag['public'] == 0:
			continue
		user_count = m.count_users_inside()
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

	data = {}
	data['stats']  = stats
	data['users']  = users
	data['maps']   = where_are
	data['server'] = server
	return web.json_response(data)

@routes.get('/v1/server_version')
async def server_version(request):
	return web.json_response(server_version_dict)

@routes.get('/v1/server_resources')
async def server_resources(request):
	return web.json_response(ServerResources)

@routes.get('/v1/map/{map_id}')
async def map_info(request):
	map_id = request.match_info['map_id']
	if not map_id.isdecimal():
		return web.Response(status=400, text="Map ID is invalid")
	map_id = int(map_id)

	if not map_id_exists(map_id):
		return web.Response(status=404, text="Couldn't find map")
	map = get_entity_by_id(map_id)

	if map == None:
		return web.Response(status=400, text="Couldn't load map")
	if map.map_flags & mapflag['public'] == 0:
		return web.Response(status=401, text="Map isn't public")

	data = {}
	if int(request.query.get('info', 1)):
		data["info"] = map.map_info()
	try:
		if int(request.query.get('data', 0)):
			data["data"] = map.map_section(0, 0, map.width-1, map.height-1)
	except:
		pass
	return web.json_response(data)

@routes.get('/v1/tsd/{id}')
async def get_tsd(request):
	entity_id = request.match_info['id']
	if not entity_id.isdecimal():
		return web.Response(status=400, text="Tileset ID is invalid")
	entity_id = int(entity_id)

	# Get and return the data
	c = Database.cursor()
	c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type('tileset'), entity_id,))
	result = c.fetchone()
	if result == None:
		return web.Response(status=404, text="Couldn't find tileset")
	else:
		return web.json_response({'id': entity_id, 'data': decompress_entity_data(result[0], result[1])})

@routes.get('/v1/img/{id}')
async def get_img(request):
	entity_id = request.match_info['id']
	if not entity_id.isdecimal():
		return web.Response(status=400, text="Image ID is invalid")
	entity_id = int(entity_id)

	# Get and return the data
	c = Database.cursor()
	c.execute('SELECT data, compressed_data FROM Entity WHERE type=? AND id=?', (entity_type['image'], entity_id,))
	result = c.fetchone()
	if result == None:
		return web.Response(status=404, text="Couldn't find image")
	else:
		return web.json_response({'id': entity_id, 'url': loads_if_not_none(decompress_entity_data(result[0], result[1]))})

# ---------------------------------------------------------
global_file_upload_size = 0

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

def uploaded_file_is_ok(data):
	return data.startswith(bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) # Magic number for PNG files

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
			out[field.name + "name"] = field.filename

			if not uploaded_file_is_ok(data):
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

	# Check the size of the file
	if len(file_data) + connection.total_file_upload_size > storage_limit_for_connection(connection):
		raise web.HTTPInsufficientStorage(text="This upload would put you over your storage limit", headers=CORS_HEADERS)
	if len(file_data) + global_file_upload_size > Config["FileUpload"]["SizeLimitTotal"]*1024:
		raise web.HTTPInsufficientStorage(text="This upload would put the server over its storage limit", headers=CORS_HEADERS)

	random_filename = generate_filename(db_id)
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
	write_to_file_log(connection, "Upload %d by %s, (size=%d KiB, [url=%s]file[/url], name=%s)" % (file_id, connection.entity.name_and_username(), len(file_data)//1024, url_for_user_file(db_id, random_filename), info.get("name")))

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
		new_size = len(file_data)
		if (-original_size + new_size + connection.total_file_upload_size) > storage_limit_for_connection(connection):
			raise web.HTTPInsufficientStorage(text="This upload would put you over your storage limit", headers=CORS_HEADERS)
		if (-original_size + new_size + global_file_upload_size) > Config["FileUpload"]["SizeLimitTotal"]*1024:
			raise web.HTTPInsufficientStorage(text="This upload would put the server over its storage limit", headers=CORS_HEADERS)
		if not info.get("keep_url"):
			random_filename = generate_filename(db_id)
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
			write_to_file_log(connection, "Reupload %d by %s, (size=%d KiB, [url=%s]file[/url], name=%s)" % (file_id, connection.entity.name_and_username(), len(file_data)//1024, url_for_user_file(db_id, new_filename), name))
		except:
			write_to_file_log(connection, "Reupload failed %d" % file_id)
			raise web.HTTPInternalServerError(text="Couldn't write the file", headers=CORS_HEADERS)

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

def start_api(loop, port, total_connections):
	global shared_total_connections
	shared_total_connections = total_connections

	app = web.Application()
	app.add_routes(routes)

	runner = web.AppRunner(app)
	loop.run_until_complete(runner.setup())
	site = web.TCPSite(runner, port=port)
	loop.run_until_complete(site.start())

	global global_file_upload_size
	if global_file_upload_size != None:
		return global_file_upload_size
	c = Database.cursor()
	c.execute('SELECT SUM(size) FROM User_File_Upload')
	result = c.fetchone()
	if result != None:
		global_file_upload_size = result[0] or 0
	return global_file_upload_size
