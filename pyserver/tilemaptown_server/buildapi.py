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
import time, os, random
from aiohttp import web
from .buildglobal import *

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

def write_to_file_log(text):
	now = datetime.datetime.today().strftime("(%Y-%m-%d) %I:%M %p")
	TempLogs[2].append(now + ": " + text)

def get_connection_from_api_key(request):
	authorization = request.headers.get("Authorization")
	if isinstance(authorization, str) and authorization.startswith("Bearer "):
		token = authorization[7:]
		connection = ConnectionsByApiKey.get(token)
		if connection:
			return connection
	raise web.HTTPUnauthorized()

def url_for_user_file(db_id, filename):
	return "%s/%s/%s" % (Config["FileUpload"]["URLPrefix"], str(db_id), filename)

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

global_file_upload_size = None
def storage_limit_for_everyone():
	global global_file_upload_size
	if global_file_upload_size != None:
		return global_file_upload_size
	c = Database.cursor()
	c.execute('SELECT SUM(size) FROM User_File_Upload')
	result = c.fetchone()
	if result != None:
		global_file_upload_size = result[0] or 0
	return global_file_upload_size

multipart_text_names = {"name", "desc", "folder"}
multipart_bool_names = {"keep_url"}
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
				raise web.HTTPBadRequest(text="Boolean field not 'true' or 'false'")
			out[field.name] = lowered == "true"
		elif field.name in multipart_file_names:
			data = await field.read_chunk(size=Config["FileUpload"]["MaximumFileSize"]*1024)
			if await field.read_chunk(size=1):
				raise web.HTTPRequestEntityTooLarge(text="Files may be %d KiB at most" % Config["FileUpload"]["MaximumFileSize"])
			out[field.name] = data
			out[field.name + "name"] = field.filename
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

@routes.get('/v1/my_files')
async def file_list(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()

	out = {
		"files": {},
		"folders": {}, 
		"info": storage_info_for_connection(connection),
	}
	c = Database.cursor()
	for row in c.execute('SELECT file_id, created_at, updated_at, name, desc, location, filename, size FROM User_File_Upload WHERE user_id=?', (db_id,)):
		out["files"][row[0]] = {
			"id": row[0],
			"name": row[3],
			"desc": row[4],
			"folder": row[5],
			"created_at": row[1],
			"updated_at": row[2],
			"size": row[7],
			"url": url_for_user_file(row[6]),
		}
	for row in c.execute('SELECT folder_id, name, desc, location FROM User_File_Folder WHERE user_id=?', (db_id,)):
		out["folders"][row[0]] = {
			"id": row[0],
			"name": row[1],
			"desc": row[2],
			"folder": row[3],
		}
	return web.json_response(out)

@routes.post('/v1/my_files/file')
async def post_file(request):
	global global_file_upload_size
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()
	info = await get_info_from_multipart(request)
	if "file" not in info:
		raise web.HTTPBadRequest(text="Must include a file to upload")
	file_data = info["file"]

	if len(file_data) + connection.total_file_upload_size > storage_limit_for_connection(connection):
		raise web.HTTPInsufficientStorage(text="This upload would put you over your storage limit")
	if len(file_data) + storage_limit_for_everyone() > Config["FileUpload"]["SizeLimitTotal"]*1024:
		raise web.HTTPInsufficientStorage(text="This upload would put the server over its storage limit")

	random_filename = generate_filename(db_id)
	if random_filename == None:
		raise web.HTTPInternalServerError()
	folder = int_if_numeric(info.get("folder")) if info.get("folder") != None else None

	c = Database.cursor()
	c.execute("INSERT INTO User_File_Upload (user_id, created_at, updated_at, name, desc, location, size, filename) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (db_id, datetime.datetime.now(), datetime.datetime.now(), info.get("name"), info.get("desc"), folder, len(file_data), random_filename))
	file_id = c.lastrowid

	os.makedirs(path_for_user_file(db_id, ''), exist_ok=True)
	with open(path_for_user_file(db_id, random_filename), 'wb') as f:
		f.write(file_data)

	connection.total_file_upload_size += len(file_data)
	global_file_upload_size += len(file_data)
	write_to_file_log("Upload: %s, %d KiB, %s" % (connection.entity.name_and_username(), len(file_data)//1024, url_for_user_file(db_id, random_filename)))
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
	})

@routes.get('/v1/my_files/file/{id}')
async def get_file(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()
	file_id = request.match_info['id']
	if not file_id.isdecimal():
		raise web.HTTPBadRequest(text="File ID is invalid")
	file_id = int(file_id)

	c = Database.cursor()
	c.execute('SELECT created_at, updated_at, name, desc, location, filename, size FROM User_File_Upload WHERE user_id=? AND file_id=?', (db_id, file_id))
	result = c.fetchone()
	if result != None:
		return web.json_response({
			"name": row[2],
			"desc": row[3],
			"folder": row[4],
			"created_at": row[0],
			"updated_at": row[1],
			"size": row[6],
			"url": url_for_user_file(row[5]),
		})
	else:
		raise web.HTTPNotFound(text="File not found")

@routes.put('/v1/my_files/file/{id}')
async def put_file(request):
	global global_file_upload_size
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()
	file_id = request.match_info['id']
	if not file_id.isdecimal():
		raise web.HTTPBadRequest(text="File ID is invalid")
	file_id = int(file_id)

	c = Database.cursor()
	c.execute('SELECT name, desc, location, filename, size FROM User_File_Upload WHERE user_id=? AND file_id=?', (db_id, file_id))
	result = c.fetchone()
	if result == None:
		raise web.HTTPNotFound(text="File not found")
	name, desc, location, original_filename, original_size = result
	new_filename = original_filename
	new_size = original_size
	info = await get_info_from_multipart(request)

	if "file" in info:
		file_data = info["file"]
		new_size = len(file_data)
		if (-original_size + new_size + connection.total_file_upload_size) > storage_limit_for_connection(connection):
			raise web.HTTPInsufficientStorage(text="This upload would put you over your storage limit")
		if (-original_size + new_size + storage_limit_for_everyone()) > Config["FileUpload"]["SizeLimitTotal"]*1024:
			raise web.HTTPInsufficientStorage(text="This upload would put the server over its storage limit")

		if not info.get("keep_url"):
			random_filename = generate_filename(db_id)
			if random_filename == None:
				raise web.HTTPInternalServerError()
			os.rename(path_for_user_file(db_id, original_filename), path_for_user_file(db_id, random_filename))
			new_filename = random_filename
		with open(path_for_user_file(db_id, new_filename), 'wb') as f:
			f.write(file_data)
		connection.total_file_upload_size = connection.total_file_upload_size + new_size - original_size
		global_file_upload_size = global_file_upload_size + new_size - original_size

		write_to_file_log("Reupload: %s, %d KiB, %s" % (connection.entity.name_and_username(), len(file_data)//1024, url_for_user_file(db_id, new_filename)))
	if "name" in info:
		name = info["name"]
	if "desc" in info:
		desc = info["desc"]
	if "folder" in info:
		location = int_if_numeric(info["folder"]) if info.get("folder") != None else None

	c = Database.cursor()
	c.execute("UPDATE User_File_Upload SET updated_at=?, name=?, desc=?, location=?, filename=?, size=? WHERE file_id=?", (datetime.datetime.now(), name, desc, location, new_filename, new_size, file_id))

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
	})

@routes.delete('/v1/my_files/file/{id}')
async def delete_file(request):
	global global_file_upload_size
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()
	file_id = request.match_info['id']
	if not file_id.isdecimal():
		raise web.HTTPBadRequest(text="File ID is invalid")
	file_id = int(file_id)

	c = Database.cursor()
	c.execute('SELECT name, desc, location, filename, size FROM User_File_Upload WHERE user_id=? AND file_id=?', (db_id, file_id))
	result = c.fetchone()
	if result == None:
		raise web.HTTPNotFound(text="File not found")

	try:
		os.remove(path_for_user_file(db_id, result[3]))
	except:
		pass
	c.execute('DELETE FROM User_File_Upload WHERE file_id=?', (file_id,))
	write_to_file_log("Delete: %s" % (connection.entity.name_and_username()))

	connection.total_file_upload_size -= result[4]
	global_file_upload_size -= result[4]
	raise web.HTTPNoContent()

@routes.post('/v1/my_files/folder')
async def post_folder(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()

@routes.get('/v1/my_files/folder/{id}')
async def get_folder(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()
	folder_id = request.match_info['id']
	if not folder_id.isdecimal():
		raise web.HTTPBadRequest(text="Folder ID is invalid")
	folder_id = int(file_id)

	c = Database.cursor()
	c.execute('SELECT folder_id, name, desc, location FROM User_File_Folder WHERE user_id=? AND folder_id=?', (db_id, folder_id))
	result = c.fetchone()
	if result != None:
		return web.json_response({
			"id": row[0],
			"name": row[1],
			"desc": row[2],
			"folder": row[3],
		})
	else:
		raise web.HTTPNotFound(text="Folder not found")

@routes.put('/v1/my_files/folder/{id}')
async def put_folder(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()
	folder_id = request.match_info['id']
	if not folder_id.isdecimal():
		raise web.HTTPBadRequest(text="Folder ID is invalid")
	folder_id = int(file_id)

@routes.delete('/v1/my_files/folder/{id}')
async def delete_folder(request):
	connection = get_connection_from_api_key(request)
	db_id = connection.db_id
	if db_id == None:
		raise web.HTTPForbidden()
	folder_id = request.match_info['id']
	if not folder_id.isdecimal():
		raise web.HTTPBadRequest(text="Folder ID is invalid")
	folder_id = int(file_id)


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
