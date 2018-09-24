/*
 * Tilemap Town
 *
 * Copyright (C) 2017-2018 NovaSquirrel
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
var PlayerWho = {me: {name: "Player", pic: [0, 2, 25], x: 5, y: 5}};
var PlayerYou = "me";
var PlayerImages = {}; // dictionary of Image objects

// camera settings
var ViewWidth;
var ViewHeight;
var CameraX = 0;
var CameraY = 0;
var CameraAlwaysCenter = true;

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
var TickCounter = 0;
var DisplayInventory = [];
var DBInventory = {};
var OpenFolders = {};

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
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
  chatArea.innerHTML += '<span class="'+Class+'">'+ Message + "</span><br>";
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
}

function sendChatCommand(the_text) {
  SendCmd("CMD", {text: the_text});
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

  var src = IconSheets[edittilesheet].src;
  document.getElementById('edittilepic').style.background = "url("+src+") -"+(edittilex*16)+"px -"+(edittiley*16)+"px";
  document.getElementById('edittilesheetselect').src = src;
}

editItemIndex = null;
editItemType = null;
editItemID = null;
function editItem(index) {
  // open up the item editing screen for a given item
//  var li = document.getElementById('inventory'+index);
//  li.appendChild(document.createTextNode("?"));
  editItemIndex = index;

  // change to use DBInventory instead
  var item = DisplayInventory[index];
  var itemobj = null;
  editItemType = item.type;
  editItemID = item.id;

  document.getElementById('edittileobject').style.display = "none";
  document.getElementById('edittiletext').style.display = "none";
  document.getElementById('edittilename').value = item.name;
  document.getElementById('edittiledesc').value = item.desc;
  switch(item.type) {
    case 1: // text
      document.getElementById('edittiletext').style.display = "block";
      if(item.data)
        document.getElementById('edittiletextarea').value = item.data;
      else
        document.getElementById('edittiletextarea').value = "";
      break;
    case 3: // object
      itemobj = AtomFromName(DisplayInventory[index].data);
      if(itemobj == null) {
        itemobj = {pic: [0, 8, 24]};
      }
      document.getElementById('edittileobject').style.display = "block";
      document.getElementById('edittilesheet').value = itemobj.pic[0];
      document.getElementById('edittilex').value = itemobj.pic[1];
      document.getElementById('edittiley').value = itemobj.pic[2];
      document.getElementById('edittiletype').selectedIndex = itemobj.type;
      document.getElementById('edittiledensity').checked = itemobj.density;
      document.getElementById('edittileisobject').checked = !itemobj.obj;
      editItemUpdatePic();

      document.getElementById('edittilesheetselect').src = IconSheets[itemobj.pic[0]].src;

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
    if(DBInventory[i].type == 6) { // folder
      el = document.createElement("option");
      el.textContent = DBInventory[i].name;
      el.value = DBInventory[i].id;
      select.appendChild(el);
    }
  }
  document.getElementById('edittilefolder').value = item.folder || -1;

  // show the window
  document.getElementById('editItemWindow').style.display = "block";
}

function useItem(Placed) {
  var PlayerX = PlayerWho[PlayerYou].x;
  var PlayerY = PlayerWho[PlayerYou].y;

  switch(Placed.type) {
    case 6: // folder
      OpenFolders[Placed.id] = !OpenFolders[Placed.id];
      NeedInventoryUpdate = true;
      break;
    case 3: // object
      var ActualAtom = AtomFromName(Placed.data);
      // place the item on the ground
      if(ActualAtom.obj) {
        if(ActualAtom.type == AtomTypes.SIGN) {
          Placed = {data: CloneAtom(ActualAtom)};
          Message = prompt("What should the sign say?");
          if(Message == null)
            return;
          Placed.message = Message;
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

function keyHandler(e) {
 
  function ClampPlayerPos() {
    PlayerX = Math.min(Math.max(PlayerX, 0), MapWidth-1);
    PlayerY = Math.min(Math.max(PlayerY, 0), MapHeight-1);;
  }

  var e = e || window.event;

  // ignore keys when typing in a textbox
  if(document.activeElement.tagName == "INPUT" || document.activeElement.tagName == "TEXTAREA") {
    if(document.activeElement == chatInput && e.keyCode == 13) {
      if(chatInput.value.toLowerCase() == "/clear") {
        chatArea.innerHTML = "";
      } 
      // commands are CMD while regular room messages are MSG. /me is a room message.
      else if(chatInput.value.slice(0,1) == "/" && chatInput.value.toLowerCase().slice(0,4) != "/me ") {
        SendCmd("CMD", {text: chatInput.value.slice(1)}); // remove the /
      } else {
        SendCmd("MSG", {text: chatInput.value});
      }
      chatInput.value = "";
    }
    return;
  }

  var needRedraw = false;

  var PlayerX = PlayerWho[PlayerYou].x;
  var PlayerY = PlayerWho[PlayerYou].y;
  var OldPlayerX = PlayerX;
  var OldPlayerY = PlayerY;

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
    if(!DisplayInventory[n])
      return;
    useItem(DisplayInventory[n]);
  } else if (e.keyCode == 38 || e.keyCode == 87) { // up/w
    PlayerY--;
    PlayerDir = Directions.NORTH;
  } else if (e.keyCode == 40 || e.keyCode == 83) { // down/s
    PlayerY++;
    PlayerDir = Directions.SOUTH;
  } else if (e.keyCode == 37 || e.keyCode == 65) { // left/a
    PlayerX--;
    PlayerDir = Directions.WEST;
  } else if (e.keyCode == 39 || e.keyCode == 68) { // right/d
    PlayerX++;
    PlayerDir = Directions.EAST;
  } else if (e.keyCode == 35) { // end
    PlayerX--;
    PlayerY++;
    PlayerDir = Directions.SOUTHWEST;
  } else if (e.keyCode == 34) { // pg down
    PlayerX++;
    PlayerY++;
    PlayerDir = Directions.SOUTHEAST;
  } else if (e.keyCode == 36) { // home
    PlayerX--;
    PlayerY--;
    PlayerDir = Directions.NORTHWEST;
  } else if (e.keyCode == 33) { // pg up
    PlayerX++;
    PlayerY--;
    PlayerDir = Directions.NORTHEAST;
  }

  ClampPlayerPos();

  // go back if the turf is solid
  if(OldPlayerX != PlayerX || OldPlayerY != PlayerY) {
    if(AtomFromName(MapTiles[PlayerX][PlayerY]).density) {
      PlayerX = OldPlayerX;
      PlayerY = OldPlayerY;
    }
    // or if there are any solid objects in the way
    for (var index in MapObjs[PlayerX][PlayerY]) {
      var Obj = AtomFromName(MapObjs[PlayerX][PlayerY][index]);
      if(Obj.density) {
        PlayerX = OldPlayerX;
        PlayerY = OldPlayerY;
        if(Obj.type == AtomTypes.SIGN) {
          // Filter out HTML tag characters to prevent XSS
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
          logMessage("The sign says: "+convertBBCode(Obj.message), "server_message");
        }
        break;
      }
    }

    if(OldPlayerX != PlayerX || OldPlayerY != PlayerY)
      SendCmd("MOV", {from: [OldPlayerX, OldPlayerY], to: [PlayerX, PlayerY], dir: PlayerDir});
    PlayerWho[PlayerYou].x = PlayerX;
    PlayerWho[PlayerYou].y = PlayerY;
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
        ctx.drawImage(IconSheets[Tile.pic[0]], Tile.pic[1]*16, Tile.pic[2]*16, 16, 16, x*16-OffsetX, y*16-OffsetY, 16, 16);
      }
      // Draw anything above the turf
      var Objs = MapObjs[RX][RY];
      if(Objs) {
        for (var index in Objs) {
          var Obj = AtomFromName(Objs[index]);
          ctx.drawImage(IconSheets[Obj.pic[0]], Obj.pic[1]*16, Obj.pic[2]*16, 16, 16, x*16-OffsetX, y*16-OffsetY, 16, 16);
        }
      }
    }
  }

  // Draw the player
//  ctx.drawImage(document.getElementById(PlayerIconSheet), PlayerIconX*16, PlayerIconY*16, 16, 16, (PlayerX*16)-PixelCameraX, (PlayerY*16)-PixelCameraY, 16, 16);

  for (var index in PlayerWho) {
    var IsMousedOver = false;
    for (var look=0; look<MousedOverPlayers.length; look++) {
      if(MousedOverPlayers[look] == index) {
        IsMousedOver = true;
        break;
      }
    }

    var Mob = PlayerWho[index];
    if(index in PlayerImages) {
      ctx.drawImage(PlayerImages[index], Mob.pic[1]*16, Mob.pic[2]*16, 16, 16, (Mob.x*16)-PixelCameraX, (Mob.y*16)-PixelCameraY, 16, 16);
    } else {
      ctx.drawImage(IconSheets[Mob.pic[0]], Mob.pic[1]*16, Mob.pic[2]*16, 16, 16, (Mob.x*16)-PixelCameraX, (Mob.y*16)-PixelCameraY, 16, 16);
    }
    if(IsMousedOver)
      drawText(ctx, (Mob.x*16)-PixelCameraX-(Mob.name.length * 8 / 2 - 8), (Mob.y*16)-PixelCameraY-16, Mob.name);
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
  var canvas = document.getElementById("selector");
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw ten inventory items
  var oneWidth = canvas.width/10;
  for(var i=0; i<10; i++) {
    drawText(ctx, i*oneWidth, 0, ((i+1)%10)+"");
    var item = AtomFromName(DisplayInventory[i]);
    if(item) {
      ctx.drawImage(IconSheets[item.pic[0]], item.pic[1]*16, item.pic[2]*16, 16, 16, i*oneWidth+16, 0, 16, 16);
    }
  }
}

function tickWorld() {
  var TargetCameraX = (PlayerWho[PlayerYou].x-Math.floor(ViewWidth/2))<<8;
  var TargetCameraY = (PlayerWho[PlayerYou].y-Math.floor(ViewHeight/2))<<8;

  if(NeedInventoryUpdate) {
    DisplayInventory = [];
    for(var key in DBInventory) {
      if(DBInventory[key].type == 3 || DBInventory[key].type == 4) { // object or tileset
        if(typeof DBInventory[key].data == "string" &&
          (DBInventory[key].data[0] == '[' || DBInventory[key].data[0] == '{')) // convert from JSON if needed
          DBInventory[key].data = JSON.parse(DBInventory[key].data);
      }

      let updated = DBInventory[key];
      if(updated.folder && updated.folder in DBInventory && !(OpenFolders[updated.folder])) {
        continue; // don't add
      }

      // always reload the picture, for now
      if(true) {
        switch(updated.type) {
          case 0: // dummy
            updated.pic = [0, 8, 24];
            break;
          case 3: // object
            // allow for string data like "grass"
            var temp = AtomFromName(updated.data);
            if(temp && temp.pic) {
              updated.pic = temp.pic;
            } else {
              updated.pic = [0, 8, 24];
            }
            break;
          case 1: // text
            updated.pic = [0, 0, 24];
            break;
          case 2: // image
            updated.pic = [0, 11, 20];
            break;
          case 4: // tileset
            updated.pic = [0, 19, 18];
            break;
          case 5: // reference
            updated.pic = [0, 9, 22];
            break;
          case 6: // folder
            if(OpenFolders[updated.id])
              updated.pic = [0, 2, 20];
            else
              updated.pic = [0, 1, 20];
            break;
        }
      }
      DisplayInventory.push(updated);
    }
    // sort by name or date later
    DisplayInventory.sort(function(a, b){return a.id - b.id});

    updateInventoryUL();
    NeedInventoryUpdate = false;
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
  } else if(NeedMapRedraw) {
    drawMap();
    NeedMapRedraw = false;
  }
  TickCounter = (TickCounter + 1) & 0xffff;
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
        MapTiles[x][y] = "grass";
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

// sets up the mouse event listeners
function initMouse() {
  var inventoryCanvas = document.getElementById("inventoryCanvas");
  var edittilesheetselect = document.getElementById("edittilesheetselect");

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
    var xratio = canvas.width / parseInt(canvas.style.width);
    var yratio = canvas.height / parseInt(canvas.style.height);

    return {
      x: ((evt.clientX - rect.x)*xratio)|0,
      y: ((evt.clientY - rect.y)*yratio)|0
    };
  }

  function getTilePos(evt) {
    var pos = getMousePos(mapCanvas, evt);
    pos.x = ((pos.x) + (CameraX>>4))>>4;
    pos.y = ((pos.y) + (CameraY>>4))>>4;
    return pos;
  }

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

  inventoryCanvas.addEventListener('mousedown', function(evt) {
    var pos = getMousePosRaw(inventoryCanvas, evt);
    pos.x = pos.x >> 4;
    pos.y = pos.y >> 4;
    var index = pos.y * ViewWidth + pos.x;

    if(evt.button == 0)
      useItem({type: 3, data: PredefinedArrayNames[index]});
    else if(evt.button == 2)
      addInventory(PredefinedArrayNames[index]);
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

    selectionInfoVisibility(true);

    panel.innerHTML = panelHTML;
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

function initWorld() {
  // initialize the world map
  initMap();

  chatInput = document.getElementById("chatInput");
  mapCanvas = document.getElementById("map");

  DisplayInventory = []; //["grass", "stonewall"];
  viewInit();

  panel = document.getElementById("panel");
  panel.innerHTML = "";

  initMouse();

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
  var vwidth = document.getElementById("viewwidth");
  var vheight = document.getElementById("viewheight");
  var vdouble = document.getElementById("doublezoom");
  var vcenter = document.getElementById("alwayscenter");
  var vnotify = document.getElementById("audionotify");

  ViewWidth = parseInt(vwidth.value);
  ViewHeight = parseInt(vheight.value);
  CameraAlwaysCenter = vcenter.checked;
  AudioNotifications = vnotify.checked;

  mapCanvas.width = ViewWidth*16;
  mapCanvas.height = ViewHeight*16;
  if(vdouble.checked) {
    mapCanvas.style.width = (ViewWidth*32)+"px";
    mapCanvas.style.height = (ViewHeight*32)+"px";
  } else {
    mapCanvas.style.width = (ViewWidth*16)+"px";
    mapCanvas.style.height = (ViewHeight*16)+"px";
  }
  viewInit();
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

function clearInventory() {
  DisplayInventory = [];
  drawSelector();
}

function addInventory(item) {
  DisplayInventory.push(item);
  drawSelector();
  updateInventoryUL();
}

function updateInventoryUL() {
  // Manage the inventory <ul>
  var ul = document.getElementById('inventoryul');
  // Empty out the list
  while(ul.firstChild) {
    ul.removeChild(ul.firstChild);
  }
  // Add each item
  for(let i = 0; i < DisplayInventory.length; i++) {
    let item_raw = DisplayInventory[i];
    let item = AtomFromName(item_raw);
    let li = document.createElement("li");

    // create a little icon for the item
    var img = document.createElement("img");
    img.src = "img/transparent.png";
    img.style.width = "16px";
    img.style.height = "16px";
    var src = IconSheets[item.pic[0]].src;
    var background = "url("+src+") -"+(item.pic[1]*16)+"px -"+(item.pic[2]*16)+"px";
    img.style.background = background;

    // build the list item
    li.appendChild(img);
    li.appendChild(document.createTextNode(" "+item.name));
    li.onclick = function (){useItem(item_raw);};
    li.oncontextmenu = function (){editItem(i); return false;};
    li.classList.add('inventoryli');
    li.id = "inventory"+i;
    ul.appendChild(li);
  }
  // Add the "new item" item
  let newitem = document.createElement("li");
  newitem.appendChild(document.createTextNode("+"));
  newitem.classList.add('inventoryli');
  newitem.onclick = function(){document.getElementById('newItemWindow').style.display = "block";};
  ul.appendChild(newitem);
}

function viewInventory() {
  var options = document.getElementById("inventory");
  var Hidden = (options.style.display=='none');
  document.getElementById("navinventory").setAttribute("class", Hidden?"navactive":"");
  options.style.display = Hidden?'block':'none';
  if(!Hidden)
    return;

/*
  var Complete = "<input type='button' value='Clear' onclick='clearInventory();'><br>";
  for(var i in Predefined) {
     Complete+="<a href='#' onclick='addInventory(\""+i+"\");'>"+Predefined[i].name+"</a><br>"
  }
  options.innerHTML = Complete;
*/

  updateInventoryUL();

  var canvas = document.getElementById("inventoryCanvas");
  var len = Object.keys(Predefined).length;
  canvas.width = (ViewWidth*16)+"";
  canvas.height = (Math.ceil(len/ViewWidth)*16)+"";
  var ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  var count = 0;
  for(var i in Predefined) {
    var item = Predefined[i];
    ctx.drawImage(IconSheets[item.pic[0]], item.pic[1]*16, item.pic[2]*16, 16, 16, (count%ViewWidth)*16, Math.floor(count/ViewWidth)*16, 16, 16);
    count++;
  }

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
  var edittilefolder = parseInt(document.getElementById('edittilefolder').value, 10);
  if(edittilefolder == -1) {
    edittilefolder = null;
  }

  switch(editItemType) {
    case 1: // text
      SendCmd("BAG", {
        update: {"id": editItemID,
                 "name": edittilename,
                 "desc": edittiledesc,
                 "folder": edittilefolder,
                 "data": document.getElementById('edittiletextarea').value
                }
      });

      break;

    case 3: // object
      // Gather item info
      var edittilesheet = parseInt(document.getElementById('edittilesheet').value);
      var edittilex = parseInt(document.getElementById('edittilex').value);
      var edittiley = parseInt(document.getElementById('edittiley').value);
      var edittiletype = parseInt(document.getElementById('edittiletype').value);
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

      SendCmd("BAG", {
        update: {"id": editItemID,
                 "name": edittilename,
                 "desc": edittiledesc,
                 "folder": edittilefolder,
                 "data": JSON.stringify(item)
                }
      });
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
  SendCmd("BAG", { clone: editItemID });
  editItemCancel();
}

function editItemDelete() {
  if(!confirm("Really delete?"))
    return;
  SendCmd("BAG", {"delete": editItemID});
  editItemCancel();
}

function editItemCancel() {
  document.getElementById('editItemWindow').style.display = "none";
  editItemIndex = null;
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
