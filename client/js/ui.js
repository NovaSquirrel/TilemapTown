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

///////////////////////////////////////////////////////////
// Global variables
///////////////////////////////////////////////////////////

// The client's entity ID
let PlayerYou = "me";

// The list of entities on the map
let PlayerWho = { me: { name: "Player", pic: [0, 2, 25], x: 5, y: 5, dir: 2, passengers: [] } };

// Walk through walls?
let Fly = false;

// Dictionary of Image objects
let PlayerImages = {}; // For entities
let PlayerMiniTilemapImages = {}; // For entities' mini tilemaps

// Dictionary of animation statuses
let PlayerAnimation = {
  "me": {
    "walkTimer": 0,// Amount of ticks where the player should be animated as walking
    "lastDirectionLR": 0, // Most recent direction the entity used that was left or right
    "lastDirection4": 0, // Most recent direction the entity used that was left, right, up or down
  }
}

let PlayerBuildMarkers = {}; // EntityID: {pos: [x,y], name: string, timer: ticks, del: true/false}

// Camera settings
// Note that CameraX and CameraY are the pixel coordinates of the *center* of the screen, rather than the top left
let CameraX = 0;
let CameraY = 0;
let CameraAlwaysCenter = true;

let CameraScale = 3;
const CameraScaleMin = 1;
const CameraScaleMax = 8;

// Audio settings
let AudioChatNotifications = true;
let AudioMiscNotifications = false;
let mapMusicEnabled = false;

// document elements
let mapCanvas = null; // main map view
let selCanvas = null; // selector
let chatInput = null;
let panel = null;

let NeedMapRedraw = false;
let NeedInventoryUpdate = false;
let TickCounter = 0;   // Goes up every 20ms, wraps at 0x1000000 (hex)
let AnimationTick = 0; // Goes up every 20ms, wraps at 1000000 (decimal)
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

let chatTimestamps = true;
let lockZoomLevel = false;

let FileStorageInfo = null;

///////////////////////////////////////////////////////////

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

function resizeCanvas() {
	let parent = mapCanvas.parentNode;
	let r = parent.getBoundingClientRect();
	mapCanvas.width = r.width / CameraScale;
	mapCanvas.height = r.height / CameraScale;

	drawMap();
	drawHotbar();
}



///////////////////////////////////////////////////////////
// Button handlers 🦨
///////////////////////////////////////////////////////////

function sendPrivateMessageToItem(id) {
  setChatInput("/tell "+id+" ");
}

function applyOptions() {
	CameraAlwaysCenter = document.getElementById("alwayscenter").checked;
	AudioChatNotifications = document.getElementById("audiochatnotify").checked;
	AudioMiscNotifications = document.getElementById("audiomiscnotify").checked;
	Fly = document.getElementById("option-fly").checked;
	entityAnimationEnabled = document.getElementById("option-entity-animation").checked;
	tileAnimationEnabled = document.getElementById("option-tile-animation").checked;
	chatTimestamps = document.getElementById("chat-timestamp").checked;
	lockZoomLevel = document.getElementById("lock-zoom-level").checked;

	let mapMusicPreviouslyEnabled = mapMusicEnabled;
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
		"entity_animation": entityAnimationEnabled,
		"tile_animation": tileAnimationEnabled,
		"chat_timestamps": chatTimestamps,
		"lock-zoom-level": lockZoomLevel,
	};
	localStorage.setItem("options", JSON.stringify(saved_options));
}

function zoomIn() {
	CameraScale = Math.min(Math.max(CameraScaleMin, CameraScale + 0.25), CameraScaleMax);
	resizeCanvas();
	updateZoomLevelDisplay();
}

function zoomOut() {
	CameraScale = Math.min(Math.max(CameraScaleMin, CameraScale - 0.25), CameraScaleMax);
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
	let options = document.getElementById("options");
	let Hidden = (options.style.display == 'none');
	document.getElementById("navoptions").setAttribute("class", Hidden ? "navactive" : "");
	options.style.display = Hidden ? 'block' : 'none';
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
}

function viewInventory() {
	let inventory = document.getElementById('inventory');
	if(toggleDisplay(inventory)) {
		let ul = document.getElementById('inventoryul');
		updateInventoryUL();
	}
}

function viewBuild() {
	toggleDisplay(document.getElementById('build'));
}

function viewCustomize() {
	let options = document.getElementById("character");
	let Hidden = (options.style.display == 'none');
	document.getElementById("navcustomize").setAttribute("class", Hidden ? "navactive" : "");
	options.style.display = Hidden ? 'block' : 'none';
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
	// sort by name or date later
	for (let key in DisplayFiles) {
		DisplayFiles[key].sort(function (a, b) { return a - b });
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
				setItemCardImage(li, picIcon(FolderOpenPic));
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

	OnlineUsername = document.getElementById("loginuser").value;
	OnlinePassword = document.getElementById("loginpass").value;
	OnlineServer = document.getElementById("loginserver").value;
	if (!OnlineIsConnected)
		ConnectToServer();
	else
		SendCmd("CMD", { text: "login " + OnlineUsername + " " + OnlinePassword });

	// Save the username so that in the future it is prefilled
	localStorage.setItem("username", OnlineUsername);

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



///////////////////////////////////////////////////////////
// Inventory
///////////////////////////////////////////////////////////

const FolderOpenPic = [0, 2, 20];
const FolderClosedPic = [0, 1, 20];

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
			status_span.innerText = `${item.status} (${item.status_message})`;
		else
			status_span.innerText = `${item.status}`;
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
	let src = "";

	if (IconSheets[pic[0]])
		src = IconSheets[pic[0]].src;
	else
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
	let src = "";

	let item = (typeof key === 'object') ? key : (DBInventory[key] || PlayerWho[key]);
	if (item === undefined) {
		console.log("Tried to get icon for "+key+" which doesn't exist");
		item = {"name": "?"};
	}

	// allow custom avatars
	// as well as built-in ones
	pic = [0, 8, 24];

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
	else
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
		confirm(`Really delete ${item.name} with ID ${item.id}?`)
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
function copyTurfToHotbar() {
	let tile;
	if(withinCurrentMap(turfContextMenuX, turfContextMenuY)) {
		tile = MyMap.Tiles[turfContextMenuX][turfContextMenuY];
	} else {
		return;
	}
	addTileToHotbar(tile);
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
	menu.style.left = (x) + "px";
	menu.style.top = (y) + "px";
	menu.style.display = "block";
}

let turfContextMenuX, turfContextMenuY;
function openTurfContextMenu(map_x, map_y, x, y) {
	turfContextMenuX = map_x;
	turfContextMenuY = map_y;
	let menu = document.querySelector('#turf-contextmenu');
	menu.style.left = (x) + "px";
	menu.style.top = (y) + "px";
	menu.style.display = "block";	
}

let contextMenuItem = 0;
function openItemContextMenu(id, x, y) {
	let drop = document.querySelector('#droptakeitem');

	copyItemToHotbarLi.style.display = "none";
	if (id in DBInventory) {
		drop.innerText = "Drop";
	if(DBInventory[id].type == "map_tile")
		copyItemToHotbarLi.style.display = "block";
	} else {
		drop.innerText = "Take";
	}
	let menu = document.querySelector('#item-contextmenu');
	menu.style.left = (x) + "px";
	menu.style.top = (y) + "px";

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

function viewTileset(Item) {
	let tileset = document.getElementById('tileset');
	toggleDisplay(tileset);

	let tileset_title = document.getElementById('tileset-title');
	tileset_title.innerText = "Tileset: " + Item.name;
}



///////////////////////////////////////////////////////////
// Item editing
///////////////////////////////////////////////////////////

let editItemType = null;
let editItemID = null;
let editItemOriginalSheet = null; // Original tileset image that the tile's pic was set to before the edit

function editItemShared(item) {
	let itemobj = null;
	editItemType = item.type;
	document.getElementById('edittileautotileoptions').style.display = "none";
	document.getElementById('edittileobject').style.display = "none";
	document.getElementById('edittiletext').style.display = "none";
	document.getElementById('edittileimage').style.display = "none";
	document.getElementById('edittilename').value = item.name;
	if(editTypeIsDirectEdit(item.type)) {
		document.getElementById('description_or_message').textContent = "Message";
		document.getElementById('edittiledesc').value = item?.data?.message ?? "";
	} else {
		document.getElementById('description_or_message').textContent = "Description";
		document.getElementById('edittiledesc').value = item.desc ?? "";
	}
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

		case "generic":
		case "map_tile_hotbar":
		case "map_tile_mapobj_edit":
		case "map_tile_turf_edit":
		case "map_tile":
			if (item.type == "map_tile" || item.type == "map_tile_hotbar" || item.type == "map_tile_mapobj_edit" || item.type == "map_tile_turf_edit") {
				document.getElementById('edittileautotileoptions').style.display = "block";
				itemobj = AtomFromName(item.data);
				if (itemobj == null) {
					itemobj = { pic: [0, 8, 24] };
				}
			} else {
				if ("pic" in item)
					itemobj = { pic: item.pic };
				else
					itemobj = { pic: [0, 8, 24] };
			}
			editItemOriginalSheet = itemobj.pic[0];

			// Display all the available images assets in the user's inventory
			let sheetselect = document.getElementById("edittilesheet");
			while (sheetselect.firstChild) {
				sheetselect.removeChild(sheetselect.firstChild);
			}
			el = document.createElement("option");
			el.textContent = "Don't change";
			el.value = "keep";
			sheetselect.appendChild(el);

			// Display the global images; TODO: don't hardcode the amount of them
			for(let i=0; i>=-3; i--) {
				el = document.createElement("option");
				el.textContent = GlobalImageNames[i];
				el.value = i;
				sheetselect.appendChild(el);
			}

			// Now display everything in the inventory
			for (let i in DBInventory) {
				if (DBInventory[i].type == "image") {
					el = document.createElement("option");
					el.textContent = DBInventory[i].name;
					el.value = DBInventory[i].id;
					sheetselect.appendChild(el);
				}
			}
			// Probably also allow just typing in something?

			document.getElementById('edittilemaptile').style.display = (item.type == "map_tile" || item.type == "map_tile_hotbar" || item.type == "map_tile_mapobj_edit" || item.type == "map_tile_turf_edit") ? "block" : "none";
			document.getElementById('edittileobject').style.display = "block";
			document.getElementById('edittilesheet').value = "keep";
			document.getElementById('edittilex').value = itemobj.pic[1];
			document.getElementById('edittiley').value = itemobj.pic[2];
			document.getElementById('edittileautotile').value = (itemobj.autotile_layout ?? 0).toString();
			document.getElementById('edittileautotileclass').value = itemobj.autotile_class ?? "";

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
	editItemShared(item);
}

function editTypeIsDirectEdit(type) {
	return type == "map_tile_hotbar" || type == "map_tile_mapobj_edit" || type == "map_tile_turf_edit";
}

function editItemApply() {
	let edittilename = document.getElementById('edittilename').value;
	let edittiledesc = document.getElementById('edittiledesc').value;
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

		case "map_tile_turf_edit":
		case "map_tile_mapobj_edit":
		case "map_tile_hotbar":
		case "map_tile":
		case "generic":
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
			let edittiletype = document.getElementById('edittiletype').value;
			let edittiledensity = document.getElementById('edittiledensity').checked;
			let edittileobject = !document.getElementById('edittileisobject').checked;
			let edittileover = document.getElementById('edittileover').checked;
			let edittileautotile = parseInt(document.getElementById('edittileautotile').value);
			let edittileautotileclass = document.getElementById('edittileautotileclass').value;

			let edittileanimationmode = parseInt(document.getElementById('edittileanimationmode').value);
			let edittileanimationframes = parseInt(document.getElementById('edittileanimationframes').value);
			let edittileanimationspeed = parseInt(document.getElementById('edittileanimationspeed').value);
			let edittileanimationoffset = parseInt(document.getElementById('edittileanimationoffset').value);

			updates.pic = [edittilesheet, edittilex, edittiley];

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
					}
					// Update the selection window
					if(MouseActive && MouseStartX == turfContextMenuX && MouseStartY == turfContextMenuY && MouseStartX == MouseEndX && MouseStartY == MouseEndY) {
						updateSelectedTurfUL(MouseStartX, MouseStartY);
					}
				}
			}

			if(editItemType === "map_tile" || editItemType === "generic") {
				SendCmd("BAG", { update: updates });
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
	SendCmd("BAG", params);
	newItemCancel();
}

function newItemCancel() {
	document.getElementById('newItemWindow').style.display = "none";
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
	menu.style.left = (x) + "px";
	menu.style.top = (y) + "px";
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
	menu.style.left = (x) + "px";
	menu.style.top = (y) + "px";
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
	document.getElementById('compose').style.display = 'block';
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

		li.appendChild(document.createTextNode("\"" + letter.subject + "\" from " + letter.from));
		if (!(letter.flags & 1)) {
			li.appendChild(document.createTextNode(" (NEW)"));
		}

		li.onclick = function () {
			SendCmd("EML", { read: letter.id });
			Mail[i].flags |= 1; // mark as read locally
			updateMailUL(); // show it as read locally

			document.getElementById('mail-view').style.display = 'block';
			document.getElementById('mail-view-title').innerHTML = `Mail: ${convertBBCode(letter.subject)}`;
			document.getElementById('mail-view-contents').innerHTML = '<button onclick="replyMail(' + letter.id + ')">Reply</button>'
				+ '<button onclick="replyAllMail(' + letter.id + ')">Reply all</button>'
				+ '<button onclick="deleteMail(' + letter.id + ')">Delete</button><br>'
				+ '<table border="0">'
				+ '<tr><td>From</td><td>' + letter.from + '</td></tr>'
				+ '<tr><td>To</td><td>' + letter.to.join(",") + '</td></tr>'
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

	document.getElementById('mail-preview').style.display = 'block';
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

	viewCompose();
	document.getElementById('mailsendsubject').value = "RE: " + Mail[index].subject;
	document.getElementById('mailsendtext').value = "";
	document.getElementById('mailsendto').value = Mail[index]["from"];
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

  viewCompose();
  document.getElementById('mailsendsubject').value = "RE: " + Mail[index].subject;
  document.getElementById('mailsendtext').value = "";

  // add everyone to the list except yourself
  let to_list = [Mail[index]["from"]];
  for (let i = 0; i < Mail[index]["to"].length; i++) {
    if (Mail[index]["to"][i] != PlayerWho[PlayerYou].username)
      to_list.push(Mail[index]["to"][i]);
  }
  document.getElementById('mailsendto').value = to_list.join(",");
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
  closeWindow("mail" + id);
}

function viewMail() {
  var mail = document.getElementById('mail');
  toggleDisplay(mail);

  var ul = document.getElementById('mailul');
  if (!ul) {
    newWindow("Mail", '<button onclick="viewCompose();">Compose</button><br/><ul id="mailul" class="unselectable"></ul>', null);
  }
  updateMailUL();
}


///////////////////////////////////////////////////////////
// BBCode and messages
///////////////////////////////////////////////////////////

let chatLogForExport = [];

function escape_tags(t) {
	return t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

let dateFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: 'numeric', hour12: true });
let alreadyPlayedSound = false;
function logMessage(Message, Class, Params) {
	Params = Params ?? {};
	let chatArea = document.getElementById("chatArea");
	let bottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight<3;

	let timestampText = "";
	if (chatTimestamps) {
		let currentDate = new Date();
		timestampText = dateFormat.format(currentDate);
	}

	let newMessage = document.createElement("div");
	newMessage.className = Class;
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

	if (!alreadyPlayedSound) {
		if ((Params.isChat || Params.isPrivateChat) && AudioChatNotifications) {
			if (!Params.isSilent) {
				let audio = new Audio(Params.isPrivateChat ? 'img/notifyprivate.wav' : 'img/notifychat.wav');
				audio.play();
				alreadyPlayedSound = true;
			}
		} else if (!Params.isChat && AudioMiscNotifications) {
			if (!Params.isSilent) {
				let audio = new Audio('img/notifymisc.wav');
				audio.play();
				alreadyPlayedSound = true;
			}
		}
	}

	if (Params.plainText && Class !== "secret_message") {
		chatLogForExport.push((timestampText.length ? (`[${timestampText}] `) : "") + Params.plainText);
	}
}

function offerCommand(t) {
	if (confirm('Run command "' + t + '"?')) {
		sendChatCommand(t);
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
		drawText(ctx, i * oneWidth, 0, ((i + 1) % 10) + "");
    
		if(i < hotbarData.length) {
			let item = AtomFromName(hotbarData[i]);
			if(item) {
				let pic = item.menu_pic ?? item.pic;
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
	}
}

function copyBuildToHotbar() {
	addTileToHotbar(rightClickedBuildTile);
}

function copyItemToHotbar(id) {
	if(!(id in DBInventory))
		return;
	let item = DBInventory[id];
	if(item.type != 'map_tile')
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
	if ((dir & 1) == 0) {
		PlayerAnimation[id].lastDirection4 = dir;
	}
	if (dir == Directions.EAST || dir == Directions.WEST) {
		PlayerAnimation[id].lastDirectionLR = dir;
	}
}

function startPlayerWalkAnim(id) {
	PlayerAnimation[id].walkTimer = 25 + 1; // 25*(20ms/1000) = 0.5
	NeedMapRedraw = true;
}

function tickWorld() {
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
				switch (updated.type) {
					default: // dummy
						updated.pic = [0, 8, 24];
						break;
					case "user":
						// make sure a custom pic is in PlayerImages
						// (it won't be for players in other maps)
						let is_custom = updated.pic != null && typeof updated.pic[0] == "string";
						if ((!(updated.id in PlayerImages) && is_custom) ||
							(updated.id in PlayerImages && PlayerImages[updated.id].src != updated.pic[0] && is_custom)) {
							let img = new Image();
							img.src = pic[0];
							PlayerImages[key] = img;
						}
						break;
					case "generic":
						if (updated.pic == null)
							updated.pic = [0, 8, 24];
						break;
					case "map_tile": // object
						// allow for string data like "grass"
						let temp = AtomFromName(updated.data);
						if (temp && temp.pic) {
							updated.pic = temp.menu_pic ?? temp.pic;
						} else {
							updated.pic = [0, 8, 24];
						}
						break;
					case "text":
						if (updated.pic == null)
							updated.pic = [0, 0, 24];
						break;
					case "image":
						if (updated.pic == null)
							updated.pic = [0, 11, 20];
						break;
					case "tileset":
						if (updated.pic == null)
							updated.pic = [0, 19, 18];
						break;
					case "reference":
						if (updated.pic == null)
							updated.pic = [0, 9, 22];
						break;
				}
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

		// sort by name or date later
		for (let key in DisplayInventory) {
			DisplayInventory[key].sort(function (a, b) { return a - b });
		}

		updateInventoryUL();
		NeedInventoryUpdate = false;
	}

	// Tick each player's animation timer
	for (let id in PlayerAnimation) {
		if (PlayerAnimation[id].walkTimer) {
			PlayerAnimation[id].walkTimer--;
			if (!PlayerAnimation[id].walkTimer) {
				needMapRedraw = true;
			}
		}
	}

	// Tick the player build markers
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

	let TargetCameraX = (PlayerWho[PlayerYou].x * 16 + 8);
	let TargetCameraY = (PlayerWho[PlayerYou].y * 16 + 8);
	let CameraDifferenceX = TargetCameraX - CameraX;
	let CameraDifferenceY = TargetCameraY - CameraY;
	let CameraDistance = Math.sqrt(CameraDifferenceX * CameraDifferenceX + CameraDifferenceY * CameraDifferenceY);

	if (CameraDistance > 0.5) {
		let DivideBy = InstantCamera ? 1 : 16;
		let AdjustX = (TargetCameraX - CameraX) / DivideBy;
		let AdjustY = (TargetCameraY - CameraY) / DivideBy;

		if (Math.abs(AdjustX) > 0.1)
			CameraX += AdjustX;
		if (Math.abs(AdjustY) > 0.1)
			CameraY += AdjustY;

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
	} else if (AnimationTick % 5 == 0) { // every 0.1 seconds
		drawMap();
	} else if (NeedMapRedraw) {
		drawMap();
	}

	NeedMapRedraw = false;
	TickCounter = (TickCounter + 1) & 0xffffff;
	if(!SlowAnimationTick || ((TickCounter & 7) == 0)) {
		AnimationTick = (AnimationTick + 1) % 1000000;
	}
	alreadyPlayedSound = false;
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
// Initial setup
///////////////////////////////////////////////////////////

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
	let BuildWidth = 16;

	let len = Object.keys(currentBuildCategoryArrayNames).length;
	canvas.width = (BuildWidth * 16) + "";
	canvas.height = (Math.ceil(len / BuildWidth) * 16) + "";
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
		pos.x = pos.x >> 4;
		pos.y = pos.y >> 4;
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
		pos.x = pos.x >> 4;
		pos.y = pos.y >> 4;
		let index = pos.y * BuildWidth + pos.x;
		rightClickedBuildTile = window['currentBuildCategoryArrayNames'][index];

		let menu = document.querySelector('#build-contextmenu');
		menu.style.left = (evt.clientX) + "px";
		menu.style.top = (evt.clientY) + "px";
		menu.style.display = "block";
		evt.preventDefault();
	}, false);
}

function initWorld() {
	// initialize the world map
	initMap();

	chatInput = document.getElementById("chatInput");
	mapCanvas = document.getElementById("map");

	chatInput.addEventListener('input', function (evt) {
		if (this.value.length > 0) {
			sendTyping(true);
		}
	});

	chatInput.addEventListener('blur', function (evt) {
		sendTyping(false);
	});

	viewInit();

	panel = document.getElementById("panel");
	panel.innerHTML = "";

	initMouse();

	window.onresize = resizeCanvas;
	resizeCanvas();

	// applies saved options from browser form fill (or from local storage)
	let saved_options = localStorage.getItem("options");
	if (saved_options) {
		saved_options = JSON.parse(saved_options);
		document.getElementById("alwayscenter").checked = saved_options.always_center_camera ?? false;
		document.getElementById("audiochatnotify").checked = saved_options.audio_chat_notify ?? true;
		document.getElementById("audiomiscnotify").checked = saved_options.audio_misc_notify ?? false;
		document.getElementById("audiomapmusic").checked = saved_options.audio_map_music ?? false;
		document.getElementById("option-entity-animation").checked = saved_options.entity_animation ?? true;
		document.getElementById("option-tile-animation").checked = saved_options.tile_animation ?? true;
		document.getElementById("chat-timestamp").checked = saved_options.chat_timestamps ?? true;
	}
	applyOptions();
	changeBuildTool();
	changedBuildToolCategory();

	initBuild();

	window.setInterval(tickWorld, 20);
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

		let btn = document.getElementById("navlogin");
		let mapbtn = document.getElementById("navmap");
		let span = document.getElementsByClassName("modalclose");

		// Prefill the login window username if it is saved
		const saved_username = localStorage.getItem("username");
		if (saved_username) {
			document.getElementById("loginuser").value = saved_username;
		}

		btn.onclick = function () {
			loginmodal.style.display = "block";
		}

		mapbtn.onclick = function () {
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
			}
		}

		window.onclick = function (event) {
			if (event.target == loginmodal) {
				loginmodal.style.display = "none";
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
			}
		}

		if (!OnlineServer) {
			// Open the login window by default
			loginmodal.style.display = "block";
		}
	}
}
