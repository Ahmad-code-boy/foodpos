# Copyright (c) 2026, nextash and contributors
# License: MIT

import frappe
from frappe import _
from frappe.utils import add_days, cint, get_datetime, getdate, now_datetime


def on_pos_invoice_submit(doc, method=None):
	"""
	When a POS Invoice (is_pos=1) is submitted upon payment completion,
	automatically revert the linked table status back to Available/Free
	and broadcast a realtime event to sync all connected POS terminals.
	"""
	# Only act on POS sales
	if not cint(getattr(doc, "is_pos", 0)):
		return

	table = getattr(doc, "custom_table", None)
	if not table:
		return

	try:
		if frappe.db.exists("Restaurant Table", table):
			frappe.db.set_value(
				"Restaurant Table",
				table,
				{
					"status":         "Available",
					"order_id":       None,
					"occupied_since": None,
				},
			)

			# Publish realtime event to all connected POS clients
			frappe.publish_realtime(
				"fpos_table_status_changed",
				{
					"table": table,
					"status": "Available",
					"order_id": None,
				},
			)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "FoodPOS: on_pos_invoice_submit hook error")


def auto_clear_served_kots():
	"""
	Hourly scheduled task (Round 23 fix: ARCHIVE, never delete).

	  1. Served / Cancelled KOTs older than 1 day are now KEPT. The old code
	     deleted them, destroying the records the exception report and any
	     KOT -> invoice investigation depend on (including the Round 23
	     mis-link evidence). They are only counted and logged here. If the
	     business ever needs old KOTs purged, that must be a manual,
	     manager-approved archive step, not an hourly job.
	  2. Auto-cancel orphan KOTs (Pending / In Progress / Ready) that have been
	     sitting untouched for more than 24 hours — these represent orders that
	     were never completed and would otherwise clutter the kitchen display
	     indefinitely. Cancelling keeps the audit trail (the record stays).
	"""
	try:
		cutoff = add_days(getdate(), -1)

		# ── 1. Served / Cancelled KOTs older than 1 day: KEEP (archive) ──────
		# Round 23 fix: do NOT delete. Count only, for the log line below.
		stale_done = frappe.get_all(
			"Food KOT",
			filters={"status": ["in", ["Served", "Cancelled"]], "creation": ["<", cutoff]},
			pluck="name",
		)

		# ── 2. Cancel orphan active KOTs older than 24 hours ─────────────────
		# These are orders that were sent to the kitchen but never resolved.
		# Mark them Cancelled instead of deleting so there is an audit trail.
		orphan_kots = frappe.get_all(
			"Food KOT",
			filters={"status": ["in", ["Pending", "In Progress", "Ready"]], "creation": ["<", cutoff]},
			pluck="name",
		)
		for kot in orphan_kots:
			try:
				# Round 23 fix: cancel through the document (validate() runs)
				# instead of db.set_value, which bypasses all guards.
				doc = frappe.get_doc("Food KOT", kot)
				doc.status = "Cancelled"
				doc.flags.ignore_permissions = True
				doc.save()
			except Exception:
				frappe.log_error(frappe.get_traceback(), f"FoodPOS: failed to cancel orphan KOT {kot}")

		if stale_done or orphan_kots:
			frappe.db.commit()

		if stale_done or orphan_kots:
			frappe.logger().info(
				f"FoodPOS auto_clear_served_kots: kept {len(stale_done)} stale Served/Cancelled KOTs (archive, not deleted), "
				f"cancelled {len(orphan_kots)} orphan KOTs."
			)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "FoodPOS: auto_clear_served_kots error")


def has_app_permission():
	"""Permission check for the apps screen entry."""
	# Works whether POS Invoice exists or not
	return (
		frappe.has_permission("Sales Invoice", "read")
		or frappe.has_permission("Sales Order", "read")
	)
