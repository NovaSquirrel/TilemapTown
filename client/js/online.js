var OnlineMode = false;
var OnlineServer = null;
var OnlineMap = "";
var OnlineSocket = null;

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

function AtomFromName(str) {
  if(typeof str === "string") {
    return Predefined[str];
  }
  return str;
}

function ConnectToServer() {
  OnlineMode = true;
  OnlineSocket = new WebSocket("ws://127.0.0.1:5678/");
  logMessage("Attempting to connect");

  OnlineSocket.onopen = function (event) {
    logMessage("Connected!");
  }

  OnlineSocket.onerror = function (event) {
    logMessage("Socket error");
  }

  OnlineSocket.onmessage = function (event) {
    var msg = event.data;
    if(msg.length < 3)
      return;
    var cmd = msg.slice(0, 3);
    var arg = null;
    if(msg.length > 4)
      arg = JSON.parse(msg.slice(4));

    switch(cmd) {
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
      case "PIN":
        SendCmd("PIN", null);
        break;
      case "MSG":
        if(arg.nick) {
          if(arg.text.slice(0, 4) == "/me ")
            logMessage("* <i>"+arg.nick+" "+arg.text+"</i>");
          else
            logMessage("&lt;"+arg.nick+"&gt; "+arg.text);
        } else
          logMessage("Server message: "+arg.text);
        break;
    }
  };
}
