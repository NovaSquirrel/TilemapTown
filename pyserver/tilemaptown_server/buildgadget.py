# Tilemap Town
# Copyright (C) 2017-2025 NovaSquirrel
#
# This program is free software: you can redistribute it and/or
# modify it under the terms of the GNU General Public License as
# published by the Free Software Foundation; either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

import random, weakref, asyncio
from .buildglobal import *
from .buildentity import Entity, save_generic_data, load_generic_data
from .buildcommand import handle_user_command
from .buildscripting import send_scripting_message, encode_scripting_message_values, VM_MessageType, ScriptingValueType, ScriptingCallbackType

class Gadget(Entity):
	def __init__(self, entity_type_gadget, creator_id=None):
		super().__init__(entity_type['gadget'], creator_id=creator_id)

		self.traits = []
		self.data = {} # Configuration
		self.script_data = {}
		self.script_data_size = 0

		self.script_callback_enabled = [False] * ScriptingCallbackType.COUNT
		self.listening_to_chat = False
		self.listening_to_chat_warning = False

	def clean_up(self):
		for trait in self.traits:
			trait.on_shutdown()
		super().clean_up()

	def reload_traits(self):
		for trait in self.traits:
			trait.on_shutdown()
		self.traits = []
		for trait in self.data:
			trait_type = trait[0]
			trait_data = trait[1]
			if trait_type in gadget_trait_class:
				self.traits.append(gadget_trait_class[trait_type](self, trait_data))
		for trait in self.traits:
			trait.on_init()

	def load_data(self):
		try:
			data = loads_if_not_none(self.load_data_as_text())
			if data == None:
				return True
			load_generic_data(self, data)
			self.data = data.get('data', {})
			self.script_data = data.get('script_data', {})
			self.script_data_size = data.get('script_data_size', 0)
			self.reload_traits()
			return True
		except:
			return False

	def save_data(self):
		data = {}
		save_generic_data(self, data)
		data['data'] = self.data
		if len(self.script_data):
			data['script_data'] = self.script_data
		if script_data_size:
			data['script_data_size'] = self.script_data_size
		self.save_data_as_text(dumps_if_not_none(data))

	# .----------------------
	# | Event handlers
	# '----------------------
	def receive_switch_map(self):
		for trait in self.traits:
			if trait.on_switch_map():
				return	

	def receive_use(self, user):
		for trait in self.traits:
			if trait.on_use(user):
				return

	def receive_tell(self, user, text):
		for trait in self.traits:
			if trait.on_tell(user, text):
				return

	def receive_request(self, user, request_type, request_data, accept_command, decline_command):
		for trait in self.traits:
			if trait.on_request(user, request_type, request_data, accept_command, decline_command):
				return

	def receive_key_press(self, user, key, down):
		for trait in self.traits:
			if trait.on_key_press(user, key, down):
				return

	def receive_bot_message_button(self, user, arg):
		for trait in self.traits:
			if trait.on_bot_message_button(user, arg):
				return

	def receive_took_controls(self, user, arg):
		for trait in self.traits:
			if trait.on_took_controls(user, arg):
				return

	def receive_entity_click(self, user, arg):
		for trait in self.traits:
			if trait.on_entity_click(user, arg):
				return

	def receive_join(self, user):
		for trait in self.traits:
			if trait.on_entity_join(user):
				return

	def receive_leave(self, user):
		for trait in self.traits:
			if trait.on_entity_leave(user):
				return

	def receive_chat(self, user, text):
		for trait in self.traits:
			if trait.on_entity_chat(user, text):
				return

	# .----------------------
	# | Miscellaneous
	# '----------------------
	def who(self):
		w = super().who()
		w['usable'] = any(_.usable for _ in self.traits)
		w['verbs'] = list(dict.fromkeys(sum((_.verbs for _ in self.traits), [])))
		return w

class GadgetTrait(object):
	usable = False
	verbs = []

	def __init__(self, gadget, config):
		self.gadget = gadget
		self.config = config

	def get_config(self, field, default=None):
		return self.config.get(field, default)

	def set_config(self, field, value):
		if self.config.get(field) != value:
			self.config[field] = value
			self.gadget.save_on_clean_up = True

	def del_config(self, field):
		if field in self.config:
			del self.config[field]
			self.gadget.save_on_clean_up = True

	# .----------------------
	# | Utility
	# '----------------------
	def tell(self, user, text):
		handle_user_command(self.gadget.map, self.gadget, user, None, "tell %s %s" % (user.protocol_id(), text))

	# .----------------------
	# | Event handlers
	# '----------------------
	def on_init(self):
		pass

	def on_shutdown(self):
		pass

	def on_use(self, user):
		return None

	def on_tell(self, user, text):
		return None

	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		return None

	def on_key_press(self, user, key, down):
		return None

	def on_bot_message_button(self, user, arg):
		return None

	def on_took_controls(self, user, arg):
		return None

	def on_entity_click(self, user, arg):
		return None

	def on_switch_map(self):
		return None

	def on_join(self, user):
		return None

	def on_leave(self, user):
		return None

	def on_chat(self, user, text):
		return None

class GadgetDice(GadgetTrait):
	usable = True

	def on_use(self, user):
		handle_user_command(user.map, user, user, None, "roll %d %d" % (self.get_config('dice', 2), self.get_config('sides', 6)))
		return True

class GadgetAcceptRequests(GadgetTrait):
	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		request_types = self.get_config("types")
		if (request_types and request_type not in request_types) or (self.get_config("owner_only") and not user.has_permission(self.gadget)):
			return None
		handle_user_command(self.gadget.map, self.gadget, self.gadget, None, '%s %s %s' % (accept_command, user.protocol_id(), request_type))
		return True

class GadgetDeclineRequests(GadgetTrait):
	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		handle_user_command(self.gadget.map, self.gadget, self.gadget, None, decline_command)
		return True

class GadgetEchoTell(GadgetTrait):
	def on_tell(self, user, text):
		self.tell(user, text)
		return True

class GadgetUseRandomTell(GadgetTrait):
	usable = True

	def on_use(self, user):
		text = self.get_config("text")
		if isinstance(text, str):
			self.tell(user, text)
		elif isinstance(text, list):
			self.tell(user, random.choice(text))
		return True

class GadgetUseRandomSay(GadgetTrait):
	usable = True

	def on_use(self, user):
		text = self.get_config("text")
		if isinstance(text, str):
			handle_user_command(self.gadget.map, self.gadget, user, None, "say %s" % (text))
		elif isinstance(text, list):
			handle_user_command(self.gadget.map, self.gadget, user, None, "say %s" % (random.choice(text)))
		return True

class GadgetUseBotMessageButton(GadgetTrait):
	usable = True

	def on_use(self, user):
		target_id = self.get_config("id")
		if target_id == None:
			return
		e = get_entity_by_id(target_id, load_from_db=False)
		if e == None:
			return
		if self.gadget.owner_id != e.db_id and self.gadget.owner_id != e.owner_id:
			return

		arg = {
			'text': self.get_config('text'),
			'id': user.protocol_id(),
			'name': user.name,
			'username': user.username_or_id()
		}
		if e.entity_type == entity_type['gadget']:
			e.receive_bot_message_button(client, arg)
		else:
			e.send("EXT", {'bot_message_button': arg})
		return True

key_to_offset = {
	"move-n":  (0, -1, 6),
	"move-ne": (1, -1, 7),
	"move-e":  (1,  0, 0),
	"move-se": (1,  1, 1),
	"move-s":  (0,  1, 2),
	"move-sw": (-1, 1, 3),
	"move-w":  (-1, 0, 4),
	"move-nw": (-1,-1, 5),
	"turn-n":  (0, -1, 6),
	"turn-ne": (0,  0, 7),
	"turn-e":  (0,  0, 0),
	"turn-se": (0,  0, 1),
	"turn-s":  (0,  0, 2),
	"turn-sw": (0,  0, 3),
	"turn-w":  (0,  0, 4),
	"turn-nw": (0,  0, 5),
}
move_keys = set(("move-n", "move-ne", "move-e", "move-se", "move-s", "move-sw", "move-w", "move-nw", "turn-n", "turn-ne", "turn-e", "turn-se", "turn-s", "turn-sw", "turn-w", "turn-nw", "use-item"))
class GadgetRCCar(GadgetTrait):
	usable = True

	@property
	def in_use_by(self):
		return self.in_use_by_ref() if self.in_use_by_ref != None else None
	@in_use_by.setter
	def in_use_by(self, value):
		self.in_use_by_ref = weakref.ref(value) if value != None else None

	def on_init(self):
		self.in_use_by_ref = None
		self.keys_held = set()
		self.timer_going = False

	def stop_being_used(self):
		if self.in_use_by:
			self.tell(self.in_use_by, 'Stopped controlling')
			self.in_use_by.send("EXT", {'take_controls': {'id': self.gadget.protocol_id(), 'keys': []}})
			self.in_use_by = None
			self.keys_held.clear()
			self.timer_going = False

	def on_use(self, user):
		if self.in_use_by == None:
			if self.get_config('owner_only') and not user.has_permission(self.gadget):
				self.tell(user, 'Only the item\'s owner can use this')
				return True
			arg = {
				'id': self.gadget.protocol_id(),
				'keys':             list(move_keys),
				'pass_on':          False, # Don't allow keys to do their normal actions
				'key_up':           True, # Include key release events
			}
			user.send("EXT", {'take_controls': arg})
			self.in_use_by = user
		else:
			if self.in_use_by is user:
				self.stop_being_used()
			else:
				self.tell(user, 'Already in use by %s' % self.in_use_by.name_and_username())
		return True

	def apply_key(self, key):
		offset = key_to_offset.get(key)
		if offset != None:
			if self.gadget.map and not self.get_config('fly', False) and self.gadget.map.is_map() and self.gadget.map.map_data_loaded:
				try_x = self.gadget.x + offset[0]
				try_y = self.gadget.y + offset[1]
				if try_x >= 0 and try_y >= 0 and try_x < self.gadget.map.width and try_y < self.gadget.map.height:
					if get_tile_density(self.gadget.map.turfs[try_x][try_y]) or any((get_tile_density(o) for o in (self.gadget.map.objs[try_x][try_y] or []))):
						if self.gadget.dir != offset[2]:
							self.gadget.move_to(self.gadget.x, self.gadget.y, new_dir=offset[2])
							self.gadget.map.broadcast("MOV", {'id': self.gadget.protocol_id(), 'dir': self.gadget.dir}, remote_category=maplisten_type['move'])
						return True
			old_x = self.gadget.x
			old_y = self.gadget.y
			old_dir = self.gadget.dir
			self.gadget.move_to(self.gadget.x + offset[0], self.gadget.y + offset[1], new_dir=offset[2])
			if self.gadget.map and (self.gadget.x != old_x or self.gadget.y != old_y or self.gadget.dir != old_dir):
				self.gadget.map.broadcast("MOV", {'id': self.gadget.protocol_id(), 'from': [old_x, old_y], 'to': [self.gadget.x, self.gadget.y], 'dir': self.gadget.dir}, remote_category=maplisten_type['move'])
			return True

	def keep_moving(self):
		if self.in_use_by == None or not self.keys_held:
			self.timer_going = False
			return

		effective_keys_held = set(self.keys_held)
		if 'move-n' in self.keys_held and 'move-e' in self.keys_held:
			effective_keys_held.discard('move-n')
			effective_keys_held.discard('move-e')
			effective_keys_held.add('move-ne')
		if 'move-n' in self.keys_held and 'move-w' in self.keys_held:
			effective_keys_held.discard('move-n')
			effective_keys_held.discard('move-w')
			effective_keys_held.add('move-nw')
		if 'move-s' in self.keys_held and 'move-e' in self.keys_held:
			effective_keys_held.discard('move-s')
			effective_keys_held.discard('move-e')
			effective_keys_held.add('move-se')
		if 'move-s' in self.keys_held and 'move-w' in self.keys_held:
			effective_keys_held.discard('move-s')
			effective_keys_held.discard('move-w')
			effective_keys_held.add('move-sw')
		for k in effective_keys_held:
			self.apply_key(k)
		asyncio.get_event_loop().call_later(0.15, self.keep_moving)

	def on_key_press(self, user, key, down):
		if user is not self.in_use_by or key not in move_keys:
			return None
		if down:
			self.keys_held.add(key)
			if not self.timer_going:
				self.apply_key(key)
				if self.get_config('key_repeat', True):
					self.timer_going = True
					asyncio.get_event_loop().call_later(0.5, self.keep_moving)

			if key == "use-item":
				self.stop_being_used()
			return True
		else:
			self.keys_held.discard(key)

	def on_took_controls(self, user, arg):
		if user is self.in_use_by:
			if arg.get('keys') == []:
				self.stop_being_used()
		elif arg.get('keys') != []:
			user.send("EXT", {'take_controls': {'id': self.gadget.protocol_id(), 'keys': []}})
		return True

class GadgetScript(GadgetTrait):
	def send_scripting_message(self, message_type, other_id=0, status=0, data=None):
		send_scripting_message(message_type, user_id=self.gadget.owner_id, entity_id=self.gadget.db_id if self.gadget.db_id else -self.gadget.id, other_id=other_id, status=status, data=data)

	def send_scripting_values(self, message_type, other_id=0, values=None):
		self.send_scripting_message(message_type, other_id, status=len(values) if values != None else 0, data=encode_scripting_message_values(values) if values != None else None)

	def trigger_script_callback(self, type, values):
		self.send_scripting_values(VM_MessageType.CALLBACK, other_id=type, values=values)

	# .----------------------
	# | Event handlers
	# '----------------------
	def on_init(self):
		print("Script init")
		self.send_scripting_message(VM_MessageType.START_SCRIPT)

	def on_shutdown(self):
		self.send_scripting_message(VM_MessageType.STOP_SCRIPT)

	def on_use(self, user):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_USE]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_USE, [{
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_tell(self, user, text):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_PRIVATE_MESSAGE]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_PRIVATE_MESSAGE, [{
			"text":     text,
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_REQUEST_RECEIVED]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_REQUEST_RECEIVED, [{
			"type":     request_type,
			"accept_command": accept_command,
			"decline_command": decline_command,
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_key_press(self, user, key, down):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_KEY_PRESS]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_KEY_PRESS, [{
			"key":      key,
			"down":     down,
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_bot_message_button(self, user, arg):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_BOT_COMMAND_BUTTON]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_BOT_COMMAND_BUTTON, [{
			"text":     arg.get('text'),
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_took_controls(self, user, arg):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_TOOK_CONTROLS]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_TOOK_CONTROLS, [{
			"keys":     arg.get('keys'),
			"accept":   arg.get('accept'),
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_entity_click(self, user, arg):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_CLICK]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_CLICK, [{
			"x":        arg.get('x'),
			"y":        arg.get('y'),
			"button":   arg.get('button'),
			"target":   arg.get('target'),
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_map_switch(self):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_SWITCH_MAP]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_SWITCH_MAP, [{
			"id":       self.gadget.map.protocol_id() if self.gadget.map else None
		}])
		return None

	def on_join(self, user):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.MAP_JOIN]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.MAP_JOIN, [{
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_leave(self, user):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.MAP_LEAVE]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.MAP_LEAVE, [{
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

	def on_chat(self, user, text):
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.MAP_CHAT]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.MAP_CHAT, [{
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return None

gadget_trait_class = {}
gadget_trait_class['dice'] = GadgetDice
gadget_trait_class['accept_requests'] = GadgetAcceptRequests
gadget_trait_class['echo_tell'] = GadgetEchoTell
gadget_trait_class['bot_message_button'] = GadgetUseBotMessageButton
gadget_trait_class['random_tell'] = GadgetUseRandomTell
gadget_trait_class['random_say'] = GadgetUseRandomSay
gadget_trait_class['rc_car'] = GadgetRCCar
gadget_trait_class['script'] = GadgetScript
