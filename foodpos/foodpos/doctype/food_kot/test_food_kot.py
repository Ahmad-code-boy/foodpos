# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Unit tests for Food KOT DocType and controller.

Run with:
    bench --site {site_name} run-tests --app foodpos --module foodpos.foodpos.doctype.food_kot.test_food_kot
"""

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import now_datetime, nowdate


def _make_kot(**kwargs):
	"""Helper: build and return a Food KOT document (not saved)."""
	defaults = {
		"doctype": "Food KOT",
		"order_type": "Dine In",
		"table": "T1",
		"items": [
			{
				"item_code": "_Test Item",
				"item_name": "_Test Item",
				"qty": 2,
				"item_note": "",
				"is_done": 0,
			}
		],
	}
	defaults.update(kwargs)
	return frappe.get_doc(defaults)


class TestFoodKOT(FrappeTestCase):
	# ── Creation ───────────────────────────────────────────────────────────────

	def test_create_kot(self):
		"""KOT saves successfully and is assigned an FKOT-YYYY-##### name."""
		kot = _make_kot()
		kot.insert(ignore_permissions=True)
		self.assertTrue(kot.name.startswith("FKOT-"))
		frappe.db.delete("Food KOT", {"name": kot.name})

	def test_new_kot_status_forced_to_pending(self):
		"""before_insert must override any supplied status with Pending."""
		kot = _make_kot(status="Ready")
		kot.insert(ignore_permissions=True)
		self.assertEqual(kot.status, "Pending")
		frappe.db.delete("Food KOT", {"name": kot.name})

	# ── Validation — items ─────────────────────────────────────────────────────

	def test_validate_requires_at_least_one_item(self):
		"""KOT with an empty items table must raise a ValidationError."""
		kot = _make_kot(items=[])
		with self.assertRaises(frappe.ValidationError):
			kot.insert(ignore_permissions=True)

	def test_validate_item_qty_must_be_positive(self):
		"""KOT item with qty=0 must raise a ValidationError."""
		kot = _make_kot(
			items=[{"item_code": "_Test Item", "item_name": "_Test Item", "qty": 0}]
		)
		with self.assertRaises(frappe.ValidationError):
			kot.insert(ignore_permissions=True)

	def test_validate_item_code_required(self):
		"""KOT item missing item_code must raise a ValidationError."""
		kot = _make_kot(
			items=[{"item_code": "", "item_name": "Ghost", "qty": 1}]
		)
		with self.assertRaises(frappe.ValidationError):
			kot.insert(ignore_permissions=True)

	# ── Status transitions ─────────────────────────────────────────────────────

	def test_kot_status_transition_forward(self):
		"""KOT status can advance Pending → In Progress → Ready → Served."""
		kot = _make_kot()
		kot.insert(ignore_permissions=True)

		for next_status in ("In Progress", "Ready", "Served"):
			kot.status = next_status
			kot.save(ignore_permissions=True)
			self.assertEqual(kot.reload().status, next_status)

		frappe.db.delete("Food KOT", {"name": kot.name})

	def test_kot_status_backward_transition_blocked(self):
		"""Advancing to Ready then trying to go back to Pending must raise ValidationError."""
		kot = _make_kot()
		kot.insert(ignore_permissions=True)
		kot.status = "Ready"
		kot.save(ignore_permissions=True)

		kot.reload()
		kot.status = "Pending"
		with self.assertRaises(frappe.ValidationError):
			kot.save(ignore_permissions=True)

		frappe.db.delete("Food KOT", {"name": kot.name})

	def test_cancelled_kot_is_terminal(self):
		"""Updating a Cancelled KOT must raise a ValidationError."""
		kot = _make_kot()
		kot.insert(ignore_permissions=True)
		kot.status = "Cancelled"
		kot.save(ignore_permissions=True)

		kot.reload()
		kot.status = "Pending"
		with self.assertRaises(frappe.ValidationError):
			kot.save(ignore_permissions=True)

		frappe.db.delete("Food KOT", {"name": kot.name})

	def test_held_to_pending_is_allowed(self):
		"""Held → Pending (order recall) must be a permitted backward move."""
		kot = _make_kot()
		kot.insert(ignore_permissions=True)
		kot.status = "Held"
		kot.save(ignore_permissions=True)

		kot.reload()
		kot.status = "Pending"
		kot.save(ignore_permissions=True)  # must not raise
		self.assertEqual(kot.reload().status, "Pending")

		frappe.db.delete("Food KOT", {"name": kot.name})

	# ── Auto-advance to Ready ──────────────────────────────────────────────────

	def test_auto_advance_to_ready_when_all_items_done(self):
		"""
		When all items are marked is_done=1 and status is In Progress,
		validate() must automatically set status to Ready.
		"""
		kot = _make_kot()
		kot.insert(ignore_permissions=True)
		kot.status = "In Progress"
		kot.save(ignore_permissions=True)

		kot.reload()
		for item in kot.items:
			item.is_done = 1
		kot.save(ignore_permissions=True)

		self.assertEqual(kot.reload().status, "Ready")
		frappe.db.delete("Food KOT", {"name": kot.name})

	def test_no_auto_advance_when_not_all_items_done(self):
		"""
		When only some items are done, status must remain In Progress.
		"""
		kot = _make_kot(
			items=[
				{"item_code": "_Test Item", "item_name": "_Test Item", "qty": 1, "is_done": 1},
				{"item_code": "_Test Item", "item_name": "_Test Item", "qty": 1, "is_done": 0},
			]
		)
		kot.insert(ignore_permissions=True)
		kot.status = "In Progress"
		kot.save(ignore_permissions=True)

		self.assertEqual(kot.reload().status, "In Progress")
		frappe.db.delete("Food KOT", {"name": kot.name})

	# ── Order types ────────────────────────────────────────────────────────────

	def test_takeaway_kot_has_no_table(self):
		"""Takeaway orders should save with table left blank."""
		kot = _make_kot(order_type="Takeaway", table="")
		kot.insert(ignore_permissions=True)
		self.assertEqual(kot.order_type, "Takeaway")
		self.assertFalse(kot.table)
		frappe.db.delete("Food KOT", {"name": kot.name})
