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
let MousedOverEntityIsDragging = false;
let MousedOverEntityDragId = undefined;
let MousedOverEntityDragIsMapMode = false;
let MousedOverEntityDragIsTilemap = false;
let MousedOverEntityDragLastX = undefined;
let MousedOverEntityDragLastY = undefined;
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
let alreadyShowedSign = false;
let alreadyBumped = false;
let waitingOnMapScreenshot = 0; // Counts up every tick if nonzero

const OK_DRAW_DISTANCE = 5;

let autoOffsetSide = 0; // Subtract this from X offset if facing right, and add it to X offset if facing right.
let autoOffsetDiagonal = 0; // Amount to shift for diagonals specifically
let autoOffsetKeepOffset = false; // Keep previous relative offset when flipping
let bigPicEnabled = false;
let bigPicDirectionCount = 0;
let bigPicCurrentDirection = 0;
let bigPicTileOffset = 0;

///////////////////////////////////////////////////////////
// Chat
///////////////////////////////////////////////////////////

function runLocalCommand(t) {
	tl = t.toLowerCase();
	if (tl == "/clear") {
		chatArea.innerHTML = "";
		chatLogForExport = [];
		playedMusicYet = false;
		return true;
	} else if (tl == "/exportmap" || tl == "/mapexport" || tl.startsWith("/exportmap ") || tl.startsWith("/mapexport ")) {
		//logMessage('<a href="data:,'+encodeURIComponent(exportMap())+'" download="map.txt">Map download (click here)</a>', 'server_message');

		let filename = "map";
		if (t.length >= 12)
			filename = t.slice(11);
		//from https://ourcodeworld.com/articles/read/189/how-to-create-a-file-and-generate-a-download-with-javascript-in-the-browser-without-a-server
		let element = document.createElement('a');
		element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(exportMap()));
		element.setAttribute('download', filename+".txt");
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
		return true;
	} else if (tl == "/mapscreenshot") {
		if (allMapImagesLoaded()) {
			openMapScreenshot();
		} else {
			waitingOnMapScreenshot = 1;
		}
		return true;
	} else if (tl.startsWith("/playmusic ")) {
		playMusic(t.slice(11), true);
		return true;
	} else if (tl.startsWith("/openprofile ") || tl.startsWith("/userprofile ")) {
		SendCmd("EXT", { "get_user_profile": {"username": t.slice(13)} });
		return true;
	} else if (tl == "/stopmusic") {
		stopMusic();
		return true;
	} else if (tl == "/releasekeys") {
		forceReleaseKeys();
		return true;
	} else if (tl == "/cameraxy") {
		CameraOverrideX = null;
		CameraOverrideY = null;
		return true;
	} else if (tl.startsWith("/cameraxy ")) {
		let arg = t.slice(10).split(' ');
		if(arg.length == 2) {
			CameraOverrideX = parseInt(arg[0]);
			if (Number.isNaN(CameraOverrideX))
				CameraOverrideX = null;
			CameraOverrideY = parseInt(arg[1]);
			if (Number.isNaN(CameraOverrideY))
				CameraOverrideY = null;
		}
		return true;
	} else if (tl == "/exportlogs" || tl == "/exportlog") {
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
	} else if(tl == "/clearhotbar") {
		hotbarData = [null, null, null, null, null, null, null, null, null, null];
		hotbarSelectIndex = null;
		hotbarDragging = false;
		drawHotbar();
		return true;
	} else if(tl.startsWith("/edititem ")) {
		editItemID = parseInt(t.slice(10));
		if (Number.isNaN(editItemID))
			return true;
		editItemWaitingForDataID = editItemID;
		SendCmd("BAG", {info: { id: editItemID }});
		return true;
	} else if(tl === "/tailshift") {
		autoOffsetSide = 0;
		autoOffsetDiagonal = 0;
		SendCmd("MOV", {offset: [0, 0]});
		return true;
	} else if(tl.startsWith("/tailshift ") || tl.startsWith("/tailshifto ")) {
		let s = tl.slice(tl.startsWith("/tailshift ") ? 11 : 12).split(" ");
		autoOffsetKeepOffset = tl.startsWith("/tailshifto ");
		autoOffsetSide = parseInt(s[0]);
		if (Number.isNaN(autoOffsetSide))
			autoOffsetSide = 0;
		autoOffsetDiagonal = 0;
		if (s.length > 1) {
			autoOffsetDiagonal = parseInt(s[1]);
			if (Number.isNaN(autoOffsetDiagonal))
				autoOffsetDiagonal = 0;
		}
		if (PlayerImages[PlayerYou]) {
			const direction = (PlayerImages[PlayerYou].naturalHeight >= 128) ? PlayerAnimation[PlayerYou].lastDirection4 : PlayerAnimation[PlayerYou].lastDirectionLR;
			switch (direction) {
				case Directions.EAST:
					SendCmd("MOV", {offset: [-autoOffsetSide, 0]});
					break;
				case Directions.WEST:
					SendCmd("MOV", {offset: [autoOffsetSide, 0]});
					break;
				case Directions.NORTH: case Directions.SOUTH:
					SendCmd("MOV", {offset: [0, 0]});
					break;
				case Directions.NORTHEAST: case Directions.SOUTHEAST:
					SendCmd("MOV", {offset: [-autoOffsetDiagonal, 0]});
					break;
				case Directions.NORTHWEST: case Directions.SOUTHWEST:
					SendCmd("MOV", {offset: [autoOffsetDiagonal, 0]});
					break;
			}
		}
		return true;
	} else if(tl === "/bigpic") {
		bigPicEnabled = false;
		bigPicDirectionCount = 0;
		SendCmd("WHO", { update: { mini_tilemap: null } });
		return true;
	} else if(tl.startsWith("/bigpic ")) {
		bigPicEnabled = false;
		bigPicDirectionCount = 0;
		bigPicTileOffset = 0;
		let args = tl.slice(8);
		if (args !== "off") {
			args = args.split(' ');
			if (args.length >= 3) {
				let url = t.slice(8).split(' ')[0];
				let frameWidth = parseInt(args[1]);
				let frameHeight = parseInt(args[2]);
				if ((url.startsWith("http://") || url.startsWith("https://")) && !Number.isNaN(frameWidth) && !Number.isNaN(frameHeight)) {
					let out = {"map_size": [1,1], "tile_size": [frameWidth, frameHeight], "tileset_url": url, "transparent_tile": -1};
					for (let i=3; i<args.length; i++) {
						let a = args[i].split("=");
						if (a.length !== 2)
							continue;
						if (a[0] === "d") {
							bigPicDirectionCount = parseInt(a[1]);
							if (Number.isNaN(bigPicDirectionCount) || (bigPicDirectionCount<1))
								bigPicDirectionCount = 1;
						} else if (a[0] === "o") {
							let c = a[1].split(",");
							if (c.length === 2) {
								let ox = parseInt(c[0]);
								let oy = parseInt(c[1]);
								if (!Number.isNaN(ox) && !Number.isNaN(oy))
									out.offset = [ox, oy];
							}
						} else if (a[0] === "to") {
							let c = a[1].split(",");
							if (c.length === 2) {
								let ox = parseInt(c[0]);
								let oy = parseInt(c[1]);
								if (!Number.isNaN(ox) && !Number.isNaN(oy))
									bigPicTileOffset = ox | (oy<<6);
							}
						}
					}
					bigPicEnabled = true;
					bigPicCurrentDirection = getBigPicDirection();
					SendCmd("WHO", { update: { mini_tilemap: out, mini_tilemap_data: {data: [Math.min(4095, Math.max(0, bigPicCurrentDirection+bigPicTileOffset))]} } });
					return true;
				}
			}
		}

		SendCmd("WHO", { update: { mini_tilemap: null } });
		return true;
	} else if(tl === "/cancelcommands") {
		MessagesToRetry = [];
		return true;
	} else if(tl === "/whatturf") {
		let tile = MyMap.Tiles[PlayerWho[PlayerYou].x][PlayerWho[PlayerYou].y];
		logMessage(convertBBCodeChat(`You're standing on [tt]${JSON.stringify(tile)}[/tt]`), 'server_message',   {'isChat': false});
		return true;
	} else if(tl === "/whatobjs" || tl === "/whatobj") {
		let tile = MyMap.Objs[PlayerWho[PlayerYou].x][PlayerWho[PlayerYou].y];
		logMessage(convertBBCodeChat(`You're standing on [tt]${JSON.stringify(tile)}[/tt] (objects)`), 'server_message',   {'isChat': false});
		return true;
	} else if(tl == "/focuschat") {
		focusChatDistance = null;
		focusChatNames = [];
		logMessage("Not focusing chat", 'server_message',   {'isChat': false});
		return true;
	} else if(tl.startsWith("/focuschat ")) {
		let args = tl.slice(11);
		if (args == "off") {
			focusChatDistance = null;
			focusChatNames = [];
			logMessage("Not focusing chat", 'server_message',   {'isChat': false});
			return true;
		}
		args = args.split(' ');
		if (args.length == 0)
			return true;
		if (args[0] === "names" || args[0] === "name" || args[0] === "username" || args[0] === "n") {
			focusChatDistance = null;
			focusChatNames = args.slice(1);
			logMessage(convertBBCodeChat("Focusing chat on: "+(focusChatNames.join(", "))), 'server_message',   {'isChat': false});
		} else if (args[0] === "distance" || args[0] === "d") {
			focusChatNames = [];
			focusChatDistance = parseInt(args[1]);
			if (Number.isNaN(focusChatDistance)) {
				logMessage("Invalid distance", 'server_message', {'isChat': false});		
				focusChatDistance = null;
			} else {
				logMessage("Setting chat focus distance to "+focusChatDistance, 'server_message', {'isChat': false});
			}
		} else if (args[0] === "distancenames" || args[0] === "distancename" || args[0] === "dn") {
			focusChatDistance = parseInt(args[1]);
			if (Number.isNaN(focusChatDistance)) {
				logMessage("Invalid distance", 'server_message', {'isChat': false});
				focusChatDistance = null;
				focusChatNames = [];
			} else {
				focusChatNames = args.slice(2);
				logMessage("Setting chat focus distance to "+focusChatDistance+" - plus "+focusChatNames.join(", "), 'server_message', {'isChat': false});					
			}
		} else {
			logMessage("Unrecognized /focuschat option", 'server_message', {'isChat': false});					
		}
		return true;
	} else if(tl == "/noaudionotify") {
		AudioChatNotifications = false;
		AudioMiscNotifications = false;
		return true;
	} else if(tl.startsWith("/notifications ")) {
		let args = tl.slice(15);
		desktopNotificationNoAudio = args == "noaudio";
		if (args == "on" || args == "noaudio") {
			if (!("Notification" in window)) {
				alert("This browser does not support desktop notifications");
			} else if (Notification.permission === "granted") {
				const notification = new Notification("Tilemap Town", {body: "Notifications turned on", icon: desktopNotificationIcon, badge: desktopNotificationIcon});
				enableDesktopNotifications = true;
			} else if (Notification.permission !== "denied") {
				Notification.requestPermission().then((permission) => {
				if (permission === "granted") {
					const notification = new Notification("Tilemap Town", {body: "Notifications turned on", icon: desktopNotificationIcon, badge: desktopNotificationIcon});
					enableDesktopNotifications = true;
				}
				});
			}
		} else if (args == "off") {
			enableDesktopNotifications = false;
		}
		return true;
	}
	return false;
}

function setChatInput(the_text) {
	chatInput.value = the_text;
	chatInput.focus();
	sendTyping();
}

function sendChatCommand(the_text) {
	SendCmd("CMD", { text: the_text });
}

function sendTyping() {
	markNotIdle();

	let lowercase = chatInput.value.trimStart();
	const isTyping = document.activeElement === chatInput && chatInput.value.length > 0 && (!lowercase.startsWith("/") || lowercase.startsWith("/me ") || lowercase.startsWith("/ooc ") || lowercase.startsWith("/spoof "));

	if (PlayerWho[PlayerYou].typing != isTyping) {
		SendCmd("WHO", { update: { typing: isTyping } });
		PlayerWho[PlayerYou].typing = isTyping;
		drawMap();
	}
}

function openMapScreenshot() {
	let win = window.open("about:blank", "Map");
	win.onload = function() {
		win.document.body.innerHTML = `<html><head><title>Map screenshot</title></head><body>Map size: ${MyMap.Width}&times;${MyMap.Height}<br></body></html>`;

		let canvas = win.document.createElement('canvas');
		win.document.body.appendChild(canvas);

		canvas.width = MyMap.Width * 16;
		canvas.height = MyMap.Height * 16;
		let ctx = canvas.getContext("2d");
		ctx.beginPath();
		ctx.fillStyle = "#000000";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		let oldTimer = tenthOfSecondTimer;
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
		tenthOfSecondTimer = oldTimer;
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
	alreadyShowedSign = false;
	alreadyBumped = false;
	markNotIdle();
	var e = e || window.event;
	ShiftPressed = e.shiftKey;
	CtrlPressed = e.ctrlKey;
	if(takeControlsEnabled && takeControlsKeyUp && document.activeElement.tagName != "INPUT" && document.activeElement.tagName != "TEXTAREA") {
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

let lastSignMessage = undefined;
function bump_into_atom(atom) {
	if (atom.type == AtomTypes.SIGN && atom.message && (!alreadyShowedSign || atom.message != lastSignMessage)) {
		logMessage(((atom.name != "sign" && atom.name != "") ? escape_tags(atom.name) + " says: " : "The sign says: ") + convertBBCodeChat(atom.message), "sign_message",
		  {'plainText': (atom.name != "sign" && atom.name != "") ? atom.name + " says: " + atom.message : "The sign says: " + atom.message});
		lastSignMessage = atom.message;
		alreadyShowedSign = true;
	}
}

function getRandomInt(min, max) {
	const minCeiled = Math.ceil(min);
	const maxFloored = Math.floor(max);
	return Math.floor(Math.random() * (maxFloored - minCeiled) + minCeiled); // The maximum is exclusive and the minimum is inclusive
}

function applyTailShift(OldPlayerDir, PlayerDir) {
	// Automatically shift the offset left and right to account for a sprite that isn't centered at the middle of the sprite
	if (autoOffsetSide !== 0 && OldPlayerDir !== PlayerDir) {
		if (PlayerImages[PlayerYou]) {
			const directionCount = PlayerImages[PlayerYou].naturalHeight / 32;
			const lastDirection = (directionCount == 8) ? OldPlayerDir : ((directionCount == 4) ? PlayerAnimation[PlayerYou].lastDirection4 : PlayerAnimation[PlayerYou].lastDirectionLR);
			const offset = PlayerWho[PlayerYou].offset ?? [0,0];
			if (
				(directionCount === 8
				|| (directionCount === 4 && ((PlayerDir & 1) == 0))
				|| (directionCount === 2 && (PlayerDir === Directions.EAST || PlayerDir === Directions.WEST) ))) {
				let undoShift = 0;
				switch(lastDirection) {
					case Directions.EAST:
						undoShift = autoOffsetSide;
						break;
					case Directions.WEST:
						undoShift = -autoOffsetSide;
						break;
					case Directions.SOUTHEAST: case Directions.NORTHEAST:
						undoShift = autoOffsetDiagonal;
						break;
					case Directions.SOUTHWEST: case Directions.NORTHWEST:
						undoShift = -autoOffsetDiagonal;
						break;
				}
				if (!autoOffsetKeepOffset)
					undoShift = -offset[0];
				let newShift = 0;
				switch(PlayerDir) {
					case Directions.EAST:
						newShift = -autoOffsetSide;
						break;
					case Directions.WEST:
						newShift = autoOffsetSide;
						break;
					case Directions.SOUTHEAST: case Directions.NORTHEAST:
						newShift = -autoOffsetDiagonal;
						break;
					case Directions.SOUTHWEST: case Directions.NORTHWEST:
						newShift = autoOffsetDiagonal;
						break;
				}
				let newXOffset = offset[0] + undoShift + newShift;
				if (newXOffset !== offset[0])
					return [newXOffset, offset[1]];
			}
		}
	}
	return null;
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
		} else if (document.activeElement == chatInput && e.keyCode == 13 && !e.shiftKey) {
			if (chatInput.value.toLowerCase().trim() == "/oops") {
				chatInput.value = lastChatUsed;
				sendTyping();
				return;
			}
			if (chatInput.value.length > 5)
				lastChatUsed = chatInput.value;

			// First, check for commands that are local to the client
			const startsWithNewline = chatInput.value.startsWith("\n");
			let trimmedChatText = chatInput.value.trimStart();
			if (warnInvalidBBCode) {
				let tryBBCode = XBBCODE.process({
					text: trimmedChatText,
					removeMisalignedTags: false,
					addInLineBreaks: true
				});
				if (tryBBCode.error) {
					if (!confirm("BBCode is invalid; post anyway?\n* "+tryBBCode.errorQueue.join("\n *"))) {
						e.preventDefault();
						return;
					}
				}
			}

			if (runLocalCommand(trimmedChatText));
				// commands are CMD while regular room messages are MSG. /me is a room message.
			else if (trimmedChatText.slice(0, 1) == "/" &&
				trimmedChatText.toLowerCase().slice(0, 4) != "/me " &&
			trimmedChatText.toLowerCase().slice(0, 5) != "/ooc " &&
			trimmedChatText.toLowerCase().slice(0, 7) != "/spoof ") {
				SendCmd("CMD", { text: trimmedChatText.slice(1) }); // remove the /
			} else if (filterChatType === "private") {
				e.preventDefault();
				return;
			} else if (trimmedChatText.length > 0) {
				SendCmd("MSG", { text: (startsWithNewline?"\n":"") + trimmedChatText });
			} else {
				chatInput.blur();
			}

			e.preventDefault();
			chatInput.value = "";

			sendTyping();
			if (focusMapAfterChat)
				chatInput.blur();
		} else if (document.activeElement == chatInput && e.keyCode == 27) {
			// escape press
			chatInput.blur();
		}
		return;
	}

	if(takeControlsEnabled && document.activeElement.tagName != "INPUT" && document.activeElement.tagName != "TEXTAREA") {
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
				e.preventDefault();
				return;
			}
		}    
	}

	let PlayerX = PlayerWho[PlayerYou].x;
	let PlayerY = PlayerWho[PlayerYou].y;
	let PlayerDir = PlayerWho[PlayerYou].dir;
	let OldPlayerX = PlayerX;
	let OldPlayerY = PlayerY;
	let Bumped = false, BumpedX = null, BumpedY = null;
	let OldPlayerDir = PlayerWho[PlayerYou].dir;

	if (e.code == "Space") { // space or clear
		let data = getDataForDraw();
		if(data !== null) {
			if (data[usableItemSymbol]) {
				useItem(data.use_item_id);
			} else {
				useItem({ type: 'map_tile', data: data});
			}
		}
	} if (e.code == "Delete") { // delete
		selectionDelete();
	} else if (e.code == "Escape") { // escape
		MouseActive = false;
		MouseDown = false;
		panel.innerHTML = "";
		NeedMapRedraw = true;
		backdropDrawAll = true;
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
			backdropDrawAll = true;
		} else if(buildTool == BUILD_TOOL_DRAW) {
			buildTool = BUILD_TOOL_SELECT;
			isSelect = document.getElementById("buildToolSelect").checked = true;
			isDraw = document.getElementById("buildToolDraw").checked = false;
			drawToolX = null;
			drawToolY = null;
			NeedMapRedraw = true;
			backdropDrawAll = true;
		}
	} else if (e.code == "KeyK") { // Kiss
		const dir = PlayerWho[PlayerYou].dir;
		SendCmd("EXT", {"user_particle":{"at": [PlayerWho[PlayerYou].x + DirX[dir], PlayerWho[PlayerYou].y + DirY[dir]], "pic": DefaultPics.hearts ?? [0,27,86], "duration":10, "offset":[getRandomInt(-4, 4+1), -8+getRandomInt(-4, 4+1)]}});
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
		if(!Fly && MyMap.Objs && MyMap.Tiles) {
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

		// Automatically shift the offset left and right to account for a sprite that isn't centered at the middle of the sprite
		let offset = applyTailShift(OldPlayerDir, PlayerDir);
		if (offset !== null) {
			Params['offset'] = offset;
			PlayerWho[PlayerYou].offset = offset;
		}

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
			if (!Bumped || !alreadyBumped) {
				SendCmd("MOV", Params);
				alreadyBumped = Bumped;
			}
			movePlayer(PlayerYou, PlayerX, PlayerY, PlayerDir, new Set([PlayerYou]));
		}

		// Apply bigpic feature
		if (bigPicEnabled) {
			let newDirection = getBigPicDirection();
			if (newDirection !== bigPicCurrentDirection) {
				bigPicCurrentDirection = newDirection;
				SendCmd("WHO", { update: { mini_tilemap_data: {data: [Math.min(4095, Math.max(0, bigPicCurrentDirection+bigPicTileOffset))]} } });
			}
		}
	}
}
document.onkeydown = keyDownHandler;
document.onkeyup = keyUpHandler;

function getBigPicDirection() {
	switch (bigPicDirectionCount) {
		case 1:
			return 0;
		case 2:
			return ((PlayerAnimation[PlayerYou]?.lastDirectionLR ?? 0) / 4) << 6;
		case 4:
			return ((PlayerAnimation[PlayerYou]?.lastDirection4 ?? 0) / 2) << 6;
		case 8:
			return PlayerWho[PlayerYou].dir << 6;
	}
	return 0;
}

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

function getMousePosRaw(canvas, evt) {
	let rect = canvas.getBoundingClientRect();
	return {
		x: (evt.clientX - rect.left) | 0,
		y: (evt.clientY - rect.top) | 0
	};
}

function getMousePos(canvas, evt) {
	let rect = canvas.getBoundingClientRect();

	return {
		x: ((evt.clientX - rect.left) / CameraScale) | 0,
		y: ((evt.clientY - rect.top) / CameraScale) | 0
	};
}

function getTilePos(evt) {
	let PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
	let PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
	let pos = getMousePos(mapCanvas, evt);
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
	if (typeof Placed === 'string' || typeof Placed === 'number') {
		Placed = DBInventory[Placed] || PlayerWho[Placed];
		if (!Placed)
			return;
	}
	if(x < 0 || y < 0 || x >= MyMap.Width || y >= MyMap.Height)
		return undefined;
	let old = null;

	switch (Placed.type) {
		case "tileset":
			viewTileset(Placed);
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
			mapWasChanged = true;
			markTilesAsDirty(MyMap, x-1, y-1, 3, 3, BACKDROP_DIRTY_RENDER);
			drawMap();
			break;
		case "generic":
		case "gadget":
			SendCmd("USE", { id: Placed.id });
			break;
		case "client_data":
			if (Placed.data.type === "command_list")
				viewCommandList(Placed);
			else if (Placed.data.type === "map_tile_list")
				viewMapTileList(Placed);
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
	backdropRerenderAll = true;
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
		if (pos.x != MouseEndX || pos.y != MouseEndY) {
			NeedMapRedraw = true;
			backdropDrawAll = true;
		}
		MouseEndX = pos.x;
		MouseEndY = pos.y;
	} else if(buildTool == BUILD_TOOL_DRAW) {
		if(drawingTooFar(pos.x, pos.y, OK_DRAW_DISTANCE)) {
			markAreaAroundPointAsDirty(MyMap, drawToolX, drawToolY, 3);
			drawToolX = null;
			drawToolY = null;
			return;
		}
		if(drawToolX !== MouseNowX || drawToolY !== MouseNowY) {
			markAreaAroundPointAsDirty(MyMap, drawToolX, drawToolY, 3);
			drawToolX = MouseNowX;
			drawToolY = MouseNowY;
			markAreaAroundPointAsDirty(MyMap, drawToolX, drawToolY, 3);
			NeedMapRedraw = true;

			if (!MouseDown)
				return;

			let coords = drawToolX + "," + drawToolY;
			if(!(coords in drawToolCurrentStroke)) {
				let data = getDataForDraw();
				if(data === null || data[usableItemSymbol])
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

	let edittilesheetselectzoom = document.getElementById("itemEditTilePickerWindowImg");
	itemEditTilePickerWindowImg.addEventListener('mousedown', function (evt) {
		// update to choose the selected tile
		document.getElementById('edittilex').value = (evt.clientX - evt.target.getBoundingClientRect().x) >> 5;
		document.getElementById('edittiley').value = (evt.clientY - evt.target.getBoundingClientRect().y) >> 5;
		editItemUpdatePic();
		document.getElementById('itemEditTilePickerWindow').style.display = "none";
	}, false);

	function handleMouseMove(pos, pixelPos) {
		markNotIdle();
		MouseRawPos = pixelPos;
		MouseNowX = pos.x;
		MouseNowY = pos.y;
		// record the nearby players
		let Around = PlayersAroundTile(MouseNowX, MouseNowY, 2);
		if (MousedOverPlayers.length !== Around.length) {
			NeedMapRedraw = true;
			backdropDrawAll = true;
		} else {
			for (let i=0; i<MousedOverPlayers.length; i++) {
				if (MousedOverPlayers[i] !== Around[i]) {
					NeedMapRedraw = true;
					backdropDrawAll = true;
					break;
				}
			}
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
					entityPixelX = (Mob.x * 16 - 8) - PixelCameraX + MobOffset[0];
					entityPixelY = (Mob.y * 16 - 16) - PixelCameraY + MobOffset[1];
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

		// Potentially send drag updates too, if you're currently dragging something
		if (MousedOverEntityIsDragging && (MousedOverEntityDragId in PlayerWho)) {
			let Mob = PlayerWho[MousedOverEntityDragId];
			let MobOffset = Mob.offset ?? [0,0];

			if (MousedOverEntityDragIsMapMode) {
				if (pos.x !== MousedOverEntityDragLastX || pos.y !== MousedOverEntityDragLastY)
					SendCmd("EXT", { "entity_drag":
						{"id": MousedOverEntityDragId, "map_x": pos.x, "map_y": pos.y, "from_map_x": MousedOverEntityDragLastX ?? null, "from_map_y": MousedOverEntityDragLastY ?? null, "target": MousedOverEntityDragIsTilemap ? "mini_tilemap" : "entity"}
					});
				MousedOverEntityDragLastX = pos.x;
				MousedOverEntityDragLastY = pos.y;
			} else {
				// Determine the bounding box of the entity being dragged over
				let rectX = undefined, rectY = undefined, rectWidth = undefined, rectHeight = undefined;
				if (MousedOverEntityDragIsTilemap) {
					let mini_tilemap = Mob.mini_tilemap;
					let mini_tilemap_offset = Mob.mini_tilemap.offset ?? [0,0];
					let mini_tilemap_transparent_tile = Mob.mini_tilemap.transparent_tile ?? 0;
					rectWidth = Mob.mini_tilemap.map_size[0] * Mob.mini_tilemap.tile_size[0];
					rectHeight = Mob.mini_tilemap.map_size[1] * Mob.mini_tilemap.tile_size[1];
					rectX = Math.round((Mob.x * 16) - PixelCameraX + MobOffset[0] + mini_tilemap_offset[0] + 8  - rectWidth / 2);
					rectY = Math.round((Mob.y * 16) - PixelCameraY + MobOffset[1] + mini_tilemap_offset[1] + 16 - rectHeight);
				} else {
					let playerIs16x16 = true;
					if (MousedOverEntityDragId in PlayerImages) {
						let tilesetWidth = PlayerImages[MousedOverEntityDragId].naturalWidth;
						let tilesetHeight = PlayerImages[MousedOverEntityDragId].naturalHeight;
						playerIs16x16 = tilesetWidth == 16 && tilesetHeight == 16;
					}
					if(playerIs16x16) {
						rectX = (Mob.x * 16) - PixelCameraX + MobOffset[0];
						rectY = (Mob.y * 16) - PixelCameraY + MobOffset[1];
						rectWidth = 16;
						rectHeight = 16;
					} else {
						rectX = (Mob.x * 16 - 8) - PixelCameraX + MobOffset[0];
						rectY = (Mob.y * 16 - 16) - PixelCameraY + MobOffset[1];
						rectWidth = 32;
						rectHeight = 32;
					}
				}

				let within = rectX !== undefined && pixelPos.x >= rectX && pixelPos.y >= rectY && pixelPos.x < (rectX+rectWidth) && pixelPos.y < (rectY+rectHeight);
				let dragX = Math.floor(pixelPos.x - rectX);
				let dragY = Math.floor(pixelPos.y - rectY);
				if (within && (dragX !== MousedOverEntityDragLastX || dragY !== MousedOverEntityDragLastY)) {
					SendCmd("EXT", { "entity_drag":
						{"id": MousedOverEntityDragId, "x": dragX, "y": dragY, "from_x": MousedOverEntityDragLastX ?? null, "from_y": MousedOverEntityDragLastY ?? null, "target": MousedOverEntityDragIsTilemap ? "mini_tilemap" : "entity"}
					});
				}
				MousedOverEntityDragLastX = dragX;
				MousedOverEntityDragLastY = dragY;
			}
		}

		if (!MousedOverEntityIsDragging)
			handleDragging(pos);
	}

	function handleMouseDown(pos, pixelPos) {
		markNotIdle();
		if (MousedOverEntityClickAvailable && !ShiftPressed) {
			if(MousedOverEntityClickIsUse)
				SendCmd("USE", { "id": MousedOverEntityClickId })
			else {
				SendCmd("EXT", { "entity_click":
					{"id": MousedOverEntityClickId, "x": MousedOverEntityClickX, "y": MousedOverEntityClickY, "target": MousedOverEntityClickIsTilemap ? "mini_tilemap" : "entity"}
				});
				if (!MousedOverEntityClickIsTilemap && (PlayerWho[MousedOverEntityClickId]?.clickable === "drag" || PlayerWho[MousedOverEntityClickId]?.clickable === "map_drag")
				|| (MousedOverEntityClickIsTilemap && (PlayerWho[MousedOverEntityClickId]?.mini_tilemap?.clickable === "drag" || PlayerWho[MousedOverEntityClickId]?.mini_tilemap?.clickable === "map_drag"))) {
					MousedOverEntityIsDragging = true;
					MousedOverEntityDragId = MousedOverEntityClickId;
					MousedOverEntityDragIsMapMode = PlayerWho[MousedOverEntityClickId]?.clickable === "map_drag";
					MousedOverEntityDragIsTilemap = MousedOverEntityClickIsTilemap;
					MousedOverEntityDragLastX = MousedOverEntityDragIsMapMode ? PlayerWho[MousedOverEntityClickId]?.x : MousedOverEntityClickX;
					MousedOverEntityDragLastY = MousedOverEntityDragIsMapMode ? PlayerWho[MousedOverEntityClickId]?.y : MousedOverEntityClickY;
				}
			}
			return;
		}

		panel.innerHTML = "";
		MouseRawPos = pixelPos;
		MouseDown = true;

		if (buildTool == BUILD_TOOL_SELECT) {
			MouseStartX = pos.x;
			MouseStartY = pos.y;
			MouseEndX = pos.x;
			MouseEndY = pos.y;
			MouseActive = true;
			NeedMapRedraw = true;
			backdropDrawAll = true;
			selectionInfoVisibility(false);
		} else if(buildTool == BUILD_TOOL_DRAW) {
			let data = getDataForDraw();
			let atom = AtomFromName(data);
			if(data === null || data[usableItemSymbol])
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
	}

	function handleMouseUp(pos, pixelPos) {
		if (MousedOverEntityIsDragging) {
			MousedOverEntityIsDragging = false;
			SendCmd("EXT", { "entity_drag_end":
				{"id": MousedOverEntityClickId, "target": MousedOverEntityClickIsTilemap ? "mini_tilemap" : "entity"}
			});
		}
		if(!MouseDown) {
			return;
		}
		MouseRawPos = pixelPos;
		MouseDown = false;
		NeedMapRedraw = true;
		backdropDrawAll = true;

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
	}

	let hadTouchEventYet = false;

	mapCanvas.addEventListener('mousedown', function (evt) {
		if (evt.button != 0 || hadTouchEventYet)
			return;
		let pos = getTilePos(evt);
		let pixelPos = getMousePos(mapCanvas, evt);
		handleMouseDown(pos, pixelPos);
	}, false);

	mapCanvas.addEventListener('mouseup', function (evt) {
		if (evt.button != 0 || hadTouchEventYet)
			return;
		let pos = getTilePos(evt);
		let pixelPos = getMousePos(mapCanvas, evt);
		handleMouseUp(pos, pixelPos);
	}, false);

	mapCanvas.addEventListener('mousemove', function (evt) {
		if (hadTouchEventYet)
			return;
		let pos = getTilePos(evt);
		let pixelPos = getMousePos(mapCanvas, evt);
		handleMouseMove(pos, pixelPos);
	}, false);

	mapCanvas.addEventListener('wheel', function (event) {
		markNotIdle();
		event.preventDefault();
		if(lockZoomLevel)
			return;

		CameraScale += event.deltaY * -0.01;

		// Restrict CameraScale
		if (Number.isNaN(CameraScale))
			CameraScale = 3;
		CameraScale = Math.min(Math.max(CameraScaleMin, CameraScale), CameraScaleMax);

		updateZoomLevelDisplay();
		resizeCanvas();
	}, false);

	function getTouchPositions(evt) {
		hadTouchEventYet = true;
		let rect = mapCanvas.getBoundingClientRect();
		let pixelPos = {
			x: ((evt.changedTouches[0].pageX - rect.left) / CameraScale) | 0,
			y: ((evt.changedTouches[0].pageY - rect.top) / CameraScale) | 0
		};
		let PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
		let PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
		let pos = {
			x: (pixelPos.x + PixelCameraX) >> 4,
			y: (pixelPos.y + PixelCameraY) >> 4
		}
		return [pos, pixelPos];
	}

	mapCanvas.addEventListener('touchstart', function (evt) {
		let [pos, pixelPos] = getTouchPositions(evt);
		handleMouseMove(pos, pixelPos);
		handleMouseDown(pos, pixelPos);
	}, false);

	mapCanvas.addEventListener('touchmove', function (evt) {
		let [pos, pixelPos] = getTouchPositions(evt);
		handleMouseMove(pos, pixelPos);
	}, false);

	mapCanvas.addEventListener('touchend', function (evt) {
		let [pos, pixelPos] = getTouchPositions(evt);
		handleMouseUp(pos, pixelPos);
	}, false);

	// ----------------------------------------------------------------

	let selector = document.getElementById("selector");

	edittilesheetselect.addEventListener('mousedown', function (evt) {
		// update to choose the selected tile
		document.getElementById('edittilex').value = (evt.clientX - evt.target.getBoundingClientRect().x) >> 4;
		document.getElementById('edittiley').value = (evt.clientY - evt.target.getBoundingClientRect().y) >> 4;
		editItemUpdatePic();
	}, false);

	function hotbarMouseDown(x) {
		let oneWidth = selector.width / 10;
		let index = Math.floor(x / oneWidth);
		setHotbarIndex(index);
		hotbarDragging = true;
	}

	function hotbarDrag(x) {
		let oneWidth = selector.width / 10;
		let index = Math.floor(x / oneWidth);
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

	selector.addEventListener('mousedown', function (evt) {
		if (evt.button == 2 || hadTouchEventYet)
			return;
		let pos = getMousePosRaw(selector, evt);
		hotbarMouseDown(pos.x);
	}, false);

	selector.addEventListener('mousemove', function (evt) {
		if(hotbarDragging && !hadTouchEventYet) {
			let pos = getMousePosRaw(selector, evt);
			hotbarDrag(pos.x);
		}
	}, false);

	selector.addEventListener('mouseup', function (evt) {
		if (evt.button == 2 || hadTouchEventYet)
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
		let menu;
		if (hotbarData[index] !== null) {
			menu = document.querySelector('#hotbar-contextmenu');
			const isActuallyItem = (typeof hotbarData[index] === "object") && (usableItemSymbol in hotbarData[index]);
			document.getElementById("copyHotbarSlotToInventoryLi").style.display = isActuallyItem ? "none" : "block";
			document.getElementById("editHotbarSlotLi").style.display = isActuallyItem ? "none" : "block";
		} else {
			menu = document.querySelector('#hotbar-no-item-contextmenu');
		}
		menu.style.left = (evt.clientX - CONTEXT_MENU_OPEN_OFFSET) + "px";
		menu.style.display = "block";
		menu.style.top = (evt.clientY - menu.offsetHeight + CONTEXT_MENU_OPEN_OFFSET) + "px";
		showCopyToTilesetLiIfNeeded("copyHotbarSlotToTilesetLi");
		evt.preventDefault();
	}, false);

	selector.addEventListener('touchstart', function (evt) {
		hadTouchEventYet = true;
		hotbarMouseDown(evt.changedTouches[0].pageX - selector.getBoundingClientRect().left);
	}, false);

	selector.addEventListener('touchmove', function (evt) {
		hadTouchEventYet = true;
		if(hotbarDragging) {
			hotbarDrag(evt.changedTouches[0].pageX - selector.getBoundingClientRect().left);
		}
	}, false);

	selector.addEventListener('touchend', function (evt) {
		hotbarDragging = false;
	}, false);
}
