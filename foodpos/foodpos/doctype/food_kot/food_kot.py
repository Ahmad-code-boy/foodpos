# Copyright (c) 2026, nextash and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, now_datetime


class FoodKOT(Document):
	# ── Lifecycle hooks ────────────────────────────────────────────────────────

	def before_insert(self):
		"""Force status to Pending on every new KOT regardless of what was passed in."""
		self.status = "Pending"

	def autoname(self):
		"""
		Monotonic series allocation for Food KOT.
		Validates line items first so no sequence numbers are burned on invalid/blocked attempts.
		Allocates MAX + 1 atomically.
		"""
		self._validate_items()
		year = now_datetime().year
		prefix = f"FKOT-{year}-"
		res = frappe.db.sql("""
			SELECT MAX(CAST(SUBSTRING_INDEX(name, '-', -1) AS UNSIGNED))
			FROM `tabFood KOT`
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
		self._validate_items()
		self._validate_status_transition()
		self._auto_advance_status()
		self._validate_ready_items()
		self._validate_single_invoice_link()
		self._validate_order_invoice_consistency()

	def on_update(self):
		self._audit_status_change()

	def before_update_after_submit(self):
		self._validate_single_invoice_link()

	def on_submit(self):
		"""
		Loss-Prevention & Monotonicity Enforcement:
		KOT can only be submitted once it reaches the Served state.
		Submitting locks line items and quantities into the immutable ledger.
		"""
		if self.status != "Served":
			frappe.throw(_("A Kitchen Order Ticket can only be submitted when status is 'Served'."))
		self._audit_status_change()

	def on_cancel(self):
		"""
		Only an authorized manager void can cancel a submitted KOT.
		"""
		if not self.is_voided and not getattr(self.flags, "allow_void_cancel", False):
			frappe.throw(
				_("Cannot cancel Served KOT {0} without an authorized Manager Void trace.").format(self.name)
			)
		self._audit_status_change()

	def on_trash(self):
		"""
		Loss-Prevention & Audit Safeguard:
		Prevent unlinking or deleting served kitchen orders.
		A Served KOT represents prepared & delivered food that must have
		a linked Sales Invoice or an approved Manager Void trace.
		"""
		user_roles = frappe.get_roles(frappe.session.user)
		if "System Manager" not in user_roles:
			frappe.throw(_("Permission Denied: Store staff and cashiers cannot delete Kitchen Order Tickets."))

		if self.status == "Served":
			has_invoice = False
			if self.table:
				has_invoice = frappe.db.exists(
					"Sales Invoice",
					{"custom_table": self.table, "docstatus": 1}
				)
			if not has_invoice and not getattr(self.flags, "allow_void_delete", False):
				frappe.throw(
					_("Cannot delete Served KOT {0}. A served kitchen order cannot be deleted without a linked Sales Invoice or an approved Manager Void trace.").format(self.name)
				)

	def _audit_status_change(self):
		"""
		Unified Audit Log Hook:
		Audits ALL KOT status changes across every path (Desk form, Desk list,
		REST API, POS Kitchen Drawer, and scripts).
		"""
		if getattr(self.flags, "audit_logged", False):
			return

		old_doc = self.get_doc_before_save()
		old_status = old_doc.status if old_doc else None

		if old_status and old_status != self.status:
			self.flags.audit_logged = True
			try:
				audit = frappe.new_doc("Food POS Audit Log")
				audit.timestamp = now_datetime()
				audit.action_type = "KOT Status Change"
				audit.branch = self.branch or ""
				audit.pos_profile = self.pos_profile or ""
				audit.cashier = frappe.session.user or "Administrator"
				audit.table = str(self.table or "")
				audit.details = f"Kitchen ticket {self.name} status updated from {old_status} to {self.status} ({self.kitchen_station or 'Kitchen'})"
				audit.flags.ignore_permissions = True
				audit.insert()
				self.flags.audit_log_id = audit.name
			except Exception as e:
				frappe.log_error(f"Audit log failed in FoodKOT._audit_status_change: {e}", "Food POS Audit Log")

	# ── Private helpers ────────────────────────────────────────────────────────

	def _validate_items(self):
		"""A KOT must have at least one item with qty > 0."""
		if not self.items:
			frappe.throw(_("A Kitchen Order Ticket must have at least one item."))

		for row in self.items:
			if not row.item_code:
				frappe.throw(_("Row {0}: Item Code is required.").format(row.idx))
			if not row.qty or row.qty <= 0:
				frappe.throw(
					_("Row {0}: Quantity must be greater than zero.").format(row.idx)
				)

	def _validate_status_transition(self):
		"""
		Prevent backward status transitions on existing documents.
		Cancelled is always terminal — cannot be un-cancelled here.
		"""
		_ORDER = ["Pending", "In Progress", "Ready", "Served", "Held", "Cancelled"]

		if not self.is_new() and self.has_value_changed("status"):
			old_status = self.get_doc_before_save() and self.get_doc_before_save().status
			if not old_status:
				return

			# Cancelled is terminal
			if old_status == "Cancelled":
				frappe.throw(
					_("KOT {0} is Cancelled and cannot be updated.").format(self.name)
				)

			new_idx = _ORDER.index(self.status) if self.status in _ORDER else -1
			old_idx = _ORDER.index(old_status) if old_status in _ORDER else -1

			# Allow Held ↔ Pending (recall) but not other backward moves
			_ALLOWED_BACKWARD = {("Held", "Pending")}
			if (
				new_idx < old_idx
				and (old_status, self.status) not in _ALLOWED_BACKWARD
			):
				frappe.throw(
					_("Cannot change KOT status from {0} to {1}.").format(
						_(old_status), _(self.status)
					)
				)

	def _auto_advance_status(self):
		"""
		Auto-advance to Ready when every item is marked done
		and the KOT is currently In Progress.
		"""
		if self.status != "In Progress":
			return
		if self.items and all(cint(item.is_done) for item in self.items):
			self.status = "Ready"

	def _validate_ready_items(self):
		"""A ticket must not reach Ready or Served with unchecked items."""
		if self.status in ["Ready", "Served"]:
			if self.items:
				unchecked = [it.item_name or it.item_code for it in self.items if not cint(it.is_done)]
				if unchecked:
					frappe.throw(
						_("Cannot set KOT {0} status to '{1}' because {2} item(s) are still cooking / unchecked: {3}").format(
							self.name, self.status, len(unchecked), ", ".join(unchecked)
						)
					)

	def _validate_single_invoice_link(self):
		"""
		1:1 Invoicing Integrity Guard:
		A KOT can link to at most one Sales Invoice, and once linked, the link cannot be reassigned.
		Additionally, going forward, an invoice cannot be linked to multiple KOTs.
		"""
		if not self.sales_invoice:
			return

		if not self.is_new():
			db_inv = frappe.db.get_value("Food KOT", self.name, "sales_invoice")
			if db_inv and db_inv != self.sales_invoice:
				frappe.throw(
					_("KOT {0} is already permanently linked to Sales Invoice {1} and cannot be re-linked to {2}.").format(
						self.name, db_inv, self.sales_invoice
					)
				)

		# Round 23 fix: one order may legitimately have several KOTs (one per
		# kitchen station), and all of them link to the SAME invoice. So the
		# "one invoice, one KOT" rule only applies across DIFFERENT orders.
		# KOTs sharing this KOT's order_id may share its invoice; KOTs from
		# another order (or legacy KOTs with no order_id) may not.
		if self.order_id:
			existing = frappe.db.sql("""
				SELECT name FROM `tabFood KOT`
				WHERE sales_invoice = %s AND name != %s
				  AND (order_id IS NULL OR order_id = '' OR order_id != %s)
			""", (self.sales_invoice, self.name or "", self.order_id))
		else:
			existing = frappe.db.sql("""
				SELECT name FROM `tabFood KOT`
				WHERE sales_invoice = %s AND name != %s
			""", (self.sales_invoice, self.name or ""))
		if existing:
			frappe.throw(
				_("Sales Invoice {0} is already linked to KOT {1} from a different order. Each Sales Invoice can link to KOTs of only one order.")
				.format(self.sales_invoice, existing[0][0])
			)

	def _validate_order_invoice_consistency(self):
		"""
		Round 23 fix: all KOTs carrying the same order_id must end up on the
		same Sales Invoice. If a sibling KOT for this order is already linked
		to a different invoice, this link is a mis-link — refuse it.
		Legacy KOTs (no order_id) are exempt.
		"""
		if not self.order_id or not self.sales_invoice:
			return
		other = frappe.db.sql("""
			SELECT name, sales_invoice FROM `tabFood KOT`
			WHERE order_id = %s AND name != %s
			  AND sales_invoice IS NOT NULL AND sales_invoice != ''
			  AND sales_invoice != %s
			LIMIT 1
		""", (self.order_id, self.name or "", self.sales_invoice))
		if other:
			frappe.throw(
				_("KOTs for order {0} are already linked to Sales Invoice {1}. Cannot link KOT {2} to {3}.")
				.format(self.order_id, other[0][1], self.name, self.sales_invoice)
			)
