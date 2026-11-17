# Copyright (c) 2026, Nextash and contributors
# For license information, please see license.txt

from frappe import _
from foodpos.foodpos.page.food_pos.food_pos import get_served_kot_exceptions

def execute(filters=None):
	columns = get_columns()
	data = get_data(filters)
	return columns, data

def get_columns():
	return [
		{
			"label": _("KOT ID"),
			"fieldname": "name",
			"fieldtype": "Link",
			"options": "Food KOT",
			"width": 160
		},
		{
			"label": _("Branch"),
			"fieldname": "branch",
			"fieldtype": "Link",
			"options": "Branch",
			"width": 150
		},
		{
			"label": _("Table / Type"),
			"fieldname": "table_type",
			"fieldtype": "Data",
			"width": 140
		},
		{
			"label": _("Customer"),
			"fieldname": "customer",
			"fieldtype": "Data",
			"width": 150
		},
		{
			"label": _("Created At"),
			"fieldname": "creation",
			"fieldtype": "Datetime",
			"width": 160
		},
		{
			"label": _("Age (Mins)"),
			"fieldname": "elapsed_mins",
			"fieldtype": "Int",
			"width": 100
		},
		{
			"label": _("Items Summary"),
			"fieldname": "items_summary",
			"fieldtype": "Data",
			"width": 260
		},
		{
			"label": _("Est. Amount (PKR)"),
			"fieldname": "estimated_total",
			"fieldtype": "Currency",
			"width": 140
		},
		{
			"label": _("Audit Status"),
			"fieldname": "status",
			"fieldtype": "Data",
			"width": 160
		}
	]

def get_data(filters):
	filters = filters or {}
	branch = filters.get("branch")
	res = get_served_kot_exceptions(branch=branch)
	exceptions = res.get("exceptions", [])

	data = []
	for ex in exceptions:
		table_desc = f"{ex['order_type']} (T-{ex['table_no']})" if ex.get("table") and ex.get("table") != "N/A" else ex.get("order_type", "")
		items_summary = ", ".join([
			f"{int(it['qty']) if it['qty'] == int(it['qty']) else it['qty']}x {it['item_name']} (Rs {int(it.get('amount', 0))})"
			for it in ex.get("items", [])
		])
		# V2 fix: the status was hardcoded to "Served Uninvoiced" for every
		# row, discarding ex["status"]. A mismatched KOT (e.g. Club Sandwich
		# KOT linked to a Beef Burger invoice) must keep its own status.
		# Likewise, show the linked invoice and what it actually billed,
		# so a manager can see the mismatch at a glance.
		status = ex.get("status") or "Served (Uninvoiced)"
		if "Mismatch" in status and not status.startswith("⚠️"):
			status = "⚠️ " + status
		elif "Uninvoiced" in status and not status.startswith("⚠️"):
			status = "⚠️ " + status
		if ex.get("sales_invoice"):
			inv_summary = ", ".join([
				f"{int(it['qty']) if it['qty'] == int(it['qty']) else it['qty']}x {it.get('item_name') or it.get('item_code')}"
				for it in ex.get("invoice_item_rows", [])
			]) or ", ".join(
				f"{int(q)}x {code}" for code, q in (ex.get("invoice_items") or {}).items()
			)
			items_summary = (items_summary + f" | Linked invoice {ex['sales_invoice']}"
				+ (f" billed: {inv_summary}" if inv_summary else ""))
		data.append({
			"name": ex["name"],
			"branch": ex["branch"],
			"table_type": table_desc,
			"customer": ex["customer"],
			"creation": ex["creation"],
			"elapsed_mins": ex["elapsed_mins"],
			"items_summary": items_summary or "No items recorded",
			"estimated_total": ex["estimated_total"],
			"status": status
		})

	return data
