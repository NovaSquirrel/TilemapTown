// todo: replace with actual mob drawing
var PlayerX = 5;
var PlayerY = 5;
var PlayerIconSheet = "potluck";
var PlayerIconX = 2;
var PlayerIconY = 25;

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
var MouseActive = false; // is there a selection right now?

// document elements
var mapCanvas = null; // main map view
var selCanvas = null; // selector
var chatInput = null;
var panel = null;

var NeedMapRedraw = false;

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

function useItem(Placed) {
  // place the item on the ground
  if(Placed.obj) {
    if(Placed.type == AtomTypes.SIGN) {
      Placed = CloneAtom(Placed);
      Message = prompt("What should the sign say?");
      if(Message == null)
        return;
      Placed.message = Message;
    }
    MapObjs[PlayerX][PlayerY].push(Placed);
  } else {
    MapTiles[PlayerX][PlayerY] = Placed;
  }
  drawMap();
}

function keyHandler(e) {
  var e = e || window.event;

  // ignore keys when typing in a textbox
  if(document.activeElement.tagName == "INPUT") {
    if(document.activeElement == chatInput && e.keyCode == 13) {
      logMessage(chatInput.value);
      chatInput.value = "";
    }
    return;
  }

  var needRedraw = false;

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
  } else if (e.keyCode == 40) { // down
    PlayerY++;
  } else if (e.keyCode == 37) { // left
    PlayerX--;
  } else if (e.keyCode == 39) { // right
    PlayerX++;
  } else if (e.keyCode == 35) { // end
    PlayerX--;
    PlayerY++;
  } else if (e.keyCode == 34) { // pg down
    PlayerX++;
    PlayerY++;
  } else if (e.keyCode == 36) { // home
    PlayerX--;
    PlayerY--;
  } else if (e.keyCode == 33) { // pg up
    PlayerX++;
    PlayerY--;
  }

  PlayerX = Math.min(Math.max(PlayerX, 0), MapWidth-1);
  PlayerY = Math.min(Math.max(PlayerY, 0), MapHeight-1);

  // go back if the turf is solid
  if(OldPlayerX != PlayerX || OldPlayerY != PlayerY) {
    if(MapTiles[PlayerX][PlayerY].density) {
      PlayerX = OldPlayerX;
      PlayerY = OldPlayerY;
    }
    // or if there are any solid objects in the way
    for (var index in MapObjs[PlayerX][PlayerY]) {
      var Obj = MapObjs[PlayerX][PlayerY][index];
      if(Obj.density) {
        PlayerX = OldPlayerX;
        PlayerY = OldPlayerY;
        if(Obj.type == AtomTypes.SIGN) {
          logMessage("The sign says: "+Obj.message);
        }
        break;
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

  var pot = document.getElementById("potluck");

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
      var Tile = MapTiles[RX][RY];
      if(Tile) {
        ctx.drawImage(IconSheets[Tile.pic[0]], Tile.pic[1]*16, Tile.pic[2]*16, 16, 16, x*16-OffsetX, y*16-OffsetY, 16, 16);
      }
      // Draw anything above the turf
      var Objs = MapObjs[RX][RY];
      if(Objs) {
        for (var index in Objs) {
          var Obj = Objs[index];
          ctx.drawImage(IconSheets[Obj.pic[0]], Obj.pic[1]*16, Obj.pic[2]*16, 16, 16, x*16-OffsetX, y*16-OffsetY, 16, 16);
        }
      }

    }
  }

  // Draw the player
//  ctx.drawImage(pot, 2*16, 25*16, 16, 16, (PlayerX*16)-PixelCameraX, (PlayerY*16)-PixelCameraY, 16, 16);
  ctx.drawImage(document.getElementById(PlayerIconSheet), PlayerIconX*16, PlayerIconY*16, 16, 16, (PlayerX*16)-PixelCameraX, (PlayerY*16)-PixelCameraY, 16, 16);

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
    var item = Inventory[i];
    if(item) {
      ctx.drawImage(IconSheets[item.pic[0]], item.pic[1]*16, item.pic[2]*16, 16, 16, i*oneWidth+16, 0, 16, 16);
    }
  }
}

function tickWorld() {
  var TargetCameraX = (PlayerX-Math.floor(ViewWidth/2))<<8;
  var TargetCameraY = (PlayerY-Math.floor(ViewHeight/2))<<8;

  if(CameraX != TargetCameraX || CameraY != TargetCameraY) {
    var DifferenceX = TargetCameraX - CameraX;
    var DifferenceY = TargetCameraY - CameraY;
    CameraX += DifferenceX >> 4;
    CameraY += DifferenceY >> 4;
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
        MapTiles[x][y] = Predefined.grass;
      if(DeleteObjs)
        MapObjs[x][y] = [];        
    }
  }
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

  function getMousePosRaw(canvas, evt) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - rect.left)|0,
      y: (evt.clientY - rect.top)|0
    };
  }

  function getMousePos(canvas, evt) {
    var rect = canvas.getBoundingClientRect();
    var xratio = canvas.width / parseInt(canvas.style.width);
    var yratio = canvas.height / parseInt(canvas.style.height);

    return {
      x: ((evt.clientX - rect.left)*xratio)|0,
      y: ((evt.clientY - rect.top)*yratio)|0
    };
  }

  function getTilePos(evt) {
    var pos = getMousePos(mapCanvas, evt);
    pos.x = ((pos.x) + (CameraX>>4))>>4;
    pos.y = ((pos.y) + (CameraY>>4))>>4;
    return pos;
  }

  inventoryCanvas.addEventListener('mousedown', function(evt) {
    var pos = getMousePosRaw(inventoryCanvas, evt);
    pos.x = pos.x >> 4;
    pos.y = pos.y >> 4;
    var index = pos.y * ViewWidth + pos.x;
    useItem(PredefinedArray[index]);
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
    if(!MouseDown)
      return;
    var pos = getTilePos(evt);
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

  Inventory = [Predefined.grass, Predefined.dirt, Predefined.purplesand, Predefined.stonewall, Predefined.flower3, Predefined.sign, Predefined.icecream];
  viewInit();

  panel = document.getElementById("panel");
  panel.innerHTML = "";

  initMouse();

  window.setInterval(tickWorld, 20);
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
  Inventory.push(Predefined[item]);
  drawSelector();
}

function viewInventory() {
  var options = document.getElementById("inventory");
  var Hidden = (options.style.display=='none');
  document.getElementById("navinventory").setAttribute("class", Hidden?"navactive":"");
  options.style.display = Hidden?'block':'none';

/*
  var Complete = "<input type='button' value='Clear' onclick='clearInventory();'><br>";
  for(var i in Predefined) {
     Complete+="<a href='#' onclick='addInventory(\""+i+"\");'>"+Predefined[i].name+"</a><br>"
  }
  options.innerHTML = Complete;
*/
  var canvas = document.getElementById("inventoryCanvas");
  var len = Object.keys(Predefined).length;
  canvas.width = (ViewWidth*16)+"";
  canvas.height = (Math.floor(len/ViewWidth)*16)+"";
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
