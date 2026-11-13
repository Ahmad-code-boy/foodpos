# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Patch v0.2.0 — Add a DB index for Food KOT order_id (Round 23 fix).

The order_id field itself is added by the DocType JSON (bench migrate).
This patch only adds a non-unique index on (order_id, kitchen_station,
status) so the "find open KOTs for this order" lookup in create_kot /
submit_pos_invoice stays fast. It is deliberately NOT a unique index:
one order legitimately has one KOT per kitchen station.

Safe to re-run — checks the column exists and swallows "index exists".
"""

import frappe


def execute():
    if not frappe.db.has_column("Food KOT", "order_id"):
        return
    try:
        frappe.db.add_index("Food KOT", ["order_id", "kitchen_station", "status"])
    except Exception:
        pass
    frappe.db.commit()
