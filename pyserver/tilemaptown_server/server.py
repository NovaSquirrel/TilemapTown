# Tilemap Town
# Copyright (C) 2017-2019 NovaSquirrel
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

import asyncio, datetime, random, websockets, json, sys, traceback
from .buildglobal import *
from .buildmap import *
from .buildclient import *
from .buildprotocol import handle_protocol_command
if Config["Database"]["Setup"]:
	from .database_setup_v2 import *
else:
	reload_database_meta()

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

	# Unload unused maps
	unloaded = set()
	for k,m in AllMapsByDB.items():
		if (m.id not in Config["Server"]["AlwaysLoadedMaps"]) and (len(m.contents) < 1):
			print("Unloading map "+str(k))
			m.save()
			m.clean_up()
			unloaded.add(k)
	for m in unloaded:
		del AllMapsByDB[m]

	# Run server shutdown timer, if it's running
	if ServerShutdown[0] > 0:
		ServerShutdown[0] -= 1
		if ServerShutdown[0] == 1:
			broadcastToAll("Server is going down!")
			for u in AllClients:
				u.disconnect()
			for k,m in AllMaps.items():
				m.save()
		elif ServerShutdown[0] == 0:
			loop.stop()
	if ServerShutdown[0] != 0:
		loop.call_later(1, main_timer)

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

	try:
		while True:
			# Read a message, make sure it's not too short
			message = await websocket.recv()
			if len(message) < 3:
				continue
            # Split the message into parts, to parse it
			command = message[0:3]
			arg = None
			if len(message) > 4:
				arg = json.loads(message[4:])

			# Identify the user and put them on a map
			if command == "IDN":
				result = False
				if arg != None:
					result = client.login(filter_username(arg["username"]), arg["password"])
				if result != True: # default to default map if can't log in
					client.switch_map(get_database_meta('default_map'))
				if len(Config["Server"]["MOTD"]):
					client.send("MSG", {'text': Config["Server"]["MOTD"]})
				client.identified = True
				client.send("MSG", {'text': 'Users connected: %d' % len(AllClients)})
			elif command == "PIN":
				client.ping_timer = 300

			# Don't allow the user to do anything but IDN and PIN unless they've identified
			# Process the command
			elif client.identified:
				client.idle_timer = 0
				if "remote_map" in arg:
					if arg["remote_map"] in AllMapsByDB:
						map = AllMapsByDB[arg["remote_map"]]
						if map.has_permission(client, permission['map_bot'], False):
							handle_protocol_command(map, client, command, arg)
						else:
							client.send("ERR", {'text': 'You do not have [tt]map_bot[/tt] permission on map %d' % arg["remote_map"]})
					else:
						client.send("ERR", {'text': 'Map %d is not loaded' % arg["remote_map"]})
				else:
					handle_protocol_command(client.map, client, command, arg) # client.map may be None

	except websockets.ConnectionClosed:
		print("disconnected: %s (%s, \"%s\")" % (client.ip, client.username or "?", client.name))
	except:
		print("Unexpected error:", sys.exc_info()[0])
		print(sys.exc_info()[1])
		traceback.print_tb(sys.exc_info()[2])
	#	raise

	client.cleanup()
	if client.db_id:
		client.save_and_commit()

	# remove the user from all clients' views
	if client.map != None:
		client.map.remove_from_contents(client)

global loop

def main():
	global loop
	start_server = websockets.serve(client_handler, None, Config["Server"]["Port"], max_size=Config["Server"]["WSMaxSize"], max_queue=Config["Server"]["WSMaxQueue"])

	# Start the event loop
	loop = asyncio.get_event_loop()
	loop.call_soon(main_timer)
	loop.run_until_complete(start_server)
	print("Server started!")

	try:
		loop.run_forever()
	except KeyboardInterrupt:
		print("Shutting the server down...")
		ServerShutdown = [1]
	finally:
		loop.close()

		main_timer()
		Database.commit()
		print("Closing the database")
		Database.close()

if __name__ == "__main__":
	main()
