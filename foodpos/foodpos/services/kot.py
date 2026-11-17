# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Food KOT changes for Food POS.

Draft KOTs are saved through their controller, so validation and the audit
hook run. A submitted KOT (Served) only accepts fields marked allow_on_submit,
so it is updated with db_set and the audit entry is written here.
"""

import frappe
from frappe import _
from frappe.utils import now_datetime

from foodpos.foodpos.doctype.food_kot.food_kot import check_status_change


def update_kot(kot_name, fields):
	"""Apply `fields` to a Food KOT, enforcing permissions and status rules."""
	doc = frappe.get_doc("Food KOT", kot_name)
	doc.check_permission("write")
	old_status = doc.status

	if doc.docstatus == 0:
		doc.update(fields)
		doc.save()
		return doc

	new_status = fields.get("status")
	if new_status is not None and new_status != old_status:
		check_status_change(old_status, new_status, kot_name)
	doc.db_set(fields, update_modified=True)
	if new_status is not None and new_status != old_status:
		_audit_status(doc, old_status, new_status)
	return doc


def _audit_status(doc, old_status, new_status):
	audit = frappe.new_doc("Food POS Audit Log")
	audit.timestamp = now_datetime()
	audit.action_type = "KOT Status Change"
	audit.branch = doc.branch or ""
	audit.pos_profile = doc.pos_profile or ""
	audit.cashier = frappe.session.user or "Administrator"
	audit.table = str(doc.table or "")
	audit.details = _("Kitchen ticket {0} status updated from {1} to {2} ({3})").format(
		doc.name, old_status, new_status, doc.kitchen_station or "Kitchen"
	)
	audit.flags.ignore_permissions = True  # system audit trail, written for every cashier action
	audit.insert()
