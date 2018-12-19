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

function windowUpdateWidths() {
	for(index = 0; index < windowCounter; index++) {
		if(windowActive[index]) {
			windowHandleList[index].style.width = windowBodyList[index].offsetWidth + "px";
		}
	}
}

// dragElement based on https://www.w3schools.com/howto/howto_js_draggable.asp
function dragElement(elmnt, handle, count) {
	var pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
	if (handle) {
		// if present, the header is where you move the DIV from:
		handle.onmousedown = dragMouseDown;
	} else {
		// otherwise, move the DIV from anywhere inside the DIV: 
		elmnt.onmousedown = dragMouseDown;
	}

	function dragMouseDown(e) {
		e = e || window.event;
		e.preventDefault();
		// get the mouse cursor position at startup:
		pos3 = e.clientX;
		pos4 = e.clientY;
		document.onmouseup = closeDragElement;
		// call a function whenever the cursor moves:
		document.onmousemove = elementDrag;
		// put this window on top
		putWindowOnTop(count);
	}

	function elementDrag(e) {
		e = e || window.event;
		e.preventDefault();
		// calculate the new cursor position:
		pos1 = pos3 - e.clientX;
		pos2 = pos4 - e.clientY;
		pos3 = e.clientX;
		pos4 = e.clientY;
		// set the element's new position:
		var newX = (elmnt.offsetLeft - pos1);
		var newY = (elmnt.offsetTop - pos2);
		elmnt.style.left = newX + "px";
		elmnt.style.top = newY + "px";

		// drag the handle too
		handle.style.left = newX + "px";
		handle.style.top = (newY - handle.offsetHeight) + "px";
		handle.style.width = elmnt.offsetWidth + "px";
	}

	function closeDragElement() {
		// stop moving when mouse button is released:
		document.onmouseup = null;
		document.onmousemove = null;
	}
}

windowCounter = 0;
windowBodyList = [];
windowHandleList = [];
windowActive = [];
windowLayer = [];
windowIdentifier = [];
windowIdentifierDictionary = {};

function putWindowOnTop(count) {
	// update window titles to show the active one
	for(var i = 0; i < windowCounter; i++) {
		if(i == count)
			windowHandleList[i].setAttribute('class', 'draghandle');
		else
			windowHandleList[i].setAttribute('class', 'draghandle_inactive');
	}

	// shift zIndex around
	originalLayer = windowLayer[count];
	for(var i = 0; i < windowCounter; i++) {
		if(windowLayer[i] > originalLayer)
			windowLayer[i]--;
	}
	windowLayer[count] = windowCounter - 1;

	// update zIndex
	for(var i = 0; i < windowCounter; i++) {
		windowBodyList[i].style.zIndex = windowLayer[i] + 10;
		windowHandleList[i].style.zIndex = windowLayer[i] + 10;
	}
}

function closeWindow(count) {
	if(typeof count == "string") {
		count = windowIdentifierDictionary[count];
		if(count == undefined)
			return;
	}

	windowBodyList[count].innerHTML = '';
	windowHandleList[count].innerHTML = '';
	windowBodyList[count].style.display = 'none';
	windowHandleList[count].style.display = 'none';

	windowActive[count] = false;
	// erase identifier dictionary entry
	if(windowIdentifier[count]) {
		delete windowIdentifierDictionary[windowIdentifier[count]];
		windowIdentifier[count] = null;
	}
}

function newWindow(title, contents, options) {
	var index, div = null, handle = null;
	for(index = 0; index < windowCounter; index++) {
		if(!windowActive[index]) {
			div = windowBodyList[index];
			handle = windowHandleList[index];
			windowActive[index] = true;
			break;
		}
	}

	// create the body
	if(!div)
		div = document.createElement('div');
	div.id = "draggable" + windowCounter;
	div.innerHTML = contents;
	div.style.width = '300px';
	div.style.height = '300px';
	if(options && "width" in options)
		div.style.width = options.width + 'px';
	if(options && "height" in options)
		div.style.height = options.height + 'px';
	div.style.display = 'block';
	div.style.left = '100px';
	div.style.top = '100px';

	div.addEventListener("keydown",
    function(e){
        if(document.activeElement.tagName == "INPUT" || document.activeElement.tagName == "TEXTAREA")
          return;
        switch(e.keyCode){
            case 37: case 39: case 38:  case 40: // Arrow keys
            case 32: e.preventDefault(); break; // Space
            default: break; // do not block other keys
        }
    },
false);

	// update window when it's clicked and 
	div.onclick = function(){windowUpdateWidths(); putWindowOnTop(index);}
	div.setAttribute('class', 'drag unselectable');
	document.body.appendChild(div);

	// create the handle
	if(!handle) {
		handle = document.createElement('div');
		windowBodyList.push(div);
		windowHandleList.push(handle);
		windowLayer.push(windowCounter);
		windowActive.push(true);
		windowIdentifier.push(null);
	}
	if(options && "identifier" in options) {
		windowIdentifier[index] = options.identifier;
		windowIdentifierDictionary[options.identifier] = index;
	}

	handle.style.width = div.offsetWidth + "px";
	handle.setAttribute('class', 'draghandle');
	handle.innerHTML = title + '<button style="float:right;" onclick="closeWindow('+index+')">&times;</button>';
	document.body.appendChild(handle);
	handle.style.display = 'block';
	handle.style.left = div.offsetLeft + "px";
	handle.style.top = (div.offsetTop - handle.offsetHeight) + "px";

	// let's go
	if(windowCounter == index) {
		dragElement(div, handle, windowCounter);
		windowCounter++;
	}
	putWindowOnTop(index);
	return index;
}
