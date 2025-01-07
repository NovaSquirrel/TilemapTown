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

let touchButtonsAreTurn = false;

let stopTouchRepeat = false;
let touchRepeatTime = 0;
let touchRepeatInterval = undefined;
let hadTouchEvent = false;

function touchButtonRepeat() {
	if (stopTouchRepeat || touchButtonsAreTurn) {
		clearInterval(touchRepeatInterval);
		return;
	}
	if (touchRepeatTime++ > 2) {
		keyDownHandler({
			'shiftKey': touchButtonsAreTurn,
			'code': this.code,
			'key': this.code,
			'keyCode': null,
			'preventDefault': function(){},
		});
	}
}

function initTouchUI() {
	initWorld();

	CameraScale = 4;
	resizeCanvas();
	updateZoomLevelDisplay();

	// On-screen buttons ----------------------------------
	function setupMoveButton(id, code, key) {
		let button = document.getElementById(id);
		function touchHandler(evt) {
			stopTouchRepeat = false;
			touchRepeatTime = 0;
			keyDownHandler({
				'shiftKey': touchButtonsAreTurn,
				'code': code,
				'key': code,
				'keyCode': null,
				'preventDefault': function(){},
			});
			if (touchRepeatInterval)
				clearInterval(touchRepeatInterval);
			touchRepeatInterval = window.setInterval(touchButtonRepeat.bind({id, code}), 200);
		};
		function mouseHandler(evt) {
			if (!hadTouchEvent)
				touchHandler(evt);
		}
		button.addEventListener('mousedown', mouseHandler, false);
		button.addEventListener('touchstart', touchHandler, false);
		button.addEventListener('mouseup', function (evt) {
			stopTouchRepeat = true;
			keyUpHandler({
				'shiftKey': touchButtonsAreTurn,
				'code': code,
				'key': code,
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

window.addEventListener('touchstart', function (evt) {hadTouchEvent = true;});
window.addEventListener('mouseup', function (evt) {stopTouchRepeat = true;});
window.addEventListener('touchend', function (evt) {stopTouchRepeat = true;});
window.addEventListener('touchcancel', function (evt) {stopTouchRepeat = true;});
