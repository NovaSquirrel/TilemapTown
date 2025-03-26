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
import asyncio, datetime, random, websockets, json, sys, traceback, time
from .buildglobal import *
from .buildmap import *
from .buildclient import *
from .buildgadget import *
from .buildprotocol import handle_protocol_command, protocol_command_already_received
from .buildapi import start_api
from .buildscripting import run_scripting_service, shutdown_scripting_service
if Config["Database"]["Setup"]:
	from .database_setup_v2 import *
else:
	reload_database_meta()

# To share with API
total_connections = [0, 0, 0]

# Timer that runs and performs background tasks
async def main_timer():
	global ServerShutdown
	loop = asyncio.get_event_loop()

	while True:
		# Let requests expire
		removeFromAllEntitiesWithRequests = set()
		for c in AllEntitiesWithRequests:
			if c.requests == {}:
				removeFromAllEntitiesWithRequests.add(c)
				continue
			# Remove requests that time out
			remove_requests = set()
			for k,v in c.requests.items():
				v[0] -= 1 # remove 1 from timer
				if v[0] < 0:
					remove_requests.add(k)
			for r in remove_requests:
				del c.requests[r]
		for c in removeFromAllEntitiesWithRequests:
			AllEntitiesWithRequests.discard(c)

		# Remove rate limiting information that's too old
		current_minute = int(time.monotonic() // 60)
		removeFromAllEntitiesWithRateLimiting = set()
		for c in AllEntitiesWithRateLimiting:
			# Stop tracking this entity because there's no longer any rate limiting info
			if c.rate_limiting == {}:
				removeFromAllEntitiesWithRateLimiting.add(c)
				continue

			# Remove rate limiting info that's too old
			removed_type = set()
			for type_name,type_data in c.rate_limiting.items():
				while len(type_data) and current_minute >= (type_data[0][0] + 10): # Remove information from >= 10 minutes ago
					type_data.popleft()
				if len(type_data) == 0:
					removed_type.add(type_name)
			for r in removed_type:
				del c.rate_limiting[r]
		for c in removeFromAllEntitiesWithRateLimiting:
			AllEntitiesWithRateLimiting.discard(c)
		c = None

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
			if ServerShutdown[0] == 2:
				if Config["Scripting"]["Enabled"]:
					shutdown_scripting_service()
			elif ServerShutdown[0] == 1:
				broadcast_to_all("Server is going down!")
				for u in AllConnections:
					u.disconnect(reason='Restart' if ServerShutdown[1] else 'Shutdown')
				save_everything()
			elif ServerShutdown[0] == 0:
				loop.stop()

		await asyncio.sleep(1)

def save_everything():
	for e in AllEntitiesByDB.values():
		if (e.save_on_clean_up and not e.temporary) or (e.is_client() and e.db_id):
			e.save()
			e.save_on_clean_up = False

	# Convert offline messages to mail
	c = Database.cursor()
	for recipient_db_id, senders in OfflineMessages.items():
		print("Converting offline messages for %d into mail" % recipient_db_id)
		for sender_db_id, queue in senders.items():
			if len(queue) == 0:
				continue
			messages_in_queue = ''.join(["[li]%s: %s[/li]" % (_[1].strftime("%Y-%m-%d"), _[0]) for _ in queue])
			subject = "(Automatic mail) %d offline message%s" % (len(queue), "s" if len(queue) != 1 else "")
			contents = "The server restarted while you had messages waiting for you, so the following offline messages were converted to mail: [ul]"+messages_in_queue+"[/ul]"
			c.execute("INSERT INTO Mail (owner_id, sender_id, recipients, subject, contents, created_at, flags) VALUES (?, ?, ?, ?, ?, ?, ?)", (recipient_db_id, sender_db_id, str(recipient_db_id), subject, contents, datetime.datetime.now(), 0))

# Websocket connection handler
async def client_handler(websocket):
	ip = websocket.remote_address[0]

	# If the local and remote addresses are the same, it's trusted
	# and the server should look for the forwarded IP address
	if websocket.local_address[0] == websocket.remote_address[0]:
		if 'X-Real-IP' in websocket.request.headers:
			ip = websocket.request.headers['X-Real-IP']
		else:
			ip = ''
	elif Config["Security"]["ProxyOnly"]:
		asyncio.ensure_future(websocket.close(reason="ProxyOnly"))
		return

	origin = websocket.request.headers.get('Origin')

	if Config["Security"]["AllowedOrigins"]:
		if not any(_ == origin for _ in Config["Security"]["AllowedOrigins"]):
			print("Origin \"%s\" from IP %s not allowlisted" % (origin, ip))
			asyncio.ensure_future(websocket.close(reason="BadOrigin"))
			total_connections[2] += 1 # Prevented connections
			return
	if Config["Security"]["BannedOrigins"] and websocket.request.headers['Origin'] and any(_ in origin for _ in Config["Security"]["BannedOrigins"]):
		print("Banned origin \"%s\" from IP %s" % (origin, ip))
		asyncio.ensure_future(websocket.close(reason="BadOrigin"))
		total_connections[2] += 1
		return

	connection = Connection(websocket, ip)
	if connection.test_server_banned():
		total_connections[1] += 1
		return
	AllConnections.add(connection)

	write_to_connect_log("connected: %s, %s" % (ip, origin))
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
				if len(message) > (Config["MaxProtocolSize"].get(command) or Config["MaxProtocolSize"]["Default"]):
					connection.protocol_error(echo, text='Received protocol message that was too big: %s' % command, code='protocol_too_big', detail=command)
					continue
				arg = json.loads(message[4:])

			# Process the command
			connection.idle_timer = 0
			echo = arg.get("echo")
			ack_req = arg.get("ack_req")
			if isinstance(ack_req, str):
				ack_req = ack_req[:40] # Allow room for a UUID
			elif isinstance(ack_req, int):
				pass
			else:
				ack_req = None
			if "remote_map" in arg:
				map_id = arg["remote_map"]
				map = get_entity_by_id(map_id, load_from_db=False)
				if map != None:
					if connection.entity.has_permission(map, permission['map_bot'], False) \
					or (command == 'MSG' and connection.entity.has_permission(map, permission['remote_chat'], False)):
						connection.start_batch()
						skip = False
						if ack_req and connection.db_id and connection.db_id in AcknowlegeRequestResult:
							for item in AcknowlegeRequestResult[connection.db_id]:
								if item[0] == ack_req:
									protocol_command_already_received(connection, map, connection.entity, command, arg, echo, ack_req, item[1])
									skip = True
						if not skip:
							handle_protocol_command(connection, map, connection.entity, command, arg, echo, ack_req)
						connection.finish_batch()
					else:
						connection.entity.send("ERR", {
							'text': 'You do not have [tt]%s[/tt] permission on map %d' % ('remote_chat' if command == 'MSG' else 'map_bot', arg["remote_map"]),
							'code':'missing_permission',
							'detail':'map_bot',
							'subject_id': arg["remote_map"],
							'echo': echo
						})
				elif command == 'MSG' and isinstance(map_id, int) and connection.entity.has_permission(map_id, (permission['remote_chat'], permission['map_bot']), False):
					handle_protocol_command(connection, map_id, connection.entity, command, arg, echo, ack_req)
				else:
					connection.entity.send("ERR", {'text': 'Map %s is not loaded' % map_id, 'code': 'not_loaded', 'subject_id': map_id, 'echo': echo})
			else:
				connection.start_batch()
				skip = False
				if ack_req and connection.db_id and connection.db_id in AcknowlegeRequestResult:
					for item in AcknowlegeRequestResult[connection.db_id]:
						if item[0] == ack_req:
							protocol_command_already_received(connection, connection.entity.map, connection.entity, command, arg, echo, ack_req, item[1])
							skip = True
				if not skip:
					handle_protocol_command(connection, connection.entity.map, connection.entity, command, arg, echo, ack_req) # client.map may be None
				connection.finish_batch()

		except websockets.ConnectionClosed:
			if isinstance(connection.entity, Client) and connection.identified: # Only announce if they're actually in the world as an entity
				if Config["Server"]["BroadcastDisconnects"]:
					text = '%s has disconnected!' % connection.entity.name_and_username()
					for u in AllClients:
						if u is not connection.entity:
							u.send("MSG", {'text': text})

				# Leave a note about what the user did while connected
				disconnect_extra = ""
				if connection.build_count or connection.delete_count:
					disconnect_extra = " -  Built %d, Deleted %d" % (connection.build_count, connection.delete_count)
				write_to_connect_log("disconnected: %s (%s, \"%s\")%s" % (ip, connection.entity.username or "?", connection.entity.name, disconnect_extra))
			elif connection.identified:
				write_to_connect_log("disconnected: %s (%s, logged in elsewhere)" % (ip, connection.username))
			else:
				write_to_connect_log("disconnected: %s (didn't identify)" % ip)
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
			#raise

	# Clean up connection, including any listens the connection had
	listens = set(connection.listening_maps)
	for category, map_id in listens:
		connection.unlisten(map_id, category)
	for e in connection.cleanup_entities_on_logout:
		e.clean_up()

	# Let watchers know
	if connection.db_id and connection.can_be_watched():
		who_info = {"remove": connection.db_id, "type": "watch"}
		for other in AllConnections:
			if other.user_watch_with_who and connection.username in other.watch_list:
				other.send("WHO", who_info)

	# Clean up the entity, if it isn't just a placeholder
	if isinstance(connection.entity, Client):
		if connection.entity.db_id:
			connection.entity.save_on_clean_up = True
		connection.entity.clean_up()
	elif connection.db_id:
		connection.save_settings(connection.db_id)
	if connection.entity != None:
		connection.entity = None
	AllConnections.discard(connection)

global loop

async def async_main():
	websocket_server = await websockets.serve(client_handler, None, Config["Server"]["Port"], max_size=Config["Server"]["WSMaxSize"], max_queue=Config["Server"]["WSMaxQueue"], origins=Config["Security"]["AllowedOrigins2"])
	server_task = asyncio.create_task(websocket_server.serve_forever())
	timer_task = asyncio.create_task(main_timer())
	if Config["Scripting"]["Enabled"]:
		scripting_service_task = asyncio.create_task(run_scripting_service())

	if Config["API"]["Enabled"]:
		await start_api(asyncio.get_event_loop(), Config["API"]["Port"], total_connections=total_connections)
	await server_task

def main():
	try:
		asyncio.run(async_main())
	except KeyboardInterrupt:
		print("Shutting the server down...")
		save_everything()
	finally:
		Database.commit()
		print("Closing the database")
		Database.close()

		if BuildLog:
			BuildLog.close()
		if UploadLog:
			UploadLog.close()

if __name__ == "__main__":
	main()
