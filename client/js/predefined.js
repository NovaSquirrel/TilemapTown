var Predefined = {};
Predefined.grass = {
  name: "grass",
  pic: [0, 0, 4],
  density: false,
};

Predefined.grass2 = {
  name: "grass",
  pic: [-1, 3, 0],
  density: false,
};

Predefined.grass3 = {
  name: "grass",
  pic: [-1, 3, 1],
  density: false,
};

Predefined.grass4 = {
  name: "grass",
  pic: [-1, 0, 3],
  density: false,
};

Predefined.dirt = {
  name: "dirt",
  pic: [0, 6, 4],
  density: false,
};

Predefined.dirt2 = {
  name: "dirt",
  pic: [-1, 2, 0],
  density: false,
};

Predefined.dirt3 = {
  name: "dirt",
  pic: [-1, 7, 2],
  density: false,
};

Predefined.water = {
  name: "water",
  pic: [-1, 1, 1],
  density: true,
};

Predefined.water2 = {
  name: "water",
  pic: [-1, 10, 3],
  density: true,
};

Predefined.waterfall = {
  name: "waterfall",
  pic: [-1, 1, 0],
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
  pic: [-1, 10, 2],
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
  pic: [-1, 8, 3],
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
  pic: [-1, 2, 3],
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

Predefined.eggplant2 = {
  name: "eggplant",
  pic: [-1, 3, 10],
  density: false,
  obj: true,
};

Predefined.watermelon = {
  name: "watermelon",
  pic: [-1, 0, 10],
  density: false,
  obj: true,
};

Predefined.cookie = {
  name: "cookie",
  pic: [-1, 1, 10],
  density: false,
  obj: true,
};

Predefined.chickenleg = {
  name: "chicken leg",
  pic: [-1, 2, 10],
  density: false,
  obj: true,
};

Predefined.pie = {
  name: "pie",
  pic: [-1, 4, 10],
  density: false,
  obj: true,
};

Predefined.pickle = {
  name: "pickle",
  pic: [-1, 7, 10],
  density: false,
  obj: true,
};

Predefined.potato = {
  name: "potato",
  pic: [-1, 8, 10],
  density: false,
  obj: true,
};

Predefined.cheese = {
  name: "cheese",
  pic: [-1, 10, 10],
  density: false,
  obj: true,
};

Predefined.pretzel = {
  name: "pretzel",
  pic: [-1, 13, 10],
  density: false,
  obj: true,
};

Predefined.turnip = {
  name: "turnip",
  pic: [-1, 15, 10],
  density: false,
  obj: true,
};

Predefined.bread = {
  name: "bread",
  pic: [0, 3, 19],
  density: false,
  obj: true,
};

Predefined.bread2 = {
  name: "bread",
  pic: [-1, 7, 6],
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
  name: "candy",
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

Predefined.icecream2 = {
  name: "icecream",
  pic: [-1, 6, 6],
  density: false,
  obj: true,
};

Predefined.pizza = {
  name: "pizza",
  pic: [-1, 5, 6],
  density: false,
  obj: true,
};

Predefined.soda = {
  name: "soda",
  pic: [-1, 4, 6],
  density: false,
  obj: true,
};

Predefined.apple = {
  name: "apple",
  pic: [-1, 3, 6],
  density: false,
  obj: true,
};

Predefined.apple2 = {
  name: "apple",
  pic: [-1, 9, 10],
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

Predefined.chest2 = {
  name: "chest",
  pic: [-1, 3, 3],
  density: true,
  obj: true,
};

Predefined.chest3 = {
  name: "chest",
  pic: [-1, 11, 6],
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

Predefined.diamond2 = {
  name: "diamond",
  pic: [-1, 8, 6],
  density: false,
  obj: true,
};

Predefined.diamond3 = {
  name: "diamond",
  pic: [-1, 9, 6],
  density: false,
  obj: true,
};

Predefined.diamond4 = {
  name: "diamond",
  pic: [-1, 10, 6],
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
  pic: [-1, 0, 0],
  density: true,
  obj: true,
};

Predefined.tree2 = {
  name: "tree",
  pic: [-1, 0, 1],
  density: true,
  obj: true,
};

Predefined.treefall = {
  name: "tree",
  pic: [-1, 9, 5],
  density: true,
  obj: true,
};

Predefined.treefall2 = {
  name: "tree",
  pic: [-1, 7, 5],
  density: true,
  obj: true,
};

Predefined.treewinter = {
  name: "tree",
  pic: [-1, 10, 5],
  density: true,
  obj: true,
};

Predefined.treewinter2 = {
  name: "tree",
  pic: [-1, 8, 5],
  density: true,
  obj: true,
};

Predefined.treetop = {
  name: "tree",
  pic: [-1, 6, 3],
  density: false,
  obj: true,
  over: true,
};

Predefined.treebot = {
  name: "tree",
  pic: [-1, 7, 3],
  density: true,
  obj: true,
};

Predefined.well = {
  name: "well",
  pic: [-1, 15, 1],
  density: true,
  obj: true,
};

Predefined.table = {
  name: "table",
  pic: [-1, 13, 3],
  density: true,
  obj: true,
};

Predefined.table2 = {
  name: "table",
  pic: [-1, 11, 4],
  density: true,
  obj: true,
};

Predefined.table3 = {
  name: "table",
  pic: [-1, 12, 4],
  density: true,
  obj: true,
};

Predefined.table4 = {
  name: "table",
  pic: [-1, 15, 5],
  density: true,
  obj: true,
};

Predefined.cabinet = {
  name: "cabinet",
  pic: [-1, 13, 5],
  density: true,
  obj: true,
};

Predefined.cabinet2 = {
  name: "cabinet",
  pic: [-1, 14, 5],
  density: true,
  obj: true,
};

Predefined.throne = {
  name: "throne",
  pic: [-1, 8, 4],
  density: true,
  obj: true,
};


Predefined.stool = {
  name: "stool",
  pic: [-1, 10, 4],
  density: false,
  obj: true,
};

Predefined.rockwall = {
  name: "rock wall",
  pic: [-1, 6, 4],
  density: true,
};

Predefined.statue = {
  name: "statue",
  pic: [-1, 7, 4],
  density: true,
  obj: true,
};

Predefined.stump = {
  name: "stump",
  pic: [-1, 5, 5],
  obj: true,
};

Predefined.window = {
  name: "window",
  pic: [-1, 6, 5],
  obj: true,
};

Predefined.pillar = {
  name: "pillar",
  pic: [-1, 9, 4],
  density: true,
  obj: true,
};



Predefined.drawers = {
  name: "drawers",
  pic: [-1, 14, 3],
  density: true,
  obj: true,
};

Predefined.drawers2 = {
  name: "drawers",
  pic: [-1, 13, 4],
  density: true,
  obj: true,
};

Predefined.glasswall = {
  name: "glass wall",
  pic: [-1, 1, 5],
  density: true,
  obj: true,
};

Predefined.tombstone = {
  name: "tombstone",
  pic: [-1, 12, 5],
  density: true,
  obj: true,
};

Predefined.mossrock = {
  name: "mossrock",
  pic: [-1, 11, 5],
  density: true,
  obj: true,
};

Predefined.grasstuft = {
  name: "grasstuft",
  pic: [-1, 5, 4],
  density: false,
  obj: true,
};

Predefined.lava = {
  name: "lava",
  pic: [-1, 11, 2],
  density: true,
  obj: false,
};

Predefined.door = {
  name: "door",
  pic: [-1, 15, 0],
  density: false,
  obj: true,
};

Predefined.goldchalice = {
  name: "gold chalice",
  pic: [-1, 5, 11],
  density: false,
  obj: true,
};

Predefined.goldbars = {
  name: "gold bars",
  pic: [-1, 6, 11],
  density: false,
  obj: true,
};


Predefined.book = {
  name: "book",
  pic: [-1, 0, 9],
  density: false,
  obj: true,
};

Predefined.bottle = {
  name: "bottle",
  pic: [-1, 1, 9],
  density: false,
  obj: true,
};

Predefined.orb = {
  name: "orb",
  pic: [-1, 2, 9],
  density: false,
  obj: true,
};


Predefined.mushroom = {
  name: "mushroom",
  pic: [-1, 3, 9],
  density: false,
  obj: true,
};

Predefined.scroll = {
  name: "scroll",
  pic: [-1, 6, 9],
  density: false,
  obj: true,
};

Predefined.sword = {
  name: "sword",
  pic: [-1, 7, 9],
  density: false,
  obj: true,
};


Predefined.colorwall1 = {
  name: "colored wall",
  pic: [-1, 0, 7],
  density: true,
};

Predefined.colorwall2 = {
  name: "colored wall",
  pic: [-1, 1, 7],
  density: true,
};

Predefined.colorwall3 = {
  name: "colored wall",
  pic: [-1, 2, 7],
  density: true,
};

Predefined.colorwall4 = {
  name: "colored wall",
  pic: [-1, 3, 7],
  density: true,
};

Predefined.colorwall5 = {
  name: "colored wall",
  pic: [-1, 4, 7],
  density: true,
};

Predefined.colorwall6 = {
  name: "colored wall",
  pic: [-1, 5, 7],
  density: true,
};

Predefined.colorwall7 = {
  name: "colored wall",
  pic: [-1, 6, 7],
  density: true,
};

Predefined.colorwall8 = {
  name: "colored wall",
  pic: [-1, 7, 7],
  density: true,
};

Predefined.colorwall9 = {
  name: "colored wall",
  pic: [-1, 8, 7],
  density: true,
};

Predefined.colorwall10 = {
  name: "colored wall",
  pic: [-1, 9, 7],
  density: true,
};

Predefined.colorwall11 = {
  name: "colored wall",
  pic: [-1, 10, 7],
  density: true,
};

Predefined.colorwall12 = {
  name: "colored wall",
  pic: [-1, 11, 7],
  density: true,
};

Predefined.colorwall13 = {
  name: "colored wall",
  pic: [-1, 12, 7],
  density: true,
};

Predefined.colorwall14 = {
  name: "colored wall",
  pic: [-1, 13, 7],
  density: true,
};

Predefined.colorwall15 = {
  name: "colored wall",
  pic: [-1, 14, 7],
  density: true,
};

Predefined.colorfloor1 = {
  name: "colored floor",
  pic: [-1, 0, 8],
};

Predefined.colorfloor2 = {
  name: "colored floor",
  pic: [-1, 1, 8],
};

Predefined.colorfloor3 = {
  name: "colored floor",
  pic: [-1, 2, 8],
};

Predefined.colorfloor4 = {
  name: "colored floor",
  pic: [-1, 3, 8],
};

Predefined.colorfloor5 = {
  name: "colored floor",
  pic: [-1, 4, 8],
};

Predefined.colorfloor6 = {
  name: "colored floor",
  pic: [-1, 5, 8],
};

Predefined.colorfloor7 = {
  name: "colored floor",
  pic: [-1, 6, 8],
};

Predefined.colorfloor8 = {
  name: "colored floor",
  pic: [-1, 7, 8],
};

Predefined.colorfloor9 = {
  name: "colored floor",
  pic: [-1, 8, 8],
};

Predefined.colorfloor10 = {
  name: "colored floor",
  pic: [-1, 9, 8],
};

Predefined.colorfloor11 = {
  name: "colored floor",
  pic: [-1, 10, 8],
};

Predefined.colorfloor12 = {
  name: "colored floor",
  pic: [-1, 11, 8],
};

Predefined.colorfloor13 = {
  name: "colored floor",
  pic: [-1, 12, 8],
};

Predefined.colorfloor14 = {
  name: "colored floor",
  pic: [-1, 13, 8],
};

Predefined.colorfloor15 = {
  name: "colored floor",
  pic: [-1, 14, 8],
};

Predefined.shadow = {
  name: "shadow",
  pic: [-1, 0, 19],
  obj: true,
  over: true
};
Predefined.shadow_dr = {
  name: "shadow",
  pic: [-1, 1, 19],
  obj: true,
  over: true
};
Predefined.shadow_dl = {
  name: "shadow",
  pic: [-1, 2, 19],
  obj: true,
  over: true
};
Predefined.shadow_ur = {
  name: "shadow",
  pic: [-1, 3, 19],
  obj: true,
  over: true
};
Predefined.shadow_ul = {
  name: "shadow",
  pic: [-1, 4, 19],
  obj: true,
  over: true
};
Predefined.shadow2 = {
  name: "shadow",
  pic: [-1, 5, 19],
  obj: true,
  over: true
};
Predefined.shadow2_dr = {
  name: "shadow",
  pic: [-1, 6, 19],
  obj: true,
  over: true
};
Predefined.shadow2_dl = {
  name: "shadow",
  pic: [-1, 7, 19],
  obj: true,
  over: true
};
Predefined.shadow2_ur = {
  name: "shadow",
  pic: [-1, 8, 19],
  obj: true,
  over: true
};
Predefined.shadow2_ul = {
  name: "shadow",
  pic: [-1, 9, 19],
  obj: true,
  over: true
};


var PredefinedArray = [];
var PredefinedArrayNames = [];
var i=0;
for (var key in Predefined) {
  PredefinedArrayNames[i] = key;
  PredefinedArray[i++] = Predefined[key];
}

/*
for (var key in Predefined) {
  var obj = Predefined[key];
  console.log(obj.name);
}
*/
