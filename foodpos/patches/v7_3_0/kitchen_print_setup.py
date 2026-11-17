# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Patch v7.3.0: kitchen printing setup.

* POS Profile gets a Kitchen Printer link (a Network Printer Settings record).
* Existing Food KOT item rows are marked Printed, so migrating does not send
  historical tickets to the kitchen again.
"""

import frappe


def execute():
	if frappe.db.exists("DocType", "POS Profile") and not frappe.db.exists(
		"Custom Field", {"dt": "POS Profile", "fieldname": "custom_fpos_kitchen_printer"}
	):
		cf = frappe.get_doc({
			"doctype": "Custom Field",
			"dt": "POS Profile",
			"fieldname": "custom_fpos_kitchen_printer",
			"label": "Kitchen Printer",
			"fieldtype": "Link",
			"options": "Network Printer Settings",
			"insert_after": "company",
		})
		cf.flags.ignore_permissions = True
		cf.insert()

	frappe.db.sql(
		"UPDATE `tabFood KOT Item` SET kitchen_print_state = 'Printed' "
		"WHERE kitchen_print_state IS NULL OR kitchen_print_state = 'Pending'"
	)
