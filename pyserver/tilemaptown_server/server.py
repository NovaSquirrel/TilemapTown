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
import asyncio, datetime, random, websockets, json, sys, traceback, weakref
from .buildglobal import *
from .buildmap import *
from .buildclient import *
from .buildprotocol import handle_protocol_command
from .buildapi import start_api
if Config["Database"]["Setup"]:
	from .database_setup_v2 import *
else:
	reload_database_meta()

# To share with API
total_connections = [0]

# Timer that runs and performs background tasks
def main_timer():
	global ServerShutdown
	global loop

	# Let requests expire
	for c in AllClients:
		# Remove requests that time out
		remove_requests = set()
		for k,v in c.requests.items():
			v[0] -= 1 # remove 1 from timer
			if v[0] < 0: 
				remove_requests.add(k)
		for r in remove_requests:
			del c.requests[r]

	# Disconnect pinged-out users
	for connection in AllConnections:
		connection.idle_timer += 1

		# Remove users that time out
		connection.ping_timer -= 1
		if connection.ping_timer == 60 or connection.ping_timer == 30:
			connection.send("PIN", None)
		elif connection.ping_timer < 0:
			connection.disconnect(reason="PingTimeout")

	# Run server shutdown timer, if it's running
	if ServerShutdown[0] > 0:
		ServerShutdown[0] -= 1
		if ServerShutdown[0] == 1:
			broadcast_to_all("Server is going down!")
			for u in AllConnections:
				u.disconnect(reason='Restart' if ServerShutdown[1] else 'Shutdown')
			save_everything()
		elif ServerShutdown[0] == 0:
			loop.stop()
	if ServerShutdown[0] != 0:
		loop.call_later(1, main_timer)

def save_everything():
	for e in AllEntitiesByDB.values():
		if (e.save_on_clean_up and not e.temporary) or (e.is_client() and e.db_id):
			e.save()
			e.save_on_clean_up = False

# Websocket connection handler
async def client_handler(websocket, path):
	ip = websocket.remote_address[0]

	# If the local and remote addresses are the same, it's trusted
	# and the server should look for the forwarded IP address
	if websocket.local_address[0] == websocket.remote_address[0]:
		if 'X-Real-IP' in websocket.request_headers:
			ip = websocket.request_headers['X-Real-IP']
		else:
			ip = ''
	connection = Connection(websocket, ip)
	if connection.test_server_banned():
		return
	AllConnections.add(connection)

	print("connected: %s %s" % (path, ip))
	total_connections[0] += 1

	while connection.ws != None:
		try:
			# Read a message, make sure it's not too short
			message = await websocket.recv()
			if len(message)<3:
				continue
			# Split the message into parts, to parse it
			command = message[0:3]
			arg = {}
			if len(message) > 4:
				arg = json.loads(message[4:])

			# Process the command
			connection.idle_timer = 0
			echo = arg.get("echo", None)
			if "remote_map" in arg:
				if arg["remote_map"] in AllEntitiesByDB:
					map = AllEntitiesByDB[arg["remote_map"]]
					if map.has_permission(connection.entity, permission['map_bot'], False):
						handle_protocol_command(map, connection.entity, command, arg, echo)
					else:
						connection.entity.send("ERR", {'text': 'You do not have [tt]map_bot[/tt] permission on map %d' % arg["remote_map"], 'code':'missing_permission', 'detail':'map_bot', 'subject_id': arg["remote_map"], 'echo': echo})
				else:
					connection.entity.send("ERR", {'text': 'Map %d is not loaded' % arg["remote_map"], 'code': 'not_loaded', 'subject_id': arg["remote_map"], 'echo': echo})
			else:
				handle_protocol_command(connection.entity.map, connection.entity, command, arg, echo) # client.map may be None

		except websockets.ConnectionClosed:
			if isinstance(connection.entity, Client):
				if Config["Server"]["BroadcastDisconnects"]:
					text = '%s has disconnected!' % connection.entity.name_and_username()
					for u in AllClients:
						if u is not connection.entity:
							u.send("MSG", {'text': text})

				# Leave a note about what the user did while connected
				disconnect_extra = ""
				if connection.entity.build_count or connection.entity.delete_count:
					disconnect_extra = " -  Built %d, Deleted %d" % (connection.entity.build_count, connection.entity.delete_count)
				print("disconnected: %s (%s, \"%s\")%s" % (ip, connection.entity.username or "?", connection.entity.name, disconnect_extra))
			elif connection.identified:
				print("disconnected: %s (%s, logged in elsewhere)" % (ip, connection.username))
			else:
				print("disconnected: %s (didn't identify)" % ip)
			connection.ws = None
		except:
			exception_type = sys.exc_info()[0]
			connection.entity.send("ERR", {'text': 'An exception was thrown: %s' % exception_type.__name__, 'code': 'exception', 'detail': exception_type.__name__})
			if isinstance(connection.entity, Client):
				while connection.make_batch:
					connection.finish_batch()
			print("Unexpected error:", sys.exc_info()[0])
			print(sys.exc_info()[1])
			traceback.print_tb(sys.exc_info()[2])
		#	raise

	# Clean up the entity, if it isn't just a placeholder
	if isinstance(connection.entity, Client):
		if connection.entity.db_id:
			connection.entity.save_on_clean_up = True
		for e in connection.entity.cleanup_entities_on_logout:
			e.clean_up()
		connection.entity.clean_up()
	if connection.entity != None:
		del connection.entity

global loop

def main():
	global loop
	start_server = websockets.serve(client_handler, None, Config["Server"]["Port"], max_size=Config["Server"]["WSMaxSize"], max_queue=Config["Server"]["WSMaxQueue"])

	# Start the event loop
	loop = asyncio.get_event_loop()
	loop.call_soon(main_timer)
	loop.run_until_complete(start_server)

	if Config["API"]["Enabled"]:
		start_api(loop, Config["API"]["Port"], total_connections=total_connections)

	print("Server started!")

	try:
		loop.run_forever()
	except KeyboardInterrupt:
		print("Shutting the server down...")
		save_everything()
	finally:
		Database.commit()
		print("Closing the database")
		Database.close()

		if BuildLog:
			BuildLog.close()

if __name__ == "__main__":
	main()
