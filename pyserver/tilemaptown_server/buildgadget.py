# Tilemap Town
# Copyright (C) 2017-2024 NovaSquirrel
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

import random
from .buildglobal import *
from .buildentity import Entity, save_generic_data, load_generic_data
from .buildcommand import handle_user_command

class Gadget(Entity):
	def __init__(self, entity_type_gadget, creator_id=None):
		super().__init__(entity_type['gadget'], creator_id=creator_id)

		self.traits = []
		self.data = {} # Configuration

	def reload_traits(self):
		self.traits = []
		for trait in data:
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
			self.reload_traits()
			return True
		except:
			return False

	def save_data(self):
		data = {}
		save_generic_data(self, data)
		data['data'] = self.data
		self.save_data_as_text(dumps_if_not_none(data))

	# .----------------------
	# | Event handlers
	# '----------------------

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

	# .----------------------
	# | Miscellaneous
	# '----------------------
	def who(self):
		w = super().who()
		w['usable'] = any(_.is_usable for _ in self.traits)
		w['verbs'] = list(dict.fromkeys(sum((_.verbs for _ in self.traits), [])))
		return w

class GadgetTrait(object):
	usable = False
	verbs = []

	def __init__(self, gadget, config):
		self.gadget = gadget
		self.config = config

	def get_config(field, default):
		return self.config.get(field, default)

	def set_config(field, value):
		if self.config.get(field) != value:
			self.config[field] = value
			self.gadget.save_on_clean_up = True

	def del_config(field):
		if field in self.config:
			del self.config[field]
			self.gadget.save_on_clean_up = True

	# .----------------------
	# | Event handlers
	# '----------------------
	def on_init(self):
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

class GadgetDice(GadgetTrait):
	def on_use(self, user):
		handle_user_command(user.map, user, user, None, "roll %d %d" % (self.get_config('dice', 2), self.get_config('sides', 6)))
		return True

class GadgetAcceptRequests(GadgetTrait):
	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		request_types = self.get_config("types")
		if (request_types and request_type not in request_types) or (self.get_config("owner_only") and not user.has_permission(self.gadget)):
			return None
		handle_user_command(self.gadget.map, self.gadget, self.gadget, None, accept_command)
		return True

class GadgetDeclineRequests(GadgetTrait):
	def on_request(self, user, request_type, request_data, accept_command, decline_command):
		handle_user_command(self.gadget.map, self.gadget, self.gadget, None, decline_command)
		return True

class GadgetEchoTell(GadgetTrait):
	def on_tell(self, user, text):
		handle_user_command(sef.gadget.map, self.gadget, self.gadget, None, "tell %s %s" % (user.protocol_id(), text))
		return True

class GadgetRCCar(GadgetTrait):
	pass

class GadgetCardsDeck(GadgetTrait):
	pass

class GadgetPushable(GadgetTrait):
	pass

class GadgetBlasterGun(GadgetTrait):
	pass

class GadgetBlasterProjectile(GadgetTrait):
	pass

gadget_trait_class = {}
gadget_trait_class['dice'] = GadgetDice
gadget_trait_class['accept_request'] = GadgetAcceptRequests
gadget_trait_class['echo_tell'] = GadgetEchoTell
