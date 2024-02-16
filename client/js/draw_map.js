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

let edgeMapLookupTable = [
	null, // durl - invalid
	4,    // durL
	0,    // duRl
	null, // duRL - invalid
	6,    // dUrl
	5,    // dUrL
	7,    // dURl
	null, // dURL - invalid
	2,    // Durl
	3,    // DurL
	1,    // DuRl
];

///////////////////////////////////////////////////////////
// Autotile related functions
///////////////////////////////////////////////////////////

function getForAutotile(t, map, x, y) {
	// Get a map tile, except that off-map tiles return t instead
	if (x < 0 || x >= map.Width || y < 0 || y >= map.Height)
		return t;
	return map.Tiles[x][y];
}

function isAutotileMatch(t, map, x, y) {
	// Is the tile on the map at x,y the "same" as t for autotiling purposes?
	let other = AtomFromName(getForAutotile(t, map, x, y));
	if (t.autotile_class)
		return t.autotile_class == other.autotile_class;
	if (t.name)
		return t.name == other.name;
	return false;
}

function getAutotileIndex4(t, map, x, y) {
	/* Check on the four adjacent tiles and see if they "match", to get an index for an autotile lookup table.
		Will result in one of the following:
		0 durl  1 durL 2  duRl  3 duRL
		4 dUrl  5 dUrL 6  dURl  7 dURL
		8 Durl  9 DurL 10 DuRl 11 DuRL
		12 DUrl 13 DUrL 14 DURl 15 DURL
	*/
	return (isAutotileMatch(t, map, x-1, y) << 0)
	     | (isAutotileMatch(t, map, x+1, y) << 1)
	     | (isAutotileMatch(t, map, x, y-1) << 2)
	     | (isAutotileMatch(t, map, x, y+1) << 3)
}

///////////////////////////////////////////////////////////
// Render the map view
///////////////////////////////////////////////////////////

function drawMapEntities(ctx, offsetX, offsetY, viewWidth, viewHeight, pixelCameraX, pixelCameraY, tileX, tileY) {
	// Draw the entities, including the player

	function draw32x32Player(who, frameX, frameY) {
		let Mob = PlayerWho[who];
		let offset = Mob.offset ?? [0,0];
		ctx.drawImage(PlayerImages[who], frameX * 32, frameY * 32, 32, 32, (Mob.x * 16 - 8) - pixelCameraX + offset[0], (Mob.y * 16 - 16) - pixelCameraY + offset[1], 32, 32);
	}

	let sortedPlayers = [];
	for (var index in PlayerWho) {
		sortedPlayers.push(index);
	}
	sortedPlayers.sort(
		(a, b) => {
			if (PlayerWho[a].passengers.includes(parseInt(b))) {
				return -1;
			} else if (PlayerWho[b].passengers.includes(parseInt(a))) {
				return 1;
			}
			return (PlayerWho[a].y > PlayerWho[b].y) ? 1 : -1;
		}
	);

	for (var sort_n in sortedPlayers) {
		try {
			let index = sortedPlayers[sort_n];

			let Mob = PlayerWho[index];
			if(
				(Mob.x < (tileX-3)) ||
				(Mob.y < (tileY-3)) ||
				(Mob.x > (tileX+viewWidth+3)) ||
				(Mob.y > (tileY+viewHeight+3))
			)
				continue;

			IsMousedOver = false;
			for (let look = 0; look < MousedOverPlayers.length; look++) {
				if (MousedOverPlayers[look] == index) {
					IsMousedOver = true;
					break;
				}
			}

			let MobOffset = Mob.offset ?? [0,0];
			let playerIs16x16 = false;
			if (index in PlayerImages) {
				let tilesetWidth = PlayerImages[index].naturalWidth;
				let tilesetHeight = PlayerImages[index].naturalHeight;
				if (tilesetWidth == 32 && tilesetHeight == 32) {
					draw32x32Player(index, 0, 0);
				} else if (tilesetWidth == 16 && tilesetHeight == 16) {
					ctx.drawImage(PlayerImages[index], 0, 0, 16, 16, (Mob.x * 16) - pixelCameraX + MobOffset[0], (Mob.y * 16) - pixelCameraY + MobOffset[1], 16, 16);
					playerIs16x16 = true;
				} else {
					let frameX = 0, frameY = 0;
					let frameCountFromAnimationTick = Math.floor(AnimationTick / 5);
					let isWalking = PlayerAnimation[index].walkTimer != 0;

					switch (tilesetHeight / 32) { // Directions
						case 2:
							frameY = Math.floor(PlayerAnimation[index].lastDirectionLR / 4);
							break;
						case 4:
							frameY = Math.floor(PlayerAnimation[index].lastDirection4 / 2);
							break;
						case 8:
							frameY = Mob.dir;
							break;
					}

					switch (tilesetWidth / 32) { // Frames per direction
						case 2:
							frameX = isWalking * 1;
							break;
						case 4:
							frameX = (isWalking * 2) + (frameCountFromAnimationTick & 1);
							break;
						case 6:
							frameX = (isWalking * 3) + (frameCountFromAnimationTick % 3);
							break;
						case 8:
							frameX = (isWalking * 4) + (frameCountFromAnimationTick & 3);
							break;
					}

					draw32x32Player(index, frameX, frameY);
				}

			} else {
				pic = Mob.pic;
				if (pic == null)
					pic = [0, 8, 24];
				if (pic[0] in IconSheets)
					ctx.drawImage(IconSheets[pic[0]], pic[1] * 16, pic[2] * 16, 16, 16, (Mob.x * 16) - pixelCameraX + MobOffset[0], (Mob.y * 16) - pixelCameraY + MobOffset[1], 16, 16);
				playerIs16x16 = true;
			}

			let heightForPlayerStatus = (playerIs16x16 ? 16 : 28);

			// Mini tilemap, if it's present
			try {
				if(Mob.mini_tilemap && Mob.mini_tilemap_data && index in PlayerMiniTilemapImages && (Mob.mini_tilemap.visible ?? true)) {
					let mini_tilemap_map_w = Mob.mini_tilemap.map_size[0];
					let mini_tilemap_map_h = Mob.mini_tilemap.map_size[1];
					let mini_tilemap_tile_w = Mob.mini_tilemap.tile_size[0];
					let mini_tilemap_tile_h = Mob.mini_tilemap.tile_size[1];
					let mini_tilemap_offset = Mob.mini_tilemap.offset ?? [0,0];
					let mini_tilemap_transparent_tile = Mob.mini_tilemap.transparent_tile ?? 0;
					let mini_tilemap_data = Mob.mini_tilemap_data.data;
					let mini_tilemap_tileset = PlayerMiniTilemapImages[index];

					let data_index = 0;
					let data_value;
					let data_count = 0;
					let start_pixel_x = Math.round((Mob.x * 16) - pixelCameraX + MobOffset[0] + mini_tilemap_offset[0] + 8  - (mini_tilemap_map_w * mini_tilemap_tile_w) / 2);
					let start_pixel_y = Math.round((Mob.y * 16) - pixelCameraY + MobOffset[1] + mini_tilemap_offset[1] + 16 - (mini_tilemap_map_h * mini_tilemap_tile_h));

					for(let mini_y = 0; mini_y < mini_tilemap_map_h; mini_y++) {
						for(let mini_x = 0; mini_x < mini_tilemap_map_w; mini_x++) {
							if(!data_count) {
								if(data_index >= mini_tilemap_data.length)
									break;
								data_value = mini_tilemap_data[data_index++];
								data_count = ((data_value >> 12) & 127) + 1;
							}
							if((data_value & 4095) != mini_tilemap_transparent_tile) {
								ctx.drawImage(mini_tilemap_tileset,
									(data_value & 63) * mini_tilemap_tile_w, ((data_value >> 6) & 63) * mini_tilemap_tile_h,
								mini_tilemap_tile_w, mini_tilemap_tile_h,
								start_pixel_x + mini_x * mini_tilemap_tile_w,
								start_pixel_y + mini_y * mini_tilemap_tile_h,
								mini_tilemap_tile_w, mini_tilemap_tile_h);
							}
							data_count--;
						}
					}
				}
			} catch (error) {
			}

			// typing indicators
			if (Mob.typing) {
				ctx.drawImage(IconSheets[0], 0, 24 * 16, 16, 16, (Mob.x * 16) - pixelCameraX + MobOffset[0], (Mob.y * 16) - pixelCameraY - heightForPlayerStatus + MobOffset[1], 16, 16);
			}

			// carry text and nametags
			if (IsMousedOver && !(!Mob.is_following && Mob.vehicle)) {
				if (Mob.passengers.length > 0) {
					drawText(ctx, (Mob.x * 16) - pixelCameraX - (Mob.name.length * 8 / 2 - 8) + MobOffset[0], (Mob.y * 16) - pixelCameraY - heightForPlayerStatus - 8 + MobOffset[1], Mob.name);
					let carryNames = [];
					for (let passenger_index of Mob.passengers) {
						carryNames.push(PlayerWho[passenger_index].name);
					}
					let carryText = "carrying: " + carryNames.join(", ");

					drawText(ctx, (Mob.x * 16) - pixelCameraX - (carryText.length * 8 / 2 - 8) + MobOffset[0], (Mob.y * 16) - pixelCameraY - heightForPlayerStatus + MobOffset[1], carryText);
				} else if(Mob.in_user_list && (!MousedOverEntityClickAvailable || !MousedOverEntityClickIsTilemap)) {
					drawText(ctx, (Mob.x * 16) - pixelCameraX - (Mob.name.length * 8 / 2 - 8) + MobOffset[0], (Mob.y * 16) - pixelCameraY - heightForPlayerStatus + MobOffset[1], Mob.name);
				}
			}
		} catch (error) {
		}
	}
}

function drawTurf(ctx, drawAtX, drawAtY, tile, map, mapCoordX, mapCoordY) {
	if (!tile) {
		return;
	}
	if (!IconSheets[tile.pic[0]]) {
		RequestImageIfNeeded(tile.pic[0]);
		return;
	}

	let picX = tile.pic[1];
	let picY = tile.pic[2];
	let pair;
	let autotileLayout = tile.autotile_layout ?? 0;
	switch(autotileLayout) {
		case 0: // No autotiling, so leave picX and picY as-is
			break;
		case 1: // 4-direction autotiling 9 tiles, origin is middle
			pair = [[0,0], [0, 0], [0,  0], [0, 0],
					[0,0], [1, 1], [-1, 1], [0, 1],
					[0,0], [1,-1], [-1,-1], [0,-1],
					[0,0], [1, 0], [-1, 0], [0, 0]][getAutotileIndex4(tile, map, mapCoordX, mapCoordY)];
			picX += pair[0];
			picY += pair[1];
			break;
		case 2: // 4-direction autotiling, 9 tiles, origin is middle, horizonal & vertical & single as separate tiles
			pair = [[2,-2], [1,-2], [-1,-2], [0,-2],
					[2, 1], [1, 1], [-1, 1], [0, 1],
					[2,-1], [1,-1], [-1,-1], [0,-1],
					[2, 0], [1, 0], [-1, 0], [0, 0]][getAutotileIndex4(tile, map, mapCoordX, mapCoordY)];
			picX += pair[0];
			picY += pair[1];
			break;
		case 3: // 8-direction autotiling, origin point is middle
		case 4: // 8-direction autotiling, origin point is single
		{
			let autotileIndex = getAutotileIndex4(tile, map, mapCoordX, mapCoordY);

			// Start out with 4-direction autotiling
			let quarters = [[[-2,-4],[-1,-4],[-2,-3],[-1,-3]], [[2,-2],[3,-2],[2, 3],[3, 3]],
			                [[-2,-2],[-1,-2],[-2, 3],[-1, 3]], [[0,-2],[1,-2],[0, 3],[1, 3]],
			                [[-2, 2],[ 3, 2],[-2, 3],[ 3, 3]], [[2, 2],[3, 2],[2, 3],[3, 3]],
			                [[-2, 2],[-1, 2],[-2, 3],[-1, 3]], [[0, 2],[1, 2],[0, 3],[1, 3]],
			                [[-2,-2],[ 3,-2],[-2,-1],[ 3,-1]], [[2,-2],[3,-2],[2, 1],[3, 1]],
			                [[-2,-2],[-1,-2],[-2,-1],[-1,-1]], [[0,-2],[1,-2],[0,-1],[1,-1]],
			                [[-2, 0],[ 3, 0],[-2, 1],[ 3, 1]], [[2, 0],[3, 0],[2, 1],[3, 1]],
			                [[-2, 0],[-1, 0],[-2, 1],[-1, 1]], [[0, 0],[1, 0],[0, 1],[1, 1]],
			][autotileIndex];

			// Add the inner parts of turns
			if (((autotileIndex & 5) == 5) && !isAutotileMatch(tile, map, mapCoordX-1, mapCoordY-1)) {
				quarters[0][0] = 2;
				quarters[0][1] = -4;
			}
			if (((autotileIndex & 6) == 6) && !isAutotileMatch(tile, map, mapCoordX+1, mapCoordY-1)) {
				quarters[1][0] = 3;
				quarters[1][1] = -4;
			}
			if (((autotileIndex & 9) == 9) && !isAutotileMatch(tile, map, mapCoordX-1, mapCoordY+1)) {
				quarters[2][0] = 2;
				quarters[2][1] = -3;
			}
			if (((autotileIndex & 10) == 10) && !isAutotileMatch(tile, map, mapCoordX+1, mapCoordY+1)) {
				quarters[3][0] = 3;
				quarters[3][1] = -3;
			}
			// Layout 4 has the origin point on the single tile instead of the middle tile
			if (autotileLayout == 4) {
				picX++;
				picY += 2;
			}
			// Draw the four tiles
			let sheet = IconSheets[tile.pic[0]];
				ctx.drawImage(sheet, picX * 16 + quarters[0][0] * 8, picY * 16 + quarters[0][1] * 8, 8, 8, drawAtX,     drawAtY,   8, 8);
				ctx.drawImage(sheet, picX * 16 + quarters[1][0] * 8, picY * 16 + quarters[1][1] * 8, 8, 8, drawAtX + 8, drawAtY,   8, 8);
				ctx.drawImage(sheet, picX * 16 + quarters[2][0] * 8, picY * 16 + quarters[2][1] * 8, 8, 8, drawAtX,     drawAtY+8, 8, 8);
				ctx.drawImage(sheet, picX * 16 + quarters[3][0] * 8, picY * 16 + quarters[3][1] * 8, 8, 8, drawAtX + 8, drawAtY+8, 8, 8);
		}
		return;
	}
	ctx.drawImage(IconSheets[tile.pic[0]], picX * 16, picY * 16, 16, 16, drawAtX, drawAtY, 16, 16);
}

function drawMap() {
	let canvas = mapCanvas;
	let ctx = canvas.getContext("2d");

	// Clear to black
	ctx.fillStyle = "black";
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// Calculate camera pixel coordinates
	let viewWidth = Math.floor(canvas.width / 16);
	let viewHeight = Math.floor(canvas.height / 16);
	let pixelCameraX = Math.round(CameraX - canvas.width / 2);
	let pixelCameraY = Math.round(CameraY - canvas.height / 2);
	let offsetX = pixelCameraX & 15;
	let offsetY = pixelCameraY & 15;
	let tileX = pixelCameraX >> 4;
	let tileY = pixelCameraY >> 4;

	let edgeLinks = MyMap?.Info?.edge_links ?? null;

	let objectsWithOverFlag = []; // X, Y, [pic_sheet, pic_x, pic_y]

	// Render the map
	for (x = 0; x < (viewWidth + 2); x++) {
		for (y = 0; y < (viewHeight + 2); y++) {
			try {
				ctx.globalAlpha = 1;
				let mapCoordX = x + tileX;
				let mapCoordY = y + tileY;
				let map = MyMap;

				// Out-of-bounds tiles may be on another map
				let edgeLookupIndex = (mapCoordX < 0) * 1 + (mapCoordX >= MyMap.Width) * 2 +
					(mapCoordY < 0) * 4 + (mapCoordY >= MyMap.Height) * 8;
				if (edgeLookupIndex != 0) {
					if (edgeLinks == null)
						continue;
					let map = MapsByID[edgeLinks[edgeMapLookupTable[edgeLookupIndex]]];
					if (map == null)
						continue;
					let gradientHorizontal = 1;
					let gradientVertical = 1;
					if (edgeLookupIndex & 1) { // Left
						gradientHorizontal = 0.5 - (-Math.floor(mapCoordX / 2) + 1) * 0.025;
						mapCoordX = map.Width + mapCoordX;
					}
					if (edgeLookupIndex & 2) { // Right
						mapCoordX -= MyMap.Width;
						gradientHorizontal = 0.5 - Math.floor(mapCoordX / 2) * 0.025;
					}
					if (edgeLookupIndex & 4) { // Above
						gradientVertical = 0.5 - (-Math.floor(mapCoordY / 2) + 1) * 0.025;
						mapCoordY = map.Height + mapCoordY;
					}
					if (edgeLookupIndex & 8) { // Below
						mapCoordY -= MyMap.Height;
						gradientVertical = 0.5 - Math.floor(mapCoordY / 2) * 0.025;
					}
					if (mapCoordX < 0 || mapCoordX >= map.Width || mapCoordY < 0 || mapCoordY >= map.Height)
						continue;
					ctx.globalAlpha = Math.max(0, Math.min(gradientHorizontal, gradientVertical));
					if (ctx.globalAlpha == 0)
						continue;
				}

				// Draw the turf
				drawTurf(ctx, x * 16 - offsetX, y * 16 - offsetY, AtomFromName(map.Tiles[mapCoordX][mapCoordY]), map, mapCoordX, mapCoordY);

				// Draw anything above the turf (the tile objects)
				let Objs = map.Objs[mapCoordX][mapCoordY];
				if (Objs) {
					for (let index in Objs) {
						let Obj = AtomFromName(Objs[index]);
						if (IconSheets[Obj.pic[0]]) {
							if(Obj.over === true) {
								objectsWithOverFlag.push([x * 16 - offsetX, y * 16 - offsetY, Obj.pic]);
							} else {
								ctx.drawImage(IconSheets[Obj.pic[0]], Obj.pic[1] * 16, Obj.pic[2] * 16, 16, 16, x * 16 - offsetX, y * 16 - offsetY, 16, 16);
							}
						} else {
							RequestImageIfNeeded(Obj.pic[0]);
						}
					}
				}
			} catch (error) {
			}
		}
	}

	// Draw entities and map link edge normally
	ctx.globalAlpha = 1;

	// Draw the map link edges
	if (edgeLinks != null) {
		ctx.beginPath();
		ctx.globalAlpha = 0.5;
		ctx.lineWidth = "2";
		ctx.strokeStyle = "green";
		ctx.rect(0 - pixelCameraX, 0 - pixelCameraY, MyMap.Width * 16, MyMap.Height * 16);
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	drawMapEntities(ctx, offsetX, offsetY, viewWidth, viewHeight, pixelCameraX, pixelCameraY, tileX, tileY);

	// Draw objects that should appear above players
	for (let i=0; i<objectsWithOverFlag.length; i++) {
		let pic = objectsWithOverFlag[i][2];
		ctx.drawImage(IconSheets[pic[0]], pic[1] * 16, pic[2] * 16, 16, 16, objectsWithOverFlag[i][0], objectsWithOverFlag[i][1], 16, 16);
	}

	// Draw markers that show that people are building
	let potluck = document.getElementById('potluck');
	for (let id in PlayerBuildMarkers) {
		let marker = PlayerBuildMarkers[id];
		let nameText = " " + marker.name + " ";
		let del = marker.del;
		drawTextSmall(ctx, (marker.pos[0] * 16 + 8) - pixelCameraX - (nameText.length * 4 / 2),   (marker.pos[1] * 16) - pixelCameraY - 8, nameText);
		ctx.drawImage(potluck, del?(17 * 16):(9 * 16), del?(19 * 16):(22 * 16), 16, 16, marker.pos[0] * 16 - pixelCameraX, marker.pos[1] * 16 - pixelCameraY, 16, 16);
	}

	// Draw a mouse selection if there is one
	if (MouseActive) {
		ctx.beginPath();
		ctx.lineWidth = "4";
		ctx.strokeStyle = (MouseDown) ? "#ff00ff" : "#00ffff";
		let AX = Math.min(MouseStartX, MouseEndX) * 16 + 4;
		let AY = Math.min(MouseStartY, MouseEndY) * 16 + 4;
		let BX = Math.max(MouseStartX, MouseEndX) * 16 + 12;
		let BY = Math.max(MouseStartY, MouseEndY) * 16 + 12;
		ctx.rect(AX - pixelCameraX, AY - pixelCameraY, BX - AX, BY - AY);
		ctx.stroke();
	}

	// Draw tool position preview
	if (drawToolX !== null && drawToolY !== null) {
		ctx.beginPath();
		ctx.globalAlpha = 0.75;
		ctx.lineWidth = "4";
		ctx.strokeStyle = "#ffffff";
		let AX = drawToolX * 16;
		let AY = drawToolY * 16;
		ctx.rect(AX - pixelCameraX, AY - pixelCameraY, 16, 16);
		ctx.stroke();
		ctx.globalAlpha = 1;
	}
}

function drawText(ctx, x, y, text) {
	let chicago = document.getElementById("chicago");
	for (let i = 0; i < text.length; i++) {
		let chr = text.charCodeAt(i) - 0x20;
		let srcX = chr & 15;
		let srcY = chr >> 4;
		ctx.drawImage(chicago, srcX * 8, srcY * 8, 8, 8, x + i * 8, y, 8, 8);
	}
}

function drawTextSmall(ctx, x, y, text) {
	let tomthumb = document.getElementById("tomthumb");
	for (let i = 0; i < text.length; i++) {
		let chr = text.charCodeAt(i) - 0x20;
		let srcX = chr & 15;
		let srcY = chr >> 4;
		ctx.drawImage(tomthumb, srcX * 4, srcY * 6, 4, 6, x + i * 4, y, 4, 6);
	}
}
