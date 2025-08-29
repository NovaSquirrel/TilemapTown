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
let DidConnectOnce = false; // A connection got an IDN from the server at least once, indicating the connection went all the way through
let StatusOnDisconnect = null;
let StatusMessageOnDisconnect = null;
let mostRecentError = "";
let GlobalImageNames = {"0": "Potluck", "-1": "Extra", "-2": "Pulp", "-3": "EasyRPG"};
let API_Key = null;
let API_Version = null;
let API_URL = null;
let MessagesToRetry = []; // Each entry is {commandType, commandArgs, key, map_id}
let MessageAckReqPrefix = Math.random() + "_";
let MessageAckReqNumber = 0; // Incremented every time a key is required, and added to the prefix to get the key that's sent out
let JoinedMapYet = false;
const SupportedTakeControlsKeys = ["turn-ne", "move-ne", "turn-se", "move-se", "turn-nw", "move-nw", "turn-sw", "move-sw", "turn-w", "move-w", "turn-s", "move-s", "turn-n", "move-n", "turn-e", "move-e", "use-item", "cancel", "hotbar-1", "hotbar-2", "hotbar-3", "hotbar-4", "hotbar-5", "hotbar-6", "hotbar-7", "hotbar-8", "hotbar-9", "hotbar-10"];
const CLIENT_NAME = "Tilemap Town Web Client";

// For messaging mode
let alreadySeenStats = false;
// For all modes
let alreadySeenMOTD = undefined;
let alreadySeenEvent = undefined;
let alreadySeenMail = undefined;

// URL param options
let SlowAnimationTick = false;

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
      case "instant_scroll":
        InstantCamera = true;
        break;
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
    if(commandType == "CMD" || commandType == "MSG") {
        receiveServerMessage("ERR",
         {"text": "You're not connected to a server! Press the login button to connect."}
        );
    } else if(commandType == "BAG") {
      if(commandArgs.create) {
        receiveServerMessage("BAG",
          {"list": [{"id": TickCounter,
                      "name": commandArgs.create.name,
                      "type": commandArgs.create.type,
                      "data": null,
                      "folder": PlayerYou,
                     }]
          }
        );
      }
      if(commandArgs.update) {
        receiveServerMessage("BAG",
          {"update": commandArgs["update"]}
        );
      }
      if(commandArgs.clone) {
        newitem = CloneAtom(DBInventory[commandArgs.clone]["id"]);
        newitem.id = TickCounter; // pick new ID
        receiveServerMessage("BAG",
          {"update": newitem}
        );
      }
      if(commandArgs["delete"]) {
        receiveServerMessage("BAG",
          {"remove": commandArgs["delete"]["id"]}
        );
      }
    }
    return;
  }
  if(commandArgs) {
    if (!commandArgs.ack_req && (commandType === "PRI" || commandType === "MSG" || commandType === "CMD" || commandType === "EML") ) {
      let key = MessageAckReqPrefix + (MessageAckReqNumber++);
      commandArgs.ack_req = key;
      MessagesToRetry.push({commandType, commandArgs, key, map_id: messaging_mode ? undefined : MyMap.Info.id});
    }
    if (OnlineIsConnected)
      OnlineSocket.send(commandType+" "+JSON.stringify(commandArgs));
  } else
    if (OnlineIsConnected)
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

function updateWallpaperData(map) {
	// Calculate wallpaper positioning information to have it ready for when the map is drawn
	let WallpaperData = {};
	let hasWallpaper = false;
	let defaultTurf = AtomFromName(map.Info?.["default"] ?? "grass");
	let wallpaperStartX, wallpaperStartY, wallpaperEndX, wallpaperEndY, wallpaperTileX, wallpaperTileY, wallpaperDrawX = 0, wallpaperDrawY = 0, wallpaperHasRepeat;
	if(map.WallpaperImage && map.WallpaperImage.complete) {
		let wallpaper = map.Info["wallpaper"];
		if(wallpaper.center) {
			wallpaperDrawX = map.Width*8 - map.WallpaperImage.naturalWidth/2;
			wallpaperDrawY = map.Height*8 - map.WallpaperImage.naturalHeight/2;
		}
		if(wallpaper.offset) {
			wallpaperDrawX += wallpaper.offset[0];
			wallpaperDrawY += wallpaper.offset[1];
		}

		// Calculate region where the client should attempt to draw the wallpaper
		wallpaperTileX  = Math.floor(wallpaperDrawX / 16);
		wallpaperTileY  = Math.floor(wallpaperDrawY / 16);
		wallpaperStartX = (wallpaper.repeat || wallpaper.repeat_x) ? 0 : wallpaperTileX;
		wallpaperStartY = (wallpaper.repeat || wallpaper.repeat_y) ? 0 : wallpaperTileY;
		wallpaperEndX   = (wallpaper.repeat || wallpaper.repeat_x) ? (map.Width-1)  : (Math.ceil(wallpaperDrawX + map.WallpaperImage.naturalWidth - 1) / 16);
		wallpaperEndY   = (wallpaper.repeat || wallpaper.repeat_y) ? (map.Height-1) : (Math.ceil(wallpaperDrawY + map.WallpaperImage.naturalHeight - 1) / 16);
		wallpaperHasRepeat = wallpaper.repeat || wallpaper.repeat_x || wallpaper.repeat_y;

		hasWallpaper    = true;
	}
	map.WallpaperData = {hasWallpaper, defaultTurf, wallpaperStartX, wallpaperStartY, wallpaperEndX, wallpaperEndY, wallpaperTileX, wallpaperTileY, wallpaperDrawX, wallpaperDrawY, wallpaperHasRepeat};
}

function updateWallpaperOnMap(map) {
	// Check on the wallpaper
	if(map.Info["wallpaper"] && Object.keys(map.Info["wallpaper"]).length != 0) {
		if(map.WallpaperImage == null || map.WallpaperImage.src != map.Info["wallpaper"].url) {
			let img = new Image();
			img.onload = function(){
				NeedMapRedraw = true;
				backdropRerenderAll = true;
				updateWallpaperData(map);
			};
			img.src = map.Info["wallpaper"].url;
			map.WallpaperImage = img;
		}
		updateWallpaperData(map);
	} else {
		map.WallpaperImage = null;
		map.WallpaperData = null;
	}
}

function SendStatusMessageFromBeforeDisconnect() {
	if(StatusOnDisconnect) {
		const length = MessagesToRetry.length;
		if(StatusMessageOnDisconnect && StatusMessageOnDisconnect != '') {
			SendCmd("CMD", {text: "status " + StatusOnDisconnect + " " + StatusMessageOnDisconnect});
		} else {
			SendCmd("CMD", {text: "status " + StatusOnDisconnect});
		}
		if (MessagesToRetry.length === length + 1) {
			MessagesToRetry.pop();
		}
		StatusOnDisconnect = null;
		StatusMessageOnDisconnect = null;
	}
}

function receiveServerMessage(cmd, arg) {
  if (arg && arg.ack_req)
    SendCmd("ACK", { key: arg.ack_req, type: cmd });
  switch(cmd) {
    case "MOV":
      if("to" in arg && (arg.id != PlayerYou || !arg.from)) {
        // If you're being teleported, adjust the camera
        if(arg.id == PlayerYou) {
          var EdgeWarp = arg["edge_warp"] == true;
          if(PlayerWho[arg.id].x != arg.to[0]) {
            backdropRerenderAll = true;
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
            backdropRerenderAll = true;
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

        markAreaAroundEntityAsDirty(arg.id);
        PlayerWho[arg.id].x = arg.to[0];
        PlayerWho[arg.id].y = arg.to[1];
        markAreaAroundEntityAsDirty(arg.id);
        if(PlayerWho[arg.id].vehicle == null || PlayerWho[arg.id].is_following ||
          (PlayerWho[arg.id].vehicle && PlayerWho[PlayerWho[arg.id].vehicle] && arg.id == PlayerWho[PlayerWho[arg.id].vehicle].vehicle)
        ) {
          startPlayerWalkAnim(arg.id);
        }
      }
      if("dir" in arg) {
        if (arg.id === PlayerYou) {
          let offset = applyTailShift(PlayerWho[arg.id], arg.dir);
          if (offset !== null)
            SendCmd("MOV", { offset });
        }
        PlayerWho[arg.id].dir = arg.dir;
        updateDirectionForAnim(arg.id);
      }
      if("offset" in arg) {
        PlayerWho[arg.id].offset = arg["offset"];
      }
      if("z_index" in arg) {
        PlayerWho[arg.id].z_index = arg["z_index"];
      }
      NeedMapRedraw = true;
      break;
    case "ACK":
      MessagesToRetry = MessagesToRetry.filter((item) => item.key !== arg.key);
      break;
    case "MAI":
      if("remote_map" in arg) {
        var remote = arg["remote_map"];
        MapsByID[remote] = new TownMap(arg.size[0], arg.size[1])
        MapsByID[remote].Info = arg;
        updateWallpaperOnMap(MapsByID[remote]);
        break;
      } else {
        let OldMapID = CurrentMapID;
        CurrentMapID = arg.id;

        if(CurrentMapID in MapsByID && MapsByID[CurrentMapID].Width == arg.size[0] && MapsByID[CurrentMapID].Height == arg.size[1]) {
          MyMap = MapsByID[CurrentMapID];
        } else {
          MyMap = new TownMap(arg.size[0], arg.size[1])
          MapsByID[CurrentMapID] = MyMap;
        }
        MyMap.Info = arg;
        updateWallpaperOnMap(MyMap);
        UserParticles = [];
        if (!JoinedMapYet) {
          SendStatusMessageFromBeforeDisconnect();
          JoinedMapYet = true;
          let newList = [];
          for (let item of MessagesToRetry) {
            if (item.commandType !== "MSG" || item.commandArgs.remote_map || item.map_id === arg.id) {
               SendCmd(item.commandType, item.commandArgs);
               newList.push(item);
            }
          }
          MessagesToRetry = newList;
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
        if(OldMapID != CurrentMapID) {
          let logText = "Now entering: <b>"+escape_tags(MyMap.Info['name'])+"</b>";
          let plainText = `Now entering: ${MyMap.Info['name']}`;
          if(MyMap.Info['desc']) {
            logText += ' - "'+convertBBCode(MyMap.Info['desc'])+'"';
            plainText += ' - "'+MyMap.Info['desc']+'"';
          }
          if(MyMap.Info['topic']) {
            logText += `<br>Current topic: "${convertBBCode(MyMap.Info['topic'])}" (set by ${escape_tags(MyMap.Info['topic_username'])})`;
            plainText += ` | Current topic: "${MyMap.Info['topic']}" (set by ${MyMap.Info['topic_username']})`;
          }
          logMessage(logText, 'server_message', {'plainText': plainText});
        }

        // Start playing music if enabled
        let music = MyMap.Info['music']?.url;
        if (music) {
          if (music != currentlyPlayingURL) {
            playMusic(music);
          }
        } else if (mapMusicEnabled) {
          stopMusic();
        }

        alreadyBumped = false;
        NeedMapRedraw = true;
		backdropRerenderAll = true;
      }
      break;
    case "MAP":
      var Map = MyMap;
      if("remote_map" in arg) {
        Map = MapsByID[arg["remote_map"]];
      }
      var Fill = arg.default;
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

      markTilesAsDirty(Map, x1-1, y1-1, x2-x1+2, y2-y1+2, BACKDROP_DIRTY_RENDER);
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
          markTilesAsDirty(Map, x2-1, y2-1, w+2, h+2, BACKDROP_DIRTY_RENDER);
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
        markTilesAsDirty(Map, turf[0]-1, turf[1]-1, w+2, h+2, BACKDROP_DIRTY_RENDER);
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
        markTilesAsDirty(Map, obj[0]-1, obj[1]-1, w+2, h+2, BACKDROP_DIRTY_RENDER);
      }
      NeedMapRedraw = true;
      break;
    case "WHO":
      if(arg.type !== undefined && arg.type !== 'map')
        break;
      if("remote_map" in arg)
        break;
      if(arg.you)
        PlayerYou = arg.you;
      if(arg.list) {
        PlayerWho = arg.list;
        PlayerImages = {}; // reset images list
        PlayerAnimation = {}; // reset animation states
        PlayerBuildMarkers = {}; // reset player build markers
        PlayerMiniTilemapImage = {}; // reset mini tilemap image list
        PlayerParticleImages = {}; // reset player particle image list

        // Set up all of the animation states for each player present in the list
        for (var id in arg.list) {
          initPlayerIfNeeded(id);
          updateDirectionForAnim(id);
          apply_default_pic_for_type(PlayerWho[id]);
        }

        NeedMapRedraw = true;
        backdropDrawAll = true;
      } else if(arg.add) {
        if(!PlayerWho[arg.add.id] && (arg.add.in_user_list || arg.add.chat_listener)) { // if player isn't already in the list
          let isForwarding = arg.add.chat_listener ? " &#x1F916;" : "";
          logMessage("Joining: "+escape_tags(arg.add.name) + isForwarding, 'server_message', {'plainText': `Joining: ${arg.add.name}${arg.add.chat_listener ? "(bot)" : ""}`});
        }
        PlayerWho[arg.add.id] = arg.add;
        initPlayerIfNeeded(arg.add.id);
        updateDirectionForAnim(arg.add.id);
        apply_default_pic_for_type(PlayerWho[arg.add.id]);

        NeedMapRedraw = true;
        backdropDrawAll = true;
      } else if(arg.remove) {
        if(PlayerWho[arg.remove].in_user_list) {
          let isForwarding = PlayerWho[arg.remove].chat_listener ? " &#x1F916;" : "";
          logMessage("Leaving: "+escape_tags(PlayerWho[arg.remove].name), 'server_message', {'plainText': `Leaving: ${PlayerWho[arg.remove].name}${PlayerWho[arg.remove].chat_listener ? "(bot)" : ""}`});
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
        backdropDrawAll = true;
      } else if(arg.update) {
        if("status" in arg.update && ((arg.update["status"] !== PlayerWho[arg.update.id]["status"]) || (("status_message" in arg.update) && arg.update["status_message"] !== PlayerWho[arg.update.id]["status_message"]))) {
          if(arg.update["status"] && arg.update.id != PlayerYou) {
            if(arg.update["status"] == "." && arg.update["status_message"]) {
              let message = escape_tags(PlayerWho[arg.update.id].name) + "'s status is now \"" + convertBBCode(arg.update["status_message"]) + "\"";
              let plain_message = PlayerWho[arg.update.id].name + "'s status is now \"" + arg.update["status_message"] + "\"";
              logMessage(message, 'status_change', {'isSilent': true, 'plainText': plain_message});
            } else {
              let status_name = '"' + escape_tags(arg.update["status"]) + '"';
              let plain_status_name = '"' + arg.update["status"] + '"';
              switch(arg.update["status"].toLowerCase()) {
                case "idle": status_name = "idle"; break;
                case "away": status_name = "away"; break;
                case "busy": status_name = "busy"; break;
                case "dnd": status_name = "do-not-disturb"; break;
                case "chat": status_name = "looking to chat"; break;
                case "ic": status_name = "in character"; break;
                case "ooc": status_name = "out of character"; break;
                case "iic": status_name = "looking to be in-character"; break;
                case "rp": status_name = "in a roleplay"; break;
                case "lfrp": case "irp": status_name = "looking to roleplay"; break;
              }
              if(status_name[0] != '"')
                plain_status_name = status_name;
              let message = PlayerWho[arg.update.id].name + (status_name[0] == '"' ? "'s status is now ": " is now ") + status_name;
              let plain_message = PlayerWho[arg.update.id].name + (plain_status_name[0] == '"' ? "'s status is now ": " is now ") + plain_status_name;

              if(arg.update["status_message"]) {
                message += ' ("' + convertBBCode(arg.update["status_message"]) + '")';
                plain_message += ' ("' + arg.update["status_message"] + '")';
              }

              logMessage(message, 'status_change', {'isSilent': true, 'plainText': plain_message});
           }
          } else if(arg.update.id != PlayerYou) {
            logMessage(escape_tags(PlayerWho[arg.update.id].name) + " cleared their status", 'status_change', {'isSilent': true, 'plainText': PlayerWho[arg.update.id].name + " cleared their status"});
          }
        }
        markAreaAroundEntityAsDirty(arg.update.id);
        PlayerWho[arg.update.id] = Object.assign(
          PlayerWho[arg.update.id],
          arg.update
        );
        markAreaAroundEntityAsDirty(arg.update.id);
        NeedMapRedraw = true;
      } else if(arg.new_id) {
        PlayerWho[arg.new_id.new_id] = PlayerWho[arg.new_id.id];
        if(arg.new_id.id == PlayerYou)
          PlayerYou = arg.new_id.new_id;
        // TODO: Search for the old ID and update it anywhere else it might appear, like your inventory?
        // TODO: Seems like there's some sort of issue involving trying to get an item card for this entity with the old name?? Look into this and do it properly later.
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
            backdropDrawAll = true;
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
        FlushIconSheetRequestList();
      }
      if(arg.update) {
        if(arg.update.id in DBInventory) {
          // Overwrite all fields that are supplied
          for (var key in arg.update) {
            DBInventory[arg.update.id][key] = arg.update[key];
          }

          // Server now notifies clients about image urls updating, so the client no longer needs to proactively request it
          // if(DBInventory[arg.update.id].type == 'image') {
          //  SendCmd("IMG", {"id": arg.update.id}); // Unconditionally request the image
          // }
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
      if(arg['info'] && editItemWaitingForDataID === arg['info']['id']) {
        editItemWaitingForDataID = undefined;
        editItemShared(arg['info']);
      }
      NeedInventoryUpdate = true;
      break;

    case "RSC":
      if('images' in arg) {
        for(var key in arg['images']) {
          FetchTilesetImage(asIntIfPossible(key), arg['images'][key]);
        }
      }
      if('image_names' in arg) {
        GlobalImageNames = arg['image_names'];
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
      if('build_categories' in arg) {
        buildCategories = arg['build_categories'];
        updateBuildToolCategoriesAvailable();
      }
      if('sample_avatars' in arg) {
        sampleAvatarList = arg['sample_avatars'];
      }
      changedBuildToolCategory();
      break;

    case "IMG":
      FetchTilesetImage(arg.id, arg.url);
      break;

    case "TSD":
      if(typeof(arg.data) === 'string')
        InstallTileset(arg.id, JSON.parse(arg.data));
      else
        InstallTileset(arg.id, arg.data);
      delete TilesetsRequested[arg.id];
      break;

    case "EML":
      if(arg['receive']) {
          logMessage("You've got mail! (from "+escape_tags(arg.receive['from'])+")", 'server_message', {'plainText': `You've got mail! (from: ${arg.receive['from']})`});
          if(!('timestamp' in arg['receive']))
            arg['receive'].timestamp = new Date(Date.now()).toISOString();
          Mail.push(arg['receive']);
          alreadySeenMail = "";
      } else if(arg['sent']) {
          if (messaging_mode) {
            if (document.getElementById('mailDivCompose').style.display === "block") {
              document.getElementById('mailDivCompose').style.display = "none";
              document.getElementById('mailDivMain').style.display = "block";
            }
          } else {
            document.getElementById('compose').style.display = "none";
          }

          if(!('timestamp' in arg['sent']))
            arg['sent'].timestamp = new Date(Date.now()).toISOString();
          if(!arg['sent'].flags)
            arg['sent'].flags = ['sent'];
          else if(!arg['sent'].flags.includes('sent'))
            arg['sent'].flags.push('sent');
          Mail.push(arg['sent']);
      } else if(arg['list']) {
          Mail = arg['list'];
          let unread = 0, self_mail = 0;
          for(let i=0; i<Mail.length; i++) {
            if(Mail[i].flags.length == 0) {
              unread++;
            } else if(Mail[i].flags.includes("sent")) {
              self_mail++;
            }
          }
          if(unread == 0)
            break;
          let mailText = "You've got mail! ("+unread+" unread message"+((unread == 1)?"":"s")+")";
          if (alreadySeenMail === mailText)
            break;
          else
            alreadySeenMail = mailText;
          logMessage(mailText, 'server_message');
      }
      updateMailUL();
      break;

    case "PIN":
      SendCmd("PIN", null);
      break;
    case "ERR":
      mostRecentError = arg.text;
      logMessage("Error: "+convertBBCodeChat(arg.text), 'error_message', {'plainText': `Error: ${arg.text}`});
      break;
    case "PRI":
      senderIdForBbcode = arg.id ?? null;
      let escapedName = escape_tags(arg.name || "");
      let typeMarker = arg.offline ? "&#x2709;" : "";
      let escapedUsername = escape_tags(arg.username || "") + typeMarker;

      let respond = '<span onclick="setChatInput(\'/tell '+arg.username+' \')">';
      if(arg.text.slice(0, 4) == "/me ") {
        let new_text = arg.text.slice(4);
        let no_space = new_text.startsWith("'s ") || new_text.startsWith("'d ") || new_text.startsWith("'ll ");
        if(arg.receive)
          logMessage(respond+"&larr;["+escapedName+"("+escapedUsername+")"+"] * <i>"+escape_tags(arg.name)+(no_space?"":" ")+convertBBCodeChat(new_text)+'</i></span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `<-- [${escapedName}(${arg.username + typeMarker})] * ${arg.name}${no_space?"":" "}${new_text}`,
            'timestamp': arg.timestamp, 'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"]});
        else
          logMessage(respond+"&rarr;["+escapedName+"("+escapedUsername+")"+"] * <i>"+escape_tags(PlayerWho[PlayerYou].name)+(no_space?"":" ")+convertBBCodeChat(new_text)+'</i></span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `--> [${arg.name}(${arg.username + typeMarker})] * ${PlayerWho[PlayerYou].name}${no_space?"":" "}${new_text}`,
            'timestamp': arg.timestamp, 'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"]});
          break;
      } else if(arg.text.slice(0, 5) == "/ooc ") {
        var new_text = arg.text.slice(5);
        if(arg.receive)
          logMessage(respond+"&larr;["+escapedName+"("+escapedUsername+")"+"] [OOC] "+convertBBCodeChat(new_text)+'</span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `<-- [${arg.name}(${arg.username + typeMarker})] [OOC] ${new_text}`,
            'timestamp': arg.timestamp, 'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"]});
        else
          logMessage(respond+"&rarr;["+escapedName+"("+escapedUsername+")"+"] [OOC] "+convertBBCodeChat(new_text)+'</span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `--> [${arg.name}(${arg.username + typeMarker})] [OOC] ${new_text}`,
            'timestamp': arg.timestamp, 'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"]});
          break;
      } else {
        if(arg.receive)
          logMessage(respond+"&larr;["+escapedName+"("+escapedUsername+")"+"] "+convertBBCodeChat(arg.text)+'</span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `<-- [${arg.name}(${arg.username + typeMarker})] ${arg.text}`,
            'timestamp': arg.timestamp, 'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"]});
        else
          logMessage(respond+"&rarr;["+escapedName+"("+escapedUsername+")"+"] "+convertBBCodeChat(arg.text)+'</span>', 'private_message',
            {'isPrivateChat': true, 'plainText': `--> [${arg.name}(${arg.username + typeMarker})] ${arg.text}`,
            'timestamp': arg.timestamp, 'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"]});
          break;
      }
    case "CMD":
    case "MSG":
      senderIdForBbcode = arg.id ?? null;
      if(arg.name) {
        let escapedName = escape_tags(arg.name || "");

        if(arg.text.slice(0, 4).toLowerCase() == "/me ") {
          let message = arg.text.slice(4);
          let no_space = message.startsWith("'s ") || message.startsWith("'d ") || message.startsWith("'ll ");
          logMessage("* <i>"+escapedName+(no_space?"":" ")+convertBBCodeChat(message)+"</i>", 'user_message',
            {'isChat': true, 'plainText': `* ${escapedName}${no_space?"":" "}${message}`,
            'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"], "id": arg["id"]});
        } else if(arg.text.slice(0, 5).toLowerCase() == "/ooc ")
          logMessage("[OOC] "+escapedName+": "+convertBBCodeChat(arg.text.slice(5)), 'ooc_message',
            {'isChat': true, 'plainText': `[OOC] ${escapedName}: ${arg.text.slice(5)}`,
            'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"], "id": arg["id"]});
        else if(arg.text.slice(0, 7).toLowerCase() == "/spoof ")
          logMessage("* <i>"+convertBBCodeChat(arg.text.slice(7)) + "</i> <span class=\"spoof_name\">(by "+escapedName+")</span>", 'spoof_message',
            {'isChat': true, 'plainText': `* ${arg.text.slice(7)} (by ${arg.name})`,
            'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"], "id": arg["id"]});
        else
          logMessage("&lt;"+escapedName+"&gt; "+convertBBCodeChat(arg.text), 'user_message',
            {'isChat': true, 'plainText': `<${arg.name}> ${arg.text}`,
            'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"], "id": arg["id"]});
      } else
        if(arg.buttons) {
          let buttons = "";
          for(let i=0; i<arg.buttons.length/2; i++) {
            buttons += '<input type="button" value="'+arg.buttons[i*2]+'" onclick="sendChatCommand(\''+arg.buttons[i*2+1]+'\');"/>';
          }
          logMessage("! "+convertBBCodeChat(arg.text)+" "+buttons, arg["class"] ?? 'server_message',
            {'isChat': false, 'username': arg["username"], 'rc_username': arg["rc_username"] ?? arg["rc_id"], "id": arg["id"]});
        } else {
          if(arg["class"]) {
            if (arg["class"] == "server_motd")
              if (alreadySeenMOTD === arg["text"])
                break;
              else
                alreadySeenMOTD = arg["text"];
            if (arg["class"] == "event_notice")
              if (alreadySeenEvent === arg["text"])
                break;
              else
                alreadySeenEvent = arg["text"];
            if (messaging_mode) {
              if (arg["class"] == "server_stats") {
                if (alreadySeenStats)
                  break;
                else
                  alreadySeenStats = true;
              }
            }
            logMessage(convertBBCodeChat(arg.text), arg["class"],
              {'isChat': false, 'plainText': arg.text,
              'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"], "id": arg["id"]});
          } else
            logMessage("Server message: "+convertBBCodeChat(arg.text), 'server_message',
              {'isChat': false, 'plainText': "Server message: "+arg.text,
              'username': arg["username"] ?? arg["id"], 'rc_username': arg["rc_username"] ?? arg["rc_id"], "id": arg["id"]});
        }
      break;
    case "IDN":
      document.getElementById('passwordResetHint').style.display = "none";
      ReconnectAttempts = 0;
      DidConnectOnce = true;
      if(messaging_mode) {
        document.getElementById('onlineStatus').style.backgroundColor = "green";
        document.getElementById('onlineStatus').textContent = "Connected and logged in!";

        for (let item of MessagesToRetry) {
           SendCmd(item.commandType, item.commandArgs);
        }
        SendStatusMessageFromBeforeDisconnect();
      }

      API_Key = arg.api_key;
      API_Version = arg.api_version;
      API_URL = arg.api_url;

      break;

    case "PUT":
      {
        let id = arg.id;
        if (id === PlayerYou)
          break;
        if(id in PlayerWho)
          PlayerBuildMarkers[id] = {pos: arg.pos, name: PlayerWho[id].name, timer: 25, del: false};
      }
      break;
    case "DEL":
      {
        let id = arg.id;
        if (id === PlayerYou)
          break;
        if (id in PlayerWho)
          PlayerBuildMarkers[id] = {pos: [(arg.pos[0]+arg.pos[2])/2, (arg.pos[1]+arg.pos[3])/2], name: PlayerWho[id].name, timer: 50, del: true};
      }
      break;

    case "EXT":
      {
        if(arg.take_controls) {
          let take_controls = arg.take_controls;
          let supported_controls = take_controls.keys.filter((key) => SupportedTakeControlsKeys.includes(key));
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
        } else if(arg.get_user_profile) {
          if(arg.get_user_profile.not_found) {
            if(arg.get_user_profile?.id == PlayerYou) {
              userProfileEdit(true);
            } else if(arg.get_user_profile && "entity_name" in arg.get_user_profile && "entity_desc" in arg.get_user_profile) {
              openMiniUserProfileWindow(arg.get_user_profile.username, arg.get_user_profile.entity_name, arg.get_user_profile.entity_desc);
            } else if(arg.get_user_profile?.username in PlayerWho) {
              openMiniUserProfileWindow(arg.get_user_profile.username);
            } else if(arg.get_user_profile?.id in PlayerWho) {
              openMiniUserProfileWindow(arg.get_user_profile.id);
            } else {
              logMessage('User '+escape_tags(arg.get_user_profile.username)+' not found', 'error_message',   {'isChat': false});
            }
          } else {
            openUserProfileWindow(arg.get_user_profile);
          }
        } else if(arg.user_particle && userParticlesEnabled) {
          if(!arg.user_particle.action || arg.user_particle.action === "play") {
            if (!arg.user_particle.duration)
              arg.user_particle.duration = 10;
            UserParticles.push({timer: -1, data: arg.user_particle});
            if (typeof arg.user_particle.pic[0] === "string" && !(arg.user_particle.pic[0] in PlayerParticleImages)) {
              var img = new Image();
              img.onload = function(){
                NeedMapRedraw = true;
              };
              img.src = arg.user_particle.pic[0];
              PlayerParticleImages[arg.user_particle.pic[0]] = img;
            }
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
	let msg = event.data;
	if(msg.length<3)
		return;
	if(ShowProtocol)
		console.log("<< "+msg);
	receiveServerMessageString(msg);
}


let ReconnectTimeout = null;
let ReconnectAttempts = 0;
function AttemptReconnect() {
	if(!OnlineIsConnected && (!OnlineSocket || OnlineSocket.readyState == 3)) { // Socket should be marked as closed, if it exists
		ConnectToServer();
	}
}
function CancelReconnect() {
	if (ReconnectTimeout != null) {
		if (!messaging_mode) {
			logMessage("Press the Login button when you want to try again.", 'server_message');
		}
		clearTimeout(ReconnectTimeout);
		ReconnectTimeout = null;
	}
	if (messaging_mode) {
		document.getElementById('onlineStatus').innerHTML = "Not connected";
		document.getElementById('onlineStatus').style.backgroundColor = "gray";
	}
}

let addedUnloadHandler = false;
function ConnectToServer() {
	if (!addedUnloadHandler) {
		const beforeUnloadHandler = (event) => {
			event.preventDefault();
			event.returnValue = true;
		};
		window.addEventListener("beforeunload", beforeUnloadHandler);
		addedUnloadHandler = true;
	}

	OnlineMode = true;
	OnlineIsConnected = false;

	OnlineSocket = new WebSocket((OnlineSSL?"wss://":"ws://")+OnlineServer+":"+OnlinePort);
	if (messaging_mode) {
		document.getElementById('onlineStatus').textContent = "Attempting to connect"
		document.getElementById('onlineStatus').style.backgroundColor = "gray";
	} else {
		logMessage("Attempting to connect", 'server_message');
	}

	OnlineSocket.onopen = function (event) {
		if (messaging_mode) {
			document.getElementById('onlineStatus').textContent = "Connected! Now logging in...";
			document.getElementById('onlineStatus').style.backgroundColor = "green";
		} else {
			logMessage("Connected! Now logging in...", 'server_message');
		}

		// Log in with the server
		let idn_args = {};
		idn_args["features"] = {
			"see_past_map_edge": {"version": "0.0.1"},
			"batch": {"version": "0.0.1"},
			"receive_build_messages": {"version": "0.0.1"},
			"bulk_build": {"version": "0.0.1"},
			"message_acknowledgement": {"version": "0.0.1"},
		};

		if(OnlineUsername != "") {
			if(OnlinePassword != "") {
				idn_args["username"] = OnlineUsername;
				idn_args["password"] = OnlinePassword
			} else {
				idn_args["name"] = OnlineUsername;
			}
		};
		idn_args["client_name"] = CLIENT_NAME;
		if (messaging_mode) {
			idn_args["client_name"] = CLIENT_NAME + " (messaging)";
			idn_args["client_mode"] = "messaging";
		}
		if (touch_mode) {
			idn_args["client_name"] = CLIENT_NAME + " (touch)";
		}

		JoinedMapYet = false;
		OnlineIsConnected = true;
		SendCmd("IDN", idn_args);

		// Cancel any reconnect going on
		ReconnectAttempts = 0;
		if(ReconnectTimeout != null) {
			clearTimeout(ReconnectTimeout);
			ReconnectTimeout = null;
		}
	}

	OnlineSocket.onerror = function (event) {
		//logMessage("Socket error", 'error_message');
		//OnlineIsConnected = false;
	}

	OnlineSocket.onclose = function (event) {
		// Separate the message into a reason and a message
		let reason = event.reason;
		let should_reconnect = false;
		let display = OnlineIsConnected ? (event.wasClean ? 'Connection closed' : 'Connection closed due to an error') : 'Connection failed';
		let offer_register = false;

		if (event.code == 1000) {
			let message = '';
			let separatorIndex = reason.indexOf('\n');
			if(separatorIndex != -1) {
				message = reason.substring(separatorIndex+1);
				reason = reason.substring(0, separatorIndex);
			}
			let reasonSplit = reason.split(' ');
			if (reasonSplit.length > 1)
				reason = reasonSplit[0];

			// Handle the disconnect reasons
			if(!reason || reason == "Quit") {
				// Leave it as the default
			} else if(reason == "BadLogin") {
				display = "Connection closed due to bad login credentials";
				if (message === '' && reasonSplit.length > 1) {
					if (reasonSplit[1] === 'WrongPassword') {
						message = "Incorrect password for account";
					} else if (reasonSplit[1] === 'NonexistentAccount') {
						message = "That account doesn't exist!";
						offer_register = true;
					}
				}
				document.getElementById('loginWindow').style.display = "block";
				document.getElementById('loginErrorText').textContent = (message != '') ? message : mostRecentError;
				document.getElementById('passwordResetHint').style.display = "block";
			} else if(reason == "Shutdown") {
				display = "Connection closed because the server shut down";
			} else if(reason == "Restart") {
				display = "Connection closed because the server is restarting";
				should_reconnect = true;
			} else if(reason == "Ban") {
				display = "Connection closed because you're banned!! :(";
			} else if(reason == "Kick") {
				display = "Connection closed because you were kicked!";
			} else if(reason == "LoggedInElsewhere") {
				display = "Connection closed because you logged into this account somewhere else";
			} else if(reason == "TooManyConnections") {
				display = "Too many simultaneous connections from your IP address";
			} else if(reason == "ServerTooFull") {
				display = "Too many people are already connected to this server; try again later?";
			} else {
				display = "Connection closed because: " + convertBBCode(reason);
			}
			if(message != '')
				display += "<br>More information: "+convertBBCode(message);
		} else {
			if (reason)
				display += "<br>Reason: " + convertBBCode(reason);
			should_reconnect = event.code == 1006;
		}

		if(DidConnectOnce && (should_reconnect || !event.wasClean)) {
			// If this is the first disconnect and not a disconnect attempt, save the player status info
			if(ReconnectAttempts == 0) {
				StatusOnDisconnect = PlayerWho?.[PlayerYou]?.status;
				StatusMessageOnDisconnect = PlayerWho?.[PlayerYou]?.status_message;
			}
			// Don't keep retrying the connection forever
			if(ReconnectAttempts < 10) {
				ReconnectAttempts++;

				let seconds = ReconnectAttempts*10;
				if (messaging_mode) {
					seconds = Math.pow(2, ReconnectAttempts);
				}
				display+= "<br>Will try to reconnect in "+seconds+" seconds...";
				if(ReconnectAttempts == 1) {
					display += " <button onclick=\"CancelReconnect();\">Cancel</button>";
				}
				let timeoutAmount = 1000 * seconds;
				ReconnectTimeout = setTimeout(AttemptReconnect, timeoutAmount);
			} else {
				display+= "<br>Press the Login button when you want to try again.";
			}
		} else {
			StatusOnDisconnect = null;
		}
		if (messaging_mode) {
			document.getElementById('onlineStatus').innerHTML = display.replaceAll("<br>", " | ");
			document.getElementById('onlineStatus').style.backgroundColor = "red";
		} else if(display) {
			logMessage(display, 'error_message');
		}

		OnlineIsConnected = false;
		if (offer_register && confirm(`That account doesn't exist.\nDo you want to create a new account with the username "${OnlineUsername}" and the password you entered?`)) {
			document.getElementById('loginWindow').style.display = "none";
			let key = MessageAckReqPrefix + (MessageAckReqNumber++);
			let commandArgs = {text: `register ${OnlineUsername} ${OnlinePassword}`};
			commandArgs.ack_req = key;
			MessagesToRetry = [{commandType: "CMD", commandArgs, key, map_id: undefined}];
			OnlinePassword = "";
			ConnectToServer();			
		}
	}

	OnlineSocket.onmessage = receiveServerMessageEvent;
}
