# Tilemap Town
![Screenshot](http://novasquirrel.com/rsc/buildingscreen.PNG)

**Tilemap Town** is a virtual world that allows users to move around 2D top-down maps and freely change tiles on them to create worlds together. It's intended for roleplaying and it has tools to facilitate this, letting you easily place down props, narrate actions, and switch between characters. It takes inspiration from BYOND "building games" that used to be popular long ago, as well as from MUCKs, Second Life, Pony Town, and other platforms, but it's not supposed to be a clone of anything in particular.

Tilemap Town's web client and server are Free Software, and the protocol is documented in this repository, as well as a description of what a useful subset of it might be. The protocol is designed so that a subset can still be meaningfully usable, and so that extensions can be added without causing problems for clients that don't understand them. Third party clients and servers are welcome.

Python server
-------------
Run `runserver.py` with your Python 3 interpreter, after installing [the websockets library](https://pypi.python.org/pypi/websockets) and [aiohttp](https://docs.aiohttp.org/en/stable/). You may want to look at `docs/config.txt` for information on how to configure the server's settings to your liking.

There's an optional addon for adding scripting support: [TilemapTownScriptingService](https://github.com/NovaSquirrel/TilemapTownScriptingService)

Other clients
-------------
[3DS client](https://github.com/NovaSquirrel/TilemapTown3DS)
[MU* gateway](https://github.com/NovaSquirrel/TilemapTown2MU)
