# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Patch v7.2.0: make sure the Food POS Custom Fields exist.

Earlier releases tried to create these fields on the live request path, which
ran DDL inside POS requests and split their transactions. This patch creates
them once, during ``bench migrate``, for every site, including sites where the
v0.1.0 / v0.3.0 patches never ran.
"""

import frappe

INVOICE_FIELDS = (
	{"fieldname": "custom_order_type", "label": "Order Type", "fieldtype": "Select",
	 "options": "Walk In\nDine In\nTakeaway\nDelivery", "insert_after": "is_pos"},
	{"fieldname": "custom_table", "label": "Table", "fieldtype": "Data",
	 "insert_after": "custom_order_type"},
	{"fieldname": "custom_order_note", "label": "Order Note", "fieldtype": "Small Text",
	 "insert_after": "custom_table"},
)

DAY_TIME_FIELDS = (
	{"fieldname": "custom_fpos_day_start_time", "label": "Day Start Time",
	 "fieldtype": "Time", "insert_after": "period_start_date"},
	{"fieldname": "custom_fpos_day_end_time", "label": "Day End Time",
	 "fieldtype": "Time", "insert_after": "custom_fpos_day_start_time"},
)


def _ensure(dt, defs):
	for field_def in defs:
		if frappe.db.exists("Custom Field", {"dt": dt, "fieldname": field_def["fieldname"]}):
			continue
		cf = frappe.get_doc({"doctype": "Custom Field", "dt": dt, **field_def})
		cf.flags.ignore_permissions = True
		cf.insert()


def execute():
	for dt in ("Sales Invoice", "POS Invoice"):
		if frappe.db.exists("DocType", dt):
			_ensure(dt, INVOICE_FIELDS)
	if frappe.db.exists("DocType", "POS Opening Entry"):
		_ensure("POS Opening Entry", DAY_TIME_FIELDS)
