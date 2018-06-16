# Tilemap Town
# Copyright (C) 2017 NovaSquirrel
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

import asyncio, datetime, random, websockets, json, sys
from buildglobal import *
from buildmap import *
from buildclient import *

# Timer that runs and performs background tasks
def mainTimer():
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
	for m in AllMaps:
		if (m.id != 0) and (len(m.users) < 1):
			print("Unloading map "+str(m.id))
			m.save()
			m.clean_up()
			unloaded.add(m)
	for m in unloaded:
		AllMaps.remove(m)

	if ServerShutdown:
		loop.stop()
	else:
		loop.call_later(1, mainTimer)

# Websocket connection handler
async def clientHandler(websocket, path):
	client = Client(websocket)
	AllClients.add(client)

	print("connected "+path)

	try:
		while True:
			# Read a message, make sure it's not too short
			message = await websocket.recv()
			if len(message) < 3:
				continue
            # Split it into parts
			command = message[0:3]
			arg = None
			if len(message) > 4:
				arg = json.loads(message[4:])

			# Identify the user and put them on a map
			if command == "IDN":
				result = False
				if arg != None:
					result = client.login(filterUsername(arg["username"]), arg["password"])
				if result != True: # default to map 0 if can't log in
					client.switch_map(0)
			elif command == "PIN":
				client.ping_timer = 300

			# Don't allow the user to go any further if they're not on a map
			if client.map_id == -1:
				continue
			# Send the command through to the map
			client.map.receive_command(client, command, arg)

	except websockets.ConnectionClosed:
		print("disconnected")
	except:
		print("Unexpected error:", sys.exc_info()[0])
#		raise

	if client.username:
		client.save()

	# remove the user from all clients' views
	if client.map != None:
		client.map.users.remove(client)
		client.map.broadcast("WHO", {'remove': client.id})
	AllClients.remove(client)

start_server = websockets.serve(clientHandler, None, 12550)

# Start the event loop
loop = asyncio.get_event_loop()
loop.call_soon(mainTimer)
loop.run_until_complete(start_server)
print("Server started!")
loop.run_forever()
websockets.close()
