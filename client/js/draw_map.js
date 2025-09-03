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
let tileAnimationEnabled = true;
let entityAnimationEnabled = true;
let userParticlesEnabled = true;

const BACKDROP_DIRTY_RENDER   = 0; // Needs to be rendered and displayed
const BACKDROP_DIRTY_ANIMATED = 1; // Zone is ready, but contains animated tiles
const BACKDROP_DIRTY_REDRAW   = 2; // Needs to be displayed again
const BACKDROP_DIRTY_SKIP     = 3; // Skip this zone because it's all ready

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
	if (t.autotile_class && other.autotile_class_edge && t.autotile_class == other.autotile_class_edge)
		return true;
	if (t.name && other.autotile_class_edge && t.name == other.autotile_class_edge) // Not sure if I want this behavior, though it seems helpful
		return true;
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

/////////////////////////////////////////////////

function getObjForAutotile(o, map, x, y) {
	// Get a map tile's objects, except that off-map tiles return [o] instead
	if (x < 0 || x >= map.Width || y < 0 || y >= map.Height)
		return [o];
	return map.Objs[x][y];
}

function isObjAutotileMatch(o, map, x, y) {
	// Is any tile on the map at x,y the "same" as o for autotiling purposes?
	let objs = getObjForAutotile(o, map, x, y);
	if (objs == null || objs == []) {
		return false;
	}
	if (o.autotile_class) {
		for (let other of objs) {
			other = AtomFromName(other);
			if (o.autotile_class == other.autotile_class)
				return true;
		}
	} else if (o.name) {
		for (let other of objs) {
			other = AtomFromName(other);
			if (o.name == other.name)
				return true;
		}
	}
	return false;
}

function getObjAutotileIndex4(o, map, x, y) {
	/* Check on the four adjacent tiles and see if any of the objects on them "match", to get an index for an autotile lookup table.
		Will result in one of the following:
		0 durl  1 durL 2  duRl  3 duRL
		4 dUrl  5 dUrL 6  dURl  7 dURL
		8 Durl  9 DurL 10 DuRl 11 DuRL
		12 DUrl 13 DUrL 14 DURl 15 DURL
	*/
	return (isObjAutotileMatch(o, map, x-1, y) << 0)
	     | (isObjAutotileMatch(o, map, x+1, y) << 1)
	     | (isObjAutotileMatch(o, map, x, y-1) << 2)
	     | (isObjAutotileMatch(o, map, x, y+1) << 3)
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
		markAreaAroundPointAsDirty(MyMap, Mob.x + (offset[0]/16), Mob.y + (offset[1]/16), 5);
	}

	let sortedPlayers = [];
	for (let index in PlayerWho) {
		sortedPlayers.push(PlayerWho[index]);
	}
	if (userParticlesEnabled) {
		for (let particle of UserParticles) {
			let entry = {particle, passengers: [], id: null};
			if (particle.data.at === "me" && (particle.data.id in PlayerWho)) {
				entry.x = PlayerWho[particle.data.id].x;
				entry.y = PlayerWho[particle.data.id].y;
			} else if (Array.isArray(particle.data.at)) {
				entry.x = particle.data.at[0];
				entry.y = particle.data.at[1];
			}
			if (entry.x === undefined || entry.y === undefined)
				continue;
			if (particle.data.hide_me)
				sortedPlayers = sortedPlayers.filter((p) => p.id !== particle.data.id)
			sortedPlayers.push(entry);
		}
	}

	sortedPlayers.sort(
		(a, b) => {
			let z_a = a.z_index ?? 0;
			let z_b = b.z_index ?? 0;
			if (a.y == b.y && z_a != z_b)
				return z_a - z_b;
			if (a.y == b.y && ((a.particle && !b.particle) || (!a.particle || b.particle)))
				return a.particle ? 1 : -1;
			if (!b.is_following && a.passengers.includes(b.id)) {
				return -1;
			} else if (!a.is_following && b.passengers.includes(a.id)) {
				return 1;
			}
			return (a.y > b.y) ? 1 : -1;
		}
	);

	for (let Mob of sortedPlayers) {
		try {
			let index = Mob.id;
			if(
				(Mob.x < (tileX-3)) ||
				(Mob.y < (tileY-3)) ||
				(Mob.x > (tileX+viewWidth+3)) ||
				(Mob.y > (tileY+viewHeight+3))
			)
				continue;

			if(Mob.particle) {
				let offset = Mob.particle.data.offset ?? [0,0];
				let pic = Mob.particle.data.pic;
				if (!pic)
					continue;
				let size = Mob.particle.data.size ?? [1,1];
				let inIconSheet = pic[0] in IconSheets;
				let inParticleImages = pic[0] in PlayerParticleImages;
				if (inIconSheet || inParticleImages) {
					let animationFrame = calculateAnimationFrame(Mob.particle.data, Mob.particle.timer);
					ctx.drawImage( (inIconSheet?IconSheets:PlayerParticleImages)[pic[0]],
						(pic[1]+animationFrame*size[0]) * 16, pic[2] * 16,
						size[0] * 16, size[1] * 16,
						(Mob.x * 16 + 8 - size[0]*8) - pixelCameraX + offset[0],
						(Mob.y * 16 + 16 - size[1]*16) - pixelCameraY + offset[1],
						size[0] * 16, size[1] * 16);
					markAreaAroundPointAsDirty(MyMap, Mob.x + (offset[0]/16), Mob.y + (offset[1]/16), 5);
				} else if (typeof pic[0] === "number" || !pic[0].toLowerCase().startsWith("http")) {
					RequestImageIfNeeded(pic[0]);
				}
				continue;
			}

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
					markAreaAroundPointAsDirty(MyMap, Mob.x + (MobOffset[0]/16), Mob.y + (MobOffset[1]/16), 5);
				} else {
					let frameX = 0, frameY = 0;
					let frameCountFromAnimationTick = entityAnimationEnabled ? Math.floor(tenthOfSecondTimer/2) : 0;
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
				let pic = Mob.pic;
				if (pic == null)
					pic = [0, 8, 24];
				if (pic[0] in IconSheets) {
					ctx.drawImage(IconSheets[pic[0]], pic[1] * 16, pic[2] * 16, 16, 16, (Mob.x * 16) - pixelCameraX + MobOffset[0], (Mob.y * 16) - pixelCameraY + MobOffset[1], 16, 16);
					markAreaAroundPointAsDirty(MyMap, Mob.x + (MobOffset[0]/16), Mob.y + (MobOffset[1]/16), 5);
				} else {
					RequestImageIfNeeded(pic[0]);
				}
				playerIs16x16 = true;
			}

			let heightForPlayerStatus = (playerIs16x16 ? (16+6+5) : (28+6+5));

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
					markAreaAroundPointAsDirty(MyMap, Mob.x + (MobOffset[0]/16 + mini_tilemap_offset[0]/16), Mob.y + (MobOffset[1]/16 + mini_tilemap_offset[1]/16), 5);
				}
			} catch (error) {
			}

			// typing indicators
			if (Mob.typing) {
				ctx.drawImage(IconSheets[0], 0, 24 * 16, 16, 16, (Mob.x * 16) - pixelCameraX + MobOffset[0], (Mob.y * 16) - pixelCameraY - heightForPlayerStatus + MobOffset[1] + 6 + 5, 16, 16);
				// Should this mark tiles as dirty? Probably unneeded due to WHO updates doing this too
			}

			// carry text and nametags
			if (IsMousedOver && !Mob.vehicle) {
				if (Mob.passengers.length > 0) {
					drawTextProportional(ctx, (Mob.x * 16) - pixelCameraX + 8 + MobOffset[0], (Mob.y * 16) - pixelCameraY - heightForPlayerStatus + MobOffset[1] - 16, true, Mob.name);
					let carryNames = [];
					for (let passenger_index of Mob.passengers) {
						carryNames.push(PlayerWho[passenger_index].name);
					}
					let carryText = "and: " + carryNames.join(", ");

					drawTextProportional(ctx, (Mob.x * 16) - pixelCameraX + 8 + MobOffset[0], (Mob.y * 16) - pixelCameraY - heightForPlayerStatus + MobOffset[1], true, carryText);
				} else if(Mob.in_user_list && (!MousedOverEntityClickAvailable || !MousedOverEntityClickIsTilemap)) {
					drawTextProportional(ctx, (Mob.x * 16) - pixelCameraX + 8 + MobOffset[0], (Mob.y * 16) - pixelCameraY - heightForPlayerStatus + MobOffset[1], true, Mob.name);
				}
			}
		} catch (error) {
		}
	}
}

function calculateAnimationFrame(tile, timer) {
	if (timer < 0)
		timer = 0;
	let animationFrameCount = Math.max(1, tile.anim_frames ?? 1);
	if(animationFrameCount > 1) {
		let animationTimer = timer + (tile.anim_offset ?? 0);
		let animationSpeed = Math.max(1, tile.anim_speed ?? 1);
		let animationMode = tile.anim_mode ?? 0;
		switch(animationMode) {
			case 0: // Forwards
				return Math.floor(animationTimer / animationSpeed) % animationFrameCount;
			case 1: // Backwards
				return animationFrameCount - 1 - Math.floor(animationTimer / animationSpeed) % animationFrameCount;
			case 2: // Ping-pong forwards
			case 3: // Ping-pong backwards
				animationFrameCount--;
				let subAnimationFrame = Math.floor(animationTimer / animationSpeed) % animationFrameCount;
				let isBackwards = Math.floor(Math.floor(animationTimer / animationSpeed) / animationFrameCount) & 1;
				if(animationMode == 3)
					isBackwards ^= 1;
				if(isBackwards) {
					return animationFrameCount - subAnimationFrame;
				} else {
					return subAnimationFrame;
				}
				break;
		}
	}
	return 0;
}

function drawAtomWithAutotile(ctx, drawAtX, drawAtY, tile, map, mapCoordX, mapCoordY, autotileIndexFunction, autotileMatchFunction) {
	if (!tile) {
		return;
	}
	if (!IconSheets[tile.pic[0]]) {
		RequestImageIfNeeded(tile.pic[0]);
		// Draw a "?" fallback so users can notice tiles with invalid pic[0] and delete/fix them
		ctx.drawImage(IconSheets[0], 8 * 16, 24 * 16, 16, 16, drawAtX, drawAtY, 16, 16);
		return;
	}

	let picX = tile.pic[1];
	let picY = tile.pic[2];
	let pair;
	let autotileLayout = tile.autotile_layout ?? 0;

	let animationFrame = 0;
	if(tileAnimationEnabled) {
		animationFrame = calculateAnimationFrame(tile, tenthOfSecondTimer);

		let animationFrameCount = Math.max(1, tile.anim_frames ?? 1);
		if (animationFrameCount > 1)
			markTilesAsDirty(map, mapCoordX, mapCoordY, 1, 1, BACKDROP_DIRTY_ANIMATED);
	}
	switch(autotileLayout) {
		default:// Unrecognized autotiling setup, so do not apply animation
			break;
		case 0: // No autotiling, so leave picX and picY as-is
			picX += animationFrame;
			break;
		case 1: // 4-direction autotiling 9 tiles, origin is middle
			pair = [[0,0], [0, 0], [0,  0], [0, 0],
					[0,0], [1, 1], [-1, 1], [0, 1],
					[0,0], [1,-1], [-1,-1], [0,-1],
					[0,0], [1, 0], [-1, 0], [0, 0]][autotileIndexFunction(tile, map, mapCoordX, mapCoordY)];
			picX += pair[0] + animationFrame * 3;
			picY += pair[1];
			break;
		case 2: // 4-direction autotiling, 9 tiles, origin is middle, horizonal & vertical & single as separate tiles
		case 3: // same, but origin point is the single tile
			pair = [[2,-2], [1,-2], [-1,-2], [0,-2],
					[2, 1], [1, 1], [-1, 1], [0, 1],
					[2,-1], [1,-1], [-1,-1], [0,-1],
					[2, 0], [1, 0], [-1, 0], [0, 0]][autotileIndexFunction(tile, map, mapCoordX, mapCoordY)];
			picX += pair[0] + animationFrame * 4;
			picY += pair[1];
			if (autotileLayout == 3) {
				picX -= 2;
				picY += 2;
			}
			break;
		case 4: // 8-direction autotiling, origin point is middle
		case 5: // 8-direction autotiling, origin point is single
		{
			let autotileIndex = autotileIndexFunction(tile, map, mapCoordX, mapCoordY);

			// Start out with 4-direction autotiling
			let quarters = [[[-2,-4],[-1,-4],[-2,-3],[-1,-3]], [[2,-2],[3,-2],[2, 3],[3, 3]],
			                [[-2,-2],[-1,-2],[-2, 3],[-1, 3]], [[0,-2],[1,-2],[0, 3],[1, 3]],
			                [[-2, 2],[ 3, 2],[-2, 3],[ 3, 3]], [[2, 2],[3, 2],[2, 3],[3, 3]],
			                [[-2, 2],[-1, 2],[-2, 3],[-1, 3]], [[0, 2],[1, 2],[0, 3],[1, 3]],
			                [[-2,-2],[ 3,-2],[-2,-1],[ 3,-1]], [[2,-2],[3,-2],[2,-1],[3,-1]],
			                [[-2,-2],[-1,-2],[-2,-1],[-1,-1]], [[0,-2],[1,-2],[0,-1],[1,-1]],
			                [[-2, 0],[ 3, 0],[-2, 1],[ 3, 1]], [[2, 0],[3, 0],[2, 1],[3, 1]],
			                [[-2, 0],[-1, 0],[-2, 1],[-1, 1]], [[0, 0],[1, 0],[0, 1],[1, 1]],
			][autotileIndex];

			// Add the inner parts of turns
			if (((autotileIndex & 5) == 5) && !autotileMatchFunction(tile, map, mapCoordX-1, mapCoordY-1)) {
				quarters[0][0] = 2;
				quarters[0][1] = -4;
			}
			if (((autotileIndex & 6) == 6) && !autotileMatchFunction(tile, map, mapCoordX+1, mapCoordY-1)) {
				quarters[1][0] = 3;
				quarters[1][1] = -4;
			}
			if (((autotileIndex & 9) == 9) && !autotileMatchFunction(tile, map, mapCoordX-1, mapCoordY+1)) {
				quarters[2][0] = 2;
				quarters[2][1] = -3;
			}
			if (((autotileIndex & 10) == 10) && !autotileMatchFunction(tile, map, mapCoordX+1, mapCoordY+1)) {
				quarters[3][0] = 3;
				quarters[3][1] = -3;
			}
			// Layout 5 has the origin point on the single tile instead of the middle tile
			if (autotileLayout == 5) {
				picX++;
				picY += 2;
			}
			// Draw the four tiles
			let sheet = IconSheets[tile.pic[0]];
			ctx.drawImage(sheet, (picX + animationFrame*3) * 16 + quarters[0][0] * 8, picY * 16 + quarters[0][1] * 8, 8, 8, drawAtX,     drawAtY,   8, 8);
			ctx.drawImage(sheet, (picX + animationFrame*3) * 16 + quarters[1][0] * 8, picY * 16 + quarters[1][1] * 8, 8, 8, drawAtX + 8, drawAtY,   8, 8);
			ctx.drawImage(sheet, (picX + animationFrame*3) * 16 + quarters[2][0] * 8, picY * 16 + quarters[2][1] * 8, 8, 8, drawAtX,     drawAtY+8, 8, 8);
			ctx.drawImage(sheet, (picX + animationFrame*3) * 16 + quarters[3][0] * 8, picY * 16 + quarters[3][1] * 8, 8, 8, drawAtX + 8, drawAtY+8, 8, 8);
			return; // Don't do the regular draw at the end
		}
		case 6: // Horizontal-only autotiling
		{
			let left = autotileMatchFunction(tile, map, mapCoordX-1, mapCoordY);
			let right = autotileMatchFunction(tile, map, mapCoordX+1, mapCoordY);
			if(!left && right) picX--;
			if(left && !right) picX++;
			picX += animationFrame*3;
			break;
		}
		case 7: // Horizontal-only autotiling, separate single, defaulting to middle
		case 8: // Horizontal-only autotiling, separate single, defaulting to single
		{
			let left = autotileMatchFunction(tile, map, mapCoordX-1, mapCoordY);
			let right = autotileMatchFunction(tile, map, mapCoordX+1, mapCoordY);
			if(!left && right) picX--;
			if(left && !right) picX++;
			if(!left && !right) picX+=2;
			if(autotileLayout == 8) picX-=2;
			picX += animationFrame*4;
			break;
		}
		case 9: // Vertical-only autotiling
		{
			let top = autotileMatchFunction(tile, map, mapCoordX, mapCoordY-1);
			let bottom = autotileMatchFunction(tile, map, mapCoordX, mapCoordY+1);
			if(top && !bottom) picY++;
			if(!top && bottom) picY--;
			picX += animationFrame;
			break;
		}
		case 10: // Vertical-only autotiling, separate single, defaulting to middle
		case 11: // Vertical-only autotiling, separate single, defaulting to single
		{
			let top = autotileMatchFunction(tile, map, mapCoordX, mapCoordY-1);
			let bottom = autotileMatchFunction(tile, map, mapCoordX, mapCoordY+1);
			if(top && !bottom) picY++;
			if(!top && bottom) picY--;
			if(!top && !bottom) picY-=2;
			if(autotileLayout == 11) picY+=2;
			picX += animationFrame;
			break;
		}
		case 12: // Quarter 8-way - Middle (8)
		case 13: // Quarter 8-way - Single (8)
		{
			let autotileIndex = autotileIndexFunction(tile, map, mapCoordX, mapCoordY);
			// Start out with 4-direction autotiling
			let quarters = [[[0, 2],[1, 2],[0, 3],[1, 3]], [[0, 7],[1, 2],[1, 6],[1, 3]],
			                [[0, 2],[0, 7],[0, 3],[1, 6]], [[0, 7],[0, 7],[1, 6],[1, 6]],
			                [[1, 7],[0, 6],[0, 3],[1, 3]], [[0, 0],[0, 6],[1, 6],[1, 3]],
			                [[1, 7],[1, 0],[0, 3],[1, 6]], [[0, 0],[1, 0],[1, 6],[1, 6]],
			                [[0, 2],[1, 2],[1, 7],[0, 6]], [[0, 7],[1, 2],[0, 1],[0, 6]],
			                [[0, 2],[0, 7],[1, 7],[1, 1]], [[0, 7],[0, 7],[0, 1],[1, 1]],
			                [[1, 7],[0, 6],[1, 7],[0, 6]], [[0, 0],[0, 6],[0, 1],[0, 6]],
			                [[1, 7],[1, 0],[1, 7],[1, 1]], [[0, 0],[1, 0],[0, 1],[1, 1]],
			][autotileIndex];
			// Add the inner parts of turns
			if (((autotileIndex & 5) == 5) && !autotileMatchFunction(tile, map, mapCoordX-1, mapCoordY-1)) {
				quarters[0][0] = 0;
				quarters[0][1] = 4;
			}
			if (((autotileIndex & 6) == 6) && !autotileMatchFunction(tile, map, mapCoordX+1, mapCoordY-1)) {
				quarters[1][0] = 1;
				quarters[1][1] = 4;
			}
			if (((autotileIndex & 9) == 9) && !autotileMatchFunction(tile, map, mapCoordX-1, mapCoordY+1)) {
				quarters[2][0] = 0;
				quarters[2][1] = 5;
			}
			if (((autotileIndex & 10) == 10) && !autotileMatchFunction(tile, map, mapCoordX+1, mapCoordY+1)) {
				quarters[3][0] = 1;
				quarters[3][1] = 5;
			}
			if(autotileLayout == 13) picY--;
			picX += animationFrame;
			let sheet = IconSheets[tile.pic[0]];
			ctx.drawImage(sheet, picX * 16 + quarters[0][0] * 8, picY * 16 + quarters[0][1] * 8, 8, 8, drawAtX,     drawAtY,   8, 8);
			ctx.drawImage(sheet, picX * 16 + quarters[1][0] * 8, picY * 16 + quarters[1][1] * 8, 8, 8, drawAtX + 8, drawAtY,   8, 8);
			ctx.drawImage(sheet, picX * 16 + quarters[2][0] * 8, picY * 16 + quarters[2][1] * 8, 8, 8, drawAtX,     drawAtY+8, 8, 8);
			ctx.drawImage(sheet, picX * 16 + quarters[3][0] * 8, picY * 16 + quarters[3][1] * 8, 8, 8, drawAtX + 8, drawAtY+8, 8, 8);
			return; // Don't do the regular draw at the end

		}
		case 14: // Quarter 8-way - Middle (16)
		case 15: // Quarter 8-way - Single (16)
		{
			let autotileIndex = autotileIndexFunction(tile, map, mapCoordX, mapCoordY);
			// Start out with 4-direction autotiling
			let quarters = [[[0, 2],[1, 2],[0, 3],[1, 3]], [[0, 8],[1, 2],[0, 9],[1, 3]],
			                [[0, 2],[1, 8],[0, 3],[1, 9]], [[0, 8],[1, 8],[0, 9],[1, 9]],
			                [[0, 6],[1, 6],[0, 3],[1, 3]], [[0, 0],[1, 6],[0, 9],[1, 3]],
			                [[0, 6],[1, 0],[0, 3],[1, 9]], [[0, 0],[1, 0],[0, 9],[1, 9]],
			                [[0, 2],[1, 2],[0, 7],[1, 7]], [[0, 8],[1, 2],[0, 1],[1, 7]],
			                [[0, 2],[1, 8],[0, 7],[1, 1]], [[0, 8],[1, 8],[0, 1],[1, 1]],
			                [[0, 6],[1, 6],[0, 7],[1, 7]], [[0, 0],[1, 6],[0, 1],[1, 7]],
			                [[0, 6],[1, 0],[0, 7],[1, 1]], [[0, 0],[1, 0],[0, 1],[1, 1]],
			][autotileIndex];
			// Add the inner parts of turns
			if (((autotileIndex & 5) == 5) && !autotileMatchFunction(tile, map, mapCoordX-1, mapCoordY-1)) {
				quarters[0][0] = 0;
				quarters[0][1] = 4;
			}
			if (((autotileIndex & 6) == 6) && !autotileMatchFunction(tile, map, mapCoordX+1, mapCoordY-1)) {
				quarters[1][0] = 1;
				quarters[1][1] = 4;
			}
			if (((autotileIndex & 9) == 9) && !autotileMatchFunction(tile, map, mapCoordX-1, mapCoordY+1)) {
				quarters[2][0] = 0;
				quarters[2][1] = 5;
			}
			if (((autotileIndex & 10) == 10) && !autotileMatchFunction(tile, map, mapCoordX+1, mapCoordY+1)) {
				quarters[3][0] = 1;
				quarters[3][1] = 5;
			}
			if(autotileLayout == 15) picY--;
			picX += animationFrame;
			let sheet = IconSheets[tile.pic[0]];
			ctx.drawImage(sheet, picX * 16 + quarters[0][0] * 8, picY * 16 + quarters[0][1] * 8, 8, 8, drawAtX,     drawAtY,   8, 8);
			ctx.drawImage(sheet, picX * 16 + quarters[1][0] * 8, picY * 16 + quarters[1][1] * 8, 8, 8, drawAtX + 8, drawAtY,   8, 8);
			ctx.drawImage(sheet, picX * 16 + quarters[2][0] * 8, picY * 16 + quarters[2][1] * 8, 8, 8, drawAtX,     drawAtY+8, 8, 8);
			ctx.drawImage(sheet, picX * 16 + quarters[3][0] * 8, picY * 16 + quarters[3][1] * 8, 8, 8, drawAtX + 8, drawAtY+8, 8, 8);
			return; // Don't do the regular draw at the end
		}
	}
	ctx.drawImage(IconSheets[tile.pic[0]], picX * 16, picY * 16, 16, 16, drawAtX, drawAtY, 16, 16);
}

function drawTurf(ctx, drawAtX, drawAtY, tile, map, mapCoordX, mapCoordY) {
	drawAtomWithAutotile(ctx, drawAtX, drawAtY, tile, map, mapCoordX, mapCoordY, getAutotileIndex4, isAutotileMatch);
}

function drawObj(ctx, drawAtX, drawAtY, obj, map, mapCoordX, mapCoordY) {
	drawAtomWithAutotile(ctx, drawAtX, drawAtY, obj, map, mapCoordX, mapCoordY, getObjAutotileIndex4, isObjAutotileMatch);
}

function wrapWithin(value, max) {
	return ((value % max) + max) % max;
}

function markAreaAroundEntityAsDirty(id) {
	let x = PlayerWho[id]?.x;
	let y = PlayerWho[id]?.y;
	if (x !== undefined && y !== undefined)
		markAreaAroundPointAsDirty(MyMap, x, y, 7);
}
function markAreaAroundPointAsDirty(map, x, y, size) {
	if (x === undefined || x === null || y === undefined || y === null)
		return;
	markTilesAsDirty(map, Math.round(x)-(size>>1), Math.round(y)-(size>>1), size, size, BACKDROP_DIRTY_REDRAW);
}
const edgeIndexIncludesLeft  = [false, false, false, true, true, true, false, false];
const edgeIndexIncludesRight = [true, true, false, false, false, false, false, true];
const edgeIndexIncludesUp    = [false, false, false, false, false, true, true, true];
const edgeIndexIncludesDown  = [false, true, true, true, false, false, false, false];

function markTilesAsDirty(map, baseX, baseY, width, height, level) {
	const pixelCameraX = Math.round(CameraX - mapCanvas.width / 2);
	const pixelCameraY = Math.round(CameraY - mapCanvas.height / 2);

	if (map === undefined)
		return;
	if (map !== MyMap) {
		let edgeLinks = MyMap?.Info?.edge_links ?? null;
		if (!edgeLinks)
			return;
		let edgeIndex = edgeLinks.indexOf(map.Info.id);
		if (edgeIndex < 0)
			return;
		if (edgeIndexIncludesLeft[edgeIndex]) // Left
			baseX -= map.Width;
		else if (edgeIndexIncludesRight[edgeIndex]) // Right
			baseX += MyMap.Width;
		if (edgeIndexIncludesUp[edgeIndex]) // Above
			baseY -= map.Height;
		else if (edgeIndexIncludesDown[edgeIndex]) // Below
			baseY += MyMap.Height;
	}

	for (let h=0; h<height; h++) {
		const mapY = baseY+h;
		const tileGridY   = mapY >> BACKDROP_ZONE_SHIFT;
		const screenGridY = pixelCameraY >> (4+BACKDROP_ZONE_SHIFT);
		if (tileGridY < screenGridY || tileGridY >= (screenGridY + backdropHeightZones))
			continue;
		for (let w=0; w<width; w++) {
			const mapX = baseX+w;
			const tileGridX   = mapX >> BACKDROP_ZONE_SHIFT;
			const screenGridX = pixelCameraX >> (4+BACKDROP_ZONE_SHIFT);
			if (tileGridX < screenGridX || tileGridX >= (screenGridX + backdropWidthZones))
				continue;

			const zoneRealGridX = wrapWithin(tileGridX, backdropWidthZones);
			const zoneRealGridY = wrapWithin(tileGridY, backdropHeightZones);
			const zoneIndex = zoneRealGridY * backdropWidthZones + zoneRealGridX;

			if (level < backdropDirtyMap[zoneIndex])
				backdropDirtyMap[zoneIndex] = level;
		}
	}
}

function drawMap() {
	let canvas = mapCanvas;
	let ctx = mapCanvas.getContext("2d");

	// Calculate camera pixel coordinates
	let viewWidth = Math.floor(canvas.width / 16);
	let viewHeight = Math.floor(canvas.height / 16);
	let pixelCameraX = Math.round(CameraX - canvas.width / 2);
	let pixelCameraY = Math.round(CameraY - canvas.height / 2);

	// Scrolling information for individual tiles
	let offsetX = pixelCameraX & 15;
	let offsetY = pixelCameraY & 15;
	let tileX = pixelCameraX >> 4;
	let tileY = pixelCameraY >> 4;

	// Scrolling information for backdrop zones
	let zoneScrollOffsetX = pixelCameraX & (BACKDROP_ZONE_PIXEL_SIZE-1);
	let zoneScrollOffsetY = pixelCameraY & (BACKDROP_ZONE_PIXEL_SIZE-1);
	let zoneScrollGridX = pixelCameraX >> (4+BACKDROP_ZONE_SHIFT);
	let zoneScrollGridY = pixelCameraY >> (4+BACKDROP_ZONE_SHIFT);

	// Other backdrop information
	let backdropCtx = backdropCanvas.getContext("2d");
	let backdropDrawnAlready = new Uint8Array(backdropWidthZones * backdropHeightZones);
	let backdropWithOver = []; // Keep track of which zones were processed that contain "over" tiles, so we don't need a second scan to find them after entities are drawn

	let edgeLinks = MyMap?.Info?.edge_links ?? null;

	// Attempt to draw one "zone" on the backdrop
	function processBackdropGrid(zoneDrawGridX, zoneDrawGridY, redraw) {
		// Which zone is used on the backdrop canvas
		const zoneRealGridX = wrapWithin(zoneScrollGridX+zoneDrawGridX, backdropWidthZones);
		const zoneRealGridY = wrapWithin(zoneScrollGridY+zoneDrawGridY, backdropHeightZones);
		// Pixel coordinates for the above
		const renderBaseX = zoneRealGridX * BACKDROP_ZONE_PIXEL_SIZE;
		const renderBaseY = zoneRealGridY * BACKDROP_ZONE_PIXEL_SIZE;

		// Index for the 1D array
		const zoneIndex = zoneRealGridY * backdropWidthZones + zoneRealGridX;
		const dirty = backdropDirtyMap[zoneIndex];
		backdropDirtyMap[zoneIndex] = BACKDROP_DIRTY_SKIP;
		if (backdropDrawnAlready[zoneIndex])
			return;
		if (backdropRerenderAll || dirty == BACKDROP_DIRTY_RENDER || dirty == BACKDROP_DIRTY_ANIMATED) {
			backdropCtx.globalAlpha = 1;
			backdropCtx.fillStyle = "black";
			backdropCtx.fillRect(renderBaseX, renderBaseY, BACKDROP_ZONE_PIXEL_SIZE, BACKDROP_ZONE_PIXEL_SIZE);
			backdropOverMap[zoneIndex] = [];

			for (let withinZoneX = 0; withinZoneX < BACKDROP_ZONE_SIZE; withinZoneX++) {
				for (let withinZoneY = 0; withinZoneY < BACKDROP_ZONE_SIZE; withinZoneY++) {
					try {
						backdropCtx.globalAlpha = 1;
						// Coordinates for the backdrop canvas
						let drawOnBackdropPixelX = (zoneRealGridX * BACKDROP_ZONE_SIZE + withinZoneX) * 16;
						let drawOnBackdropPixelY = (zoneRealGridY * BACKDROP_ZONE_SIZE + withinZoneY) * 16;

						// Find map data coordinates
						let mapCoordX = withinZoneX + (zoneScrollGridX + zoneDrawGridX) * BACKDROP_ZONE_SIZE;
						let mapCoordY = withinZoneY + (zoneScrollGridY + zoneDrawGridY) * BACKDROP_ZONE_SIZE;
						let map = MyMap;

						// Out-of-bounds tiles may be on another map
						let edgeLookupIndex = (mapCoordX < 0) * 1 + (mapCoordX >= MyMap.Width) * 2 +
							(mapCoordY < 0) * 4 + (mapCoordY >= MyMap.Height) * 8;
						if (edgeLookupIndex != 0) {
							if (edgeLinks == null)
								continue;
							map = MapsByID[edgeLinks[edgeMapLookupTable[edgeLookupIndex]]];
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
							backdropCtx.globalAlpha = Math.max(0, Math.min(gradientHorizontal, gradientVertical));
							if (backdropCtx.globalAlpha == 0)
								continue;
						}

						// Draw the turf
						let turfAtom = AtomFromName(map.Tiles[mapCoordX][mapCoordY]);
						if (turfAtom.over) {
							backdropOverMap[zoneIndex].push([withinZoneX, withinZoneY, turfAtom, map, mapCoordX, mapCoordY]);
						} else {
							drawTurf(backdropCtx, drawOnBackdropPixelX, drawOnBackdropPixelY, turfAtom, map, mapCoordX, mapCoordY);
						}

						// Draw wallpaper if available
						if(map.WallpaperData) {
							let wallpaper = map.WallpaperData;
							if(wallpaper.hasWallpaper &&
							(map.Info["wallpaper"]["over_turf"] || (turfAtom.name == wallpaper.defaultTurf.name && turfAtom.pic[0] == wallpaper.defaultTurf.pic[0] && turfAtom.pic[1] == wallpaper.defaultTurf.pic[1] && turfAtom.pic[2] == wallpaper.defaultTurf.pic[2]))
							&& (mapCoordX >= wallpaper.wallpaperStartX && mapCoordX <= wallpaper.wallpaperEndX && mapCoordY >= wallpaper.wallpaperStartY && mapCoordY <= wallpaper.wallpaperEndY)) {
								if(wallpaper.wallpaperHasRepeat) {
									backdropCtx.drawImage(map.WallpaperImage,
										wrapWithin(mapCoordX - wallpaper.wallpaperTileX, map.WallpaperImage.naturalWidth>>4)*16,
										wrapWithin(mapCoordY - wallpaper.wallpaperTileY, map.WallpaperImage.naturalHeight>>4)*16,
										16, 16, drawOnBackdropPixelX, drawOnBackdropPixelY, 16, 16);
								} else {
									backdropCtx.drawImage(map.WallpaperImage,
										(mapCoordX - wallpaper.wallpaperTileX)*16 - (wallpaper.wallpaperDrawX&15),
										(mapCoordY - wallpaper.wallpaperTileY)*16 - (wallpaper.wallpaperDrawY&15),
										16, 16, drawOnBackdropPixelX, drawOnBackdropPixelY, 16, 16);
								}
							}
						}

						// Draw anything above the turf (the tile objects)
						let Objs = map.Objs[mapCoordX][mapCoordY];
						if (Objs.length) {
							for (let o of Objs) {
								o = AtomFromName(o);
								if(o.over === true) {
									backdropOverMap[zoneIndex].push([withinZoneX, withinZoneY, o, map, mapCoordX, mapCoordY]);
								} else {
									drawObj(backdropCtx, drawOnBackdropPixelX, drawOnBackdropPixelY, o, map, mapCoordX, mapCoordY);
								}
							}
						}
					} catch (error) {
					}
				}
			}
		}
		if (backdropRerenderAll || backdropDrawAll || redraw || dirty != BACKDROP_DIRTY_SKIP) {
			ctx.drawImage(backdropCanvas, renderBaseX, renderBaseY, BACKDROP_ZONE_PIXEL_SIZE, BACKDROP_ZONE_PIXEL_SIZE, zoneDrawGridX*BACKDROP_ZONE_PIXEL_SIZE-zoneScrollOffsetX, zoneDrawGridY*BACKDROP_ZONE_PIXEL_SIZE-zoneScrollOffsetY, BACKDROP_ZONE_PIXEL_SIZE, BACKDROP_ZONE_PIXEL_SIZE);
			backdropDrawnAlready[zoneIndex] = 1;
		}
		// Note that there are "over" tiles here, to draw later
		if (backdropOverMap[zoneIndex] && backdropOverMap[zoneIndex].length) {
			backdropWithOver.push([zoneDrawGridX, zoneDrawGridY, zoneIndex]);
		}
	}

	for (let zoneDrawGridY = 0; zoneDrawGridY < backdropHeightZones; zoneDrawGridY++) {
		for (let zoneDrawGridX = 0; zoneDrawGridX < backdropWidthZones; zoneDrawGridX++) {
			processBackdropGrid(zoneDrawGridX, zoneDrawGridY);
		}
	}
	backdropRerenderAll = false;
	backdropDrawAll = false;

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
	for (let over of backdropWithOver) {
		let [zoneDrawX, zoneDrawY, zoneIndex] = over;
		
		for (let o of backdropOverMap[zoneIndex]) {
			if (!backdropDrawnAlready[zoneIndex])
				continue;
			let [x, y, object, map, mapx, mapy] = o;
			drawObj(ctx, (zoneDrawX * BACKDROP_ZONE_PIXEL_SIZE - zoneScrollOffsetX) + x * 16, (zoneDrawY * BACKDROP_ZONE_PIXEL_SIZE - zoneScrollOffsetY) + y * 16, object, map, mapx, mapy);
		}
	}

	// Draw markers that show that people are building
	let potluck = document.getElementById('potluck');
	for (let id in PlayerBuildMarkers) {
		let marker = PlayerBuildMarkers[id];
		let nameText = " " + marker.name + " ";
		let del = marker.del;
		drawTextSmall(ctx, (marker.pos[0] * 16 + 8) - pixelCameraX - (nameText.length * 4 / 2),   (marker.pos[1] * 16) - pixelCameraY - 8, nameText);
		ctx.drawImage(potluck, del?(17 * 16):(9 * 16), del?(19 * 16):(22 * 16), 16, 16, marker.pos[0] * 16 - pixelCameraX, marker.pos[1] * 16 - pixelCameraY, 16, 16);
		markAreaAroundPointAsDirty(MyMap, marker.pos[0], marker.pos[1], 7);
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

	FlushIconSheetRequestList();
}

function drawText(ctx, x, y, text) {
	let chicago = document.getElementById("chicago");

	for (let i = 0; i < text.length; i++) {
		let chr = text.charCodeAt(i) - 0x20;
		if(chr < 0x00 || chr > 0x5E)
			chr = 0x1F; // ?
		let srcX = chr & 15;
		let srcY = chr >> 4;
		ctx.drawImage(chicago, srcX * 8, srcY * 8, 8, 8, x + i * 8, y, 8, 8);
	}
}

const proportionalTextWidth = [3, 6, 8, 10, 7, 10, 9, 4, 5, 5, 10, 10, 4, 5, 4, 8, 8, 6, 7, 7, 8, 7, 8, 7, 8, 8, 4, 4, 9, 8, 9, 8, 12, 8, 8, 8, 9, 7, 7, 8, 8, 6, 6, 8, 7, 11, 9, 8, 8, 8, 8, 7, 8, 9, 8, 11, 8, 8, 7, 5, 8, 5, 8, 8, 4, 8, 8, 8, 8, 8, 9, 8, 8, 6, 5, 8, 5, 13, 9, 8, 8, 8, 7, 7, 8, 9, 8, 12, 8, 8, 7, 5, 4, 5, 8, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 3, 6, 8, 9, 10, 8, 4, 8, 6, 14, -1, 14, 8, -1997, 14, -1, -1, 10, -1, -1, 4, 9, 11, -1, -1, -1, -1, 14, -1, -1, -1, 7, 8, 8, 8, 8, 8, 8, 11, 8, 8, 8, 8, 8, 6, 6, 6, 6, 9, 9, 8, 8, 8, 8, 8, 8, 10, 9, 9, 9, 9, 8, 8, 12, 8, 8, 8, 8, 8, 8, 12, 8, 8, 8, 8, 8, 6, 6, 6, 6, 8, 9, 8, 8, 8, 8, 8, 10, 10, 9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 12, 9, 9, 7, 8, 8, 8, 7, 8, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 10, 9, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 9, 6, 6, 8, 8, 8, 7, 5, 7, 5, 8, 8, 8, 8, 8, 7, 9, 9, 9, 9, 9, 9, 13, 9, 9, 8, 8, 8, 8, 8, 8, 11, 12, 8, 7, 8, 7, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 11, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 11, 12, 8, 8, 8, 7, 7, 7, 7, 7, 7, 9, 6, 12, 6, 12, 4, 3, 2, 8, 4, 2, 1, -1997, -1997, -1997, -1, -1, 5, 5, 8, 6, 12, 12, -1, -1, 4, 4, 4, 4, 8, 8, 8, 8, 8, 8, 5, 5, 4, 8, 12, 4, -1, -1, -1, -1, -1, -1, -1, -1, 13, 16, 4, 8, 12, 4, 8, 12, -1, 8, 8, -1, 10, 9, -1, -1, -1, -1, -1, -1, -1, -1, -1, 14, 12, 12, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 8, 10, -1, -1, -1, -1, -1, -1, -1, -1, -1, 11, 11, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 8, -1, -1, -1, 9, 9, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 4, 12, -1, 11, 12, 10, -1, 12, -1, 12, 12, -1, 8, 8, 7, 10, 7, 7, 8, 8, 6, 8, 10, 11, 9, 8, 8, 10, 8, -1, 8, 8, 8, 12, 8, 12, 8, -1, -1, 9, 8, 17, 7, -1, 9, 8, 8, 8, 8, 7, 9, 9, 6, 8, 9, 9, 8, 8, 8, 10, 8, 8, 9, 8, 8, 12, 8, 12, 12, -1, -1, 8, 8, 12, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 8, 8, 10, 8, 8, 7, 6, 7, 6, 13, 12, 10, 9, 9, 8, 10, 8, 8, 8, 7, 10, 7, 12, 7, 9, 9, 8, 9, 11, 8, 8, 8, 8, 8, 8, 8, 12, 8, 10, 8, 14, 14, 9, 12, 8, 8, 12, 8, 8, 8, 8, 7, 10, 8, 12, 7, 9, 9, 8, 9, 11, 8, 8, 8, 8, 8, 8, 8, 12, 8, 10, 8, 13, 13, 9, 12, 8, 8, 12, 8, 8, 8, 9, 7, 8, 7, 6, 6, 5, 13, 12, 9, 8, 9, 8, 10, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 8, 8, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 10, 9, 9, 9, 9, 9, 7, 7, 8, 8, 8, 8, 18, 14, 7, 7, 9, 9, 10, 10, 9, 9, 10, 10, 9, 9, 10, 10, 12, 12, 12, 12, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 11, 11, 9, 9, 10, 10, 8, 8, 11, 11, 11, 11, 4, 12, 12, 8, 8, 9, 9, 8, 8, 8, 8, 8, 8, 11, 11, 6, 8, 8, 8, 8, 11, 12, 8, 8, 8, 8, 8, 8, 12, 12, 8, 8, 7, 7, 9, 9, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7, 12, 12, 8, 8, 8, 8, 10, 10, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 8, 8, -1, -1, 8, 8, 9, 9, 13, 13, 12, 12, 11, 12, 8, 8, 11, 12, 9, 9, 13, 13, 12, 12, 9, 9, 9, 10, 9, 9, -1, -1, 13, 13, 10, 10];
const unicodeBlocks = [
	[0x0020, 0x007F], // Basic Latin
	[0x0080, 0x00FF], // Latin-1 Supplement
	[0x0100, 0x017F], // Latin Extended-A
	[0x2000, 0x206F], // General Punctuation
	[0x2200, 0x22FF], // Mathematical Operators
	[0x0370, 0x03FF], // Greek and Coptic
	[0x0400, 0x04FF], // Cyrillic
	[0x0500, 0x052F], // Cyrillic supplement
];

function drawTextProportional(ctx, x, y, centered, text) {
	let tilemap_sans = document.getElementById("tilemapsans");

	function translate(code) {
		let height = 0;
		for(let block of unicodeBlocks) {
			if(code >= block[0] && code <= block[1]) {
				return code - block[0] + height;
			} else {
				height += block[1]-block[0]+1;
			}
		}
		return 0x1F; // question mark
	}

	if (centered) {
		let total_width = 0;
		for (let i = 0; i < text.length; i++) {
			let chr = translate(text.charCodeAt(i));
			if(proportionalTextWidth[chr] == -1) // Unsupported character
				chr = 0x1F;
			total_width += proportionalTextWidth[chr];
		}
		x -= Math.round(total_width / 2);
	}

	for (let i = 0; i < text.length; i++) {
		let chr = translate(text.charCodeAt(i));
		if(proportionalTextWidth[chr] == -1) // Unsupported character
			chr = 0x1F;
		let srcX = chr & 15;
		let srcY = chr >> 4;
		ctx.drawImage(tilemap_sans, srcX * 18, srcY * 21, 18, 21, x - 1, y, 18, 21);
		x += proportionalTextWidth[chr];
	}
}

function drawTextSmall(ctx, x, y, text) {
	let tomthumb = document.getElementById("tomthumb");

	for (let i = 0; i < text.length; i++) {
		let chr = text.charCodeAt(i) - 0x20;
		if(chr < 0x00 || chr > 0x5E)
			chr = 0x1F; // ?
		let srcX = chr & 15;
		let srcY = chr >> 4;
		ctx.drawImage(tomthumb, srcX * 4, srcY * 6, 4, 6, x + i * 4, y, 4, 6);
	}
}
