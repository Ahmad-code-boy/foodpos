# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Patch v0.1.0 — Create FoodPOS Custom Fields on ERPNext DocTypes.

Creates:
  Sales Invoice  : custom_order_type, custom_table, custom_order_note
  POS Invoice    : same three fields (skipped if doctype table absent)
  Item           : custom_is_vegetarian, custom_is_vegan

Safe to re-run — each field is checked before creation.

Register in patches.txt under [post_model_sync]:
    foodpos.patches.v0_1_0.create_custom_fields
"""

import frappe


def execute():
	_create_invoice_fields("Sales Invoice")

	# POS Invoice is optional — only exists on sites using that mode
	if _table_exists("tabPOS Invoice"):
		_create_invoice_fields("POS Invoice")

	_create_item_fields()
	_create_pos_profile_fields()

	frappe.db.commit()


# ── Helpers ────────────────────────────────────────────────────────────────────


def _table_exists(table_name):
	"""Return True if a MariaDB table exists in the current schema."""
	result = frappe.db.sql(
		"SELECT COUNT(*) FROM information_schema.TABLES "
		"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %(t)s",
		{"t": table_name},
	)
	return bool(result and result[0][0])


def _field_exists(dt, fieldname):
	return frappe.db.exists("Custom Field", {"dt": dt, "fieldname": fieldname})


def _insert_field(field_def):
	"""Create a Custom Field if it doesn't already exist."""
	dt = field_def["dt"]
	fieldname = field_def["fieldname"]

	if _field_exists(dt, fieldname):
		return

	cf = frappe.get_doc({"doctype": "Custom Field", **field_def})
	cf.flags.ignore_permissions = True  # system-initiated patch
	cf.insert()


def _create_invoice_fields(dt):
	"""Add the three FoodPOS fields to an invoice doctype."""
	_insert_field({
		"dt": dt,
		"fieldname": "custom_order_type",
		"label": "Order Type",
		"fieldtype": "Select",
		"options": "Dine In\nTakeaway\nDelivery",
		"insert_after": "is_pos",
		"in_list_view": 0,
		"print_hide": 0,
	})

	_insert_field({
		"dt": dt,
		"fieldname": "custom_table",
		"label": "Table",
		"fieldtype": "Data",
		"insert_after": "custom_order_type",
		"print_hide": 0,
	})

	_insert_field({
		"dt": dt,
		"fieldname": "custom_order_note",
		"label": "Order Note",
		"fieldtype": "Small Text",
		"insert_after": "custom_table",
		"print_hide": 0,
	})

	_insert_field({
		"dt": dt,
		"fieldname": "custom_branch",
		"label": "Branch",
		"fieldtype": "Link",
		"options": "Branch",
		"insert_after": "pos_profile",
		"in_list_view": 1,
		"print_hide": 0,
	})

	_insert_field({
		"dt": dt,
		"fieldname": "custom_contact_phone",
		"label": "Contact Phone",
		"fieldtype": "Data",
		"insert_after": "custom_order_note",
		"print_hide": 0,
	})

	_insert_field({
		"dt": dt,
		"fieldname": "custom_delivery_address",
		"label": "Delivery Address",
		"fieldtype": "Small Text",
		"insert_after": "custom_contact_phone",
		"print_hide": 0,
	})

	_insert_field({
		"dt": dt,
		"fieldname": "custom_delivery_charges",
		"label": "Delivery Charges",
		"fieldtype": "Currency",
		"insert_after": "custom_delivery_address",
		"print_hide": 0,
	})


def _create_pos_profile_fields():
	"""Add branch field to POS Profile."""
	_insert_field({
		"dt": "POS Profile",
		"fieldname": "custom_branch",
		"label": "Branch",
		"fieldtype": "Link",
		"options": "Branch",
		"insert_after": "company",
		"in_list_view": 1,
		"reqd": 0,
	})


def _create_item_fields():
	"""Add optional dietary flag fields to Item."""
	_insert_field({
		"dt": "Item",
		"fieldname": "custom_is_vegetarian",
		"label": "Vegetarian",
		"fieldtype": "Check",
		"default": "0",
		"insert_after": "description",
		"in_list_view": 0,
	})

	_insert_field({
		"dt": "Item",
		"fieldname": "custom_is_vegan",
		"label": "Vegan",
		"fieldtype": "Check",
		"default": "0",
		"insert_after": "custom_is_vegetarian",
		"in_list_view": 0,
	})
