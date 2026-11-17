# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Tests for the Food POS service layer and the endpoints that call it.

Run with:
    bench --site {site_name} run-tests --app foodpos \
        --module foodpos.foodpos.services.test_pos_services
"""

import frappe
from frappe.tests.utils import FrappeTestCase

from foodpos.foodpos.doctype.food_kot.food_kot import check_status_change
from foodpos.foodpos.api import food_pos as api
from foodpos.foodpos.services.tables import set_table_status
from foodpos.foodpos.single_branch import SINGLE_BRANCH


def _make_table(table_no, status="Available"):
	if not frappe.db.exists("Branch", SINGLE_BRANCH):
		frappe.get_doc({"doctype": "Branch", "branch": SINGLE_BRANCH}).insert(ignore_permissions=True)
	doc = frappe.get_doc({
		"doctype": "Restaurant Table",
		"branch": SINGLE_BRANCH,
		"table_no": f"{table_no}-{frappe.generate_hash(length=5)}",
		"section": "Test Floor",
		"capacity": 4,
		"status": status,
		"disabled": 0,
	})
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc.name


def _make_user(email, roles):
	if frappe.db.exists("User", email):
		return email
	user = frappe.get_doc({
		"doctype": "User",
		"email": email,
		"first_name": "Test",
		"send_welcome_email": 0,
		"enabled": 1,
		"roles": [{"role": r} for r in roles],
	})
	user.flags.ignore_permissions = True
	user.insert()
	return email


class TestTableStatus(FrappeTestCase):
	def setUp(self):
		super().setUp()
		self.table = _make_table("TST-T1")

	def test_endpoint_accepts_the_ui_payload_and_persists(self):
		res = api.update_table_status(
			table_name=self.table, status="Reserved", guests=2,
			customer_name="Walk", mobile="0300", notes="window",
		)
		self.assertTrue(res["success"])
		row = frappe.db.get_value(
			"Restaurant Table", self.table,
			["status", "guests", "reservation_name", "mobile", "notes"], as_dict=True,
		)
		self.assertEqual(row.status, "Reserved")
		self.assertEqual(row.guests, 2)
		self.assertEqual(row.reservation_name, "Walk")
		self.assertEqual(row.mobile, "0300")

	def test_explicit_null_clears_a_field(self):
		api.update_table_status(table_name=self.table, status="Occupied", order_id="SO-1")
		self.assertEqual(frappe.db.get_value("Restaurant Table", self.table, "order_id"), "SO-1")

		api.update_table_status(table_name=self.table, status="Cleaning", order_id=None, waiter=None)
		row = frappe.db.get_value("Restaurant Table", self.table, ["status", "order_id", "occupied_since"], as_dict=True)
		self.assertEqual(row.status, "Cleaning")
		self.assertFalse(row.order_id)
		self.assertFalse(row.occupied_since)

	def test_occupied_sets_a_start_time(self):
		api.update_table_status(table_name=self.table, status="Occupied")
		self.assertTrue(frappe.db.get_value("Restaurant Table", self.table, "occupied_since"))

	def test_invalid_status_raises_instead_of_reporting_success(self):
		with self.assertRaises(frappe.ValidationError):
			api.update_table_status(table_name=self.table, status="Bogus")

	def test_unknown_table_raises(self):
		with self.assertRaises(frappe.ValidationError):
			set_table_status("TST-DOES-NOT-EXIST", "Available")

	def test_legacy_free_alias_maps_to_available(self):
		set_table_status(self.table, "Occupied")
		set_table_status(self.table, "Free")
		self.assertEqual(frappe.db.get_value("Restaurant Table", self.table, "status"), "Available")

	def test_transfer_moves_the_order_to_an_available_table(self):
		dest = _make_table("TST-T2")
		api.update_table_status(table_name=self.table, status="Occupied", order_id="SO-9", guests=3)

		res = api.transfer_table_order(self.table, dest)

		self.assertTrue(res["success"])
		d = frappe.db.get_value("Restaurant Table", dest, ["status", "order_id", "guests"], as_dict=True)
		s = frappe.db.get_value("Restaurant Table", self.table, ["status", "order_id"], as_dict=True)
		self.assertEqual((d.status, d.order_id, d.guests), ("Occupied", "SO-9", 3))
		self.assertEqual((s.status, s.order_id), ("Cleaning", None))

	def test_transfer_to_an_occupied_table_is_refused(self):
		dest = _make_table("TST-T3", status="Occupied")
		api.update_table_status(table_name=self.table, status="Occupied", order_id="SO-2")
		with self.assertRaises(frappe.ValidationError):
			api.transfer_table_order(self.table, dest)


class TestRoleGates(FrappeTestCase):
	def setUp(self):
		super().setUp()
		self.table = _make_table("TST-G1")
		self.pos_user = _make_user("pos.cashier.test@example.invalid", ["Food POS User"])
		self.plain_user = _make_user("plain.user.test@example.invalid", ["Stock User"])

	def tearDown(self):
		frappe.set_user("Administrator")
		super().tearDown()

	def test_non_pos_user_cannot_change_a_table(self):
		frappe.set_user(self.plain_user)
		with self.assertRaises(frappe.PermissionError):
			api.update_table_status(table_name=self.table, status="Occupied")
		self.assertEqual(frappe.db.get_value("Restaurant Table", self.table, "status"), "Available")

	def test_pos_user_can_change_a_table(self):
		frappe.set_user(self.pos_user)
		self.assertTrue(api.update_table_status(table_name=self.table, status="Occupied")["success"])

	def test_pos_user_cannot_void_an_invoice(self):
		frappe.set_user(self.pos_user)
		with self.assertRaises(frappe.PermissionError):
			api.void_invoice("SINV-DOES-NOT-EXIST")

	def test_pos_user_cannot_settle_unpaid_invoices(self):
		frappe.set_user(self.pos_user)
		from foodpos.foodpos.page.food_pos.food_pos import settle_unpaid_pos_invoices
		with self.assertRaises(frappe.PermissionError):
			settle_unpaid_pos_invoices()

	def test_pos_user_can_list_unpaid_invoices(self):
		frappe.set_user(self.pos_user)
		from foodpos.foodpos.page.food_pos.food_pos import get_unpaid_pos_invoices
		self.assertIsInstance(get_unpaid_pos_invoices(), list)


class TestKotRules(FrappeTestCase):
	def test_cancelled_is_terminal(self):
		with self.assertRaises(frappe.ValidationError):
			check_status_change("Cancelled", "Pending", "FKOT-X")

	def test_served_cannot_go_back_to_pending(self):
		with self.assertRaises(frappe.ValidationError):
			check_status_change("Served", "Pending", "FKOT-X")

	def test_held_can_be_recalled_to_pending(self):
		check_status_change("Held", "Pending", "FKOT-X")

	def test_forward_moves_are_allowed(self):
		check_status_change("Pending", "In Progress", "FKOT-X")
		check_status_change("Ready", "Served", "FKOT-X")
		check_status_change("Pending", "Cancelled", "FKOT-X")


class TestHoldOrder(FrappeTestCase):
	def test_malformed_item_raises_instead_of_reporting_success(self):
		with self.assertRaises(Exception):
			api.hold_order({"table": "", "items": [{"qty": 1}]})
