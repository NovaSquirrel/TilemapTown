/*
 * Tilemap Town
 *
 * Copyright (C) 2017-2025 NovaSquirrel
 *
 * This program is free software: you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const AtomTypes = {
	NONE      : "", // no special behavior
	SIGN      : "sign", // display a message upon being bumped into
	DOOR      : "door",
	CONTAINER : "container",
	ICE       : "ice",
	ESCALATOR : "escalator",
	WATER     : "water",
};

const Directions = {
	EAST      : 0,
	SOUTHEAST : 1,
	SOUTH     : 2,
	SOUTHWEST : 3,
	WEST      : 4,
	NORTHWEST : 5,
	NORTH     : 6,
	NORTHEAST : 7,
}

// for converting direction IDs to actual offsets
const DirX = [ 1,  1,  0, -1, -1, -1,  0,  1];
const DirY = [ 0,  1,  1,  1,  0, -1, -1, -1];

class TownMap {
	constructor(MapWidth, MapHeight) {
		this.Width = MapWidth;
		this.Height = MapHeight;

		// Gets filled in from MAI
		this.Info = {name: "", 'id': -1, 'owner': -1, 'default': 'grass', 'size': [MapWidth, MapHeight], 'public': true, 'private': false, 'build_enabled': true, 'full_sandbox': true, 'wallpaper': null};
		this.WallpaperImage = null;

		// Initialize the map
		this.Tiles = [];
		this.Objs = [];
		for(var i=0; i<MapWidth; i++) {
			this.Tiles[i] = [];
			this.Objs[i] = [];
			for(var j=0; j<MapHeight; j++) {
				this.Tiles[i][j] = "grass";
				this.Objs[i][j] = [];
			}
		}
	}
}
let MyMap = new TownMap(60, 60);
let MapsByID = {}; // Nearby maps, including the current map
let CurrentMapID = 0;

let IconSheets = {}; // Tile sheets, indexed by first element in a 'pic'
let IconSheetsRequested = {};
let IconSheetRequestList = [];

let Tilesets = {};   // Extra tilesets past just the GlobalTiles list
let TilesetsRequested = {};

function RequestImageIfNeeded(id) {
  if(!IconSheets[id] && !IconSheetsRequested[id]) {
    // ask for the image
    IconSheetsRequested[id] = true;
    IconSheetRequestList.push(id);
  }
}

function FlushIconSheetRequestList() {
	if (IconSheetRequestList.length) {
		if (IconSheetRequestList.length == 1)
			SendCmd("IMG", {"id": IconSheetRequestList[0]});
		else
			SendCmd("IMG", {"id": IconSheetRequestList});
		IconSheetRequestList = [];
	}
}

function FetchTilesetImage(id, url) {
	if(id in IconSheets && IconSheets[id].src == url) {
		// If you already have it, just keep the preexisting image
		delete IconSheetsRequested[id];
		return;
	}

	// unload an image
	if(url == null) {
		delete IconSheets[id];
		return;
	}
	// load an image
	let img = new Image();
	img.onload = function(){
		NeedMapRedraw = true;
		backdropRerenderAll = true;
		if(id <= 0) {
			redrawBuildCanvas();
		}
	};
	img.src = url;
	IconSheets[id] = img;
	delete IconSheetsRequested[id];
}

// Add a new tileset to the list
function InstallTileset(name, list) {

	// Unpack each item
	if(Array.isArray(list)) { // It probably *should* not be an array; this was an early protocol design thing
		let new_set = {};

		for(let i=0; i<list.length/2; i++) {
			let tile = list[i*2+1];
			if(Array.isArray(tile)) // If it's an array, assume it needs to be unpacked
				new_set[list[i*2]] = AtomCompact2JSON(tile);
			else
				new_set[list[i*2]] = tile;
		}
		Tilesets[name] = new_set;
	} else if(typeof list === 'object') {
		Tilesets[name] = list;
	}

}

// Make a separate copy of an atom's object
function CloneAtom(atom) {
	return JSON.parse(JSON.stringify(atom));
}

// Get an atom object from a string, or return it if already an object
function AtomFromName(str) {
	if(typeof str === "string") {
		if(GlobalTiles[str])
			return GlobalTiles[str];
		else {
			let s = str.split(":");
				if(s.length == 2) {
					// Allow a custom tileset
					if(Tilesets[s[0]] && Tilesets[s[0]][s[1]]) {
						return Tilesets[s[0]][s[1]];
					} else if(!TilesetsRequested[s[0]]) {
						// ask for the tileset
						TilesetsRequested[s[0]] = true;
						SendCmd("TSD", {id: s[0]});
					}
				}
			console.log("Unknown atom: "+str);
			return GlobalTiles.grass;
		}
	}
	return str;
}

// Convert an atom's JSON definition into a lower bandwidth version
function AtomCompact2JSON(t) {
	let out = [0, t.name, t.pic];

	// turn on flags and add fields as needed
	if(t.density) out[0] |= 1;
	if(t.obj) out[0] |= 2;
	if(t.type) {
		out[0] |= 4;
		out.push(t.type);
	}
	if(t.sort) {
		out[0] |= 8;
		out.push(t.sort);
	}
	if(t.dir) {
		out[0] |= 16;
		out.push(t.dir);
	}
	return out;
}

// Convert a lower bandwidth atom into a JSON definition
function AtomCompact2JSON(t) {
	let flags = t[0];
	let out = {
		name: t[1],
		pic: t[2]
	};

	// interpret flags
	if(flags & 16)
		out.dir  = t.pop();
	if(flags & 8)
		out.sort = t.pop();
	if(flags & 4)
		out.type = t.pop();
	if(flags & 2)
		out.obj = true;
	if(flags & 1)
		out.density = true;
	return out;
}

function initMap() {
	if(Object.keys(IconSheets).length === 0) {
		IconSheets[0] = document.getElementById("potluck");
		IconSheets[-1] = document.getElementById("extras");
		IconSheets[-2] = document.getElementById("pulp");
		IconSheets[-3] = document.getElementById("easyrpg");
	}
}

// Convert the map to a string that can be put in a file
function exportMap() {
	let turfs = [];
	let objs = [];
	let default_turf_json = JSON.stringify(AtomFromName(MyMap.Info['default']));

	// Make a list of all objects
	for(let x=0; x<MyMap.Width; x++) {
		for(let y=0; y<MyMap.Height; y++) {
			if(MyMap.Tiles[x][y] && MyMap.Tiles[x][y] != MyMap.Info['default']
				&& JSON.stringify(MyMap.Tiles[x][y]) != default_turf_json) {
				turfs.push([x, y, MyMap.Tiles[x][y]]);
			}
			if(MyMap.Objs[x][y].length) {
				objs.push([x, y, MyMap.Objs[x][y]]);
			}
		}
	}

	let map = {'default': MyMap.Info['default'], 'obj': objs, 'turf': turfs, 'pos': [0, 0, MyMap.Width-1, MyMap.Height-1]};
	return "TilemapTownMapExport\nversion=1\nMAI="+JSON.stringify(MyMap.Info)+"\nMAP="+JSON.stringify(map)+"\n";
}

// Convert a string from the above function into a map
function importMap(map) {
	let lines = map.split("\n");
	if (lines.length == 0 || lines[0] != "TilemapTownMapExport") {
		alert("File isn't a Tilemap Town map?");
		return false;
	}
	let mapInfo = undefined;

	for (let line of lines) {
		if (line.startsWith("version=")) {
			let version = line.slice(8);
			if (version != "1") {
				alert("Map file is for a later version of Tilemap Town");
				return false;
			}
		} else if (line.startsWith("MAP=")) {
			let mapData = JSON.parse(line.slice(4));
			let width = mapData.pos[2]+1;
			let height = mapData.pos[3]+1;

			MyMap = new TownMap(width, height);
			if (mapInfo)
				MyMap.Info = mapInfo;

			// Write in tiles and objects
			for (let turf of mapData.turf) {
				MyMap.Tiles[turf[0]][turf[1]] = turf[2];
			}
			for (let obj of mapData.obj) {
				MyMap.Objs[obj[0]][obj[1]] = obj[2];
			}

			NeedMapRedraw = true;
			backdropRerenderAll = true;
		} else if (line.startsWith("MAI=")) {
			mapInfo = JSON.parse(line.slice(4));
		}
	}
	return true;
}

// Helper command for JavaScript console use
function tileSheetUses(sheet) {
	for (let mapId in MapsByID) {
		let map = MapsByID[mapId];
		let width = map.Width;
		let height = map.Height;
		let uses = [];
		for (let y=0; y<height; y++) {
			for (let x=0; x<width; x++) {
				let found = false;
				let turf = AtomFromName(map.Tiles[x][y]);
				if (turf.pic?.[0] === sheet) {
					found = true;
				} else if (Array.isArray(map.Objs[x][y])) {
					for (let objName of map.Objs[x][y]) {
						let obj = AtomFromName(objName);
						if (obj.pic?.[0] === sheet) {
							found = true;
							break;
						}
					}
				}
				if (found)
					uses.push(`${x},${y}`);
			}
		}
		if (uses.length > 0)
			console.log(`Uses for sheet ${sheet} on map ${mapId}:`, uses)
	}
}
