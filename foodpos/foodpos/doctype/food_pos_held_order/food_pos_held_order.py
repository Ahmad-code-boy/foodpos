# Copyright (c) 2026, Nextash and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class FoodPOSHeldOrder(Document):
	def autoname(self):
		"""
		Monotonic series allocation for Food POS Held Order.
		Validates that payload exists first so no sequence numbers are burned on blocked attempts.
		Allocates MAX + 1 atomically.
		"""
		if not self.order_data:
			frappe.throw(_("Cannot hold an empty order."))

		year = now_datetime().year
		prefix = f"FP-HOLD-{year}-"
		res = frappe.db.sql("""
			SELECT MAX(CAST(SUBSTRING_INDEX(name, '-', -1) AS UNSIGNED))
			FROM `tabFood POS Held Order`
			WHERE name LIKE %s
			FOR UPDATE
		""", (f"{prefix}%",))
		max_idx = (res and res[0][0]) or 0

		series_val = frappe.db.sql("""
			SELECT current FROM `tabSeries` WHERE name = %s FOR UPDATE
		""", (prefix,))
		if series_val and series_val[0][0]:
			max_idx = max(int(max_idx), int(series_val[0][0]))

		next_idx = int(max_idx) + 1
		self.name = f"{prefix}{next_idx:05d}"

		if series_val:
			frappe.db.sql("UPDATE `tabSeries` SET current = %s WHERE name = %s", (next_idx, prefix))
		else:
			frappe.db.sql("INSERT INTO `tabSeries` (name, current) VALUES (%s, %s)", (prefix, next_idx))

	def validate(self):
		if self.order_data:
			try:
				import json
				from frappe.utils import flt
				d = json.loads(self.order_data)
				items = d.get("items") or d.get("cart_items") or []
				if items and (not self.grand_total or flt(self.grand_total) <= 0):
					calc_total = sum(flt(it.get("amount") or (flt(it.get("qty", 1)) * flt(it.get("rate", 0)))) for it in items)
					if calc_total > 0:
						self.grand_total = calc_total
			except Exception:
				pass

	def on_trash(self):
		"""
		Loss-Prevention & Audit Safeguard:
		Prevent unauthorized hard-deletion of held orders.
		Held orders must be resumed or discarded via the POS register,
		preserving full monotonic history and audit trails.
		"""
		user_roles = frappe.get_roles(frappe.session.user)
		if "System Manager" not in user_roles:
			frappe.throw(
				_("Permission Denied: Held orders cannot be deleted. Discard or resume them via the POS register.")
			)

