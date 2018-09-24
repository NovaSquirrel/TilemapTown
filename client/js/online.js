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
var OnlineMode = false;
var OnlineServer = null;
var OnlineMap = "";
var OnlineSocket = null;
var OnlineSSL = true;
var OnlinePort = 443;
var OnlineUsername = "";
var OnlinePassword = "";
var OnlineIsConnected = false;
var ShowProtocol = false;

function readURLParams() {
  var query = window.location.search.substring(1);
  var vars = query.split("&");
  for (var i = 0; i < vars.length; i++) {
    var pair = vars[i].split("=");
	var value = decodeURIComponent(pair[1]);
	switch(pair[0]) {
      case "server":
		OnlineServer = value;
		break;
      case "map":
		OnlineMap = value;
		break;
      case "unencrypted":
		OnlineSSL = false;
		OnlineServer = value;
		OnlinePort = 12550;
		break;
      case "port":
		OnlinePort = value;
		break;
    }
  }
}
readURLParams();

function SendCmd(commandType, commandArgs) {
  if(ShowProtocol)
    console.log(">> "+commandType+" "+JSON.stringify(commandArgs));
  if(!OnlineMode) {
    if(commandType == "BAG") {
      if(commandArgs.create) {
        receiveServerMessage({data: "BAG "+JSON.stringify(
          {"update": {"id": TickCounter,
                      "name": commandArgs.create.name,
                      "type": commandArgs.create.type,
                      "data": null
                     }
          })});
      }
      if(commandArgs.update) {
        receiveServerMessage({data: "BAG "+JSON.stringify({"update": commandArgs["update"]})});
      }
      if(commandArgs.clone) {
        newitem = CloneAtom(DBInventory[commandArgs.clone]);
        newitem.id = TickCounter; // pick new ID
        receiveServerMessage({data: "BAG "+JSON.stringify({"update": newitem})});
      }
      if(commandArgs["delete"]) {
        receiveServerMessage({data: "BAG "+JSON.stringify({"remove": commandArgs["delete"]})});
      }
    }
    return;
  }
  if(commandArgs)
    OnlineSocket.send(commandType+" "+JSON.stringify(commandArgs));
  else
    OnlineSocket.send(commandType);
}

function receiveServerMessage(event) {
//    console.log(event.data);
  var msg = event.data;
  if(msg.length < 3)
    return;
  if(ShowProtocol)
    console.log("<< "+msg);
  var cmd = msg.slice(0, 3);
  var arg = null;
  if(msg.length > 4)
    arg = JSON.parse(msg.slice(4));

  switch(cmd) {
    case "MOV":
      if(arg.id != PlayerYou || !arg.from) {
        PlayerWho[arg.id].x = arg.to[0];
        PlayerWho[arg.id].y = arg.to[1];
        NeedMapRedraw = true;
      }
      break;
    case "MAI":
      MapWidth = arg.size[0];
      MapHeight = arg.size[1];
      initMap();
      break;
    case "MAP":
      var Fill = AtomFromName(arg.default);
      var x1 = arg.pos[0];
      var y1 = arg.pos[1];
      var x2 = arg.pos[2];
      var y2 = arg.pos[3];

      // Clear out the area
      for(var x=x1; x<=x2; x++) {
        for(var y=y1; y<=y2; y++) {
          MapTiles[x][y] = Fill;
          MapObjs[x][y] = [];
        }
      }
      // Write in tiles and objects
      for (var key in arg.turf) {
        var turf = arg.turf[key];
        MapTiles[turf[0]][turf[1]] = turf[2];
      }
      for (var key in arg.obj) {
        var obj = arg.obj[key];
        MapObjs[obj[0]][obj[1]] = obj[2];
      }

      NeedMapRedraw = true;
      break;
    case "WHO":
      if(arg.you)
        PlayerYou = arg.you;
      if(arg.list) {
        PlayerWho = arg.list;
        PlayerImages = {}; // reset images list
      } else if(arg.add) {
        if(!PlayerWho[arg.add.id]) // if player isn't already in the list
          logMessage("Joining: "+arg.add.name, 'server_message');
        PlayerWho[arg.add.id] = arg.add;
        NeedMapRedraw = true;
      } else if(arg.remove) {
        logMessage("Leaving: "+PlayerWho[arg.remove].name, 'server_message');
        // unload image if needed
        if (arg.remove in PlayerImages)
          delete PlayerImages[arg.remove];
        // remove entry in PlayerWho
        delete PlayerWho[arg.remove];

        NeedMapRedraw = true;
      }

      // has anyone's avatars updated?
      for (var key in PlayerWho) {
        var pic = PlayerWho[key].pic;
        var is_custom = typeof pic[0] == "string";

        // if no longer using a custom pic, delete the one that was used
        if (key in PlayerImages && !is_custom) {
          delete PlayerImages[key];
        }
        if ((!(key in PlayerImages) && is_custom) ||
            (key in PlayerImages && PlayerImages[key].src != pic[0] && is_custom)) {
          var img = new Image();
          img.onload = function(){
            NeedMapRedraw = true;
          };
          img.src = pic[0];
          PlayerImages[key] = img;
        }
      }

      break;

    case "BAG":
      if(arg.list) {
        for(let item of arg.list) {
          DBInventory[item.id] = item;
        }
      }
      if(arg.update) {
        if(arg.update.id in DBInventory) {
          // Overwrite all fields that are supplied
          for (var key in arg.update) {
            DBInventory[arg.update.id][key] = arg.update[key];
          }
        } else {
        // Create a new item
          DBInventory[arg.update.id] = arg.update;
        }
      }
      if(arg['remove']) {
        delete DBInventory[arg['remove']];
        for (var key in DBInventory) {
          if(DBInventory[key].folder == arg['remove'])
            DBInventory[key].folder = null;
        }
      }
      NeedInventoryUpdate = true;
      break;

    case "IMG":
      // unload an image
      if(arg.url == null) {
        delete IconSheets[arg.id];
        break;
      }
      // load an image
      var img = new Image();
      img.onload = function(){
         NeedMapRedraw = true;
      };
      img.src = arg.url;
      IconSheets[arg.id] = img;
      break;

    case "TSD":
      InstallTileset(arg.name, arg.data);
      break;

    case "PIN":
      SendCmd("PIN", null);
      break;
    case "ERR":
      logMessage("Error: "+convertBBCode(arg.text), 'error_message');
      break;
    case "PRI":
      let respond = '<span onclick="setChatInput(\'/tell '+arg.username+' \')">';
      if(arg.receive)
        logMessage(respond+"&larr;["+arg.name+"("+arg.username+")"+"] "+convertBBCode(arg.text)+'</span>', 'private_message');
      else
        logMessage(respond+"&rarr;["+arg.name+"("+arg.username+")"+"] "+convertBBCode(arg.text)+'</span>', 'private_message');
        break;
    case "MSG":
      if(arg.name) {
        if(arg.text.slice(0, 4) == "/me ")
          logMessage("* <i>"+arg.name+" "+convertBBCode(arg.text.slice(4))+"</i>", 'user_message');
        else
          logMessage("&lt;"+arg.name+"&gt; "+convertBBCode(arg.text), 'user_message');
      } else
        if(arg.buttons) {
          let buttons = "";
          for(let i=0; i<arg.buttons.length/2; i++) {
            buttons += '<input type="button" value="'+arg.buttons[i*2]+'" onclick="sendChatCommand(\''+arg.buttons[i*2+1]+'\');"/>';
          }
          logMessage("! "+convertBBCode(arg.text)+" "+buttons, 'server_message');
        } else {
          if(arg["class"])
            logMessage(arg.text, arg["class"]);
          else
            logMessage("Server message: "+convertBBCode(arg.text), 'server_message');
        }
      break;
  }
}

function ConnectToServer() {
  OnlineMode = true;

  OnlineSocket = new WebSocket((OnlineSSL?"wss://":"ws://")+OnlineServer+":"+OnlinePort);
  logMessage("Attempting to connect", 'server_message');

  OnlineSocket.onopen = function (event) {
    logMessage("Connected! Waiting for map data.", 'server_message');
    if(OnlineUsername == "")
      SendCmd("IDN", null);
    else
      SendCmd("IDN", {username: OnlineUsername, password: OnlinePassword});
    OnlineIsConnected = true;
  }

  OnlineSocket.onerror = function (event) {
    logMessage("Socket error", 'error_message');
    OnlineIsConnected = false;
  }

  OnlineSocket.onclose = function (event) {
    logMessage("Connection closed", 'error_message');
    OnlineIsConnected = false;
  }

  OnlineSocket.onmessage = receiveServerMessage;
}
