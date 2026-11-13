# Copyright (c) 2026, nextash and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document


class FoodItemModifierGroup(Document):
	def validate(self):
		if not self.modifiers:
			frappe.throw(_("Modifier Group '{0}' must have at least one modifier option.").format(self.group_name))

		# For Single selection, max must be 1
		if self.selection_type == "Single":
			self.max_selections = 1

		# min cannot exceed max
		if self.min_selections and self.max_selections:
			if self.min_selections > self.max_selections:
				frappe.throw(
					_("Min Selections ({0}) cannot be greater than Max Selections ({1}).").format(
						self.min_selections, self.max_selections
					)
				)
