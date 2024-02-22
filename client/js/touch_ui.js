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

let touchButtonsAreTurn = false;

function initTouchUI() {
	initWorld();

	CameraScale = 4;
	resizeCanvas();
	updateZoomLevelDisplay();

	// On-screen buttons ----------------------------------
	function setupMoveButton(id, code) {
		let button = document.getElementById(id);
		button.addEventListener('mousedown', function (evt) {
			keyDownHandler({
				'shiftKey': touchButtonsAreTurn,
				'code': code,
				'keyCode': null,
				'preventDefault': function(){},
			});
		}, false);
		button.addEventListener('mouseup', function (evt) {
			keyUpHandler({
				'shiftKey': touchButtonsAreTurn,
				'code': code,
				'keyCode': null,
				'preventDefault': function(){},
			});
		}, false);
	}
	setupMoveButton("touch_button_ul", "Home");
	setupMoveButton("touch_button_u",  "ArrowUp");
	setupMoveButton("touch_button_ur", "PageUp");
	setupMoveButton("touch_button_l",  "ArrowLeft");
	setupMoveButton("touch_button_r",  "ArrowRight");
	setupMoveButton("touch_button_dl", "End");
	setupMoveButton("touch_button_d",  "ArrowDown");
	setupMoveButton("touch_button_dr", "PageDown");

	let touchButtonMiddle = document.getElementById("touch_button_walkturn");
	document.getElementById("touch_button_walkturn").addEventListener('click', function (evt) {
		touchButtonsAreTurn = !touchButtonsAreTurn;
		touchButtonMiddle.innerHTML = touchButtonsAreTurn ? "&#x1F504;" : "&#x1F6B6;";
	}, false);
}
