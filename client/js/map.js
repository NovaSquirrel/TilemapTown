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
var AtomTypes = {
  NONE      : 0, // no special behavior
  SIGN      : 1, // display a message upon being bumped into
  DOOR      : 2,
  CONTAINER : 3,
  ICE       : 4,
  ESCALATOR : 5,
  WATER     : 6,
};

var AtomLayers = {
  TURF      : 0,
  OBJ       : 1,
  MOB       : 2,
  FLY       : 3,
};

var Directions = {
  EAST      : 0,
  SOUTHEAST : 1,
  SOUTH     : 2,
  SOUTHWEST : 3,
  WEST      : 4,
  NORTHWEST : 5,
  NORTH     : 6,
  NORTHEAST : 7,
}

var DirX = [ 1,  1,  0, -1, -1, -1,  0,  1];
var DirY = [ 0,  1,  1,  1,  0, -1, -1, -1];

// world map
var MapTiles  = [];
var MapWidth  = 60;
var MapHeight = 60;
var MapObjs   = [];
var IconSheets = [];

var AtomFields = {

};

function CloneAtom(atom) {
  return JSON.parse(JSON.stringify(atom));
}

function AtomFromName(str) {
  if(typeof str === "string") {
    if(Predefined[str])
      return Predefined[str];
    else {
      console.log("Unknown atom: "+str);
      return Predefined.grass;
    }
  }
  return str;
}

function initMap() {
  IconSheets[0] = document.getElementById("potluck");
  IconSheets[1] = document.getElementById("extras");

  // Initialize the map
  for(var i=0; i<MapWidth; i++) {
    MapTiles[i] = [];
    MapObjs[i] = [];
    for(var j=0; j<MapHeight; j++) {
      MapTiles[i][j] = "grass";
      MapObjs[i][j] = [];
    }
  }
}
