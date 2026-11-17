# Copyright (c) 2026, nextash and contributors
# License: MIT

"""POS Opening Entry (shift) handling for Food POS.

One implementation for both the page and the API endpoints. A previous-day
shift is closed through the POS Closing Entry flow inside a savepoint. If that
close fails, nothing is changed and the error is raised; a new shift is never
opened on top of an unclosed one.
"""

import frappe
from frappe import _
from frappe.utils import flt, getdate, now_datetime


def _table_exists(table_name):
	return bool(
		frappe.db.sql(
			"SELECT COUNT(*) FROM information_schema.TABLES "
			"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
			(table_name,),
		)[0][0]
	)


def opening_doctype_installed():
	return frappe.db.exists("DocType", "POS Opening Entry") and _table_exists("tabPOS Opening Entry")


def open_entries_for_profile(pos_profile):
	"""Submitted POS Opening Entries for this profile that have not been closed."""
	return frappe.get_all(
		"POS Opening Entry",
		filters={"pos_profile": pos_profile, "docstatus": 1, "status": "Open"},
		fields=["name", "user", "period_start_date"],
		order_by="period_start_date desc",
	)


def normalise_balance_details(pos_profile, balance_details):
	"""Balance rows follow the profile's payment modes; amounts come from the caller."""
	if isinstance(balance_details, str):
		balance_details = frappe.parse_json(balance_details)
	balance_details = balance_details or []
	caller_amounts = {
		row.get("mode_of_payment"): flt(row.get("opening_amount", 0))
		for row in balance_details
		if row.get("mode_of_payment")
	}
	profile = frappe.get_cached_doc("POS Profile", pos_profile)
	rows = [
		{"mode_of_payment": p.mode_of_payment, "opening_amount": caller_amounts.get(p.mode_of_payment, 0)}
		for p in (profile.payments or [])
		if p.mode_of_payment
	]
	return rows or [{"mode_of_payment": "Cash", "opening_amount": 0}]


def close_stale_entry(entry_name):
	"""Close a previous-day shift via the POS Closing Entry flow, or raise."""
	from foodpos.foodpos.page.food_pos.food_pos import create_and_submit_pos_closing_entry

	savepoint = "close_stale_opening"
	frappe.db.savepoint(savepoint)
	try:
		entry = frappe.get_doc("POS Opening Entry", entry_name)
		create_and_submit_pos_closing_entry(
			pos_profile=entry.pos_profile,
			pos_opening_entry=entry_name,
			payments=[],
			closing_notes=_("Auto-closed stale shift from previous date."),
		)
	except Exception:
		frappe.db.rollback(save_point=savepoint)
		frappe.log_error(frappe.get_traceback(), f"Auto-close stale POS Opening Entry failed: {entry_name}")
		frappe.throw(
			_("The previous shift {0} could not be closed. Ask a manager to close it first.").format(entry_name)
		)


def open_shift(pos_profile, company, balance_details):
	"""Return today's open shift for the profile, or open a new one.

	A previous-day shift is closed first. The shift is opened for the session
	user, or for an unassigned profile user if the session user is busy on
	another profile.
	"""
	if not opening_doctype_installed():
		return {"name": None, "pos_profile": pos_profile, "company": company}

	balance_rows = normalise_balance_details(pos_profile, balance_details)

	for entry in open_entries_for_profile(pos_profile):
		if getdate(entry.period_start_date) == getdate():
			return frappe.get_doc("POS Opening Entry", entry.name).as_dict()
		close_stale_entry(entry.name)

	opening_user = frappe.session.user or "Administrator"
	if frappe.db.exists(
		"POS Opening Entry",
		{"user": opening_user, "status": "Open", "docstatus": 1, "pos_profile": ["!=", pos_profile]},
	):
		for candidate in frappe.get_all("POS Profile User", filters={"parent": pos_profile}, pluck="user"):
			if candidate != opening_user and not frappe.db.exists(
				"POS Opening Entry", {"user": candidate, "status": "Open", "docstatus": 1}
			):
				opening_user = candidate
				break

	opening = frappe.get_doc({
		"doctype": "POS Opening Entry",
		"period_start_date": now_datetime().replace(microsecond=0),
		"posting_date": getdate(),
		"user": opening_user,
		"pos_profile": pos_profile,
		"company": company,
	})
	opening.set("balance_details", balance_rows)
	opening.flags.ignore_permissions = True
	opening.insert()
	opening.submit()
	return opening.as_dict()
