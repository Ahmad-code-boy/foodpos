# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Kitchen ticket printing: one ticket per item, retries, printer errors.

Run with:
    bench --site {site_name} run-tests --app foodpos \
        --module foodpos.foodpos.services.test_kitchen_print
"""

from unittest import mock

import frappe
from frappe.tests.utils import FrappeTestCase

from foodpos.foodpos.page.food_pos import food_pos as page
from foodpos.foodpos.services import kitchen_print as kp

PROFILE = "Food POS UI"
PRINTER = "FPOS-TEST-KITCHEN"


def _ensure_item(code):
	if not frappe.db.exists("Item", code):
		frappe.get_doc({
			"doctype": "Item", "item_code": code, "item_name": code, "item_group": "All Item Groups",
			"stock_uom": "Nos", "is_stock_item": 0, "is_sales_item": 1,
		}).insert(ignore_permissions=True)


class TestKitchenPrint(FrappeTestCase):
	def setUp(self):
		super().setUp()
		_ensure_item("SMOKE-PIZZA")
		_ensure_item("SMOKE-COLA")
		if not frappe.db.exists("Network Printer Settings", PRINTER):
			frappe.get_doc({
				"doctype": "Network Printer Settings", "name": PRINTER,
				"server_ip": "127.0.0.1", "port": 631, "printer_name": "KitchenTest",
			}).insert(ignore_permissions=True)
		frappe.db.set_value("POS Profile", PROFILE, "custom_fpos_kitchen_printer", PRINTER)

	def _order(self, items=None, order_id=None):
		return {
			"order_type": "Takeaway", "table": "", "pos_profile": PROFILE,
			"order_id": order_id,
			"items": items or [{"item_code": "SMOKE-PIZZA", "item_name": "SMOKE-PIZZA", "qty": 2}],
		}

	def _run_after_commit(self, sender=None):
		"""Run the after-commit callbacks (the printer call and status save) without committing."""
		with mock.patch.object(frappe.db, "commit"):
			frappe.db.after_commit.run()

	def _row_states(self, kot_name):
		return frappe.get_all("Food KOT Item", filters={"parent": kot_name}, pluck="kitchen_print_state")

	def test_order_is_printed_exactly_once(self):
		kot = page.create_kot(self._order())["kot_name"]
		with mock.patch.object(kp, "send_ticket") as sender:
			self._run_after_commit()
			self.assertEqual(sender.call_count, 1)
			self.assertIn(b"SMOKE-PIZZA", sender.call_args[0][2])
		self.assertEqual(self._row_states(kot), ["Printed"])

	def test_repeated_confirm_does_not_print_again(self):
		first = page.create_kot(self._order())
		kot = first["kot_name"]
		with mock.patch.object(kp, "send_ticket") as sender:
			self._run_after_commit()
			# Double-tap / retried request for the same cart (same order_id): reuses the KOT, adds nothing.
			page.create_kot(self._order(order_id=first["order_id"]))
			self._run_after_commit()
			self.assertEqual(sender.call_count, 1)
		self.assertEqual(self._row_states(kot), ["Printed"])

	def test_items_added_to_the_same_order_print_only_the_new_items(self):
		first = page.create_kot(self._order())
		kot = first["kot_name"]
		with mock.patch.object(kp, "send_ticket") as sender:
			self._run_after_commit()
			page.create_kot(self._order(
				items=[{"item_code": "SMOKE-PIZZA", "item_name": "SMOKE-PIZZA", "qty": 2},
					{"item_code": "SMOKE-COLA", "item_name": "SMOKE-COLA", "qty": 1}],
				order_id=first["order_id"]))
			self._run_after_commit()
			self.assertEqual(sender.call_count, 2)
			second_ticket = sender.call_args[0][2]
			self.assertIn(b"SMOKE-COLA", second_ticket)
			self.assertNotIn(b"SMOKE-PIZZA", second_ticket)
		# Pizza and cola route to different stations, so the order has two KOTs.
		kots = frappe.get_all("Food KOT", filters={"order_id": first["order_id"]}, pluck="name")
		states = [st for k in kots for st in self._row_states(k)]
		self.assertEqual(sorted(states), ["Printed", "Printed"])

	def test_printer_error_leaves_items_pending_and_records_the_error(self):
		kot = page.create_kot(self._order())["kot_name"]
		with mock.patch.object(kp, "send_ticket", side_effect=kp.KitchenPrintError("printer offline")):
			self._run_after_commit()
		self.assertEqual(self._row_states(kot), ["Pending"])
		self.assertEqual(frappe.db.get_value("Food KOT", kot, "kitchen_print_error"), "printer offline")

	def test_retry_prints_only_what_is_still_pending(self):
		kot = page.create_kot(self._order())["kot_name"]
		with mock.patch.object(kp, "send_ticket", side_effect=kp.KitchenPrintError("printer offline")):
			self._run_after_commit()
		with mock.patch.object(kp, "send_ticket") as sender, mock.patch.object(frappe.db, "commit"):
			result = page.retry_kitchen_print(kot)
			self.assertEqual(sender.call_count, 1)
		self.assertEqual(result["status"], "Printed")
		self.assertEqual(self._row_states(kot), ["Printed"])
		self.assertFalse(frappe.db.get_value("Food KOT", kot, "kitchen_print_error"))

	def test_retry_after_success_prints_nothing(self):
		kot = page.create_kot(self._order())["kot_name"]
		with mock.patch.object(kp, "send_ticket"):
			self._run_after_commit()
		with mock.patch.object(kp, "send_ticket") as sender, mock.patch.object(frappe.db, "commit"):
			result = page.retry_kitchen_print(kot)
			self.assertEqual(sender.call_count, 0)
		self.assertEqual(result["printed_rows"], 0)

	def test_missing_printer_is_reported_not_silent(self):
		kot = page.create_kot(self._order())["kot_name"]
		frappe.db.set_value("POS Profile", PROFILE, "custom_fpos_kitchen_printer", None)
		with mock.patch.object(kp, "send_ticket") as sender:
			self._run_after_commit()
			sender.assert_not_called()
		self.assertIn("No kitchen printer", frappe.db.get_value("Food KOT", kot, "kitchen_print_error"))
		self.assertEqual(self._row_states(kot), ["Pending"])

	def test_ticket_is_plain_ascii_with_cut(self):
		kot = page.create_kot(self._order([
			{"item_code": "SMOKE-PIZZA", "item_name": "Pizza – Spicy", "qty": 1, "item_note": "no onion ✓"},
		]))["kot_name"]
		rows = frappe.get_all("Food KOT Item", filters={"parent": kot},
			fields=["name", "parent", "item_code", "item_name", "qty", "item_note"])
		data = kp.build_ticket(kot, rows)
		data.decode("ascii")  # raises if not ASCII
		self.assertTrue(data.startswith(b"\x1b\x40"))
		self.assertIn(b"\x1d\x56\x42\x00", data)
		self.assertIn(b"NOTE: no onion", data)

	def test_only_a_manager_can_choose_the_kitchen_printer(self):
		email = "pos.printer.test@example.invalid"
		if not frappe.db.exists("User", email):
			frappe.get_doc({"doctype": "User", "email": email, "first_name": "Test",
				"send_welcome_email": 0, "enabled": 1, "roles": [{"role": "Food POS User"}]}).insert(ignore_permissions=True)
		frappe.set_user(email)
		try:
			with self.assertRaises(frappe.PermissionError):
				page.set_kitchen_printer(PROFILE, PRINTER)
		finally:
			frappe.set_user("Administrator")


class TestDiscountRules(FrappeTestCase):
	"""Discounts need no PIN; the server still checks the range."""

	def test_valid_percentage_and_amount_pass(self):
		page._validate_discount(10, 0, 1000)
		page._validate_discount(0, 250, 1000)
		page._validate_discount(100, 0, 1000)

	def test_percentage_out_of_range_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			page._validate_discount(101, 0, 1000)
		with self.assertRaises(frappe.ValidationError):
			page._validate_discount(-5, 0, 1000)

	def test_amount_above_the_order_total_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			page._validate_discount(0, 1500, 1000)
		with self.assertRaises(frappe.ValidationError):
			page._validate_discount(0, -1, 1000)

	def test_no_pin_gate_remains_in_the_settle_path(self):
		import inspect
		src = inspect.getsource(page)
		self.assertNotIn("_require_fresh_discount_pin", src)
		self.assertNotIn('action_type="discount"', src)

	def test_discount_audit_row_is_written_with_a_valid_action_type(self):
		doc = frappe._dict({"doctype": "Sales Invoice", "pos_profile": PROFILE, "get": lambda k, d=None: d})
		page._audit_discount(doc, 5, 0)
		row = frappe.get_all("Food POS Audit Log", filters={"action_type": "Discount Override"},
			fields=["details"], order_by="creation desc", limit=1)
		self.assertTrue(row)
		self.assertIn("5%", row[0].details)


class TestKitchenPrintStatus(FrappeTestCase):
	def test_status_reports_only_tickets_that_failed(self):
		from foodpos.foodpos.page.food_pos.food_pos import get_kitchen_print_status
		kot = page.create_kot(TestKitchenPrint._order(self))["kot_name"]
		frappe.db.set_value("Food KOT", kot, "kitchen_print_error", "printer offline", update_modified=False)
		result = get_kitchen_print_status([kot])
		self.assertEqual(result["failed"], [{"kot": kot, "error": "printer offline"}])
		frappe.db.set_value("Food KOT", kot, "kitchen_print_error", None, update_modified=False)
		self.assertEqual(get_kitchen_print_status([kot])["failed"], [])
