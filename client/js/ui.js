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
var PlayerYou = "me";
var PlayerWho = {me: {name: "Player", pic: [0, 2, 25], x: 5, y: 5, dir: 2, passengers:[]}};
var PlayerImages = {}; // dictionary of Image objects
var PlayerAnimation = { // dictionary of animation statuses
  "me": {
    "walkTimer": 0,// amount of ticks where the player should be animated as walking
    "lastDirectionLR": 0, //last direction that was set that is left or right
    "lastDirection4":  0, //last direction that was set that is left, right, up or down
  }
}

var Mail = [];

// camera settings
var ViewWidth;
var ViewHeight;
var CameraX = 0;
var CameraY = 0;
var CameraAlwaysCenter = true;
var Fly = false;

var CameraScale = 1;

// other settings
var AudioNotifications = false;

// mouse stuff
var MouseDown   = false;
var MouseStartX = -1;
var MouseStartY = -1;
var MouseEndX   = -1;
var MouseEndY   = -1;
var MouseNowX   = -1;
var MouseNowY   = -1;
var MouseActive = false; // is there a selection right now?
var MousedOverPlayers = [];

// document elements
var mapCanvas = null; // main map view
var selCanvas = null; // selector
var chatInput = null;
var panel = null;

var NeedMapRedraw = false;
var NeedInventoryUpdate = false;
var TickCounter = 0;   // Goes up every 20ms, wraps at 0x10000 (hex)
var AnimationTick = 0; // Goes up every 20ms, wraps at 10000 (decimal)
var DisplayInventory = {null: []}; // Indexed by folder
var DBInventory = {}; // Indexed by ID
var OpenFolders = {};

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
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

function logMessage(Message, Class) {
  var chatArea = document.getElementById("chatArea");
  var bottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 1;

  let newMessage = document.createElement("div");
  newMessage.className = Class;
  newMessage.innerHTML = Message;
  chatArea.append(newMessage);

  if(bottom)
    chatArea.scrollTop = chatArea.scrollHeight;

  if(AudioNotifications) {
    var audio = new Audio('img/notify.wav');
    audio.play();
  }
}

function setChatInput(the_text) {
  chatInput.value = the_text;
  chatInput.focus();
  sendTyping(true);
}

function sendChatCommand(the_text) {
  SendCmd("CMD", {text: the_text});
}

function sendTyping(isTyping) {
  if(PlayerWho[PlayerYou].typing != isTyping){
    SendCmd("WHO", {update: {id: PlayerYou, typing: isTyping}});
    PlayerWho[PlayerYou].typing = isTyping;
    drawMap();
  }
}

function PlayersAroundTile(FindX, FindY, Radius) {
  var Found = [];
  for (var index in PlayerWho) {
    if(index == PlayerYou)
      continue;
    var Mob = PlayerWho[index];
	var Distance = Math.sqrt(Math.pow(Mob.x - FindX, 2)+Math.pow(Mob.y - FindY, 2));
	if(Distance <= Radius)
		Found.push(index);
  }
  return Found;
}

function editItemUpdatePic() {
  var edittilesheet = parseInt(document.getElementById('edittilesheet').value);
  var edittilex = parseInt(document.getElementById('edittilex').value);
  var edittiley = parseInt(document.getElementById('edittiley').value);

  var src = "";
  if(IconSheets[edittilesheet])
    src = IconSheets[edittilesheet].src;
  document.getElementById('edittilepic').style.background = "url("+src+") -"+(edittilex*16)+"px -"+(edittiley*16)+"px";
  document.getElementById('edittilesheetselect').src = src;
}

editItemType = null;
editItemID = null;
function editItem(key) {
  // open up the item editing screen for a given item
  var item = DBInventory[key] || PlayerWho[key];
  var itemobj = null;
  editItemType = item.type;
  editItemID = item.id;

  document.getElementById('edittileobject').style.display = "none";
  document.getElementById('edittiletext').style.display = "none";
  document.getElementById('edittileimage').style.display = "none";
  document.getElementById('edittilename').value = item.name;
  document.getElementById('edittiledesc').value = item.desc;
  switch(item.type) {
    case "text":
      document.getElementById('edittiletext').style.display = "block";
      if(item.data)
        document.getElementById('edittiletextarea').value = item.data;
      else
        document.getElementById('edittiletextarea').value = "";
      break;
    case "image":
      document.getElementById('edittileimage').style.display = "block";
      document.getElementById('edittileurl').value = item.data;
      break;

    case "generic":
    case "map_tile":
      if(item.type == "map_tile") {
        itemobj = AtomFromName(item.data);
        if(itemobj == null) {
          itemobj = {pic: [0, 8, 24]};
        }
      } else {
        if("pic" in item)
          itemobj = {pic: item.pic};
        else
          itemobj = {pic: [0, 8, 24]};
      }

      // Display all the available images assets in the user's inventory
      var sheetselect = document.getElementById("edittilesheet"); 
      while(sheetselect.firstChild) {
        sheetselect.removeChild(sheetselect.firstChild);
      }
      el = document.createElement("option");
      el.textContent = "Potluck";
      el.value = 0;
      sheetselect.appendChild(el);
      el = document.createElement("option");
      el.textContent = "Extras";
      el.value = -1;
      sheetselect.appendChild(el);
      // Now display everything in the inventory
      for(var i in DBInventory) {
        if(DBInventory[i].type == "image") {
          el = document.createElement("option");
          el.textContent = DBInventory[i].name;
          el.value = DBInventory[i].id;
          sheetselect.appendChild(el);
        }
      }
      // Probably also allow just typing in something?

      document.getElementById('edittilemaptile').style.display = item.type == "map_tile" ? "block" : "none";
      document.getElementById('edittileobject').style.display = "block";
      document.getElementById('edittilesheet').value = itemobj.pic[0];
      document.getElementById('edittilex').value = itemobj.pic[1];
      document.getElementById('edittiley').value = itemobj.pic[2];
      var index_for_type = 0;
      switch(itemobj.type) {
        case "sign":
          index_for_type = 1;
          break;
      }
      document.getElementById('edittiletype').selectedIndex = index_for_type;
      document.getElementById('edittiledensity').checked = itemobj.density;
      document.getElementById('edittileisobject').checked = !itemobj.obj;
      editItemUpdatePic();

      if(IconSheets[itemobj.pic[0] || 0] != undefined)
        document.getElementById('edittilesheetselect').src = IconSheets[itemobj.pic[0] || 0].src;
      break;
  }

  // Display folder selection
  var select = document.getElementById("edittilefolder"); 
  while(select.firstChild) {
    select.removeChild(select.firstChild);
  }
  // "no folder" option
  var el = document.createElement("option");
  el.textContent = "-";
  el.value = "-1";
  select.appendChild(el);
  for(var i in DBInventory) {
    if(DBInventory[i].type == "folder") { // folder
      el = document.createElement("option");
      el.textContent = DBInventory[i].name;
      el.value = DBInventory[i].id;
      select.appendChild(el);
    }
  }
  document.getElementById('edittilefolder').value = (item.folder != PlayerYou ? item.folder : -1) || -1;

  // show the window
  document.getElementById('editItemWindow').style.display = "block";
}

function useItem(Placed) {
  var PlayerX = PlayerWho[PlayerYou].x;
  var PlayerY = PlayerWho[PlayerYou].y;

  switch(Placed.type) {
    case "folder": // folder
      OpenFolders[Placed.id] = !OpenFolders[Placed.id];
      NeedInventoryUpdate = true;
      break;
    case "tileset": // tileset
      viewTileset(Placed);
      console.log("Open tileset thing");
      break;
    case "map_tile": // object
      var ActualAtom = AtomFromName(Placed.data);
      // place the item on the ground
      if(ActualAtom.obj) {
        if(ActualAtom.type == AtomTypes.SIGN) {
          Placed = {data: CloneAtom(ActualAtom)};
          Message = prompt("What should the sign say?");
          if(Message == null)
            return;
          Placed.data.message = Message;
        }
        MapObjs[PlayerX][PlayerY].push(Placed.data);
        SendCmd("PUT", {pos: [PlayerX, PlayerY], obj: true, atom: MapObjs[PlayerX][PlayerY]});
      } else {
        MapTiles[PlayerX][PlayerY] = Placed.data;
        SendCmd("PUT", {pos: [PlayerX, PlayerY], obj: false, atom: MapTiles[PlayerX][PlayerY]});
      }
      drawMap();
  }

}

function dropTakeItem(id) {
  if ( id in DBInventory ) {
    sendChatCommand(`e ${id} drop`);
  } else {
    sendChatCommand(`e ${id} take`);
  }
}

function cloneItem(id, temporary=false) {
  SendCmd("BAG", {clone: {id: id, temp: temporary}});
}

function deleteItem(id) {
  var item = DBInventory[id] || PlayerWho[id];

  if (
    confirm(`Really delete ${item.name} with ID ${item.id}?`)
  ) {
    SendCmd("BAG", {delete: {id: id}});
  }
}

function referenceItem(id) {
  var item = DBInventory[id] || PlayerWho[id];
  SendCmd("BAG", {create: {name: `${item.name} (reference)`, type: "reference", data: `${id}`}});
}

function updateDirectionForAnim(id) {
  let dir = PlayerWho[id].dir;
  if((dir & 1) == 0) {
    PlayerAnimation[id].lastDirection4 = dir;
  }
  if(dir == Directions.EAST || dir == Directions.WEST) {
    PlayerAnimation[id].lastDirectionLR = dir;
  }
}

function startPlayerWalkAnim(id) {
  PlayerAnimation[id].walkTimer = 25+1; // 25*(20ms/1000) = 0.5
  NeedMapRedraw = true;
}

function movePlayer(id, x, y, dir) {
  for(var index of PlayerWho[id].passengers){
    if(x != null) {
      if ( PlayerWho[index].is_following ) {
        movePlayer(index, PlayerWho[id].x, PlayerWho[id].y, PlayerWho[id].dir);
      } else {
        movePlayer(index, x, y, dir);
      }
    }
  }

  if(x != null) {
    PlayerWho[id].x = x;
    PlayerWho[id].y = y;
    startPlayerWalkAnim(id);
  }
  if(dir != null) {
    PlayerWho[id].dir = dir;
    updateDirectionForAnim(id);
  }
}

function keyHandler(e) {
 
  function ClampPlayerPos() {
    PlayerX = Math.min(Math.max(PlayerX, 0), MapWidth-1);
    PlayerY = Math.min(Math.max(PlayerY, 0), MapHeight-1);;
  }

  var e = e || window.event;

  // ignore keys when typing in a textbox
  if(document.activeElement.tagName == "INPUT" || document.activeElement.tagName == "TEXTAREA") {
    if(document.activeElement == chatInput && e.keyCode == 13) {
      // commands that are local to the client
      if(chatInput.value.toLowerCase() == "/clear") {
        chatArea.innerHTML = "";
      } else if(chatInput.value.toLowerCase() == "/exportmap") {
        //logMessage('<a href="data:,'+encodeURIComponent(exportMap())+'" download="map.txt">Map download (click here)</a>', 'server_message');

        //from https://ourcodeworld.com/articles/read/189/how-to-create-a-file-and-generate-a-download-with-javascript-in-the-browser-without-a-server
        var element = document.createElement('a');
        element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(exportMap()));
        element.setAttribute('download', "map.txt");
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
      }


      // commands are CMD while regular room messages are MSG. /me is a room message.
      else if(chatInput.value.slice(0,1) == "/" && chatInput.value.toLowerCase().slice(0,4) != "/me ") {
        SendCmd("CMD", {text: chatInput.value.slice(1)}); // remove the /
      } else if(chatInput.value.length > 0) {
        SendCmd("MSG", {text: chatInput.value});
      } else {
        chatInput.blur();
      }

      sendTyping(false);

      chatInput.value = "";
    } else if(document.activeElement == chatInput && e.keyCode == 27) {
      // escape press
      chatInput.blur();
    }
    return;
  }
  var needRedraw = false;

  var PlayerX = PlayerWho[PlayerYou].x;
  var PlayerY = PlayerWho[PlayerYou].y;
  var PlayerDir = PlayerWho[PlayerYou].dir;
  var OldPlayerX = PlayerX;
  var OldPlayerY = PlayerY;
  var OldPlayerDir = PlayerWho[PlayerYou].dir;

  if(e.keyCode == 32 || e.keyCode == 12) { // space or clear

  } if(e.keyCode == 46) { // delete
    selectionDelete();
  } else if(e.keyCode == 27) { // escape
    MouseActive = false;
    MouseDown = false;
    panel.innerHTML = "";
    NeedMapRedraw = true;
    selectionInfoVisibility(false);
  } else if(e.keyCode >= 48 && e.keyCode <= 57) { // 0 through 9
    // calculate which inventory item
    var n = e.keyCode - 48;
    n = (n-1)%10;
    if(n < 0)
      n = 9;
    // if there's no item, stop
    if(!DisplayInventory[null][n])
      return;
    useItem(DisplayInventory[null][n]);
  } else if (e.keyCode == 38 || e.keyCode == 87) { // up/w
    PlayerY--;
    PlayerDir = Directions.NORTH;
    e.preventDefault();
  } else if (e.keyCode == 40 || e.keyCode == 83) { // down/s
    PlayerY++;
    PlayerDir = Directions.SOUTH;
    e.preventDefault();
  } else if (e.keyCode == 37 || e.keyCode == 65) { // left/a
    PlayerX--;
    PlayerDir = Directions.WEST;
    e.preventDefault();
  } else if (e.keyCode == 39 || e.keyCode == 68) { // right/d
    PlayerX++;
    PlayerDir = Directions.EAST;
    e.preventDefault();
  } else if (e.keyCode == 35) { // end
    PlayerX--;
    PlayerY++;
    PlayerDir = Directions.SOUTHWEST;
    e.preventDefault();
  } else if (e.keyCode == 34) { // pg down
    PlayerX++;
    PlayerY++;
    PlayerDir = Directions.SOUTHEAST;
    e.preventDefault();
  } else if (e.keyCode == 36) { // home
    PlayerX--;
    PlayerY--;
    PlayerDir = Directions.NORTHWEST;
    e.preventDefault();
  } else if (e.keyCode == 33) { // pg up
    PlayerX++;
    PlayerY--;
    PlayerDir = Directions.NORTHEAST;
    e.preventDefault();
  } else if (e.keyCode == 13) { // enter (carriage return)
    chatInput.focus();
    e.preventDefault();
  }

  ClampPlayerPos();

  // go back if the turf is solid
  if(OldPlayerX != PlayerX || OldPlayerY != PlayerY) {
    if(!Fly && AtomFromName(MapTiles[PlayerX][PlayerY]).density) {
      PlayerX = OldPlayerX;
      PlayerY = OldPlayerY;
    }
    // or if there are any solid objects in the way
    for (var index in MapObjs[PlayerX][PlayerY]) {
      var Obj = AtomFromName(MapObjs[PlayerX][PlayerY][index]);
      if(Obj.density) {
        if(!Fly){
          PlayerX = OldPlayerX;
          PlayerY = OldPlayerY;
        }
        if(Obj.type == AtomTypes.SIGN) {
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
          logMessage(((Obj.name != "sign" && Obj.name != "") ? Obj.name + " says: " : "The sign says: ") +convertBBCode(Obj.message), "server_message");
        }
        break;
      }
    }

    if(OldPlayerX != PlayerX || OldPlayerY != PlayerY || OldPlayerDir != PlayerDir) {
      if(e.shiftKey) {
        SendCmd("MOV", {dir: PlayerDir});
        movePlayer(PlayerYou, null, null, PlayerDir);
      } else {
        SendCmd("MOV", {from: [OldPlayerX, OldPlayerY], to: [PlayerX, PlayerY], dir: PlayerDir});
        movePlayer(PlayerYou, PlayerX, PlayerY, PlayerDir);
      }
    }
  }

  if(needRedraw)
    drawMap();
}
document.onkeydown = keyHandler;

// Render the map view
function drawMap() {
  var canvas = mapCanvas;
  var ctx = canvas.getContext("2d");

  // Clear to black
  ctx.fillStyle="black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Calculate camera pixel coordinates
  var PixelCameraX = CameraX>>4;
  var PixelCameraY = CameraY>>4;
  var OffsetX = PixelCameraX & 15;
  var OffsetY = PixelCameraY & 15;
  var TileX = PixelCameraX>>4;
  var TileY = PixelCameraY>>4;

  // Render the map
  for(x=0;x<(ViewWidth+1);x++) {
    for(y=0;y<(ViewHeight+1);y++) {
      var RX = x+TileX;
      var RY = y+TileY;

      // Skip out-of-bounds tiles
      if(RX < 0 || RX >= MapWidth || RY < 0 || RY >= MapHeight)
        continue;

      // Draw the turf
      var Tile = AtomFromName(MapTiles[RX][RY]);
      if(Tile) {
        if(IconSheets[Tile.pic[0]])
          ctx.drawImage(IconSheets[Tile.pic[0]], Tile.pic[1]*16, Tile.pic[2]*16, 16, 16, x*16-OffsetX, y*16-OffsetY, 16, 16);
        else
          RequestImageIfNeeded(Tile.pic[0]);
      }
      // Draw anything above the turf
      var Objs = MapObjs[RX][RY];
      if(Objs) {
        for (var index in Objs) {
          var Obj = AtomFromName(Objs[index]);
          if(IconSheets[Obj.pic[0]])
            ctx.drawImage(IconSheets[Obj.pic[0]], Obj.pic[1]*16, Obj.pic[2]*16, 16, 16, x*16-OffsetX, y*16-OffsetY, 16, 16);
          else
            RequestImageIfNeeded(Obj.pic[0]);
        }
      }
    }
  }

  // Draw the player
//  ctx.drawImage(document.getElementById(PlayerIconSheet), PlayerIconX*16, PlayerIconY*16, 16, 16, (PlayerX*16)-PixelCameraX, (PlayerY*16)-PixelCameraY, 16, 16);

  function draw32x32Player(who, frameX, frameY) {
    var Mob = PlayerWho[index];
    ctx.drawImage(PlayerImages[who], frameX*32, frameY*32, 32, 32, (Mob.x*16-8)-PixelCameraX, (Mob.y*16-16)-PixelCameraY, 32, 32);
  }

  for (var index in PlayerWho) {
    var IsMousedOver = false;
    for (var look=0; look<MousedOverPlayers.length; look++) {
      if(MousedOverPlayers[look] == index) {
        IsMousedOver = true;
        break;
      }
    }

    var Mob = PlayerWho[index];
    var playerIs16x16 = false;
    if(index in PlayerImages) {
      let tilesetWidth = PlayerImages[index].naturalWidth;
      let tilesetHeight = PlayerImages[index].naturalHeight;
      if(tilesetWidth == 32 && tilesetHeight == 32) {
        draw32x32Player(index, 0, 0);
      } else if(tilesetWidth == 16 && tilesetHeight == 16) {
        ctx.drawImage(PlayerImages[index], 0, 0, 16, 16, (Mob.x*16)-PixelCameraX, (Mob.y*16)-PixelCameraY, 16, 16);
        playerIs16x16 = true;
      } else {
        let frameX = 0, frameY = 0;
        let frameCountFromAnimationTick = Math.floor(AnimationTick / 5);
        let isWalking = PlayerAnimation[index].walkTimer != 0;

        switch(tilesetHeight / 32) { // Directions
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

        switch(tilesetWidth / 32) { // Frames per direction
          case 2:
            frameX = isWalking * 1;
            break;
          case 4:
            frameX = (isWalking*2) + (frameCountFromAnimationTick&1);
            break;
          case 8:
            frameX = (isWalking*4) + (frameCountFromAnimationTick&3);
            break;
        }

        draw32x32Player(index, frameX, frameY);
//      } else { // Sheet of 32x32 images
//        ctx.drawImage(PlayerImages[index], Mob.pic[1]*32, Mob.pic[2]*32, 32, 32, (Mob.x*16-8)-PixelCameraX, (Mob.y*16-16)-PixelCameraY, 32, 32);
      }

    } else {
      pic = Mob.pic;
      if(pic == null)
        pic = [0, 8, 24];
      ctx.drawImage(IconSheets[pic[0]], pic[1]*16, pic[2]*16, 16, 16, (Mob.x*16)-PixelCameraX, (Mob.y*16)-PixelCameraY, 16, 16);
      playerIs16x16 = true;
    }

    var heightForPlayerStatus = (playerIs16x16 ? 16 : 28);

    // typing indicators
    if(Mob.typing) {
      ctx.drawImage(IconSheets[0], 0, 24*16, 16, 16, (Mob.x*16)-PixelCameraX, (Mob.y*16)-PixelCameraY-heightForPlayerStatus, 16, 16);
    }

    // carry text and nametags
    if(IsMousedOver && !(!Mob.is_following && Mob.vehicle)) {
      if(Mob.passengers.length > 0) {
        drawText(ctx, (Mob.x*16)-PixelCameraX-(Mob.name.length * 8 / 2 - 8), (Mob.y*16)-PixelCameraY-heightForPlayerStatus-8, Mob.name);
        var carryNames = [];
        for(var passenger_index of Mob.passengers) {
          carryNames.push(PlayerWho[passenger_index].username);
        }
        var carryText = "carrying: " + carryNames.join(", ");

        drawText(ctx, (Mob.x*16)-PixelCameraX-(carryText.length * 8 / 2 - 8), (Mob.y*16)-PixelCameraY-heightForPlayerStatus, carryText);
      } else {
        drawText(ctx, (Mob.x*16)-PixelCameraX-(Mob.name.length * 8 / 2 - 8), (Mob.y*16)-PixelCameraY-heightForPlayerStatus, Mob.name);
      }
    }
  }

  // Draw a mouse selection if there is one
  if(MouseActive) {
    ctx.beginPath();
    ctx.lineWidth="4";
    ctx.strokeStyle=(MouseDown)?"#ff00ff":"#00ffff";
    var AX = Math.min(MouseStartX, MouseEndX)*16+4;
    var AY = Math.min(MouseStartY, MouseEndY)*16+4;
    var BX = Math.max(MouseStartX, MouseEndX)*16+12;
    var BY = Math.max(MouseStartY, MouseEndY)*16+12;
    ctx.rect(AX-PixelCameraX, AY-PixelCameraY, BX-AX, BY-AY);
    ctx.stroke();
  }
}

function drawText(ctx, x, y, text) {
  var chicago = document.getElementById("chicago");
  for(var i=0; i<text.length; i++) {
    var chr = text.charCodeAt(i)-0x20;
    var srcX = chr&15;
    var srcY = chr>>4;
    ctx.drawImage(chicago, srcX*8, srcY*8, 8, 8, x+i*8, y, 8, 8);
  }
}

function drawSelector() {
  // This draws the hotbar on the bottom
  var canvas = document.getElementById("selector");
  var ctx = canvas.getContext("2d");

  canvas.width = 320;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw ten inventory items
  var oneWidth = canvas.width/10;
  for(var i=0; i<10; i++) {
    drawText(ctx, i*oneWidth, 0, ((i+1)%10)+"");
// TODO: figure out what to display down here later?
//    var item = AtomFromName(DisplayInventory[null][i]);
//    if(item) {
//      ctx.drawImage(IconSheets[item.pic[0]], item.pic[1]*16, item.pic[2]*16, 16, 16, i*oneWidth+16, 0, 16, 16);
//    }
  }
}

function tickWorld() {
  var TargetCameraX = (PlayerWho[PlayerYou].x-Math.floor(ViewWidth/2))<<8;
  var TargetCameraY = (PlayerWho[PlayerYou].y-Math.floor(ViewHeight/2))<<8;

  if(NeedInventoryUpdate) {
    DisplayInventory = {null: []};

    for(var key in DBInventory) {
      if(DBInventory[key].type == "map_tile" || DBInventory[key].type == "tileset") { // object or tileset
        if(typeof DBInventory[key].data == "string" &&
          (DBInventory[key].data[0] == '[' || DBInventory[key].data[0] == '{')) // convert from JSON if needed
          DBInventory[key].data = JSON.parse(DBInventory[key].data);
      }

      let updated = DBInventory[key];
      if(updated.folder == PlayerYou)
        updated.folder = null;

      // always reload the picture, for now
      if(true) {
        switch(updated.type) {
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
            if(updated.pic == null)
              updated.pic = [0, 8, 24];
            break;
          case "map_tile": // object
            // allow for string data like "grass"
            var temp = AtomFromName(updated.data);
            if(temp && temp.pic) {
              updated.pic = temp.pic;
            } else {
              updated.pic = [0, 8, 24];
            }
            break;
          case "text":
            updated.pic = [0, 0, 24];
            break;
          case "image":
            updated.pic = [0, 11, 20];
            break;
          case "tileset":
            updated.pic = [0, 19, 18];
            break;
          case "reference":
            updated.pic = [0, 9, 22];
            break;
          case "folder":
            if(OpenFolders[updated.id])
              updated.pic = [0, 2, 20];
            else
              updated.pic = [0, 1, 20];
            break;
        }
      }

      // add to DisplayInventory
      var folder = null;
      if(updated.folder && updated.folder in DBInventory) {
        folder = updated.folder;
      }
      if(folder in DisplayInventory) {
        DisplayInventory[folder].push(key);
      } else {
        DisplayInventory[folder] = [key];
      }
    }
  
    // sort by name or date later
    for(var key in DisplayInventory) {
      DisplayInventory[key].sort(function(a, b){return a - b});
    }

    updateInventoryUL();
    NeedInventoryUpdate = false;
  }

  // Tick each player's animation timer
  for(var id in PlayerAnimation) {
    if(PlayerAnimation[id].walkTimer) {
      PlayerAnimation[id].walkTimer--;
      if(!PlayerAnimation[id].walkTimer) {
        needMapRedraw = true;
      }
    }
  }

/*
  var Under = MapTiles[PlayerX][PlayerY];
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

  if(CameraX != TargetCameraX || CameraY != TargetCameraY) {
    var DifferenceX = TargetCameraX - CameraX;
    var DifferenceY = TargetCameraY - CameraY;
	var OldCameraX = CameraX;
	var OldCameraY = CameraY;

    var ShiftBy = 4;
    do {
      CameraX += DifferenceX >> ShiftBy;
      CameraY += DifferenceY >> ShiftBy;
      ShiftBy--;
      if(ShiftBy == -1)
        break;
    } while (CameraX == OldCameraX && CameraY == OldCameraY);

    if(!CameraAlwaysCenter) {
      if(MapWidth >= ViewWidth)
        CameraX = Math.min((MapWidth-ViewWidth)<<8, Math.max(CameraX, 0));
      else
        CameraX = -(Math.floor(ViewWidth/2)-Math.floor(MapWidth/2))<<8;
      if(MapHeight >= ViewHeight)
        CameraY = Math.min((MapHeight-ViewHeight)<<8, Math.max(CameraY, 0));
      else
        CameraY = -(Math.floor(ViewHeight/2)-Math.floor(MapHeight/2))<<8;
    }
    drawMap();
  } else if(AnimationTick % 5 == 0) { // every 0.1 seconds
    drawMap();
  } else if(NeedMapRedraw) {
    drawMap();
  }

  NeedMapRedraw = false;
  TickCounter = (TickCounter + 1) & 0xffff;
  AnimationTick = (AnimationTick + 1) % 10000;
}

function selectionCopy() {
  if(!MouseActive)
    return;

}

function selectionDelete() {
  if(!MouseActive)
    return;
  var DeleteTurfs = document.getElementById("turfselect").checked;
  var DeleteObjs = document.getElementById("objselect").checked;

  for(var x=MouseStartX; x<=MouseEndX; x++) {
    for(var y=MouseStartY; y<=MouseEndY; y++) {
      if(x < 0 || x > MapWidth || y < 0 || y > MapHeight)
        continue;
      if(DeleteTurfs)
        MapTiles[x][y] = MapInfo['default'];
      if(DeleteObjs)
        MapObjs[x][y] = [];        
    }
  }
  SendCmd("DEL", {pos: [MouseStartX, MouseStartY, MouseEndX, MouseEndY], turf: DeleteTurfs, obj: DeleteObjs});

  MouseActive = false;
  NeedMapRedraw = true;
  selectionInfoVisibility(false);
}

function selectionInfoVisibility(visibility) {
  document.getElementById("selectionInfo").style.display = visibility?'block':'none';
  if(!visibility)
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
    x: (evt.clientX - rect.x)|0,
    y: (evt.clientY - rect.y)|0
  };
}

function getMousePos(canvas, evt) {
  var rect = getExactPosition(canvas);

  return {
    x: ((evt.clientX - rect.x)/CameraScale)|0,
    y: ((evt.clientY - rect.y)/CameraScale)|0
  };
}

function getTilePos(evt) {
  var pos = getMousePos(mapCanvas, evt);
  pos.x = ((pos.x) + (CameraX>>4))>>4;
  pos.y = ((pos.y) + (CameraY>>4))>>4;
  return pos;
}

function initMouse() {
  var edittilesheetselect = document.getElementById("edittilesheetselect");

  edittilesheetselect.addEventListener('mousedown', function(evt) {
    var pos = getMousePosRaw(edittilesheetselect, evt);
    var container = document.getElementById('edittilesheetcontainer');
    pos.x = (container.scrollLeft + pos.x) >> 4;
    pos.y = (container.scrollTop + pos.y) >> 4;

    // update to choose the selected tile
    document.getElementById('edittilex').value = pos.x;
    document.getElementById('edittiley').value = pos.y;
    editItemUpdatePic();
  }, false);

  mapCanvas.addEventListener('mousedown', function(evt) {
    if(evt.button == 2)
      return;
    panel.innerHTML = "";
    var pos = getTilePos(evt);
    MouseDown = true;
    MouseStartX = pos.x;
    MouseStartY = pos.y;
    MouseEndX = pos.x;
    MouseEndY = pos.y;
    MouseActive = true;
    NeedMapRedraw = true;
    selectionInfoVisibility(false);
  }, false);

  mapCanvas.addEventListener('mouseup', function(evt) {
    if(evt.button == 2)
      return;
    MouseDown = false;
    NeedMapRedraw = true;

    // adjust the selection box
    var AX = Math.min(MouseStartX, MouseEndX);
    var AY = Math.min(MouseStartY, MouseEndY);
    var BX = Math.max(MouseStartX, MouseEndX);
    var BY = Math.max(MouseStartY, MouseEndY);
    MouseStartX = AX;
    MouseStartY = AY;
    MouseEndX = BX;
    MouseEndY = BY;

    var panelHTML = (BX-AX+1)+"x"+(BY-AY+1)+"<br>";
    updateSelectedObjectsUL();

    selectionInfoVisibility(true);

    panel.innerHTML = panelHTML;
  }, false);



  mapCanvas.addEventListener('wheel', function(event) {
    event.preventDefault();

    CameraScale += event.deltaY * -0.01;

    // Restrict CameraScale
    CameraScale = Math.min(Math.max(1, CameraScale), 8);

    resizeCanvas();
  }, false);

  mapCanvas.addEventListener('mousemove', function(evt) {
    var pos = getTilePos(evt);
    MouseNowX = pos.x;
	MouseNowY = pos.y;
    // record the nearby players
    var Around = PlayersAroundTile(MouseNowX, MouseNowY, 2);
    if(MousedOverPlayers.length != Around.length) {
      NeedMapRedraw = true;
    }
    MousedOverPlayers = Around;

    if(!MouseDown)
      return;
    if(pos.x != MouseEndX || pos.y != MouseEndY)
      NeedMapRedraw = true;
    MouseEndX = pos.x;
    MouseEndY = pos.y;
  }, false);
}

function viewInit() {
  ViewWidth = Math.floor(mapCanvas.width/16);
  ViewHeight = Math.floor(mapCanvas.height/16);
  
  var selector = document.getElementById("selector");
  selector.width = Math.max(240, parseInt(mapCanvas.style.width))+"";
  drawSelector();
  NeedMapRedraw = true;
}

function initBuild() {
  var canvas = document.getElementById('inventoryCanvas');
    // add click action
    canvas = document.getElementById('inventoryCanvas');
    var BuildWidth = 16;

    var len = Object.keys(Predefined).length;
    canvas.width = (BuildWidth*16)+"";
    canvas.height = (Math.ceil(len/BuildWidth)*16)+"";
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var count = 0;
    for(var i in Predefined) {
      var item = Predefined[i];
      ctx.drawImage(IconSheets[item.pic[0]], item.pic[1]*16, item.pic[2]*16, 16, 16, (count%BuildWidth)*16, Math.floor(count/BuildWidth)*16, 16, 16);
      count++;
    }

    canvas.addEventListener('mousedown', function(evt) {
      var pos = getMousePosRaw(inventoryCanvas, evt);
      pos.x = pos.x >> 4;
      pos.y = pos.y >> 4;
      var index = pos.y * BuildWidth + pos.x;

      if(evt.button == 0)
        useItem({type: 'map_tile', data: PredefinedArrayNames[index]});
//      else if(evt.button == 2)
//        addInventory(PredefinedArrayNames[index]);
    }, false);
}

function initWorld() {
  // initialize the world map
  initMap();

  chatInput = document.getElementById("chatInput");
  mapCanvas = document.getElementById("map");

  chatInput.addEventListener('input', function (evt) {
    if(this.value.length > 0){
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
  if(OnlineServer) {
    ConnectToServer();
  }

  {
    // Set up the login window
    // Get the modal
    let modal = document.getElementById('loginWindow');
    let itemmodal = document.getElementById('editItemWindow');
    let newitemmodal = document.getElementById('newItemWindow');
    let mapmodal = document.getElementById('mapOptionsWindow');

    let btn = document.getElementById("navlogin");
    let mapbtn = document.getElementById("navmap");
    let span = document.getElementsByClassName("modalclose");

    btn.onclick = function() {
      modal.style.display = "block";
    }

    mapbtn.onclick = function() {
      mapmodal.style.display = "block";
    }

    for(var i=0; i<span.length; i++) {
      span[i].onclick = function() {
        modal.style.display = "none";
        newitemmodal.style.display = "none";
        itemmodal.style.display = "none";
        mapmodal.style.display = "none";
      }
    }

    window.onclick = function(event) {
      if (event.target == modal) {
          modal.style.display = "none";
      }
      if (event.target == itemmodal) {
          itemmodal.style.display = "none";
      }
      if (event.target == newitemmodal) {
          newitemmodal.style.display = "none";
      }
      if (event.target == mapmodal) {
          mapmodal.style.display = "none";
      }
    }
  }

}

function applyOptions() {
  var vcenter = document.getElementById("alwayscenter");
  var vnotify = document.getElementById("audionotify");
  var vfly = document.getElementById("option-fly");

  CameraAlwaysCenter = vcenter.checked;
  AudioNotifications = vnotify.checked;
  Fly = vfly.checked;
}

function rightClick(evt) {
  return false;
}


function viewOptions() {
  var options = document.getElementById("options");
  var Hidden = (options.style.display=='none');
  document.getElementById("navoptions").setAttribute("class", Hidden?"navactive":"");
  options.style.display = Hidden?'block':'none';
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
  if(key in PlayerImages) {
    if(PlayerImages[key].naturalWidth != 16 || PlayerImages[key].naturalHeight != 16) {
      img.style.width = "32px";
      img.style.height = "32px";
    }

    src = PlayerImages[key].src;
  }

  if(item.pic != null)
    pic = item.pic;

  if(IconSheets[pic[0]])
    src = IconSheets[pic[0]].src;
  else
    src = pic[0];

  var background = "url("+src+") -"+(pic[1]*16)+"px -"+(pic[2]*16)+"px";
  img.style.background = background;

  img_container.appendChild(img);
  return img_container;
}

contextMenuItem = 0;
function openItemContextMenu(id, x, y) {
  var drop = document.querySelector('#droptakeitem');

  if ( id in DBInventory ) {
    drop.innerText = "Drop";
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
  if(!ul)
    return;

  // Empty out the list
  while(ul.firstChild) {
    ul.removeChild(ul.firstChild);
  }

  // Recursively make the tree with unordered lists
  function addFolder(list, key) {
    for(let i = 0; i < DisplayInventory[key].length; i++) {
      let id = DisplayInventory[key][i];

      let item = DBInventory[id];
      let li = document.createElement("li");

      li.appendChild(itemIcon(id));

      li.appendChild(document.createTextNode(" "+item.name));
      li.onclick = function (){useItem(item);};
      li.oncontextmenu = function(e){openItemContextMenu(id, e.clientX, e.clientY); return false;};
      li.classList.add('inventoryli');
      li.id = "inventory"+i;
      list.appendChild(li);

      if(id in DisplayInventory && OpenFolders[id]) {
        let inner = document.createElement("ul");
        addFolder(inner, id);
        list.appendChild(inner);
      }
    }
  }
  addFolder(ul, null);

  // Add the "new item" item
  let newitem = document.createElement("li");
  newitem.appendChild(document.createTextNode("+"));
  newitem.classList.add('inventoryli');
  newitem.id = "inventoryadd"
  newitem.onclick = function(){document.getElementById('newItemWindow').style.display = "block";};
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
  tileset_title.innerText = "Tileset: "+Item.name;
}

function viewCompose() {
  var compose = document.getElementById('compose');
  compose.style.display = 'block';
}

function inSelection( x, y ) {
  return x >= MouseStartX && x <= MouseEndX && y >= MouseStartY && y <= MouseEndY;
}

function updateSelectedObjectsUL() {
  // Manage the users <ul>
  var ul = document.getElementById('selectedobjectsul');
  if(!ul)
    return;

  // Empty out the list
  while(ul.firstChild) {
    ul.removeChild(ul.firstChild);
  }

  let obj_count = 0;

  for(var key in PlayerWho) {
    let user = PlayerWho[key];
    if ( !inSelection( user.x, user.y ) ) {
      continue;
    }

    obj_count++;

    // build the list item
    let li = document.createElement("li");
    li.appendChild(itemIcon(user.id));

    var line = " "+user.name;
    if("username" in user && user.username)
      line += " ("+user.username+")";
    else
      line += " ("+key+")";
    li.appendChild(document.createTextNode(line));
//    li.onclick = function (){useItem(item);};
//    li.oncontextmenu = function (){editItem(id); return false;};
//
    li.oncontextmenu = function(e){openItemContextMenu(user.id, e.clientX, e.clientY); return false;};
    li.classList.add('inventoryli');
    li.id = "userlist"+i;
    ul.appendChild(li);
  }

  if (obj_count < 1) {
    let li = document.createElement("li");
    li.appendChild(document.createTextNode("None"));
    ul.appendChild(li);
  }
}

function updateUsersUL() {
  // Manage the users <ul>
  var ul = document.getElementById('usersul');
  if(!ul)
    return;

  // Empty out the list
  while(ul.firstChild) {
    ul.removeChild(ul.firstChild);
  }

  for(var key in PlayerWho) {
    let li = document.createElement("li");
    let user = PlayerWho[key];

    // build the list item
    li.appendChild(itemIcon(user.id));

    var line = " "+user.name;
    if("username" in user && user.username)
      line += " ("+user.username+")";
    else
      line += " ("+key+")";
    li.appendChild(document.createTextNode(line));
//    li.onclick = function (){useItem(item);};
//    li.oncontextmenu = function (){editItem(id); return false;};
    li.oncontextmenu = function(e){openItemContextMenu(user.id, e.clientX, e.clientY); return false;};
    li.classList.add('inventoryli');
    li.id = "userlist"+i;
    ul.appendChild(li);
  }
}

function updateMailUL() {
  // Manage the users <ul>
  var ul = document.getElementById('mailul');
  if(!ul)
    return;

  // Empty out the list
  while(ul.firstChild) {
    ul.removeChild(ul.firstChild);
  }

  for(let i=0; i<Mail.length; i++) {
    let li = document.createElement("li");
    let letter = Mail[i];

    li.appendChild(document.createTextNode("\"" + letter.subject + "\" from " + letter.from));
    if(!(letter.flags & 1)) {
      li.appendChild(document.createTextNode(" (NEW)"));
    }

    li.onclick = function (){
      SendCmd("EML", {read: letter.id});
      Mail[i].flags |= 1; // mark as read locally
      updateMailUL(); // show it as read locally

      document.getElementById('mail-view').style.display = 'block';
      document.getElementById('mail-view-title').innerHTML = `Mail: ${convertBBCode(letter.subject)}`;
      document.getElementById('mail-view-contents').innerHTML = '<button onclick="replyMail('+letter.id+')">Reply</button>'
        +'<button onclick="replyAllMail('+letter.id+')">Reply all</button>'
        +'<button onclick="deleteMail('+letter.id+')">Delete</button><br>'
        +'<table border="0">'
        +'<tr><td>From</td><td>'+letter.from+'</td></tr>'
        +'<tr><td>To</td><td>'+letter.to.join(",")+'</td></tr>'
        +'</table><hr>'
        +convertBBCodeMultiline(letter.contents);
    };
    li.oncontextmenu = function (){return false;};

    li.classList.add('inventoryli');
    li.id = "maillist"+i;
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
  SendCmd("EML", {send: {"subject": subject, "contents": contents, "to": to}});
}

function replyMail(id) {
  // find mail by ID
  let index = -1;
  for(let i=0; i<Mail.length; i++) {
    if(Mail[i].id == id) {
      index = i;
      break;
    }
  }
  if(index == -1)
    return;

  viewCompose();
  document.getElementById('mailsendsubject').value = "RE: "+Mail[index].subject;
  document.getElementById('mailsendtext').value = "";
  document.getElementById('mailsendto').value = Mail[index]["from"];
}

function replyAllMail(id) {
  // find mail by ID
  let index = -1;
  for(let i=0; i<Mail.length; i++) {
    if(Mail[i].id == id) {
      index = i;
      break;
    }
  }
  if(index == -1)
    return;

  viewCompose();
  document.getElementById('mailsendsubject').value = "RE: "+Mail[index].subject;
  document.getElementById('mailsendtext').value = "";

  // add everyone to the list except yourself
  let to_list = [Mail[index]["from"]];
  for(let i=0; i<Mail[index]["to"].length; i++) {
    if(Mail[index]["to"][i] != PlayerWho[PlayerYou].username)
      to_list.push(Mail[index]["to"][i]);
  }
  document.getElementById('mailsendto').value = to_list.join(",");
}

function deleteMail(id) {
  if(!confirm("Really delete?"))
    return;

  let newMail = [];
  for(let i=0; i<Mail.length; i++) {
    if(Mail[i].id != id)
      newMail.push(Mail[i]);
  }
  Mail = newMail;
  updateMailUL();
  SendCmd("EML", {"delete": id});
  closeWindow("mail"+id);
}

function viewMail() {
  var mail = document.getElementById('mail');
  toggleDisplay(mail);

  var ul = document.getElementById('mailul');
  if(!ul) {
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
  var Hidden = (options.style.display=='none');
  document.getElementById("navcustomize").setAttribute("class", Hidden?"navactive":"");
  options.style.display = Hidden?'block':'none';
}

function previewIcon() {
  var preview = document.getElementById("iconPreview");
  var file    = document.getElementById("iconPicker").files[0];
  var reader  = new FileReader();

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
  if(!OnlineIsConnected)
    ConnectToServer();
  else
    SendCmd("CMD", {text: "login "+OnlineUsername+" "+OnlinePassword});

  document.getElementById('loginWindow').style.display = "none";
}

function editItemApply() {
  var edittilename = document.getElementById('edittilename').value;
  var edittiledesc = document.getElementById('edittiledesc').value;
  if(edittiledesc == "")
    edittiledesc = null;
  var edittilefolder = parseInt(document.getElementById('edittilefolder').value, 10);
  if(edittilefolder == -1) {
    edittilefolder = PlayerYou;
  }

  switch(editItemType) {
    case "text":
      SendCmd("BAG", {
        update: {"id": editItemID,
                 "name": edittilename,
                 "desc": edittiledesc,
                 "folder": edittilefolder,
                 "data": document.getElementById('edittiletextarea').value
                }
      });

      break;

    case "image":
      SendCmd("BAG", {
        update: {"id": editItemID,
                 "name": edittilename,
                 "desc": edittiledesc,
                 "folder": edittilefolder,
                 "data": document.getElementById('edittileurl').value
                }
      });
      break;

    case "map_tile":
    case "generic":
      // Gather item info
      var edittilesheet = parseInt(document.getElementById('edittilesheet').value);
      var edittilex = parseInt(document.getElementById('edittilex').value);
      var edittiley = parseInt(document.getElementById('edittiley').value);
      var edittiletype = document.getElementById('edittiletype').value;
      var edittiledensity = document.getElementById('edittiledensity').checked;
      var edittileobject = !document.getElementById('edittileisobject').checked;

      // Create the new item
      var item = {};
      item.name = edittilename;
      item.pic = [edittilesheet, edittilex, edittiley];
      item.density = edittiledensity;
      if(edittileobject)
        item.obj = true;
      if(edittiletype)
        item.type = edittiletype;

      if(editItemType == "map_tile") {
        SendCmd("BAG", {
          update: {"id": editItemID,
                   "name": edittilename,
                   "desc": edittiledesc,
                   "folder": edittilefolder,
                   "data": JSON.stringify(item)
                  }
        });
      } else if(editItemType == "generic") {
        SendCmd("BAG", {
          update: {"id": editItemID,
                   "name": edittilename,
                   "desc": edittiledesc,
                   "folder": edittilefolder,
                   "pic": item.pic
                  }
        });
      }
      break;

    default: // just update name then
      SendCmd("BAG", {
        update: {"id": editItemID,
                 "name": edittilename,
                 "desc": edittiledesc,
                 "folder": edittilefolder
                }
      });
      break;
  }
  editItemCancel();
}

function editItemClone() {
  SendCmd("BAG", {"clone": {"id": editItemID} });
  editItemCancel();
}

function editItemDelete() {
  if(!confirm("Really delete?"))
    return;
  SendCmd("BAG", {"delete": {"id": editItemID} });
  editItemCancel();
}

function editItemCancel() {
  document.getElementById('editItemWindow').style.display = "none";
  editItemID = null;
}

function newItemCreate(type) {
  SendCmd("BAG", {create: {"type": type, "name": document.getElementById('newtilename').value}});
  newItemCancel();
}

function newItemCancel() {
  document.getElementById('newItemWindow').style.display = "none";
}

/////////////////////////////////////////////////////////////////////
// customize the bbcode parser
function offerCommand(t) {
  if(confirm('Run command "'+t+'"?')) {
    sendChatCommand(t);
  }
}

let emptyTag = {
  openTag: function(params,content) {
    return '';
  },
  closeTag: function(params,content) {
    return '';
  }
}
XBBCODE.addTags({
  "tt": XBBCODE.tags()["code"],
  "img": emptyTag,
  "center": emptyTag,
  "face": emptyTag,
  "font": emptyTag,
  "justify": emptyTag,
  "left": emptyTag,
  "quote": emptyTag,
  "php": emptyTag,
  "right": emptyTag,
  "table": emptyTag,
  "tbody": emptyTag,
  "thead": emptyTag,
  "tfoot": emptyTag,
  "td": emptyTag,
  "th": emptyTag,
  "tr": emptyTag,
  "command": {
    openTag: function(params,content) {
      let filteredJS = content.replace(/\x22/g, '\\\x22');
      let filteredHTML = content.replace(/\x22/g, '&quot;');
      return '<input type="button" value="'+filteredHTML+'" onClick=\'offerCommand("'+filteredJS+'")\'></input>';
    },
    closeTag: function(params,content) {
      return '';
    },
    displayContent: false
  },
  "spoiler": {
    openTag: function(params,content) {
        return '<span class="spoiler">';
    },
    closeTag: function(params,content) {
        return '</span>';
    }
  }
});


function resizeCanvas() {
  // get camera target
  var cameraCenterX = CameraX + mapCanvas.width*8;
  var cameraCenterY = CameraY + mapCanvas.height*8;

  var parent = mapCanvas.parentNode;
  var r = parent.getBoundingClientRect();
  mapCanvas.width = r.width / CameraScale;
  mapCanvas.height = r.height / CameraScale;

  ViewWidth = Math.ceil(mapCanvas.width/16);
  ViewHeight = Math.ceil(mapCanvas.height/16);

  // move camera to same relative position
  CameraX = cameraCenterX - mapCanvas.width*8;
  CameraY = cameraCenterY - mapCanvas.height*8;

  drawMap();
  drawSelector();
}
