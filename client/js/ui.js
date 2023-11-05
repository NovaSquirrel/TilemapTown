/*
 * Tilemap Town
 *
 * Copyright (C) 2017-2023 NovaSquirrel
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
let PlayerYou = "me";
let PlayerWho = { me: { name: "Player", pic: [0, 2, 25], x: 5, y: 5, dir: 2, passengers: [] } };
let PlayerImages = {}; // dictionary of Image objects
let PlayerAnimation = { // dictionary of animation statuses
  "me": {
    "walkTimer": 0,// amount of ticks where the player should be animated as walking
    "lastDirectionLR": 0, //last direction that was set that is left or right
    "lastDirection4": 0, //last direction that was set that is left, right, up or down
  }
}
let PlayerBuildMarkers = {}; // id: {pos, name, timer, del}
let PlayerMiniTilemapImages = {}; // directory of Image objects

var Mail = [];

// camera settings
// CameraX and CameraY are the pixel coordinates of the *center* of the screen, rather than the top left
var CameraX = 0;
var CameraY = 0;
var CameraAlwaysCenter = true;
var Fly = false;

var CameraScale = 1;

// other settings
var AudioChatNotifications = true;
var AudioMiscNotifications = false;

// mouse stuff
var MouseDown = false;
var MouseStartX = -1;
var MouseStartY = -1;
var MouseEndX = -1;
var MouseEndY = -1;
var MouseNowX = -1;
var MouseNowY = -1;
var MouseActive = false; // is there a selection right now?
var MousedOverPlayers = [];
var MousedOverEntityClickAvailable = false;
var MousedOverEntityClickId = null;
var MousedOverEntityClickIsTilemap = false;
var MousedOverEntityClickX = undefined;
var MousedOverEntityClickY = undefined;
var ShiftPressed = false;
var MouseRawPos = null;

// document elements
var mapCanvas = null; // main map view
var selCanvas = null; // selector
var chatInput = null;
var panel = null;

var NeedMapRedraw = false;
var NeedInventoryUpdate = false;
var TickCounter = 0;   // Goes up every 20ms, wraps at 0x10000 (hex)
var AnimationTick = 0; // Goes up every 20ms, wraps at 10000 (decimal)
var DisplayInventory = { null: [] }; // Indexed by folder
var DBInventory = {}; // Indexed by ID

const FolderOpenPic = [0, 2, 20];
const FolderClosedPic = [0, 1, 20];

const CameraScaleMin = 1;
const CameraScaleMax = 8;

var chatLogForExport = [];

const BUILD_TOOL_SELECT = 0;
const BUILD_TOOL_DRAW = 1;
let buildTool = BUILD_TOOL_SELECT;
let rightClickedBuildTile = null;
let rightClickedHotbarIndex = null;
let tileDataForDraw = null;

let hotbarData = [null, null, null, null, null, null, null, null, null, null];
let hotbarSelectIndex = null;
let hotbarDragging = false;

let buildMenuSelectIndex = null;
let drawToolX = null, drawToolY = null;
let drawToolCurrentStroke = {}; // All the tiles currently being drawn on, indexed by x,y
let drawToolCurrentStrokeIsObj = false;
let drawToolUndoHistory = [];
let ctrlZUndoType = null;

// take_controls feature
let takeControlsEnabled = false;
let takeControlsPassOn = false;
let takeControlsKeyUp = false;
let takeControlsId = null;
let takeControlsKeys = new Set();

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

function escape_tags(t) {
  return t.replace("<", "&lt;").replace(">", "&gt;").replace("&", "&amp;");
}

function convertBBCodeMultiline(t) {
  var result = XBBCODE.process({
    text: t,
    removeMisalignedTags: false,
    addInLineBreaks: true
  });
  return result.html;
}

function convertBBCode(t) {
  var result = XBBCODE.process({
    text: t,
    removeMisalignedTags: false,
    addInLineBreaks: false
  });
  return result.html;
}

function logMessage(Message, Class, Params) {
  if (Params === undefined) {
    Params = {};
  }
  var chatArea = document.getElementById("chatArea");
  var bottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight<3;

  let newMessage = document.createElement("div");
  newMessage.className = Class;
  newMessage.innerHTML = Message;
  chatArea.append(newMessage);

  if (bottom)
    chatArea.scrollTop = chatArea.scrollHeight;

  if ((Params.isChat || Params.isPrivateChat) && AudioChatNotifications) {
    if (!Params.isSilent) {
      var audio = new Audio(Params.isPrivateChat ? 'img/notifyprivate.wav' : 'img/notifychat.wav');
      audio.play();
    }
  } else if (!Params.isChat && AudioMiscNotifications) {
    if (!Params.isSilent) {
      var audio = new Audio('img/notifymisc.wav');
      audio.play();
    }
  }
  if (Params.plainText) {
    chatLogForExport.push(Params.plainText);
  }
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
  if (PlayerWho[PlayerYou].typing != isTyping) {
    SendCmd("WHO", { update: { id: PlayerYou, typing: isTyping } });
    PlayerWho[PlayerYou].typing = isTyping;
    drawMap();
  }
}

function PlayersAroundTile(FindX, FindY, Radius) {
  var Found = [];
  for (var index in PlayerWho) {
    if (index == PlayerYou)
      continue;
    var Mob = PlayerWho[index];
    var Distance = Math.pow(Mob.x - FindX, 2) + Math.pow(Mob.y - FindY, 2);
    if (Distance <= Radius * Radius)
      Found.push(index);
  }
  return Found;
}

function editItemUpdatePic() {
  var edittilesheet = document.getElementById('edittilesheet').value;
  var edittilex = parseInt(document.getElementById('edittilex').value);
  var edittiley = parseInt(document.getElementById('edittiley').value);

  var src = "";
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

let editItemType = null;
let editItemID = null;
let editItemOriginalSheet = null; // Original tileset image that the tile's pic was set to before the edit
function editItem(key) {
  // open up the item editing screen for a given item
  var item = DBInventory[key] || PlayerWho[key];
  editItemID = item.id;
  editItemShared(item);
}

function editItemShared(item) {
  let itemobj = null;
  editItemType = item.type;
  document.getElementById('edittileobject').style.display = "none";
  document.getElementById('edittiletext').style.display = "none";
  document.getElementById('edittileimage').style.display = "none";
  document.getElementById('edittilename').value = item.name;
  document.getElementById('edittiledesc').value = item.desc;
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
    case "map_tile":
      if (item.type == "map_tile" || item.type == "map_tile_hotbar") {
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
      var sheetselect = document.getElementById("edittilesheet");
      while (sheetselect.firstChild) {
        sheetselect.removeChild(sheetselect.firstChild);
      }
      el = document.createElement("option");
      el.textContent = "Don't change";
      el.value = "keep";
      sheetselect.appendChild(el);
      el = document.createElement("option");
      el.textContent = "Potluck";
      el.value = 0;
      sheetselect.appendChild(el);
      el = document.createElement("option");
      el.textContent = "Extras";
      el.value = -1;
      sheetselect.appendChild(el);

      // Now display everything in the inventory
      for (var i in DBInventory) {
        if (DBInventory[i].type == "image") {
          el = document.createElement("option");
          el.textContent = DBInventory[i].name;
          el.value = DBInventory[i].id;
          sheetselect.appendChild(el);
        }
      }
      // Probably also allow just typing in something?

      document.getElementById('edittilemaptile').style.display = (item.type == "map_tile" || item.type == "map_tile_hotbar") ? "block" : "none";
      document.getElementById('edittileobject').style.display = "block";
      document.getElementById('edittilesheet').value = "keep";
      document.getElementById('edittilex').value = itemobj.pic[1];
      document.getElementById('edittiley').value = itemobj.pic[2];
      var index_for_type = 0;
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

function useItemAtXY(Placed, x, y) {
  if(x < 0 || y < 0 || x >= MyMap.Width || y >= MyMap.Height)
    return undefined;
  let old = null;

  switch (Placed.type) {
    case "tileset": // tileset
      viewTileset(Placed);
      console.log("Open tileset thing");
      break;
    case "map_tile": // object
      var ActualAtom = AtomFromName(Placed.data);
      // place the item on the ground
      if (ActualAtom.obj) {
        if (ActualAtom.type == AtomTypes.SIGN) {
          MouseDown = false; // Don't keep placing signs
          Placed = { data: CloneAtom(ActualAtom) };
          Message = prompt("What should the sign say?");
          if (Message == null)
            return;
          Placed.data.message = Message;
        }
        old = [...MyMap.Objs[x][y]];
        MyMap.Objs[x][y].push(Placed.data);
        SendCmd("PUT", { pos: [x, y], obj: true, atom: MyMap.Objs[x][y] });
      } else {
        old = MyMap.Tiles[x][y];
        MyMap.Tiles[x][y] = Placed.data;
        SendCmd("PUT", { pos: [x, y], obj: false, atom: MyMap.Tiles[x][y] });
      }
      drawMap();
  }
  return old;
}


function useItem(Placed) {
  return useItemAtXY(Placed, PlayerWho[PlayerYou].x, PlayerWho[PlayerYou].y);
}

function moveItem(id) {
  var window = document.getElementById('moveItem');
  toggleDisplay(window);

  var source = document.getElementById('movesourceul');
  var target = document.getElementById('movetargetul');

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
  var item = DBInventory[id] || PlayerWho[id];

  if (
    confirm(`Really delete ${item.name} with ID ${item.id}?`)
  ) {
    SendCmd("BAG", { delete: { id: id } });
  }
}

function sendPrivateMessageToItem(id) {
  setChatInput("/tell "+id+" ");
}

function copyBuildToHotbar() {
  addTileToHotbar(rightClickedBuildTile);
}

function copyBuildToInventory() {
  SendCmd("BAG", { create: { "type": "map_tile", "name": rightClickedBuildTile, "data": rightClickedBuildTile } });
}

function copyItemToHotbar(id) {
  if(!(id in DBInventory))
    return;
  var item = DBInventory[id];
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

function referenceItem(id) {
  var item = DBInventory[id] || PlayerWho[id];
  SendCmd("BAG", { create: { name: `${item.name} (reference)`, type: "reference", data: `${id}` } });
}

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

function movePlayer(id, x, y, dir) {
  for (var index of PlayerWho[id].passengers) {
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

function getDataForDraw() {
  if(hotbarSelectIndex !== null) {
    if(hotbarSelectIndex < hotbarData.length)
      return hotbarData[hotbarSelectIndex];
  } else if(tileDataForDraw)
    return tileDataForDraw;
  return null;
}

function runLocalCommand(t) {
  if (t.toLowerCase() == "/clear") {
    chatArea.innerHTML = "";
    chatLogForExport = [];
    return true;
  } else if (t.toLowerCase() == "/exportmap" || t.toLowerCase() == "/mapexport") {
    //logMessage('<a href="data:,'+encodeURIComponent(exportMap())+'" download="map.txt">Map download (click here)</a>', 'server_message');

    //from https://ourcodeworld.com/articles/read/189/how-to-create-a-file-and-generate-a-download-with-javascript-in-the-browser-without-a-server
    var element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(exportMap()));
    element.setAttribute('download', "map.txt");
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    return true;
  } else if (t.toLowerCase() == "/releasekeys") {
    forceReleaseKeys();
    return true;
  } else if (t.toLowerCase() == "/exportlogs" || t.toLowerCase() == "/exportlog") {
    // https://stackoverflow.com/a/4929629
    var today = new Date();
    var dd = String(today.getDate()).padStart(2, '0');
    var mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
    var yyyy = today.getFullYear();
    today = yyyy + '-' + mm + '-' + dd;

    var element = document.createElement('a');
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
	switch(e.code) {
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
  var e = e || window.event;
  ShiftPressed = e.shiftKey;
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

function keyDownHandler(e) {

  function ClampPlayerPos() {
    PlayerX = Math.min(Math.max(PlayerX, 0), MyMap.Width - 1);
    PlayerY = Math.min(Math.max(PlayerY, 0), MyMap.Height - 1);
  }

  var e = e || window.event;
  ShiftPressed = e.shiftKey;

  // ignore keys when typing in a textbox
  if (document.activeElement.tagName == "INPUT" || document.activeElement.tagName == "TEXTAREA") {
    if (document.activeElement == chatInput && e.keyCode == 13) {
      // First, check for commands that are local to the client
      if (runLocalCommand(chatInput.value));
      // commands are CMD while regular room messages are MSG. /me is a room message.
      else if (chatInput.value.slice(0, 1) == "/" &&
        chatInput.value.toLowerCase().slice(0, 4) != "/me " &&
        chatInput.value.toLowerCase().slice(0, 5) != "/ooc " &&
        chatInput.value.toLowerCase().slice(0, 7) != "/spoof ") {
        SendCmd("CMD", { text: chatInput.value.slice(1) }); // remove the /
      } else if (chatInput.value.length > 0) {
        SendCmd("MSG", { text: chatInput.value });
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

  var needRedraw = false;

  var PlayerX = PlayerWho[PlayerYou].x;
  var PlayerY = PlayerWho[PlayerYou].y;
  var PlayerDir = PlayerWho[PlayerYou].dir;
  var OldPlayerX = PlayerX;
  var OldPlayerY = PlayerY;
  var Bumped = false, BumpedX = null, BumpedY = null;
  var OldPlayerDir = PlayerWho[PlayerYou].dir;

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
    var n = e.keyCode - 48;
    n = (n - 1) % 10;
    if (n < 0)
      n = 9;
    setHotbarIndex(n);
    /*
    // if there's no item, stop
    if (!DisplayInventory[null][n])
      return;
    useItem(DisplayInventory[null][n]);
    */
  } else if (e.code == "ArrowUp" || e.code == "KeyW") { // up/w
    PlayerY--;
    PlayerDir = Directions.NORTH;
    e.preventDefault();
  } else if (e.code == "ArrowDown" || e.code == "KeyS") { // down/s
    PlayerY++;
    PlayerDir = Directions.SOUTH;
    e.preventDefault();
  } else if (e.code == "ArrowLeft" || e.code == "KeyA") { // left/a
    PlayerX--;
    PlayerDir = Directions.WEST;
    e.preventDefault();
  } else if (e.code == "ArrowRight" || e.code == "KeyD") { // right/d
    PlayerX++;
    PlayerDir = Directions.EAST;
    e.preventDefault();
  } else if (e.code == "End") { // end
    PlayerX--;
    PlayerY++;
    PlayerDir = Directions.SOUTHWEST;
    e.preventDefault();
  } else if (e.code == "PageDown") { // pg down
    PlayerX++;
    PlayerY++;
    PlayerDir = Directions.SOUTHEAST;
    e.preventDefault();
  } else if (e.code == "Home") { // home
    PlayerX--;
    PlayerY--;
    PlayerDir = Directions.NORTHWEST;
    e.preventDefault();
  } else if (e.code == "PageUp") { // pg up
    PlayerX++;
    PlayerY--;
    PlayerDir = Directions.NORTHEAST;
    e.preventDefault();
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

  var BeforeClampX = PlayerX, BeforeClampY = PlayerY;
  ClampPlayerPos();
  if (PlayerX != BeforeClampX || PlayerY != BeforeClampY) {
    Bumped = true;
    BumpedX = BeforeClampX;
    BumpedY = BeforeClampY;
  }

  // Go back if the turf is solid, or if there's objects in the way
  if (OldPlayerX != PlayerX || OldPlayerY != PlayerY) {
    // Check for solid objects in the way first
    for (var index in MyMap.Objs[PlayerX][PlayerY]) {
      var Obj = AtomFromName(MyMap.Objs[PlayerX][PlayerY][index]);
      if (Obj.density) {
        if (!Fly) {
          if (!Bumped) {
            Bumped = true;
            BumpedX = PlayerX;
            BumpedY = PlayerY;
          }
          PlayerX = OldPlayerX;
          PlayerY = OldPlayerY;
        }
        if (Obj.type == AtomTypes.SIGN) {
          // Filter out HTML tag characters to prevent XSS (not needed because convertBBCode does this)
          /*
                    var Escaped = "";
                    for (var i = 0; i < Obj.message.length; i++) {
                      var c =Obj.message.charAt(i);
                      if(c == '&') {
                        Escaped += "&amp;";
                      } else if(c == '<') {
                        Escaped += "&lt;";
                      } else if(c == '>') {
                        Escaped += "&gt;";
                      } else {
                        Escaped += c;
                      }
                    }
          */
          botMessageButton = null;
          logMessage(((Obj.name != "sign" && Obj.name != "") ? escape_tags(Obj.name) + " says: " : "The sign says: ") + convertBBCode(Obj.message), "server_message",
            {'plainText': (Obj.name != "sign" && Obj.name != "") ? Obj.name + " says: " : "The sign says: " + Obj.message});
        }
        break;
      }
    }
    // Then check for turfs
    if (!Fly && AtomFromName(MyMap.Tiles[PlayerX][PlayerY]).density) {
      if (!Bumped) {
        Bumped = true;
        BumpedX = PlayerX;
        BumpedY = PlayerY;
      }
      PlayerX = OldPlayerX;
      PlayerY = OldPlayerY;
    }
  }

  if (Bumped || OldPlayerX != PlayerX || OldPlayerY != PlayerY || OldPlayerDir != PlayerDir) {
    var Params = { 'dir': PlayerDir };
    if (e.shiftKey) {
      SendCmd("MOV", Params);
      movePlayer(PlayerYou, null, null, PlayerDir);
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
      movePlayer(PlayerYou, PlayerX, PlayerY, PlayerDir);
    }
  }

  if (needRedraw)
    drawMap();
}
document.onkeydown = keyDownHandler;
document.onkeyup = keyUpHandler;

var edgeMapLookupTable = [
  null, // durl - invalid
  4,    // durL
  0,    // duRl
  null, // duRL - invalid
  6,    // dUrl
  5,    // dUrL
  7,    // dURl
  null, // dURL - invalid
  2,    // Durl
  3,    // DurL
  1,    // DuRl
];
// Render the map view
function drawMap() {
  var canvas = mapCanvas;
  var ctx = canvas.getContext("2d");

  // Clear to black
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Calculate camera pixel coordinates
  var ViewWidth = Math.floor(canvas.width / 16);
  var ViewHeight = Math.floor(canvas.height / 16);
  var PixelCameraX = Math.round(CameraX - canvas.width / 2);
  var PixelCameraY = Math.round(CameraY - canvas.height / 2);
  var OffsetX = PixelCameraX & 15;
  var OffsetY = PixelCameraY & 15;
  var TileX = PixelCameraX >> 4;
  var TileY = PixelCameraY >> 4;

  var EdgeLinks = null;
  if ("edge_links" in MyMap.Info)
    EdgeLinks = MyMap.Info["edge_links"];

  var objectsWithOverFlag = []; // X, Y, [pic_sheet, pic_x, pic_y]

  // Render the map
  for (x = 0; x < (ViewWidth + 2); x++) {
    for (y = 0; y < (ViewHeight + 2); y++) {
      try {
        ctx.globalAlpha = 1;
        var mapCoordX = x + TileX;
        var mapCoordY = y + TileY;
        var map = MyMap;

        // Out-of-bounds tiles may be on another map
        var edgeLookupIndex = (mapCoordX < 0) * 1 + (mapCoordX >= MyMap.Width) * 2 +
          (mapCoordY < 0) * 4 + (mapCoordY >= MyMap.Height) * 8;
        if (edgeLookupIndex != 0) {
          if (EdgeLinks == null)
            continue;
          var map = MapsByID[EdgeLinks[edgeMapLookupTable[edgeLookupIndex]]];
          if (map == null)
            continue;
          var gradientHorizontal = 1;
          var gradientVertical = 1;
          if (edgeLookupIndex & 1) { // Left
            gradientHorizontal = 0.5 - (-Math.floor(mapCoordX / 2) + 1) * 0.025;
            mapCoordX = map.Width + mapCoordX;
          }
          if (edgeLookupIndex & 2) { // Right
            mapCoordX -= MyMap.Width;
            gradientHorizontal = 0.5 - Math.floor(mapCoordX / 2) * 0.025;
          }
          if (edgeLookupIndex & 4) { // Above
            gradientVertical = 0.5 - (-Math.floor(mapCoordY / 2) + 1) * 0.025;
            mapCoordY = map.Height + mapCoordY;
          }
          if (edgeLookupIndex & 8) { // Below
            mapCoordY -= MyMap.Height;
            gradientVertical = 0.5 - Math.floor(mapCoordY / 2) * 0.025;
          }
          if (mapCoordX < 0 || mapCoordX >= map.Width || mapCoordY < 0 || mapCoordY >= map.Height)
            continue;
          ctx.globalAlpha = Math.max(0, Math.min(gradientHorizontal, gradientVertical));
          if (ctx.globalAlpha == 0)
            continue;
        }

        // Draw the turf
        let Tile = AtomFromName(map.Tiles[mapCoordX][mapCoordY]);
        if (Tile) {
          if (IconSheets[Tile.pic[0]]) {
            ctx.drawImage(IconSheets[Tile.pic[0]], Tile.pic[1] * 16, Tile.pic[2] * 16, 16, 16, x * 16 - OffsetX, y * 16 - OffsetY, 16, 16);
          } else {
            RequestImageIfNeeded(Tile.pic[0]);
          }
        }
        // Draw anything above the turf (the tile objects)
        var Objs = map.Objs[mapCoordX][mapCoordY];
        if (Objs) {
          for (var index in Objs) {
            var Obj = AtomFromName(Objs[index]);
            if (IconSheets[Obj.pic[0]]) {
              if(Obj.over === true) {
                objectsWithOverFlag.push([x * 16 - OffsetX, y * 16 - OffsetY, Obj.pic]);
              } else {
                ctx.drawImage(IconSheets[Obj.pic[0]], Obj.pic[1] * 16, Obj.pic[2] * 16, 16, 16, x * 16 - OffsetX, y * 16 - OffsetY, 16, 16);
              }
            } else {
              RequestImageIfNeeded(Obj.pic[0]);
            }
          }
        }
      } catch (error) {
      }
    }
  }
  // Draw entities normally
  ctx.globalAlpha = 1;

  // Draw the map link edges
  if (EdgeLinks != null) {
    ctx.beginPath();
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = "2";
    ctx.strokeStyle = "green";
    ctx.rect(0 - PixelCameraX, 0 - PixelCameraY, MyMap.Width * 16, MyMap.Height * 16);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Draw the entities, including the player

  function draw32x32Player(who, frameX, frameY) {
    var Mob = PlayerWho[who];
    var offset = Mob.offset ?? [0,0];
    ctx.drawImage(PlayerImages[who], frameX * 32, frameY * 32, 32, 32, (Mob.x * 16 - 8) - PixelCameraX + offset[0], (Mob.y * 16 - 16) - PixelCameraY + offset[1], 32, 32);
  }

  var sortedPlayers = [];
  for (var index in PlayerWho) {
    sortedPlayers.push(index);
  }
  sortedPlayers.sort(
    (a, b) => {
      if (PlayerWho[a].passengers.includes(parseInt(b))) {
        return -1;
      } else if (PlayerWho[b].passengers.includes(parseInt(a))) {
        return 1;
      }
      return (PlayerWho[a].y > PlayerWho[b].y) ? 1 : -1;
    }
  );

  for (var sort_n in sortedPlayers) {
    try {
      var index = sortedPlayers[sort_n];

      var Mob = PlayerWho[index];
      if(
        (Mob.x < (TileX-3)) ||
        (Mob.y < (TileY-3)) ||
        (Mob.x > (TileX+ViewWidth+3)) ||
        (Mob.y > (TileY+ViewHeight+3))
      )
		continue;

      var IsMousedOver = false;
      for (var look = 0; look < MousedOverPlayers.length; look++) {
        if (MousedOverPlayers[look] == index) {
          IsMousedOver = true;
          break;
        }
      }

      var MobOffset = Mob.offset ?? [0,0];
      var playerIs16x16 = false;
      if (index in PlayerImages) {
        let tilesetWidth = PlayerImages[index].naturalWidth;
        let tilesetHeight = PlayerImages[index].naturalHeight;
        if (tilesetWidth == 32 && tilesetHeight == 32) {
          draw32x32Player(index, 0, 0);
        } else if (tilesetWidth == 16 && tilesetHeight == 16) {
          ctx.drawImage(PlayerImages[index], 0, 0, 16, 16, (Mob.x * 16) - PixelCameraX + MobOffset[0], (Mob.y * 16) - PixelCameraY + MobOffset[1], 16, 16);
          playerIs16x16 = true;
        } else {
          let frameX = 0, frameY = 0;
          let frameCountFromAnimationTick = Math.floor(AnimationTick / 5);
          let isWalking = PlayerAnimation[index].walkTimer != 0;

          switch (tilesetHeight / 32) { // Directions
            case 2:
              frameY = Math.floor(PlayerAnimation[index].lastDirectionLR / 4);
              break;
            case 4:
              frameY = Math.floor(PlayerAnimation[index].lastDirection4 / 2);
              break;
            case 8:
              frameY = Mob.dir;
              break;
          }

          switch (tilesetWidth / 32) { // Frames per direction
            case 2:
              frameX = isWalking * 1;
              break;
            case 4:
              frameX = (isWalking * 2) + (frameCountFromAnimationTick & 1);
              break;
            case 6:
              frameX = (isWalking * 3) + (frameCountFromAnimationTick % 3);
              break;
            case 8:
              frameX = (isWalking * 4) + (frameCountFromAnimationTick & 3);
              break;
          }

          draw32x32Player(index, frameX, frameY);
          //      } else { // Sheet of 32x32 images
          //        ctx.drawImage(PlayerImages[index], Mob.pic[1]*32, Mob.pic[2]*32, 32, 32, (Mob.x*16-8)-PixelCameraX, (Mob.y*16-16)-PixelCameraY, 32, 32);
        }

      } else {
        pic = Mob.pic;
        if (pic == null)
          pic = [0, 8, 24];
        if (pic[0] in IconSheets)
          ctx.drawImage(IconSheets[pic[0]], pic[1] * 16, pic[2] * 16, 16, 16, (Mob.x * 16) - PixelCameraX + MobOffset[0], (Mob.y * 16) - PixelCameraY + MobOffset[1], 16, 16);
        playerIs16x16 = true;
      }

      var heightForPlayerStatus = (playerIs16x16 ? 16 : 28);

      // Mini tilemap, if it's present
      try {
      if(Mob.mini_tilemap && Mob.mini_tilemap_data && index in PlayerMiniTilemapImages && (Mob.mini_tilemap.visible ?? true)) {
        let mini_tilemap_map_w = Mob.mini_tilemap.map_size[0];
        let mini_tilemap_map_h = Mob.mini_tilemap.map_size[1];
        let mini_tilemap_tile_w = Mob.mini_tilemap.tile_size[0];
        let mini_tilemap_tile_h = Mob.mini_tilemap.tile_size[1];
        let mini_tilemap_offset = Mob.mini_tilemap.offset ?? [0,0];
        let mini_tilemap_transparent_tile = Mob.mini_tilemap.transparent_tile ?? 0;
        let mini_tilemap_data = Mob.mini_tilemap_data.data;
        let mini_tilemap_tileset = PlayerMiniTilemapImages[index];

        let data_index = 0;
        let data_value;
        let data_count = 0;
        let start_pixel_x = Math.round((Mob.x * 16) - PixelCameraX + MobOffset[0] + mini_tilemap_offset[0] + 8  - (mini_tilemap_map_w * mini_tilemap_tile_w) / 2);
        let start_pixel_y = Math.round((Mob.y * 16) - PixelCameraY + MobOffset[1] + mini_tilemap_offset[1] + 16 - (mini_tilemap_map_h * mini_tilemap_tile_h));

        for(let mini_y = 0; mini_y < mini_tilemap_map_h; mini_y++) {
          for(let mini_x = 0; mini_x < mini_tilemap_map_w; mini_x++) {
            if(!data_count) {
              if(data_index >= mini_tilemap_data.length)
                break;
              data_value = mini_tilemap_data[data_index++];
              data_count = ((data_value >> 12) & 127) + 1;
            }
            if((data_value & 4095) != mini_tilemap_transparent_tile) {
              ctx.drawImage(mini_tilemap_tileset,
                (data_value & 63) * mini_tilemap_tile_w, ((data_value >> 6) & 63) * mini_tilemap_tile_h,
                mini_tilemap_tile_w, mini_tilemap_tile_h,
                start_pixel_x + mini_x * mini_tilemap_tile_w,
                start_pixel_y + mini_y * mini_tilemap_tile_h,
                mini_tilemap_tile_w, mini_tilemap_tile_h);
            }
            data_count--;
          }
        }
      }
      } catch (error) {
      }

      // typing indicators
      if (Mob.typing) {
        ctx.drawImage(IconSheets[0], 0, 24 * 16, 16, 16, (Mob.x * 16) - PixelCameraX + MobOffset[0], (Mob.y * 16) - PixelCameraY - heightForPlayerStatus + MobOffset[1], 16, 16);
      }

      // carry text and nametags
      if (IsMousedOver && !(!Mob.is_following && Mob.vehicle)) {
        if (Mob.passengers.length > 0) {
          drawText(ctx, (Mob.x * 16) - PixelCameraX - (Mob.name.length * 8 / 2 - 8) + MobOffset[0], (Mob.y * 16) - PixelCameraY - heightForPlayerStatus - 8 + MobOffset[1], Mob.name);
          var carryNames = [];
          for (var passenger_index of Mob.passengers) {
            carryNames.push(PlayerWho[passenger_index].name);
          }
          var carryText = "carrying: " + carryNames.join(", ");

          drawText(ctx, (Mob.x * 16) - PixelCameraX - (carryText.length * 8 / 2 - 8) + MobOffset[0], (Mob.y * 16) - PixelCameraY - heightForPlayerStatus + MobOffset[1], carryText);
        } else if(!MousedOverEntityClickAvailable || !MousedOverEntityClickIsTilemap || (MousedOverEntityClickId != index)) {
          drawText(ctx, (Mob.x * 16) - PixelCameraX - (Mob.name.length * 8 / 2 - 8) + MobOffset[0], (Mob.y * 16) - PixelCameraY - heightForPlayerStatus + MobOffset[1], Mob.name);
        }
      }
    } catch (error) {
    }
  }

  // Draw objects that should appear above players
  for (let i=0; i<objectsWithOverFlag.length; i++) {
    let pic = objectsWithOverFlag[i][2];
    ctx.drawImage(IconSheets[pic[0]], pic[1] * 16, pic[2] * 16, 16, 16, objectsWithOverFlag[i][0], objectsWithOverFlag[i][1], 16, 16);
  }

  // Draw markers that people are building
  let potluck = document.getElementById('potluck');
  for (let id in PlayerBuildMarkers) {
    let marker = PlayerBuildMarkers[id];
    let nameText = " " + marker.name + " ";
    let del = marker.del;
    drawTextSmall(ctx, (marker.pos[0] * 16 + 8) - PixelCameraX - (nameText.length * 4 / 2),   (marker.pos[1] * 16) - PixelCameraY - 8, nameText);
    ctx.drawImage(potluck, del?(17 * 16):(9 * 16), del?(19 * 16):(22 * 16), 16, 16, marker.pos[0] * 16 - PixelCameraX, marker.pos[1] * 16 - PixelCameraY, 16, 16);
  }

  // Draw a mouse selection if there is one
  if (MouseActive) {
    ctx.beginPath();
    ctx.lineWidth = "4";
    ctx.strokeStyle = (MouseDown) ? "#ff00ff" : "#00ffff";
    var AX = Math.min(MouseStartX, MouseEndX) * 16 + 4;
    var AY = Math.min(MouseStartY, MouseEndY) * 16 + 4;
    var BX = Math.max(MouseStartX, MouseEndX) * 16 + 12;
    var BY = Math.max(MouseStartY, MouseEndY) * 16 + 12;
    ctx.rect(AX - PixelCameraX, AY - PixelCameraY, BX - AX, BY - AY);
    ctx.stroke();
  }

  // Draw tool position preview
  if (drawToolX !== null && drawToolY !== null) {
    ctx.beginPath();
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = "4";
    ctx.strokeStyle = "#ffffff";
    var AX = drawToolX * 16;
    var AY = drawToolY * 16;
    ctx.rect(AX - PixelCameraX, AY - PixelCameraY, 16, 16);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

}

function drawText(ctx, x, y, text) {
  var chicago = document.getElementById("chicago");
  for (var i = 0; i < text.length; i++) {
    var chr = text.charCodeAt(i) - 0x20;
    var srcX = chr & 15;
    var srcY = chr >> 4;
    ctx.drawImage(chicago, srcX * 8, srcY * 8, 8, 8, x + i * 8, y, 8, 8);
  }
}

function drawTextSmall(ctx, x, y, text) {
  var chicago = document.getElementById("tomthumb");
  for (var i = 0; i < text.length; i++) {
    var chr = text.charCodeAt(i) - 0x20;
    var srcX = chr & 15;
    var srcY = chr >> 4;
    ctx.drawImage(tomthumb, srcX * 4, srcY * 6, 4, 6, x + i * 4, y, 4, 6);
  }
}

function drawHotbar() {
  // This draws the hotbar on the bottom
  var canvas = document.getElementById("selector");
  var ctx = canvas.getContext("2d");

  canvas.width = 320;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw ten inventory items
  var oneWidth = canvas.width / 10;
  for (var i = 0; i < 10; i++) {
    drawText(ctx, i * oneWidth, 0, ((i + 1) % 10) + "");
    
    if(i < hotbarData.length) {
      var item = AtomFromName(hotbarData[i]);
      if(item) {
        ctx.drawImage(IconSheets[item.pic[0]], item.pic[1]*16, item.pic[2]*16, 16, 16, i*oneWidth+12, 0, 16, 16);
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

function tickWorld() {
  if (NeedInventoryUpdate) {
    DisplayInventory = { null: [] };

    for (var key in DBInventory) {
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
            var is_custom = updated.pic != null && typeof updated.pic[0] == "string";
            if ((!(updated.id in PlayerImages) && is_custom) ||
              (updated.id in PlayerImages && PlayerImages[updated.id].src != updated.pic[0] && is_custom)) {
              var img = new Image();
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
            var temp = AtomFromName(updated.data);
            if (temp && temp.pic) {
              updated.pic = temp.pic;
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
    }

    // sort by name or date later
    for (var key in DisplayInventory) {
      DisplayInventory[key].sort(function (a, b) { return a - b });
    }

    updateInventoryUL();
    NeedInventoryUpdate = false;
  }

  // Tick each player's animation timer
  for (var id in PlayerAnimation) {
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

  /*
    var Under = MyMap.Tiles[PlayerX][PlayerY];
    if(!(TickCounter & 0x03)) {
      if(Under.type == AtomTypes.ICE) {
        PlayerX += DirX[PlayerDir];
        PlayerY += DirY[PlayerDir];
        ClampPlayerPos();
        NeedMapRedraw = true;
      } else if(Under.type == AtomTypes.ESCALATOR) {
        PlayerX += DirX[Under.dir];
        PlayerY += DirY[Under.dir];
        PlayerDir = Under.dir;
        ClampPlayerPos();
        NeedMapRedraw = true;
      }
    }
  */

  var TargetCameraX = (PlayerWho[PlayerYou].x * 16 + 8);
  var TargetCameraY = (PlayerWho[PlayerYou].y * 16 + 8);
  var CameraDifferenceX = TargetCameraX - CameraX;
  var CameraDifferenceY = TargetCameraY - CameraY;
  var CameraDistance = Math.sqrt(CameraDifferenceX * CameraDifferenceX + CameraDifferenceY * CameraDifferenceY);
  if (CameraDistance > 0.5) {
    var DivideBy = InstantCamera ? 1 : 16;
    var AdjustX = (TargetCameraX - CameraX) / DivideBy;
    var AdjustY = (TargetCameraY - CameraY) / DivideBy;

    if (Math.abs(AdjustX) > 0.1)
      CameraX += AdjustX;
    if (Math.abs(AdjustY) > 0.1)
      CameraY += AdjustY;

    if (!CameraAlwaysCenter) {
      var EdgeLinks = null;
      if ("edge_links" in MyMap.Info)
        EdgeLinks = MyMap.Info["edge_links"];

      var PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
      var PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
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

    // The camera movement may cause the map to change
//    console.log();
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
  TickCounter = (TickCounter + 1) & 0xffff;
  if(!SlowAnimationTick || ((TickCounter & 7) == 0)) {
    AnimationTick = (AnimationTick + 1) % 10000;
  }
}

function selectionCopy() {
  if (!MouseActive)
    return;

}

function selectionDelete() {
  if (document.getElementById("deleteTurfObj").style.display == "none")
    return;
  if (!MouseActive)
    return;
  var DeleteTurfs = document.getElementById("turfselect").checked;
  var DeleteObjs = document.getElementById("objselect").checked;

  for (var x = MouseStartX; x <= MouseEndX; x++) {
    for (var y = MouseStartY; y <= MouseEndY; y++) {
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

/////////////////////////////////////////////////
// mouse stuff
/////////////////////////////////////////////////

// helper function to get an element's exact position
// from https://www.kirupa.com/html5/getting_mouse_click_position.htm
function getExactPosition(el) {
  var xPosition = 0;
  var yPosition = 0;

  while (el) {
    if (el.tagName == "BODY") {
      // deal with browser quirks with body/window/document and page scroll
      var xScrollPos = el.scrollLeft || document.documentElement.scrollLeft;
      var yScrollPos = el.scrollTop || document.documentElement.scrollTop;

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
}

function getMousePosRaw(canvas, evt) {
  var rect = getExactPosition(canvas);
  return {
    x: (evt.clientX - rect.x) | 0,
    y: (evt.clientY - rect.y) | 0
  };
}

function getMousePos(canvas, evt) {
  var rect = getExactPosition(canvas);

  return {
    x: ((evt.clientX - rect.x) / CameraScale) | 0,
    y: ((evt.clientY - rect.y) / CameraScale) | 0
  };
}

function getTilePos(evt) {
  var PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
  var PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
  pos = getMousePos(mapCanvas, evt);
  pos.x = (pos.x + PixelCameraX) >> 4;
  pos.y = (pos.y + PixelCameraY) >> 4;
  return pos;
}

function getTilePosAtPixel(pos) {
  var PixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
  var PixelCameraY = Math.round(CameraY - mapCanvas.height / 2);
  var out = {x: (pos.x + PixelCameraX) >> 4, y: (pos.y + PixelCameraY) >> 4};
  return out;
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

function drawingTooFar(x, y, maxDistance) {
  let youX = PlayerWho[PlayerYou].x;
  let youY = PlayerWho[PlayerYou].y;
  let diffX = youX - x;
  let diffY = youY - y;
  let distance = Math.sqrt(diffX * diffX + diffY * diffY);
  return distance > maxDistance;
}
OK_DRAW_DISTANCE = 5;

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
  var edittilesheetselect = document.getElementById("edittilesheetselect");

  edittilesheetselect.addEventListener('mousedown', function (evt) {
    // update to choose the selected tile
    document.getElementById('edittilex').value = (evt.clientX - evt.target.getBoundingClientRect().x) >> 4;
    document.getElementById('edittiley').value = (evt.clientY - evt.target.getBoundingClientRect().y) >> 4;
    editItemUpdatePic();
  }, false);

  mapCanvas.addEventListener('mousedown', function (evt) {
    if (evt.button != 0)
      return;
    if (MousedOverEntityClickAvailable && !ShiftPressed) {
      SendCmd("EXT", { "entity_click":
        {"id": MousedOverEntityClickId, "x": MousedOverEntityClickX, "y": MousedOverEntityClickY, "target": MousedOverEntityClickIsTilemap ? "mini_tilemap" : "entity"}
      });
      return;
    }

    panel.innerHTML = "";
    var pos = getTilePos(evt);
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
      var AX = Math.min(MouseStartX, MouseEndX);
      var AY = Math.min(MouseStartY, MouseEndY);
      var BX = Math.max(MouseStartX, MouseEndX);
      var BY = Math.max(MouseStartY, MouseEndY);
      MouseStartX = AX;
      MouseStartY = AY;
      MouseEndX = BX;
      MouseEndY = BY;

      document.getElementById("getTileObjSpan").style.display = (MouseStartX == MouseEndX && MouseStartY == MouseEndY) ? 'block' : 'none';

      var panelHTML = (BX - AX + 1) + "x" + (BY - AY + 1) + "<br>";
      updateSelectedObjectsUL();

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
    event.preventDefault();

    CameraScale += event.deltaY * -0.01;

    // Restrict CameraScale
    CameraScale = Math.min(Math.max(CameraScaleMin, CameraScale), CameraScaleMax);

    updateZoomLevelDisplay();
    resizeCanvas();
  }, false);

  mapCanvas.addEventListener('mousemove', function (evt) {
    let pos = getTilePos(evt);
    let pixelPos = getMousePos(mapCanvas, evt); // Pixel position, for finding click position within a mini tilemap
    MouseRawPos = pixelPos;
    MouseNowX = pos.x;
    MouseNowY = pos.y;
    // record the nearby players
    var Around = PlayersAroundTile(MouseNowX, MouseNowY, 2);
    if (MousedOverPlayers.length != Around.length) {
      NeedMapRedraw = true;
    }
    MousedOverEntityClickAvailable = false;

    var AroundLongerRange = PlayersAroundTile(MouseNowX, MouseNowY, 4); // Check for stuff you might click on? Maybe combine it with the other check somehow

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
        let tileAtXY = decompressed[tilemapY * mini_tilemap_map_h + tilemapX];
        if(tileAtXY !== undefined && tileAtXY !== mini_tilemap_transparent_tile) {
          MousedOverEntityClickAvailable = true;
          MousedOverEntityClickId = index;
          MousedOverEntityClickIsTilemap = true;
          MousedOverEntityClickX = Math.floor(pixelPos.x - start_pixel_x);
          MousedOverEntityClickY = Math.floor(pixelPos.y - start_pixel_y);
        }
      }
      // Maybe you can click on the entity itself then?
      if(!MousedOverEntityClickAvailable && Mob.clickable) {
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
    var pos = getMousePosRaw(selector, evt);
    let oneWidth = selector.width / 10;
    let index = Math.floor(pos.x / oneWidth);
    setHotbarIndex(index);
    hotbarDragging = true;
  }, false);

  selector.addEventListener('mousemove', function (evt) {
    if(hotbarDragging) {
      var pos = getMousePosRaw(selector, evt);
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
    var pos = getMousePosRaw(selector, evt);
    let oneWidth = selector.width / 10;
    let index = Math.floor(pos.x / oneWidth);
    rightClickedHotbarIndex = index;
    var menu = document.querySelector(hotbarData[index] !== null ? '#hotbar-contextmenu' : '#hotbar-no-item-contextmenu');
    menu.style.left = (evt.clientX) + "px";
    menu.style.display = "block";
    menu.style.top = (evt.clientY - menu.offsetHeight) + "px";
    evt.preventDefault();
  }, false);

}

function viewInit() {
  var selector = document.getElementById("selector");
  selector.width = Math.max(240, parseInt(mapCanvas.style.width)) + "";
  drawHotbar();
  NeedMapRedraw = true;
}

function redrawBuildCanvas() {
  var canvas = document.getElementById('inventoryCanvas');
  // add click action
  canvas = document.getElementById('inventoryCanvas');
  var BuildWidth = 16;

  var len = Object.keys(PredefinedArray).length;
  canvas.width = (BuildWidth * 16) + "";
  canvas.height = (Math.ceil(len / BuildWidth) * 16) + "";
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  var count = 0;
  for (var i in PredefinedArray) {
    var item = PredefinedArray[i];
    if (item.pic[0] in IconSheets)
      ctx.drawImage(IconSheets[item.pic[0]], item.pic[1] * 16, item.pic[2] * 16, 16, 16, (count % BuildWidth) * 16, Math.floor(count / BuildWidth) * 16, 16, 16);

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

function initBuild() {
  redrawBuildCanvas();

  var canvas = document.getElementById('inventoryCanvas');
  var BuildWidth = 16;

  canvas.addEventListener('mousedown', function (evt) {
    var pos = getMousePosRaw(inventoryCanvas, evt);
    pos.x = pos.x >> 4;
    pos.y = pos.y >> 4;
    var index = pos.y * BuildWidth + pos.x;

	if(evt.button == 0) {
		if (buildTool == BUILD_TOOL_SELECT) {
		  useItem({ type: 'map_tile', data: PredefinedArrayNames[index] });
		} else if(buildTool == BUILD_TOOL_DRAW) {
		  tileDataForDraw = PredefinedArrayNames[index];
          setBuildMenuSelectIndex(index);
		}
	}
  }, false);

  canvas.addEventListener('contextmenu', function (evt) {
    var pos = getMousePosRaw(inventoryCanvas, evt);
    pos.x = pos.x >> 4;
    pos.y = pos.y >> 4;
    var index = pos.y * BuildWidth + pos.x;
    rightClickedBuildTile = PredefinedArrayNames[index];

    var menu = document.querySelector('#build-contextmenu');
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

  // applies saved options from browser form fill
  applyOptions();

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

    let btn = document.getElementById("navlogin");
    let mapbtn = document.getElementById("navmap");
    let span = document.getElementsByClassName("modalclose");

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
      }
    }

    window.onclick = function (event) {
      if (event.target == loginmodal) {
        loginmodal.style.display = "none";
      }
      if (event.target == newitemmodal) {
        newitemmodal.style.display = "none";
      }
      if (event.target == mapmodal) {
        mapmodal.style.display = "none";
      }
    }

    if (!OnlineServer) {
	  // Open the login window by default
	  loginmodal.style.display = "block";
    }
  }

}

function applyOptions() {
  var vcenter = document.getElementById("alwayscenter");
  var vnotifychat = document.getElementById("audiochatnotify");
  var vnotifymisc = document.getElementById("audiomiscnotify");
  var vfly = document.getElementById("option-fly");

  CameraAlwaysCenter = vcenter.checked;
  AudioChatNotifications = vnotifychat.checked;
  AudioMiscNotifications = vnotifymisc.checked;
  Fly = vfly.checked;
}

function rightClick(evt) {
  return false;
}


function viewOptions() {
  var options = document.getElementById("options");
  var Hidden = (options.style.display == 'none');
  document.getElementById("navoptions").setAttribute("class", Hidden ? "navactive" : "");
  options.style.display = Hidden ? 'block' : 'none';
}

// options!
// eventlisteners: an object of listener name => function. added to each card
// hidden_ids: hides any item with this id from the list
// expanded: if true, subfolders are expanded by default
// top_level: if true, doesn't show expansion options or sublists
function itemCardList(ul, ids, options = {}) {
  var lis = [];
  var openFolders = [];

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
  var item = DBInventory[id] || PlayerWho[id];

  let image = li.querySelector('.item_icon');
  li.replaceChild(new_image, image);
}

function itemCard(id) {
  var item = DBInventory[id] || PlayerWho[id];

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
    if (item.status_message)
      status_span.innerText = `${item.status} (${item.status_message})`;
    else
      status_span.innerText = `${item.status}`;
    info_name.appendChild(status_span);
  }

  let info_detail = document.createElement("div");
  info_detail.classList.add('inventory-info-detail');

  var info = '';

  if (item.temporary) {
    info += "temporary ";
  }

  info += `id: ${item.id}`;

  if (item.username) {
    info += `, username: ${item.username}`;
  }

  info_detail.innerText = `(${info})`;

  info_div.appendChild(info_name);
  info_div.appendChild(info_detail);

  li.appendChild(info_div);
  return li;
}

function picIcon(pic) {
  var img_container = document.createElement("div");
  img_container.classList.add('item_icon');

  // create a little icon for the item
  var img = document.createElement("img");
  img.src = "img/transparent.png";
  img.style.width = "16px";
  img.style.height = "16px";
  var src = "";

  if (IconSheets[pic[0]])
    src = IconSheets[pic[0]].src;
  else
    src = pic[0];

  var background = "url(" + src + ") -" + (pic[1] * 16) + "px -" + (pic[2] * 16) + "px";
  img.style.background = background;

  img_container.appendChild(img);
  return img_container;
}

function itemIcon(key) {
  var img_container = document.createElement("div");
  img_container.classList.add('item_icon');

  // create a little icon for the item
  var img = document.createElement("img");
  img.src = "img/transparent.png";
  img.style.width = "16px";
  img.style.height = "16px";
  var src = "";

  var item = DBInventory[key] || PlayerWho[key];

  // allow custom avatars
  // as well as built-in ones
  pic = [0, 8, 24];

  let user = PlayerWho[key];
  if (key in PlayerImages) {
    if (PlayerImages[key].naturalWidth != 16 || PlayerImages[key].naturalHeight != 16) {
      img.style.width = "32px";
      img.style.height = "32px";
    }

    src = PlayerImages[key].src;
  }

  if (item?.pic)
    pic = item.pic;

  if (IconSheets[pic[0]])
    src = IconSheets[pic[0]].src;
  else
    src = pic[0];

  var background = "url(" + src + ") -" + (pic[1] * 16) + "px -" + (pic[2] * 16) + "px";
  img.style.background = background;
  img.style.backgroundRepeat = "no-repeat";

  img_container.appendChild(img);
  return img_container;
}

contextMenuItem = 0;
function openItemContextMenu(id, x, y) {
  var drop = document.querySelector('#droptakeitem');

  copyItemToHotbarLi.style.display = "none";
  if (id in DBInventory) {
    drop.innerText = "Drop";
    if(DBInventory[id].type == "map_tile")
      copyItemToHotbarLi.style.display = "block";
  } else {
    drop.innerText = "Take";
  }
  var menu = document.querySelector('#item-contextmenu');
  menu.style.left = (x) + "px";
  menu.style.top = (y) + "px";

  menu.style.display = "block";

  contextMenuItem = id;
}

function updateInventoryUL() {
  // Manage the inventory <ul>
  var ul = document.getElementById('inventoryul');
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

function toggleDisplay(element) {
  element.style.display = element.style.display == 'block' ? 'none' : 'block';
}

function viewUsers() {
  var users = document.getElementById('users');
  toggleDisplay(users);

  var ul = document.getElementById('usersul');
  updateUsersUL();
}

function viewChatLog() {
  var chat = document.getElementById('chat-container');
  chat.classList.toggle('pinned');
  chatArea.scrollTop = chatArea.scrollHeight;
  resizeCanvas();
}

function viewInventory() {
  var inventory = document.getElementById('inventory');
  toggleDisplay(inventory);

  var ul = document.getElementById('inventoryul');
  updateInventoryUL();
}

function viewTileset(Item) {
  var tileset = document.getElementById('tileset');
  toggleDisplay(tileset);

  var tileset_title = document.getElementById('tileset-title');
  tileset_title.innerText = "Tileset: " + Item.name;
}

function viewCompose() {
  var compose = document.getElementById('compose');
  compose.style.display = 'block';
}

function inSelection(x, y) {
  return x >= MouseStartX && x <= MouseEndX && y >= MouseStartY && y <= MouseEndY;
}

function updateSelectedObjectsUL() {
  // Manage the users <ul>
  var ul = document.getElementById('selectedobjectsul');
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

  if (selected_ids.length < 1) {
    let li = document.createElement("li");
    li.appendChild(document.createTextNode("None"));
    ul.appendChild(li);
  }
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

function updateMailUL() {
  // Manage the users <ul>
  var ul = document.getElementById('mailul');
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

function viewBuild() {
  var build = document.getElementById('build');
  toggleDisplay(build);
}

function viewCustomize() {
  var options = document.getElementById("character");
  var Hidden = (options.style.display == 'none');
  document.getElementById("navcustomize").setAttribute("class", Hidden ? "navactive" : "");
  options.style.display = Hidden ? 'block' : 'none';
}

function previewIcon() {
  var preview = document.getElementById("iconPreview");
  var file = document.getElementById("iconPicker").files[0];
  var reader = new FileReader();

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

function downloadCanvas(canvasId, filename) {
  var link = document.getElementById('download');
  link.href = document.getElementById(canvasId).toDataURL();
  link.download = filename;
}

function loginButton() {
  OnlineUsername = document.getElementById("loginuser").value;
  OnlinePassword = document.getElementById("loginpass").value;
  OnlineServer = document.getElementById("loginserver").value;
  if (!OnlineIsConnected)
    ConnectToServer();
  else
    SendCmd("CMD", { text: "login " + OnlineUsername + " " + OnlinePassword });

  document.getElementById('loginWindow').style.display = "none";
}

function editItemApply() {
  var edittilename = document.getElementById('edittilename').value;
  var edittiledesc = document.getElementById('edittiledesc').value;
  if (edittiledesc == "")
    edittiledesc = null;

  var updates = {
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

    case "map_tile_hotbar":
    case "map_tile":
    case "generic":
      // Gather item info
      var sheet = document.getElementById('edittilesheet').value;
      if (sheet == "keep") {
        sheet = editItemOriginalSheet;
      } else {
        sheet = parseInt(sheet);
      }

      var edittilesheet = parseInt(sheet);
      var edittilex = parseInt(document.getElementById('edittilex').value);
      var edittiley = parseInt(document.getElementById('edittiley').value);
      var edittiletype = document.getElementById('edittiletype').value;
      var edittiledensity = document.getElementById('edittiledensity').checked;
      var edittileobject = !document.getElementById('edittileisobject').checked;
      var edittileover = document.getElementById('edittileover').checked;

      updates.pic = [edittilesheet, edittilex, edittiley];

      if (editItemType == "map_tile" || editItemType == "map_tile_hotbar") {
        let data = {
          "name": updates.name,
          "pic": updates.pic,
          "obj": edittileobject,
          "type": edittiletype,
          "density": edittiledensity
        };
        if(edittileover)
          data["over"] = true;
        updates.data = JSON.stringify(data);
        if(editItemType === "map_tile_hotbar") {
          hotbarData[editItemID] = data;
          drawHotbar();
        }
      }

      if(editItemType !== "map_tile_hotbar") {
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
  SendCmd("BAG", { create: { "type": type, "name": document.getElementById('newtilename').value } });
  newItemCancel();
}

function newItemCancel() {
  document.getElementById('newItemWindow').style.display = "none";
}

/////////////////////////////////////////////////////////////////////
// customize the bbcode parser
function offerCommand(t) {
  if (confirm('Run command "' + t + '"?')) {
    sendChatCommand(t);
  }
}

function botMessageButton(bot_id, t) {
  SendCmd("EXT", { "bot_message_button": { "id": bot_id, "text": t } });
}

let emptyTag = {
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
  //  "center": emptyTag,
  "face": emptyTag,
  "font": emptyTag,
  //  "justify": emptyTag,
  //  "left": emptyTag,
  "quote": emptyTag,
  "php": emptyTag,
  //  "right": emptyTag,
  //  "table": emptyTag,
  //  "tbody": emptyTag,
  //  "thead": emptyTag,
  //  "tfoot": emptyTag,
  //  "td": emptyTag,
  //  "th": emptyTag,
  //  "tr": emptyTag,
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


function resizeCanvas() {
  var parent = mapCanvas.parentNode;
  var r = parent.getBoundingClientRect();
  mapCanvas.width = r.width / CameraScale;
  mapCanvas.height = r.height / CameraScale;

  drawMap();
  drawHotbar();
}

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

  for(var index in data) {
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
  editItemType = "map_tile_hotbar";
  editItemID = rightClickedHotbarIndex;
  editItemShared({ "type": "map_tile_hotbar", "name": atom.name, "desc": "", "data": atom });
}

function newTileHotbarSlot() {
  if(rightClickedHotbarIndex === null)
    return;
  editItemType = "map_tile_hotbar";
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
