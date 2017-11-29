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
var OnlineMode = false;
var OnlineServer = null;
var OnlineMap = "";
var OnlineSocket = null;
var OnlineSSL = true;
var OnlinePort = 443;

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
  if(!OnlineMode)
    return;
  if(commandArgs)
    OnlineSocket.send(commandType+" "+JSON.stringify(commandArgs));
  else
    OnlineSocket.send(commandType);
}

function ConnectToServer() {
  OnlineMode = true;

  OnlineSocket = new WebSocket((OnlineSSL?"wss://":"ws://")+OnlineServer+":"+OnlinePort);
  logMessage("Attempting to connect");

  OnlineSocket.onopen = function (event) {
    logMessage("Connected!");
    SendCmd("IDN", null);
  }

  OnlineSocket.onerror = function (event) {
    logMessage("Socket error");
  }

  OnlineSocket.onclose = function (event) {
    logMessage("Connection closed");
  }

  OnlineSocket.onmessage = function (event) {
//    console.log(event.data);
    var msg = event.data;
    if(msg.length < 3)
      return;
    var cmd = msg.slice(0, 3);
    var arg = null;
    if(msg.length > 4)
      arg = JSON.parse(msg.slice(4));

    switch(cmd) {
      case "MOV":
        if(arg.id != PlayerYou) {
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
        if(arg.list)
          PlayerWho = arg.list;
        else if(arg.add) {
          if(!PlayerWho[arg.add.id]) // if player isn't already in the list
            logMessage("Connected: "+arg.add.name);
          PlayerWho[arg.add.id] = arg.add;
        } else if(arg.remove) {
          logMessage("Disconnected: "+PlayerWho[arg.remove].name);
          delete PlayerWho[arg.remove];
        }
        break;
      case "PIN":
        SendCmd("PIN", null);
        break;
      case "ERR":
        logMessage("Error: "+arg.text);
		break;
      case "MSG":
        if(arg.name) {
          if(arg.text.slice(0, 4) == "/me ")
            logMessage("* <i>"+arg.name+" "+arg.text.slice(4)+"</i>");
          else
            logMessage("&lt;"+arg.name+"&gt; "+arg.text);
        } else
          logMessage("Server message: "+arg.text);
        break;
    }
  };
}
