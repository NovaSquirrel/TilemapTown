/*
 * Building game
 *
 * Copyright (C) 2017 NovaSquirrel
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
var TickCounter = 0;
var Inventory = [];

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min;
}

function logMessage(Message) {
  var chatArea = document.getElementById("chatArea");
  var bottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 1;
  chatArea.innerHTML += Message + "<br>";
  if(bottom)
    chatArea.scrollTop = chatArea.scrollHeight;
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
function editItem(index) {
  // open up the item editing screen for a given item
  var li = document.getElementById('inventory'+index);
  li.appendChild(document.createTextNode("?"));
  editItemIndex = index;

  var item = AtomFromName(Inventory[index]);
  document.getElementById('edittilename').value = item.name;
  document.getElementById('edittilesheet').value = item.pic[0];
  document.getElementById('edittilex').value = item.pic[1];
  document.getElementById('edittiley').value = item.pic[2];
  document.getElementById('edittiletype').selectedIndex = item.type;
  document.getElementById('edittiledensity').checked = item.density;
  document.getElementById('edittileobject').checked = !item.obj;
  editItemUpdatePic();

  document.getElementById('edittilesheetselect').src = IconSheets[item.pic[0]].src;

  document.getElementById('editItemWindow').style.display = "block";
}

function useItem(Placed) {
  var PlayerX = PlayerWho[PlayerYou].x;
  var PlayerY = PlayerWho[PlayerYou].y;

  var ActualAtom = AtomFromName(Placed);

  // place the item on the ground
  if(ActualAtom.obj) {
    if(ActualAtom.type == AtomTypes.SIGN) {
      Placed = CloneAtom(ActualAtom);
      Message = prompt("What should the sign say?");
      if(Message == null)
        return;
      Placed.message = Message;
    }
    MapObjs[PlayerX][PlayerY].push(Placed);
    SendCmd("PUT", {pos: [PlayerX, PlayerY], obj: true, atom: MapObjs[PlayerX][PlayerY]});
  } else {
    MapTiles[PlayerX][PlayerY] = Placed;
    SendCmd("PUT", {pos: [PlayerX, PlayerY], obj: false, atom: MapTiles[PlayerX][PlayerY]});
  }
  drawMap();
}

function keyHandler(e) {
 
  function ClampPlayerPos() {
    PlayerX = Math.min(Math.max(PlayerX, 0), MapWidth-1);
    PlayerY = Math.min(Math.max(PlayerY, 0), MapHeight-1);;
  }

  var e = e || window.event;

  // ignore keys when typing in a textbox
  if(document.activeElement.tagName == "INPUT") {
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
    if(!Inventory[n])
      return;
    useItem(Inventory[n]);
  } else if (e.keyCode == 38) { // up
    PlayerY--;
    PlayerDir = Directions.NORTH;
  } else if (e.keyCode == 40) { // down
    PlayerY++;
    PlayerDir = Directions.SOUTH;
  } else if (e.keyCode == 37) { // left
    PlayerX--;
    PlayerDir = Directions.WEST;
  } else if (e.keyCode == 39) { // right
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
          logMessage("The sign says: "+Escaped);
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
    var item = AtomFromName(Inventory[i]);
    if(item) {
      ctx.drawImage(IconSheets[item.pic[0]], item.pic[1]*16, item.pic[2]*16, 16, 16, i*oneWidth+16, 0, 16, 16);
    }
  }
}

function tickWorld() {
  var TargetCameraX = (PlayerWho[PlayerYou].x-Math.floor(ViewWidth/2))<<8;
  var TargetCameraY = (PlayerWho[PlayerYou].y-Math.floor(ViewHeight/2))<<8;

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
      useItem(PredefinedArrayNames[index]);
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

  Inventory = ["grass", "stonewall"];
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

    let btn = document.getElementById("navlogin");
    let span = document.getElementsByClassName("modalclose");

    btn.onclick = function() {
      modal.style.display = "block";
    }

    for(var i=0; i<span.length; i++) {
      span[i].onclick = function() {
        modal.style.display = "none";
        itemmodal.style.display = "none";
      }
    }

    window.onclick = function(event) {
      if (event.target == modal) {
          modal.style.display = "none";
      }
      if (event.target == itemmodal) {
          itemmodal.style.display = "none";
      }
    }
  }

}

function applyOptions() {
  var vwidth = document.getElementById("viewwidth");
  var vheight = document.getElementById("viewheight");
  var vdouble = document.getElementById("doublezoom");
  var vcenter = document.getElementById("alwayscenter");

  ViewWidth = parseInt(vwidth.value);
  ViewHeight = parseInt(vheight.value);
  CameraAlwaysCenter = vcenter.checked;

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
  Inventory = [];
  drawSelector();
}

function addInventory(item) {
  Inventory.push(item);
  drawSelector();
  updateInventoryUL();
}

function addNewInventoryItem() {
  var item = {};
  item.name = "New item";
  item.pic = [0, 2, 19];
  item.density = false;
  item.obj = true;
  addInventory(item);
}

function updateInventoryUL() {
  // Manage the inventory <ul>
  var ul = document.getElementById('inventoryul');
  // Empty out the list
  while(ul.firstChild) {
    ul.removeChild(ul.firstChild);
  }
  // Add each item
  for(let i = 0; i < Inventory.length; i++) {
    let item_raw = Inventory[i];
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
  newitem.onclick = addNewInventoryItem;
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

/*
	var img = document.getElementById();
    var img = document.createElement("img");
	img.src = reader.result;
    var element = document.getElementById("playerAvatars");
    element.appendChild(img);
*/
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
  // Gather item info
  var edittilename = document.getElementById('edittilename').value;
  var edittilesheet = parseInt(document.getElementById('edittilesheet').value);
  var edittilex = parseInt(document.getElementById('edittilex').value);
  var edittiley = parseInt(document.getElementById('edittiley').value);
  var edittiletype = parseInt(document.getElementById('edittiletype').value);
  var edittiledensity = document.getElementById('edittiledensity').checked;
  var edittileobject = !document.getElementById('edittileobject').checked;

  // Create the new item
  var item = {};
  item.name = edittilename;
  item.pic = [edittilesheet, edittilex, edittiley];
  item.density = edittiledensity;
  if(edittileobject)
    item.obj = true;
  if(edittiletype)
    item.type = edittiletype;
  Inventory[editItemIndex] = item;

  drawSelector();
  updateInventoryUL();

  editItemCancel();
}

function editItemClone() {
  addInventory(Inventory[editItemIndex]);
  editItemCancel();
}

function editItemDelete() {
  if(!confirm("Really delete?"))
    return;
  Inventory.splice(editItemIndex, 1);

  drawSelector();
  updateInventoryUL();

  editItemCancel();
}

function editItemCancel() {
  document.getElementById('editItemWindow').style.display = "none";
  editItemIndex = null;
}
