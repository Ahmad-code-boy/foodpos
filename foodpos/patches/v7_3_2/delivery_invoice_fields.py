# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Patch v7.3.2: delivery details (contact phone, address, charges) on invoices.

The fields were defined in patch v0.1.0 but are missing on sites where that
patch never created them, so delivery phone and address were silently dropped.
"""

import frappe

from foodpos.patches.v0_1_0.create_custom_fields import _create_invoice_fields


def execute():
	for dt in ("Sales Invoice", "POS Invoice"):
		if frappe.db.exists("DocType", dt):
			_create_invoice_fields(dt)
