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

///////////////////////////////////////////////////////////
// Global variables
///////////////////////////////////////////////////////////

messaging_mode = true;

let ShiftPressed = false;
let CtrlPressed = false;
let lastChatUsed = "";

///////////////////////////////////////////////////////////
// Char bar
///////////////////////////////////////////////////////////

function runLocalCommand(t) {
	if (t.toLowerCase() == "/clear") {
		chatArea.innerHTML = "";
		chatLogForExport = [];
		return true;
	} else if (t.toLowerCase().startsWith("/openprofile ") || t.toLowerCase().startsWith("/userprofile ")) {
		SendCmd("EXT", { "get_user_profile": {"username": t.slice(13)} });
		return true;
	} else if (t.toLowerCase() == "/exportlogs" || t.toLowerCase() == "/exportlog") {
		// https://stackoverflow.com/a/4929629
		let today = new Date();
		let dd = String(today.getDate()).padStart(2, '0');
		let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
		let yyyy = today.getFullYear();
		today = yyyy + '-' + mm + '-' + dd;

		let element = document.createElement('a');
		element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(chatLogForExport.join('\n')));
		element.setAttribute('download', "tilemap town "+today+".txt");
		element.style.display = 'none';
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
		return true;
	}
	return false;
}

function setChatInput(the_text) {
	chatInput.value = the_text;
	chatInput.focus();
	sendTyping();
}

function sendChatCommand(the_text) {
	SendCmd("CMD", { text: the_text });
}

function changedSendButtonCheckbox() {
	document.getElementById("sendButton").style.display = document.getElementById("showSendButton").checked ? "inline" : "none";
}

function sendTyping() {
	markNotIdle();

	let lowercase = chatInput.value.trimStart();
	const isTyping = document.activeElement === chatInput && chatInput.value.length > 0 && (!lowercase.startsWith("/") || lowercase.startsWith("/me ") || lowercase.startsWith("/ooc ") || lowercase.startsWith("/spoof "));

	/*
	if (PlayerWho[PlayerYou].typing != isTyping) {
		SendCmd("WHO", { update: { id: PlayerYou, typing: isTyping } });
		PlayerWho[PlayerYou].typing = isTyping;
	}
	*/
}

///////////////////////////////////////////////////////////
// Input
///////////////////////////////////////////////////////////

function keyUpHandler(e) {
	markNotIdle();
	var e = e || window.event;
	ShiftPressed = e.shiftKey;
	CtrlPressed = e.ctrlKey;
}

function sendMessage() {
	if (chatInput.value.toLowerCase().trim() == "/oops") {
		chatInput.value = lastChatUsed;
		sendTyping();
		return;
	}
	if (chatInput.value.length > 5)
		lastChatUsed = chatInput.value;

	// First, check for commands that are local to the client
	const startsWithNewline = chatInput.value.startsWith("\n");
	let trimmedChatText = chatInput.value.trimStart();
	if (runLocalCommand(trimmedChatText));
		// commands are CMD while regular room messages are MSG. /me is a room message.
	else if (trimmedChatText.slice(0, 1) == "/" &&
		trimmedChatText.toLowerCase().slice(0, 4) != "/me " &&
	trimmedChatText.toLowerCase().slice(0, 5) != "/ooc " &&
	trimmedChatText.toLowerCase().slice(0, 7) != "/spoof ") {
		SendCmd("CMD", { text: trimmedChatText.slice(1) }); // remove the /
	} else if (trimmedChatText.length > 0) {
		SendCmd("MSG", { text: (startsWithNewline?"\n":"") + trimmedChatText });
	} else {
		chatInput.blur();
	}

	chatInput.value = "";

	sendTyping();
}

function keyDownHandler(e) {
	markNotIdle();

	var e = e || window.event;
	ShiftPressed = e.shiftKey;
	CtrlPressed = e.ctrlKey;

	// ignore keys when typing in a textbox
	if (document.activeElement.tagName == "INPUT" || document.activeElement.tagName == "TEXTAREA") {
		if (document.activeElement == chatInput && e.code == "ArrowUp") {
			if(chatInput.value.length == 0)
				chatInput.value = lastChatUsed;
			return;
		} else if (document.activeElement == chatInput && (e.keyCode == 13 && !e.shiftKey && !document.getElementById('showSendButton').checked)) {
			sendMessage();
			e.preventDefault();
		} else if (document.activeElement == chatInput && e.keyCode == 27) {
			// escape press
			chatInput.blur();
		}
		return;
	}
}
document.onkeydown = keyDownHandler;
document.onkeyup = keyUpHandler;

///////////////////////////////////////////////////////////
// Other code
///////////////////////////////////////////////////////////

function markNotIdle() {
	timeOfLastInput = Date.now();
	if (PlayerWho?.[PlayerYou]?.status == "idle" && OnlineMode) {
		if (statusBeforeIdle) {
			if (statusMessageBeforeIdle) {
				SendCmd("CMD", {text: "status "+statusBeforeIdle+" "+statusMessageBeforeIdle});
			} else {
				SendCmd("CMD", {text: "status "+statusBeforeIdle});
			}
		} else {
			SendCmd("CMD", {text: "status"});
		}		
		PlayerWho[PlayerYou].status = statusBeforeIdle; // Don't send it again
	}
}

function idleChecker() {
	alreadyPlayedSound = false;

	let minutesSinceLastInput = (Date.now() - timeOfLastInput) / 60000;
	let myStatus = PlayerWho?.[PlayerYou]?.status;
	if (myStatus != null) myStatus = myStatus.toLowerCase();
	if (OnlineMode) {
		if (minutesUntilIdle > 0 && minutesSinceLastInput >= minutesUntilIdle && [null, "ic", "ooc", "rp"].includes(myStatus)) {
			statusBeforeIdle = PlayerWho[PlayerYou]?.status;
			statusMessageBeforeIdle = PlayerWho[PlayerYou]?.status_message;
			if(PlayerWho?.[PlayerYou]?.status)
				SendCmd("CMD", {text: "status idle "+PlayerWho[PlayerYou].status});
			else
				SendCmd("CMD", {text: "status idle"});
			PlayerWho[PlayerYou].status = "idle"; 
		}
		if (minutesUntilDisconnect > 0 && minutesSinceLastInput >= minutesUntilDisconnect) {
			SendCmd("CMD", {text: "disconnect"});
		}
	}
}

function initMessagingUI() {
	changedSendButtonCheckbox();

	chatInput = document.getElementById("chatInput");

	chatInput.addEventListener('input', function (evt) {
		sendTyping();
	});

	chatInput.addEventListener('blur', function (evt) {
		sendTyping();
	});

	// applies saved options from browser form fill (or from local storage)
	loadOptions();
	applyOptions();

	window.setInterval(idleChecker, 1000);
	if (OnlineServer) {
		ConnectToServer();
	}

	{
		// Set up the login window
		// Get the modal
		let loginmodal = document.getElementById('loginWindow');
		let mailmodal = document.getElementById('mail');
		let optionsmodal = document.getElementById('options');

		let btn = document.getElementById("navlogin");
		let span = document.getElementsByClassName("modalclose");

		// Prefill the login window username if it is saved
		const saved_username = localStorage.getItem("username");
		if (saved_username) {
			document.getElementById("loginuser").value = saved_username;
		}

		btn.onclick = function () {
			loginmodal.style.display = "block";
		}

		for (var i = 0; i < span.length; i++) {
			span[i].onclick = function () {
				loginmodal.style.display = "none";
				mailmodal.style.display = "none";
				optionsmodal.style.display = "none";
			}
		}

		window.onclick = function (event) {
			if (event.target == loginmodal) {
				loginmodal.style.display = "none";
			} else if (event.target == mailmodal) {
				if ((document.getElementById('mailDivCompose').style.display !== 'block' && document.getElementById('mailDivPreview').style.display !== 'block') || confirm("You're currently writing mail; do you want to stop?"))
					mailmodal.style.display = "none";
			} else if (event.target == optionsmodal) {
				optionsmodal.style.display = "none";
			}
		}

		if (!OnlineServer) {
			// Open the login window by default
			loginmodal.style.display = "block";
		}
	}

	for (let i of ["loginuser", "loginpass", "loginserver"])
		document.getElementById(i).addEventListener("keydown", function(event) {
			if (event.key === "Enter" && !document.getElementById("connectButton").disabled)
				loginButton();
		});
}
