# Copyright (c) 2026, nextash and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class RestaurantTable(Document):
	# ── Lifecycle hooks ────────────────────────────────────────────────────────

	def validate(self):
		if self.capacity and self.capacity < 1:
			self.capacity = 1

	def on_update(self):
		pass


# ── Development helper ─────────────────────────────────────────────────────────


def seed_demo_tables():
	"""
	Idempotent: create demo Restaurant Tables if none exist yet.
	Safe to call multiple times — skips tables that already exist.

	Usage:
	    bench --site {site} execute foodpos.foodpos.doctype.restaurant_table.restaurant_table.seed_demo_tables
	"""
	_TABLES = [
		# Main Floor — 6 tables
		{"table_no": "T01", "section": "Main Floor", "capacity": 4},
		{"table_no": "T02", "section": "Main Floor", "capacity": 4},
		{"table_no": "T03", "section": "Main Floor", "capacity": 2},
		{"table_no": "T04", "section": "Main Floor", "capacity": 6},
		{"table_no": "T05", "section": "Main Floor", "capacity": 4},
		{"table_no": "T06", "section": "Main Floor", "capacity": 8},
		# Terrace — 4 tables
		{"table_no": "TR01", "section": "Terrace", "capacity": 2},
		{"table_no": "TR02", "section": "Terrace", "capacity": 4},
		{"table_no": "TR03", "section": "Terrace", "capacity": 4},
		{"table_no": "TR04", "section": "Terrace", "capacity": 6},
		# Bar — 2 tables
		{"table_no": "B01", "section": "Bar", "capacity": 2},
		{"table_no": "B02", "section": "Bar", "capacity": 2},
	]

	created = 0
	skipped = 0

	for t in _TABLES:
		if frappe.db.exists("Restaurant Table", t["table_no"]):
			skipped += 1
			continue

		doc = frappe.get_doc({
			"doctype": "Restaurant Table",
			"table_no": t["table_no"],
			"section": t["section"],
			"capacity": t["capacity"],
			"status": "Available",
			"disabled": 0,
		})
		doc.flags.ignore_permissions = True  # system-initiated seed, not a user action
		doc.insert()
		created += 1

	frappe.db.commit()
	print(f"seed_demo_tables: {created} created, {skipped} already existed.")
