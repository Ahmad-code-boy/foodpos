# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Patch v7.3.1: Vegetarian / Vegan flags on Item, used by the POS menu badges and filter."""

import frappe

FIELDS = (
	{"fieldname": "custom_is_vegetarian", "label": "Vegetarian", "fieldtype": "Check", "insert_after": "item_group"},
	{"fieldname": "custom_is_vegan", "label": "Vegan", "fieldtype": "Check", "insert_after": "custom_is_vegetarian"},
)


def execute():
	for field in FIELDS:
		if not frappe.db.exists("Custom Field", {"dt": "Item", "fieldname": field["fieldname"]}):
			cf = frappe.get_doc({"doctype": "Custom Field", "dt": "Item", **field})
			cf.flags.ignore_permissions = True
			cf.insert()
