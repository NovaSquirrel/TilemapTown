let GlobalTiles = {};
GlobalTiles.grass = {
  name: "grass",
  pic: [0, 0, 4],
  density: false,
};

GlobalTiles.grass2 = {
  name: "grass",
  pic: [-1, 3, 0],
  density: false,
};

GlobalTiles.grass3 = {
  name: "grass",
  pic: [-1, 3, 1],
  density: false,
};

GlobalTiles.grass4 = {
  name: "grass",
  pic: [-1, 0, 3],
  density: false,
};

GlobalTiles.dirt = {
  name: "dirt",
  pic: [0, 6, 4],
  density: false,
};

GlobalTiles.dirt2 = {
  name: "dirt",
  pic: [-1, 2, 0],
  density: false,
};

GlobalTiles.dirt3 = {
  name: "dirt",
  pic: [-1, 7, 2],
  density: false,
};

GlobalTiles.water = {
  name: "water",
  pic: [-1, 1, 1],
  density: true,
};

GlobalTiles.water2 = {
  name: "water",
  pic: [-1, 10, 3],
  density: true,
};

GlobalTiles.waterfall = {
  name: "waterfall",
  pic: [-1, 1, 0],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.SOUTH,  
};

GlobalTiles.brownsand = {
  name: "brown sand",
  pic: [0, 10, 3],
  density: false
};

GlobalTiles.purplesand = {
  name: "purple sand",
  pic: [0, 10, 4],
  density: false
};

GlobalTiles.redbrickfloor = {
  name: "red brick floor",
  pic: [0, 10, 8],
  density: false
};

GlobalTiles.graybrickfloor = {
  name: "gray brick floor",
  pic: [0, 11, 8],
  density: false,
};

GlobalTiles.stonewall = {
  name: "stone wall",
  pic: [0, 9, 1],
  density: true,
};

GlobalTiles.xblock = {
  name: "x block",
  pic: [0, 15, 0],
  density: true,
};

GlobalTiles.ice = {
  name: "ice",
  pic: [0, 15, 10],
  density: false,
  type: AtomTypes.ICE,
};

GlobalTiles.brownbricks = {
  name: "brown bricks",
  pic: [0, 7, 6],
  density: true,
};

GlobalTiles.woodfloor2 = {
  name: "wood floor",
  pic: [-1, 10, 2],
  density: false,
};

GlobalTiles.woodfloor = {
  name: "wood floor",
  pic: [0, 1, 6],
  density: false,
};

GlobalTiles.woodwall = {
  name: "wood wall",
  pic: [0, 3, 8],
  density: true,
};

GlobalTiles.floor1 = {
  name: "floor",
  pic: [0, 6, 15],
  density: false,
};

GlobalTiles.floor2 = {
  name: "floor",
  pic: [0, 7, 15],
  density: false,
};

GlobalTiles.floor3 = {
  name: "floor",
  pic: [0, 7, 14],
  density: false,
};

GlobalTiles.floor4 = {
  name: "floor",
  pic: [0, 7, 13],
  density: false,
};

GlobalTiles.floor5 = {
  name: "floor",
  pic: [0, 6, 17],
  density: false,
};

GlobalTiles.forcedown = {
  name: "force",
  pic: [0, 12, 19],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.SOUTH,
};

GlobalTiles.forceup = {
  name: "force",
  pic: [0, 13, 19],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.NORTH,
};

GlobalTiles.forceleft = {
  name: "force",
  pic: [0, 14, 19],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.WEST,
};

GlobalTiles.forceright = {
  name: "force",
  pic: [0, 15, 19],
  density: false,
  type: AtomTypes.ESCALATOR,
  dir: Directions.EAST,
};

GlobalTiles.bluewall = {
  name: "blue wall",
  pic: [0, 16, 27],
  density: true,
};

GlobalTiles.pinkwall = {
  name: "pink wall",
  pic: [0, 17, 27],
  density: true,
};

GlobalTiles.greenwall = {
  name: "green wall",
  pic: [0, 18, 27],
  density: true,
};

GlobalTiles.orangewall = {
  name: "orange wall",
  pic: [0, 19, 27],
  density: true,
};



// objects
GlobalTiles.skull = {
  name: "skull",
  pic: [0, 11, 10],
  density: true,
  obj: true,
};

GlobalTiles.bush1 = {
  name: "bush",
  pic: [0, 13, 16],
  density: true,
  obj: true,
};

GlobalTiles.bush2 = {
  name: "bush",
  pic: [0, 14, 16],
  density: true,
  obj: true,
};

GlobalTiles.bush3 = {
  name: "bush",
  pic: [-1, 8, 3],
  density: true,
  obj: true,
};

GlobalTiles.rocks1 = {
  name: "rocks",
  pic: [0, 15, 16],
  density: true,
  obj: true,
};

GlobalTiles.rocks2 = {
  name: "rocks",
  pic: [0, 16, 16],
  density: true,
  obj: true,
};

GlobalTiles.rocks3 = {
  name: "rocks",
  pic: [0, 17, 16],
  density: true,
  obj: true,
};

GlobalTiles.flower1 = {
  name: "flowers",
  pic: [0, 15, 15],
  density: false,
  obj: true,
};

GlobalTiles.flower2 = {
  name: "flowers",
  pic: [0, 16, 15],
  density: false,
  obj: true,
};

GlobalTiles.flower3 = {
  name: "flower",
  pic: [0, 17, 15],
  density: false,
  obj: true,
};

GlobalTiles.flower4 = {
  name: "flowers",
  pic: [0, 18, 15],
  density: false,
  obj: true,
};

GlobalTiles.sign = {
  name: "sign",
  pic: [0, 16, 17],
  density: true,
  obj: true,
  type: AtomTypes.SIGN,
};

GlobalTiles.redwhitesign = {
  name: "sign",
  pic: [0, 17, 17],
  density: true,
  obj: true,
};

GlobalTiles.pot1 = {
  name: "pot",
  pic: [0, 16, 18],
  density: true,
  obj: true,
};

GlobalTiles.pot2 = {
  name: "pot",
  pic: [0, 17, 18],
  density: true,
  obj: true,
};

GlobalTiles.barrel = {
  name: "barrel",
  pic: [0, 18, 18],
  density: true,
  obj: true,
};

GlobalTiles.barrel2 = {
  name: "barrel",
  pic: [-1, 2, 3],
  density: true,
  obj: true,
};

GlobalTiles.books = {
  name: "bookshelves",
  pic: [0, 19, 18],
  density: true,
  obj: true,
};

GlobalTiles.tv1 = {
  name: "television",
  pic: [0, 21, 18],
  density: true,
  obj: true,
};

GlobalTiles.tv2 = {
  name: "television",
  pic: [0, 22, 18],
  density: true,
  obj: true,
};

GlobalTiles.cherry = {
  name: "cherry",
  pic: [0, 0, 19],
  density: false,
  obj: true,
};

GlobalTiles.corn = {
  name: "corn",
  pic: [0, 1, 19],
  density: false,
  obj: true,
};

GlobalTiles.eggplant = {
  name: "eggplant",
  pic: [0, 2, 19],
  density: false,
  obj: true,
};

GlobalTiles.eggplant2 = {
  name: "eggplant",
  pic: [-1, 3, 10],
  density: false,
  obj: true,
};

GlobalTiles.watermelon = {
  name: "watermelon",
  pic: [-1, 0, 10],
  density: false,
  obj: true,
};

GlobalTiles.cookie = {
  name: "cookie",
  pic: [-1, 1, 10],
  density: false,
  obj: true,
};

GlobalTiles.chickenleg = {
  name: "chicken leg",
  pic: [-1, 2, 10],
  density: false,
  obj: true,
};

GlobalTiles.pie = {
  name: "pie",
  pic: [-1, 4, 10],
  density: false,
  obj: true,
};

GlobalTiles.pickle = {
  name: "pickle",
  pic: [-1, 7, 10],
  density: false,
  obj: true,
};

GlobalTiles.potato = {
  name: "potato",
  pic: [-1, 8, 10],
  density: false,
  obj: true,
};

GlobalTiles.cheese = {
  name: "cheese",
  pic: [-1, 10, 10],
  density: false,
  obj: true,
};

GlobalTiles.pretzel = {
  name: "pretzel",
  pic: [-1, 13, 10],
  density: false,
  obj: true,
};

GlobalTiles.turnip = {
  name: "turnip",
  pic: [-1, 15, 10],
  density: false,
  obj: true,
};

GlobalTiles.bread = {
  name: "bread",
  pic: [0, 3, 19],
  density: false,
  obj: true,
};

GlobalTiles.bread2 = {
  name: "bread",
  pic: [-1, 7, 6],
  density: false,
  obj: true,
};

GlobalTiles.eggs = {
  name: "bacon and eggs",
  pic: [0, 4, 19],
  density: false,
  obj: true,
};

GlobalTiles.eggs2 = {
  name: "egg",
  pic: [0, 5, 19],
  density: false,
  obj: true,
};

GlobalTiles.candy = {
  name: "candy",
  pic: [0, 6, 19],
  density: false,
  obj: true,
};

GlobalTiles.cake = {
  name: "cake",
  pic: [0, 8, 19],
  density: false,
  obj: true,
};

GlobalTiles.icecream = {
  name: "icecream",
  pic: [0, 9, 19],
  density: false,
  obj: true,
};

GlobalTiles.icecream2 = {
  name: "icecream",
  pic: [-1, 6, 6],
  density: false,
  obj: true,
};

GlobalTiles.pizza = {
  name: "pizza",
  pic: [-1, 5, 6],
  density: false,
  obj: true,
};

GlobalTiles.soda = {
  name: "soda",
  pic: [-1, 4, 6],
  density: false,
  obj: true,
};

GlobalTiles.apple = {
  name: "apple",
  pic: [-1, 3, 6],
  density: false,
  obj: true,
};

GlobalTiles.apple2 = {
  name: "apple",
  pic: [-1, 9, 10],
  density: false,
  obj: true,
};


GlobalTiles.box = {
  name: "box",
  pic: [0, 0, 20],
  density: true,
  obj: true,
};

GlobalTiles.chest = {
  name: "chest",
  pic: [0, 1, 20],
  closedpic: [0, 1, 20],
  openpic:   [0, 2, 20],
  density: true,
  obj: true,
};

GlobalTiles.chest2 = {
  name: "chest",
  pic: [-1, 3, 3],
  density: true,
  obj: true,
};

GlobalTiles.chest3 = {
  name: "chest",
  pic: [-1, 11, 6],
  density: true,
  obj: true,
};

GlobalTiles.coin = {
  name: "coin",
  pic: [0, 3, 20],
  density: false,
  obj: true,
};

GlobalTiles.diamond = {
  name: "diamond",
  pic: [0, 4, 20],
  density: false,
  obj: true,
};

GlobalTiles.diamond2 = {
  name: "diamond",
  pic: [-1, 8, 6],
  density: false,
  obj: true,
};

GlobalTiles.diamond3 = {
  name: "diamond",
  pic: [-1, 9, 6],
  density: false,
  obj: true,
};

GlobalTiles.diamond4 = {
  name: "diamond",
  pic: [-1, 10, 6],
  density: false,
  obj: true,
};

GlobalTiles.stopwatch = {
  name: "stopwatch",
  pic: [0, 5, 20],
  density: false,
  obj: true,
};

GlobalTiles.potion1 = {
  name: "potion",
  pic: [0, 6, 20],
  density: false,
  obj: true,
};

GlobalTiles.potion2 = {
  name: "potion",
  pic: [0, 7, 20],
  density: false,
  obj: true,
};

GlobalTiles.potion3 = {
  name: "potion",
  pic: [0, 8, 20],
  density: false,
  obj: true,
};

GlobalTiles.tree = {
  name: "tree",
  pic: [-1, 0, 0],
  density: true,
  obj: true,
};

GlobalTiles.tree2 = {
  name: "tree",
  pic: [-1, 0, 1],
  density: true,
  obj: true,
};

GlobalTiles.treefall = {
  name: "tree",
  pic: [-1, 9, 5],
  density: true,
  obj: true,
};

GlobalTiles.treefall2 = {
  name: "tree",
  pic: [-1, 7, 5],
  density: true,
  obj: true,
};

GlobalTiles.treewinter = {
  name: "tree",
  pic: [-1, 10, 5],
  density: true,
  obj: true,
};

GlobalTiles.treewinter2 = {
  name: "tree",
  pic: [-1, 8, 5],
  density: true,
  obj: true,
};

GlobalTiles.treetop = {
  name: "tree",
  pic: [-1, 6, 3],
  density: false,
  obj: true,
  over: true,
};

GlobalTiles.treebot = {
  name: "tree",
  pic: [-1, 7, 3],
  density: true,
  obj: true,
};

GlobalTiles.well = {
  name: "well",
  pic: [-1, 15, 1],
  density: true,
  obj: true,
};

GlobalTiles.table = {
  name: "table",
  pic: [-1, 13, 3],
  density: true,
  obj: true,
};

GlobalTiles.table2 = {
  name: "table",
  pic: [-1, 11, 4],
  density: true,
  obj: true,
};

GlobalTiles.table3 = {
  name: "table",
  pic: [-1, 12, 4],
  density: true,
  obj: true,
};

GlobalTiles.table4 = {
  name: "table",
  pic: [-1, 15, 5],
  density: true,
  obj: true,
};

GlobalTiles.cabinet = {
  name: "cabinet",
  pic: [-1, 13, 5],
  density: true,
  obj: true,
};

GlobalTiles.cabinet2 = {
  name: "cabinet",
  pic: [-1, 14, 5],
  density: true,
  obj: true,
};

GlobalTiles.throne = {
  name: "throne",
  pic: [-1, 8, 4],
  density: true,
  obj: true,
};


GlobalTiles.stool = {
  name: "stool",
  pic: [-1, 10, 4],
  density: false,
  obj: true,
};

GlobalTiles.rockwall = {
  name: "rock wall",
  pic: [-1, 6, 4],
  density: true,
};

GlobalTiles.statue = {
  name: "statue",
  pic: [-1, 7, 4],
  density: true,
  obj: true,
};

GlobalTiles.stump = {
  name: "stump",
  pic: [-1, 5, 5],
  obj: true,
};

GlobalTiles.window = {
  name: "window",
  pic: [-1, 6, 5],
  obj: true,
};

GlobalTiles.pillar = {
  name: "pillar",
  pic: [-1, 9, 4],
  density: true,
  obj: true,
};



GlobalTiles.drawers = {
  name: "drawers",
  pic: [-1, 14, 3],
  density: true,
  obj: true,
};

GlobalTiles.drawers2 = {
  name: "drawers",
  pic: [-1, 13, 4],
  density: true,
  obj: true,
};

GlobalTiles.glasswall = {
  name: "glass wall",
  pic: [-1, 1, 5],
  density: true,
  obj: true,
};

GlobalTiles.tombstone = {
  name: "tombstone",
  pic: [-1, 12, 5],
  density: true,
  obj: true,
};

GlobalTiles.mossrock = {
  name: "mossrock",
  pic: [-1, 11, 5],
  density: true,
  obj: true,
};

GlobalTiles.grasstuft = {
  name: "grasstuft",
  pic: [-1, 5, 4],
  density: false,
  obj: true,
};

GlobalTiles.lava = {
  name: "lava",
  pic: [-1, 11, 2],
  density: true,
  obj: false,
};

GlobalTiles.door = {
  name: "door",
  pic: [-1, 15, 0],
  density: false,
  obj: true,
};

GlobalTiles.goldchalice = {
  name: "gold chalice",
  pic: [-1, 5, 11],
  density: false,
  obj: true,
};

GlobalTiles.goldbars = {
  name: "gold bars",
  pic: [-1, 6, 11],
  density: false,
  obj: true,
};


GlobalTiles.book = {
  name: "book",
  pic: [-1, 0, 9],
  density: false,
  obj: true,
};

GlobalTiles.bottle = {
  name: "bottle",
  pic: [-1, 1, 9],
  density: false,
  obj: true,
};

GlobalTiles.orb = {
  name: "orb",
  pic: [-1, 2, 9],
  density: false,
  obj: true,
};


GlobalTiles.mushroom = {
  name: "mushroom",
  pic: [-1, 3, 9],
  density: false,
  obj: true,
};

GlobalTiles.scroll = {
  name: "scroll",
  pic: [-1, 6, 9],
  density: false,
  obj: true,
};

GlobalTiles.sword = {
  name: "sword",
  pic: [-1, 7, 9],
  density: false,
  obj: true,
};


GlobalTiles.colorwall1 = {
  name: "colored wall",
  pic: [-1, 0, 7],
  density: true,
};

GlobalTiles.colorwall2 = {
  name: "colored wall",
  pic: [-1, 1, 7],
  density: true,
};

GlobalTiles.colorwall3 = {
  name: "colored wall",
  pic: [-1, 2, 7],
  density: true,
};

GlobalTiles.colorwall4 = {
  name: "colored wall",
  pic: [-1, 3, 7],
  density: true,
};

GlobalTiles.colorwall5 = {
  name: "colored wall",
  pic: [-1, 4, 7],
  density: true,
};

GlobalTiles.colorwall6 = {
  name: "colored wall",
  pic: [-1, 5, 7],
  density: true,
};

GlobalTiles.colorwall7 = {
  name: "colored wall",
  pic: [-1, 6, 7],
  density: true,
};

GlobalTiles.colorwall8 = {
  name: "colored wall",
  pic: [-1, 7, 7],
  density: true,
};

GlobalTiles.colorwall9 = {
  name: "colored wall",
  pic: [-1, 8, 7],
  density: true,
};

GlobalTiles.colorwall10 = {
  name: "colored wall",
  pic: [-1, 9, 7],
  density: true,
};

GlobalTiles.colorwall11 = {
  name: "colored wall",
  pic: [-1, 10, 7],
  density: true,
};

GlobalTiles.colorwall12 = {
  name: "colored wall",
  pic: [-1, 11, 7],
  density: true,
};

GlobalTiles.colorwall13 = {
  name: "colored wall",
  pic: [-1, 12, 7],
  density: true,
};

GlobalTiles.colorwall14 = {
  name: "colored wall",
  pic: [-1, 13, 7],
  density: true,
};

GlobalTiles.colorwall15 = {
  name: "colored wall",
  pic: [-1, 14, 7],
  density: true,
};

GlobalTiles.colorfloor1 = {
  name: "colored floor",
  pic: [-1, 0, 8],
};

GlobalTiles.colorfloor2 = {
  name: "colored floor",
  pic: [-1, 1, 8],
};

GlobalTiles.colorfloor3 = {
  name: "colored floor",
  pic: [-1, 2, 8],
};

GlobalTiles.colorfloor4 = {
  name: "colored floor",
  pic: [-1, 3, 8],
};

GlobalTiles.colorfloor5 = {
  name: "colored floor",
  pic: [-1, 4, 8],
};

GlobalTiles.colorfloor6 = {
  name: "colored floor",
  pic: [-1, 5, 8],
};

GlobalTiles.colorfloor7 = {
  name: "colored floor",
  pic: [-1, 6, 8],
};

GlobalTiles.colorfloor8 = {
  name: "colored floor",
  pic: [-1, 7, 8],
};

GlobalTiles.colorfloor9 = {
  name: "colored floor",
  pic: [-1, 8, 8],
};

GlobalTiles.colorfloor10 = {
  name: "colored floor",
  pic: [-1, 9, 8],
};

GlobalTiles.colorfloor11 = {
  name: "colored floor",
  pic: [-1, 10, 8],
};

GlobalTiles.colorfloor12 = {
  name: "colored floor",
  pic: [-1, 11, 8],
};

GlobalTiles.colorfloor13 = {
  name: "colored floor",
  pic: [-1, 12, 8],
};

GlobalTiles.colorfloor14 = {
  name: "colored floor",
  pic: [-1, 13, 8],
};

GlobalTiles.colorfloor15 = {
  name: "colored floor",
  pic: [-1, 14, 8],
};

GlobalTiles.shadow = {
  name: "shadow",
  pic: [-1, 0, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow_dr = {
  name: "shadow",
  pic: [-1, 1, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow_dl = {
  name: "shadow",
  pic: [-1, 2, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow_ur = {
  name: "shadow",
  pic: [-1, 3, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow_ul = {
  name: "shadow",
  pic: [-1, 4, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow2 = {
  name: "shadow",
  pic: [-1, 5, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow2_dr = {
  name: "shadow",
  pic: [-1, 6, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow2_dl = {
  name: "shadow",
  pic: [-1, 7, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow2_ur = {
  name: "shadow",
  pic: [-1, 8, 19],
  obj: true,
  over: true
};
GlobalTiles.shadow2_ul = {
  name: "shadow",
  pic: [-1, 9, 19],
  obj: true,
  over: true
};


var GlobalTilesArray = [];
var GlobalTilesArrayNames = [];
var i=0;
for (var key in GlobalTiles) {
  GlobalTilesArrayNames[i] = key;
  GlobalTilesArray[i++] = GlobalTiles[key];
}

/*
for (var key in GlobalTiles) {
  var obj = GlobalTiles[key];
  console.log(obj.name);
}
*/
