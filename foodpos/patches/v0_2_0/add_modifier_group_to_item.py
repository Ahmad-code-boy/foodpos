# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Patch v0.2.0 — Add Item Modifier Group custom fields.

Creates on Item:
  custom_modifier_group  Link → Food Item Modifier Group

Safe to re-run — checks existence before creation.

Register in patches.txt under [post_model_sync]:
    foodpos.patches.v0_2_0.add_modifier_group_to_item
"""

import frappe


def execute():
	_insert_field({
		"dt": "Item",
		"fieldname": "custom_modifier_group",
		"label": "Modifier Group",
		"fieldtype": "Link",
		"options": "Food Item Modifier Group",
		"insert_after": "custom_is_vegan",
		"in_list_view": 0,
		"description": "Attach a modifier group (e.g. cooking level, add-ons) to this item. "
		               "The FoodPOS will prompt cashiers to select modifiers when adding this item.",
	})

	frappe.db.commit()


# ── Helpers (duplicated from v0_1_0 patch for patch-file independence) ─────────


def _field_exists(dt, fieldname):
	return frappe.db.exists("Custom Field", {"dt": dt, "fieldname": fieldname})


def _insert_field(field_def):
	dt = field_def["dt"]
	fieldname = field_def["fieldname"]

	if _field_exists(dt, fieldname):
		return  # idempotent — skip if already present

	cf = frappe.get_doc({"doctype": "Custom Field", **field_def})
	cf.flags.ignore_permissions = True  # system-initiated patch
	cf.insert()
