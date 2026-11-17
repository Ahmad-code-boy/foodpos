# Copyright (c) 2026, nextash and contributors
# License: MIT

import frappe
from frappe.utils import add_days, cint, getdate

from foodpos.foodpos.services.tables import set_table_fields


def on_pos_invoice_submit(doc, method=None):
	"""
	When a POS invoice is submitted (paid), free its table through the table
	service so every POS screen is updated. The invoice is already committed to
	the ledger, so a failure here is logged and not raised; the savepoint keeps
	a failed table write from leaving a partial change.
	"""
	if not cint(getattr(doc, "is_pos", 0)):
		return

	table = getattr(doc, "custom_table", None)
	if not table or not frappe.db.exists("Restaurant Table", table):
		return

	savepoint = "pos_invoice_free_table"
	frappe.db.savepoint(savepoint)
	try:
		set_table_fields(
			table,
			{"status": "Available", "order_id": None, "occupied_since": None},
			ignore_permissions=True,
		)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
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
			savepoint = "auto_cancel_orphan_kot"
			frappe.db.savepoint(savepoint)
			try:
				# Cancel through the document so validate() runs.
				doc = frappe.get_doc("Food KOT", kot)
				doc.status = "Cancelled"
				doc.flags.ignore_permissions = True
				doc.save()
			except Exception:
				frappe.db.rollback(save_point=savepoint)
				frappe.log_error(frappe.get_traceback(), f"FoodPOS: failed to cancel orphan KOT {kot}")

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
