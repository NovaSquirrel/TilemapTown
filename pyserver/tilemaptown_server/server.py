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

	# Disconnect pinged-out users
	for c in AllClients:
		# Remove requests that time out
		remove_requests = set()
		for k,v in c.requests.items():
			v[0] -= 1 # remove 1 from timer
			if v[0] < 0: 
				remove_requests.add(k)
		for r in remove_requests:
			del c.requests[r]

		c.idle_timer += 1

		# Remove users that time out
		c.ping_timer -= 1
		if c.ping_timer == 60 or c.ping_timer == 30:
			c.send("PIN", None)
		elif c.ping_timer < 0:
			c.disconnect()

	# Run server shutdown timer, if it's running
	if ServerShutdown[0] > 0:
		ServerShutdown[0] -= 1
		if ServerShutdown[0] == 1:
			broadcast_to_all("Server is going down!")
			for u in AllClients:
				u.disconnect()
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
	client = Client(websocket)
	client.ip = websocket.remote_address[0]

	# If the local and remote addresses are the same, it's trusted
	# and the server should look for the forwarded IP address
	if websocket.local_address[0] == websocket.remote_address[0]:
		if 'X-Real-IP' in websocket.request_headers:
			client.ip = websocket.request_headers['X-Real-IP']
		else:
			client.ip = ''

	if client.test_server_banned():
		return

	print("connected: %s %s" % (path, client.ip))
	total_connections[0] += 1

	while client.ws != None:
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
			client.idle_timer = 0
			echo = arg.get("echo", None)
			if "remote_map" in arg:
				if arg["remote_map"] in AllEntitiesByDB:
					map = AllEntitiesByDB[arg["remote_map"]]
					if map.has_permission(client, permission['map_bot'], False):
						handle_protocol_command(map, client, command, arg, echo)
					else:
						client.send("ERR", {'text': 'You do not have [tt]map_bot[/tt] permission on map %d' % arg["remote_map"], 'code':'missing_permission', 'detail':'map_bot', 'subject_id': arg["remote_map"], 'echo': echo})
				else:
					client.send("ERR", {'text': 'Map %d is not loaded' % arg["remote_map"], 'code': 'not_loaded', 'subject_id': arg["remote_map"], 'echo': echo})
			else:
				handle_protocol_command(client.map, client, command, arg, echo) # client.map may be None

		except websockets.ConnectionClosed:
			if Config["Server"]["BroadcastDisconnects"] and client.identified:
				text = '%s has disconnected!' % client.name_and_username()
				for u in AllClients:
					if u is not client:
						u.send("MSG", {'text': text})

			disconnect_extra = ""
			if client.build_count or client.delete_count:
				disconnect_extra = " -  Built %d, Deleted %d" % (client.build_count, client.delete_count)
			print("disconnected: %s (%s, \"%s\")%s" % (client.ip, client.username or "?", client.name, disconnect_extra))
			client.ws = None
		except:
			exception_type = sys.exc_info()[0]
			client.send("ERR", {'text': 'An exception was thrown: %s' % exception_type.__name__, 'code': 'exception', 'detail': exception_type.__name__})
			while client.make_batch:
				client.finish_batch()
			print("Unexpected error:", sys.exc_info()[0])
			print(sys.exc_info()[1])
			traceback.print_tb(sys.exc_info()[2])
		#	raise

	if client.db_id:
		client.save_on_clean_up = True
	client.clean_up()
	del client

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
