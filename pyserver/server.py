# Building game
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

import asyncio, datetime, random, websockets, json
from buildmap import *
from buildclient import *

# Global state variables
AllClients = set()
AllMaps = set()
ServerShutdown = False

MainMap = Map()
MainMap.name = "Main map"
AllMaps.add(MainMap)
counter = 0

# Timer that runs and performs background tasks
def mainTimer():
#	for c in AllClients:
#		asyncio.ensure_future(c.ws.send("Hello"))

	if ServerShutdown:
		loop.stop()
	else:
		loop.call_later(1, mainTimer)

# Websocket connection handler
async def clientHandler(websocket, path):
	client = Client(websocket)
	client.map = MainMap
	AllClients.add(client)

	print("connected "+path)
	client.send("MAI", client.map.map_info())
	client.send("MAP", client.map.map_section(0, 0, client.map.width-1, client.map.height-1))
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
			if command == "MOV":
				pass
			elif command == "DEL":
				x1 = arg["pos"][0]
				y1 = arg["pos"][1]
				x2 = arg["pos"][2]
				y2 = arg["pos"][3]
				for x in range(x1, x2+1):
					for y in range(y1, y2+1):
						if arg["turf"]:
							client.map.turfs[x][y] = None;
						if arg["obj"]:
							client.map.objs[x][y] = None;
			elif command == "PUT":
				x = arg["pos"][0]
				y = arg["pos"][1]
				if arg["obj"]:
					client.map.objs[x][y] = arg["atom"]
				else:
					client.map.turfs[x][y] = arg["atom"]
			elif command == "PIN":
				pass

			elif command == "BYE":
				pass

	except websockets.ConnectionClosed:
		print("disconnected")
	AllClients.remove(client)

start_server = websockets.serve(clientHandler, '127.0.0.1', 5678)

# Start the event loop
loop = asyncio.get_event_loop()
loop.call_soon(mainTimer)
loop.run_until_complete(start_server)
loop.run_forever()
websockets.close()
