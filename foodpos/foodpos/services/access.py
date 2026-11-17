# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Server-side access control for Food POS endpoints.

The POS page lists the roles allowed to open it. Those same roles are the
only ones allowed to call the POS endpoints, so the page definition stays the
single source of truth.
"""

import frappe


def pos_roles():
	"""Roles listed on the Food POS page (the roles that may use the POS)."""
	page = frappe.get_cached_doc("Page", "food-pos")
	return [row.role for row in page.roles if row.role]


def require_pos_access():
	"""Raise PermissionError unless the session user holds a POS role."""
	frappe.only_for(pos_roles())


MANAGER_ROLES = ("Food POS Manager", "Branch Manager", "Accounts Manager", "System Manager")


def require_pos_manager():
	"""Raise PermissionError unless the session user holds a manager role."""
	frappe.only_for(MANAGER_ROLES)
