# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Unit tests for foodpos.foodpos.api.food_pos

Run with:
    bench --site {site_name} run-tests --app foodpos \
        --module foodpos.foodpos.api.test_food_pos
"""

import frappe
from frappe.tests.utils import FrappeTestCase


class TestFoodPosAPI(FrappeTestCase):
	# ── Item / Menu helpers ────────────────────────────────────────────────────

	def test_get_item_groups(self):
		"""TODO: Test get_item_groups"""
		pass

	def test_get_food_items(self):
		"""TODO: Test get_food_items"""
		pass

	# ── Payment methods ────────────────────────────────────────────────────────

	def test_get_payment_methods(self):
		"""TODO: Test get_payment_methods"""
		pass

	# ── Invoice creation ───────────────────────────────────────────────────────

	def test_create_pos_invoice(self):
		"""TODO: Test create_pos_invoice"""
		pass

	# ── Kitchen Order Ticket ───────────────────────────────────────────────────

	def test_create_kot(self):
		"""TODO: Test create_kot"""
		pass

	def test_get_kitchen_orders(self):
		"""TODO: Test get_kitchen_orders"""
		pass

	def test_update_kot_status(self):
		"""TODO: Test update_kot_status"""
		pass

	def test_toggle_kot_item_done(self):
		"""TODO: Test toggle_kot_item_done"""
		pass

	# ── Table management ───────────────────────────────────────────────────────

	def test_get_tables(self):
		"""TODO: Test get_tables"""
		pass

	def test_update_table_status(self):
		# Covered in depth by foodpos.foodpos.services.test_pos_services; this
		# checks the whitelisted endpoint the POS screens call.
		from foodpos.foodpos.api.food_pos import update_table_status

		from foodpos.foodpos.single_branch import SINGLE_BRANCH

		if not frappe.db.exists("Branch", SINGLE_BRANCH):
			frappe.get_doc({"doctype": "Branch", "branch": SINGLE_BRANCH}).insert(ignore_permissions=True)
		table = frappe.get_doc({
			"doctype": "Restaurant Table", "branch": SINGLE_BRANCH, "table_no": "API-TEST-T1",
			"section": "Test Floor", "capacity": 2, "status": "Available", "disabled": 0,
		})
		table.flags.ignore_permissions = True
		table.insert()

		self.assertTrue(update_table_status(table_name=table.name, status="Occupied")["success"])
		self.assertEqual(frappe.db.get_value("Restaurant Table", table.name, "status"), "Occupied")
		self.assertTrue(update_table_status(table_name=table.name, status="Available")["success"])
		self.assertEqual(frappe.db.get_value("Restaurant Table", table.name, "status"), "Available")

	def test_draft_tabs_workflow(self):
		from foodpos.foodpos.page.food_pos.food_pos import (
			save_draft_order,
			get_active_draft_tabs,
			discard_draft_order,
		)
		profiles = frappe.get_all("POS Profile", limit=1)
		if not profiles:
			return
		pos_profile = profiles[0].name
		items = frappe.get_all("Item", filters={"is_sales_item": 1}, limit=1)
		if not items:
			return
		item_code = items[0].name

		order_data = {
			"pos_profile": pos_profile,
			"order_type": "Dine In",
			"table": "Table 1" if frappe.db.exists("Restaurant Table", "Table 1") else "",
			"items": [{"item_code": item_code, "qty": 2, "rate": 10.0}],
		}

		# Cart state lives in the browser until checkout: saving a draft writes
		# nothing to the database and reports no draft document.
		before = frappe.db.count("POS Invoice")
		saved = save_draft_order(order_data)
		self.assertTrue(saved.get("success"))
		self.assertIsNone(saved.get("draft_invoice_name"))
		self.assertEqual(frappe.db.count("POS Invoice"), before)

		tabs = get_active_draft_tabs(pos_profile)
		self.assertIsInstance(tabs, list)

	# ── Opening entry & Shift Closing ──────────────────────────────────────────

	def test_check_opening_entry(self):
		from foodpos.foodpos.page.food_pos.food_pos import check_opening_entry
		res = check_opening_entry(user=frappe.session.user)
		self.assertIsInstance(res, list)

	def test_create_opening_voucher(self):
		from foodpos.foodpos.api.food_pos import create_opening_voucher
		self.assertTrue(callable(create_opening_voucher))

	def test_get_shift_closing_details(self):
		from foodpos.foodpos.api.food_pos import get_shift_closing_details
		self.assertTrue(callable(get_shift_closing_details))

	def test_create_and_submit_pos_closing_entry(self):
		from foodpos.foodpos.api.food_pos import create_and_submit_pos_closing_entry
		self.assertTrue(callable(create_and_submit_pos_closing_entry))

	# ── Dashboard / reports ────────────────────────────────────────────────────

	def test_get_today_summary(self):
		"""TODO: Test get_today_summary"""
		pass

	def test_get_top_items(self):
		"""TODO: Test get_top_items"""
		pass

	# ── POS Profile details ────────────────────────────────────────────────────

	def test_get_pos_profile_details(self):
		"""TODO: Test get_pos_profile_details"""
		pass

	# ── Void invoice ───────────────────────────────────────────────────────────

	def test_void_invoice(self):
		"""TODO: Test void_invoice"""
		pass

	# ── Hold / recall orders ───────────────────────────────────────────────────

	def test_hold_order(self):
		"""TODO: Test hold_order"""
		pass

	def test_get_held_orders(self):
		"""TODO: Test get_held_orders"""
		pass

	# ── Feature 1: Item Modifiers ──────────────────────────────────────────────

	def test_get_item_modifiers(self):
		"""TODO: Test get_item_modifiers"""
		pass

	# ── Feature 2: Split Billing ───────────────────────────────────────────────

	def test_create_split_invoices(self):
		"""TODO: Test create_split_invoices"""
		pass

	# ── Feature 3: Table Transfers & Merging ───────────────────────────────────

	def test_transfer_table_order(self):
		"""TODO: Test transfer_table_order"""
		pass

	def test_merge_tables(self):
		"""TODO: Test merge_tables"""
		pass

	def test_unmerge_tables(self):
		"""TODO: Test unmerge_tables"""
		pass

	def test_get_active_merge(self):
		"""TODO: Test get_active_merge"""
		pass
