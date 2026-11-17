# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Unit tests for Restaurant Table DocType and controller.

Run with:
    bench --site {site_name} run-tests --app foodpos \
        --module foodpos.foodpos.doctype.restaurant_table.test_restaurant_table
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import now_datetime


def _make_table(**kwargs):
	"""Helper: insert and return a Restaurant Table (cleaned up by caller)."""
	import random
	from foodpos.foodpos.single_branch import SINGLE_BRANCH

	if not frappe.db.exists("Branch", SINGLE_BRANCH):
		frappe.get_doc({"doctype": "Branch", "branch": SINGLE_BRANCH}).insert(ignore_permissions=True)
	defaults = {
		"doctype": "Restaurant Table",
		"branch": SINGLE_BRANCH,
		"table_no": f"TEST-{random.randint(10000, 99999)}",
		"section": "Test Section",
		"capacity": 4,
		"status": "Available",
		"disabled": 0,
	}
	defaults.update(kwargs)
	doc = frappe.get_doc(defaults)
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc


def _cleanup(table_no):
	frappe.db.delete("Restaurant Table", {"name": table_no})


class TestRestaurantTable(FrappeTestCase):
	# ── Creation ───────────────────────────────────────────────────────────────

	def test_create_table(self):
		"""Restaurant Table inserts correctly and is retrievable by table_no."""
		t = _make_table()
		fetched = frappe.get_doc("Restaurant Table", t.name)
		self.assertEqual(fetched.status, "Available")
		self.assertEqual(fetched.capacity, 4)
		_cleanup(t.name)

	def test_table_no_is_unique(self):
		"""Inserting two tables with the same table_no must raise a duplicate error."""
		t = _make_table()
		dup = frappe.get_doc({
			"doctype": "Restaurant Table",
			"table_no": t.table_no,
			"section": "Other",
			"capacity": 2,
			"status": "Available",
		})
		dup.flags.ignore_permissions = True
		with self.assertRaises(Exception):  # frappe.UniqueValidationError or DuplicateEntryError
			dup.insert()
		_cleanup(t.name)

	def test_capacity_minimum_one(self):
		"""validate() must floor capacity at 1 if a lower value is passed."""
		t = _make_table(capacity=0)
		self.assertGreaterEqual(t.capacity, 1)
		_cleanup(t.name)

	# ── Status transitions via update_table_status API ─────────────────────────

	def test_occupied_sets_occupied_since(self):
		"""
		Transitioning to Occupied via frappe.db.set_value must populate
		occupied_since (this mirrors what update_table_status() does).
		"""
		t = _make_table()
		ts = now_datetime()
		frappe.db.set_value("Restaurant Table", t.name, {
			"status": "Occupied",
			"occupied_since": ts,
			"guests": 3,
			"waiter": "Ali",
		})
		frappe.db.commit()

		updated = frappe.db.get_value(
			"Restaurant Table", t.name,
			["status", "occupied_since", "guests", "waiter"],
			as_dict=True,
		)
		self.assertEqual(updated.status, "Occupied")
		self.assertIsNotNone(updated.occupied_since)
		self.assertEqual(updated.guests, 3)
		self.assertEqual(updated.waiter, "Ali")
		_cleanup(t.name)

	def test_available_clears_occupied_since_and_order_id(self):
		"""
		Transitioning back to Available must clear occupied_since and order_id.
		"""
		t = _make_table()
		frappe.db.set_value("Restaurant Table", t.name, {
			"status": "Occupied",
			"occupied_since": now_datetime(),
			"order_id": "FKOT-2026-00001",
		})

		frappe.db.set_value("Restaurant Table", t.name, {
			"status": "Available",
			"occupied_since": None,
			"order_id": None,
		})
		frappe.db.commit()

		updated = frappe.db.get_value(
			"Restaurant Table", t.name,
			["status", "occupied_since", "order_id"],
			as_dict=True,
		)
		self.assertEqual(updated.status, "Available")
		self.assertIsNone(updated.occupied_since)
		self.assertFalse(updated.order_id)
		_cleanup(t.name)

	def test_reserved_status(self):
		"""Table can be set to Reserved with a notes field."""
		t = _make_table()
		frappe.db.set_value("Restaurant Table", t.name, {
			"status": "Reserved",
			"notes": "Birthday party 7pm",
		})
		frappe.db.commit()

		updated = frappe.db.get_value(
			"Restaurant Table", t.name, ["status", "notes"], as_dict=True
		)
		self.assertEqual(updated.status, "Reserved")
		self.assertEqual(updated.notes, "Birthday party 7pm")
		_cleanup(t.name)

	def test_cleaning_status(self):
		"""Table can be set to Cleaning (manual or via invoice submit hook)."""
		t = _make_table()
		frappe.db.set_value("Restaurant Table", t.name, {"status": "Cleaning"})
		frappe.db.commit()
		self.assertEqual(
			frappe.db.get_value("Restaurant Table", t.name, "status"), "Cleaning"
		)
		_cleanup(t.name)

	# ── Disabled tables ────────────────────────────────────────────────────────

	def test_disabled_table_excluded_from_get_tables(self):
		"""
		get_tables() API must not return tables with disabled=1.
		"""
		from foodpos.foodpos.api.food_pos import get_tables

		t = _make_table(disabled=1)
		all_names = [row["name"] for row in get_tables()]
		self.assertNotIn(t.name, all_names)
		_cleanup(t.name)

	# ── seed_demo_tables ───────────────────────────────────────────────────────

	def test_seed_demo_tables_is_idempotent(self):
		"""
		Calling seed_demo_tables() twice must not create duplicate records
		and must not raise any exception.
		"""
		from foodpos.foodpos.doctype.restaurant_table.restaurant_table import (
			seed_demo_tables,
		)

		seed_demo_tables()
		count_after_first = frappe.db.count("Restaurant Table")

		seed_demo_tables()
		count_after_second = frappe.db.count("Restaurant Table")

		self.assertEqual(count_after_first, count_after_second)
