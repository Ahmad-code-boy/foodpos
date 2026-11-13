# Copyright (c) 2026, nextash and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import now_datetime


class FoodTableMerge(Document):
	def validate(self):
		self._validate_no_duplicate_tables()
		self._validate_tables_not_already_merged()

	def before_insert(self):
		self.merged_at = now_datetime()
		self.status = "Active"

	# ── Private helpers ────────────────────────────────────────────────────────

	def _validate_no_duplicate_tables(self):
		"""Primary table must not appear in secondary_tables list."""
		for row in self.secondary_tables or []:
			if row.table == self.primary_table:
				frappe.throw(
					_("Primary table '{0}' cannot also be a secondary table.").format(self.primary_table)
				)

		# Check for duplicates within secondary list
		seen = set()
		for row in self.secondary_tables or []:
			if row.table in seen:
				frappe.throw(_("Table '{0}' appears more than once in secondary tables.").format(row.table))
			seen.add(row.table)

	def _validate_tables_not_already_merged(self):
		"""Prevent a table from being in two active merges simultaneously."""
		all_tables = [self.primary_table] + [r.table for r in (self.secondary_tables or [])]

		for tbl in all_tables:
			# Check as primary
			existing_primary = frappe.db.get_all(
				"Food Table Merge",
				filters={
					"primary_table": tbl,
					"status": "Active",
					"name": ["!=", self.name or ""],
				},
				pluck="name",
				limit=1,
			)
			if existing_primary:
				frappe.throw(
					_("Table '{0}' is already part of an active merge ({1}).").format(
						tbl, existing_primary[0]
					)
				)

			# Check as secondary — query parent doctype via child
			existing_secondary = frappe.db.sql(
				"""
				SELECT ftm.name FROM `tabFood Table Merge` ftm
				JOIN `tabFood Table Merge Secondary` ftms ON ftms.parent = ftm.name
				WHERE ftms.table = %(tbl)s
				  AND ftm.status = 'Active'
				  AND ftm.name != %(self_name)s
				""",
				{"tbl": tbl, "self_name": self.name or ""},
				as_dict=True,
			)
			if existing_secondary:
				frappe.throw(
					_("Table '{0}' is already part of an active merge ({1}).").format(
						tbl, existing_secondary[0].name
					)
				)
