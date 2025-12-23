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
from .buildcommand import handle_user_command, send_private_message
from .buildscripting import send_scripting_message, encode_scripting_message_values, VM_MessageType, ScriptingValueType, ScriptingCallbackType

SCRIPT_DEBUG_PRINTS = False

move_keys = set(("move-n", "move-ne", "move-e", "move-se", "move-s", "move-sw", "move-w", "move-nw", "turn-n", "turn-ne", "turn-e", "turn-se", "turn-s", "turn-sw", "turn-w", "turn-nw", "use-item"))
take_controls_options = {
	"move": move_keys
}
directions = ((1,0), (1,1), (0,1), (-1,1), (-1,0), (-1,-1), (0,-1), (1,-1))

def become_clickable(gadget, t):
	if not gadget:
		return
	gadget.clickable = t
	if gadget.map:
		gadget.map.broadcast("WHO", {'update': {'id': gadget.protocol_id(), 'clickable': t}})

def set_and_update_who(gadget, entity_field, who_field, value):
	if not gadget:
		return
	setattr(gadget, entity_field, value)
	if gadget.map:
		gadget.map.broadcast("WHO", {'update': {'id': gadget.protocol_id(), who_field: value}})

class Gadget(Entity):
	def __init__(self, entity_type_gadget, creator_id=None, do_not_load_scripts=False):
		self.traits = []
		self.script_data = {}
		self.script_data_size = 0
		self.script_running = False
		self.do_not_load_scripts = do_not_load_scripts

		self.script_callback_enabled = [False] * ScriptingCallbackType.COUNT
		self.listening_to_chat = False
		self.listening_to_chat_warning = False
		self.map_watch_zones = []

		self.have_controls_for = weakref.WeakSet()
		self.want_controls_for = weakref.WeakSet()

		# Pending request that's waiting on someone to give permission
		self.want_controls_key_set = None
		self.want_controls_pass_on = None
		self.want_controls_key_up = None

		super().__init__(entity_type['gadget'], creator_id=creator_id)

		self.data = {} # Configuration

	def clean_up(self):
		self.release_all_controls()
		for trait in self.traits:
			try:
				trait.on_shutdown()
			except:
				pass
		super().clean_up()

	def reload_traits(self):
		self.release_all_controls()
		for trait in self.traits:
			try:
				trait.on_shutdown()
			except:
				pass
		self.traits = []
		for trait in self.data:
			trait_type = trait[0]
			trait_data = trait[1]
			if trait_type in gadget_trait_class:
				self.traits.append(gadget_trait_class[trait_type](self, trait_data))
		for trait in self.traits:
			try:
				trait.on_init()
			except:
				pass

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
		if self.script_data_size:
			data['script_data_size'] = self.script_data_size
		self.save_data_as_text(dumps_if_not_none(data))

	def stop_scripts(self):
		for trait in self.traits:
			if isinstance(trait, GadgetScript):
				trait.stop_script()

	def disable_scripts(self):
		for trait in self.traits:
			if isinstance(trait, GadgetScript):
				trait.set_config('enabled', False)

	# .----------------------
	# | Event handlers
	# '----------------------
	def receive_switch_map(self):
		for trait in self.traits:
			try:
				if trait.on_switch_map():
					return
			except:
				pass

	def receive_use(self, user):
		for trait in self.traits:
			try:
				if trait.on_use(user):
					return
			except:
				pass

	def receive_tell(self, user, text):
		for trait in self.traits:
			try:
				if trait.on_tell(user, text):
					return
			except:
				pass

	def receive_request(self, user, request_type, request_data, accept_command, decline_command):
		for trait in self.traits:
			try:
				if trait.on_request(user, request_type, request_data, accept_command, decline_command):
					return
			except:
				pass

	def receive_request_result(self, user, request_type, request_data, result):
		for trait in self.traits:
			try:
				if trait.on_request_result(user, request_type, request_data, result):
					return
			except:
				pass

	def receive_key_press(self, user, key, down):
		for trait in self.traits:
			try:
				if trait.on_key_press(user, key, down):
					return
			except:
				pass

	def receive_bot_message_button(self, user, arg):
		for trait in self.traits:
			try:
				if trait.on_bot_message_button(user, arg):
					return
			except:
				pass

	def receive_took_controls(self, user, arg):
		for trait in self.traits:
			try:
				if trait.on_took_controls(user, arg):
					return
			except:
				pass

	def receive_entity_click(self, user, arg):
		for trait in self.traits:
			try:
				if trait.on_entity_click(user, arg):
					return
			except:
				pass

	def receive_entity_drag(self, user, arg):
		for trait in self.traits:
			try:
				if trait.on_entity_drag(user, arg):
					return
			except:
				pass

	def receive_join(self, user):
		for trait in self.traits:
			try:
				if trait.on_entity_join(user):
					return
			except:
				pass

	def receive_leave(self, user):
		for trait in self.traits:
			try:
				if trait.on_entity_leave(user):
					return
			except:
				pass

	def receive_chat(self, user, text):
		for trait in self.traits:
			try:
				if trait.on_chat(user, text):
					return
			except:
				pass

	def receive_zone(self, user, fx, fy, tx, ty, dir, zone_index, callback):
		for trait in self.traits:
			try:
				if trait.on_zone(user, fx, fy, tx, ty, dir, zone_index, callback):
					return
			except:
				pass

	# .----------------------
	# | Miscellaneous
	# '----------------------
	def who(self):
		w = super().who()
		w['usable'] = any(_.usable for _ in self.traits)
		w['verbs'] = list(dict.fromkeys(sum((_.verbs for _ in self.traits), [])))
		return w

	def take_controls(self, client, key_set, pass_on=False, key_up=False):
		if key_set not in take_controls_options:
			return
		arg = {
			"id":      self.protocol_id(),
			"keys":    list(take_controls_options[key_set]),
			"pass_on": pass_on,
			"key_up":  key_up,
		}
		client.send("EXT", {"take_controls": arg})
		self.have_controls_for.add(client)
		self.want_controls_for.discard(client)

	def release_controls(self, client):
		if client in self.have_controls_for:
			arg = {
				"id":   self.protocol_id(),
				"keys": []
			}
			client.send("EXT", {"take_controls": arg})
			self.have_controls_for.discard(client)

	def release_all_controls(self):
		for client in self.have_controls_for:
			arg = {
				"id":   self.protocol_id(),
				"keys": []
			}
			client.send("EXT", {"take_controls": arg})
		self.have_controls_for.clear()
		self.want_controls_for.clear()

class GadgetTrait(object):
	usable = False
	verbs = []

	@property
	def gadget(self):
		return self.gadget_ref() if self.gadget_ref != None else None
	@gadget.setter
	def gadget(self, value):
		self.gadget_ref = weakref.ref(value) if value != None else None

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
		context = {
			'client': user,
			'actor': self.gadget,
			'script_entity': self.gadget
		}
		send_private_message(self.gadget, context, user.protocol_id(), text, lenient_rate_limit=user.db_id == self.gadget.owner_id)

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

	def on_request_result(self, user, request_type, request_data, result):
		return None

	def on_key_press(self, user, key, down):
		return None

	def on_bot_message_button(self, user, arg):
		return None

	def on_took_controls(self, user, arg):
		return None

	def on_entity_click(self, user, arg):
		return None

	def on_entity_drag(self, user, arg):
		return None

	def on_switch_map(self):
		return None

	def on_entity_join(self, user):
		return None

	def on_entity_leave(self, user):
		return None

	def on_chat(self, user, text):
		return None

	def on_zone(user, fx, fy, tx, ty, dir, zone_index, callback):
		return None

class GadgetDice(GadgetTrait):
	usable = True

	def on_use(self, user):
		handle_user_command(user.map, user, None, "roll %d %d" % (self.get_config('dice', 2), self.get_config('sides', 6)))
		return True

class GadgetAcceptRequests(GadgetTrait):
	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		request_types = self.get_config("types")
		if (request_types and request_type not in request_types) or (self.get_config("owner_only") and not user.has_permission(self.gadget)):
			return None
		handle_user_command(self.gadget.map, self.gadget, None, '%s %s %s' % (accept_command, user.protocol_id(), request_type))
		return True

class GadgetDeclineRequests(GadgetTrait):
	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		handle_user_command(self.gadget.map, self.gadget, None, decline_command)
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
			handle_user_command(self.gadget.map, self.gadget, None, "say %s" % (text), respond_to=user)
		elif isinstance(text, list):
			handle_user_command(self.gadget.map, self.gadget, None, "say %s" % (random.choice(text)), respond_to=user)
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
			'username': user.username_or_id(),
			"gadget_id": self.gadget.protocol_id(),
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
	"turn-n":  (0,  0, 6),
	"turn-ne": (0,  0, 7),
	"turn-e":  (0,  0, 0),
	"turn-se": (0,  0, 1),
	"turn-s":  (0,  0, 2),
	"turn-sw": (0,  0, 3),
	"turn-w":  (0,  0, 4),
	"turn-nw": (0,  0, 5),
}

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
			self.gadget.release_controls(self.in_use_by)
			self.in_use_by = None
			self.keys_held.clear()
			self.timer_going = False

	def on_use(self, user):
		if self.in_use_by == None:
			if self.get_config('owner_only') and not user.has_permission(self.gadget):
				self.tell(user, 'Only the item\'s owner can use this')
				return True
			self.gadget.take_controls(user, "move", pass_on=False, key_up=True)
			self.in_use_by = user
		else:
			if self.in_use_by is user:
				self.stop_being_used()
			else:
				self.tell(user, 'Already in use by %s' % self.in_use_by.name_and_username())
		return True

	def apply_key(self, key):
		if self.gadget == None:
			return False
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
		if self.gadget == None:
			return
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

	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		if self.get_config("give_rides") and request_type == "carryme":
			handle_user_command(self.gadget.map, self.gadget, None, '%s %s %s' % (accept_command, user.protocol_id(), request_type))
			return True
		return None


class GadgetPushable(GadgetTrait):
	def on_shutdown(self):
		if not self.gadget:
			return
		self.gadget.map_watch_zones = []

	def on_init(self):
		self.set_zone()
	def on_switch_map(self):
		self.set_zone()

	def set_zone(self):
		if not self.gadget:
			return
		if self.gadget.map == None or not hasattr(self.gadget.map, "width"):
			self.gadget.map_watch_zones = []
		else:
			self.gadget.map_watch_zones = [(0, 0, self.gadget.map.width, self.gadget.map.height)]

	def on_zone(self, user, fx, fy, tx, ty, dir, zone_index, callback):
		if not self.gadget:
			return None
		if callback != GlobalData['ScriptingCallbackType'].MAP_ZONE_MOVE:
			return None
		if tx == self.gadget.x and ty == self.gadget.y:
			new_x = tx + (tx - fx)
			new_y = ty + (ty - fy)

			if self.gadget.map and (new_x < 0 or new_y < 0 or new_x >= self.gadget.map.width or new_y >= self.gadget.map.height):
				new_x = fx
				new_y = fy
			elif self.gadget.map and not self.get_config('fly', False) and self.gadget.map.is_map() and self.gadget.map.map_data_loaded:
				if get_tile_density(self.gadget.map.turfs[new_x][new_y]) or any((get_tile_density(o) for o in (self.gadget.map.objs[new_x][new_y] or []))):
					new_x = fx
					new_y = fy
			self.gadget.move_to(new_x, new_y)
			self.gadget.map.broadcast("MOV", {'id': self.gadget.protocol_id(), 'from': [tx, ty], 'to': [new_x, new_y]}, remote_category=maplisten_type['move'])
		return True

class GadgetDraggable(GadgetTrait):
	def on_init(self):
		if not self.gadget:
			return None
		become_clickable(self.gadget, 'map_drag')

	def on_shutdown(self):
		if not self.gadget:
			return
		become_clickable(self.gadget, False)		

	def on_entity_drag(self, user, arg):
		if not self.gadget or not self.gadget.map:
			return None
		if (not self.get_config("owner_only", False) or user.has_permission(self.gadget)) and (arg["map_x"] != self.gadget.x or arg["map_y"] != self.gadget.y) and arg["map_x"] >= 0 and arg["map_y"] >= 0 and arg["map_x"] < self.gadget.map.width and arg["map_y"] < self.gadget.map.height:
			self.gadget.move_to(arg["map_x"], arg["map_y"])
			self.gadget.map.broadcast("MOV", {'id': self.gadget.protocol_id(), 'to': [self.gadget.x, self.gadget.y]}, remote_category=maplisten_type['move'])

class GadgetMiniTilemap(GadgetTrait):
	def on_init(self):
		if not self.gadget:
			return None
		tileset_url = self.get_config("tileset_url", None)
		tile_size = self.get_config("tile_size", [4,6])
		offset = self.get_config("offset", [0,0])
		if not tileset_url:
			tileset_url = Config["Server"]["ResourceIMGBase"] + "font/tomthumb.png"
		if not tileset_url.startswith("https://") and not tileset_url.startswith("http://"):
			tileset_url = Config["Server"]["ResourceIMGBase"] + "mini_tilemap/" + tileset_url

		map_width = 1
		map_height = 1
		map_data = [0]
		text = self.get_config("text", "")[:256]
		if text:
			lines = text.split("\n")
			map_height = len(lines)
			map_width = max(len(_) for _ in lines)
			map_data = []
			for line in lines:
				for char in line:
					c = ord(char) - 0x20
					map_data.append(((c&0xF0) << 2) | (c & 0x0F))
				map_data.extend([0] * (map_width - len(line)))
		else:
			single = self.get_config("single", "")
			if single:
				map_data = [single[0] | (single[1]<<6)]

		mini_tilemap = GlobalData['who_mini_tilemap']({
			"map_size": [map_width, map_height],
			"tile_size": tile_size,
			"offset": offset,
			"transparent_tile": -1,
			"tileset_url": tileset_url,
		}, max_pixel_width=128)
		mini_tilemap_data = GlobalData['who_mini_tilemap_data']({
			"data": map_data
		})
		self.gadget.mini_tilemap = mini_tilemap;
		self.gadget.mini_tilemap_data = mini_tilemap_data;
		if self.gadget.map:
			self.gadget.map.broadcast("WHO", {"update": {"id": self.gadget.protocol_id(), "mini_tilemap": mini_tilemap, "mini_tilemap_data": mini_tilemap_data}})

	def on_shutdown(self):
		if not self.gadget:
			return
		self.gadget.mini_tilemap      = None
		self.gadget.mini_tilemap_data = None
		if self.gadget.map:
			self.gadget.map.broadcast("WHO", {'update': {'id': self.gadget.protocol_id(), 'mini_tilemap': None, 'mini_tilemap_data': None}})

class GadgetUserParticle(GadgetTrait):
	usable = True

	def on_use(self, user):
		if not self.gadget:
			return None
		if self.get_config('owner_only') and not user.has_permission(self.gadget):
			return False
		actor = self.gadget if self.gadget.map is user.map else user
		handle_user_command(actor.map, actor, None, "userparticle " + self.get_config('particle', '0 0 0'))
		return False

class GadgetDoodleBoard(GadgetTrait):
	def on_init(self):
		if not self.gadget:
			return None

class GadgetPicCycle(GadgetTrait):
	usable = True

	def on_init(self):
		self.current_frame  = self.get_config('index', 0)
		self.length         = self.get_config('length', 1)
		self.pic            = self.get_config('first_pic', [0,0,0])
		if not pic_is_okay(self.pic):
			self.pic = [0,0,0]
		if not self.gadget:
			return None
		set_and_update_who(self.gadget, 'pic', 'pic', [self.pic[0], self.pic[1]+self.current_frame, self.pic[2]])

	def on_use(self, user):
		if not self.gadget:
			return None
		if self.get_config('owner_only') and not user.has_permission(self.gadget):
			return True
		if self.get_config('random', False):
			self.current_frame = random.randint(0, self.length-1)
		else:
			self.current_frame += 1

		if self.current_frame >= self.length:
			if self.get_config('destroy_on_end', False):
				self.gadget.clean_up()
				return False
			else:
				self.current_frame = 0
		self.set_config('index', self.current_frame)
		set_and_update_who(self.gadget, 'pic', 'pic', [self.pic[0], self.pic[1]+self.current_frame, self.pic[2]])
		return False

class GadgetProjectileShooter(GadgetTrait):
	usable = True

	def on_init(self):
		self.projectile_count = 0

	def on_use(self, user):
		if not self.gadget or self.projectile_count >= 5:
			return None

		# Is the starting position a wall? If so, don't even make the projectile
		start_position = self.gadget if self.gadget.map is user.map else user
		dir = min(7, max(0, self.get_config('dir', user.dir)))
		offset_x, offset_y = directions[dir]
		try_x = start_position.x+offset_x
		try_y = start_position.y+offset_y
		if self.get_config('break_wall_hit', False) and try_x >= 0 and try_y >= 0 and start_position.map and try_x < start_position.map.width and try_y < start_position.map.height:
			if get_tile_density(start_position.map.turfs[try_x][try_y]) or any((get_tile_density(o) for o in (start_position.map.objs[try_x][try_y] or []))):
				return

		# Create the projectile entity and set it up
		projectile = Entity(entity_type['generic'])
		projectile.temporary = True
		projectile.allow = permission['all']
		projectile.deny = 0
		projectile.guest_deny = 0
		projectile.owner_id = self.gadget.owner_id
		projectile.creator_temp_id = self.gadget.creator_temp_id
		projectile.dir = dir
		projectile._distance = 0
		pic = self.get_config('pic')
		if pic_is_okay(pic):
			projectile.pic = pic

		if not projectile.switch_map(user.map, new_pos=[try_x, try_y]):
			projectile.clean_up()
			return
		self.projectile_count += 1
		asyncio.get_event_loop().call_later(0.15, self.projectile_fly, projectile)

	def projectile_fly(self, projectile):
		if self.gadget == None:
			self.projectile_count = max(0, self.projectile_count-1)
			return

		offset_x, offset_y = directions[projectile.dir]
		try_x = projectile.x + offset_x
		try_y = projectile.y + offset_y
		break_now = False
		do_break_animation = True

		# Time to destroy particle?
		projectile._distance += 1
		if projectile._distance >= min(50, self.get_config('max_distance', 50)):
			break_now = True
			do_break_animation = self.get_config('break_max_distance', False)
		elif projectile.map and projectile.map.is_map() and projectile.map.map_data_loaded:
			if try_x >= 0 and try_y >= 0 and try_x < projectile.map.width and try_y < projectile.map.height:
				if self.get_config('break_wall_hit', False):
					if get_tile_density(projectile.map.turfs[try_x][try_y]) or any((get_tile_density(o) for o in (projectile.map.objs[try_x][try_y] or []))):
						break_now = True
			else:
				break_now = True
		# Can destroy when hitting a user too, if configured to do that
		if not break_now and self.get_config('break_user_hit', False):
			for entity in projectile.map.contents:
				if entity is projectile or not entity.is_client():
					continue
				if entity.x == try_x and entity.y == try_y:
					break_now = True
					break

		# Destroy projectile if needed
		if break_now:
			self.projectile_count = max(0, self.projectile_count-1)
			if do_break_animation and self.get_config('break_particle'):
				handle_user_command(projectile.map, self.gadget, None, "userparticle %s at=%d,%d" % (self.get_config('break_particle'), projectile.x, projectile.y))
			projectile.clean_up()
			return

		old_x = projectile.x
		old_y = projectile.y
		projectile.move_to(try_x, try_y)
		if projectile.map:
			projectile.map.broadcast("MOV", {'id': projectile.protocol_id(), 'from': [old_x, old_y], 'to': [try_x, try_y]}) # Don't set remote category to avoid spamming

		asyncio.get_event_loop().call_later(0.15, self.projectile_fly, projectile)

class GadgetScript(GadgetTrait):
	def __init__(self, gadget, config):
		super().__init__(gadget, config)
		if self.get_config("usable"):
			self.usable = True

	def send_scripting_message(self, message_type, other_id=0, status=0, data=None):
		send_scripting_message(message_type, user_id=self.gadget.owner_id, entity_id=self.gadget.db_id if self.gadget.db_id else -self.gadget.id, other_id=other_id, status=status, data=data)

	def send_scripting_values(self, message_type, other_id=0, values=None):
		self.send_scripting_message(message_type, other_id, status=len(values) if values != None else 0, data=encode_scripting_message_values(values) if values != None else None)

	def trigger_script_callback(self, type, values):
		self.send_scripting_values(VM_MessageType.CALLBACK, other_id=type, values=values)

	def start_script(self):
		if self.gadget == None or self.gadget.script_running or self.gadget.do_not_load_scripts:
			return False
		if not self.get_config('enabled', True):
			return False
		# Check if user is even allowed to run scripts
		owner = AllEntitiesByDB.get(self.gadget.owner_id)
		if owner and owner.is_client() and owner.connection_attr("disable_scripts"):
			return False
		if owner:
			user_flags = owner.connection_attr("user_flags") or 0
			if (user_flags & userflag['scripter']) == 0:
				owner.send("ERR", {'text': 'You don\'t have permission to use server-side scripting'})
				return False
		else:
			c = Database.cursor()
			c.execute('SELECT flags FROM User WHERE entity_id=?', (self.gadget.owner_id,))
			result = c.fetchone()
			if result == None or (result[0] & userflag['scripter']) == 0:
				return False

		# Reset script status
		self.gadget.script_callback_enabled = [False] * ScriptingCallbackType.COUNT
		self.gadget.listening_to_chat = False
		self.gadget.map_watch_zones = []

		# OK there's nothing preventing the script from running
		if SCRIPT_DEBUG_PRINTS:
			print("Calling start_script() %s" % self.gadget.protocol_id())
		self.gadget.script_running = True
		self.send_scripting_message(VM_MessageType.START_SCRIPT)
		item_id = self.get_config('code_item', None)
		if item_id:
			code = text_from_text_item(item_id)
		else:
			code = self.get_config('code', None)
		if code:
			self.send_scripting_message(VM_MessageType.RUN_CODE, data=code.encode())
		return True

	def stop_script(self):
		if self.gadget == None or not self.gadget.script_running:
			return False
		if SCRIPT_DEBUG_PRINTS:
			print("Calling stop_script() %s" % self.gadget.protocol_id())
		self.gadget.script_running = False
		self.send_scripting_message(VM_MessageType.STOP_SCRIPT)
		return True

	# .----------------------
	# | Event handlers
	# '----------------------
	def on_shutdown(self):
		if SCRIPT_DEBUG_PRINTS:
			print("Script shutdown %s" % self.gadget.protocol_id())
		self.stop_script()

	def on_use(self, user, ignore_enable=False):
		if not self.gadget:
			return None
		if not ignore_enable and not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_USE]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_USE, [{
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return True

	def on_tell(self, user, text):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_PRIVATE_MESSAGE]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_PRIVATE_MESSAGE, [{
			"text":     text,
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return True

	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		if not self.gadget:
			return None
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
		return True

	def on_request_result(self, user, request_type, request_data, result):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_REQUEST_RESULT]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_REQUEST_RESULT, [{
			"type":     request_type,
			"result":   result,
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return True

	def on_key_press(self, user, key, down):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_KEY_PRESS]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_KEY_PRESS, [{
			"key":      key,
			"down":     down,
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return True

	def on_bot_message_button(self, user, arg):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_BOT_COMMAND_BUTTON]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_BOT_COMMAND_BUTTON, [{
			"text":     arg.get('text'),
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id(),
			"rc_id":     arg.get('rc_id'),
			"gadget_id": arg.get('gadget_id'),
		}])
		return True

	def on_took_controls(self, user, arg):
		if not self.gadget:
			return None
		if arg.get('keys') == []:
			self.gadget.have_controls_for.discard(user)
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_TOOK_CONTROLS]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_TOOK_CONTROLS, [{
			"keys":     arg.get('keys'),
			"accept":   arg.get('accept'),
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id()
		}])
		return True

	def on_entity_click(self, user, arg, ignore_enable=False):
		if not self.gadget:
			return None
		if not ignore_enable and not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_CLICK]:
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
		return True

	def on_switch_map(self):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.SELF_SWITCH_MAP]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.SELF_SWITCH_MAP, [{
			"id":       self.gadget.map.protocol_id() if self.gadget.map else None
		}])
		return True

	def on_entity_join(self, user):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.MAP_JOIN]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.MAP_JOIN, [{
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id(),
			"in_user_list": user.is_client(),
		}])
		return True

	def on_entity_leave(self, user):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.MAP_LEAVE]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.MAP_LEAVE, [{
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id(),
			"in_user_list": user.is_client(),
		}])
		return True

	def on_chat(self, user, text):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[ScriptingCallbackType.MAP_CHAT]:
			return None
		self.trigger_script_callback(ScriptingCallbackType.MAP_CHAT, [{
			"text":     text,
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id(),
			"in_user_list": user.is_client(),
		}])
		return True

	def on_zone(self, user, fx, fy, tx, ty, dir, zone_index, callback):
		if not self.gadget:
			return None
		if not self.gadget.script_callback_enabled[callback]:
			return None
		self.trigger_script_callback(callback, [{
			"id":       user.protocol_id(),
			"name":     user.name,
			"username": user.username_or_id(),
			"in_user_list": user.is_client(),
			"from_x":   fx,
			"from_y":   fy,
			"x":        tx,
			"y":        ty,
			"dir":      dir,
			"zone":     zone_index+1,
		}])
		return True

class GadgetAutoScript(GadgetScript):
	def on_init(self):
		self.start_script()

class GadgetManualScript(GadgetScript):
	usable = True

	def on_entity_leave(self, user):
		if not self.gadget:
			return None
		if self.gadget.map and self.gadget.map.is_map():
			if self.gadget.map.count_users_inside() == 0:
				self.stop_script()
		return super().on_entity_leave(user)

	def on_entity_click(self, user, arg):
		self.start_script()
		super().on_entity_click(user, arg, ignore_enable=True)
		return True

	def on_use(self, user):
		self.start_script()
		super().on_use(user, ignore_enable=True)
		return True

	def on_switch_map(self):
		self.stop_script()
		return super().on_switch_map()

class GadgetMapScript(GadgetScript):
	def on_init(self):
		if not self.gadget:
			return None
		if not self.gadget.script_running and self.gadget.map and self.gadget.map.is_map() and self.gadget.map.count_users_inside():
			self.start_script()

	def on_entity_join(self, user):
		if not self.gadget:
			return None
		if self.gadget.map and self.gadget.map.is_map():
			if self.gadget.map.count_users_inside() != 0:
				self.start_script()
		return super().on_entity_join(user)

	def on_entity_leave(self, user):
		if not self.gadget:
			return None
		if self.gadget.map and self.gadget.map.is_map():
			if self.gadget.map.count_users_inside() == 0:
				self.stop_script()
		return super().on_entity_leave(user)

	def on_switch_map(self):
		if not self.gadget:
			return None
		if self.gadget.map and self.gadget.map.is_map():
			if self.gadget.map.count_users_inside():
				self.start_script()
			else:
				self.stop_script()
		else:
			self.stop_script()
		return super().on_switch_map()

gadget_trait_class = {}
gadget_trait_class['dice'] = GadgetDice
gadget_trait_class['accept_requests'] = GadgetAcceptRequests
gadget_trait_class['echo_tell'] = GadgetEchoTell
gadget_trait_class['bot_message_button'] = GadgetUseBotMessageButton
gadget_trait_class['random_tell'] = GadgetUseRandomTell
gadget_trait_class['random_say'] = GadgetUseRandomSay
gadget_trait_class['rc_car'] = GadgetRCCar
gadget_trait_class['pushable'] = GadgetPushable
gadget_trait_class['draggable'] = GadgetDraggable
gadget_trait_class['mini_tilemap'] = GadgetMiniTilemap
gadget_trait_class['user_particle'] = GadgetUserParticle
gadget_trait_class['doodle_board'] = GadgetDoodleBoard
gadget_trait_class['pic_cycle'] = GadgetPicCycle
gadget_trait_class['projectile_shooter'] = GadgetProjectileShooter

gadget_trait_class['auto_script'] = GadgetAutoScript
gadget_trait_class['use_script'] = GadgetManualScript
gadget_trait_class['map_script'] = GadgetMapScript

GlobalData["gadget_class"] = Gadget
