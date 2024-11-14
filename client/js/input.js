/*
 * Tilemap Town
 *
 * Copyright (C) 2017-2024 NovaSquirrel
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

// Mouse status
let MouseDown = false;
let MouseStartX = -1;
let MouseStartY = -1;
let MouseEndX = -1;
let MouseEndY = -1;
let MouseNowX = -1;
let MouseNowY = -1;
let MouseActive = false; // is there a selection right now?
let MousedOverPlayers = [];
let MousedOverEntityClickAvailable = false;
let MousedOverEntityClickId = null;
let MousedOverEntityClickIsTilemap = false;
let MousedOverEntityClickIsUse = false;
let MousedOverEntityClickX = undefined;
let MousedOverEntityClickY = undefined;
let MouseRawPos = null;

let ShiftPressed = false;
let CtrlPressed = false;

// take_controls status
let takeControlsEnabled = false;
let takeControlsPassOn = false;
let takeControlsKeyUp = false;
let takeControlsId = null;
let takeControlsKeys = new Set();

let hotbarDragging = false;

let ctrlZUndoType = null;

let lastChatUsed = "";

const OK_DRAW_DISTANCE = 5;

///////////////////////////////////////////////////////////
// Chat
///////////////////////////////////////////////////////////

function runLocalCommand(t) {
	if (t.toLowerCase() == "/clear") {
		chatArea.innerHTML = "";
		chatLogForExport = [];
		return true;
	} else if (t.toLowerCase() == "/exportmap" || t.toLowerCase() == "/mapexport") {
		//logMessage('<a href="data:,'+encodeURIComponent(exportMap())+'" download="map.txt">Map download (click here)</a>', 'server_message');

		//from https://ourcodeworld.com/articles/read/189/how-to-create-a-file-and-generate-a-download-with-javascript-in-the-browser-without-a-server
		let element = document.createElement('a');
		element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(exportMap()));
		element.setAttribute('download', "map.txt");
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
		return true;
	} else if (t.toLowerCase().startsWith("/playmusic ")) {
		playMusic(t.trim().slice(11), true);
		return true;
	} else if (t.toLowerCase() == "/stopmusic") {
		stopMusic();
		return true;
	} else if (t.toLowerCase() == "/releasekeys") {
		forceReleaseKeys();
		return true;
	} else if (t.toLowerCase() == "/exportlogs" || t.toLowerCase() == "/exportlog") {
		// https://stackoverflow.com/a/4929629
		let today = new Date();
		let dd = String(today.getDate()).padStart(2, '0');
		let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
		let yyyy = today.getFullYear();
		today = yyyy + '-' + mm + '-' + dd;

		let element = document.createElement('a');
		element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(chatLogForExport.join('\n')));
		element.setAttribute('download', "tilemap town "+today+".txt");
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
		return true;
	} else if(t.toLowerCase() == "/clearhotbar") {
		hotbarData = [null, null, null, null, null, null, null, null, null, null];
		hotbarSelectIndex = null;
		hotbarDragging = false;
		drawHotbar();
		return true;
	}
	return false;
}

function setChatInput(the_text) {
	chatInput.value = the_text;
	chatInput.focus();
	sendTyping(true);
}

function sendChatCommand(the_text) {
	SendCmd("CMD", { text: the_text });
}

function sendTyping(isTyping) {
	markNotIdle();
	if (PlayerWho[PlayerYou].typing != isTyping) {
		SendCmd("WHO", { update: { id: PlayerYou, typing: isTyping } });
		PlayerWho[PlayerYou].typing = isTyping;
		drawMap();
	}
}

///////////////////////////////////////////////////////////
// Keys
///////////////////////////////////////////////////////////

function markNotIdle() {
	timeOfLastInput = Date.now();
	if (PlayerWho?.[PlayerYou]?.status == "idle" && OnlineMode) {
		if (statusBeforeIdle) {
			if (statusMessageBeforeIdle) {
				SendCmd("CMD", {text: "status "+statusBeforeIdle+" "+statusMessageBeforeIdle});
			} else {
				SendCmd("CMD", {text: "status "+statusBeforeIdle});
			}
		} else {
			SendCmd("CMD", {text: "status"});
		}		
		PlayerWho[PlayerYou].status = statusBeforeIdle; // Don't send it again
	}
}

function movePlayer(id, x, y, dir, already_moved) {
	already_moved.add(id);
	for (let index of PlayerWho[id].passengers) {
		if (already_moved.has(id))
			continue;
		if (x != null) {
			if (PlayerWho[index].is_following) {
				movePlayer(index, PlayerWho[id].x, PlayerWho[id].y, PlayerWho[id].dir);
			} else {
				movePlayer(index, x, y, dir);
			}
		}
	}
	if (x != null) {
		PlayerWho[id].x = x;
		PlayerWho[id].y = y;
		startPlayerWalkAnim(id);
	}
	if (dir != null) {
		PlayerWho[id].dir = dir;
		updateDirectionForAnim(id);
	}
}

function forceReleaseKeys() {
	if(takeControlsEnabled) {
		logMessage('Stopped sending keys to the script.', 'server_message',   {'isChat': false});
		SendCmd("EXT", {
			"took_controls": {
				"id": takeControlsId,
				"keys": [],
			}
		});
		takeControlsEnabled = false;
	}
}

function keyEventToTilemapTownKey(e) {
	var e = e || window.event;
	switch(e.key) {
		case "PageUp":
			return e.shiftKey ? "turn-ne" : "move-ne";
		case "PageDown":
			return e.shiftKey ? "turn-se" : "move-se";
		case "Home":
			return e.shiftKey ? "turn-nw" : "move-nw";
		case "End":
			return e.shiftKey ? "turn-sw" : "move-sw";
		case "ArrowLeft": case "KeyA":
			return e.shiftKey ? "turn-w" : "move-w";
		case "ArrowDown": case "KeyS":
			return e.shiftKey ? "turn-s" : "move-s";
		case "ArrowUp": case "KeyW":
		  return e.shiftKey ? "turn-n" : "move-n";
		case "ArrowRight": case "KeyD":
		  return e.shiftKey ? "turn-e" : "move-e";
	}
	switch(e.code) {
		case "Space":  return "use-item";
		case "Escape": return "cancel";
		case "Digit1": return "hotbar-1";
		case "Digit2": return "hotbar-2";
		case "Digit3": return "hotbar-3";
		case "Digit4": return "hotbar-4";
		case "Digit5": return "hotbar-5";
		case "Digit6": return "hotbar-6";
		case "Digit7": return "hotbar-7";
		case "Digit8": return "hotbar-8";
		case "Digit9": return "hotbar-9";
		case "Digit0": return "hotbar-10";
	}
	return null;
}

function keyUpHandler(e) {
	markNotIdle();
	var e = e || window.event;
	ShiftPressed = e.shiftKey;
	CtrlPressed = e.ctrlKey;
	if(takeControlsEnabled && takeControlsKeyUp) {
		let ttKey = keyEventToTilemapTownKey(e);
		if(takeControlsKeys.has(ttKey)) {
			SendCmd("EXT", {
				"key_press": {
					"id": takeControlsId,
					"key": ttKey,
					"down": false,
				}
			});
		}
	}
}

function bump_into_atom(atom) {
	if (atom.type == AtomTypes.SIGN && atom.message) {
		logMessage(((atom.name != "sign" && atom.name != "") ? escape_tags(atom.name) + " says: " : "The sign says: ") + convertBBCode(atom.message), "server_message",
		  {'plainText': (atom.name != "sign" && atom.name != "") ? atom.name + " says: " + atom.message : "The sign says: " + atom.message});
	}
}

function keyDownHandler(e) {
	markNotIdle();
	function ClampPlayerPos() {
		PlayerX = Math.min(Math.max(PlayerX, 0), MyMap.Width - 1);
		PlayerY = Math.min(Math.max(PlayerY, 0), MyMap.Height - 1);
	}

	var e = e || window.event;
	ShiftPressed = e.shiftKey;
	CtrlPressed = e.ctrlKey;

	// ignore keys when typing in a textbox
	if (document.activeElement.tagName == "INPUT" || document.activeElement.tagName == "TEXTAREA") {
		if (document.activeElement == chatInput && e.code == "ArrowUp") {
			if(chatInput.value.length == 0)
				chatInput.value = lastChatUsed;
			return;
		} else if (document.activeElement == chatInput && e.keyCode == 13) {
			if (chatInput.value.toLowerCase().trim() == "/oops") {
				sendTyping(false);
				chatInput.value = lastChatUsed;
				return;
			}
			if (chatInput.value.length > 5)
				lastChatUsed = chatInput.value;

			// First, check for commands that are local to the client
			let trimmedChatText = chatInput.value.trimStart();
			if (runLocalCommand(trimmedChatText));
				// commands are CMD while regular room messages are MSG. /me is a room message.
			else if (trimmedChatText.slice(0, 1) == "/" &&
				trimmedChatText.toLowerCase().slice(0, 4) != "/me " &&
			trimmedChatText.toLowerCase().slice(0, 5) != "/ooc " &&
			trimmedChatText.toLowerCase().slice(0, 7) != "/spoof ") {
				SendCmd("CMD", { text: trimmedChatText.slice(1) }); // remove the /
			} else if (trimmedChatText.length > 0) {
				SendCmd("MSG", { text: trimmedChatText });
			} else {
				chatInput.blur();
			}

			sendTyping(false);

			chatInput.value = "";
		} else if (document.activeElement == chatInput && e.keyCode == 27) {
			// escape press
			chatInput.blur();
		}
		return;
	}

	if(takeControlsEnabled) {
		let ttKey = keyEventToTilemapTownKey(e);
		if(takeControlsKeys.has(ttKey)) {
			if(e.repeat !== true) {
				SendCmd("EXT", {
					"key_press": {
						"id": takeControlsId,
						"key": ttKey,
						"down": true,
					}
				});
			}
			if(!takeControlsPassOn) {
				return;
			}
		}    
	}

	let needRedraw = false;

	let PlayerX = PlayerWho[PlayerYou].x;
	let PlayerY = PlayerWho[PlayerYou].y;
	let PlayerDir = PlayerWho[PlayerYou].dir;
	let OldPlayerX = PlayerX;
	let OldPlayerY = PlayerY;
	let Bumped = false, BumpedX = null, BumpedY = null;
	let OldPlayerDir = PlayerWho[PlayerYou].dir;

	if (e.code == "Space") { // space or clear
		let data = getDataForDraw();
			if(data !== null)
				useItem({ type: 'map_tile', data: data});
	} if (e.code == "Delete") { // delete
		selectionDelete();
	} else if (e.code == "Escape") { // escape
		MouseActive = false;
		MouseDown = false;
		panel.innerHTML = "";
		NeedMapRedraw = true;
		selectionInfoVisibility(false);
	} else if (e.keyCode >= 48 && e.keyCode <= 57) { // 0 through 9
		// calculate which inventory item
		let n = e.keyCode - 48;
		n = (n - 1) % 10;
		if (n < 0)
			n = 9;
		setHotbarIndex(n);
	} else if (!CtrlPressed && (e.key == "ArrowUp" || e.code == "KeyW")) { // up/w
		PlayerY--;
		PlayerDir = Directions.NORTH;
		e.preventDefault();
	} else if (!CtrlPressed && (e.key == "ArrowDown" || e.code == "KeyS")) { // down/s
		PlayerY++;
		PlayerDir = Directions.SOUTH;
		e.preventDefault();
	} else if (!CtrlPressed && (e.key == "ArrowLeft" || e.code == "KeyA")) { // left/a
		PlayerX--;
		PlayerDir = Directions.WEST;
		e.preventDefault();
	} else if (!CtrlPressed && (e.key == "ArrowRight" || e.code == "KeyD")) { // right/d
		PlayerX++;
		PlayerDir = Directions.EAST;
		e.preventDefault();
	} else if (e.key == "End") { // end
		PlayerX--;
		PlayerY++;
		PlayerDir = Directions.SOUTHWEST;
		e.preventDefault();
	} else if (e.key == "PageDown") { // pg down
		PlayerX++;
		PlayerY++;
		PlayerDir = Directions.SOUTHEAST;
		e.preventDefault();
	} else if (e.key == "Home") { // home
		PlayerX--;
		PlayerY--;
		PlayerDir = Directions.NORTHWEST;
		e.preventDefault();
	} else if (e.key == "PageUp") { // pg up
		PlayerX++;
		PlayerY--;
		PlayerDir = Directions.NORTHEAST;
		e.preventDefault();
	} else if (CtrlPressed && e.code == "ArrowUp") {
		sendChatCommand("roffset 0 -1");
	} else if (CtrlPressed && e.code == "ArrowDown") {
		sendChatCommand("roffset 0 1");
	} else if (CtrlPressed && e.code == "ArrowLeft") {
		sendChatCommand("roffset -1 0");
	} else if (CtrlPressed && e.code == "ArrowRight") {
		sendChatCommand("roffset 1 0");
	} else if (e.code == "Enter") { // enter (carriage return)
		chatInput.focus();
		e.preventDefault();
	} else if (e.code == "KeyZ" && e.ctrlKey) {
		if(ctrlZUndoType == "put") {
			undoDrawStroke();
		} else if(ctrlZUndoType == "del") {
			sendChatCommand('undodel');
		}
		ctrlZUndoType = null;
	} else if (e.code == "KeyF") { // Pick
		if(drawToolX !== null && drawToolY !== null) {
			if(e.shiftKey) {
				let tiles = MyMap.Objs[drawToolX][drawToolY];
				if(tiles && tiles.length) {
					addTileToHotbar(tiles[0]);
				}
			} else {
				let tile = MyMap.Tiles[drawToolX][drawToolY];
				if(tile) {
					addTileToHotbar(tile);
				}
			}
		}
	} else if (e.code == "KeyR") { // Swap between draw and select
		if(buildTool == BUILD_TOOL_SELECT) {
			buildTool = BUILD_TOOL_DRAW;
			isSelect = document.getElementById("buildToolSelect").checked = false;
			isDraw = document.getElementById("buildToolDraw").checked = true;
			MouseActive = false;
			NeedMapRedraw = true;
		} else if(buildTool == BUILD_TOOL_DRAW) {
			buildTool = BUILD_TOOL_SELECT;
			isSelect = document.getElementById("buildToolSelect").checked = true;
			isDraw = document.getElementById("buildToolDraw").checked = false;
			drawToolX = null;
			drawToolY = null;
			NeedMapRedraw = true;
		}
	}

	let BeforeClampX = PlayerX, BeforeClampY = PlayerY;
	ClampPlayerPos();
	if (PlayerX != BeforeClampX || PlayerY != BeforeClampY) {
		Bumped = true;
		BumpedX = BeforeClampX;
		BumpedY = BeforeClampY;
	}

	// Go back if the turf is solid, or if there's objects in the way
	if (OldPlayerX != PlayerX || OldPlayerY != PlayerY) {
		// Check if the player is attempting to cross a wall on the tile they're currently on
		if(!Fly) {
			// Check for a wall in the objs on that tile
			for (let index in MyMap.Objs[OldPlayerX][OldPlayerY]) {
				let Obj = AtomFromName(MyMap.Objs[OldPlayerX][OldPlayerY][index]);
				if ((Obj.walls ?? 0) & (1 << PlayerDir)) {
					Bumped = true;
					BumpedX = OldPlayerX;
					BumpedY = OldPlayerY;
					PlayerX = OldPlayerX;
					PlayerX = OldPlayerY;
					break;
				}
			}

			// Check for a wall on the turf
			if(!Bumped && ((AtomFromName(MyMap.Tiles[OldPlayerX][OldPlayerY]).walls ?? 0) & (1 << PlayerDir))) {
				Bumped = true;
				BumpedX = OldPlayerX;
				BumpedY = OldPlayerY;
				PlayerX = OldPlayerX;
				PlayerY = OldPlayerY;
			}
		}

		if(!Bumped) {
			// For the tile you're moving into, the direction that's checked against is rotated 180 degrees
			let DenseWallBit = 1 << ((PlayerDir + 4) & 7);

			// Check for solid objects in the way
			for (let index in MyMap.Objs[PlayerX][PlayerY]) {
				let Obj = AtomFromName(MyMap.Objs[PlayerX][PlayerY][index]);
				bump_into_atom(Obj);
				if (Obj.density || ((Obj.walls ?? 0) & DenseWallBit)) {
					if (!Fly && !Bumped) {
						Bumped = true;
						BumpedX = PlayerX;
						BumpedY = PlayerY;
						PlayerX = OldPlayerX;
						PlayerY = OldPlayerY;
						// Don't break here, so that if a sign is in the stack of objects it will get read
					}
					break;
				}
			}

			// Then check for turfs
			if (!Fly && !Bumped) {
				let Turf = AtomFromName(MyMap.Tiles[PlayerX][PlayerY]);
				bump_into_atom(Turf);
				if (Turf.density || ((Turf.walls ?? 0) & DenseWallBit)) {
					Bumped = true;
					BumpedX = PlayerX;
					BumpedY = PlayerY;
					PlayerX = OldPlayerX;
					PlayerY = OldPlayerY;
				}
			}
		}
	}

	if (Bumped || OldPlayerX != PlayerX || OldPlayerY != PlayerY || OldPlayerDir != PlayerDir) {
		let Params = { 'dir': PlayerDir };
		if (e.shiftKey) {
			SendCmd("MOV", Params);
			movePlayer(PlayerYou, null, null, PlayerDir, new Set([PlayerYou]));
		} else {
			if (Bumped) {
				Params['bump'] = [BumpedX, BumpedY];
				Params['if_map'] = CurrentMapID;
			}
			if (PlayerX != OldPlayerX || PlayerY != OldPlayerY) {
				Params['from'] = [OldPlayerX, OldPlayerY];
				Params['to'] = [PlayerX, PlayerY];
			}
			SendCmd("MOV", Params);
			movePlayer(PlayerYou, PlayerX, PlayerY, PlayerDir, new Set([PlayerYou]));
		}
	}

	if (needRedraw)
		drawMap();
}
document.onkeydown = keyDownHandler;
document.onkeyup = keyUpHandler;

///////////////////////////////////////////////////////////
// Mouse utilities
///////////////////////////////////////////////////////////

function inSelection(x, y) {
  return x >= MouseStartX && x <= MouseEndX && y >= MouseStartY && y <= MouseEndY;
}

function withinCurrentMap(x, y) {
	return x >= 0 && y >= 0 && x < MyMap.Width && y < MyMap.Height;
}

function updateSelectedEntitiesUL() {
	// Manage the users <ul>
	let ul = document.getElementById('selectedentitiesul');
	if (!ul)
		return;

	const selected_ids = Object.values(PlayerWho).filter(
		item => inSelection(item.x, item.y)
	).map(
		item => item.id
	)

	itemCardList(ul, selected_ids, {
		eventlisteners: {
			'click': function (e, id) {
				useItem(id)
			},
			'contextmenu': function (e, id) {
				openItemContextMenu(id, e.clientX, e.clientY);
				e.preventDefault();
			}
		}
	});

	document.getElementById('selectedentities_span').style.display = (selected_ids.length >= 1) ? 'block' : 'none';
}

function updateSelectedTurfUL(x, y) {
	let ul = document.getElementById('selectedfloorul');
	if (!ul)
		return;

	// Empty out the list
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}

	let tile;
	if(withinCurrentMap(x, y)) {
		tile = MyMap.Tiles[x][y];
	} else {
		return;
	}

	tile = AtomFromName(tile);
	let li = itemCard({"name": tile.name, "pic": tile.pic});
	li.addEventListener('contextmenu', function (e) {
		openTurfContextMenu(x, y, e.clientX, e.clientY);
		e.preventDefault();
	});
	ul.appendChild(li);
}

function updateSelectedObjectsUL(x, y) {
	let ul = document.getElementById('selectedobjectsul');
	if (!ul)
		return;

	// Empty out the list
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}

	let objs = [];
	if(withinCurrentMap(x, y)) {
		objs = [...MyMap.Objs[x][y]];
	} else {
		return;
	}

	for (let i=objs.length-1; i>=0; i--) {
		let obj = AtomFromName(objs[i]);
		let li = itemCard({"name": obj.name, "pic": obj.pic});
		li.addEventListener('contextmenu', function (e) {
			openMapObjContextMenu(x, y, i, e.clientX, e.clientY);
			e.preventDefault();
		});
		ul.appendChild(li);
	}

	document.getElementById('selectedobjects_span').style.display = (objs.length >= 1) ? 'block' : 'none';
	if(objs.length >= 2) {
		document.getElementById('mapobj_movetop').style.display = 'block';
		document.getElementById('mapobj_moveup').style.display = 'block';
		document.getElementById('mapobj_movedown').style.display = 'block';
		document.getElementById('mapobj_movebottom').style.display = 'block';
	} else {
		document.getElementById('mapobj_movetop').style.display = 'none';
		document.getElementById('mapobj_moveup').style.display = 'none';
		document.getElementById('mapobj_movedown').style.display = 'none';
		document.getElementById('mapobj_movebottom').style.display = 'none';
	}
}

function getDataForDraw() {
	if(hotbarSelectIndex !== null) {
		if(hotbarSelectIndex < hotbarData.length)
		return hotbarData[hotbarSelectIndex];
	} else if(tileDataForDraw)
		return tileDataForDraw;
	return null;
}

function PlayersAroundTile(FindX, FindY, Radius) {
	let Found = [];
	for (let index in PlayerWho) {
		if (index == PlayerYou)
			continue;
		let Mob = PlayerWho[index];
		let Distance = Math.pow(Mob.x - FindX, 2) + Math.pow(Mob.y - FindY, 2);
		if (Distance <= Radius * Radius)
			Found.push(index);
	}
	return Found;
}

// Helper function to get an element's exact position
// from https://www.kirupa.com/html5/getting_mouse_click_position.htm
function getExactPosition(el) {
	// Actually maybe getBoundingClientRect() does what I want just fine
	let rect = el.getBoundingClientRect();
	return {
		x: rect.left,
		y: rect.top,
	};
	/*
	let xPosition = 0;
	let yPosition = 0;

	while (el) {
		if (el.tagName == "BODY") {
			// deal with browser quirks with body/window/document and page scroll
			let xScrollPos = el.scrollLeft || document.documentElement.scrollLeft;
			let yScrollPos = el.scrollTop || document.documentElement.scrollTop;

			xPosition += (el.offsetLeft - xScrollPos + el.clientLeft);
			yPosition += (el.offsetTop - yScrollPos + el.clientTop);
		} else {
			xPosition += (el.offsetLeft - el.scrollLeft + el.clientLeft);
			yPosition += (el.offsetTop - el.scrollTop + el.clientTop);
		}

		el = el.offsetParent;
	}
	return {
		x: xPosition,
		y: yPosition
	};
	*/
}

function getMousePosRaw(canvas, evt) {
	let rect = getExactPosition(canvas);
	return {
		x: (evt.clientX - rect.x) | 0,
		y: (evt.clientY - rect.y) | 0
	};
}

function getMousePos(canvas, evt) {
	let rect = getExactPosition(canvas);

	return {
		x: ((evt.clientX - rect.x) / CameraScale) | 0,
		y: ((evt.clientY - rect.y) / CameraScale) | 0
	};
}

function getTilePos(evt) {
	let PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
	let PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
	pos = getMousePos(mapCanvas, evt);
	pos.x = (pos.x + PixelCameraX) >> 4;
	pos.y = (pos.y + PixelCameraY) >> 4;
	return pos;
}

function getTilePosAtPixel(pos) {
	let PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
	let PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
	let out = {x: (pos.x + PixelCameraX) >> 4, y: (pos.y + PixelCameraY) >> 4};
	return out;
}

function drawingTooFar(x, y, maxDistance) {
	let youX = PlayerWho[PlayerYou].x;
	let youY = PlayerWho[PlayerYou].y;
	let diffX = youX - x;
	let diffY = youY - y;
	let distance = Math.sqrt(diffX * diffX + diffY * diffY);
	return distance > maxDistance;
}

///////////////////////////////////////////////////////////
// Mouse handlers
///////////////////////////////////////////////////////////

function useItemAtXY(Placed, x, y) {
	if(x < 0 || y < 0 || x >= MyMap.Width || y >= MyMap.Height)
		return undefined;
	let old = null;

	switch (Placed.type) {
		case "tileset":
			viewTileset(Placed);
			console.log("Open tileset thing");
			break;
		case "map_tile":
			let ActualAtom = AtomFromName(Placed.data);
			// place the item on the ground

			// If it's a sign, offer to put text on it
			if (ActualAtom.type == AtomTypes.SIGN && !ActualAtom.message) {
				MouseDown = false; // Don't keep placing signs
				Placed = { data: CloneAtom(ActualAtom) };
				Message = prompt("What should the sign say?");
				if (Message == null)
					return;
				Placed.data.message = Message;
			}

			if (ActualAtom.obj) {
				old = [...MyMap.Objs[x][y]];
				MyMap.Objs[x][y].push(Placed.data);
				SendCmd("PUT", { pos: [x, y], obj: true, atom: MyMap.Objs[x][y] });
			} else {
				old = MyMap.Tiles[x][y];
				MyMap.Tiles[x][y] = Placed.data;
				SendCmd("PUT", { pos: [x, y], obj: false, atom: MyMap.Tiles[x][y] });
			}
			drawMap();
			break;
		case "gadget":
			SendCmd("USE", { id: Placed.id });
			break;
		}
		return old;
}

function useItem(Placed) {
	return useItemAtXY(Placed, PlayerWho[PlayerYou].x, PlayerWho[PlayerYou].y);
}

function selectionDelete() {
	if (document.getElementById("deleteTurfObj").style.display == "none")
		return;
	if (!MouseActive)
		return;
	let DeleteTurfs = document.getElementById("turfselect").checked;
	let DeleteObjs = document.getElementById("objselect").checked;

	for (let x = MouseStartX; x <= MouseEndX; x++) {
		for (let y = MouseStartY; y <= MouseEndY; y++) {
			if (x < 0 || x > MyMap.Width || y < 0 || y > MyMap.Height)
				continue;
			if (DeleteTurfs)
				MyMap.Tiles[x][y] = MyMap.Info['default'];
			if (DeleteObjs)
				MyMap.Objs[x][y] = [];
		}
	}
	SendCmd("DEL", { pos: [MouseStartX, MouseStartY, MouseEndX, MouseEndY], turf: DeleteTurfs, obj: DeleteObjs });
	ctrlZUndoType = "del";

	MouseActive = false;
	NeedMapRedraw = true;
	selectionInfoVisibility(false);
}

function selectionInfoVisibility(visibility) {
	document.getElementById("selectionInfo").style.display = visibility ? 'block' : 'none';
	if (!visibility)
		panel.innerHTML = "";
}

function handleDragging(pos) {
	if (buildTool == BUILD_TOOL_SELECT) {
		if (!MouseDown)
			return;
		if (pos.x != MouseEndX || pos.y != MouseEndY)
			NeedMapRedraw = true;
		MouseEndX = pos.x;
		MouseEndY = pos.y;
	} else if(buildTool == BUILD_TOOL_DRAW) {
		if(drawingTooFar(pos.x, pos.y, OK_DRAW_DISTANCE)) {
			drawToolX = null;
			drawToolY = null;
			return;
		}
		if(drawToolX !== MouseNowX || drawToolY !== MouseNowY) {
			drawToolX = MouseNowX;
			drawToolY = MouseNowY;
			NeedMapRedraw = true;

			if (!MouseDown)
				return;

			let coords = drawToolX + "," + drawToolY;
			if(!(coords in drawToolCurrentStroke)) {
				let data = getDataForDraw();
				if(data === null)
					return;

				let old = useItemAtXY({ type: 'map_tile', data: data }, pos.x, pos.y);
				if(old === undefined)
					return;
				drawToolCurrentStroke[coords] = old;
			}
		}
	}
}

function initMouse() {
	let edittilesheetselect = document.getElementById("edittilesheetselect");

	edittilesheetselect.addEventListener('mousedown', function (evt) {
		// update to choose the selected tile
		document.getElementById('edittilex').value = (evt.clientX - evt.target.getBoundingClientRect().x) >> 4;
		document.getElementById('edittiley').value = (evt.clientY - evt.target.getBoundingClientRect().y) >> 4;
		editItemUpdatePic();
	}, false);

	mapCanvas.addEventListener('mousedown', function (evt) {
		markNotIdle();
		if (evt.button != 0)
			return;
		if (MousedOverEntityClickAvailable && !ShiftPressed) {
			if(MousedOverEntityClickIsUse)
				SendCmd("USE", { "id": MousedOverEntityClickId })
			else
				SendCmd("EXT", { "entity_click":
					{"id": MousedOverEntityClickId, "x": MousedOverEntityClickX, "y": MousedOverEntityClickY, "target": MousedOverEntityClickIsTilemap ? "mini_tilemap" : "entity"}
				});
		return;
	}

	panel.innerHTML = "";
	let pos = getTilePos(evt);
	MouseRawPos = getMousePos(mapCanvas, evt);
	MouseDown = true;

	if (buildTool == BUILD_TOOL_SELECT) {
		MouseStartX = pos.x;
		MouseStartY = pos.y;
		MouseEndX = pos.x;
		MouseEndY = pos.y;
		MouseActive = true;
		NeedMapRedraw = true;
		selectionInfoVisibility(false);
	} else if(buildTool == BUILD_TOOL_DRAW) {
		let data = getDataForDraw();
		let atom = AtomFromName(data);
		if(data === null)
			return;
		drawToolCurrentStroke = {};
		drawToolCurrentStrokeIsObj = "obj" in atom;

		// ---

		if(drawingTooFar(pos.x, pos.y, OK_DRAW_DISTANCE)) {
			return;
		}
		let old = useItemAtXY({ type: 'map_tile', data: data }, pos.x, pos.y);
		if(old === undefined)
			return;
		drawToolCurrentStroke[(pos.x + "," + pos.y)] = old;
		ctrlZUndoType = "put";
		}
	}, false);

	mapCanvas.addEventListener('mouseup', function (evt) {
		if (evt.button != 0)
			return;
		if(!MouseDown) {
			return;
		}
		MouseRawPos = getMousePos(mapCanvas, evt);
		MouseDown = false;
		NeedMapRedraw = true;

		if (buildTool == BUILD_TOOL_SELECT) {
			// adjust the selection box
			let AX = Math.min(MouseStartX, MouseEndX);
			let AY = Math.min(MouseStartY, MouseEndY);
			let BX = Math.max(MouseStartX, MouseEndX);
			let BY = Math.max(MouseStartY, MouseEndY);
			MouseStartX = AX;
			MouseStartY = AY;
			MouseEndX = BX;
			MouseEndY = BY;

			if(withinCurrentMap(MouseStartX, MouseStartY) && MouseStartX == MouseEndX && MouseStartY == MouseEndY) {
				document.getElementById("getTileObjSpan").style.display = 'block';
				document.getElementById("selectedobjects_span").style.display = 'block';
				document.getElementById("selectedfloor_span").style.display = 'block';
				updateSelectedTurfUL(AX, AY);
				updateSelectedObjectsUL(AX, AY);
			} else {
				document.getElementById("getTileObjSpan").style.display = 'none';
				document.getElementById("selectedobjects_span").style.display = 'none';
				document.getElementById("selectedfloor_span").style.display = 'none';
			}

			let panelHTML = (BX - AX + 1) + "x" + (BY - AY + 1);
			if(MouseStartX == MouseEndX && MouseStartY == MouseEndY)
				panelHTML += " at " + MouseStartX + "," + MouseStartY;
			panelHTML += "<br>";
			updateSelectedEntitiesUL();

			let selectionWidth = BX-AX;
			let selectionHeight = BY-AY;
			let selectionCenterX = (AX+BX)/2;
			let selectionCenterY = (AY+BY)/2;
			let distanceTooFar = drawingTooFar(selectionCenterX, selectionCenterY, 10);
			document.getElementById("deleteTurfObj").style.display = (!distanceTooFar && (selectionWidth * selectionHeight) < 120) ? "block" : "none";
			selectionInfoVisibility(true);

			panel.innerHTML = panelHTML;
		} else if(buildTool == BUILD_TOOL_DRAW) {
			drawToolUndoHistory.push({
				'data': drawToolCurrentStroke,
				'obj': drawToolCurrentStrokeIsObj,
			});
			drawToolCurrentStroke = {};
		}
	}, false);

	mapCanvas.addEventListener('wheel', function (event) {
		markNotIdle();
		event.preventDefault();
		if(lockZoomLevel)
			return;

		CameraScale += event.deltaY * -0.01;

		// Restrict CameraScale
		CameraScale = Math.min(Math.max(CameraScaleMin, CameraScale), CameraScaleMax);

		updateZoomLevelDisplay();
		resizeCanvas();
	}, false);

	mapCanvas.addEventListener('mousemove', function (evt) {
		markNotIdle();
		let pos = getTilePos(evt);
		let pixelPos = getMousePos(mapCanvas, evt); // Pixel position, for finding click position within a mini tilemap
		MouseRawPos = pixelPos;
		MouseNowX = pos.x;
		MouseNowY = pos.y;
		// record the nearby players
		let Around = PlayersAroundTile(MouseNowX, MouseNowY, 2);
		if (MousedOverPlayers.length != Around.length) {
			NeedMapRedraw = true;
		}
		MousedOverEntityClickAvailable = false;

		let AroundLongerRange = PlayersAroundTile(MouseNowX, MouseNowY, 4); // Check for stuff you might click on? Maybe combine it with the other check somehow

		// Check for things you can click on
		let PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
		let PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
		for (let i in AroundLongerRange) {
			let index = AroundLongerRange[i];
			let Mob = PlayerWho[index];
			let MobOffset = Mob.offset ?? [0,0];

			let mini_tilemap = Mob.mini_tilemap;

			if(mini_tilemap && mini_tilemap.clickable) {
				let mini_tilemap_map_w = Mob.mini_tilemap.map_size[0];
				let mini_tilemap_map_h = Mob.mini_tilemap.map_size[1];
				let mini_tilemap_tile_w = Mob.mini_tilemap.tile_size[0];
				let mini_tilemap_tile_h = Mob.mini_tilemap.tile_size[1];
				let mini_tilemap_offset = Mob.mini_tilemap.offset ?? [0,0];
				let mini_tilemap_transparent_tile = Mob.mini_tilemap.transparent_tile ?? 0;
				let mini_tilemap_data = Mob.mini_tilemap_data.data;
				if(!mini_tilemap_data) continue;
				let start_pixel_x = Math.round((Mob.x * 16) - PixelCameraX + MobOffset[0] + mini_tilemap_offset[0] + 8  - (mini_tilemap_map_w * mini_tilemap_tile_w) / 2);
				let start_pixel_y = Math.round((Mob.y * 16) - PixelCameraY + MobOffset[1] + mini_tilemap_offset[1] + 16 - (mini_tilemap_map_h * mini_tilemap_tile_h));

				if(pixelPos.x < start_pixel_x || pixelPos.y < start_pixel_y || pixelPos.x >= (start_pixel_x + mini_tilemap_map_w * mini_tilemap_tile_w) || pixelPos.y >= (start_pixel_y + mini_tilemap_map_h * mini_tilemap_tile_h) ) {
					continue;
				}
				// Mouse is over the tilemap, but which part of it?

				// Is mouse over a transparent tile?
				let decompressed = [];
				for(let tileInMap of Mob.mini_tilemap_data.data) {
					let tileId = tileInMap & 4095;
					let tileRepeat = ((tileInMap  >> 12) & 127) + 1;
					while(tileRepeat && decompressed.length < (mini_tilemap_map_w * mini_tilemap_map_h)) {
						decompressed.push(tileId);
						tileRepeat--;
					}
				}
				let tilemapX = Math.floor((pixelPos.x - start_pixel_x) / mini_tilemap_tile_w);
				let tilemapY = Math.floor((pixelPos.y - start_pixel_y) / mini_tilemap_tile_h);
				let tileAtXY = decompressed[tilemapY * mini_tilemap_map_w + tilemapX];
				if(tileAtXY !== undefined && tileAtXY !== mini_tilemap_transparent_tile) {
					MousedOverEntityClickAvailable = true;
					MousedOverEntityClickId = index;
					MousedOverEntityClickIsTilemap = true;
					MousedOverEntityClickIsUse = false;
					MousedOverEntityClickX = Math.floor(pixelPos.x - start_pixel_x);
					MousedOverEntityClickY = Math.floor(pixelPos.y - start_pixel_y);
				}
			}
			// Maybe you can click on the entity itself then?
			if(!MousedOverEntityClickAvailable && (Mob.clickable || Mob.usable)) {
				// Determine where the entity would even be drawn
				let playerIs16x16 = true;
				if (index in PlayerImages) {
					let tilesetWidth = PlayerImages[index].naturalWidth;
					let tilesetHeight = PlayerImages[index].naturalHeight;
					playerIs16x16 = tilesetWidth == 16 && tilesetHeight == 16;
				}
				let entityPixelX, entityPixelY, entitySize;
				if(playerIs16x16) {
					entityPixelX = (Mob.x * 16) - PixelCameraX + MobOffset[0];
					entityPixelY = (Mob.y * 16) - PixelCameraY + MobOffset[1];
					entitySize = 16;
				} else {
					entityPixelX = (Mob.x * 16 - 8) - PixelCameraX + offset[0];
					entityPixelY = (Mob.y * 16 - 16) - PixelCameraY + offset[1];
					entitySize = 32;
				}
				if(pixelPos.x < entityPixelX || pixelPos.y < entityPixelY || pixelPos.x >= (entityPixelX + entitySize) || pixelPos.y >= (entityPixelY + entitySize) ) {
					continue;
				}
				MousedOverEntityClickAvailable = true;
				MousedOverEntityClickId = index;
				MousedOverEntityClickIsTilemap = false;
				MousedOverEntityClickIsUse = !Mob.clickable && Mob.usable;
				MousedOverEntityClickX = Math.floor(pixelPos.x - entityPixelX);
				MousedOverEntityClickY = Math.floor(pixelPos.y - entityPixelY);
			}
		}
		MousedOverPlayers = Around;
		mapCanvas.style.cursor = MousedOverEntityClickAvailable ? "pointer" : "auto";

		handleDragging(pos);
	}, false);

	// ----------------------------------------------------------------

	let selector = document.getElementById("selector");

	edittilesheetselect.addEventListener('mousedown', function (evt) {
		// update to choose the selected tile
		document.getElementById('edittilex').value = (evt.clientX - evt.target.getBoundingClientRect().x) >> 4;
		document.getElementById('edittiley').value = (evt.clientY - evt.target.getBoundingClientRect().y) >> 4;
		editItemUpdatePic();
	}, false);

	selector.addEventListener('mousedown', function (evt) {
		if (evt.button == 2)
			return;
		let pos = getMousePosRaw(selector, evt);
		let oneWidth = selector.width / 10;
		let index = Math.floor(pos.x / oneWidth);
		setHotbarIndex(index);
		hotbarDragging = true;
	}, false);

	selector.addEventListener('mousemove', function (evt) {
		if(hotbarDragging) {
			let pos = getMousePosRaw(selector, evt);
			let oneWidth = selector.width / 10;
			let index = Math.floor(pos.x / oneWidth);
			if(index == hotbarSelectIndex)
				return;
			if(index < 0 || index >= hotbarData.length)
				return;
			if(hotbarSelectIndex !== null) {
				let temp = hotbarData[hotbarSelectIndex]
				hotbarData[hotbarSelectIndex] = hotbarData[index];
				hotbarData[index] = temp;
				setHotbarIndex(index);
			}
		}
	}, false);

	selector.addEventListener('mouseup', function (evt) {
		if (evt.button == 2)
			return;
		hotbarDragging = false;
	}, false);

	selector.addEventListener('wheel', function (event) {
		event.preventDefault();
	}, false);

	selector.addEventListener('contextmenu', function (evt) {
		let pos = getMousePosRaw(selector, evt);
		let oneWidth = selector.width / 10;
		let index = Math.floor(pos.x / oneWidth);
		rightClickedHotbarIndex = index;
		let menu = document.querySelector(hotbarData[index] !== null ? '#hotbar-contextmenu' : '#hotbar-no-item-contextmenu');
		menu.style.left = (evt.clientX) + "px";
		menu.style.display = "block";
		menu.style.top = (evt.clientY - menu.offsetHeight) + "px";
		evt.preventDefault();
	}, false);
}
