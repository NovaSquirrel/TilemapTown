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
function redrawBuildCanvas(){}
function markTilesAsDirty() {}
let mapID, apiURL;
let DefaultPics = {};
let zoomedIn = false;

async function SendCmd(type, params) {
	if (type === "IMG") {
		let response = await fetch(`${apiURL}/v1/img/${params.id.join()},`);
		if (!response.ok) {
			console.error(`Couldn't reach Tilemap Town API for image: ${response.status}`);
		} else {
			let j = await response.json();
			for (let key in j) {
				FetchTilesetImage(j[key].id, j[key].url);
			}
		}
	} else if (type === "TSD") {
		let response = await fetch(`${apiURL}/v1/tsd/${params.id.join()},`);
		if (!response.ok) {
			console.error(`Couldn't reach Tilemap Town API for tileset: ${response.status}`);
		} else {
			let j = await response.json();
			for (let key in j) {
				InstallTileset(j[key].id, (typeof j[key].data === 'string') ? JSON.parse(j[key].data) : j[key].data);
			}
		}
	}
}

function asIntIfPossible(i) {
	let asInt = parseInt(i);
	if(asInt != NaN)
		return asInt;
	return i;
}

function init() {
	mapID  = document.body.dataset["tilemapTownMapId"];
	apiURL = document.body.dataset["tilemapTownApiUrl"];
	loadMapInfo();

	if (document.body.dataset["tilemapTownMapDesc"] != "") {
		let result = XBBCODE.process({
			text: document.body.dataset["tilemapTownMapDesc"],
			removeMisalignedTags: false,
			addInLineBreaks: true
		});
		document.getElementById("mapDesc").innerHTML = result.html;
	}

	let mapCanvas = document.getElementById("mapCanvas");
	mapCanvas.addEventListener('mousedown', function (evt) {
		if (evt.button != 0)
			return;
		if (!zoomedIn) {
			zoomedIn = true;
			mapCanvas.style.maxWidth = "unset";
			mapCanvas.style.maxHeight = "unset";
		} else {
			zoomedIn = false;
			mapCanvas.style.maxWidth = "600px";
			mapCanvas.style.maxHeight = "600px";
		}
	}, false);
}

async function loadMapInfo() {
	let response = await fetch(apiURL+"/v1/server_resources");
	if (!response.ok) {
		console.error(`Couldn't reach Tilemap Town API for server resources: ${response.status}`);
	} else {
		// Get server info and tileset definitions first
		const resources = await response.json();
		if ('images' in resources) {
			for(let key in resources['images']) {
				FetchTilesetImage(asIntIfPossible(key), resources['images'][key]);
			}
		}
		if ('tilesets' in resources) {
			for (let key in resources['tilesets']) {
				let tileset = resources['tilesets'][key];
				if (key == '') {
					GlobalTiles = tileset;
				} else {
					Tilesets[key] = tileset;
				}
			}
		}
		if('default_pics' in resources) {
			DefaultPics = resources['default_pics'];
		}

		// Get and parse the actual map
		let mapResponse = await fetch(`${apiURL}/v1/map/${mapID}?data=1`);
		if (!response.ok) {
			console.error(`Couldn't reach Tilemap Town API for map data: ${response.status}`);
		} else {
			const mapJson = await mapResponse.json();
			const mapInfo = mapJson.info;
			const mapData = mapJson.data;

			MyMap = new TownMap(mapInfo.size[0], mapInfo.size[1])
			MyMap.Info = mapInfo;
			//updateWallpaperOnMap(MyMap);

			const Fill = mapData.default;
			const x1 = mapData.pos[0];
			const y1 = mapData.pos[1];
			const x2 = mapData.pos[2];
			const y2 = mapData.pos[3];
	
			// Clear out the area
			for(let x=x1; x<=x2; x++) {
				for(let y=y1; y<=y2; y++) {
					MyMap.Tiles[x][y] = Fill;
					MyMap.Objs[x][y] = [];
				}
			}

			// Write in tiles and objects
			for (let key in mapData.turf) {
				let turf = mapData.turf[key];
				MyMap.Tiles[turf[0]][turf[1]] = turf[2];
			}
			for (let key in mapData.obj) {
				let obj = mapData.obj[key];
				MyMap.Objs[obj[0]][obj[1]] = obj[2];
			}

			window.requestAnimationFrame(waitForImagesToLoad);
		}
	}
}

function waitForImagesToLoad(timestamp) {
	if (allMapImagesLoaded()) {
		let canvas = document.getElementById("mapCanvas");

		canvas.width = MyMap.Width * 16;
		canvas.height = MyMap.Height * 16;
		let ctx = canvas.getContext("2d");
		ctx.beginPath();
		ctx.fillStyle = "#000000";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		tenthOfSecondTimer = 0;
		for (let y=0; y<MyMap.Height; y++) {
			for (let x=0; x<MyMap.Width; x++) {
				let turfAtom = AtomFromName(MyMap.Tiles[x][y]);
				drawTurf(ctx, x*16, y*16, turfAtom, MyMap, x, y);
				let Objs = MyMap.Objs[x][y];
				if (Objs.length) {
					for (let o of Objs) {
						drawObj(ctx, x*16, y*16, AtomFromName(o), MyMap, x, y);
					}
				}
			}
		}
	} else {
		window.requestAnimationFrame(waitForImagesToLoad);
	}
}

const emptyTag = {
	openTag: function (params, content) {
		return '';
	},
	closeTag: function (params, content) {
		return '';
	}
}

XBBCODE.addTags({
	"tt": XBBCODE.tags()["code"],
	"img": emptyTag,
	"face": emptyTag,
	"font": emptyTag,
	"command": {
		openTag: function (params, content) {
			let filteredJS = content.replace(/\x22/g, '\\\x22');
			let filteredHTML = content.replace(/\x22/g, '&quot;');
			return '<input type="button" value="' + filteredHTML + '"\'></input>';
		},
		closeTag: function (params, content) {
			return '';
		},
		displayContent: false
		},
	"copy2chat": {
		openTag: function (params, content) {
			let filteredJS = content.replace(/\x22/g, '\\\x22');
			let filteredHTML = content.replace(/\x22/g, '&quot;');
			return '<input type="button" value="&#x1F4CB;' + filteredHTML + '"\'></input>';
		},
		closeTag: function (params, content) {
			return '';
		},
		displayContent: false
	},
	"bot-message-button": {
		openTag: function (params, content) {
			let filteredJS = content.replace(/\x22/g, '\\\x22');
			let filteredHTML = content.replace(/\x22/g, '&quot;');
			if(params !== undefined) {
				filteredHTML = params.substr(1).replace(/\x22/g, '&quot;');
			}
			return '<input type="button" value="&#x1F916;' + filteredHTML + '"\'></input>';
		},
		closeTag: function (params, content) {
			return '';
		},
		displayContent: false
	},
	"spoiler": {
		openTag: function (params, content) {
			return '<span class="spoiler">';
		},
		closeTag: function (params, content) {
			return '</span>';
		}
	}
});
