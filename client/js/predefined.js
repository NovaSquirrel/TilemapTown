var Predefined = {};
Predefined.grass = {
  name: "grass",
  pic: [0, 0, 4],
  density: false,
};

Predefined.grass2 = {
  name: "grass",
  pic: [1, 0, 3],
  density: false,
};

Predefined.grass2 = {
  name: "grass",
  pic: [1, 3, 0],
  density: false,
};

Predefined.grass3 = {
  name: "grass",
  pic: [1, 3, 1],
  density: false,
};

Predefined.dirt = {
  name: "dirt",
  pic: [0, 6, 4],
  density: false,
};

Predefined.dirt2 = {
  name: "dirt",
  pic: [1, 2, 0],
  density: false,
};

Predefined.dirt3 = {
  name: "dirt",
  pic: [1, 7, 2],
  density: false,
};

Predefined.water = {
  name: "water",
  pic: [1, 1, 1],
  density: true,
};

Predefined.water2 = {
  name: "water",
  pic: [1, 10, 3],
  density: true,
};

Predefined.waterfall = {
  name: "waterfall",
  pic: [1, 1, 0],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.SOUTH,  
};

Predefined.brownsand = {
  name: "brown sand",
  pic: [0, 10, 3],
  density: false,
};

Predefined.purplesand = {
  name: "purple sand",
  pic: [0, 10, 4],
  density: false,
};

Predefined.redbrickfloor = {
  name: "red brick floor",
  pic: [0, 10, 8],
  density: false,
};

Predefined.graybrickfloor = {
  name: "gray brick floor",
  pic: [0, 11, 8],
  density: false,
};

Predefined.stonewall = {
  name: "stone wall",
  pic: [0, 9, 1],
  density: true,
};

Predefined.xblock = {
  name: "x block",
  pic: [0, 15, 0],
  density: true,
};

Predefined.ice = {
  name: "ice",
  pic: [0, 15, 10],
  density: false,
  type: AtomTypes.ICE,
};

Predefined.brownbricks = {
  name: "brown bricks",
  pic: [0, 7, 6],
  density: true,
};

Predefined.woodfloor2 = {
  name: "wood floor",
  pic: [1, 10, 2],
  density: false,
};

Predefined.woodfloor = {
  name: "wood floor",
  pic: [0, 1, 6],
  density: false,
};

Predefined.woodwall = {
  name: "wood wall",
  pic: [0, 3, 8],
  density: true,
};

Predefined.floor1 = {
  name: "floor",
  pic: [0, 6, 15],
  density: false,
};

Predefined.floor2 = {
  name: "floor",
  pic: [0, 7, 15],
  density: false,
};

Predefined.floor3 = {
  name: "floor",
  pic: [0, 7, 14],
  density: false,
};

Predefined.floor4 = {
  name: "floor",
  pic: [0, 7, 13],
  density: false,
};

Predefined.floor5 = {
  name: "floor",
  pic: [0, 6, 17],
  density: false,
};

Predefined.forcedown = {
  name: "force",
  pic: [0, 12, 19],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.SOUTH,
};

Predefined.forceup = {
  name: "force",
  pic: [0, 13, 19],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.NORTH,
};

Predefined.forceleft = {
  name: "force",
  pic: [0, 14, 19],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.WEST,
};

Predefined.forceright = {
  name: "force",
  pic: [0, 15, 19],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.EAST,
};

Predefined.bluewall = {
  name: "blue wall",
  pic: [0, 16, 27],
  density: true,
};

Predefined.pinkwall = {
  name: "pink wall",
  pic: [0, 17, 27],
  density: true,
};

Predefined.greenwall = {
  name: "green wall",
  pic: [0, 18, 27],
  density: true,
};

Predefined.orangewall = {
  name: "orange wall",
  pic: [0, 19, 27],
  density: true,
};



// objects
Predefined.skull = {
  name: "skull",
  pic: [0, 11, 10],
  density: true,
  obj: true,
};

Predefined.bush1 = {
  name: "bush",
  pic: [0, 13, 16],
  density: true,
  obj: true,
};

Predefined.bush2 = {
  name: "bush",
  pic: [0, 14, 16],
  density: true,
  obj: true,
};

Predefined.bush3 = {
  name: "bush",
  pic: [1, 8, 3],
  density: true,
  obj: true,
};

Predefined.rocks1 = {
  name: "rocks",
  pic: [0, 15, 16],
  density: true,
  obj: true,
};

Predefined.rocks2 = {
  name: "rocks",
  pic: [0, 16, 16],
  density: true,
  obj: true,
};

Predefined.rocks3 = {
  name: "rocks",
  pic: [0, 17, 16],
  density: true,
  obj: true,
};

Predefined.flower1 = {
  name: "flowers",
  pic: [0, 15, 15],
  density: false,
  obj: true,
};

Predefined.flower2 = {
  name: "flowers",
  pic: [0, 16, 15],
  density: false,
  obj: true,
};

Predefined.flower3 = {
  name: "flower",
  pic: [0, 17, 15],
  density: false,
  obj: true,
};

Predefined.flower4 = {
  name: "flowers",
  pic: [0, 18, 15],
  density: false,
  obj: true,
};

Predefined.sign = {
  name: "sign",
  pic: [0, 16, 17],
  density: true,
  obj: true,
  type: AtomTypes.SIGN,
};

Predefined.redwhitesign = {
  name: "sign",
  pic: [0, 17, 17],
  density: true,
  obj: true,
};

Predefined.pot1 = {
  name: "pot",
  pic: [0, 16, 18],
  density: true,
  obj: true,
};

Predefined.pot2 = {
  name: "pot",
  pic: [0, 17, 18],
  density: true,
  obj: true,
};

Predefined.barrel = {
  name: "barrel",
  pic: [0, 18, 18],
  density: true,
  obj: true,
};

Predefined.barrel2 = {
  name: "barrel",
  pic: [1, 2, 3],
  density: true,
  obj: true,
};

Predefined.books = {
  name: "bookshelves",
  pic: [0, 19, 18],
  density: true,
  obj: true,
};

Predefined.tv1 = {
  name: "television",
  pic: [0, 21, 18],
  density: true,
  obj: true,
};

Predefined.tv2 = {
  name: "television",
  pic: [0, 22, 18],
  density: true,
  obj: true,
};

Predefined.cherry = {
  name: "cherry",
  pic: [0, 0, 19],
  density: false,
  obj: true,
};

Predefined.corn = {
  name: "corn",
  pic: [0, 1, 19],
  density: false,
  obj: true,
};

Predefined.eggplant = {
  name: "eggplant",
  pic: [0, 2, 19],
  density: false,
  obj: true,
};

Predefined.bread = {
  name: "bread",
  pic: [0, 3, 19],
  density: false,
  obj: true,
};

Predefined.eggs = {
  name: "bacon and eggs",
  pic: [0, 4, 19],
  density: false,
  obj: true,
};

Predefined.eggs2 = {
  name: "egg",
  pic: [0, 5, 19],
  density: false,
  obj: true,
};

Predefined.candy = {
  name: "corn",
  pic: [0, 6, 19],
  density: false,
  obj: true,
};

Predefined.cake = {
  name: "cake",
  pic: [0, 8, 19],
  density: false,
  obj: true,
};

Predefined.icecream = {
  name: "icecream",
  pic: [0, 9, 19],
  density: false,
  obj: true,
};

Predefined.box = {
  name: "box",
  pic: [0, 0, 20],
  density: true,
  obj: true,
};

Predefined.chest = {
  name: "chest",
  pic: [0, 1, 20],
  closedpic: [0, 1, 20],
  openpic:   [0, 2, 20],
  density: true,
  obj: true,
};

Predefined.chest = {
  name: "chest",
  pic: [1, 3, 3],
  density: true,
  obj: true,
};

Predefined.coin = {
  name: "coin",
  pic: [0, 3, 20],
  density: false,
  obj: true,
};

Predefined.diamond = {
  name: "diamond",
  pic: [0, 4, 20],
  density: false,
  obj: true,
};

Predefined.stopwatch = {
  name: "stopwatch",
  pic: [0, 5, 20],
  density: false,
  obj: true,
};

Predefined.potion1 = {
  name: "potion",
  pic: [0, 6, 20],
  density: false,
  obj: true,
};

Predefined.potion2 = {
  name: "potion",
  pic: [0, 7, 20],
  density: false,
  obj: true,
};

Predefined.potion3 = {
  name: "potion",
  pic: [0, 8, 20],
  density: false,
  obj: true,
};

Predefined.tree = {
  name: "tree",
  pic: [1, 0, 0],
  density: true,
  obj: true,
};

Predefined.tree2 = {
  name: "tree",
  pic: [1, 0, 1],
  density: true,
  obj: true,
};

Predefined.treetop = {
  name: "tree",
  pic: [1, 6, 3],
  density: false,
  obj: true,
  over: true,
};

Predefined.treebot = {
  name: "tree",
  pic: [1, 7, 3],
  density: true,
  obj: true,
};

var PredefinedArray = [];
var i=0;
for (var key in Predefined) {
  PredefinedArray[i++] = Predefined[key];
}

/*
for (var key in Predefined) {
  var obj = Predefined[key];
  console.log(obj.name);
}
*/
