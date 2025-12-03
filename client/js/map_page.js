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
let originalMapID, mapID, apiURL;
let originalWebClientURL;
let originalTouchClientURL;
let mapsByID = {};
let DefaultPics = {};
let zoomedIn = false;
let haveServerResourcesYet = false;
let edgeLinks = null;
let originalMapCanvasWidth, originalMapCanvasHeight;

async function SendCmd(type, params) {
	if (type === "IMG") {
		if (!Array.isArray(params.id))
			params.id = [params.id];
		let response = await fetch(`${apiURL}/v1/img/${params.id.join()},`);
		if (!response.ok) {
			console.error(`Couldn't reach Tilemap Town API for image: ${response.status}`);
		} else {
			let j = await response.json();
			for (let key in j) {
				FetchTilesetImage(j[key].id, j[key].url);
			}
			// If any IDs in the request aren't in the response, there was an error on those, so stop waiting for them
			for (let originalID of params.id) {
				if (!(originalID in j)) {
					IconSheets[originalID] = new Image();
				}
				delete IconSheetsRequested[originalID];
			}
		}
	} else if (type === "TSD") {
		if (!Array.isArray(params.id))
			params.id = [params.id];
		let response = await fetch(`${apiURL}/v1/tsd/${params.id.join()},`);
		if (!response.ok) {
			console.error(`Couldn't reach Tilemap Town API for tileset: ${response.status}`);
		} else {
			let j = await response.json();
			for (let key in j) {
				InstallTileset(j[key].id, (typeof j[key].data === 'string') ? JSON.parse(j[key].data) : j[key].data);
			}
			// If any IDs in the request aren't in the response, there was an error on those, so stop waiting for them
			for (let originalID of params.id) {
				if (!(originalID in j)) {
					Tilesets[originalID] = {};
				}
				delete TilesetsRequested[originalID];
			}
		}
	}
}

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

function asIntIfPossible(i) {
	let asInt = parseInt(i);
	if(asInt != NaN)
		return asInt;
	return i;
}

function init() {
	IconSheets[INTERNAL_TILESET_ID] = document.getElementById("webclientGraphics");
	mapID  = document.body.dataset["tilemapTownMapId"];
	apiURL = document.body.dataset["tilemapTownApiUrl"];
	originalMapID = mapID;
	drawMap(mapID);
	originalWebClientURL = document.getElementsByClassName("join")[0]?.href;
	originalTouchClientURL  = document.getElementsByClassName("join_touch")[0]?.href;

	if (document.body.dataset["tilemapTownMapDesc"] != "") {
		let result = XBBCODE.process({
			text: document.body.dataset["tilemapTownMapDesc"],
			removeMisalignedTags: false,
			addInLineBreaks: true
		});
		document.getElementById("mapDesc").innerHTML = result.html;
	}

	// Zoom in the canvas when it's clicked
	let mapCanvas = document.getElementById("mapCanvas");
	const originalMapCanvasStyle = getComputedStyle(mapCanvas);
	originalMapCanvasWidth = originalMapCanvasStyle.getPropertyValue("max-width");
	originalMapCanvasHeight = originalMapCanvasStyle.getPropertyValue("max-height");
	mapCanvas.addEventListener('mousedown', function (evt) {
		if (evt.button != 0)
			return;
		if (!zoomedIn) {
			zoomedIn = true;
			mapCanvas.style.maxWidth = "unset";
			mapCanvas.style.maxHeight = "unset";
		} else {
			zoomedIn = false;
			mapCanvas.style.maxWidth = originalMapCanvasWidth;
			mapCanvas.style.maxHeight = originalMapCanvasHeight;
		}
	}, false);

	// Edge link button click handlers
	for (let i=0; i<8; i++) {
		document.getElementById("edge_button_"+i).addEventListener('mousedown', function mouseHandler(evt) {
			if(!edgeLinks[i])
				return;
			mapID = edgeLinks[i];
			drawMap(mapID);
		}, false);
	}
	document.getElementById("edge_button_home").addEventListener('mousedown', function mouseHandler(evt) {
		mapID = originalMapID;
		drawMap(mapID);
	}, false);
}

async function loadServerResources() {
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
		return true;
	}
	return false;
}

async function drawMap(i) {
	mapID = i;
	loadMapInfo();
}

function updateEdgeLinkButtons() {
	if (!edgeLinks) {
		edgeLinks = [null, null, null, null, null, null, null, null];
	} else if(edgeLinks.some((element) => element !== null)) {
		document.getElementById("edge-link-buttons").style.display = "unset";
	}
	for (let edgeLinkIndex in edgeLinks) {
		if (edgeLinks[edgeLinkIndex] != null) {
			document.getElementById("edge_button_"+edgeLinkIndex).classList.remove("disabled");
		} else {
			document.getElementById("edge_button_"+edgeLinkIndex).classList.add("disabled");
		}
	}
}

function updateMapFields() {
	document.getElementById("mapNameTd").textContent = mapsByID[mapID].Info.name;
	document.getElementById("mapOwnerTd").textContent = mapsByID[mapID].Info.owner_username;
	if (mapsByID[mapID].Info.desc != "") {
		let result = XBBCODE.process({
			text: mapsByID[mapID].Info.desc ?? "No description set",
			removeMisalignedTags: false,
			addInLineBreaks: true
		});
		document.getElementById("mapDesc").innerHTML = result.html;
	} else {
		document.getElementById("mapDesc").innerHTML = "No description set";
	}
	document.getElementById("teleportMapID").textContent = mapID;

	if(mapID === originalMapID) {
		document.getElementsByClassName("join")[0].href = originalWebClientURL;
		document.getElementsByClassName("join_touch")[0].href = originalTouchClientURL;
	} else {
		document.getElementsByClassName("join")[0].href = originalWebClientURL.slice(0, originalWebClientURL.indexOf("?")) + "?map=" + mapID;
		document.getElementsByClassName("join_touch")[0].href = originalTouchClientURL.slice(0, originalTouchClientURL.indexOf("?")) + "?map=" + mapID;
	}
}

async function loadMapInfo() {
	if (!haveServerResourcesYet) {
		if(!await loadServerResources())
			return false;
		haveServerResourcesYet = true;
	}
	if (mapID in mapsByID) {
		window.requestAnimationFrame(waitForImagesToLoad);
		edgeLinks = mapsByID[mapID].Info?.edge_links;
		updateEdgeLinkButtons();
		updateMapFields();
		return true;
	}

	// Get and parse the actual map
	let mapResponse = await fetch(`${apiURL}/v1/map/${mapID}?data=1`);
	if (!mapResponse.ok) {
		console.error(`Couldn't reach Tilemap Town API for map data (${mapID}): ${response.status}`);
	} else {
		const mapJson = await mapResponse.json();
		const mapInfo = mapJson.info;
		const mapData = mapJson.data;

		let map = new TownMap(mapInfo.size[0], mapInfo.size[1])
		mapsByID[mapID] = map;
		map.Info = mapInfo;
		edgeLinks = map.Info?.edge_links;
		updateEdgeLinkButtons();
		updateMapFields();

		//updateWallpaperOnMap(map);

		const Fill = mapData.default;
		const x1 = mapData.pos[0];
		const y1 = mapData.pos[1];
		const x2 = mapData.pos[2];
		const y2 = mapData.pos[3];

		// Clear out the area
		for(let x=x1; x<=x2; x++) {
			for(let y=y1; y<=y2; y++) {
				map.Tiles[x][y] = Fill;
				map.Objs[x][y] = [];
			}
		}

		// Write in tiles and objects
		for (let key in mapData.turf) {
			let turf = mapData.turf[key];
			map.Tiles[turf[0]][turf[1]] = turf[2];
		}
		for (let key in mapData.obj) {
			let obj = mapData.obj[key];
			map.Objs[obj[0]][obj[1]] = obj[2];
		}

		window.requestAnimationFrame(waitForImagesToLoad);
	}
}

function waitForImagesToLoad(timestamp) {
	MyMap = mapsByID[mapID];
	if (MyMap && allMapImagesLoaded()) {
		let canvas = document.getElementById("mapCanvas");

		let map = mapsByID[mapID];
		canvas.width = map.Width * 16;
		canvas.height = map.Height * 16;
		let ctx = canvas.getContext("2d");
		ctx.beginPath();
		ctx.fillStyle = "#000000";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		tenthOfSecondTimer = 0;
		for (let y=0; y<map.Height; y++) {
			for (let x=0; x<map.Width; x++) {
				let turfAtom = AtomFromName(map.Tiles[x][y]);
				try {
					drawTurf(ctx, x*16, y*16, turfAtom, map, x, y);
				} catch (error) {}
				let Objs = map.Objs[x][y];
				if (Objs.length) {
					for (let o of Objs) {
						try {
							drawObj(ctx, x*16, y*16, AtomFromName(o), map, x, y);
						} catch (error) {}
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
