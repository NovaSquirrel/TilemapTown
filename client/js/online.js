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
let OnlineMode = false;
let OnlineServer = null;
let OnlineMap = "";
let OnlineSocket = null;
let OnlineSSL = true;
let OnlinePort = 443;
let OnlineUsername = "";
let OnlinePassword = "";
let OnlineIsConnected = false;
let OnlineMuWebview = false;
let ShowProtocol = true;

// URL param options
var InstantCamera = false;
var SlowAnimationTick = false;

function readURLParams() {
  var query = window.location.search.substring(1);
  var vars = query.split("&");
  for (var i = 0; i < vars.length; i++) {
    var pair = vars[i].split("=");
    if(pair.length >= 2) {
      var value = decodeURIComponent(pair[1]);
    }
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
      case "username":
        OnlineUsername = value;
        break;
      case "userpass":
        OnlinePassword = value;
        break;
      case "mu_webview":
        OnlineMuWebview = parseInt(value);
        if(OnlineMuWebview) {
          window.chrome.webview.hostObjects.options.defaultSyncProxy=true;

          window.chrome.webview.hostObjects.client.SetOnSend(function(t) {
            if (runLocalCommand(t));
            else if (t.slice(0, 1) == "\"") {
              SendCmd("MSG", { text: t.slice(1) });
            } else if (t.slice(0, 1) == ":") {
              SendCmd("MSG", { text: "/me "+t.slice(1) });
            } else if (t.slice(0, 6) == "spoof ") {
              SendCmd("MSG", { text: "/spoof "+t.slice(6) });
            } else if (t.slice(0, 4) == "ooc ") {
              SendCmd("MSG", { text: "/ooc "+t.slice(4) });
            } else if (t == "/webview" || t.slice(0, 9) == "/webview ") {
            } else {
              SendCmd("CMD", { text: t}); // assume it's a command
            }
          });
        }
        break;

      // Include non-server related flags too
      case "low_animation":
        InstantCamera = true;
        SlowAnimationTick = true;
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
        newitem = CloneAtom(DBInventory[commandArgs.clone]["id"]);
        newitem.id = TickCounter; // pick new ID
        receiveServerMessage({data: "BAG "+JSON.stringify({"update": newitem})});
      }
      if(commandArgs["delete"]) {
        receiveServerMessage({data: "BAG "+JSON.stringify({"remove": commandArgs["delete"]["id"]})});
      }
    }
    return;
  }
  if(commandArgs)
    OnlineSocket.send(commandType+" "+JSON.stringify(commandArgs));
  else
    OnlineSocket.send(commandType);
}

function initPlayerIfNeeded(id) {
  if(!PlayerAnimation[id]) {
    PlayerAnimation[id] = {
      "walkTimer": 0,
      "lastDirectionLR": 0,
      "lastDirection4":  0
    };
  }
}

function asIntIfPossible(i) {
  var asInt = parseInt(i);
  if(asInt != NaN)
    return asInt;
  return i;
}

function receiveServerMessage(cmd, arg) {
  switch(cmd) {
    case "MOV":
      if(arg.id != PlayerYou || !arg.from) {
        if("to" in arg) {

          // If you're being teleported, adjust the camera
          if(arg.id == PlayerYou) {
            var EdgeWarp = arg["edge_warp"] == true;
            if(PlayerWho[arg.id].x != arg.to[0]) {
              if(EdgeWarp) {
                var TargetCameraX = (PlayerWho[PlayerYou].x*16+8);
                var CameraDifferenceX = TargetCameraX - CameraX;
                CameraX = arg.to[0]*16+8 - CameraDifferenceX + (PlayerWho[arg.id].x < arg.to[0] ? 16 : -16);
                BumpCooldown = 0;
              } else {
                CameraX = arg.to[0]*16+8;
              }
            }
            if(PlayerWho[arg.id].y != arg.to[1]) {
              if(EdgeWarp) {
                var TargetCameraY = (PlayerWho[PlayerYou].y*16+8);
                var CameraDifferenceY = TargetCameraY - CameraY;
                CameraY = arg.to[1]*16+8 - CameraDifferenceY + (PlayerWho[arg.id].y < arg.to[1] ? 16 : -16);
                BumpCooldown = 0;
              } else {
                CameraY = arg.to[1]*16+8;
              }
            }
          }

          PlayerWho[arg.id].x = arg.to[0];
          PlayerWho[arg.id].y = arg.to[1];
          if(PlayerWho[arg.id].vehicle == null || PlayerWho[arg.id].is_following) {
            startPlayerWalkAnim(arg.id);
          }
        }
        if("dir" in arg) {
          PlayerWho[arg.id].dir = arg.dir;
          updateDirectionForAnim(arg.id);
        }
        if("offset" in arg) {
          PlayerWho[arg.id].offset = arg["offset"];
        }
        NeedMapRedraw = true;
      }
      break;
    case "MAI":
      if("remote_map" in arg) {
        var remote = arg["remote_map"];
        MapsByID[remote] = new TownMap(arg.size[0], arg.size[1])
        MapsByID[remote].Info = arg;
        break;
      } else {
        CurrentMapID = arg.id;

        if(CurrentMapID in MapsByID && MapsByID[CurrentMapID].Width == arg.size[0] && MapsByID[CurrentMapID].Height == arg.size[1]) {
          MyMap = MapsByID[CurrentMapID];
        } else {
          MyMap = new TownMap(arg.size[0], arg.size[1])
          MyMap.Info = arg;
          MapsByID[CurrentMapID] = MyMap;
        }

        // Clean up MapsByID
        var NotNeededMaps = [];
        for(var key in MapsByID) {
          if(key == CurrentMapID || ("edge_links" in MyMap.Info && MyMap.Info.edge_links !== null && MyMap.Info.edge_links.includes(parseInt(key))))
            continue;
          NotNeededMaps.push(key);
        }
        for(var i=0; i<NotNeededMaps.length; i++) {
          delete MapsByID[NotNeededMaps[i]];
        }

        // Give a notice about a new map
        let logText = "Now entering: <b>"+MyMap.Info['name']+"</b>";
        let plainText = `Now entering: ${MyMap.Info['name']}`;
        if(MyMap.Info['desc']) {
          logText += ' - "'+MyMap.Info['desc']+'"';
          plainText += ' - "'+MyMap.Info['desc']+'"';
        }
        if(MyMap.Info['topic']) {
          logText += `<br>Current topic: "${MyMap.Info['topic']}" (set by ${MyMap.Info['topic_username']})`;
          plainText += ` | Current topic: "${MyMap.Info['topic']}" (set by ${MyMap.Info['topic_username']})`;
        }
        logMessage(logText, 'server_message', {'plainText': plainText});
      }
      break;
    case "MAP":
      var Map = MyMap;
      if("remote_map" in arg) {
        Map = MapsByID[arg["remote_map"]];
      }
      var Fill = AtomFromName(arg.default);
      var x1 = arg.pos[0];
      var y1 = arg.pos[1];
      var x2 = arg.pos[2];
      var y2 = arg.pos[3];

      // Clear out the area
      for(var x=x1; x<=x2; x++) {
        for(var y=y1; y<=y2; y++) {
          Map.Tiles[x][y] = Fill;
          Map.Objs[x][y] = [];
        }
      }
      // Write in tiles and objects
      for (var key in arg.turf) {
        var turf = arg.turf[key];
        Map.Tiles[turf[0]][turf[1]] = turf[2];
      }
      for (var key in arg.obj) {
        var obj = arg.obj[key];
        Map.Objs[obj[0]][obj[1]] = obj[2];
      }

      NeedMapRedraw = true;
      break;
    case "BLK":
      var Map = MyMap;
      if("remote_map" in arg) {
        Map = MapsByID[arg["remote_map"]];
      }
      for (var key in arg.copy) {
        var copy_params = arg.copy[key];
        var copy_turf = true, copy_obj = true;
        if("turf" in copy_params) copy_turf = copy_params.turf;
        if("obj" in copy_params) copy_obj = copy_params.obj;
        if("src" in copy_params && "dst" in copy_params) {
          var src = copy_params.src;
          var dst = copy_params.dst;
          var x1     = src[0];
          var y1     = src[1];
          var width = 1, height = 1;
          if(src.length == 4) {
			  width  = src[2];
			  height = src[3];
          }
          var x2 = dst[0];
          var y2 = dst[1];

          // Make a copy first in case the source and destination overlap
          var copiedTurf = [];
          var copiedObjs = [];
          for(var w=0; w<width; w++) {
            copiedTurf[w] = [];
            copiedObjs[w] = [];
            for(var h=0; h<height; h++) {
              copiedTurf[w][h] = Map.Tiles[x1+w][y1+h];
              copiedObjs[w][h] = Map.Objs[x1+w][y1+h];
            }
          }

          // Copy from the temporary buffer into the destination
          for(var w = 0; w < width; w++) {
            for(var h = 0; h < height; h++) {
              if(copy_turf == true)
                Map.Tiles[x2+w][y2+h] = copiedTurf[w][h];
              if(copy_obj == true)
                Map.Objs[x2+w][y2+h] = copiedObjs[w][h];
            }
          }
        }
      }
      for (var key in arg.turf) {
        // get info
        var width = 1, height = 1;
        var turf = arg.turf[key];
        if(turf.length == 5) {
          width = turf[3];
          height = turf[4];
        }
        // apply rectangle
        for(var w = 0; w < width; w++) {
          for(var h = 0; h < height; h++) {
            Map.Tiles[turf[0]+w][turf[1]+h] = turf[2];
          }
        }
      }
      for (var key in arg.obj) {
        // get info
        var width = 1, height = 1;
        var obj = arg.obj[key];
        if(obj.length == 5) {
          width = obj[3];
          height = obj[4];
        }
        // apply rectangle
        for(var w = 0; w < width; w++) {
          for(var h = 0; h < height; h++) {
            Map.Objs[obj[0]+w][obj[1]+h] = obj[2];
          }
        }

      }
      NeedMapRedraw = true;
      break;
    case "WHO":
      if(arg.you)
        PlayerYou = arg.you;
      if(arg.list) {
        PlayerWho = arg.list;
        PlayerImages = {}; // reset images list
        PlayerAnimation = {}; // reset animation states
        PlayerBuildMarkers = {}; // reset player build markers
        PlayerMiniTilemapImage = {}; // reset mini tilemap image list

        // Set up all of the animation states for each player present in the list
        for (var id in arg.list) {
          initPlayerIfNeeded(id);
          updateDirectionForAnim(id);
        }
      } else if(arg.add) {
        if(!PlayerWho[arg.add.id] && (arg.add.in_user_list || arg.add.chat_listener)) { // if player isn't already in the list
          let isForwarding = arg.add.chat_listener ? " &#x1F916;" : "";
          logMessage("Joining: "+arg.add.name + isForwarding, 'server_message', {'plainText': `Joining: ${arg.add.name}${arg.add.chat_listener ? "(bot)" : ""}`});
        }
        PlayerWho[arg.add.id] = arg.add;
        initPlayerIfNeeded(arg.add.id);
        updateDirectionForAnim(arg.add.id);
        NeedMapRedraw = true;
      } else if(arg.remove) {
        if(PlayerWho[arg.remove].in_user_list) {
          let isForwarding = PlayerWho[arg.remove].chat_listener ? " &#x1F916;" : "";
          logMessage("Leaving: "+PlayerWho[arg.remove].name, 'server_message', {'plainText': `Leaving: ${PlayerWho[arg.remove].name}${PlayerWho[arg.remove].chat_listener ? "(bot)" : ""}`});
        }
        // unload image if needed
        if (arg.remove in PlayerImages)
          delete PlayerImages[arg.remove];
        if (arg.remove in PlayerAnimation)
          delete PlayerAnimation[arg.remove];
        if (arg.remove in PlayerMiniTilemapImage)
          delete PlayerMiniTilemapImage[arg.remove];
        // remove entry in PlayerWho
        delete PlayerWho[arg.remove];

        NeedMapRedraw = true;
      } else if(arg.update) {
        if("status" in arg.update && ((arg.update["status"] !== PlayerWho[arg.update.id]["status"]) || (("status_message" in arg.update) && arg.update["status_message"] !== PlayerWho[arg.update.id]["status_message"]))) {
          if(arg.update["status"]) {
			let status_name = '"' + escape_tags(arg.update["status"]) + '"';
            switch(arg.update["status"].toLowerCase()) {
              case "away": status_name = "away"; break;
              case "busy": status_name = "busy"; break;
              case "ic": status_name = "in character"; break;
              case "ooc": status_name =  "out of character"; break;
              case "iic": status_name = "looking to be in-character"; break;
              case "rp": status_name = "in a roleplay"; break;
              case "lfrp": case "irp": status_name = "looking to roleplay"; break;
            }
			let message = PlayerWho[arg.update.id].name + (status_name[0] == '"' ? "'s status is now ": " is now ") + status_name;
			if(arg.update["status_message"]) {
              message += ' ("' + convertBBCode(arg.update["status_message"]) + '")';
            }

            logMessage(message, 'status_change', {'isSilent': true, 'plainText': message});
          } else {
            logMessage(PlayerWho[arg.update.id].name + " cleared their status", 'status_change', {'isSilent': true, 'plainText': PlayerWho[arg.update.id].name + " cleared their status"});
          }
        }
        PlayerWho[arg.update.id] = Object.assign(
          PlayerWho[arg.update.id],
          arg.update
        );

        NeedMapRedraw = true;
      } else if(arg.new_id) {
        PlayerWho[arg.new_id.new_id] = PlayerWho[arg.new_id.id];
        if(arg.new_id.id == PlayerYou)
          PlayerYou = arg.new_id.new_id;
        // TODO: Search for the old ID and update it anywhere else it might appear, like your inventory?
        delete PlayerWho[arg.new_id.id];
      }

      // has anyone's avatars updated?
      for (var key in PlayerWho) {
        var pic = PlayerWho[key].pic;
        var is_custom = pic != null && typeof pic[0] == "string";

        // if no longer using a custom pic, delete the one that was used
        if (key in PlayerImages && !is_custom) {
          delete PlayerImages[key];
        }
        if ((!(key in PlayerImages) && is_custom) ||
            (key in PlayerImages && PlayerImages[key].src != pic[0] && is_custom)) {
          var img = new Image();
          img.onload = function(){
            NeedMapRedraw = true;
            updateUsersUL()
          };
          img.src = pic[0];
          PlayerImages[key] = img;
        }

        // Mini tilemap
        if (PlayerWho[key].mini_tilemap) {
          let url = PlayerWho[key].mini_tilemap.tileset_url;
          if (!(key in PlayerMiniTilemapImages) ||
              (key in PlayerMiniTilemapImages && PlayerMiniTilemapImages[key].src != url)) {
            var img = new Image();
            img.onload = function(){
              NeedMapRedraw = true;
            };
            img.src = url;
            PlayerMiniTilemapImages[key] = img;
          }
        } else if(key in PlayerMiniTilemapImage) {
          delete PlayerMiniTilemapImage[key];
        }
      }

      updateUsersUL()
      break;

    case "BAG":
      if("container" in arg && arg.container != PlayerYou) { // Ignore BAG messages for other containers currently. Though nothing sends this currently.
        break;
      }
      if(arg.list) {
        if(arg.clear == true)
          DBInventory = [];
        for(let item of arg.list) {
          DBInventory[item.id] = item;
          // Preload all image assets in the initial inventory
          if(item.type == 'image') // image
            RequestImageIfNeeded(item.id);
        }
      }
      if(arg.update) {
        if(arg.update.id in DBInventory) {
          // Overwrite all fields that are supplied
          for (var key in arg.update) {
            DBInventory[arg.update.id][key] = arg.update[key];
          }

          // Load the image when an image asset is modified
          if(DBInventory[arg.update.id].type == 'image') {
            SendCmd("IMG", {"id": arg.update.id}); // Unconditionally request the image
          }
        }
      }
      if(arg['remove']) {
        delete DBInventory[arg['remove'].id];
      }
      if(arg['new_id']) {
        DBInventory[arg['new_id']['new_id']] = DBInventory[arg['new_id']['id']];
        delete DBInventory[arg['new_id']['id']];
        for (var key in DBInventory) {
          if(DBInventory[key].folder == arg['new_id']['id'])
            DBInventory[key].folder = arg['new_id']['new_id'];
        }
      }
      NeedInventoryUpdate = true;
      break;

    case "RSC":
      if('images' in arg) {
        for(var key in arg['images']) {
          FetchTilesetImage(asIntIfPossible(key), arg['images'][key]);
        }
      }
      if('tilesets' in arg) {
        for(var key in arg['tilesets']) {
          var tileset = arg['tilesets'][key];
          if(key == '') {
            GlobalTiles = tileset;
            GlobalTilesArray = [];
            GlobalTilesArrayNames = [];
            for(var tileKey in tileset) {
              var i=0;
              for (var key in GlobalTiles) {
                GlobalTilesArrayNames[i] = key;
                GlobalTilesArray[i++] = GlobalTiles[key];
              }
            }
          } else {
            Tilesets[key] = tileset;
          }
        }
      }
      break;

    case "IMG":
      FetchTilesetImage(arg.id, arg.url);
      break;

    case "TSD":
      if(typeof(arg.data) == 'string')
        InstallTileset(arg.id, JSON.parse(arg.data));
      else
        InstallTileset(arg.id, arg.data);
      delete TilesetsRequested[arg.id];
      break;

    case "EML":
      if(arg['receive']) {
          logMessage("You've got mail! (from "+arg.receive['from']+")", 'server_message', {'plainText': `You've got mail! (from: ${arg.receive['from']})`});
          Mail.push(arg['receive']);
      } else if(arg['list']) {
          Mail = arg['list'];
          let unread = 0;
          for(let i=0; i<Mail.length; i++) {
            if(!(Mail[i].flags & 1)) {
              unread++;
            }
          }
          logMessage("You've got mail! ("+Mail.length+" messages, "+unread+" unread)", 'server_message');
      } else if(arg['sent']) {
        closeWindow("mailcompose");
      }
      updateMailUL();
      break;

    case "PIN":
      SendCmd("PIN", null);
      break;
    case "ERR":
      logMessage("Error: "+convertBBCode(arg.text), 'error_message', {'plainText': `Error: ${arg.text}`});
      break;
    case "PRI":
      senderIdForBbcode = arg.id ?? null;
      let respond = '<span onclick="setChatInput(\'/tell '+arg.username+' \')">';
      if(arg.text.slice(0, 4) == "/me ") {
        var new_text = arg.text.slice(4);
        if(arg.receive)
          logMessage(respond+"&larr;["+arg.name+"("+arg.username+")"+"] * <i>"+arg.name+" "+convertBBCode(new_text)+'</i></span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `<-- [${arg.name}(${arg.username})] * ${arg.name} ${new_text}`});
        else
          logMessage(respond+"&rarr;["+arg.name+"("+arg.username+")"+"] * <i>"+PlayerWho[PlayerYou].name+" "+convertBBCode(new_text)+'</i></span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `--> [${arg.name}(${arg.username})] * ${PlayerWho[PlayerYou].name} ${new_text}`});
          break;
      } else if(arg.text.slice(0, 5) == "/ooc ") {
        var new_text = arg.text.slice(5);
        if(arg.receive)
          logMessage(respond+"&larr;["+arg.name+"("+arg.username+")"+"] [OOC] "+convertBBCode(new_text)+'</span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `<-- [${arg.name}(${arg.username})] [OOC] ${new_text}`});
        else
          logMessage(respond+"&rarr;["+arg.name+"("+arg.username+")"+"] [OOC] "+convertBBCode(new_text)+'</span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `--> [${arg.name}(${arg.username})] [OOC] ${new_text}`});
          break;
      } else {
        if(arg.receive)
          logMessage(respond+"&larr;["+arg.name+"("+arg.username+")"+"] "+convertBBCode(arg.text)+'</span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `<-- [${arg.name}(${arg.username})] ${arg.text}`});
        else
          logMessage(respond+"&rarr;["+arg.name+"("+arg.username+")"+"] "+convertBBCode(arg.text)+'</span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `--> [${arg.name}(${arg.username})] ${arg.text}`});
          break;
      }
    case "CMD":
    case "MSG":
      senderIdForBbcode = arg.id ?? null;
      if(arg.name) {
        if(arg.text.slice(0, 4).toLowerCase() == "/me ")
          logMessage("* <i>"+arg.name+" "+convertBBCode(arg.text.slice(4))+"</i>", 'user_message',
            {'isChat': true, 'plainText': `* ${arg.name} ${arg.text.slice(4)}`});
        else if(arg.text.slice(0, 5).toLowerCase() == "/ooc ")
          logMessage("[OOC] "+arg.name+": "+convertBBCode(arg.text.slice(5)), 'ooc_message',
            {'isChat': true, 'plainText': `[OOC] ${arg.name}: ${arg.text.slice(5)}`});
        else if(arg.text.slice(0, 7).toLowerCase() == "/spoof ")
          logMessage("* <i>"+convertBBCode(arg.text.slice(7)) + "</i> <span class=\"spoof_name\">(by "+arg.name+")</span>", 'spoof_message',
            {'isChat': true, 'plainText': `* ${arg.text.slice(7)} (by ${arg.name})`});
        else
          logMessage("&lt;"+arg.name+"&gt; "+convertBBCode(arg.text), 'user_message',
            {'isChat': true, 'plainText': `<${arg.name}> ${arg.text}`});
      } else
        if(arg.buttons) {
          let buttons = "";
          for(let i=0; i<arg.buttons.length/2; i++) {
            buttons += '<input type="button" value="'+arg.buttons[i*2]+'" onclick="sendChatCommand(\''+arg.buttons[i*2+1]+'\');"/>';
          }
          logMessage("! "+convertBBCode(arg.text)+" "+buttons, 'server_message',
            {'isChat': false});
        } else {
          if(arg["class"])
            logMessage(arg.text, arg["class"],
              {'isChat': false, 'plainText': arg.text});
          else
            logMessage("Server message: "+convertBBCode(arg.text), 'server_message',
              {'isChat': false, 'plainText': "Server message: "+arg.text});
        }
      break;
    case "IDN":
      break;

    case "PUT":
      {
        let id = arg.id;
        if (id === PlayerYou)
          break;
        if(id in PlayerWho)
          PlayerBuildMarkers[id] = {pos: arg.pos, name: PlayerWho[id].name, timer: 100, del: false};
      }
      break;
    case "DEL":
      {
        let id = arg.id;
        if (id === PlayerYou)
          break;
        if (id in PlayerWho)
          PlayerBuildMarkers[id] = {pos: [(arg.pos[0]+arg.pos[2])/2, (arg.pos[1]+arg.pos[3])/2], name: PlayerWho[id].name, timer: 300, del: true};
      }
      break;

    case "EXT":
      {
        if(arg.take_controls) {
          let take_controls = arg.take_controls;
          let supported_controls = take_controls.keys.filter((key) => SupportedTakeControlsKeys.has(key));
          takeControlsPassOn = take_controls.pass_on ?? false;
          takeControlsKeyUp  = take_controls.key_up ?? false;
          takeControlsId     = take_controls.id;
          takeControlsKeys   = new Set(supported_controls);
          SendCmd("EXT", {
            "took_controls": {
              "id": take_controls.id,
              "keys": supported_controls,
            }
          });
          if(supported_controls.length) {
            if(!takeControlsEnabled)
              logMessage('A script is now acting on some keys. <input type="button" value="Stop" onclick="forceReleaseKeys();"/>', 'server_message',   {'isChat': false});
            takeControlsEnabled = true;
          } else {
            takeControlsEnabled = false;
          }
        }
      }
  }
}

function receiveServerMessageString(msg) {
  let cmd = msg.slice(0, 3);
  if(msg.length > 4) {
    if(cmd == "BAT") {
      // Get all of the protocol message lines
      let batch_data = msg.slice(4).split('\n');

      // Parse each of the sub-messages
      for(let i=0; i<batch_data.length; i++) {
        let batch_msg = batch_data[i];
        let batch_cmd = batch_msg.slice(0, 3);
        if(batch_msg.length > 4) {
          receiveServerMessage(batch_cmd, JSON.parse(batch_msg.slice(4)));
        } else {
          receiveServerMessage(batch_cmd, null);
        }
      }
    } else {
      receiveServerMessage(cmd, JSON.parse(msg.slice(4)));
    }
  } else {
    receiveServerMessage(cmd, null);
  }
}

function receiveServerMessageEvent(event) {
//    console.log(event.data);
  var msg = event.data;
  if(msg.length<3)
    return;
  if(ShowProtocol)
    console.log("<< "+msg);
  receiveServerMessageString(msg);
}

function ConnectToServer() {
  const beforeUnloadHandler = (event) => {
    event.preventDefault();
    event.returnValue = true;
  };
  window.addEventListener("beforeunload", beforeUnloadHandler);

  OnlineMode = true;

  OnlineSocket = new WebSocket((OnlineSSL?"wss://":"ws://")+OnlineServer+":"+OnlinePort);
  logMessage("Attempting to connect", 'server_message');

  OnlineSocket.onopen = function (event) {
    logMessage("Connected! Waiting for map data.", 'server_message');

    let idn_args = {};
    idn_args["features"] = {
       "see_past_map_edge": {"version": "0.0.1"},
       "batch": {"version": "0.0.1"},
       "receive_build_messages": {"version": "0.0.1"},
    };

    if(OnlineUsername != "") {
      idn_args["username"] = OnlineUsername;
      idn_args["password"] = OnlinePassword
    };
	idn_args["client_name"] = "Tilemap Town Web Client";

    SendCmd("IDN", idn_args);
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

  OnlineSocket.onmessage = receiveServerMessageEvent;
}
