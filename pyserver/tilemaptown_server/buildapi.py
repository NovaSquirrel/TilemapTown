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
import time
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

def start_api(loop, port, total_connections):
	global shared_total_connections
	shared_total_connections = total_connections

	app = web.Application()
	app.add_routes(routes)

	runner = web.AppRunner(app)
	loop.run_until_complete(runner.setup())
	site = web.TCPSite(runner, port=port)
	loop.run_until_complete(site.start())
