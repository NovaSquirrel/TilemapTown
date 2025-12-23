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

///////////////////////////////////////////////////////////
// Global variables
///////////////////////////////////////////////////////////

messaging_mode = false;
touch_mode = false;

// The client's entity ID
let PlayerYou = "me";

// The list of entities on the map
let PlayerWho = { me: { name: "Player", pic: ["#", 0, 0], x: 5, y: 5, dir: 2, passengers: [] } };

// Walk through walls?
let Fly = false;

// Dictionary of Image objects
let PlayerImages = {}; // For entities
let PlayerMiniTilemapImages = {}; // For entities' mini tilemaps
let PlayerParticleImages = {};

// Dictionary of animation statuses
let PlayerAnimation = {
  "me": {
    "walkTimer": 0,// Amount of ticks where the player should be animated as walking
    "lastDirectionLR": 0, // Most recent direction the entity used that was left or right
    "lastDirection4": 0, // Most recent direction the entity used that was left, right, up or down
  }
}

let PlayerBuildMarkers = {}; // EntityID: {pos: [x,y], name: string, timer: ticks, del: true/false}
let UserParticles = [];

// Camera settings
// Note that CameraX and CameraY are the pixel coordinates of the *center* of the screen, rather than the top left
let CameraX = 0;
let CameraY = 0;
let CameraAlwaysCenter = true;
let CameraOverrideX = null;
let CameraOverrideY = null;
let InstantCamera = false;

let CameraScale = 3;
const CameraScaleMin = 1;
const CameraScaleMax = 8;

// Audio settings
let AudioChatNotifications = true;
let AudioMiscNotifications = false;
let mapMusicEnabled = false;
let mapMusicVolume = 1;
let gainNode = undefined;
let playedMusicYet = false;

// Desktop notifications
let enableDesktopNotifications = false;
let desktopNotificationNoAudio = false;
let desktopNotificationIcon = "https://tilemap.town/img/pwa/icon-96.png";
let activeNotifications = [];

// Idle settings
let minutesUntilIdle = 60;
let minutesUntilDisconnect = 720;

// document elements
let mapCanvas = null; // main map view
let selCanvas = null; // selector
let chatInput = null;
let panel = null;

// Backdrop related variables (backdrop is a second canvas that only contains map tiles, that can be redrawn behind entities as they move across it)
let backdropCanvas = null; // Map without any entities or "over" tiles on it
let backdropDirtyMap = undefined; // 2D array stored as a 1D array, row major
let backdropOverMap = undefined; // 2D array stored as a 1D array, row major. [withinZoneX, withinZoneY, object, map, mapCoordX, mapCoordY]
let backdropRerenderAll = undefined, backdropDrawAll = undefined; // Overrides the dirty map
let backdropWidthZones = undefined;  // Width of the backdrop in zone units
let backdropHeightZones = undefined; // Height of the backdrop in zone units
let backdropWidthTiles = undefined;  // Width of the backdrop in 16x16 tile units
let backdropHeightTiles = undefined; // Height of the backdrop in 16x16 tile units 
const BACKDROP_ZONE_SIZE = 8;        // Size in tiles
const BACKDROP_ZONE_PIXEL_SIZE = BACKDROP_ZONE_SIZE * 16;
const BACKDROP_ZONE_SHIFT = 3;       // ">> BACKDROP_ZONE_SHIFT" is the same as "/ BACKDROP_ZONE_SIZE"

let NeedMapRedraw = false;
let NeedInventoryUpdate = false;
let TickCounter = 0;   // Goes up every 20ms, wraps at 0x1000000 (hex)
let tenthOfSecondTimer = 0; // Goes up every 0.1 seconds
let timeOfLastInput = Date.now();
let statusBeforeIdle = null;
let statusMessageBeforeIdle = null;

let DisplayInventory = { null: [] }; // Indexed by folder
let DBInventory = {}; // Indexed by ID

const BUILD_TOOL_SELECT = 0;
const BUILD_TOOL_DRAW = 1;
let buildTool = BUILD_TOOL_SELECT;
let rightClickedBuildTile = null;
let rightClickedHotbarIndex = null;
let tileDataForDraw = null;

let buildMenuSelectIndex = null;
let drawToolX = null, drawToolY = null;
let drawToolCurrentStroke = {}; // All the tiles currently being drawn on, indexed by x,y
let drawToolCurrentStrokeIsObj = false;
let drawToolUndoHistory = [];

let buildCategories = {};
let currentBuildCategoryName = "!global";
//currentBuildCategoryArrayNames; <-- will be set in predefined.js
var GlobalTilesArray = [];
var GlobalTilesArrayNames = [];
let loadedBuiltInTilesetYet = false;

let chatTimestamps = true;
let chatCustomNameColors = true;
let lockZoomLevel = false;
let focusChatBarOnTabBack = false;
let warnInvalidBBCode = true;
let focusMapAfterChat = false;
let safeForCommandLists = [];

let FileStorageInfo = null;
let sampleAvatarList = {};

const CONTEXT_MENU_OPEN_OFFSET = 8;

///////////////////////////////////////////////////////////

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

function resizeCanvas() {
	let parent = mapCanvas.parentNode;
	let r = parent.getBoundingClientRect();
	let width  = Math.round(r.width / CameraScale);
	let height = Math.round(r.height / CameraScale);
	mapCanvas.width = width;
	mapCanvas.height = height;

	backdropWidthZones = Math.ceil((width+16.0) / (BACKDROP_ZONE_SIZE*16.0)) + 1;
	backdropHeightZones = Math.ceil((height+16.0) / (BACKDROP_ZONE_SIZE*16.0)) + 1;
	backdropWidthTiles = backdropWidthZones * BACKDROP_ZONE_SIZE;
	backdropHeightTiles = backdropHeightZones * BACKDROP_ZONE_SIZE;
	backdropCanvas.width = backdropWidthTiles * 16;
	backdropCanvas.height = backdropHeightTiles * 16;
	backdropRerenderAll = true;
	backdropDrawAll = true;
	backdropDirtyMap = new Uint8Array(backdropWidthZones * backdropHeightZones);
	backdropOverMap = new Array(backdropWidthZones * backdropHeightZones);

	drawMap();
	drawHotbar();
}



///////////////////////////////////////////////////////////
// Button handlers 🦨
///////////////////////////////////////////////////////////

function sendPrivateMessageToItem(id) {
  setChatInput("/tell "+id+" ");
}

function loadOptions() {
	let saved_options = localStorage.getItem("options");
	if (saved_options) {
		saved_options = JSON.parse(saved_options);
		document.getElementById("alwayscenter").checked = saved_options.always_center_camera ?? false;
		document.getElementById("audiochatnotify").checked = saved_options.audio_chat_notify ?? true;
		document.getElementById("audiomiscnotify").checked = saved_options.audio_misc_notify ?? false;
		document.getElementById("audiomapmusic").checked = saved_options.audio_map_music ?? false;
		document.getElementById("option-entity-animation").checked = saved_options.entity_animation ?? true;
		document.getElementById("option-tile-animation").checked = saved_options.tile_animation ?? true;
		document.getElementById("enable-user-particles").checked = saved_options.user_particles ?? true;
		document.getElementById("chat-timestamp").checked = saved_options.chat_timestamps ?? true;
		document.getElementById("chat-custom-name-colors").checked = saved_options.chat_custom_name_colors ?? true;
		document.getElementById("minutes-until-idle").value = saved_options.minutes_until_idle ?? 60;
		document.getElementById("minutes-until-disconnect").value = saved_options.minutes_until_disconnect ?? 720;
		document.getElementById("warn-invalid-bbcode").value = saved_options.warn_invalid_bbcode ?? true;
		document.getElementById("focus-map-after-chat").value = saved_options.focus_map_after_chat ?? false;
		document.getElementById("music-volume").value = (saved_options.audio_map_music_volume ?? 1) * 100;
		document.getElementById("safe-for-command-lists").value = (saved_options.safe_for_command_lists ?? []).join();
	}
}

function applyOptions() {
	CameraAlwaysCenter = document.getElementById("alwayscenter").checked;
	AudioChatNotifications = document.getElementById("audiochatnotify").checked;
	AudioMiscNotifications = document.getElementById("audiomiscnotify").checked;
	minutesUntilIdle = parseInt(document.getElementById("minutes-until-idle").value);
	if (minutesUntilIdle === NaN) minutesUntilIdle = 0;
	minutesUntilDisconnect = parseInt(document.getElementById("minutes-until-disconnect").value);
	if (minutesUntilDisconnect === NaN) minutesUntilDisconnect = 0;

	Fly = document.getElementById("option-fly").checked;
	entityAnimationEnabled = document.getElementById("option-entity-animation").checked;
	tileAnimationEnabled = document.getElementById("option-tile-animation").checked;
	userParticlesEnabled = document.getElementById("enable-user-particles").checked;
	chatTimestamps = document.getElementById("chat-timestamp").checked;
	chatCustomNameColors = document.getElementById("chat-custom-name-colors").checked;
	lockZoomLevel = document.getElementById("lock-zoom-level").checked;
	warnInvalidBBCode = document.getElementById("warn-invalid-bbcode").checked;
	focusMapAfterChat = document.getElementById("focus-map-after-chat").checked;
	safeForCommandLists = document.getElementById("safe-for-command-lists").value.split(",");
	for (let i in safeForCommandLists)
		safeForCommandLists[i] = safeForCommandLists[i].trim().toLowerCase();

	let mapMusicPreviouslyEnabled = mapMusicEnabled;
	updateMapMusicVolume();
	mapMusicEnabled = document.getElementById("audiomapmusic").checked;
	if(!mapMusicEnabled) {
		if (chiptunejsPlayerObject !== undefined) {
			chiptunejsPlayerObject.stop();
		}
	} else if(mapMusicEnabled && !mapMusicPreviouslyEnabled && currentlyPlayingURL) {
		playMusic(currentlyPlayingURL);
	}

	let saved_options = {
		"always_center_camera": CameraAlwaysCenter,
		"audio_chat_notify": AudioChatNotifications,
		"audio_misc_notify": AudioMiscNotifications,
		"audio_map_music": mapMusicEnabled,
		"audio_map_music_volume": mapMusicVolume,
		"entity_animation": entityAnimationEnabled,
		"tile_animation": tileAnimationEnabled,
		"user_particles": userParticlesEnabled,
		"chat_timestamps": chatTimestamps,
		"chat_custom_name_colors": chatCustomNameColors,
		"lock_zoom_level": lockZoomLevel,
		"minutes_until_idle": minutesUntilIdle,
		"minutes_until_disconnect": minutesUntilDisconnect,
		"warn_invalid_bbcode": warnInvalidBBCode,
		"focus_map_after_chat": focusMapAfterChat,
		"safe_for_command_lists": safeForCommandLists,
		"version": 1,
	};
	localStorage.setItem("options", JSON.stringify(saved_options));
	backdropRerenderAll = true;
}

function updateMapMusicVolume() {
	mapMusicVolume = parseInt(document.getElementById("music-volume").value) / 100;
	if (gainNode)
		gainNode.gain.value = mapMusicVolume;
}

function zoomIn() {
	CameraScale = Math.min(Math.max(CameraScaleMin, CameraScale + 0.25), CameraScaleMax);
	if (Number.isNaN(CameraScale))
		CameraScale = 3;
	resizeCanvas();
	updateZoomLevelDisplay();
}

function zoomOut() {
	CameraScale = Math.min(Math.max(CameraScaleMin, CameraScale - 0.25), CameraScaleMax);
	if (Number.isNaN(CameraScale))
		CameraScale = 3;
	resizeCanvas();
	updateZoomLevelDisplay();
}

function updateZoomLevelDisplay() {
	let readout = document.querySelector('#zoomlevel');
	let inButt = document.querySelector('#zoomin');
	let outButt = document.querySelector('#zoomout');

	readout.innerText = `${CameraScale.toFixed(2)}x`

	if (CameraScale <= CameraScaleMin) {
		outButt.disabled = true;
		inButt.disabled = false;
	} else if (CameraScale >= CameraScaleMax) {
		outButt.disabled = false;
		inButt.disabled = true;
	} else {
		outButt.disabled = false;
		inButt.disabled = false;
	}
}

function viewOptions() {
	let visible = toggleDisplay(document.getElementById("options"));
	if (!messaging_mode)
		document.getElementById("navoptions").setAttribute("class", visible ? "navactive" : "");
}

function toggleDisplay(element) {
	element.style.display = element.style.display == 'block' ? 'none' : 'block';
	return element.style.display == 'block';
}

function updateUsersUL() {
	let include_all_entities = document.getElementById('userlist_all_entities').checked;

	function cards(ul, span, ids) {
		ul = document.getElementById(ul);
		if (!ul)
			return;
		span = document.getElementById(span);
		if (!span)
			return;
		span.style.display = ids.length ? 'block' : 'none';

		itemCardList(ul, ids, {
			eventlisteners: {
				'contextmenu': function (e, id) {
					openItemContextMenu(id, e.clientX, e.clientY);
					e.preventDefault();
				}
			},
			top_level: true
		});
	}

	// Manage the lists and spans
	cards('usersul', 'userlist_span', Object.values(PlayerWho).filter(
		item => item.in_user_list
	).map(
		item => item.id
	));

	cards('chatlistenerul', 'chatlisteners_span', Object.values(PlayerWho).filter(
		item => !item.in_user_list && item.chat_listener
	).map(
		item => item.id
	));

	cards('messageforwardul', 'messageforward_span', !include_all_entities ? [] : Object.values(PlayerWho).filter(
		item => !item.in_user_list && item.is_forwarding && !item.chat_listener
	).map(
		item => item.id
	));

	cards('otherentityul', 'otherentity_span', !include_all_entities ? [] : Object.values(PlayerWho).filter(
		item => !item.in_user_list && !item.is_forwarding
	).map(
		item => item.id
	));
}

function viewUsers() {
	let users = document.getElementById('users');
	if(toggleDisplay(users)) {
		let ul = document.getElementById('usersul');
		updateUsersUL();
	}
}

function viewChatLog() {
	let chat = document.getElementById('chat-container');
	chat.classList.toggle('pinned');
	chatArea.scrollTop = chatArea.scrollHeight;
	resizeCanvas();

	let touch = document.getElementById('touch-button-container');
	if (touch) {
		touch.classList.toggle('flipped');
	}
}

function viewInventory() {
	let inventory = document.getElementById('inventory');
	if(toggleDisplay(inventory)) {
		let ul = document.getElementById('inventoryul');
		updateInventoryUL();
	}
}

function viewBuild() {
	redrawBuildCanvas();
	toggleDisplay(document.getElementById('build'));
}

function viewCustomize() {
	let options = document.getElementById("character");
	let Hidden = (options.style.display == 'none');
	document.getElementById("navcustomize").setAttribute("class", Hidden ? "navactive" : "");

	document.getElementById("quickstatus").value = PlayerWho[PlayerYou].status ?? "";
	document.getElementById("quickstatus").value = PlayerWho[PlayerYou].status_message ?? "";
	document.getElementById("newnick").value = PlayerWho[PlayerYou].name ?? "";
	document.getElementById("myNameColor").value = PlayerWho[PlayerYou]?.who_tags?.name_color ?? "#ffffff";
	if (typeof PlayerWho[PlayerYou].pic[0] === "string") {
		document.getElementById("newcustompic").value = PlayerWho[PlayerYou].pic[0];
	} else {
		document.getElementById("newcustompic").value = "";
	}

	options.style.display = Hidden ? 'block' : 'none';
}

function morePresetAvatars() {
	let ul = document.getElementById("premadeavatarul");
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}
	for(let name in sampleAvatarList) {
		let item = {
			name: name,
			pic: [sampleAvatarList[name], 0, 0],
            is_uploaded_image: true, // Force 32x32
		};
		let li = itemCard(item);
		li.addEventListener('click', function (e) {
			sendChatCommand('userpic '+sampleAvatarList[name]);
		});
		ul.appendChild(li);
	}
	let avatars = document.getElementById("premadeavatarlist");
	avatars.style.display = 'block';
}

function fileCardList(ul, folders_only, click_handler, contextmenu_handler) {
	// Each index is a folder ID; each positive item within is a file, each negative item within is a folder
	let DisplayFiles = { null: [] };

	for(let key in FileStorageInfo.files) {
		let file_info = FileStorageInfo.files[key];
		if (file_info.folder in DisplayFiles) {
			DisplayFiles[file_info.folder].push(key);
		} else {
			DisplayFiles[file_info.folder] = [key];
		}
	}
	for(let key in FileStorageInfo.folders) {
		let folder_info = FileStorageInfo.folders[key];
		if (folder_info.folder in DisplayFiles) {
			DisplayFiles[folder_info.folder].push(-key);
		} else {
			DisplayFiles[folder_info.folder] = [-key];
		}
	}

	// sort by name
	for (let key in DisplayFiles) {
		DisplayFiles[key].sort(function (a, b) {
			if (a < 0 && b > 0) // A is folder, B is file
				return -1;
			if (b < 0 && a > 0) // B is folder, A is file
				return 1;
			const name1 = (a > 0) ? FileStorageInfo.files[a].name : FileStorageInfo.folders[-a].name;
			const name2 = (b > 0) ? FileStorageInfo.files[b].name : FileStorageInfo.folders[-b].name;
			return name1.localeCompare(name2);
		});
	}

	let lis = [];
	let openFolders = [];

	// Empty out the list
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}

	function expandFolder(list, id) {
		openFolders[id] = true;

		// Empty out the list
		while (list.firstChild) {
			list.removeChild(list.firstChild);
		}

		// Add its sub-items
		addItems(list, DisplayFiles[id]);

		// Add the "collapse folder" item
		let newitem = document.createElement("li");
		newitem.appendChild(document.createTextNode("hide contents"));
		newitem.classList.add('inventoryli', 'inventorymeta');
		newitem.onclick = function () {
			collapseFolder(list, id);
			setItemCardImage(list.previousSibling, picIcon(FolderClosedPic));
		};
		list.appendChild(newitem);
	}

	function collapseFolder(list, id) {
		openFolders[id] = false;

		// Empty out the list
		while (list.firstChild) {
			list.removeChild(list.firstChild);
		}

		// Add the "expand folder" item
		let newitem = document.createElement("li");
		newitem.appendChild(document.createTextNode("show contents"));
		newitem.classList.add('inventoryli', 'inventorymeta');
		newitem.onclick = function () {
			expandFolder(list, id);
			setItemCardImage(list.previousSibling, picIcon(FolderOpenPic));
		};
		list.appendChild(newitem);
	}

	// Recursively make the tree with unordered lists
	function addItems(list, ids) {
		for (let id of ids) {
			let is_file = id > 0;
			let is_folder = id < 0;
			let metadata = is_file ? FileStorageInfo.files[id] : FileStorageInfo.folders[-id];
			let item = {
				name: metadata.name,
				desc: metadata.desc,
			};
			if(is_file) {
				if(folders_only)
					continue;
				if(metadata.url.toLowerCase().endsWith(".png")) {
					item.pic = [metadata.url, 0, 0];
					item.is_uploaded_image = true;
				} else
					item.pic = [0, 19, 30];
				item.id = id;
				if(metadata.size) {
					item.status = (metadata.size / 1024).toFixed(2) + " KiB";
				}
			} else {
				item.id = "F"+(-id);
				item.pic = FolderOpenPic;
			}

			let li = itemCard(item);
			if (click_handler) {
				li.addEventListener('click', function (e) {
					return click_handler(e, id);
				});
			}
			if (contextmenu_handler) {
				li.addEventListener('contextmenu', function (e) {
					return contextmenu_handler(e, id);
				});
			}

			list.appendChild(li);

			// For empty folders which won't go into
			// the second conditional, just show them open
			if (is_folder) {
				setItemCardImage(li, picIcon(FolderClosedPic));
			}

			// If the item itself has sub-items
			if (is_folder && (-id in DisplayFiles)) {
				let inner = document.createElement("ul");
				list.appendChild(inner);

				// on "use" for folder items
				if (is_folder) {
					li.addEventListener("click", function (e) {
						if (openFolders[-id]) {
							collapseFolder(inner, -id);
							setItemCardImage(li, picIcon(FolderClosedPic));
						} else {
							expandFolder(inner, -id);
							setItemCardImage(li, picIcon(FolderOpenPic));
						}
					})

					collapseFolder(inner, -id);
				}
			}
		}
	}

	addItems(ul, DisplayFiles[null]);
}

function updateFileList() {
	document.getElementById("filelist-status").innerHTML = (FileStorageInfo.info.used_space / 1024).toFixed(2) + " KiB used, " + (FileStorageInfo.info.free_space / 1024).toFixed(2) + " KiB free";

	let ul = document.getElementById('filesul');
	if (!ul) return;

	fileCardList(ul, false, null, function(e, id) {
		if (id > 0)
			openFileContextMenu(id, e.clientX, e.clientY);
		else if (id < 0)
			openFolderContextMenu(-id, e.clientX, e.clientY);
		e.preventDefault();
	});

	// Add the "new file" item
	let newitem = document.createElement("li");
	newitem.appendChild(document.createTextNode("+File"));
	newitem.classList.add('inventoryli');
	newitem.id = "fileadd"
	newitem.onclick = function () { document.getElementById('newFileWindow').style.display = "block"; };
	ul.appendChild(newitem);

	// Add the "new folder" item
	newitem = document.createElement("li");
	newitem.appendChild(document.createTextNode("+Folder"));
	newitem.classList.add('inventoryli');
	newitem.id = "fileadd"
	newitem.onclick = function () { document.getElementById('newFolderWindow').style.display = "block"; };
	ul.appendChild(newitem);
}

async function viewFiles() {
	let files = document.getElementById('filelist');
	if(toggleDisplay(files)) {
		if(!API_URL) {
			document.getElementById("filelist-status").textContent = "Server has its API disabled";
			return;
		}

		// Clean up
		document.getElementById("filelist-status").textContent = "Checking status...";
		let ul = document.getElementById('filesul');
		if (!ul) return;
		while (ul.firstChild) {
			ul.removeChild(ul.firstChild);
		}

		let response = await fetch(API_URL + "/v1/my_files" , {
			headers: {'Authorization': 'Bearer ' + API_Key},
			method: "GET"});
		if(response.status == 200) {
			FileStorageInfo = await response.json();
			updateFileList();
		} else if (response.status == 403) {
			document.getElementById("filelist-status").textContent = "You need an account for this.";
		} else {
			document.getElementById("filelist-status").textContent = "Error accessing file upload API.";
		}
	}
}

function loginButton() {
	// The user manually hitting the login button should reset the reconnect state
	DidConnectOnce = false;
	ReconnectAttempts = 0;
	StatusOnDisconnect = null;

	// Reset the "already seen" variables
	alreadySeenStats = false;
	alreadySeenMOTD = undefined;
	alreadySeenEvent = undefined;
	alreadySeenMail = undefined;
	MessagesToRetry = [];

	if (messaging_mode || document.getElementById("loginUserSpan").style.display === "block") {
		OnlineUsername = document.getElementById("loginuser").value;
		OnlinePassword = document.getElementById("loginpass").value;
		// Save the username so that in the future it is prefilled
		localStorage.setItem("username", OnlineUsername);
	} else {
		OnlineUsername = document.getElementById("loginnick").value;
		OnlinePassword = "";
	}
	OnlineServer = document.getElementById("loginserver").value;
	if (!OnlineIsConnected)
		ConnectToServer();
	else
		SendCmd("CMD", { text: "login " + OnlineUsername + " " + OnlinePassword });

	document.getElementById('loginWindow').style.display = "none";
}

/*
// Unused, but maybe it'd a good idea for later?
function previewIcon() {
	let preview = document.getElementById("iconPreview");
	let file = document.getElementById("iconPicker").files[0];
	let reader = new FileReader();

	reader.addEventListener("load", function () {
		preview.src = reader.result;
		alert(reader.result);
		alert(reader.result.length);
		PlayerIconSheet = "iconPreview";
		PlayerIconX = 0;
		PlayerIconY = 0;
	}, false);

	if (file) {
		reader.readAsDataURL(file);
	}
}
*/

function applyMapWindowChanges() {
	let mapname = document.getElementById('mapname').value;
	let mapdesc = document.getElementById('mapdesc').value;
	let permission_build             = document.getElementById('permission_build').checked
	let permission_object_entry      = document.getElementById('permission_object_entry').checked
	let permission_persistent_object = document.getElementById('permission_persistent_object').checked
	let permission_topic             = document.getElementById('permission_topic').checked
	let mapprivacy = document.getElementById('mapprivacy').value;

	if (mapname != MyMap.Info.name)
		sendChatCommand('mapname ' + mapname)
	if (mapdesc != (MyMap.Info.desc ?? ""))
		sendChatCommand('mapdesc ' + mapdesc)

	let mapprivacy_current = "?";
	if (!MyMap.Info['private'] && MyMap.Info['public'])
		mapprivacy_current = "public";
	else if (!MyMap.Info['private'] && !MyMap.Info['public'])
		mapprivacy_current = "unlisted";
	else if (MyMap.Info['private'] && !MyMap.Info['public'])
		mapprivacy_current = "private";
	if (mapprivacy != mapprivacy_current && mapprivacy != "?")
		sendChatCommand('mapprivacy ' + mapprivacy)

	let map_deny = MyMap.Info.default_deny ?? [];
	let map_allow_build = !map_deny.includes('build');
	let map_allow_object_entry = !map_deny.includes('object_entry');
	let map_allow_persistent_object = !map_deny.includes('persistent_object_entry');
	let map_allow_topic = !map_deny.includes('set_topic');

	// Change permissions
	if (permission_build != map_allow_build)
		sendChatCommand((permission_build ? 'revoke' : 'deny') + ' build !default')
	if (permission_object_entry != map_allow_object_entry)
		sendChatCommand((permission_object_entry ? 'revoke' : 'deny') + ' object_entry !default')
	if (permission_persistent_object != map_allow_persistent_object)
		sendChatCommand((permission_persistent_object ? 'revoke' : 'deny') + ' persistent_object_entry !default')
	if (permission_topic != map_allow_topic)
		sendChatCommand((permission_topic ? 'revoke' : 'deny') + ' set_topic !default')

	cancelMapWindowChanges();
}

function cancelMapWindowChanges() {
	document.getElementById('mapOptionsWindow').style.display = "none";
}

function setUserStatusButton() {
	let newStatus = document.getElementById('quickstatus').value;
	let newStatusContext = document.getElementById('quickstatustext').value.trim();

	if (newStatus == '') {
		if (newStatusContext == '') {
			sendChatCommand('status');
		} else {
			sendChatCommand('status . ' + newStatusContext);
		}
	} else {
		if (newStatusContext == '') {
			sendChatCommand('status ' + newStatus);
		} else {
			sendChatCommand('status ' + newStatus + ' ' + newStatusContext);
		}
	}
}

function loginHelpAccount() {
	document.getElementById("loginInstructionsGuest").style.display = "none";
	document.getElementById("loginUserSpan").style.display = "block";
	document.getElementById("loginNickSpan").style.display = "none";
	document.getElementById("loginPassSpan").style.display = "block";
	document.getElementById("loginButtonSpan").style.display = "block";
	document.getElementById("loginServerSpan").style.display = "block";
	document.getElementById("loginHelpAccountButton").style.fontWeight = "bold";
	document.getElementById("loginHelpGuestButton").style.fontWeight = "normal";
	loginHelpEnableDisableConnect();
}

function loginHelpGuest() {
	document.getElementById("loginInstructionsGuest").style.display = "block";
	document.getElementById("loginUserSpan").style.display = "none";
	document.getElementById("loginNickSpan").style.display = "block";
	document.getElementById("loginPassSpan").style.display = "none";
	document.getElementById("loginButtonSpan").style.display = "block";
	document.getElementById("loginServerSpan").style.display = "block";
	document.getElementById("connectButton").disabled = false;
	document.getElementById("loginHelpAccountButton").style.fontWeight = "normal";
	document.getElementById("loginHelpGuestButton").style.fontWeight = "bold";
}

function loginHelpEnableDisableConnect() {
	document.getElementById("connectButton").disabled = (document.getElementById("loginuser").value.length == 0) || (document.getElementById("loginpass").value.length == 0);
}

function setCustomNameColor() {
	let color = document.getElementById("myNameColor").value;
	SendCmd("CMD", {text: "e me addtag who name_color " + color});
	logMessage("Changed your name color to "+convertBBCode(`[color=${color}]${color}[/color]`), 'server_message',   {'isChat': false});
}

function clearCustomNameColor() {
	SendCmd("CMD", {text: "e me deltag who name_color"});
	logMessage("Changed your name back to the default color", 'server_message',   {'isChat': false});
}

function copyTraitPicFromGadget() {
	let edittilesheet = document.getElementById('edittilesheet').value;
	if (edittilesheet == "keep") {
		edittilesheet = editItemOriginalSheet;
	} else {
		parseInt(edittilesheet);
	}
	let edittilex = parseInt(document.getElementById('edittilex').value);
	let edittiley = parseInt(document.getElementById('edittiley').value);
	let edittileurl = document.getElementById("itemImageIsURL").checked ? document.getElementById('edittileimageurl').value : "";
	let edittiletype = document.getElementById('edittiletype').value;
	let pic = [edittilesheet, edittilex, edittiley];
	if ((editItemType === "generic" || editItemType === "gadget") && edittileurl.trim().length) {
		pic = [edittileurl.trim(), 0, 0];
	}
	let picString = pic.join(" ");
	document.getElementById("edittilegadget_preset_pic_cycle_first_pic").value = picString;
	document.getElementById("edittilegadget_preset_projectile_shooter_pic").value = picString;
}

///////////////////////////////////////////////////////////
// Local maps
///////////////////////////////////////////////////////////

const savedMapStoragePrefix = "saved_map:";
let mapWasChanged = false;

function resizeLocalMap() {
	if (!mapWasChanged || confirm("Resize the map?")) {
		let width = parseInt(document.getElementById("localMapWidth").value);
		let height = parseInt(document.getElementById("localMapHeight").value);
		if (isNaN(width) || isNaN(height) || width < 1 || height < 1)
			return;
		let originalTiles = MyMap.Tiles;
		let originalObjs = MyMap.Objs;
		let originalWidth = MyMap.Width;
		let originalHeight = MyMap.Height;
		MyMap.Width = width;
		MyMap.Height = height;
		MyMap.Info.size = [width, height];

		MyMap.Tiles = [];
		MyMap.Objs = [];
		for(let i=0; i<width; i++) {
			MyMap.Tiles[i] = [];
			MyMap.Objs[i] = [];
			for(let j=0; j<height; j++) {
				if (i < originalWidth && j < originalHeight) {
					MyMap.Tiles[i][j] = originalTiles[i][j];
					MyMap.Objs[i][j] = originalObjs[i][j];
				} else {
					MyMap.Tiles[i][j] = MyMap.Info["default"];
					MyMap.Objs[i][j] = [];
				}
			}
		}

		NeedMapRedraw = true;
		cancelMapWindowChanges();
	}
}

function clearLocalMap() {
	if (!mapWasChanged || confirm("Clear the map?")) {
		let width = parseInt(document.getElementById("localMapWidth").value);
		let height = parseInt(document.getElementById("localMapHeight").value);
		if (isNaN(width) || isNaN(height) || width < 1 || height < 1)
			return;
		MyMap = new TownMap(width, height);
		mapWasChanged = false;
		cancelMapWindowChanges();
	}
}

function loadLocalMap() {
	let name = document.getElementById("localMapList").value.trim();
	if (name == "")
		return;
	if (!mapWasChanged || confirm('Load map "'+name+'"?')) {
		let map = localStorage.getItem(savedMapStoragePrefix + name)
		if (map === null)
			return;
		if (importMap(map)) {
			document.getElementById("localMapName").value = name;
			mapWasChanged = false;
			cancelMapWindowChanges();
		}
		document.getElementById('localMapWidth').value = MyMap.Width;
		document.getElementById('localMapHeight').value = MyMap.Height;
	}
}

function saveLocalMap() {
	let name = document.getElementById("localMapName").value.trim();
	if (name == "")
		return;
	if(localStorage.getItem(savedMapStoragePrefix + name) !== null) {
		if(!confirm('Overwrite map "'+name+'"?'))
			return;
	}

	let exported = exportMap();
	localStorage.setItem(savedMapStoragePrefix + name, exported);
	let maps = getLocalMapList();
	if (!maps.includes(name)) {
		maps.push(name);
		setLocalMapList(maps);
	}
	document.getElementById("localMapList").value = name;
	mapWasChanged = false;
}

function deleteLocalMap() {
	let name = document.getElementById("localMapList").value.trim();
	if (name == "")
		return;
	if (confirm('Delete map "'+name+'"?')) {
		localStorage.removeItem(savedMapStoragePrefix + name);

		let maps = getLocalMapList();
		let index = maps.indexOf(name);
		if (index != -1) {
			maps.splice(index, 1);
			setLocalMapList(maps);
		}
	}
}

function importLocalMap() {
	let file = document.getElementById("importmapfile").files[0];
	if (file) {
		let reader = new FileReader();
		reader.onload = function (evt) {
			if(importMap(evt.target.result)) {
				mapWasChanged = false;
				cancelMapWindowChanges();
			}
		}
		reader.onerror = function (evt) {
			alert("Error reading this file");
		}
		reader.readAsText(file, "UTF-8");
	}
}

function getLocalMapList() {
	try {
		return JSON.parse(localStorage.getItem("saved_map_names") ?? "[]");
	} catch(error) {
		return [];
	}
}

function setLocalMapList(list) {
	list.sort();
	localStorage.setItem("saved_map_names", JSON.stringify(list));
	refreshLocalMapList();
}

function refreshLocalMapList() {
	let maps = getLocalMapList();

	let dropdown = document.getElementById("localMapList");
	while (dropdown.firstChild) {
		dropdown.removeChild(dropdown.firstChild);
	}

	for (let name of maps) {
		let el = document.createElement("option");
		el.textContent = name;
		el.value = name;
		dropdown.appendChild(el);
	}
}

///////////////////////////////////////////////////////////
// Inventory
///////////////////////////////////////////////////////////

const FolderOpenPic = ["#", 1, 2];
const FolderClosedPic = ["#", 0, 2];

// options!
// eventlisteners: an object of listener name => function. added to each card
// hidden_ids: hides any item with this id from the list
// expanded: if true, subfolders are expanded by default
// top_level: if true, doesn't show expansion options or sublists
function itemCardList(ul, ids, options = {}) {
	let lis = [];
	let openFolders = [];

	// Empty out the list
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}

	function expandFolder(list, id) {
		openFolders[id] = true;

		// Empty out the list
		while (list.firstChild) {
			list.removeChild(list.firstChild);
		}

		// Add its sub-items
		addItems(list, DisplayInventory[id]);

		// Add the "collapse folder" item
		let newitem = document.createElement("li");
		newitem.appendChild(document.createTextNode("hide contents"));
		newitem.classList.add('inventoryli', 'inventorymeta');
		newitem.onclick = function () {
			collapseFolder(list, id);

			let item = DBInventory[id] || PlayerWho[id];
			if(item == undefined)
				item = {name: "?"};
			if (item.type == "folder") {
				setItemCardImage(list.previousSibling, picIcon(FolderClosedPic));
			}
		};
		list.appendChild(newitem);
	}

	function collapseFolder(list, id) {
		openFolders[id] = false;

		// Empty out the list
		while (list.firstChild) {
			list.removeChild(list.firstChild);
		}

		// Add the "expand folder" item
		let newitem = document.createElement("li");
		newitem.appendChild(document.createTextNode("show contents"));
		newitem.classList.add('inventoryli', 'inventorymeta');
		newitem.onclick = function () {
			expandFolder(list, id);

			let item = DBInventory[id] || PlayerWho[id];
			if (item.type == "folder") {
				setItemCardImage(list.previousSibling, picIcon(FolderOpenPic));
			}
		};
		list.appendChild(newitem);
	}

	// Recursively make the tree with unordered lists
	function addItems(list, ids) {
		for (let id of ids) {
			if (options?.hidden_ids?.includes(id)) { continue; }

			let item = DBInventory[id] || PlayerWho[id];
			if(item == undefined)
				item = {name: "?"};
			let li = itemCard(id);

			for (let type in options?.eventlisteners) {
				li.addEventListener(type, function (e) {
					return options?.eventlisteners[type](e, id);
				});
			}

			list.appendChild(li);

			// For empty folders which won't go into
			// the second conditional, just show them open
			if (item.type == "folder") {
				setItemCardImage(li, picIcon(FolderOpenPic));
			}

			// If the item itself has sub-items
			const display_id = id == PlayerYou ? null : id;
			if (display_id in DisplayInventory && !options?.top_level) {
				let inner = document.createElement("ul");
				list.appendChild(inner);

				// on "use" for folder items
				if (item.type == "folder") {
					li.addEventListener("click", function (e) {
						if (openFolders[id]) {
							collapseFolder(inner, display_id);
							setItemCardImage(li, picIcon(FolderClosedPic));
						} else {
							expandFolder(inner, display_id);
							setItemCardImage(li, picIcon(FolderOpenPic));
						}
					})
				}

				if (options?.expanded) {
					expandFolder(inner, display_id);

					if (item.type == "folder") {
						setItemCardImage(li, picIcon(FolderOpenPic));
					}
				} else {
					collapseFolder(inner, display_id);

					if (item.type == "folder") {
						setItemCardImage(li, picIcon(FolderClosedPic));
					}
				}
			}
		}
	}

	addItems(ul, ids);
}

function setItemCardImage(li, new_image) {
	const id = li.getAttribute("item_id");
	let item = DBInventory[id] || PlayerWho[id];
	if(item == undefined)
		item = {name: "?"};
	let image = li.querySelector('.item_icon');
	li.replaceChild(new_image, image);
}

function itemCard(id) {
	let item;
	if(typeof id === 'object')
		item = id;
	else {
		item = DBInventory[id] || PlayerWho[id];
		if(item == undefined)
			item = {name: "?"};
	}

	let li = document.createElement("li");
	li.classList.add('inventoryli');
	li.setAttribute("item_id", id);
	li.appendChild(itemIcon(id));
	if (item.title_text) {
		li.title = item.title_text;
	}

	let info_div = document.createElement("div");

	let info_name = document.createElement("div");
	info_name.classList.add('inventory-info-name');
	info_name.innerText = item.name;

	if (item.status) {
		let status_span = document.createElement('span');
		status_span.classList.add('inventory-status');
		if (item.status_message && item.status == '.')
			status_span.innerText = `${item.status_message}`;
		else if (item.status_message)
			status_span.innerText = `${item.status.substring(0, 20)} (${item.status_message.substring(0, 50)})`;
		else
			status_span.innerText = `${item.status.substring(0, 20)}`;
		info_name.appendChild(status_span);
	}

	let info_detail = document.createElement("div");
	info_detail.classList.add('inventory-info-detail');

	let info = '';

	if (item.temporary) {
		info += "temporary ";
	}

	info += `id: ${item.id}`;

	if (item.username) {
		info += `, username: ${item.username}`;
	}

	info_detail.innerText = `(${info})`;

	info_div.appendChild(info_name);
	if(item.id !== undefined) {
		info_div.appendChild(info_detail);
	}
	li.appendChild(info_div);
	return li;
}

// Create an img that displays a particular pic value
function picIcon(pic) {
	let img_container = document.createElement("div");
	img_container.classList.add('item_icon');

	// create a little icon for the item
	let img = document.createElement("img");
	img.src = "img/transparent.png";
	img.style.width = "16px";
	img.style.height = "16px";
	let src = "img/transparent.png";

	if (IconSheets[pic[0]])
		src = IconSheets[pic[0]].src;
	else if (typeof(pic[0]) === 'string')
		src = pic[0];

	let background = "url(" + src + ") -" + (pic[1] * 16) + "px -" + (pic[2] * 16) + "px";
	img.style.background = background;

	img_container.appendChild(img);
	return img_container;
}

// Create an img that displays a particular entity
function itemIcon(key) {
	let img_container = document.createElement("div");
	img_container.classList.add('item_icon');

	// create a little icon for the item
	let img = document.createElement("img");
	img.src = "img/transparent.png";
	img.style.width = "16px";
	img.style.height = "16px";
	let src = "img/transparent.png";

	let item = (typeof key === 'object') ? key : (DBInventory[key] || PlayerWho[key]);
	if (item === undefined) {
		console.log("Tried to get icon for "+key+" which doesn't exist");
		item = {"name": "?"};
	}

	// allow custom avatars
	// as well as built-in ones
	pic = ["#", 7, 2];

	if (item.is_uploaded_image) {
		img.style.width = "32px";
		img.style.height = "32px";
	} else 	if (key in PlayerImages) {
		if (PlayerImages[key].naturalWidth != 16 || PlayerImages[key].naturalHeight != 16) {
			img.style.width = "32px";
			img.style.height = "32px";
		}

		src = PlayerImages[key].src;
	}

	if (item?.menu_pic)
		pic = item.menu_pic;
	else if (item?.pic)
		pic = item.pic;

	if (IconSheets[pic[0]])
		src = IconSheets[pic[0]].src;
	else if(typeof(pic[0]) === 'string')
		src = pic[0];

	let background = "url(" + src + ") -" + (pic[1] * 16) + "px -" + (pic[2] * 16) + "px";
	img.style.background = background;
	img.style.backgroundRepeat = "no-repeat";

	img_container.appendChild(img);
	return img_container;
}

function copyBuildToInventory() {
	SendCmd("BAG", { create: { "type": "map_tile", "name": rightClickedBuildTile, "data": rightClickedBuildTile } });
}

function moveItem(id) {
	document.getElementById("moveItemTitle").textContent = "Move Item";
	document.getElementById("moveItemNoun").textContent = "item";

	let window = document.getElementById('moveItem');
	toggleDisplay(window);

	let source = document.getElementById('movesourceul');
	let target = document.getElementById('movetargetul');

	while (source.firstChild) {
		source.removeChild(source.firstChild);
	}
	source.appendChild(itemCard(id));

	itemCardList(
		target,
		[PlayerYou],
		{
			eventlisteners: {
				'click': function (e, dest_id) {
					moveItemTo(id, dest_id);
					toggleDisplay(window);
				}
			},
			hidden_ids: [id],
			expanded: true
		}
	);
}

function moveItemTo(id, dest_id) {
	SendCmd("BAG", { move: { id: id, folder: dest_id } });
}

function dropTakeItem(id) {
	if (id in DBInventory) {
		sendChatCommand(`e ${id} drop`);
	} else {
		sendChatCommand(`e ${id} take`);
	}
}

function cloneItem(id, temporary = false) {
	SendCmd("BAG", { clone: { id: id, temp: temporary } });
}

function deleteItem(id) {
	let item = DBInventory[id] || PlayerWho[id];
	if(item == undefined)
		item = {name: "?"};
	if (
		confirm(`Really delete ${item.name} with ID ${item.id}?${(item.type === 'image'||item.type === 'tileset') ? ('\nIf you do, any tiles linked to this '+(item.type === 'image'?'image':'tileset')+' will lose their appearance.'): ''}`)
	) {
		SendCmd("BAG", { delete: { id: id } });
	}
}

/*
function referenceItem(id) {
	let item = DBInventory[id] || PlayerWho[id];
	SendCmd("BAG", { create: { name: `${item.name} (reference)`, type: "reference", data: `${id}` } });
}
*/


function getStackForMapObjMenu() {
	if(mapObjContextMenuX >= 0 && mapObjContextMenuY >= 0 && mapObjContextMenuX < MyMap.Width && mapObjContextMenuY < MyMap.Height) {
		return MyMap.Objs[mapObjContextMenuX][mapObjContextMenuY];
	}
	return null;
}

function finishMapObjMenuChange() {
	// Tell the server about the change
	if(mapObjContextMenuX >= 0 && mapObjContextMenuY >= 0 && mapObjContextMenuX < MyMap.Width && mapObjContextMenuY < MyMap.Height) {
		SendCmd("PUT", { pos: [mapObjContextMenuX, mapObjContextMenuY], obj: true, atom: MyMap.Objs[mapObjContextMenuX][mapObjContextMenuY] });

		if (!OnlineMode) {
			NeedMapRedraw = true;
			backdropRerenderAll = true;
		}
	}

	// Update the selection window
	if(!MouseActive || MouseStartX != mapObjContextMenuX || MouseStartY != mapObjContextMenuY || MouseStartX != MouseEndX || MouseStartY != MouseEndY)
		return;
	updateSelectedObjectsUL(MouseStartX, MouseStartY);	
}

function editMapObj() {
	let stack = getStackForMapObjMenu();
	let atom = AtomFromName(stack[mapObjContextMenuIndex]);
	editItemID = mapObjContextMenuIndex;
	editItemShared({ "type": "map_tile_mapobj_edit", "name": atom.name, "desc": "", "data": atom });
}
function editTurf() {
	let tile;
	if(withinCurrentMap(turfContextMenuX, turfContextMenuY)) {
		tile = MyMap.Tiles[turfContextMenuX][turfContextMenuY];
	} else {
		return;
	}
	let atom = AtomFromName(tile);
	editItemID = null;
	editItemShared({ "type": "map_tile_turf_edit", "name": atom.name, "desc": "", "data": atom });
}
function moveTopMapObj() {
	let stack = getStackForMapObjMenu();
	let item = stack.splice(mapObjContextMenuIndex, 1)[0];
	stack.push(item);
	finishMapObjMenuChange();
}
function moveUpMapObj() {
	let stack = getStackForMapObjMenu();
	if(mapObjContextMenuIndex+1 < stack.length)
		item = stack.splice(mapObjContextMenuIndex, 2, stack[mapObjContextMenuIndex+1], stack[mapObjContextMenuIndex]);
	finishMapObjMenuChange();
}
function moveDownMapObj() {
	let stack = getStackForMapObjMenu();
	if(mapObjContextMenuIndex-1 >= 0)
		stack.splice(mapObjContextMenuIndex-1, 2, stack[mapObjContextMenuIndex], stack[mapObjContextMenuIndex-1]);
	finishMapObjMenuChange();
}
function moveBottomMapObj() {
	let stack = getStackForMapObjMenu();
	let item = stack.splice(mapObjContextMenuIndex, 1)[0];
	stack.unshift(item);
	finishMapObjMenuChange();
}

function copyTurfToTileset() {
	let tile;
	if(withinCurrentMap(turfContextMenuX, turfContextMenuY)) {
		tile = MyMap.Tiles[turfContextMenuX][turfContextMenuY];
	} else {
		return;
	}
	addTileToActiveTilesetItem(tile);
}
function copyTurfToHotbar() {
	let tile;
	if(withinCurrentMap(turfContextMenuX, turfContextMenuY)) {
		tile = MyMap.Tiles[turfContextMenuX][turfContextMenuY];
	} else {
		return;
	}
	addTileToHotbar(tile);
}

function copyMapObjToTileset() {
	let stack = getStackForMapObjMenu();
	addTileToActiveTilesetItem(stack[mapObjContextMenuIndex]);
}
function copyMapObjToHotbar() {
	let stack = getStackForMapObjMenu();
	addTileToHotbar(stack[mapObjContextMenuIndex]);
}
function deleteMapObj() {
	let stack = getStackForMapObjMenu();
	stack.splice(mapObjContextMenuIndex, 1);
	finishMapObjMenuChange();
}

let mapObjContextMenuX, mapObjContextMenuY, mapObjContextMenuIndex;
function openMapObjContextMenu(map_x, map_y, index, x, y) {
	mapObjContextMenuX = map_x;
	mapObjContextMenuY = map_y;
	mapObjContextMenuIndex = index;
	let menu = document.querySelector('#mapobj-contextmenu');
	menu.style.left = (x-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.top = (y-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.display = "block";
	showCopyToTilesetLiIfNeeded("copyMapObjToTilesetLi");
}

let turfContextMenuX, turfContextMenuY;
function openTurfContextMenu(map_x, map_y, x, y) {
	turfContextMenuX = map_x;
	turfContextMenuY = map_y;
	let menu = document.querySelector('#turf-contextmenu');
	menu.style.left = (x-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.top = (y-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.display = "block";	
	showCopyToTilesetLiIfNeeded("copyTurfToTilesetLi");
}

let contextMenuItem = 0;
function openItemContextMenu(id, x, y) {
	let viewProfileLi = document.querySelector('#viewUserProfileLi');
	let item = DBInventory[id] || PlayerWho[id];
	viewProfileLi.style.display = (item?.in_user_list) ? "block" : "none";

	let drop = document.querySelector('#droptakeitem');
	document.getElementById("copyItemToHotbarLi").style.display = "none";
	document.getElementById("copyItemToTilesetLi").style.display = "none";
	if (id in DBInventory) {
		drop.innerText = "Drop";
		if(DBInventory[id].type == "map_tile") {
			document.getElementById("copyItemToHotbarLi").style.display = "block";
			showCopyToTilesetLiIfNeeded("copyItemToTilesetLi");
		}
	} else {
		drop.innerText = "Take";
	}
	let menu = document.querySelector('#item-contextmenu');
	menu.style.left = (x-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.top = (y-CONTEXT_MENU_OPEN_OFFSET) + "px";

	menu.style.display = "block";

	contextMenuItem = id;
}

function updateInventoryUL() {
	// Manage the inventory <ul>
	let ul = document.getElementById('inventoryul');
	if (!ul)
		return;

	itemCardList(ul, DisplayInventory[null], {
		eventlisteners: {
			'click': function (e, id) {
				let isMapTile = DBInventory[id].type == 'map_tile';
				if(buildTool == BUILD_TOOL_SELECT || !isMapTile) {
					useItem(DBInventory[id]);
				} else if(buildTool == BUILD_TOOL_DRAW) {
					unselectDrawToolTile();
					tileDataForDraw = DBInventory[id].data;
				}
			},
			'contextmenu': function (e, id) {
				openItemContextMenu(id, e.clientX, e.clientY);
				e.preventDefault();
			}
		}
	});

	// Add the "new item" item
	let newitem = document.createElement("li");
	newitem.appendChild(document.createTextNode("+"));
	newitem.classList.add('inventoryli');
	newitem.id = "inventoryadd"
	newitem.onclick = function () { document.getElementById('newItemWindow').style.display = "block"; };
	ul.appendChild(newitem);
}

function addTileToActiveTilesetItem(tile) {
	if (!activeTilesetItem)
		return;
	let item = DBInventory[activeTilesetItem.id];
	if (!item)
		return;

	if (activeTilesetItemIsTileset) {
		let data = item?.data ?? {};
		item.data = data;
		let tryIndex = 0;
		while (tryIndex in data)
			tryIndex++;
		if (typeof tile === "string")
			tile = AtomFromName(tile);
		data[tryIndex] = tile;

		SendCmd("BAG", { update: {id: activeTilesetItem.id, data} });
	} else {
		let data = item?.data?.data ?? [];
		item.data.data = data;
		data.push(tile);

		// Sort by name
		data.sort(function (a, b) {
			let atomA = AtomFromName(a);
			let atomB = AtomFromName(b);
			return atomA.name.localeCompare(atomB.name);
		});

		SendCmd("BAG", { update: {id: activeTilesetItem.id, data: {"type": "map_tile_list", "type_version": "0.0.1", "client_name": CLIENT_NAME, data} }});
	}
	refreshTilesetList();
}

let activeTilesetItemIsTileset = false;
let activeTilesetItem = null;
function viewTileset(Item) {
	activeTilesetItem = Item;
	activeTilesetItemIsTileset = true;
	let tileset = document.getElementById('tileset');
	if (toggleDisplay(tileset)) {

		let tileset_title = document.getElementById('tileset-title');
		tileset_title.innerText = "Tileset definition: " + Item.name;
		refreshTilesetList();
	}
}

function viewMapTileList(Item) {
	activeTilesetItem = Item;
	activeTilesetItemIsTileset = false;
	let tileset = document.getElementById('tileset');
	if (toggleDisplay(tileset)) {

		let tileset_title = document.getElementById('tileset-title');
		tileset_title.innerText = "Map tile list: " + Item.name;
		refreshTilesetList();
	}
}

let commandListItem = null;
function viewCommandList(Item) {
	commandListItem = Item;
	refreshCommandList();

	let commandlist = document.getElementById('commandlist');
	toggleDisplay(commandlist);

	let commandlist_title = document.getElementById('commandlist-title');
	commandlist_title.innerText = "Command list: " + Item.name;
}

function refreshCommandList() {
	let searchValue = document.getElementById("commandlistsearch").value.toLowerCase();

	let ul = document.getElementById("commandlistul");
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}
	for(let command of commandListItem.data.data) {
		if (searchValue.length && !command.name.toLowerCase().includes(searchValue))
			continue;
		let primaryCommand = command.command;
		if (Array.isArray(primaryCommand))
			primaryCommand = primaryCommand[0];
		let pic = ["#", 7, 2];
		let big = false;
		if (primaryCommand) {
			let s = primaryCommand.split(" ");
			if (s.length >= 4 && (s[0].toLowerCase() === "usp" || s[0].toLowerCase() === "userparticle")) {
				pic[0] = parseInt(s[1]); // TODO: Assume it's safe to have a URL here if the item belongs to you?
				pic[1] = parseInt(s[2]);
				pic[2] = parseInt(s[3]);
				if (Number.isNaN(pic[0]) || Number.isNaN(pic[1]) || Number.isNaN(pic[2]))
					pic = ["#", 7, 2];
				for (let param of s.slice(3)) {
					if (param.startsWith("size=") && param !== "size=1,1") {
						big = true;
						break;
					}
				}
			}
		}

		let item = {
			name: command.name,
			pic,
			is_uploaded_image: big, // Force 32x32, if big
			title_text: Array.isArray(command.command) ? command.command.join("\n") : (primaryCommand ?? ""),
		};
		let li = itemCard(item);
		li.addEventListener('click', function (e) {
			// Figure out which command to run
			const commandSuffix = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];
			let commandName = "command_" + commandSuffix[PlayerWho[PlayerYou].dir];
			if (!(commandName in command))
				commandName = "command";
			if (commandName in command) {
				let commandValue = command[commandName];
				if (!Array.isArray(commandValue)) {
					commandValue = [commandValue];
				}
				for (let subCommand of commandValue) {
					if (subCommand.toLowerCase().startsWith("usp ") || subCommand.toLowerCase().startsWith("userparticle ") || safeForCommandLists.includes(subCommand.toLowerCase().split(" ")[0]) || safeForCommandLists.includes(commandListItem.id.toString()) || confirm('Run command "' + subCommand + '"?')) {
						if (runLocalCommand("/"+subCommand));
						else sendChatCommand(subCommand);
					}
				}
			}
		});
		ul.appendChild(li);
	}
}

let tilesetContextMenuItem = null;
function refreshTilesetList() {
	let searchValue = document.getElementById("tileset_search").value.toLowerCase();

	let ul = document.getElementById("tileset_ul");
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}

	if (!activeTilesetItem)
		return;
	let item = DBInventory[activeTilesetItem.id];
	if (!item)
		return;

	if (activeTilesetItemIsTileset) {
		let data = item?.data ?? {};

		// Sort by name
		let sortedKeys = Object.keys(data);
		sortedKeys.sort(function (a, b) {
			let atomA = AtomFromName(data[a]);
			let atomB = AtomFromName(data[b]);
			return atomA.name.localeCompare(atomB.name);
		});

		for (let key of sortedKeys) {
			let tile = data[key];
			let attributes = CloneAtom(AtomFromName(tile));
			if (searchValue.length && !attributes.name.toLowerCase().includes(searchValue))
				continue;
			attributes.id = key;

			let li = itemCard(attributes);
			li.addEventListener('click', function (e) {
				let name = activeTilesetItem.id + ":" + key;
				if(buildTool == BUILD_TOOL_SELECT) {
					useItem({type: 'map_tile', data: name});
				} else if(buildTool == BUILD_TOOL_DRAW) {
					unselectDrawToolTile();
					tileDataForDraw = name;
				}
			});
			li.addEventListener('contextmenu', function (e) {
				tilesetContextMenuItem = key;
				let menu = document.querySelector('#tileset-contextmenu');
				menu.style.left = (e.clientX-CONTEXT_MENU_OPEN_OFFSET) + "px";
				menu.style.top = (e.clientY-CONTEXT_MENU_OPEN_OFFSET) + "px";
				menu.style.display = "block";
				document.getElementById('changeTilesetItemIDLi').style.display = "block";
				e.preventDefault();
			});
			ul.appendChild(li);
		}
	} else {
		let data = item?.data?.data ?? [];
		for (let index in data) {
			let tile = data[index];
			let attributes = AtomFromName(tile);
			if (searchValue.length && !attributes.name.toLowerCase().includes(searchValue))
				continue;

			let li = itemCard(attributes);
			li.addEventListener('click', function (e) {
				if(buildTool == BUILD_TOOL_SELECT) {
					useItem({type: 'map_tile', data: tile});
				} else if(buildTool == BUILD_TOOL_DRAW) {
					unselectDrawToolTile();
					tileDataForDraw = tile;
				}
			});
			li.addEventListener('contextmenu', function (e) {
				tilesetContextMenuItem = index;
				let menu = document.querySelector('#tileset-contextmenu');
				menu.style.left = (e.clientX-CONTEXT_MENU_OPEN_OFFSET) + "px";
				menu.style.top = (e.clientY-CONTEXT_MENU_OPEN_OFFSET) + "px";
				menu.style.display = "block";
				document.getElementById('changeTilesetItemIDLi').style.display = "none";
				e.preventDefault();
			});
			ul.appendChild(li);
		}
	}
}

function showCopyToTilesetLiIfNeeded(id) {
	let e = document.getElementById(id);
	e.style.display = document.getElementById("tileset").style.display;
	e.innerText = `Copy to ${activeTilesetItemIsTileset ? 'tileset definition' : 'map tile list'}`;
}

function getActiveTilesetItem() {
	if (!activeTilesetItem)
		return null;
	let item = DBInventory[activeTilesetItem.id];
	return item;
}
function getActiveTilesetData() {
	let item = getActiveTilesetItem();
	if (!item) return null;
	if (item.type === "client_data") {
		return item?.data?.data;
	} else if(item.type === "tileset") {
		return item?.data;
	}
}
function editTilesetItem() {
	let data = getActiveTilesetData();
	if (!data) return;
	let tile = data[tilesetContextMenuItem];
	if (!tile) return;

	editItemID = activeTilesetItem.id;
	let atom = AtomFromName(tile);
	editItemShared({ "type": "tileset_edit", "name": atom.name, "desc": "", "data": atom });
}

function cloneTilesetItem() {
	let data = getActiveTilesetData();
	if (!data) return;
	let tile = data[tilesetContextMenuItem];
	if (!tile) return;
	addTileToActiveTilesetItem(tile);
}

function copyTilesetItemToHotbar() {
	if (activeTilesetItemIsTileset) {
		addTileToHotbar(activeTilesetItem.id+":"+tilesetContextMenuItem);
	} else {
		let data = getActiveTilesetData();
		if (!data) return;
		let tile = data[tilesetContextMenuItem];
		if (!tile) return;
		addTileToHotbar(tile);
	}
}

function changeTilesetItemID() {
	let item = getActiveTilesetItem();
	if (!item) return;

	if(item.type === "tileset") {
		let newID = prompt("Enter a new ID for this tile.\nNote: If this tile has been placed onto any maps, changing the ID will break the reference.");
		if (!newID) return;
		newID = newID.trim();
		let item_data = item?.data ?? {};

		let tile_data = item_data[tilesetContextMenuItem];
		delete item_data[tilesetContextMenuItem];
		item_data[newID] = tile_data;

		SendCmd("BAG", { update: {id: activeTilesetItem.id, data: item_data} });
		refreshTilesetList();
	}
}

function deleteTilesetItem() {
	let item = getActiveTilesetItem();
	if (!item) return;

	if(!confirm(`Really delete ${item.name}?`)) return;

	if (item.type === "client_data") {
		let item_data = item?.data?.data ?? [];
		item_data = item_data.splice(tilesetContextMenuItem, 1);
		SendCmd("BAG", { update: {id: activeTilesetItem.id, data: {"type": "map_tile_list", "type_version": "0.0.1", "client_name": CLIENT_NAME, data: item_data} }});
	} else if(item.type === "tileset") {
		let item_data = item?.data ?? {};
		delete item_data[tilesetContextMenuItem];
		SendCmd("BAG", { update: {id: activeTilesetItem.id, data: item_data} });
	}
	refreshTilesetList();
}

///////////////////////////////////////////////////////////
// Item editing
///////////////////////////////////////////////////////////

let editItemType = null;
let editItemID = null;
let editItemWaitingForDataID = undefined;
let editItemOriginalSheet = null; // Original tileset image that the tile's pic was set to before the edit
let edited_client_data = null;

function editItemShared(item) {
	let itemobj = null;
	editItemType = item.type;
	document.getElementById('edittileautotileoptions').style.display = "none";
	document.getElementById('edittileanimationoptions').style.display = "none";
	document.getElementById('itemproperties_notmaptile').style.display = "block";
	document.getElementById('edittileobject').style.display = "none";
	document.getElementById('edittileobject').style.display = "none";
	document.getElementById('edittiletext').style.display = "none";
	document.getElementById('edittileimage').style.display = "none";
	document.getElementById('edittilegadget').style.display = "none";
	document.getElementById('edittiletileset').style.display = "none";
	document.getElementById('edittilecommandlist').style.display = "none";
	document.getElementById('edittilename').value = item.name;
	if(editTypeIsDirectEdit(item.type)) {
		document.getElementById('description_or_message').textContent = "Message";
		document.getElementById('edittiledesc').value = item?.data?.message ?? "";
	} else {
		document.getElementById('description_or_message').textContent = "Description";
		document.getElementById('edittiledesc').value = item.desc ?? "";
	}
	document.getElementById('edittilename_notmaptile').value = document.getElementById('edittilename').value;
	document.getElementById('edittiledesc_notmaptile').value = document.getElementById('edittiledesc').value;

	switch (item.type) {
		case "text":
			document.getElementById('edittiletext').style.display = "block";
			if (item.data)
				document.getElementById('edittiletextarea').value = item.data;
			else
				document.getElementById('edittiletextarea').value = "";
			break;
		case "image":
			document.getElementById('edittileimage').style.display = "block";
			document.getElementById('edittileurl').value = item.data;
			break;
		case "tileset":
			document.getElementById('edittiletileset').style.display = "block";
			document.getElementById('edittiletileset_json').value = JSON.stringify(item.data ?? {}, null, 2);
			break;

		case "generic":
		case "gadget":
		case "map_tile_hotbar":
		case "map_tile_mapobj_edit":
		case "map_tile_turf_edit":
		case "map_tile":
		case "tileset_new":
		case "tileset_edit":
			if (item.type === "gadget") {
				let traits = item.data;
				document.getElementById('gadgetTypeScript').checked = false;
				document.getElementById('gadgetTypePreset').checked = false;
				document.getElementById('gadgetTypeRaw').checked = true;

				document.getElementById('edittilegadget_raw_textarea').value = "";
				document.getElementById('edittilegadget_script_run').value = "auto_script";
				document.getElementById('edittilegadget_script_disable').checked = false;
				document.getElementById('edittilegadget_script_text').value = "";
				document.getElementById('edittilegadget_script_usable').checked = false;
				document.getElementById('edittilegadget_script_item').value = "";
				document.getElementById('edittilegadget_preset_dice_dice').value = 2;
				document.getElementById('edittilegadget_preset_dice_sides').value = 6;
				document.getElementById('edittilegadget_preset_accept_requests_owner_only').checked = false;
				document.getElementById('edittilegadget_preset_accept_requests_types').value = "";
				document.getElementById('edittilegadget_preset_random_message_text').value = "";
				document.getElementById('edittilegadget_preset_rc_car_owner_only').checked = false;
				document.getElementById('edittilegadget_preset_rc_car_fly').checked = false;
				document.getElementById('edittilegadget_preset_rc_car_give_rides').checked = false;
				document.getElementById('edittilegadget_preset_bot_message_button_id').value = "";
				document.getElementById('edittilegadget_preset_bot_message_button_text').value = "";
				document.getElementById('edittilegadget_preset_pushable_fly').checked = false;
				document.getElementById('edittilegadget_preset_draggable_owner_only').checked = false;
				document.getElementById('edittilegadget_preset_mini_tilemap_tileset_url').value = "";
				document.getElementById('edittilegadget_preset_mini_tilemap_tile_width').value = 4;
				document.getElementById('edittilegadget_preset_mini_tilemap_tile_height').value = 6;
				document.getElementById('edittilegadget_preset_mini_tilemap_offset_x').value = 0;
				document.getElementById('edittilegadget_preset_mini_tilemap_offset_y').value = 0;
				document.getElementById('edittilegadget_preset_mini_tilemap_type').value = "text";
				document.getElementById('edittilegadget_preset_mini_tilemap_data').value = "";
				document.getElementById('edittilegadget_preset_user_particle_owner_only').checked = false;
				document.getElementById('edittilegadget_preset_user_particle_particle').value = "";
				document.getElementById('edittilegadget_preset_pic_cycle_first_pic').value = "";
				document.getElementById('edittilegadget_preset_pic_cycle_length').value = 1;
				document.getElementById('edittilegadget_preset_pic_cycle_index').value = 0;
				document.getElementById('edittilegadget_preset_pic_cycle_owner_only').checked = false
				document.getElementById('edittilegadget_preset_pic_cycle_random').checked = false
				document.getElementById('edittilegadget_preset_pic_cycle_destroy_on_end').checked = false
				document.getElementById('edittilegadget_preset_projectile_shooter_pic').value = "";
				document.getElementById('edittilegadget_preset_projectile_shooter_max_distance').value = "";
				document.getElementById('edittilegadget_preset_projectile_shooter_dir').value = "none";
				document.getElementById('edittilegadget_preset_projectile_shooter_break_particle').value = "";
				document.getElementById('edittilegadget_preset_projectile_shooter_break_wall_hit').checked = false;
				document.getElementById('edittilegadget_preset_projectile_shooter_break_user_hit').checked = false;
				document.getElementById('edittilegadget_preset_projectile_shooter_break_max_distance').checked = false;

				if (Array.isArray(traits)) {
					document.getElementById('edittilegadget_raw_textarea').value = JSON.stringify(item.data);
					try {
						if (traits.length == 1) {
							let trait = traits[0];
							document.getElementById('gadgetTypeScript').checked = false;
							document.getElementById('gadgetTypePreset').checked = false;
							document.getElementById('gadgetTypeRaw').checked = true;
							if (trait[0] === "auto_script" || trait[0] === "use_script" || trait[0] === "map_script") {
								document.getElementById('edittilegadget_script_run').value = trait[0];
								document.getElementById('edittilegadget_script_disable').checked = !(trait[1].enabled ?? true);
								document.getElementById('edittilegadget_script_text').value = trait[1].code ?? "";
								document.getElementById('edittilegadget_script_usable').checked = trait[1].usable ?? false;
								document.getElementById('edittilegadget_script_item').value = trait[1].code_item ?? "";

								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypeScript').checked = true;
							} else if(trait[0] === "dice") {
								document.getElementById('edittilegadget_preset_dice_dice').value = trait[1].dices ?? 2;
								document.getElementById('edittilegadget_preset_dice_sides').value = trait[1].sides ?? 6;

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "accept_requests") {
								document.getElementById('edittilegadget_preset_accept_requests_owner_only').checked = trait[1].owner_only ?? false;
								document.getElementById('edittilegadget_preset_accept_requests_types').value = (trait[1].request_types ?? []).join(',');

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "random_tell" || trait[0] === "random_say") {
								if (Array.isArray(trait[0].text)) {
									document.getElementById('edittilegadget_preset_random_message_text').value = trait[1].text.join('\n');
								} else {
									document.getElementById('edittilegadget_preset_random_message_text').value = trait[1].text ?? "";
								}

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "rc_car") {
								document.getElementById('edittilegadget_preset_rc_car_owner_only').checked = trait[1].owner_only ?? false;
								document.getElementById('edittilegadget_preset_rc_car_fly').checked = trait[1].fly ?? false;
								document.getElementById('edittilegadget_preset_rc_car_give_rides').checked = trait[1].give_rides ?? false;

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "bot_message_button") {
								document.getElementById('edittilegadget_preset_bot_message_button_id').value = trait[1].id;
								document.getElementById('edittilegadget_preset_bot_message_button_text').value = trait[1].text;

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "pushable") {
								document.getElementById('edittilegadget_preset_pushable_fly').checked = trait[1].fly ?? false;
								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "draggable") {
								document.getElementById('edittilegadget_preset_draggable_owner_only').checked = false;

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "mini_tilemap") {
								document.getElementById('edittilegadget_preset_mini_tilemap_tileset_url').value = trait[1].tileset_url ?? "";
								let tile_size = trait[1].tile_size ?? [0,0];
								document.getElementById('edittilegadget_preset_mini_tilemap_tile_width').value = tile_size[0];
								document.getElementById('edittilegadget_preset_mini_tilemap_tile_height').value = tile_size[1];
								let offset = trait[1].offset ?? [0,0];
								document.getElementById('edittilegadget_preset_mini_tilemap_offset_x').value = offset[0];
								document.getElementById('edittilegadget_preset_mini_tilemap_offset_y').value = offset[1];
								if ("text" in trait[1]) {
									document.getElementById('edittilegadget_preset_mini_tilemap_type').value = "text";
									document.getElementById('edittilegadget_preset_mini_tilemap_data').value = trait[1].text;
								} else if ("single" in trait[1]) {
									document.getElementById('edittilegadget_preset_mini_tilemap_type').value = "single";
									document.getElementById('edittilegadget_preset_mini_tilemap_data').value = trait[1].single.join();
								}

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "user_particle") {
								document.getElementById('edittilegadget_preset_user_particle_owner_only').checked = trait[1].owner_only ?? false;
								document.getElementById('edittilegadget_preset_user_particle_particle').value = trait[1].particle ?? "";

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "doodle_board") {
								// TODO
							} else if(trait[0] === "pic_cycle") {
								document.getElementById('edittilegadget_preset_pic_cycle_first_pic').value = (trait[1].first_pic ?? []).join(" ");
								document.getElementById('edittilegadget_preset_pic_cycle_length').value = trait[1].length ?? 1;
								document.getElementById('edittilegadget_preset_pic_cycle_index').value = trait[1].index ?? 1;
								document.getElementById('edittilegadget_preset_pic_cycle_owner_only').checked = trait[1].owner_only ?? false;
								document.getElementById('edittilegadget_preset_pic_cycle_random').checked = trait[1].random ?? false;
								document.getElementById('edittilegadget_preset_pic_cycle_destroy_on_end').checked = trait[1].destroy_on_end ?? false;

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							} else if(trait[0] === "projectile_shooter") {
								document.getElementById('edittilegadget_preset_projectile_shooter_pic').value = (trait[1].pic ?? []).join(" ");
								document.getElementById('edittilegadget_preset_projectile_shooter_max_distance').value = trait[1].max_distance ?? "";
								document.getElementById('edittilegadget_preset_projectile_shooter_dir').value = trait[1].dir ?? "none";
								document.getElementById('edittilegadget_preset_projectile_shooter_break_particle').value = trait[1].break_particle ?? "";
								document.getElementById('edittilegadget_preset_projectile_shooter_break_wall_hit').checked = trait[1].break_wall_hit ?? false;
								document.getElementById('edittilegadget_preset_projectile_shooter_break_user_hit').checked = trait[1].break_user_hit ?? false;
								document.getElementById('edittilegadget_preset_projectile_shooter_break_max_distance').checked = trait[1].break_max_distance ?? false;

								document.getElementById('edittilegadget_preset_choice').value = trait[0];
								document.getElementById('gadgetTypeRaw').checked = false;
								document.getElementById('gadgetTypePreset').checked = true;
							}
						}
					} catch (error) {
					}
				} else {
					console.log("Not array?");
					console.log(traits);
				}

				document.getElementById('edittilegadget').style.display = "block";
				changeGadgetType();
				changeGadgetPreset();
			}

			if (item.type === "map_tile" || item.type == "map_tile_hotbar" || item.type === "map_tile_mapobj_edit" || item.type === "map_tile_turf_edit" || item.type === "tileset_new" || item.type === "tileset_edit") {
				document.getElementById('edittileautotileoptions').style.display = "block";
				document.getElementById('edittileanimationoptions').style.display = "block";
				itemobj = AtomFromName(item.data);
				if (itemobj == null && item.pic !== null) {
					itemobj = { pic: DefaultPics['default'] ?? [0, 0, 91] };
				}
			} else {
				if ("pic" in item && item.pic !== null)
					itemobj = { pic: item.pic };
				else
					itemobj = { pic: DefaultPics['default'] ?? [0, 0, 91] };
			}
			if (itemobj.pic[0] === INTERNAL_TILESET_ID) {
				itemobj.pic = DefaultPics['default'] ?? [0, 0, 91];
			}
			editItemOriginalSheet = itemobj.pic[0];
			document.getElementById("tileImageSheetOptions").style.display = document.getElementById("itemImageIsSheet").checked ? "inline" : "none";
			document.getElementById("tileImageURLOptions").style.display = document.getElementById("itemImageIsURL").checked ? "inline" : "none";
			document.getElementById('itemImageTypePicker').style.display = (item.type === "generic" || item.type === "gadget") ? "block" : "none";
			const isURLPic = (typeof itemobj.pic[0] === "string") && itemobj.pic[0] !== INTERNAL_TILESET_ID;
			document.getElementById('edittileimageurl').value = isURLPic ? itemobj.pic[0] : "";
			document.getElementById("itemImageIsSheet").checked = !isURLPic;
			document.getElementById("itemImageIsURL").checked = isURLPic;
			changeItemImageType();

			// Display all the available images assets in the user's inventory
			let sheetselect = document.getElementById("edittilesheet");
			while (sheetselect.firstChild) {
				sheetselect.removeChild(sheetselect.firstChild);
			}
			let el = document.createElement("option");
			el.textContent = "Keep the same";
			el.value = "keep";
			sheetselect.appendChild(el);

			for(let i=0; GlobalImageNames[i] !== undefined; i--) {
				el = document.createElement("option");
				el.textContent = GlobalImageNames[i];
				el.value = i;
				sheetselect.appendChild(el);
			}

			// Show all the tile sheets in the inventory, sorted by name
			let allUserOwnedTileSheets = [];
			for (let i in DBInventory) {
				if (DBInventory[i].type == "image") {
					el = document.createElement("option");
					el.textContent = DBInventory[i].name;
					el.value = DBInventory[i].id;
					allUserOwnedTileSheets.push(el);
				}
			}
			allUserOwnedTileSheets.sort(function (a, b) {
				return a.textContent.localeCompare(b.textContent);
			});
			for (let i of allUserOwnedTileSheets) {
				sheetselect.appendChild(i);
			}
			// Probably also allow just typing in something?

			document.getElementById('edittilemaptile').style.display = (item.type == "map_tile" || item.type == "map_tile_hotbar" || item.type == "map_tile_mapobj_edit" || item.type == "map_tile_turf_edit") ? "block" : "none";
			document.getElementById('edittileobject').style.display = "block";
			document.getElementById('itemproperties_notmaptile').style.display = "none";
			document.getElementById('edittilesheet').value = "keep";
			document.getElementById('edittilex').value = itemobj.pic[1];
			document.getElementById('edittiley').value = itemobj.pic[2];
			document.getElementById('edittileautotile').value = (itemobj.autotile_layout ?? 0).toString();
			document.getElementById('edittileautotileclass').value = itemobj.autotile_class ?? "";
			document.getElementById('edittileautotileclassedge').value = itemobj.autotile_class_edge ?? "";

			document.getElementById('edittileanimationmode').value = (itemobj.anim_mode ?? 0).toString();
			document.getElementById('edittileanimationframes').value = itemobj.anim_frames ?? 1;
			document.getElementById('edittileanimationspeed').value = itemobj.anim_speed ?? 1;
			document.getElementById('edittileanimationoffset').value = itemobj.anim_offset ?? 0;

			let index_for_type = 0;
			switch (itemobj.type) {
				case "sign":
					index_for_type = 1;
					break;
			}
			document.getElementById('edittiletype').selectedIndex = index_for_type;
			document.getElementById('edittiledensity').checked = itemobj.density;
			document.getElementById('edittileisobject').checked = !itemobj.obj;
			document.getElementById('edittileover').checked = itemobj.over == true;
			editItemUpdatePic();

			if (IconSheets[itemobj.pic[0] || 0] != undefined)
				document.getElementById('edittilesheetselect').src = IconSheets[itemobj.pic[0] || 0].src;
			break;
		case "client_data":
			edited_client_data = item.data;
			if (item?.data?.type === "command_list") {
				document.getElementById('edittilecommandlist').style.display = "block";
				let text = "";
				for (let command of item.data.data) {
					if ("comment" in command)    text += "/" + command.command + "\n";
					if ("name" in command) {
						if (text !== "")
							text += "\n"
						text += "-" + command.name + "\n";
					}
					function addField(field, prefix) {
						if (!(field in command))
							return;
						if (Array.isArray(command[field])) {
							for (let v of command[field])
								text += prefix + v + "\n";
						} else {
							text += prefix + command[field] + "\n";
						}
					}
					addField("command",    "/");
					addField("command_e",  "e/");
					addField("command_se", "se/");
					addField("command_s",  "s/");
					addField("command_sw", "sw/");
					addField("command_w",  "w/");
					addField("command_nw", "nw/");
					addField("command_n",  "n/");
					addField("command_ne", "ne/");
				}
				document.getElementById('edittilecommandlist_text').value = text;
			} else if (item?.data?.type === "map_tile_list") {
				document.getElementById('edittiletileset').style.display = "block";
				document.getElementById('edittiletileset_json').value = JSON.stringify(item?.data?.data ?? [], null, 2);
			}
			break;
	}

	// show the window
	document.getElementById('editItemWindow').style.display = "block";
}

function editItemUpdatePic() {
	let edittilesheet = document.getElementById('edittilesheet').value;
	let edittilex = parseInt(document.getElementById('edittilex').value);
	let edittiley = parseInt(document.getElementById('edittiley').value);

	let src = "";
	if (edittilesheet == "keep") {
		if (IconSheets[editItemOriginalSheet])
			src = IconSheets[editItemOriginalSheet].src;
	} else {
		edittilesheet = parseInt(edittilesheet);
		if (IconSheets[edittilesheet])
			src = IconSheets[edittilesheet].src;
	}
	document.getElementById('edittilepic').style.background = "url(" + src + ") -" + (edittilex * 16) + "px -" + (edittiley * 16) + "px";
	document.getElementById('edittilesheetselect').src = src;
}

function editItem(key) {
	// open up the item editing screen for a given item
	let item = DBInventory[key] || PlayerWho[key];
	editItemID = item.id;

	if (key in PlayerWho && !(key in DBInventory) && (item.type === "gadget" || item.type === "text" || item.type === "image" || item.type === "map_tile" || item.type === "tileset" || item.type === "landmark")) {
		editItemWaitingForDataID = editItemID;
		SendCmd("BAG", {info: { id: editItemID }});
	} else {
		editItemShared(item);
	}
}

function editTypeIsDirectEdit(type) {
	return type === "map_tile_hotbar" || type === "map_tile_mapobj_edit" || type === "map_tile_turf_edit" || type === "tileset_edit" || type === "tileset_new";
}

function editItemApply() {
	let alternateItemProperties = document.getElementById('itemproperties_notmaptile').style.display === "block";
	let edittilename = document.getElementById('edittilename' + (alternateItemProperties ? "_notmaptile" : "")).value;
	let edittiledesc = document.getElementById('edittiledesc' + (alternateItemProperties ? "_notmaptile" : "")).value;
	if (edittiledesc == "")
		edittiledesc = null;

	let updates = {
		id: editItemID,
		"name": edittilename,
		"desc": edittiledesc
	};

	switch (editItemType) {
		case "text":
			updates.data = document.getElementById('edittiletextarea').value;
			SendCmd("BAG", { update: updates });
			break;

		case "image":
			updates.data = document.getElementById('edittileurl').value;
			SendCmd("BAG", { update: updates });
			break;

		case "tileset":
			try {
				updates.data = JSON.parse(document.getElementById('edittiletileset_json').value);
			} catch(error) {
				alert(error);
				return;
			}
			SendCmd("BAG", { update: updates });
			break;

		case "map_tile_turf_edit":
		case "map_tile_mapobj_edit":
		case "map_tile_hotbar":
		case "tileset_new":
		case "tileset_edit":
		case "map_tile":
		case "generic":
		case "gadget":
			// Gather item info
			let sheet = document.getElementById('edittilesheet').value;
			if (sheet == "keep") {
				sheet = editItemOriginalSheet;
			} else {
				sheet = parseInt(sheet);
			}

			let edittilesheet = parseInt(sheet);
			let edittilex = parseInt(document.getElementById('edittilex').value);
			let edittiley = parseInt(document.getElementById('edittiley').value);
			let edittileurl = document.getElementById("itemImageIsURL").checked ? document.getElementById('edittileimageurl').value : "";
			let edittiletype = document.getElementById('edittiletype').value;
			let edittiledensity = document.getElementById('edittiledensity').checked;
			let edittileobject = !document.getElementById('edittileisobject').checked;
			let edittileover = document.getElementById('edittileover').checked;
			let edittileautotile = parseInt(document.getElementById('edittileautotile').value);
			let edittileautotileclass = document.getElementById('edittileautotileclass').value;
			let edittileautotileclassedge = document.getElementById('edittileautotileclassedge').value;

			let edittileanimationmode = parseInt(document.getElementById('edittileanimationmode').value);
			let edittileanimationframes = parseInt(document.getElementById('edittileanimationframes').value);
			let edittileanimationspeed = parseInt(document.getElementById('edittileanimationspeed').value);
			let edittileanimationoffset = parseInt(document.getElementById('edittileanimationoffset').value);

			updates.pic = [edittilesheet, edittilex, edittiley];
			if ((editItemType === "generic" || editItemType === "gadget") && edittileurl.trim().length) {
				updates.pic = [edittileurl.trim(), 0, 0];
			}

			if (editItemType == "map_tile" || editTypeIsDirectEdit(editItemType)) {
				let data = {
					"name": updates.name,
					"pic": updates.pic
				};
				if(edittiletype)
					data["type"] = edittiletype;
				if(edittileobject)
					data["obj"] = true;
				if(edittiledensity)
					data["density"] = true;
				if(edittileover)
					data["over"] = true;
				if(edittileautotile)
					data["autotile_layout"] = edittileautotile;
				if(edittileautotileclass)
					data["autotile_class"] = edittileautotileclass;
				if(edittileautotileclassedge)
					data["autotile_class_edge"] = edittileautotileclassedge;
				if(edittileanimationmode)
					data["anim_mode"] = edittileanimationmode;
				if(edittileanimationframes != NaN && edittileanimationframes > 1)
					data["anim_frames"] = edittileanimationframes;
				if(edittileanimationspeed != NaN && edittileanimationspeed > 1)
					data["anim_speed"] = edittileanimationspeed;
				if(edittileanimationoffset != NaN && edittileanimationoffset != 0)
					data["anim_offset"] = edittileanimationoffset;
				if(updates["desc"])
					data["message"] = updates["desc"];
				updates.data = JSON.stringify(data);
				if(editItemType === "map_tile_hotbar") {
					hotbarData[editItemID] = data;
					drawHotbar();
				} else if(editItemType === "map_tile_mapobj_edit") {
					let stack = getStackForMapObjMenu();
					stack.splice(mapObjContextMenuIndex, 1, data);
					finishMapObjMenuChange();
				} else if(editItemType === "map_tile_turf_edit") {
					// Tell the server about the change
					if(withinCurrentMap(turfContextMenuX, turfContextMenuY)) {
						MyMap.Tiles[turfContextMenuX][turfContextMenuY] = data;
						SendCmd("PUT", { pos: [turfContextMenuX, turfContextMenuY], atom: data });
						if (!OnlineMode) {
							NeedMapRedraw = true;
							backdropRerenderAll = true;
						}
					}
					// Update the selection window
					if(MouseActive && MouseStartX == turfContextMenuX && MouseStartY == turfContextMenuY && MouseStartX == MouseEndX && MouseStartY == MouseEndY) {
						updateSelectedTurfUL(MouseStartX, MouseStartY);
					}
				} else if(editItemType === "tileset_edit") {
					if (!editItemID)
						return;
					let item = DBInventory[editItemID];
					if (!item)
						return;
					if (item.type === "client_data") {
						let item_data = item?.data?.data ?? [];
						item_data[tilesetContextMenuItem] = data;

						// Sort by name
						item_data.sort(function (a, b) {
							let atomA = AtomFromName(a);
							let atomB = AtomFromName(b);
							return atomA.name.localeCompare(atomB.name);
						});

						SendCmd("BAG", { update: {id: activeTilesetItem.id, data: {"type": "map_tile_list", "type_version": "0.0.1", "client_name": CLIENT_NAME, data: item_data} }});
					} else if(item.type === "tileset") {
						let item_data = item?.data ?? {};
						item_data[tilesetContextMenuItem] = data;
						SendCmd("BAG", { update: {id: activeTilesetItem.id, data: item_data} });
					}
					refreshTilesetList();
				} else if(editItemType === "tileset_new") {
					addTileToActiveTilesetItem(data);
				}
			}

			if (editItemType == "gadget") {
				if (document.getElementById('gadgetTypeScript').checked) {
					let t = {};
					if (document.getElementById('edittilegadget_script_disable').checked)
						t.enabled = false;
					if (document.getElementById('edittilegadget_script_text').value.trim().length)
						t.code = document.getElementById('edittilegadget_script_text').value;
					if (document.getElementById('edittilegadget_script_item').value.trim().length)
						t.code_item = document.getElementById('edittilegadget_script_item').value;
					if (document.getElementById('edittilegadget_script_usable').checked)
						t.usable = true;
					updates.data = [[document.getElementById('edittilegadget_script_run').value, t]];
				} else if (document.getElementById('gadgetTypePreset').checked) {
					let t = {};
					switch (document.getElementById('edittilegadget_preset_choice').value) {
						case "dice":
							t.dice = parseInt(document.getElementById('edittilegadget_preset_dice_dice').value);
							t.sides = parseInt(document.getElementById('edittilegadget_preset_dice_sides').value);
							break;
						case "accept_requests":
							if (document.getElementById('edittilegadget_preset_accept_requests_owner_only').checked)
								t.owner_only = true;
							t.request_types = document.getElementById('edittilegadget_preset_accept_requests_types').value.trim().split(',');
							break;
						case "random_tell":
						case "random_say":
							t.text = document.getElementById('edittilegadget_preset_random_message_text').value.trim().split('\n');
							break;
						case "rc_car":
							if (document.getElementById('edittilegadget_preset_rc_car_owner_only').checked)
								t.owner_only = true;
							if (document.getElementById('edittilegadget_preset_rc_car_fly').checked)
								t.fly = true;
							if (document.getElementById('edittilegadget_preset_rc_car_give_rides').checked)
								t.give_rides = true;
							break;
						case "bot_message_button":
							t.id = document.getElementById('edittilegadget_preset_bot_message_button_id').value;
							let as_int = parseInt(t.id);
							if (!Number.isNaN(as_int))
								t.id = as_int;
							t.text = document.getElementById('edittilegadget_preset_bot_message_button_text').value;
							break;
						case "pushable":
							if (document.getElementById('edittilegadget_preset_pushable_fly').checked)
								t.fly = true;
							break;
						case "draggable":
							if (document.getElementById('edittilegadget_preset_draggable_owner_only').checked)
								t.owner_only = true;
							break;
						case "mini_tilemap":
							t.tileset_url = document.getElementById('edittilegadget_preset_mini_tilemap_tileset_url').value;
							t.tile_size = [parseInt(document.getElementById('edittilegadget_preset_mini_tilemap_tile_width').value), parseInt(document.getElementById('edittilegadget_preset_mini_tilemap_tile_height').value)];
							if (Number.isNaN(t.tile_size[0]))
								t.tile_size[0] = 0;
							if (Number.isNaN(t.tile_size[1]))
								t.tile_size[1] = 0;
							t.offset = [parseInt(document.getElementById('edittilegadget_preset_mini_tilemap_offset_x').value), parseInt(document.getElementById('edittilegadget_preset_mini_tilemap_offset_y').value)];
							if (Number.isNaN(t.offset[0]))
								t.offset[0] = 0;
							if (Number.isNaN(t.offset[1]))
								t.offset[1] = 0;

							switch (document.getElementById('edittilegadget_preset_mini_tilemap_type').value) {
								case "text":
									t.text = document.getElementById('edittilegadget_preset_mini_tilemap_data').value;
									break;
								case "single":
									t.single = document.getElementById('edittilegadget_preset_mini_tilemap_data').value.split(",");
									if (t.single.length == 2) {
										t.single = [parseInt(t.single[0]), parseInt(t.single[1])];
										if (Number.isNaN(t.single[0]) || Number.isNaN(t.single[1]))
											delete t.single;
									} else {
										delete t.single;
									}
									break;
							}
							break;
						case "user_particle":
							if (document.getElementById('edittilegadget_preset_user_particle_owner_only').checked)
								t.owner_only = true;
							t.particle = document.getElementById('edittilegadget_preset_user_particle_particle').value;
							break;
						case "doodle_board":
							break;
						case "pic_cycle":
							t.first_pic = document.getElementById('edittilegadget_preset_pic_cycle_first_pic').value.split(" ");
							if (t.first_pic.length === 3)
								t.first_pic = [parseInt(t.first_pic[0]), parseInt(t.first_pic[1]), parseInt(t.first_pic[2])];
							else
								delete t.first_pic;
							t.length = parseInt(document.getElementById('edittilegadget_preset_pic_cycle_length').value);
							if (Number.isNaN(t.length))
								delete t.length;
							t.index = parseInt(document.getElementById('edittilegadget_preset_pic_cycle_index').value);
							if (Number.isNaN(t.index))
								delete t.index;
							if (document.getElementById('edittilegadget_preset_pic_cycle_owner_only').checked)
								t.owner_only = true;
							if (document.getElementById('edittilegadget_preset_pic_cycle_random').checked)
								t.random = true;
							if (document.getElementById('edittilegadget_preset_pic_cycle_destroy_on_end').checked)
								t.destroy_on_end = true;
							break;
						case "projectile_shooter":
							t.pic = document.getElementById('edittilegadget_preset_projectile_shooter_pic').value.split(" ");
							if (t.pic.length === 3) {
								let sheetInt = parseInt(t.pic[0]);
								if (Number.isNaN(sheetInt)) {
									t.pic = [t.pic[0], parseInt(t.pic[1]), parseInt(t.pic[2])];
								} else {
									t.pic = [sheetInt, parseInt(t.pic[1]), parseInt(t.pic[2])];
								}
							} else
								delete t.pic;
							t.max_distance = parseInt(document.getElementById('edittilegadget_preset_projectile_shooter_max_distance').value);
							if (Number.isNaN(t.max_distance))
								delete t.max_distance;
							if (document.getElementById('edittilegadget_preset_projectile_shooter_dir').value !== "none")
								t.dir = parseInt(document.getElementById('edittilegadget_preset_projectile_shooter_dir').value);
							if (document.getElementById('edittilegadget_preset_projectile_shooter_break_particle').value.length)
								t.break_particle = document.getElementById('edittilegadget_preset_projectile_shooter_break_particle').value;
							if (document.getElementById('edittilegadget_preset_projectile_shooter_break_wall_hit').checked)
								t.break_wall_hit = true;
							if (document.getElementById('edittilegadget_preset_projectile_shooter_break_user_hit').checked)
								t.break_user_hit = true;
							if (document.getElementById('edittilegadget_preset_projectile_shooter_break_max_distance').checked)
								t.break_max_distance = true;
							break;
					}
					let data = [];
					updates.data = [[document.getElementById('edittilegadget_preset_choice').value, t]];
				} else if (document.getElementById('gadgetTypeRaw').checked) {
					if (document.getElementById('edittilegadget_raw_textarea').value == "") {
						updates.data = [];
					} else {
						try {
							updates.data = JSON.parse(document.getElementById('edittilegadget_raw_textarea').value);
						} catch (error) {
							alert(error);
							return;
						}
					}
				}
			}

			if(editItemType === "map_tile" || editItemType === "generic" || editItemType === "gadget") {
				SendCmd("BAG", { update: updates });
			}
			break;

		case "client_data":
			if (edited_client_data.type === "command_list" && document.getElementById('edittilecommandlist').style.display === "block") {
				// Parse the textarea
				let text = document.getElementById('edittilecommandlist_text').value
				let commands = [];

				let thisCommand = {};
				function addCommand() {
					if (Object.keys(thisCommand).length == 0)
						return;
					commands.push(thisCommand);
					thisCommand = {};
				}
				function addField(field, v) {
					if (thisCommand[field] === undefined)
						thisCommand[field] = v;
					else if (Array.isArray(thisCommand[field]))
						thisCommand[field].push(v);
					else
						thisCommand[field] = [thisCommand[field], v];
				}
				for (let line of text.split("\n")) {
					if (line.trim() == "")
						continue;
					if (line.startsWith("-")) {
						addCommand();
						thisCommand.name = line.slice(1);
					} else if(line.startsWith("/")) {
						addField("command", line.slice(1));
					} else if(line.startsWith("e/")) {
						addField("command_e", line.slice(2));
					} else if(line.startsWith("se/")) {
						addField("command_se", line.slice(3));
					} else if(line.startsWith("s/")) {
						addField("command_s", line.slice(2));
					} else if(line.startsWith("sw/")) {
						addField("command_sw", line.slice(3));
					} else if(line.startsWith("w/")) {
						addField("command_w", line.slice(2));
					} else if(line.startsWith("nw/")) {
						addField("command_nw", line.slice(3));
					} else if(line.startsWith("n/")) {
						addField("command_n", line.slice(2));
					} else if(line.startsWith("ne/")) {
						addField("command_ne", line.slice(3));
					} else {
						alert("Couldn't understand line:\n"+line);
						return;
					}
				}
				addCommand();
				edited_client_data.data = commands;
				updates.data = edited_client_data;
				SendCmd("BAG", { update: updates });
				if (commandListItem && commandListItem.id === editItemID) {
					commandListItem.data = edited_client_data;
					refreshCommandList();
				}
			} else if (edited_client_data.type === "map_tile_list") {
				try {
					updates.data = {"type": "map_tile_list", "type_version": "0.0.1", "client_name": CLIENT_NAME, 
						"data": JSON.parse(document.getElementById('edittiletileset_json').value)};
				} catch(error) {
					alert(error);
					return;
				}
				SendCmd("BAG", { update: updates }); // Just update name and description
			}
			break;

		default: // just update name then
			SendCmd("BAG", { update: updates });
			break;
	}
	editItemCancel();
}

function editItemClone() {
	SendCmd("BAG", { "clone": { "id": editItemID } });
	editItemCancel();
}

function editItemDelete() {
	if (!confirm("Really delete?"))
		return;
	SendCmd("BAG", { "delete": { "id": editItemID } });
	editItemCancel();
}

function editItemCancel() {
	document.getElementById('editItemWindow').style.display = "none";
	editItemID = null;
}

function newItemCreate(type) {
	let params = { create: { "type": type, "name": document.getElementById('newtilename').value } };
	if(document.getElementById("createtempobject").checked) {
		params['create']['temp'] = true;
	}
	if(type === "command_list") {
		let sampleEmote1Pic = DefaultPics.sampleEmote1 ?? [0, 8, 89];
		let sampleEmote2Pic = DefaultPics.sampleEmote2 ?? [0, 9, 89];
		params.create.type = "client_data";
		params.create.data = {"type": "command_list", "type_version": "0.0.1", "client_name": CLIENT_NAME, "data": [
			{"name": "happy",   "command": `userparticle ${sampleEmote1Pic[0]} ${sampleEmote1Pic[1]} ${sampleEmote1Pic[2]} offset=0,-16`},
			{"name": "sad",     "command": `userparticle ${sampleEmote2Pic[0]} ${sampleEmote2Pic[1]} ${sampleEmote2Pic[2]} offset=0,-16`},
			{"name": "explode", "command": "userparticle 0 13 53 anim_frames=7 anim_loops=0 hide_me"},
		]};
	} else if (type === "map_tile_list") {
		params.create.type = "client_data";
		params.create.data = {"type": "map_tile_list", "type_version": "0.0.1", "client_name": CLIENT_NAME, "data": []};
	}
	SendCmd("BAG", params);
	newItemCancel();
}

function newItemCancel() {
	document.getElementById('newItemWindow').style.display = "none";
}

function changeGadgetType() {
	let isScript = document.getElementById("gadgetTypeScript").checked;
	let isPreset = document.getElementById("gadgetTypePreset").checked;
	let isRaw    = document.getElementById("gadgetTypeRaw").checked;
	document.getElementById("edittilegadget_script").style.display = isScript ? "block" : "none";
	document.getElementById("edittilegadget_preset").style.display = isPreset ? "block" : "none";
	document.getElementById("edittilegadget_raw").style.display    = isRaw    ? "block" : "none";
}

function changeGadgetPreset() {
	let preset = document.getElementById("edittilegadget_preset_choice").value;
	document.getElementById("edittilegadget_preset_rc_car").style.display = (preset === "rc_car") ? "block" : "none";
	document.getElementById("edittilegadget_preset_accept_requests").style.display = (preset === "accept_requests") ? "block" : "none";
	document.getElementById("edittilegadget_preset_random_message").style.display = (preset === "random_say" || preset === "random_tell") ? "block" : "none";
	document.getElementById("edittilegadget_preset_dice").style.display = (preset === "dice") ? "block" : "none";
	document.getElementById("edittilegadget_preset_bot_message_button").style.display = (preset === "bot_message_button") ? "block" : "none";
	document.getElementById("edittilegadget_preset_pushable").style.display = (preset === "pushable") ? "block" : "none";
	document.getElementById("edittilegadget_preset_draggable").style.display = (preset === "draggable") ? "block" : "none";
	document.getElementById("edittilegadget_preset_mini_tilemap").style.display = (preset === "mini_tilemap") ? "block" : "none";
	document.getElementById("edittilegadget_preset_user_particle").style.display = (preset === "user_particle") ? "block" : "none";
	document.getElementById("edittilegadget_preset_doodle_board").style.display = (preset === "doodle_board") ? "block" : "none";
	document.getElementById("edittilegadget_preset_pic_cycle").style.display = (preset === "pic_cycle") ? "block" : "none";
	document.getElementById("edittilegadget_preset_projectile_shooter").style.display = (preset === "projectile_shooter") ? "block" : "none";
}

function changeItemImageType() {
	document.getElementById("tileImageSheetOptions").style.display = document.getElementById("itemImageIsSheet").checked ? "inline" : "none";
	document.getElementById("tileImageURLOptions").style.display = document.getElementById("itemImageIsURL").checked ? "inline" : "none";
}

///////////////////////////////////////////////////////////
// File management
///////////////////////////////////////////////////////////

async function createNewFile(set_my_pic, create_entity) {
	const formData = new FormData();
	formData.append("name", document.getElementById("newfilename").value);
	formData.append("desc", document.getElementById("newfiledesc").value);
	formData.append("set_my_pic", set_my_pic);
	formData.append("create_entity", create_entity);
	formData.append('file', document.getElementById("newfilefile").files[0]);

	let response = await fetch(API_URL + "/v1/my_files/file" , {
		headers: {'Authorization': 'Bearer ' + API_Key},
		body: formData,
		method: "POST"});
	if(response.status == 200) {
		let j = await response.json();
		let file_info = j.file;
		FileStorageInfo.files[file_info.id] = file_info;
		FileStorageInfo.info.used_space = j.info.used_space;
		FileStorageInfo.info.free_space = j.info.free_space;
		updateFileList();
	} else {
		if (response.status == 413) {
			alert("That file is too big to upload");
		} else if(response.status == 415) {
			alert("File is not a valid image; please make sure it's a PNG");
		} else if(response.status == 507) {
			alert("Not enough storage space to upload that");
		} else {
			alert("Encountered an error; code "+response.status);
		}
	}
	newFileCancel();
}

async function createNewFolder() {
	const formData = new FormData();
	formData.append("name", document.getElementById("newfoldername").value);
	formData.append("desc", document.getElementById("newfolderdesc").value);

	let response = await fetch(API_URL + "/v1/my_files/folder" , {
		headers: {'Authorization': 'Bearer ' + API_Key},
		body: formData,
		method: "POST"});
	if(response.status == 200) {
		let j = await response.json()
		let folder_info = j.folder;
		FileStorageInfo.folders[folder_info.id] = folder_info;
		updateFileList();
	} else {
		console.log("Error "+response.status);
	}
	newFolderCancel();
}


function newFileCancel() {
	document.getElementById('newFileWindow').style.display = "none";
}

function newFolderCancel() {
	document.getElementById('newFolderWindow').style.display = "none";
}

function editFileCancel() {
	document.getElementById('editFileWindow').style.display = "none";
}

function editFolderCancel() {
	document.getElementById('editFolderWindow').style.display = "none";
}

let contextMenuFile = 0;
function openFileContextMenu(id, x, y) {
	let url = FileStorageInfo.files[id]?.url;
	let isMusic = false;

	if(url) {
		let lowered = url.toLowerCase();
		if(lowered.endsWith(".mod") || lowered.endsWith(".s3m") || lowered.endsWith(".xm") || lowered.endsWith(".it") || lowered.endsWith(".mptm")) {
			isMusic = true;
		}
	}

	let menu = isMusic ? document.querySelector('#fileupload-contextmenu-music') : document.querySelector('#fileupload-contextmenu-image');
	menu.style.left = (x-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.top = (y-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.display = "block";
	contextMenuFile = id;
	if(isMusic)
		document.getElementById("openMusicInNewTabLink").href = url;
	else
		document.getElementById("openFileInNewTabLink").href = url;
}

let contextMenuFolder = 0;
function openFolderContextMenu(id, x, y) {
	let menu = document.querySelector('#filefolder-contextmenu');
	menu.style.left = (x-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.top = (y-CONTEXT_MENU_OPEN_OFFSET) + "px";
	menu.style.display = "block";
	contextMenuFolder = id;
}

function fileUploadPlayMusic() {
	let file = FileStorageInfo.files[contextMenuFile];
	playMusic(file.url, true);
}

function fileUploadSetMapMusic() {
	let file = FileStorageInfo.files[contextMenuFile];
	sendChatCommand('mapmusic '+file.url);
}

function fileUploadContextMenuAppearance() {
	let file = FileStorageInfo.files[contextMenuFile];
	sendChatCommand('userpic '+file.url);
}
function fileUploadContextMenuTileSheet() {
	let file = FileStorageInfo.files[contextMenuFile];
	for (let item of DBInventory) {
		if (item === undefined)
			continue;
		if (item.data == file.url) {
			if (!confirm(`You already have a tile sheet pointing at this image (named "${item.name}"); create another?`))
				return;
			break;
		}
	}
	SendCmd("BAG", { create: { "type": "image", "name": file.name, "data": file.url } });
}

async function fileUploadContextMenuDelete () {
	let file = FileStorageInfo.files[contextMenuFile];
	if (
		confirm(`Really delete file "${file.name}" with ID ${contextMenuFile}?`)
	) {
		let response = await fetch(API_URL + "/v1/my_files/file/"+contextMenuFile, {
			headers: {'Authorization': 'Bearer ' + API_Key},
			method: "DELETE"});
		if(response.status == 204) {
			delete FileStorageInfo.files[contextMenuFile];
			updateFileList();
		} else {
			console.log("Error "+response.status);
		}
	}
}

async function fileFolderContextMenuDelete() {
	let folder = FileStorageInfo.folders[contextMenuFolder];
	if (
		confirm(`Really delete folder "${folder.name}" with ID ${contextMenuFolder}?`)
	) {
		let response = await fetch(API_URL + "/v1/my_files/folder/"+contextMenuFolder, {
			headers: {'Authorization': 'Bearer ' + API_Key},
			method: "DELETE"});
		if(response.status == 204) {
			delete FileStorageInfo.folders[contextMenuFolder];
			updateFileList();
		} else {
			console.log("Error "+response.status);
		}
	}
}

async function moveFileOrFolder(move_id, isfolder) {
	document.getElementById("moveItemTitle").textContent = isfolder ? "Move folder" : "Move file";
	document.getElementById("moveItemNoun").textContent = isfolder ? "folder" : "item";

	let window = document.getElementById('moveItem');
	toggleDisplay(window);

	let source = document.getElementById('movesourceul');
	let target = document.getElementById('movetargetul');

	while (source.firstChild) {
		source.removeChild(source.firstChild);
	}
	let metadata = isfolder ? FileStorageInfo.folders[move_id] : FileStorageInfo.files[move_id];
	let item = {
		name: metadata.name,
		desc: metadata.desc,
	};
	if(isfolder) {
		item.pic = FolderOpenPic;
		item.id = "F"+move_id;
	} else {
		if(metadata.url.toLowerCase().endsWith(".png")) {
			item.pic = [metadata.url, 0, 0];
			item.is_uploaded_image = true;
		} else
			item.pic = [0, 19, 30];
		item.id = move_id;
	}
	source.appendChild(itemCard(item));

	// ---

	fileCardList(target, true, function(e, id) {
		moveFileOrFolderTo(move_id, -id, isfolder);
		toggleDisplay(window);
	}, null);

	let moveToNull = itemCard(PlayerYou);
	moveToNull.addEventListener('click', function (evt) {
		moveFileOrFolderTo(move_id, 0, isfolder);
		toggleDisplay(window);
	}, false);
	if (target.childElementCount > 0)
		target.insertBefore(moveToNull, target.firstChild);
	else
		target.appendChild(moveToNull);
}

async function moveFileOrFolderTo(move_id, destination_id, isfolder) {
	if (isfolder) {
		const formData = new FormData();
		formData.append("folder", destination_id);
		let response = await fetch(API_URL + "/v1/my_files/folder/"+(move_id) , {
			headers: {'Authorization': 'Bearer ' + API_Key},
			body: formData, method: "PUT"});
		if(response.status == 200) {
			let j = await response.json();
			let folder_info = j.folder;
			FileStorageInfo.folders[folder_info.id].folder = folder_info.folder;
			updateFileList();
		} else {
			console.log("Error "+response.status);
		}
	} else {
		const formData = new FormData();
		formData.append("folder", destination_id);

		let response = await fetch(API_URL + "/v1/my_files/file/"+(move_id) , {
			headers: {'Authorization': 'Bearer ' + API_Key},
			body: formData, method: "PUT"});
		if(response.status == 200) {
			let j = await response.json();
			let file_info = j.file;
			FileStorageInfo.files[file_info.id].folder = file_info.folder;
			updateFileList();
		} else {
			console.log("Error "+response.status);
		}
	}
}

let editedFileID = null;
function fileUploadContextMenuEdit() {
	editedFileID = contextMenuFile;
	let file = FileStorageInfo.files[editedFileID];
	document.getElementById('editfilename').value = file.name;
	document.getElementById('editfiledesc').value = file.desc;

	document.getElementById('editFileWindow').style.display = "block";
}

let editedFolderID = null;
function fileFolderContextMenuEdit() {
	editedFolderID = contextMenuFolder;
	let folder = FileStorageInfo.folders[editedFolderID];
	document.getElementById('editfoldername').value = folder.name;
	document.getElementById('editfolderdesc').value = folder.desc;

	document.getElementById('editFolderWindow').style.display = "block";
}

async function doEditFile(reupload, set_my_pic, keep_url) {
	const formData = new FormData();
	formData.append("name", document.getElementById("editfilename").value);
	formData.append("desc", document.getElementById("editfiledesc").value);
	formData.append("set_my_pic", set_my_pic);
	formData.append("keep_url", keep_url);
	if(reupload) {
		formData.append('file', document.getElementById("editfilefile").files[0]);
	}

	let response = await fetch(API_URL + "/v1/my_files/file/"+(editedFileID) , {
		headers: {'Authorization': 'Bearer ' + API_Key},
		body: formData, method: "PUT"});
	if(response.status == 200) {
		let j = await response.json();
		let file_info = j.file;
		FileStorageInfo.files[file_info.id] = file_info;
		FileStorageInfo.info.used_space = j.info.used_space;
		FileStorageInfo.info.free_space = j.info.free_space;
		updateFileList();
	} else {
		if (response.status == 413) {
			alert("That file is too big to upload");
		} else if(response.status == 415) {
			alert("File is not a valid image; please make sure it's a PNG");
		} else if(response.status == 507) {
			alert("Not enough storage space to upload that");
		} else {
			alert("Encountered an error; code "+response.status);
		}
	}

	editFileCancel();
}

async function doEditFolder() {
	const formData = new FormData();
	formData.append("name", document.getElementById("editfoldername").value);
	formData.append("desc", document.getElementById("editfolderdesc").value);

	let response = await fetch(API_URL + "/v1/my_files/folder/"+(editedFolderID) , {
		headers: {'Authorization': 'Bearer ' + API_Key},
		body: formData, method: "PUT"});
	if(response.status == 200) {
		let j = await response.json();
		let folder_info = j.folder;
		FileStorageInfo.folders[folder_info.id] = folder_info;
		updateFileList();
	} else {
		alert("Encountered an error; code "+response.status);
	}

	editFolderCancel();
}

///////////////////////////////////////////////////////////
// Mail
///////////////////////////////////////////////////////////

let Mail = [];

function viewCompose() {
	if (messaging_mode) {
		document.getElementById('mailDivMain').style.display = "none";
		document.getElementById('mailDivView').style.display = "none";
		document.getElementById('mailDivCompose').style.display = "block";
		document.getElementById('mailDivPreview').style.display = "none";
	} else {
		document.getElementById('compose').style.display = 'block';
	}
}

function mailSelectToggle() {
	for (let i = 0; i < Mail.length; i++) {
		const checkbox = document.getElementById("mailcheck" + i);
		if (checkbox)
			checkbox.checked = !checkbox.checked;
	}
}

function mailSelectDelete() {
	const deleteList = [];
	for (let i = 0; i < Mail.length; i++) {
		const checkbox = document.getElementById("mailcheck" + i);
		if (checkbox && checkbox.checked)
			deleteList.push(Mail[i].id);
	}

	if(deleteList.length && confirm("Really delete "+deleteList.length+" mail message"+(deleteList.length != 1 ? "" : "")+"?")) {
		let newMail = [];
		for (let i = 0; i < Mail.length; i++) {
			if (!deleteList.includes(Mail[i].id))
				newMail.push(Mail[i]);
		}
		Mail = newMail;

		updateMailUL();

		for (let id of deleteList)
			SendCmd("EML", { "delete": id });
		alreadySeenMail = "";
	}
}

function updateMailUL() {
	// Manage the users <ul>
	let ul = document.getElementById('mailul');
	if (!ul)
		return;

	// Empty out the list
	while (ul.firstChild) {
		ul.removeChild(ul.firstChild);
	}

	for (let i = 0; i < Mail.length; i++) {
		let li = document.createElement("li");
		let letter = Mail[i];

		let checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.onclick = function(event) {event.stopPropagation();}
		checkbox.id = "mailcheck" + i;
		li.appendChild(checkbox);

		if (letter.flags === undefined)
			letter.flags = [];
		if (letter.flags.includes('sent')) {
			li.appendChild(document.createTextNode(String.fromCharCode(8594) + "\"" + letter.subject + "\" to " + letter.to.join(', ')));
		} else {
			li.appendChild(document.createTextNode(String.fromCharCode(8592) + "\"" + letter.subject + "\" from " + letter.from));
		}

		if (letter.flags.length == 0) {
			li.appendChild(document.createTextNode(" (NEW)"));
		}

		li.onclick = function () {
			// Prevent accidentally wiping out the check list
			for (let i = 0; i < Mail.length; i++) {
				const checkbox = document.getElementById("mailcheck" + i);
				if (checkbox && checkbox.checked)
					return;
			}

			SendCmd("EML", { read: letter.id });
			alreadySeenMail = "";
			if(!Mail[i].flags.includes('read'))
				Mail[i].flags.push('read'); // mark as read locally
			updateMailUL(); // show it as read locally

			if (messaging_mode) {
				document.getElementById('mailDivView').style.display = 'block';
				document.getElementById('mailDivMain').style.display = 'none';
			} else {
				document.getElementById('mail-view').style.display = 'block';
			}
			document.getElementById('mail-view-title').innerHTML = `Mail: ${convertBBCode(letter.subject)}`;
			document.getElementById('mail-view-contents').innerHTML = '<button class="spaced_buttons" onclick="replyMail(' + letter.id + ')">Reply</button>'
				+ '<button class="spaced_buttons" onclick="replyAllMail(' + letter.id + ')">Reply all</button>'
				+ '<button class="spaced_buttons" onclick="deleteMail(' + letter.id + ')">Delete</button><br>'
				+ '<table border="0">'
				+ '<tr><td>From</td><td>' + letter.from + '</td></tr>'
				+ '<tr><td>To</td><td>' + letter.to.join(",") + '</td></tr>'
				+ (letter.timestamp?('<tr><td>Date</td><td>' + new Date(letter.timestamp).toLocaleDateString() + '</td></tr>'):'')
				+ '</table><hr>'
				+ convertBBCodeMultiline(letter.contents);
		};
		li.oncontextmenu = function () { return false; };

		li.classList.add('inventoryli');
		li.id = "maillist" + i;
		ul.appendChild(li);
	}
}

function previewMail() {
	let subject = document.getElementById('mailsendsubject').value;
	let contents = document.getElementById('mailsendtext').value;
	let to = document.getElementById('mailsendto').value;

	if (messaging_mode) {
		document.getElementById('mailDivMain').style.display = "none";
		document.getElementById('mailDivView').style.display = "none";
		document.getElementById('mailDivCompose').style.display = "none";
		document.getElementById('mailDivPreview').style.display = "block";
	} else {
		document.getElementById('mail-preview').style.display = 'block';
	}

	document.getElementById('mail-preview-title').innerHTML = `Mail preview: ${convertBBCode(subject)}`;
	document.getElementById('mail-preview-contents').innerHTML = convertBBCodeMultiline(contents);
}

function sendMail() {
	let subject = document.getElementById('mailsendsubject').value;
	let contents = document.getElementById('mailsendtext').value;
	let to = document.getElementById('mailsendto').value.split(',');
	SendCmd("EML", { send: { "subject": subject, "contents": contents, "to": to } });
}

function replyMail(id) {
	// find mail by ID
	let index = -1;
	for (let i = 0; i < Mail.length; i++) {
		if (Mail[i].id == id) {
			index = i;
			break;
		}
	}
	if (index == -1)
		return;


	const yourUsername = PlayerWho[PlayerYou].username;

	document.getElementById('mailsendsubject').value = ((Mail[index]["from"] != yourUsername)?"RE: ":"") + Mail[index].subject;
	document.getElementById('mailsendtext').value = "";
	document.getElementById('mailsendto').value = (Mail[index]["from"] == yourUsername) ? Mail[index]["to"] : Mail[index]["from"];

	viewCompose();
}

function replyAllMail(id) {
	// find mail by ID
	let index = -1;
	for (let i = 0; i < Mail.length; i++) {
		if (Mail[i].id == id) {
			index = i;
			break;
		}
	}
	if (index == -1)
		return;

	const yourUsername = PlayerWho[PlayerYou].username;
	
	document.getElementById('mailsendsubject').value = ((Mail[index]["from"] != yourUsername)?"RE: ":"") + Mail[index].subject;
	document.getElementById('mailsendtext').value = "";

	// add everyone to the list except yourself
	let to_list = (Mail[index]["from"] == yourUsername) ? [] : [Mail[index]["from"]];
	for (let i = 0; i < Mail[index]["to"].length; i++) {
	if (Mail[index]["to"][i] != yourUsername)
		to_list.push(Mail[index]["to"][i]);
	}
	document.getElementById('mailsendto').value = to_list.join(",");

	viewCompose();
}

function deleteMail(id) {
  if (!confirm("Really delete?"))
    return;

  let newMail = [];
  for (let i = 0; i < Mail.length; i++) {
    if (Mail[i].id != id)
      newMail.push(Mail[i]);
  }
  Mail = newMail;
  updateMailUL();
  SendCmd("EML", { "delete": id });
  if (messaging_mode) {
    document.getElementById('mailDivView').style.display = "none";
    document.getElementById('mailDivMain').style.display = "block";
  } else {
    document.getElementById('mail-view').style.display = "none";
  }
}

function viewMail() {
  var mail = document.getElementById('mail');
  if(!toggleDisplay(mail))
    return;
  if (messaging_mode) {
    document.getElementById('mailDivMain').style.display = "block";
    document.getElementById('mailDivView').style.display = "none";
    document.getElementById('mailDivCompose').style.display = "none";
    document.getElementById('mailDivPreview').style.display = "none";
  } else {
    var ul = document.getElementById('mailul');
    if (!ul) {
      newWindow("Mail", '<button onclick="viewCompose();">Compose</button><br/><ul id="mailul" class="unselectable"></ul>', null);
    }
  }
  updateMailUL();
}


///////////////////////////////////////////////////////////
// BBCode and messages
///////////////////////////////////////////////////////////

let chatLogForExport = [];

function escape_tags(t) {
	if (t.replaceAll)
		return t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
	return t;
}

function convertBBCodeMultiline(t) {
	let result = XBBCODE.process({
		text: t,
		removeMisalignedTags: false,
		addInLineBreaks: true
	});
	return result.html;
}

function convertBBCode(t) {
	let result = XBBCODE.process({
		text: t,
		removeMisalignedTags: false,
		addInLineBreaks: false
	});
	return result.html;
}

function convertBBCodeChat(t) {
	let result = XBBCODE.process({
		text: t,
		removeMisalignedTags: false,
		addInLineBreaks: false
	});
	return result.html.replaceAll("\n", "<br>");
}

let timeFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
let alreadyPlayedSound = false;
let focusChatDistance = null;
let focusChatNames = [];

function isDistantChat(Params) {
	if (focusChatNames && Params.id !== undefined && Params.id !== PlayerYou) {
		if (focusChatDistance && !focusChatNames.length) {
			if (Params.id in PlayerWho && Math.sqrt(Math.pow(PlayerWho[Params.id].x - PlayerWho[PlayerYou].x, 2) + Math.pow(PlayerWho[Params.id].y - PlayerWho[PlayerYou].y, 2)) > focusChatDistance)
				return true;
		} else if (focusChatNames.length && !focusChatDistance) {
			if (Params.username && !focusChatNames.includes(Params.username))
				return true;
		} else if (focusChatNames.length && focusChatDistance) {
			if (Params.username && !focusChatNames.includes(Params.username) && Params.id in PlayerWho && Math.sqrt(Math.pow(PlayerWho[Params.id].x - PlayerWho[PlayerYou].x, 2) + Math.pow(PlayerWho[Params.id].y - PlayerWho[PlayerYou].y, 2)) > focusChatDistance)
				return true;
		}
	}
	return false;
}

function logMessage(Message, Class, Params) {
	Params = Params ?? {};
	let chatArea = document.getElementById("chatArea");
	let bottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight<3;
	let distantChat = (Class !== "private_message") && isDistantChat(Params);

	let timestampText = "";
	if (chatTimestamps) {
		if (Params.timestamp) {
			let date = new Date(Date.parse(Params.timestamp));
			let now = new Date();
			if (date.toLocaleDateString() !== now.toLocaleDateString())
				timestampText = date.toLocaleDateString() + " " + timeFormat.format(date);
			else
				timestampText = timeFormat.format(date);
		} else {
			let currentDate = new Date();
			timestampText = timeFormat.format(currentDate);
		}
	}

	let newMessage = document.createElement("div");
	if (Class !== "server_message" && Class !== "server_motd" && Class !== "server_stats" && Class.startsWith("server_")) // Color it server color even if the specific class is unknown
		Class = "server_message";
	newMessage.className = Class + " log_line" + (distantChat ? " distant_message" : "");
	if (Params.username) {
		if (Params.rc_username) {
			newMessage.title = `Username: ${Params.username} (controlled by ${Params.rc_username})`;
			Message = "&#x1F4E1;" + Message;
		} else {
			newMessage.title = `Username: ${Params.username}`;
		}
	}
	newMessage.innerHTML = (timestampText.length ? (`<span class="timestamp">${timestampText}</span> `) : "") + Message.replaceAll("\n", "<br>");
	chatArea.append(newMessage);

	if (OnlineMuWebview) {
		window.chrome.webview.hostObjects.client.Display(Params.plainText ?? Message);
	}

	if (bottom)
		chatArea.scrollTop = chatArea.scrollHeight;

	if (!alreadyPlayedSound && !distantChat) {
		if ((Params.isChat || Params.isPrivateChat) && AudioChatNotifications) {
			if (!Params.isSilent) {
				if (!desktopNotificationNoAudio) {
					let audio = new Audio(Params.isPrivateChat ? 'img/audio/notifyprivate.wav' : 'img/audio/notifychat.wav');
					audio.play();
					alreadyPlayedSound = true;
				}
				if (enableDesktopNotifications && document.visibilityState !== "visible") {
					const notification = new Notification(Params.username?`Tilemap Town: ${Params.username}`:"Tilemap Town", {body: Params.plainText, icon: desktopNotificationIcon, badge: desktopNotificationIcon});
					activeNotifications.push(notification);
				}
			}
		} else if (!Params.isChat && AudioMiscNotifications) {
			if (!Params.isSilent) {
				if (!desktopNotificationNoAudio) {
					let audio = new Audio('img/audio/notifymisc.wav');
					audio.play();
					alreadyPlayedSound = true;
				}
				if (enableDesktopNotifications && document.visibilityState !== "visible") {
					const notification = new Notification(Params.username?`Tilemap Town: ${Params.username}`:"Tilemap Town", {body: Params.plainText, icon: desktopNotificationIcon, badge: desktopNotificationIcon, silent: true});
					activeNotifications.push(notification);
				}
			}
		}
	}

	if (Params.plainText && Class !== "secret_message") {
		chatLogForExport.push((timestampText.length ? (`[${timestampText}] `) : "") + (distantChat ? "~~~ " : "") + Params.plainText);
	}
}

function offerCommand(t) {
	if (t.startsWith("map ") || confirm('Run command "' + t + '"?')) {
		if (runLocalCommand("/"+t));
		else sendChatCommand(t);
	}
}

function botMessageButton(bot_id, t) {
	SendCmd("EXT", { "bot_message_button": { "id": bot_id, "text": t } });
}

const emptyTag = {
	openTag: function (params, content) {
		return '';
	},
	closeTag: function (params, content) {
		return '';
	}
}

let senderIdForBbcode;
XBBCODE.addTags({
	"tt": XBBCODE.tags()["code"],
	"img": emptyTag,
	"face": emptyTag,
	"font": emptyTag,
	"command": {
		openTag: function (params, content) {
			let filteredJS = content.replace(/\x22/g, '\\\x22');
			let filteredHTML = content.replace(/\x22/g, '&quot;');
			return '<input type="button" value="' + filteredHTML + '" onClick=\'offerCommand("' + filteredJS + '")\'></input>';
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
			return '<input type="button" value="&#x1F4CB;' + filteredHTML + '" onClick=\'setChatInput("' + filteredJS + '"); event.stopPropagation();\'></input>';
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
			return '<input type="button" value="&#x1F916;' + filteredHTML + '" onClick=\'botMessageButton('+JSON.stringify(senderIdForBbcode)+',"' + filteredJS + '"); event.stopPropagation();\'></input>';
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



///////////////////////////////////////////////////////////
// Drawing/selection tools
///////////////////////////////////////////////////////////

function changeBuildTool() {
	let isSelect = document.getElementById("buildToolSelect").checked;
	let isDraw = document.getElementById("buildToolDraw").checked;
	if(isSelect) {
		buildTool = BUILD_TOOL_SELECT;
        drawToolX = null;
        drawToolY = null;
    }
	if(isDraw) {
		buildTool = BUILD_TOOL_DRAW;
        MouseActive = false;
        NeedMapRedraw = true;
    }
	// Remove focus from the radio buttons, restoring the player's ability to move around
	document.activeElement.blur();
}

function copyTurfFromSelection() {
	if (!MouseActive || MouseStartX != MouseEndX || MouseStartY != MouseEndY || MouseStartX < 0 || MouseStartY < 0 || MouseStartX >= MyMap.Width || MouseStartY >= MyMap.Height)
		return;
	let tile = MyMap.Tiles[MouseStartX][MouseStartY];
	if(tile)
		addTileToHotbar(tile);
}

function copyObjFromSelection() {
	if (!MouseActive || MouseStartX != MouseEndX || MouseStartY != MouseEndY || MouseStartX < 0 || MouseStartY < 0 || MouseStartX >= MyMap.Width || MouseStartY >= MyMap.Height)
		return;
	for (var index in MyMap.Objs[MouseStartX][MouseStartY]) {
		addTileToHotbar(MyMap.Objs[MouseStartX][MouseStartY][index]);
	}
}

function undoDrawStroke() {
	if(drawToolUndoHistory.length == 0)
		return;
	let undoData = drawToolUndoHistory.pop();
	let data = undoData.data;
	let obj = undoData.obj;

	for(let index in data) {
		let s = index.split(",");
		let x = parseInt(s[0]);
		let y = parseInt(s[1]);

		let value = data[index];
		if(obj) {
			MyMap.Objs[x][y] = value;
			SendCmd("PUT", { pos: [x, y], obj: true, atom: value });
		} else {
			MyMap.Tiles[x][y] = value;
			SendCmd("PUT", { pos: [x, y], obj: false, atom: value });
		}
	}
}


///////////////////////////////////////////////////////////
// Hotbar
///////////////////////////////////////////////////////////

let hotbarData = [null, null, null, null, null, null, null, null, null, null];
let hotbarSelectIndex = null;

function drawHotbar() {
	// This draws the hotbar on the bottom
	let canvas = document.getElementById("selector");
	let ctx = canvas.getContext("2d");

	canvas.width = 320;

	ctx.clearRect(0, 0, canvas.width, canvas.height);

	// Draw ten inventory items
	let oneWidth = canvas.width / 10;
	for (let i = 0; i < 10; i++) {
		try {
			drawText(ctx, i * oneWidth, 0, ((i + 1) % 10) + "");
		
			if(i < hotbarData.length) {
				let item = AtomFromName(hotbarData[i]);
				if(item) {
					let pic = item.menu_pic ?? item.pic;
					if (IconSheets[pic[0]])
						ctx.drawImage(IconSheets[pic[0]], pic[1]*16, pic[2]*16, 16, 16, i*oneWidth+12, 0, 16, 16);
				}
			}
			if(i == hotbarSelectIndex) {
				ctx.beginPath();
				ctx.globalAlpha = 0.75;
				ctx.lineWidth = "2";
				ctx.strokeStyle = "black";
				ctx.rect(i*oneWidth+12-1, 0, 18, 16);
				ctx.stroke();

				ctx.beginPath();
				ctx.moveTo(i*oneWidth+12-2, 16);
				ctx.lineTo(i*oneWidth+0,    16);
				ctx.stroke();

				ctx.globalAlpha = 1;
			}
		} catch (error) {
		}
	}
}

function copyBuildToTileset() {
	addTileToActiveTilesetItem(rightClickedBuildTile);
}

function copyBuildToHotbar() {
	addTileToHotbar(rightClickedBuildTile);
}

function copyItemToTileset(id) {
	if(!(id in DBInventory))
		return;
	let item = DBInventory[id];
	if(item.type !== 'map_tile')
		return;
	addTileToActiveTilesetItem(item.data);
}
function copyItemToHotbar(id) {
	if(!(id in DBInventory))
		return;
	let item = DBInventory[id];
	if(item.type !== 'map_tile')
		return;
	addTileToHotbar(item.data);
}
function addTileToHotbar(tileData) {
	let freeSlot = hotbarData.indexOf(null);
	if(freeSlot === -1) {
		// It goes into the selected index, or the last index
		if(hotbarSelectIndex !== null)
			freeSlot = hotbarSelectIndex;
		else
			freeSlot = hotbarData.length - 1;
	}

	hotbarData[freeSlot] = tileData;
	setHotbarIndex(freeSlot);
}

function setHotbarIndex(index) {
	hotbarSelectIndex = index;
	if(buildMenuSelectIndex !== null) {
		buildMenuSelectIndex = null;
		redrawBuildCanvas();
	}
	drawHotbar();
}

function setBuildMenuSelectIndex(index) {
	buildMenuSelectIndex = index;
	if(hotbarSelectIndex !== null) {
		hotbarSelectIndex = null;
		drawHotbar();
	}
	redrawBuildCanvas();
}

function unselectDrawToolTile() {
	if(buildMenuSelectIndex !== null) {
		buildMenuSelectIndex = null;
		redrawBuildCanvas();
	}
	if(hotbarSelectIndex !== null) {
		hotbarSelectIndex = null;
		drawHotbar();
	}
}

function copyHotbarSlotToTileset() {
	if (rightClickedHotbarIndex === null)
		return;
	if (hotbarData[rightClickedHotbarIndex] === null)
		return;
	addTileToActiveTilesetItem(hotbarData[rightClickedHotbarIndex]);
}

function copyHotbarSlotToInventory() {
	if (rightClickedHotbarIndex === null)
		return;
	if (hotbarData[rightClickedHotbarIndex] === null)
		return;
	let atom = AtomFromName(hotbarData[rightClickedHotbarIndex]);
	SendCmd("BAG", { create: { "type": "map_tile", "name": atom.name, "data": hotbarData[rightClickedHotbarIndex] } });
}

function deleteHotbarSlot() {
	if(rightClickedHotbarIndex === null)
		return;
	if (
		confirm(`Really delete hotbar item ${rightClickedHotbarIndex+1}?`)
	) {
		hotbarData[rightClickedHotbarIndex] = null;
		drawHotbar();
	}
}

function editHotbarSlot() {
	if(rightClickedHotbarIndex === null)
		return;
	let data = getDataForDraw();
	if (data === null)
		return;
	let atom = AtomFromName(hotbarData[rightClickedHotbarIndex]);
	editItemID = rightClickedHotbarIndex;
	editItemShared({ "type": "map_tile_hotbar", "name": atom.name, "desc": "", "data": atom });
}

function newTileHotbarSlot() {
	if(rightClickedHotbarIndex === null)
		return;
	editItemID = rightClickedHotbarIndex;
	editItemShared({ "type": "map_tile_hotbar", "name": "", "desc": "", "data": AtomFromName("grass") });
}

function copyHereHotbarSlot() {
	if(rightClickedHotbarIndex === null)
		return;
	let data = getDataForDraw();
	if (data === null)
		return;
	hotbarData[rightClickedHotbarIndex] = data;
	drawHotbar();  
}

///////////////////////////////////////////////////////////
// Animation
///////////////////////////////////////////////////////////

function updateDirectionForAnim(id) {
	if(!PlayerWho[id])
		return;
	let dir = PlayerWho[id].dir;
	if (dir == undefined)
		return;
	if ((dir & 1) == 0) {
		PlayerAnimation[id].lastDirection4 = dir;
	}
	if (dir == Directions.EAST || dir == Directions.WEST) {
		PlayerAnimation[id].lastDirectionLR = dir;
	}
}

function startPlayerWalkAnim(id) {
	PlayerAnimation[id].walkTimer = 5 + 1; // 5*100ms
	NeedMapRedraw = true;
}

function apply_default_pic_for_type(item) {
	if (!item)
		return;
	switch (item.type) {
		default: // dummy
			item.pic = ["#", 7, 2];
			break;
		case "user":
			// make sure a custom pic is in PlayerImages
			// (it won't be for players in other maps)
			let is_custom = item.pic != null && typeof item.pic[0] == "string";
			if ((!(item.id in PlayerImages) && is_custom) ||
				(item.id in PlayerImages && PlayerImages[item.id].src != item.pic[0] && is_custom)) {
				let img = new Image();
				img.src = item.pic[0];
				PlayerImages[item.id] = img;
			}
			break;
		case "generic":
			if (item.pic == null)
				item.pic = ["#", 0, 1];
			break;
		case "map_tile": // object
			// allow for string data like "grass"
			let temp = AtomFromName(item.data);
			if (temp && temp.pic) {
				item.pic = temp.menu_pic ?? temp.pic;
			} else {
				item.pic = ["#", 7, 2];
			}
			break;
		case "text":
			if (item.pic == null)
				item.pic = ["#", 1, 1];
			break;
		case "image":
			if (item.pic == null)
				item.pic = ["#", 2, 1];
			break;
		case "tileset":
			if (item.pic == null)
				item.pic = ["#", 5, 1];
			break;
		case "reference":
			if (item.pic == null)
				item.pic = ["#", 5, 2];
			break;
		case "landmark":
			if (item.pic == null)
				item.pic = ["#", 6, 2];
			break;
		case "gadget":
			if (item.pic == null)
				item.pic = ["#", 3, 1];
			break;
		case "folder":
			if (item.pic == null)
				item.pic = FolderClosedPic;
			break;
		case "map":
			if (item.pic == null)
				item.pic = ["#", 7, 1];
			break;
		case "chatroom":
			if (item.pic == null)
				item.pic = ["#", 6, 1];
			break;
		case "client_data":
			if (item?.data?.type === "command_list" && item.pic == null)
				item.pic = ["#", 4, 1];
			else if (item?.data?.type === "map_tile_list" && item.pic == null)
				item.pic = ["#", 4, 2];
			else if (item.pic == null)
				item.pic = ["#", 7, 2];
			break
	}
}

let previousTimestamp;
let tileAnimationTickTimer = 0; // Counts up until it's been a tenth of a second
function runAnimation(timestamp) {
	if (NeedInventoryUpdate) {
		DisplayInventory = { null: [] };

		for (let key in DBInventory) {
			if (DBInventory[key].type == "map_tile" || DBInventory[key].type == "tileset") { // object or tileset
				if (typeof DBInventory[key].data == "string" &&
					(DBInventory[key].data[0] == '[' || DBInventory[key].data[0] == '{')) // convert from JSON if needed
					DBInventory[key].data = JSON.parse(DBInventory[key].data);
			}

			let updated = DBInventory[key];
			if (updated.folder == PlayerYou)
				updated.folder = null;

			// always reload the picture, for now
			if (true) {
				apply_default_pic_for_type(updated);
			}

			// add to DisplayInventory
			if (updated.folder in DisplayInventory) {
				DisplayInventory[updated.folder].push(key);
			} else {
				DisplayInventory[updated.folder] = [key];
			}

			if(currentBuildCategoryName == "!inventory") {
				changedBuildToolCategory();
			}
		}

		// sort by name, and put folders at the top
		for (let key in DisplayInventory) {
			DisplayInventory[key].sort(function (a, b) {
				if (DBInventory[a].type === "folder" && DBInventory[b].type !== "folder")
					return -1;
				if (DBInventory[a].type !== "folder" && DBInventory[b].type === "folder")
					return 1;
				const name1 = DBInventory[a].name;
				const name2 = DBInventory[b].name;
				return name1.localeCompare(name2);
			});
		}

		updateInventoryUL();
		NeedInventoryUpdate = false;
	}

	if (previousTimestamp === undefined) {
		previousTimestamp = timestamp;
	}
	const deltaTime = timestamp - previousTimestamp;
	previousTimestamp = timestamp;

	tileAnimationTickTimer += deltaTime;
	let tileAnimationTicked = tileAnimationTickTimer >= 100;

	if (tileAnimationTickTimer > 500) // Limit how many times the loop below can go
		tileAnimationTickTimer = 500;
	const animationTimerTarget = SlowAnimationTick ? 400 : 100;
	while (tileAnimationTickTimer >= animationTimerTarget) {
		tileAnimationTickTimer -= animationTimerTarget;

		tenthOfSecondTimer = (tenthOfSecondTimer + 1) % 0x1000000;

		// Tick each player's animation timer
		for (let id in PlayerAnimation) {
			if (PlayerAnimation[id].walkTimer) {
				PlayerAnimation[id].walkTimer--;
				if (!PlayerAnimation[id].walkTimer) {
					needMapRedraw = true;
				}
			}
		}

		// Tick the player build markers and particles
		let removeMarkers = [];
		for (let id in PlayerBuildMarkers) {
			let marker = PlayerBuildMarkers[id];
			marker.timer--;
			if(marker.timer <= 0) {
				removeMarkers.push(id);
			}
		}
		for (let id in removeMarkers) {
			delete PlayerBuildMarkers[removeMarkers[id]];
		}
		let newUserParticles = [];
		for (let particle of UserParticles) {
			particle.timer++;
			if(particle.data.anim_loops !== undefined && ((particle.data.anim_mode ?? 0) < 2) && particle.timer >= ((particle.data.anim_frames ?? 1) * (particle.data.anim_speed ?? 1) * (particle.data.anim_loops+1))) {
				continue;
			}
			if(particle.timer >= particle.data.duration) {
				continue;
			}
			newUserParticles.push(particle);
		}
		UserParticles = newUserParticles;
	}

	let TargetCameraX = ((CameraOverrideX !== null ? CameraOverrideX : PlayerWho[PlayerYou].x) * 16 + 8);
	let TargetCameraY = ((CameraOverrideY !== null ? CameraOverrideY : PlayerWho[PlayerYou].y) * 16 + 8);
	let CameraDifferenceX = TargetCameraX - CameraX;
	let CameraDifferenceY = TargetCameraY - CameraY;
	let CameraDistance = Math.sqrt(CameraDifferenceX * CameraDifferenceX + CameraDifferenceY * CameraDifferenceY);

	if (CameraDistance > 0.5) {
		let OldCameraX = CameraX, OldCameraY = CameraY;
		let AdjustX = 0, AdustY = 0;

		if(InstantCamera) {
			AdjustX = (TargetCameraX - CameraX); // To detect the direction the camera is moving
			AdjustY = (TargetCameraY - CameraY);
			CameraX = TargetCameraX;
			CameraY = TargetCameraY;
		} else {
			let multiplyBy = deltaTime/300;
			if (multiplyBy > 1)
				multiplyBy = 1;
			AdjustX = (TargetCameraX - CameraX) * multiplyBy;
			AdjustY = (TargetCameraY - CameraY) * multiplyBy;

			if (Math.abs(AdjustX) > 0.1)
				CameraX += AdjustX;
			else
				AdjustX = 0;
			if (Math.abs(AdjustY) > 0.1)
				CameraY += AdjustY;
			else
				AdjustY = 0;
		}

		if (!CameraAlwaysCenter) {
			let EdgeLinks = null;
			if ("edge_links" in MyMap.Info)
				EdgeLinks = MyMap.Info["edge_links"];

			let PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
			let PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
			if (PixelCameraX < 0 && (!EdgeLinks || !EdgeLinks[4]))
				CameraX -= PixelCameraX;
			if (PixelCameraY < 0 && (!EdgeLinks || !EdgeLinks[6]))
				CameraY -= PixelCameraY;
			if ((PixelCameraX + mapCanvas.width > MyMap.Width * 16) && (!EdgeLinks || !EdgeLinks[0])) {
				CameraX -= (PixelCameraX + mapCanvas.width) - MyMap.Width * 16;
			}
			if ((PixelCameraY + mapCanvas.height > MyMap.Height * 16) && (!EdgeLinks || !EdgeLinks[2])) {
				CameraY -= (PixelCameraY + mapCanvas.height) - MyMap.Height * 16;
			}

			if (MyMap.Width * 16 <= mapCanvas.width) {
				CameraX = MyMap.Width * 16 / 2;
			}
			if (MyMap.Height * 16 <= mapCanvas.height) {
				CameraY = MyMap.Height * 16 / 2;
			}
		}

		if (AdjustX != 0 || AdjustY != 0) {
			backdropDrawAll = true;

			function markGrid(x, y) {
				const zoneRealGridX = wrapWithin(screenGridX+x, backdropWidthZones);
				const zoneRealGridY = wrapWithin(screenGridY+y, backdropHeightZones);
				const zoneIndex = zoneRealGridY * backdropWidthZones + zoneRealGridX;
				backdropDirtyMap[zoneIndex] = BACKDROP_DIRTY_RENDER;
			}

			const pixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
			const pixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
			const screenGridX = pixelCameraX >> (4+BACKDROP_ZONE_SHIFT);
			const screenGridY = pixelCameraY >> (4+BACKDROP_ZONE_SHIFT);

			// When scrolling, render the part of the map that's scrolling in
			if (AdjustX > 0) {
				if (AdjustX < BACKDROP_ZONE_PIXEL_SIZE*3) {
					for (let column = 0; (backdropWidthZones-column-1) >= 0 && column < Math.ceil(AdjustX / BACKDROP_ZONE_PIXEL_SIZE); column++)
						for (let i=0; i<backdropHeightZones; i++)
							markGrid(backdropWidthZones-column-1, i);
				} else
					backdropRerenderAll = true;
			}
			if (AdjustY > 0) {
				if (AdjustY < BACKDROP_ZONE_PIXEL_SIZE*3) {
					for (let row = 0; (backdropHeightZones-row-1) >= 0 && row < Math.ceil(AdjustY / BACKDROP_ZONE_PIXEL_SIZE); row++)
						for (let i=0; i<backdropWidthZones; i++)
							markGrid(i, backdropHeightZones-row-1);
				} else
					backdropRerenderAll = true;
			}
			if (AdjustX < 0) {
				if (AdjustX > -BACKDROP_ZONE_PIXEL_SIZE*3) {
					for (let column = 0; column < backdropWidthZones && column < Math.ceil(-AdjustX / BACKDROP_ZONE_PIXEL_SIZE); column++)
						for (let i=0; i<backdropHeightZones; i++)
							markGrid(column, i);
				} else
					backdropRerenderAll = true;
			}
			if (AdjustY < 0) {
				if (AdjustY > -BACKDROP_ZONE_PIXEL_SIZE*3) {
					for (let row = 0; row < backdropHeightZones && row < Math.ceil(-AdjustY / BACKDROP_ZONE_PIXEL_SIZE); row++)
						for (let i=0; i<backdropWidthZones; i++)
							markGrid(i, row);
				} else
					backdropRerenderAll = true;
			}
		}

		// The camera movement may cause the tile under the cursor to change
		if(MouseRawPos != null) {
			let underCursor = getTilePosAtPixel(MouseRawPos);
			if(underCursor.x != MouseNowX || underCursor.y != MouseNowY) {
				MouseNowX = underCursor.x;
				MouseNowY = underCursor.y;
				handleDragging(underCursor);
			}
		}

		drawMap();
	} else if (tileAnimationTicked && (entityAnimationEnabled || tileAnimationEnabled)) { // every 0.1 seconds
		drawMap();
	} else if (NeedMapRedraw) {
		drawMap();
	}

	if (waitingOnMapScreenshot) {
		waitingOnMapScreenshot++;
		if (waitingOnMapScreenshot == 300 || allMapImagesLoaded()) {
			openMapScreenshot();
			waitingOnMapScreenshot = 0;
		}
	}

	NeedMapRedraw = false;
	TickCounter = (TickCounter + 1) & 0xffffff; // Currently only used for offline mode simulation of BAG
	alreadyPlayedSound = false;

	window.requestAnimationFrame(runAnimation);
}

function idleChecker() {
	let minutesSinceLastInput = (Date.now() - timeOfLastInput) / 60000;
	let myStatus = PlayerWho?.[PlayerYou]?.status;
	if (myStatus != null) myStatus = myStatus.toLowerCase();
	if (OnlineMode) {
		if (minutesUntilIdle > 0 && minutesSinceLastInput >= minutesUntilIdle && [null, "ic", "ooc", "rp"].includes(myStatus)) {
			statusBeforeIdle = PlayerWho[PlayerYou]?.status;
			statusMessageBeforeIdle = PlayerWho[PlayerYou]?.status_message;
			if(PlayerWho?.[PlayerYou]?.status)
				SendCmd("CMD", {text: "status idle "+PlayerWho[PlayerYou].status});
			else
				SendCmd("CMD", {text: "status idle"});
			PlayerWho[PlayerYou].status = "idle"; 
		}
		if (minutesUntilDisconnect > 0 && minutesSinceLastInput >= minutesUntilDisconnect) {
			SendCmd("CMD", {text: "disconnect"});
		}
	}
}

///////////////////////////////////////////////////////////
// Music
///////////////////////////////////////////////////////////

let libopenmptLoaded = false;
let chiptunejsPlayerObject = undefined;
let currentlyPlayingURL = null;
window['libopenmpt'] = {
	"locateFile": function (filename) {
		return "/js/libopenmpt/" + filename;
	}
};

function initMusic() {
	if (chiptunejsPlayerObject === undefined) {
		chiptunejsPlayerObject = new ChiptuneJsPlayer(new ChiptuneJsConfig(-1));
	} else {
		chiptunejsPlayerObject.stop();
	}
}

function playMusic(url, force) {
	currentlyPlayingURL = url;
	if (!mapMusicEnabled && !force)
		return;

	function play() {
		initMusic();
		chiptunejsPlayerObject.load(url, function(buffer){chiptunejsPlayerObject.play(buffer);});
	}

	if (!playedMusicYet) {
		playedMusicYet = true;
		logMessage('Playing music; you can stop it with <span class="xbbcode-code">/stopmusic</span> or <input type="button" value="Stop music" onclick="stopMusic();"/>', 'server_message',   {'isChat': false});
	}

	if(libopenmptLoaded) {
		play();
	} else {
		libopenmptLoaded = true;
		libopenmpt.onRuntimeInitialized = function () {
			play();
		};

		let script = document.createElement("script");
		script.src = "js/libopenmpt/libopenmpt.js";
		document.head.appendChild(script);
	}
}

function stopMusic() {
	currentlyPlayingURL = null;
	if (chiptunejsPlayerObject !== undefined) {
		chiptunejsPlayerObject.stop();
	}
}

///////////////////////////////////////////////////////////
// User profiles
///////////////////////////////////////////////////////////

function requestViewUserProfile(contextMenuItem) {
	SendCmd("EXT", { "get_user_profile": {"username": contextMenuItem} });
}

function openMiniUserProfileWindow(id, name, desc) {
	const player = PlayerWho[id] || {};
	document.getElementById('userMiniProfileCharacterName').textContent = name || player.name;
	document.getElementById('userMiniProfileCharacterDescription').innerHTML = convertBBCode(desc || player.desc || "").replaceAll("\n", "<br>");
	document.getElementById('viewMiniUserProfileWindow').style.display = "block";
}

let userProfileInformation;
function openUserProfileWindow(info) {
	userProfileInformation = info;

	function empty(s) {
		if (!s)
			return true;
		if (typeof s !== 'string')
			return true;
		if (s.trim().length === 0)
			return true;
		return false;
	}

	function fill_out_table(table, data) {
		while (table.firstChild) {
			table.removeChild(table.firstChild);
		}
		if (!data || (Array.isArray(data) && data.length == [])) {
			table.style.display = "none";
			return;
		}
		table.style.display = "table";

		for(let i = 0; i<data.length/2; i++) {
			if (data[i*2+0].startsWith("_"))
				continue;
			let tr = document.createElement('tr');
			let th = document.createElement('th');
			let td = document.createElement('td');
			th.textContent = data[i*2+0];
			if(data[i*2+1].startsWith("https://") || data[i*2+1].startsWith("http://") || data[i*2+1].startsWith("gemini://") || data[i*2+1].startsWith("secondlife://"))
				td.innerHTML = convertBBCode("[url]"+(data[i*2+1] || "")+"[/url]");
			else
				td.innerHTML = convertBBCode(data[i*2+1]);
			tr.appendChild(th);
			tr.appendChild(td);
			table.appendChild(tr);
		}
	}

	profileTabAbout();
	document.getElementById('profileTabPictureButton').disabled = empty(info.picture_url);
	document.getElementById('profileTabInterestsButton').disabled = empty(info.interests) && empty(info.looking_for);
	document.getElementById('profileTabContactButton').disabled = empty(info.email) && empty(info.website) && !info.contact;
	document.getElementById('profileTabHomeButton').disabled = empty(info.home_name);

	document.getElementById('userProfileName').textContent = info.name || "";
	document.getElementById('userProfileUsername').textContent = info.username || "";
	document.getElementById('userProfilePronouns').textContent = info.pronouns || "";
	document.getElementById('userProfilePronounsDot').style.display = (info.pronouns || "").length ? "inline": "none";
	document.getElementById('userProfileCharacterPronouns').textContent = info.entity_pronouns || "";
	document.getElementById('userProfileCharacterPronounsDot').style.display = (info.entity_pronouns || "").length ? "inline": "none";
	document.getElementById('userProfileCharacterName').textContent = info.entity_name || "";
	document.getElementById('userProfileCharacterDescription').innerHTML = convertBBCode(info.entity_desc || "").replaceAll("\n", "<br>");
	const birthday = info.birthday;
	document.getElementById('userProfileBirthdaySpan').style.display = "inline";
	if (birthday) {
		if(info.age) {
			document.getElementById('userProfileBirthday').textContent = info.birthday + " ("+info.age+" years old)";
		} else {
			document.getElementById('userProfileBirthday').textContent = info.birthday;
		}
	} else if(info.age) {
		document.getElementById('userProfileBirthday').textContent = info.age + " years old";
	} else {
		document.getElementById('userProfileBirthday').textContent = "???";
		document.getElementById('userProfileBirthdaySpan').style.display = "none";
	}
	fill_out_table(document.getElementById('userProfileExtraFields'), info.fields);
	document.getElementById('userProfileAboutText').innerHTML = convertBBCode(info.text || "").replaceAll("\n", "<br>");;
	document.getElementById('userProfilePicturePicture').src = info.picture_url || "";
	document.getElementById('userProfileInterestsInterests').textContent = (info.interests || "").split(',').join(', ');
	document.getElementById('userProfileInterestsInterestsParagraph').style.display = empty(info.interests) ? "none" : "block";
	document.getElementById('userProfileInterestsLookingFor').innerHTML = convertBBCode(info.looking_for || "").replaceAll("\n", "<br>");
	document.getElementById('userProfileInterestsLookingForParagraph').style.display = empty(info.looking_for) ? "none" : "block";

	fill_out_table(document.getElementById('userProfileContactTable'), info.contact);
	if((info.email || "").includes("@"))
		document.getElementById('userProfileContactEmail').innerHTML = convertBBCode("[email]"+(info.email || "")+"[/email]");
	else
		document.getElementById('userProfileContactEmail').textContent = info.email || "";
	document.getElementById('userProfileContactEmailParagraph').style.display = empty(info.email) ? "none" : "block";

	if (info.website)
		document.getElementById('userProfileContactWebsite').innerHTML = convertBBCode("[url]"+(info.website || "")+"[/url]");
	else
		document.getElementById('userProfileContactWebsite').textContent = "";
	document.getElementById('userProfileContactWebsiteParagraph').style.display = empty(info.website) ? "none" : "block";

	document.getElementById('userProfileHomeName').textContent = info.home_name + " (ID: " + info.home[0] + ")";
	document.getElementById('userProfileHomeButton').style.display = info.home ? "block" : "none";
	document.getElementById('userProfileUpdatedAt').textContent = new Date(Date.parse(info.updated_at)).toLocaleDateString();
	document.getElementById('userProfileEditButton').style.display = (PlayerYou == info.id) ? "inline" : "none";

	document.getElementById('viewUserProfileWindow').style.display = "block";
}

function userProfileEdit(new_profile) {
	document.getElementById('viewUserProfileWindow').style.display = "none";

	document.getElementById('editUserProfileCharacterName').value = "";
	document.getElementById('editUserProfileCharacterDesc').value = "";
	document.getElementById('editUserProfileCharacterPronouns').value = "";
	document.getElementById('editUserProfileName').value = "";
	document.getElementById('editUserProfilePronouns').value = "";
	document.getElementById('editUserProfilePictureUrl').value = "";
	document.getElementById('editUserProfileBirthday').value = "";
	document.getElementById('editUserProfileEmail').value = "";
	document.getElementById('editUserProfileWebsite').value = "";
	document.getElementById('editUserProfileInterests').value = "";
	document.getElementById('editUserProfileLookingFor').value = "";
	document.getElementById('editUserProfileHideBirthday').checked = "";
	document.getElementById('editUserProfileHideEmail').checked = "";
	document.getElementById('editUserProfileAbout').value = "";
	document.getElementById('editUserProfileHomeMap').value = "";
	document.getElementById('editUserProfileHomeX').value = "";
	document.getElementById('editUserProfileHomeY').value = "";

	for(let i=0; i<10; i++) {
		document.getElementById('editUserProfileExtraAboutKey'+i).value = "";
		document.getElementById('editUserProfileExtraAboutValue'+i).value = "";
		document.getElementById('editUserProfileExtraContactKey'+i).value = "";
		document.getElementById('editUserProfileExtraContactValue'+i).value = "";
	}

	if (new_profile) {
		document.getElementById('editUserProfileCharacterName').value = PlayerWho[PlayerYou]?.name || "";
		document.getElementById('editUserProfileCharacterDesc').value = PlayerWho[PlayerYou]?.desc || "";
		document.getElementById('editUserProfileCharacterPronouns').value = PlayerWho[PlayerYou]?.who_tags?.pronouns || "";
	} else if(userProfileInformation.id == PlayerYou) {
		let info = userProfileInformation;
		document.getElementById('editUserProfileCharacterName').value = info.entity_name || "";
		document.getElementById('editUserProfileCharacterDesc').value = info.entity_desc || "";
		document.getElementById('editUserProfileCharacterPronouns').value = info.entity_pronouns || "";
		document.getElementById('editUserProfileName').value = info.name || "";
		document.getElementById('editUserProfilePronouns').value = info.pronouns || "";
		document.getElementById('editUserProfilePictureUrl').value = info.picture_url || "";
		document.getElementById('editUserProfileBirthday').value = info.birthday || "";
		document.getElementById('editUserProfileEmail').value = info.email || "";
		document.getElementById('editUserProfileWebsite').value = info.website || "";
		document.getElementById('editUserProfileInterests').value = info.interests || "";
		document.getElementById('editUserProfileLookingFor').value = info.looking_for || "";
		document.getElementById('editUserProfileHideBirthday').checked = info.hide_birthday;
		document.getElementById('editUserProfileHideEmail').checked = info.hide_email;
		document.getElementById('editUserProfileAbout').value = info.text;
		if(info.home && info.home.length >= 1) {
			document.getElementById('editUserProfileHomeMap').value = info.home[0];
			if(info.home.length >= 3) {
				document.getElementById('editUserProfileHomeX').value = info.home[1];
				document.getElementById('editUserProfileHomeY').value = info.home[2];
			}
		}

		if(info.fields) {
			for(let i = 0; i<info.fields.length/2; i++) {
				document.getElementById('editUserProfileExtraAboutKey'+i).value = info.fields[i*2+0];
				document.getElementById('editUserProfileExtraAboutValue'+i).value = info.fields[i*2+1];
			}
		}
		if(info.contact) {
			for(let i = 0; i<info.contact.length/2; i++) {
				document.getElementById('editUserProfileExtraContactKey'+i).value = info.contact[i*2+0];
				document.getElementById('editUserProfileExtraContactValue'+i).value = info.contact[i*2+1];
			}
		}
	}

	document.getElementById('editUserProfileWindow').style.display = "block";
}

function editUserProfileSetHomeHere() {
	document.getElementById('editUserProfileHomeMap').value = MyMap.Info.id ;
	document.getElementById('editUserProfileHomeX').value = PlayerWho[PlayerYou].x;
	document.getElementById('editUserProfileHomeY').value = PlayerWho[PlayerYou].y;
}

function editUserProfileUpdate() {
	function nullIfEmpty(t) {
		t = t.trim();
		if (t === '')
			return null;
		return t;
	}
	const data = {
		"entity_name": document.getElementById('editUserProfileCharacterName').value,
		"entity_desc": document.getElementById('editUserProfileCharacterDesc').value,
		"entity_pronouns": document.getElementById('editUserProfileCharacterPronouns').value,
		"name": nullIfEmpty(document.getElementById('editUserProfileName').value),
		"pronouns": nullIfEmpty(document.getElementById('editUserProfilePronouns').value), 
		"picture_url": nullIfEmpty(document.getElementById('editUserProfilePictureUrl').value),
		"birthday": nullIfEmpty(document.getElementById('editUserProfileBirthday').value),
		"email": nullIfEmpty(document.getElementById('editUserProfileEmail').value),
		"website": nullIfEmpty(document.getElementById('editUserProfileWebsite').value),
		"interests": nullIfEmpty(document.getElementById('editUserProfileInterests').value),
		"looking_for": nullIfEmpty(document.getElementById('editUserProfileLookingFor').value),
		"text": nullIfEmpty(document.getElementById('editUserProfileAbout').value),
		"hide_birthday": document.getElementById('editUserProfileHideBirthday').checked,
		"hide_email": document.getElementById('editUserProfileHideEmail').checked,
	};
	const home = parseInt(document.getElementById('editUserProfileHomeMap').value);
	const homeX = parseInt(document.getElementById('editUserProfileHomeX').value);
	const homeY = parseInt(document.getElementById('editUserProfileHomeY').value);
	if(!Number.isNaN(home) && (Number.isNaN(homeX) || Number.isNaN(homeY)))
		data.home = [home];
	if(!Number.isNaN(home) && !Number.isNaN(homeX) && !Number.isNaN(homeY))
		data.home = [home, homeX, homeY];
	const fields = [];
	const contact = [];
	for(let i=0; i<10; i++) {
		let key1 = document.getElementById('editUserProfileExtraAboutKey'+i).value.trim();
		let val1 = document.getElementById('editUserProfileExtraAboutValue'+i).value.trim();
		let key2 = document.getElementById('editUserProfileExtraContactKey'+i).value.trim();
		let val2 = document.getElementById('editUserProfileExtraContactValue'+i).value.trim();
		if(key1 && val1) {
			fields.push(key1);
			fields.push(val1);
		}
		if(key2 && val2) {
			contact.push(key2);
			contact.push(val2);
		}
	}
	data["fields"] = fields;
	data["contact"] = contact;
	SendCmd("EXT", { "set_user_profile": data });
	document.getElementById('editUserProfileWindow').style.display = "none";
}

function editUserProfileDeleteProfile() {
	if(confirm("Really delete your user profile?")) {
		SendCmd("EXT", { "delete_user_profile": {} });
		document.getElementById('editUserProfileWindow').style.display = "none";
	}
}

function profileTabAbout() {
	document.getElementById('userProfileAbout').style.display = "block";
	document.getElementById('userProfilePicture').style.display = "none";
	document.getElementById('userProfileInterests').style.display = "none";
	document.getElementById('userProfileContact').style.display = "none";
	document.getElementById('userProfileHome').style.display = "none";
}
function profileTabPicture() {
	document.getElementById('userProfileAbout').style.display = "none";
	document.getElementById('userProfilePicture').style.display = "block";
	document.getElementById('userProfileInterests').style.display = "none";
	document.getElementById('userProfileContact').style.display = "none";
	document.getElementById('userProfileHome').style.display = "none";
}
function profileTabInterests() {
	document.getElementById('userProfileAbout').style.display = "none";
	document.getElementById('userProfilePicture').style.display = "none";
	document.getElementById('userProfileInterests').style.display = "block";
	document.getElementById('userProfileContact').style.display = "none";
	document.getElementById('userProfileHome').style.display = "none";
}
function profileTabContact() {
	document.getElementById('userProfileAbout').style.display = "none";
	document.getElementById('userProfilePicture').style.display = "none";
	document.getElementById('userProfileInterests').style.display = "none";
	document.getElementById('userProfileContact').style.display = "block";
	document.getElementById('userProfileHome').style.display = "none";
}
function profileTabHome() {
	document.getElementById('userProfileAbout').style.display = "none";
	document.getElementById('userProfilePicture').style.display = "none";
	document.getElementById('userProfileInterests').style.display = "none";
	document.getElementById('userProfileContact').style.display = "none";
	document.getElementById('userProfileHome').style.display = "block";
}
function userProfileGoToHome() {
	SendCmd("CMD", {"text": "map "+userProfileInformation.home.join(" ")});
}

///////////////////////////////////////////////////////////
// Initial setup
///////////////////////////////////////////////////////////

function buildMenuZoom() {
	redrawBuildCanvas();
}

function itemEditZoom() {
	document.getElementById('itemEditTilePickerWindow').style.display = 'block';
	document.getElementById('itemEditTilePickerWindowImg').src = document.getElementById('edittilesheetselect').src;
	document.getElementById('itemEditTilePickerWindowImg').style.width = (2 * document.getElementById('edittilesheetselect').naturalWidth) + "px";
	document.getElementById('itemEditTilePickerWindowImg').style.height = (2 * document.getElementById('edittilesheetselect').naturalHeight) + "px";
}

function updateBuildToolCategoriesAvailable() {
	let categorySelect = document.getElementById('buildToolCategory');

	// Empty out the list
	while (categorySelect.childElementCount > 2) {
		categorySelect.removeChild(categorySelect.lastChild);
	}

	for(let e of Object.keys(buildCategories)) {
		el = document.createElement("option");
		el.textContent = e;
		el.value = e;
		categorySelect.appendChild(el);
	}
}

function changedBuildToolCategory() {
	buildMenuSelectIndex = null;
	currentBuildCategoryName = document.getElementById('buildToolCategory').value;
	if(currentBuildCategoryName == "!global") {
		currentBuildCategoryArrayNames = GlobalTilesArrayNames;
	} else if(currentBuildCategoryName == "!inventory") {
		currentBuildCategoryArrayNames = [];
		for (let i in DBInventory) {
			if (DBInventory[i].type == "map_tile" && DBInventory[i].data) {
				currentBuildCategoryArrayNames.push(DBInventory[i].data);
			} else if (DBInventory[i].type == "client_data" && DBInventory[i]?.data && DBInventory[i]?.data?.type === "map_tile_list" && DBInventory[i]?.data?.data?.length) {
				for (let tile of DBInventory[i].data.data) {
					currentBuildCategoryArrayNames.push(tile);
				}
			} else if (DBInventory[i].type == "tileset" && DBInventory[i].data) {
				for (let tile in DBInventory[i].data) {
					currentBuildCategoryArrayNames.push(i + ":" + tile);
				}
			}
		}
	} else {
		currentBuildCategoryArrayNames = buildCategories[currentBuildCategoryName] ?? [];
		if(typeof currentBuildCategoryArrayNames === 'string') {
			let tileset = currentBuildCategoryArrayNames;
			currentBuildCategoryArrayNames = [];
			for (let i in Tilesets[tileset]) {
				currentBuildCategoryArrayNames.push(tileset + ":" + i);
			}
		}
	}

	redrawBuildCanvas();
}

function redrawBuildCanvas() {
	let canvas = document.getElementById('inventoryCanvas');
	// add click action
	canvas = document.getElementById('inventoryCanvas');
	let Zoomed = document.getElementById("zoom-build-menu").checked;
	let BuildWidth = (Zoomed && touch_mode) ? 8 : 16;

	let len = Object.keys(currentBuildCategoryArrayNames).length;
	canvas.width = (BuildWidth * 16) + "";
	canvas.height = (Math.ceil(len / BuildWidth) * 16) + "";
	canvas.style.width = (canvas.width * (1 + Zoomed)) + "px";
	canvas.style.height = (canvas.height * (1 + Zoomed)) + "px";

	let ctx = canvas.getContext("2d");
	ctx.clearRect(0, 0, canvas.width, canvas.height);

	let count = 0;
	for (let i in currentBuildCategoryArrayNames) {
		let item = AtomFromName(currentBuildCategoryArrayNames[i]);
		let pic = item.menu_pic ?? item.pic;
		if (pic[0] in IconSheets)
			ctx.drawImage(IconSheets[pic[0]], pic[1] * 16, pic[2] * 16, 16, 16, (count % BuildWidth) * 16, Math.floor(count / BuildWidth) * 16, 16, 16);

		if(i == buildMenuSelectIndex) {
			ctx.beginPath();
			ctx.globalAlpha = 0.75;
			ctx.lineWidth = "2";
			ctx.strokeStyle = "black";
			ctx.rect((count % BuildWidth) * 16, Math.floor(count / BuildWidth) * 16, 16, 16);
			ctx.stroke();
			ctx.globalAlpha = 1;
		}

		count++;
	}
}

function viewInit() {
	let selector = document.getElementById("selector");
	selector.width = Math.max(240, parseInt(mapCanvas.style.width)) + "";
	drawHotbar();
	NeedMapRedraw = true;
}

function initBuild() {
	redrawBuildCanvas();

	let canvas = document.getElementById('inventoryCanvas');
	let BuildWidth = 16;

	canvas.addEventListener('mousedown', function (evt) {
		let pos = getMousePosRaw(inventoryCanvas, evt);
		let Zoomed = document.getElementById("zoom-build-menu").checked;
		let BuildWidth = (Zoomed && touch_mode) ? 8 : 16;
		let Shift = Zoomed ? 5 : 4;
		pos.x = pos.x >> Shift;
		pos.y = pos.y >> Shift;
		let index = pos.y * BuildWidth + pos.x;

		if(evt.button == 0) {
			if (buildTool == BUILD_TOOL_SELECT) {
				useItem({ type: 'map_tile', data: window['currentBuildCategoryArrayNames'][index] });
			} else if(buildTool == BUILD_TOOL_DRAW) {
				tileDataForDraw = window['currentBuildCategoryArrayNames'][index];
				setBuildMenuSelectIndex(index);
			}
		}
	}, false);

	canvas.addEventListener('contextmenu', function (evt) {
		let pos = getMousePosRaw(inventoryCanvas, evt);
		let Zoomed = document.getElementById("zoom-build-menu").checked;
		let BuildWidth = (Zoomed && touch_mode) ? 8 : 16;
		let Shift = Zoomed ? 5 : 4;
		pos.x = pos.x >> Shift;
		pos.y = pos.y >> Shift;
		let index = pos.y * BuildWidth + pos.x;
		rightClickedBuildTile = window['currentBuildCategoryArrayNames'][index];

		let menu = document.querySelector('#build-contextmenu');
		menu.style.left = (evt.clientX-CONTEXT_MENU_OPEN_OFFSET) + "px";
		menu.style.top = (evt.clientY-CONTEXT_MENU_OPEN_OFFSET) + "px";
		menu.style.display = "block";
		evt.preventDefault();
		showCopyToTilesetLiIfNeeded("copyBuildToTilesetLi");
	}, false);
}

function initWorld() {
	// initialize the world map
	initMap();

	document.getElementById('loginMapID').value = OnlineMap ? OnlineMap : "";

	chatInput = document.getElementById("chatInput");
	mapCanvas = document.getElementById("map");
	backdropCanvas = document.createElement("canvas");

	chatInput.addEventListener('input', function (evt) {
		sendTyping();
	});

	chatInput.addEventListener('blur', function (evt) {
		sendTyping();
	});

	chatInput.addEventListener('focusout', function (evt) {
		if (evt.relatedTarget) {
			if (evt.relatedTarget.tagName === "A") {
				focusChatBarOnTabBack = true;
			}
		}
	});

	document.getElementById("commandlistsearch").addEventListener("keydown", function(event) {
		if (event.key === "Enter")
			refreshCommandList();
	});
	document.getElementById("tileset_search").addEventListener("keydown", function(event) {
		if (event.key === "Enter")
			refreshTilesetList();
	});

	for (let i of ["loginuser", "loginpass", "loginserver", "loginnick", "loginMapID"])
		document.getElementById(i).addEventListener("keydown", function(event) {
			if (event.key === "Enter" && !document.getElementById("connectButton").disabled)
				loginButton();
		});
	viewInit();

	panel = document.getElementById("panel");
	panel.innerHTML = "";

	initMouse();

	window.onresize = resizeCanvas;
	resizeCanvas();

	// applies saved options from browser form fill (or from local storage)
	loadOptions();
	applyOptions();
	changeBuildTool();
	changedBuildToolCategory();

	initBuild();

	window.requestAnimationFrame(runAnimation);
	window.setInterval(idleChecker, 1000);
	if (OnlineServer) {
		ConnectToServer();
	}

	{
		// Set up the login window
		// Get the modal
		let loginmodal = document.getElementById('loginWindow');
		let itemmodal = document.getElementById('editItemWindow');
		let newitemmodal = document.getElementById('newItemWindow');
		let mapmodal = document.getElementById('mapOptionsWindow');
		let newfilemodal = document.getElementById('newFileWindow');
		let newfoldermodal = document.getElementById('newFolderWindow');
		let editfilemodal = document.getElementById('editFileWindow');
		let editfoldermodal = document.getElementById('editFolderWindow');
		let itemedittilepickermodal = document.getElementById('itemEditTilePickerWindow');

		let btn = document.getElementById("navlogin");
		let mapbtn = document.getElementById("navmap");
		let span = document.getElementsByClassName("modalclose");

		// Prefill the login window username if it is saved
		const saved_username = localStorage.getItem("username");
		if (saved_username) {
			document.getElementById("loginuser").value = saved_username;
			loginHelpAccount();
		}

		btn.onclick = function () {
			loginmodal.style.display = "block";
		}

		mapbtn.onclick = function () {
			if (OnlineMode) {
				document.getElementById('map_window_online').style.display = "block";
				document.getElementById('map_window_offline').style.display = "none";

				document.getElementById('mapname').value = MyMap.Info.name ?? "";
				document.getElementById('mapdesc').value = MyMap.Info.desc ?? "";
				document.getElementById('mapowner').value = MyMap.Info.owner_username ?? "";
				document.getElementById('mapid').value = MyMap.Info.id;
				document.getElementById('shareMapLink').href = "/map/"+MyMap.Info.id;
				document.getElementById('permission_build').checked = true;
				document.getElementById('permission_object_entry').checked = true;
				document.getElementById('permission_persistent_object').checked = true;
				document.getElementById('permission_topic').checked = true;

				document.getElementById('mapprivacy').value = "?";
				if (!MyMap.Info['private'] && MyMap.Info['public'])
					document.getElementById('mapprivacy').value = "public";
				else if (!MyMap.Info['private'] && !MyMap.Info['public'])
					document.getElementById('mapprivacy').value = "unlisted";
				else if (MyMap.Info['private'] && !MyMap.Info['public'])
					document.getElementById('mapprivacy').value = "private";

				let map_deny = MyMap.Info.default_deny ?? [];
				document.getElementById('permission_build').checked = !map_deny.includes('build');
				document.getElementById('permission_object_entry').checked = !map_deny.includes('object_entry');
				document.getElementById('permission_persistent_object').checked = !map_deny.includes('persistent_object_entry');
				document.getElementById('permission_topic').checked = !map_deny.includes('set_topic');
			} else {
				document.getElementById('localMapWidth').value = MyMap.Width;
				document.getElementById('localMapHeight').value = MyMap.Height;
				refreshLocalMapList();
				document.getElementById('map_window_online').style.display = "none";
				document.getElementById('map_window_offline').style.display = "block";
			}
			mapmodal.style.display = "block";
		}

		for (var i = 0; i < span.length; i++) {
			span[i].onclick = function () {
				loginmodal.style.display = "none";
				newitemmodal.style.display = "none";
				itemmodal.style.display = "none";
				mapmodal.style.display = "none";
				newfilemodal.style.display = "none";
				newfoldermodal.style.display = "none";
				editfilemodal.style.display = "none";
				editfoldermodal.style.display = "none";
				itemedittilepickermodal.style.display = "none";
				if(!loadedBuiltInTilesetYet && !OnlineMode && Object.keys(GlobalTiles).length <= 4) {
					loadedBuiltInTilesetYet = true;
					let script = document.createElement("script");
					script.src = "js/predefined.js";
					document.head.appendChild(script);
				}
			}
		}

		window.onclick = function (event) {
			if (event.target == loginmodal) {
				loginmodal.style.display = "none";
				if(!loadedBuiltInTilesetYet && !OnlineMode && Object.keys(GlobalTiles).length <= 4) {
					loadedBuiltInTilesetYet = true;
					let script = document.createElement("script");
					script.src = "js/predefined.js";
					document.head.appendChild(script);
				}
			} else if (event.target == newitemmodal) {
				newitemmodal.style.display = "none";
			} else if (event.target == mapmodal) {
				mapmodal.style.display = "none";
			} else if (event.target == newfilemodal) {
				newfilemodal.style.display = "none";
			} else if (event.target == newfoldermodal) {
				newfoldermodal.style.display = "none";
			} else if (event.target == editfilemodal) {
				editfilemodal.style.display = "none";
			} else if (event.target == editfoldermodal) {
				editfoldermodal.style.display = "none";
			} else if (event.target == itemedittilepickermodal) {
				itemedittilepickermodal.style.display = "none";
			}
		}

		if (!OnlineServer) {
			// Open the login window by default
			loginmodal.style.display = "block";
		}
	}
}

document.addEventListener("visibilitychange", (event) => {
	if (document.visibilityState == "visible") {
		backdropRerenderAll = true;
		NeedMapRedraw = true;
		if (focusChatBarOnTabBack) {
			chatInput.focus();
			focusChatBarOnTabBack = false;
		}
		for (let notification of activeNotifications) {
			notification.close();
		}
		activeNotifications = [];
	}
});
