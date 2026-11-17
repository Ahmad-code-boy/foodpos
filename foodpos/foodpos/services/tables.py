# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Restaurant Table status changes for Food POS.

Every table change goes through here: the DocType controller runs, Frappe
checks write permission, and the POS screens get a realtime broadcast.
"""

import frappe
from frappe import _
from frappe.utils import now_datetime

TABLE_STATUSES = ("Available", "Occupied", "Reserved", "Cleaning")
STATUS_ALIASES = {"Free": "Available"}

# Keys the POS UI may send, mapped to Restaurant Table fieldnames.
UI_FIELD_MAP = {
	"guests": "guests",
	"waiter": "waiter",
	"notes": "notes",
	"order_id": "order_id",
	"occupied_since": "occupied_since",
	"reservation_time": "reservation_time",
	"customer_name": "reservation_name",
	"mobile": "mobile",
}


def set_table_fields(table_name, values, ignore_permissions=False):
	"""Same as set_table_status, taking one dict that may include "status"."""
	values = dict(values)
	status = values.pop("status", None)
	return set_table_status(table_name, status, values, ignore_permissions=ignore_permissions)


def normalise_status(status):
	status = STATUS_ALIASES.get(status, status)
	if status not in TABLE_STATUSES:
		frappe.throw(_("Invalid table status {0}").format(status))
	return status


def set_table_status(table_name, status=None, fields=None, ignore_permissions=False):
	"""Update one Restaurant Table through its controller and broadcast the change.

	`fields` holds only the keys the caller wants to change. A value of None
	clears that field.
	"""
	if not table_name:
		frappe.throw(_("Table is required."))
	if not frappe.db.exists("Restaurant Table", table_name):
		frappe.throw(_("Table {0} not found").format(table_name))

	doc = frappe.get_doc("Restaurant Table", table_name)
	if not ignore_permissions:
		doc.check_permission("write")

	for key, value in (fields or {}).items():
		fieldname = UI_FIELD_MAP.get(key)
		if fieldname is None:
			frappe.throw(_("Unknown table field {0}").format(key))
		setattr(doc, fieldname, value)

	if status is not None:
		doc.status = normalise_status(status)

	if doc.status in ("Available", "Cleaning"):
		doc.order_id = None
		doc.occupied_since = None
	elif doc.status == "Occupied" and not doc.occupied_since:
		doc.occupied_since = now_datetime()

	doc.flags.ignore_permissions = ignore_permissions
	doc.save()
	broadcast(doc)
	return {
		"success": True,
		"table": doc.name,
		"status": doc.status,
		"order_id": doc.order_id,
		"occupied_since": doc.occupied_since,
	}


def broadcast(doc):
	"""Tell every connected POS screen about a table's current state."""
	frappe.publish_realtime(
		"fpos_table_status_changed",
		{
			"table": doc.name,
			"status": doc.status,
			"order_id": doc.order_id,
			"occupied_since": doc.occupied_since,
		},
		after_commit=True,
	)
