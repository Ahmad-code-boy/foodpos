# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Patch v0.3.0 — v2 Home screen: user-settable Day Start / Day End times.

Creates on POS Opening Entry:
  custom_fpos_day_start_time (Time)
  custom_fpos_day_end_time   (Time)

The home screen reads/writes them via get_day_status / set_day_times
(foodpos.foodpos.page.food_pos.food_pos). Until this patch has run
(bench migrate), those APIs fall back to a 24h cache entry per opening
entry, so the home screen still works.

Safe to re-run — each field is checked before creation.

Register in patches.txt under [post_model_sync]:
    foodpos.patches.v0_3_0.add_day_time_fields
"""

import frappe


def execute():
	for field_def in (
		{
			"dt": "POS Opening Entry",
			"fieldname": "custom_fpos_day_start_time",
			"label": "Day Start Time",
			"fieldtype": "Time",
			"insert_after": "period_start_date",
		},
		{
			"dt": "POS Opening Entry",
			"fieldname": "custom_fpos_day_end_time",
			"label": "Day End Time",
			"fieldtype": "Time",
			"insert_after": "custom_fpos_day_start_time",
		},
	):
		if frappe.db.exists("Custom Field", {"dt": field_def["dt"], "fieldname": field_def["fieldname"]}):
			continue
		cf = frappe.get_doc({"doctype": "Custom Field", **field_def})
		cf.flags.ignore_permissions = True  # system-initiated patch
		cf.insert()
	frappe.db.commit()
