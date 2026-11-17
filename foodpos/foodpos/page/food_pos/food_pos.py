# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Food POS Page Backend Controller - Frappe & ERPNext v16
Exposes whitelisted endpoints for POS Profile, Item & Stock fetching,
Customer management, Table management, KOT generation, and POS Invoice processing.
"""

import json
import uuid
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, now_datetime, nowdate
from frappe.utils.password import get_decrypted_password

# v2 single branch: one branch only. The old branch columns/fields are
# kept for existing data, but nothing in v2 selects, filters, names or
# PIN-scopes by branch any more.
from foodpos.foodpos.services.access import require_pos_access, require_pos_manager
from foodpos.foodpos.services.opening import open_shift
from foodpos.foodpos.services.tables import broadcast, set_table_fields, set_table_status
from foodpos.foodpos.single_branch import SINGLE_BRANCH, SINGLE_NAMING_SERIES, normalise_order_type


def get_context(context):
	context.no_cache = 1


def _format_time_hh_mm(val):
	"""Format time/timedelta to clean HH:MM string without microseconds."""
	if not val:
		return ""
	import datetime
	if isinstance(val, datetime.timedelta):
		total_seconds = int(val.total_seconds())
		hours = (total_seconds // 3600) % 24
		minutes = (total_seconds % 3600) // 60
		return f"{hours:02d}:{minutes:02d}"
	if isinstance(val, (datetime.datetime, datetime.time)):
		return val.strftime("%H:%M")
	s = str(val).split(".")[0].strip()
	parts = s.split(":")
	if len(parts) >= 2:
		try:
			return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
		except Exception:
			return s
	return s


# ──────────────────────────────────────────────────────────────────────────────
# 1. POS Profile & Initialization
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_pos_profiles():
	"""
	Retrieve accessible POS Profiles for current user in Frappe/ERPNext v16.
	Returns warehouse, price list, and currency.
	v2 single branch: Branch User Permissions are no longer applied —
	there is only one branch, so every profile the user may use is listed.
	"""
	require_pos_access()
	user = frappe.session.user
	user_profiles = frappe.get_all(
		"POS Profile User",
		filters={"user": user},
		pluck="parent"
	)

	filters = {"disabled": 0}
	roles = frappe.get_roles(user)
	is_admin = "System Manager" in roles or "Administrator" in roles or "HQ / Owner" in roles

	if not is_admin:
		if user_profiles:
			filters["name"] = ["in", user_profiles]

		# v2: no Branch User-Permission filtering — single branch only.

	# v5.6: "custom_branch" was selected here unconditionally, but the column
	# only exists after the v0.1.0 patch runs (bench migrate). On a site
	# where migrate had not run yet, this one SELECT crashed the whole page
	# load ("Unknown column 'custom_branch'") and the POS stuck on
	# "Loading Food POS environment...". The field is legacy anyway — the
	# loop below overwrites p["branch"] with SINGLE_BRANCH — so it is not
	# selected at all now. Migrate is still needed for Attendance, day-time
	# fields and seed data, but the page no longer bricks without it.
	profiles = frappe.get_all(
		"POS Profile",
		filters=filters,
		fields=["name", "company", "warehouse", "selling_price_list", "currency"]
	)
	for p in profiles:
		p["branch"] = SINGLE_BRANCH  # v2: fixed; custom_branch is legacy data only.
		open_shift_name = frappe.db.get_value(
			"POS Opening Entry",
			{"pos_profile": p["name"], "docstatus": 1, "pos_closing_entry": ["in", ["", None]], "status": "Open"},
			"name"
		)
		p["has_open_shift"] = 1 if open_shift_name else 0
		p["open_shift_name"] = open_shift_name or ""

	# Sort: profiles with active open shifts first, then alphabetically
	profiles.sort(key=lambda x: (-x.get("has_open_shift", 0), x.get("name", "")))
	return profiles


@frappe.whitelist()
def check_opening_entry(user=None, pos_profile=None):
	"""Return active open POS Opening Entry vouchers for the profile and/or user."""
	require_pos_access()
	if not _table_exists("tabPOS Opening Entry"):
		return []

	cols = frappe.db.get_table_columns("POS Opening Entry") or []

	if pos_profile:
		filters = {
			"pos_profile": pos_profile,
			"docstatus": 1,
		}
		if "pos_closing_entry" in cols:
			filters["pos_closing_entry"] = ["in", ["", None]]
		if "status" in cols:
			filters["status"] = "Open"

		# If user is specified, check if there is an entry specifically for this user
		if user:
			user_entries = frappe.db.get_all(
				"POS Opening Entry",
				filters=dict(filters, user=user),
				fields=["name", "company", "pos_profile", "period_start_date", "posting_date", "user"],
				order_by="period_start_date desc",
			)
			if user_entries:
				return user_entries

		# Otherwise return any active open entry for this profile
		return frappe.db.get_all(
			"POS Opening Entry",
			filters=filters,
			fields=["name", "company", "pos_profile", "period_start_date", "posting_date", "user"],
			order_by="period_start_date desc",
		)

	user = user or frappe.session.user
	filters = {
		"user": user,
		"docstatus": 1,
	}
	if "pos_closing_entry" in cols:
		filters["pos_closing_entry"] = ["in", ["", None]]
	if "status" in cols:
		filters["status"] = "Open"

	return frappe.db.get_all(
		"POS Opening Entry",
		filters=filters,
		fields=["name", "company", "pos_profile", "period_start_date", "posting_date", "user"],
		order_by="period_start_date desc",
	)


@frappe.whitelist()
def create_opening_voucher(pos_profile, company, balance_details):
	"""Open (or return today's open) POS Opening Entry for the profile."""
	require_pos_access()
	return open_shift(pos_profile, company, balance_details)


def _get_default_pos_profile_for_user(user=None):
	user = user or frappe.session.user
	user_profiles = frappe.get_all(
		"POS Profile User",
		filters={"user": user},
		pluck="parent"
	)
	if user_profiles:
		return user_profiles[0]
	profiles = frappe.get_all("POS Profile", filters={"disabled": 0}, limit=1, pluck="name")
	return profiles[0] if profiles else None


@frappe.whitelist()
def get_pos_profile_data(pos_profile=None):
	"""
	Fetch comprehensive POS profile configuration in a single call.
	Includes tax templates, payment methods, currency, and default customer.
	"""
	require_pos_access()
	if not pos_profile:
		pos_profile = _get_default_pos_profile_for_user()

	if not pos_profile:
		frappe.throw(_("No active POS Profile found. Please configure a POS Profile in ERPNext."))

	profile = frappe.get_cached_doc("POS Profile", pos_profile)
	company = profile.company or frappe.defaults.get_global_default("company")
	currency = (
		profile.currency
		or frappe.db.get_value("Company", company, "default_currency")
		or frappe.defaults.get_global_default("currency")
		or "USD"
	)

	# Fetch payment modes
	payment_methods = []
	_ICONS = {
		"Cash": "💵",
		"Credit Card": "💳",
		"Debit Card": "💳",
		"UPI": "📱",
		"Wallet": "👛",
		"Bank Transfer": "🏦",
		"EasyPaisa": "📱",
		"JazzCash": "📱",
	}

	for row in profile.payments or []:
		mop_type = frappe.db.get_value("Mode of Payment", row.mode_of_payment, "type") or "General"
		payment_methods.append({
			"mode_of_payment": row.mode_of_payment,
			"type": mop_type,
			"default": cint(row.default),
			"icon": _ICONS.get(row.mode_of_payment, "💳")
		})

	if not payment_methods:
		all_mops = frappe.get_all("Mode of Payment", filters={"enabled": 1}, fields=["name", "type"])
		payment_methods = [
			{
				"mode_of_payment": m.name,
				"type": m.type or "General",
				"default": 1 if m.type == "Cash" else 0,
				"icon": _ICONS.get(m.name, "💳")
			}
			for m in all_mops
		]

	# Taxes and charges
	tax_rate = 0.0
	if getattr(profile, "taxes_and_charges", None):
		taxes = frappe.get_all(
			"Sales Taxes and Charges",
			filters={"parent": profile.taxes_and_charges},
			fields=["rate", "account_head", "charge_type"]
		)
		tax_rate = sum(flt(t.rate) for t in taxes if t.charge_type == "On Net Total")

	# Item groups configured on profile
	profile_item_groups = [row.item_group for row in (profile.item_groups or []) if row.item_group]

	# All leaf item groups for category navigation tabs (safely checking if disabled column exists)
	ig_filters = {"is_group": 0}
	item_group_cols = frappe.db.get_table_columns("Item Group") or []
	if "disabled" in item_group_cols:
		ig_filters["disabled"] = 0

	all_item_groups = frappe.get_all("Item Group", filters=ig_filters, pluck="name")
	item_groups = profile_item_groups if profile_item_groups else all_item_groups

	return {
		"name": profile.name,
		"company": company,
		"currency": currency,
		"custom_branch": SINGLE_BRANCH,  # v2: legacy field, always the single branch.
		"branch": SINGLE_BRANCH,
		"warehouse": profile.warehouse or "",
		"cost_center": getattr(profile, "cost_center", None) or "",
		"write_off_cost_center": getattr(profile, "write_off_cost_center", None) or "",
		"selling_price_list": profile.selling_price_list or "Standard Selling",
		"customer": profile.customer or _get_walk_in_customer(company),
		"payments": payment_methods,
		"payment_methods": payment_methods,
		"tax_rate": tax_rate,
		"profile_item_groups": profile_item_groups,
		"item_groups": item_groups,
		"hide_unavailable_items": cint(getattr(profile, "hide_unavailable_items", 0)),
		"update_stock": cint(getattr(profile, "update_stock", 0))
	}


# ──────────────────────────────────────────────────────────────────────────────
# 2. Item Master & Pricing
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_items(pos_profile=None, item_group=None, search_term=None, start=0, page_length=100):
	"""
	Fetch items with pricing, actual stock quantity, and dietary tags.
	Optimized for client-side caching & instant touch interactions.
	"""
	require_pos_access()
	if not pos_profile:
		pos_profile = _get_default_pos_profile_for_user()
	if not pos_profile:
		return []

	profile_data = get_pos_profile_data(pos_profile)
	warehouse = profile_data.get("warehouse")
	price_list = profile_data.get("selling_price_list") or "Standard Selling"
	hide_unavailable = profile_data.get("hide_unavailable_items")

	item_cols = frappe.db.get_table_columns("Item") or []
	conds = []
	if "disabled" in item_cols:
		conds.append("item.disabled = 0")
	if "has_variants" in item_cols:
		conds.append("item.has_variants = 0")
	if "is_sales_item" in item_cols:
		conds.append("item.is_sales_item = 1")
	if "is_fixed_asset" in item_cols:
		conds.append("item.is_fixed_asset = 0")

	params = {
		"warehouse": warehouse,
		"price_list": price_list,
		"start": cint(start),
		"page_length": cint(page_length),
		"today": nowdate()
	}

	if item_group and item_group != "All":
		conds.append("item.item_group = %(item_group)s")
		params["item_group"] = item_group
	elif profile_data.get("profile_item_groups"):
		groups = tuple(profile_data["profile_item_groups"])
		if len(groups) == 1:
			conds.append("item.item_group = %(single_group)s")
			params["single_group"] = groups[0]
		elif len(groups) > 1:
			conds.append("item.item_group IN %(item_groups)s")
			params["item_groups"] = groups

	if search_term:
		# v6: search also matches barcodes (Item Barcode child table) so a
		# scanner can find the item by its barcode.
		conds.append("(item.name LIKE %(search)s OR item.item_name LIKE %(search)s OR item.description LIKE %(search)s OR EXISTS (SELECT 1 FROM `tabItem Barcode` b WHERE b.parent = item.name AND b.barcode LIKE %(search)s))")
		params["search"] = f"%{search_term}%"

	bin_join = ""
	if hide_unavailable and warehouse:
		bin_join = "LEFT JOIN `tabBin` bin ON bin.item_code = item.name AND bin.warehouse = %(warehouse)s"
		conds.append("(item.is_stock_item = 0 OR bin.actual_qty > 0)")

	item_cols = frappe.db.get_table_columns("Item")
	veg_col = "IFNULL(item.custom_is_vegetarian, 0) AS is_vegetarian" if "custom_is_vegetarian" in item_cols else "0 AS is_vegetarian"
	vegan_col = "IFNULL(item.custom_is_vegan, 0) AS is_vegan" if "custom_is_vegan" in item_cols else "0 AS is_vegan"

	where_str = " AND ".join(conds)

	query = f"""
		SELECT
			item.name AS item_code,
			item.item_name,
			item.item_group,
			item.description,
			item.stock_uom,
			item.image AS item_image,
			item.is_stock_item,
			(SELECT b.barcode FROM `tabItem Barcode` b WHERE b.parent = item.name ORDER BY b.idx ASC LIMIT 1) AS barcode,
			{veg_col},
			{vegan_col}
		FROM `tabItem` item
		{bin_join}
		WHERE {where_str}
		ORDER BY item.item_name ASC
		LIMIT %(page_length)s OFFSET %(start)s
	"""

	items = frappe.db.sql(query, params, as_dict=True)
	if not items:
		return []

	# Attach selling price and stock
	for itm in items:
		price = frappe.get_all(
			"Item Price",
			filters={
				"price_list": price_list,
				"item_code": itm.item_code,
				"selling": 1
			},
			or_filters=[
				["valid_from", "<=", params["today"]],
				["valid_from", "is", "not set"]
			],
			fields=["price_list_rate", "currency"],
			order_by="valid_from desc",
			limit=1
		)
		itm.rate = flt(price[0].price_list_rate) if price else 0.0
		itm.currency = price[0].currency if price else profile_data.get("currency")

		if itm.is_stock_item and warehouse:
			actual_qty = frappe.db.get_value("Bin", {"item_code": itm.item_code, "warehouse": warehouse}, "actual_qty")
			itm.actual_qty = flt(actual_qty or 0)
		else:
			itm.actual_qty = 999  # Unlimited service/non-stock items

	return items


# ──────────────────────────────────────────────────────────────────────────────
# 3. Table Management (Restaurant Floor)
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_available_tables(section=None, branch=None, pos_profile=None):
	"""
	Fetch restaurant tables with real-time status and seating capacity.
	v2 single branch: the `branch` argument is accepted for backward
	compatibility and ignored — all tables of the one branch are returned.
	"""
	require_pos_access()
	if not frappe.db.exists("DocType", "Restaurant Table"):
		return []

	filters = {}  # v2: no branch filter — one branch only.
	if section and section != "All":
		filters["section"] = section

	def _fetch():
		return frappe.get_all(
			"Restaurant Table",
			filters=filters,
			fields=["name", "table_no", "branch", "section", "capacity", "status", "order_id", "waiter", "guests", "occupied_since"],
			order_by="table_no asc, name asc"
		)

	return _fetch()


@frappe.whitelist()
def force_free_table(table, manager_pin, reason=None):
	"""
	Manager override to emergency force-free an occupied table to prevent checkout deadlocks.
	Validated with Manager PIN and logged to Food POS Audit Log.
	"""
	require_pos_access()
	if not table:
		frappe.throw(_("Table is required."))

	verify_manager_pin(
		pin=manager_pin,
		action_type="table_reset",
		cashier=frappe.session.user,
		table=table,
		details=f"Emergency table free for {table}. Reason: {reason or 'Manager override'}"
	)

	return set_table_status(table, "Available", {"order_id": None, "occupied_since": None, "guests": 0})


@frappe.whitelist()
def transfer_table(from_table, to_table, manager_pin=None, reason=None):
	"""
	Transfer an active order from one table to another.
	"""
	require_pos_access()
	if not from_table or not to_table:
		frappe.throw(_("Both source and destination tables are required."))

	if from_table == to_table:
		frappe.throw(_("Source and destination tables cannot be the same."))

	from_doc = frappe.get_doc("Restaurant Table", from_table)
	to_doc = frappe.get_doc("Restaurant Table", to_table)

	if to_doc.status != "Available":
		frappe.throw(_("Destination table {0} is currently {1}.").format(to_table, to_doc.status))

	order_id = from_doc.order_id
	occupied_since = from_doc.occupied_since or now_datetime()
	guests = from_doc.guests

	if manager_pin:
		verify_manager_pin(
			pin=manager_pin,
			action_type="table_transfer",
			cashier=frappe.session.user,
			table=f"{from_table} -> {to_table}",
			details=f"Table transfer from {from_table} to {to_table}. Reason: {reason or 'Customer request'}"
		)

	# Update destination
	to_doc.status = "Occupied"
	to_doc.order_id = order_id
	to_doc.occupied_since = occupied_since
	to_doc.guests = guests
	to_doc.save()

	# Free source
	from_doc.status = "Available"
	from_doc.order_id = None
	from_doc.occupied_since = None
	from_doc.guests = 0
	from_doc.save()

	broadcast(from_doc)
	broadcast(to_doc)

	return {"success": True, "from_table": from_table, "to_table": to_table}


@frappe.whitelist()
def update_table_status(table, status):
	"""Update a restaurant table's status and broadcast it to all POS screens."""
	require_pos_access()
	return set_table_status(table, status)


@frappe.whitelist()
def verify_manager_pin(pin, action_type, branch=None, cashier=None, order_id=None, table=None, details=None):
	"""
	Validate a Manager PIN for privileged POS actions:
	  - price_edit
	  - free_item
	  - discount
	  - void
	  - table_reset
	Upon successful validation, creates a persistent audit log in Food POS Audit Log.
	"""
	require_pos_access()
	if not pin:
		frappe.throw(_("Manager PIN is required."))

	cashier = cashier or frappe.session.user

	# v2: PINs are no longer branch-scoped. Any enabled PIN of the single
	# branch may approve; the 5-in-15-minutes lockout below is unchanged.
	filters = {"enabled": 1}

	pin_docs = frappe.get_all(
		"Food POS Manager PIN",
		filters=filters,
		fields=[
			"name", "user", "branch",
			"can_approve_discount", "can_approve_void",
			"can_approve_table_reset", "can_approve_price_edit",
			"can_approve_free_item"
		]
	)

	# v2: there is only one branch, so there is no cross-branch PIN to
	# borrow. If no PIN is configured at all, the manager must set one up.
	if not pin_docs:
		frappe.throw(_("No Manager PIN is configured. Ask an administrator to set one up."))

	# Round 23 fix: PIN brute-force lockout. 5 failed attempts in 15 minutes
	# from the same session user blocks further attempts. The counter lives
	# in cache only and is cleared on a successful verification.
	_fail_key = f"fpos_pin_fail:{frappe.session.user}:single-branch"
	try:
		_fails = cint(frappe.cache().get_value(_fail_key) or 0)
	except Exception:
		_fails = 0
	if _fails >= 5:
		frappe.throw(_("Too many failed Manager PIN attempts. Try again in 15 minutes."))

	matching_mgr = None
	for p in pin_docs:
		try:
			real_pin = get_decrypted_password("Food POS Manager PIN", p["name"], fieldname="pin", raise_exception=False)
			if str(real_pin).strip() == str(pin).strip():
				matching_mgr = p
				break
		except Exception:
			continue

	if not matching_mgr:
		try:
			frappe.cache().set_value(_fail_key, _fails + 1, expires_in_sec=900)
		except Exception:
			pass
		frappe.throw(_("Invalid Manager PIN. Access denied."))
	try:
		frappe.cache().delete_value(_fail_key)
	except Exception:
		pass

	cap_map = {
		"price_edit": "can_approve_price_edit",
		"free_item": "can_approve_free_item",
		"discount": "can_approve_discount",
		"void": "can_approve_void",
		"table_reset": "can_approve_table_reset",
	}
	cap_field = cap_map.get(action_type)
	if cap_field and not matching_mgr.get(cap_field):
		frappe.throw(_("This manager does not have permission to approve {0}.").format(action_type.replace("_", " ")))

	# Record in Food POS Audit Log
	try:
		audit_action_map = {
			"price_edit": "Price Override",
			"free_item": "Zero Price Approval",
			"discount": "Discount Override",
			"void": "Void Order",
			"table_reset": "Emergency Table Free",
			"table_transfer": "Table Transfer",
			"Close Register": "Close Register",
			"close_register": "Close Register",
		}
		audit = frappe.new_doc("Food POS Audit Log")
		audit.timestamp = now_datetime()
		audit.action_type = audit_action_map.get(action_type, action_type)
		audit.branch = SINGLE_BRANCH  # v2: legacy field kept, always the single branch.
		audit.cashier = cashier
		audit.approved_by = matching_mgr["user"]
		audit.order_id = str(order_id or "")
		audit.table = str(table or "")
		audit.details = str(details or f"Approved {action_type} by {matching_mgr['user']}")
		audit.flags.ignore_permissions = True
		audit.insert()
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"Audit log creation failed: {e}")
		if hasattr(frappe, "clear_messages"):
			frappe.clear_messages()

	return {
		"success": True,
		"approved_by": matching_mgr["user"],
		"manager_name": frappe.utils.get_fullname(matching_mgr["user"]) or matching_mgr["user"],
		"action_type": action_type
	}


# ──────────────────────────────────────────────────────────────────────────────
# 4. Customer Management
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_customers(search_term=""):
	"""Search customers by name, mobile, or email."""
	require_pos_access()
	filters = []
	if search_term:
		filters = [
			["name", "like", f"%{search_term}%"]
		]

	return frappe.get_all(
		"Customer",
		filters=filters,
		fields=["name", "customer_name", "mobile_no", "email_id"],
		limit=20
	)


@frappe.whitelist()
def create_customer(customer_name, mobile_no=None, email_id=None):
	"""Quick creation of a new customer from the POS cart."""
	require_pos_access()
	if not customer_name:
		frappe.throw(_("Customer Name is required."))

	if frappe.db.exists("Customer", customer_name):
		return frappe.get_doc("Customer", customer_name).as_dict()

	cust = frappe.new_doc("Customer")
	cust.customer_name = customer_name
	cust.customer_type = "Individual"
	cust.customer_group = frappe.db.get_single_value("Selling Settings", "customer_group") or "Individual"
	cust.territory = frappe.db.get_single_value("Selling Settings", "territory") or "All Territories"
	if mobile_no:
		cust.mobile_no = mobile_no
	if email_id:
		cust.email_id = email_id

	cust.insert()

	return {
		"name": cust.name,
		"customer_name": cust.customer_name,
		"mobile_no": cust.mobile_no,
		"email_id": cust.email_id
	}


def _get_walk_in_customer(company):
	customer_name = f"Walk-in Customer - {company}"
	if not frappe.db.exists("Customer", customer_name):
		try:
			cust = frappe.new_doc("Customer")
			cust.customer_name = customer_name
			cust.customer_type = "Individual"
			cust.customer_group = "Individual"
			cust.territory = "All Territories"
			cust.flags.ignore_permissions = True
			cust.insert()
		except Exception:
			pass
	return customer_name



# ── Round 23 fix helpers: POS order identity ──────────────────────────────
# A "POS order" is one cart, from first item to settle, across hold/resume,
# reload and tab switches. Its token (order_id) is the ONLY thing a KOT or
# a settle may join on. Table / branch / recency must never be used again
# to pick a KOT — that is what caused FKOT-00038/00039 to land on unrelated
# invoices in Round 23.


def _resolve_pos_order_id(order_data):
	"""Return the cart token for this order, generating one if absent.

	The token is a random 16-hex string, not a document name: it is created
	before any KOT/invoice exists and is returned to the POS so the browser
	stores it with the cart (tab state + localStorage + held order payload).
	"""
	token = str(order_data.get("order_id") or order_data.get("pos_order_id") or "").strip()
	if not token:
		token = uuid.uuid4().hex[:16]
		order_data["order_id"] = token
	return token


def _kot_has_order_field():
	"""True once `bench migrate` has added Food KOT.order_id (DocType JSON)."""
	try:
		return bool(frappe.get_meta("Food KOT").has_field("order_id"))
	except Exception:
		return False


def _find_open_kots_for_order(order_id, kitchen_station=None):
	"""Open (unlinked, not voided) KOTs for one order, optionally one station."""
	if not order_id or not _kot_has_order_field():
		return []
	filters = {
		"order_id": order_id,
		"status": ["in", ["Pending", "In Progress", "Ready"]],
		"is_voided": ["in", [0, None]],
		"sales_invoice": ["in", [None, ""]],
	}
	if kitchen_station:
		filters["kitchen_station"] = kitchen_station
	return frappe.get_all("Food KOT", filters=filters, fields=["name"], order_by="creation asc")


def _kot_items_by_code(kot_names):
	"""Aggregate {item_code: qty} across KOTs. One order may have one KOT
	per kitchen station, so a single KOT is only a subset of the order."""
	totals = {}
	for name in kot_names:
		for row in frappe.get_all(
			"Food KOT Item", filters={"parent": name},
			fields=["item_code", "qty"],
		):
			totals[row.item_code] = flt(totals.get(row.item_code, 0)) + flt(row.qty or 0)
	return totals


def _exception_items_from_codes(totals):
	"""Build exception-row item lines from {item_code: qty}.

	V2 fix: _find_mismatched_linked_kots used to return items=[] and
	estimated_total=0.0, so mismatched KOTs rendered as "No items recorded /
	Rs 0.00" even though their KOT items exist in `tabFood KOT Item`.
	Rates come from Item Price (Standard Selling), falling back to the
	Item standard_rate — the same lookup get_served_kot_exceptions uses
	for uninvoiced rows.
	"""
	items = []
	total = 0.0
	for code, qty in (totals or {}).items():
		if not code:
			continue
		rate = frappe.db.get_value(
			"Item Price",
			{"item_code": code, "price_list": "Standard Selling"},
			"price_list_rate",
		)
		if rate is None:
			rate = frappe.db.get_value("Item", code, "standard_rate") or 0.0
		rate = flt(rate)
		amount = rate * flt(qty or 0)
		items.append({
			"item_code": code,
			"item_name": frappe.db.get_value("Item", code, "item_name") or code,
			"qty": flt(qty or 0),
			"rate": rate,
			"amount": amount,
		})
		total += amount
	return items, total


def _invoice_items_by_code(invoice_doc):
	totals = {}
	for row in getattr(invoice_doc, "items", []) or []:
		totals[row.item_code] = flt(totals.get(row.item_code, 0)) + flt(row.qty or 0)
	return totals


def _live_rate_for_item(item_code, price_list):
	"""Server-side selling price for one item (never trust the client rate)."""
	if not item_code:
		return 0.0
	rate = frappe.db.get_value(
		"Item Price",
		{"item_code": item_code, "price_list": price_list or "Standard Selling", "selling": 1},
		"price_list_rate",
	)
	if rate is not None:
		return flt(rate)
	return flt(frappe.db.get_value("Item", item_code, "standard_rate") or 0)


def _has_recent_pin_approval(action_type, approved_by, item_text, hours=4):
	"""True if this cashier got a fresh manager approval for this item.

	The POS prompts for a PIN (verify_manager_pin) which writes a Food POS
	Audit Log row (Price Override / Zero Price Approval) with the item in
	`details`. A direct API call with no such log can never pass this check,
	which is what makes the client-side "manager_pin: approved" flag useless
	on its own. Window is 4 hours (one shift); approvals do not carry over
	to another day.
	"""
	audit_action = {"price_edit": "Price Override", "free_item": "Zero Price Approval"}.get(action_type)
	if not audit_action or not approved_by:
		return False
	try:
		since = now_datetime() - timedelta(hours=hours)
		rows = frappe.db.sql("""
			SELECT name FROM `tabFood POS Audit Log`
			WHERE action_type = %s AND approved_by = %s AND cashier = %s
			  AND timestamp >= %s AND (details LIKE %s OR details LIKE %s)
			LIMIT 1
		""", (audit_action, approved_by, frappe.session.user, since,
		      f"%{item_text}%", f"%{item_text}%"))
		return bool(rows)
	except Exception:
		return False


def _reprice_and_validate_items(items_list, price_list):
	"""Re-price every cart row from Item Price and enforce PIN approvals.

	- rate 0 + is_free_item: requires a recent Zero Price Approval audit
	  for that item (see _has_recent_pin_approval). Otherwise throw.
	- rate != live rate (live rate > 0): requires a recent Price Override
	  audit for that item. Otherwise throw — never silently accept or
	  silently overwrite a tampered rate.
	- No live price on file (live rate 0): keep the client rate (legacy
	  items without a price record) — the old Rs 0 guard still applies.
	Mutates the rows in place (rate) so the invoice is built on server prices.
	"""
	for row in items_list or []:
		code = row.get("item_code")
		name = row.get("item_name") or code
		client_rate = flt(row.get("rate", 0))
		is_free = cint(row.get("is_free_item"))
		if is_free or client_rate <= 0:
			if not is_free:
				continue  # old Rs 0 guard below (in _build_invoice_doc) throws
			approver = row.get("manager_approved_by") or ""
			if not _has_recent_pin_approval("free_item", approver, name) and not _has_recent_pin_approval("free_item", approver, code or ""):
				frappe.throw(_("Free item '{0}' requires a fresh Manager PIN approval.").format(name))
			row["rate"] = 0.0
			continue
		live = _live_rate_for_item(code, price_list)
		if live > 0 and abs(client_rate - live) > 0.01:
			approver = row.get("manager_approved_by") or ""
			ok = _has_recent_pin_approval("price_edit", approver, name) or _has_recent_pin_approval("price_edit", approver, code or "")
			if not ok:
				frappe.throw(
					_("Unit price for '{0}' is Rs {1}, not Rs {2}. Price edits require a fresh Manager PIN approval.").format(name, live, client_rate)
				)
			# Approved edit: keep the client rate (manager explicitly set it).
		elif live > 0:
			row["rate"] = live


def _require_fresh_discount_pin(order_data, branch_val, disc_pct, disc_amt):
	"""Round 23 fix: over-cap discounts need a FRESH PIN on every settle.

	The old code accepted `discount_approved_by` if ANY old Discount Override
	audit row existed for that manager+cashier — a cashier approved once
	could replay the username forever. That replay path is now removed:
	without a PIN in this request, the settle is refused. The POS already
	sends the PIN it just collected (discount_manager_pin), so the normal
	manager-approved flow is unchanged.
	"""
	mgr_pin = order_data.get("manager_pin") or order_data.get("discount_manager_pin")
	if not mgr_pin:
		frappe.throw(_("Discounts exceeding 10% or Rs 100 require a fresh Manager PIN on every settle. A previous approval cannot be reused."))
	verify_manager_pin(
		pin=mgr_pin,
		action_type="discount",
		cashier=frappe.session.user,
		order_id=order_data.get("order_id") or "",
		details=f"Discount override: {disc_pct}% or Rs {disc_amt}",
	)


def _link_kots_to_invoice(inv, order_data, branch_val, pos_profile_name, order_type):
	"""Link ONLY this order's KOTs to the settled invoice. Round 23 fix.

	Returns the list of KOT names linked. Rules:
	- Candidates are KOTs whose order_id == this order's order_id. No
	  table fallback, no "newest Takeaway KOT" fallback — both are deleted
	  (they were the Round 23 bug: FKOT-00039/00038 landing on unrelated
	  Beef Burger / Mint Margarita invoices).
	- An explicit linked_kot_id from the client is accepted ONLY if that
	  KOT's order_id matches this order (legacy KOTs with no order_id are
	  accepted only after the item-match check below).
	- KOT items (aggregated across all stations for this order) must match
	  the invoice items (item_code + qty). On mismatch the KOTs are left
	  UNLINKED and an error is logged — the invoice still settles (cash was
	  taken, food was served) but the exception report now catches the
	  mismatch instead of it vanishing.
	- Linking uses db.set_value ONLY after the order_id + item checks pass.
	  Choice documented: get_doc().save() is NOT used here because save()
	  runs _validate_ready_items, which throws when the kitchen has not
	  ticked every item done — a normal settle must not fail for that.
	  Integrity is enforced by the checks above plus the pre-link
	  already-linked checks below, and by FoodKOT.validate() on any later
	  Desk/API save of the KOT.
	- If this order has no order_id (old client / direct API), nothing is
	  linked. The KOT stays open and appears in the uninvoiced exceptions.
	"""
	linked = []
	pos_order_id = str(order_data.get("order_id") or order_data.get("pos_order_id") or "").strip()
	if _kot_has_order_field() and pos_order_id:
		for kot in _find_open_kots_for_order(pos_order_id):
			linked.append(kot.name)
		# Also include Served KOTs for this order that were never linked
		# (e.g. kitchen marked Served before settle).
		for kot in frappe.get_all(
			"Food KOT",
			filters={
				"order_id": pos_order_id,
				"status": "Served",
				"is_voided": ["in", [0, None]],
				"sales_invoice": ["in", [None, ""]],
			},
			fields=["name"],
		):
			if kot.name not in linked:
				linked.append(kot.name)

	if not linked:
		explicit = order_data.get("linked_kot_id") or order_data.get("kot_id")
		if explicit:
			for k_id in [k.strip() for k in str(explicit).split(",") if k.strip()]:
				if not frappe.db.exists("Food KOT", k_id):
					continue
				kot_order = frappe.db.get_value("Food KOT", k_id, "order_id") if _kot_has_order_field() else None
				if pos_order_id and kot_order and str(kot_order) != pos_order_id:
					frappe.log_error(
						f"KOT {k_id} belongs to order {kot_order}, not {pos_order_id}; ignoring explicit link on invoice {inv.name}.",
						"Food POS KOT Link Guard",
					)
					continue
				if frappe.db.get_value("Food KOT", k_id, "sales_invoice"):
					continue
				linked.append(k_id)

	if not linked:
		return []

	# Item-match check (aggregated across stations) before linking anything.
	kot_items = _kot_items_by_code(linked)
	inv_items = _invoice_items_by_code(inv)
	if kot_items and inv_items and kot_items != inv_items:
		frappe.log_error(
			f"KOT items {kot_items} do not match invoice {inv.name} items {inv_items} "
			f"(order {pos_order_id or 'unknown'}). KOTs {linked} left UNLINKED for the exception report.",
			"Food POS KOT Link Guard",
		)
		return []

	linked_names = []
	for k_name in linked:
		existing_inv = frappe.db.get_value("Food KOT", k_name, "sales_invoice")
		if existing_inv:
			frappe.log_error(f"KOT {k_name} already linked to invoice {existing_inv}, skipping re-link", "Food POS KOT Link Guard")
			continue
		existing_kot = frappe.db.get_value("Food KOT", {"sales_invoice": inv.name, "name": ["!=", k_name]}, "name")
		if existing_kot:
			# Another KOT already linked to this invoice: allowed ONLY if it
			# is for the same order (multi-station). Otherwise refuse.
			other_order = frappe.db.get_value("Food KOT", existing_kot, "order_id") if _kot_has_order_field() else None
			if not (pos_order_id and other_order and str(other_order) == pos_order_id):
				frappe.log_error(f"Invoice {inv.name} already linked to KOT {existing_kot} from another order, skipping duplicate link", "Food POS KOT Link Guard")
				continue
		# Link and submit through the KOT controller. Submitting runs on_submit,
		# which only accepts a Served KOT, so the ledger lock is enforced.
		kot = frappe.get_doc("Food KOT", k_name)
		kot.status = "Served"
		kot.sales_invoice = inv.name
		kot.is_settled = 1
		kot.flags.ignore_permissions = True  # system link made while settling the invoice
		kot.save()
		if kot.docstatus == 0:
			kot.submit()
		linked_names.append(k_name)
		try:
			audit = frappe.new_doc("Food POS Audit Log")
			audit.timestamp = now_datetime()
			audit.cashier = frappe.session.user or "Administrator"
			audit.branch = SINGLE_BRANCH
			audit.pos_profile = pos_profile_name
			audit.action_type = "KOT Status Change"
			audit.details = f"KOT {k_name} settled and linked to Invoice {inv.name} ({order_type}, Total: {inv.grand_total})"
			audit.flags.ignore_permissions = True
			audit.insert()
		except Exception as e:
			frappe.log_error(f"Audit log failed for KOT settle link: {e}", "Food POS Audit Log")
	return linked_names


# ──────────────────────────────────────────────────────────────────────────────
# 5. Kitchen Order Ticket (KOT)
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def _get_item_station(item, branch_val):
	require_pos_access()
	txt = (str(item.get("item_name", "")) + " " + str(item.get("item_code", "")) + " " + str(item.get("item_group", ""))).lower()
	if "pizza" in txt:
		base_station = "Pizza"
	elif "burger" in txt or "grill" in txt or "sandwich" in txt:
		base_station = "Grill"
	elif "beverage" in txt or "drink" in txt or "margarita" in txt or "shake" in txt or "juice" in txt:
		base_station = "Beverages"
	else:
		base_station = "Main Kitchen"

	# v2: stations are single-branch; the old "{Branch}-{Station}" name is
	# never built. `branch_val` is kept in the signature for callers.
	return base_station


def _ensure_kitchen_station(station):
	"""Return the Food Kitchen Station docname for a base station name.

	v5.7: Food KOT.kitchen_station is a Link to Food Kitchen Station, whose
	documents are named "{branch}-{station_name}" (e.g.
	"Main Branch-Main Kitchen"). create_kot used to store the BARE station
	name ("Main Kitchen"), which failed link validation on save
	("Could not find Branch: Main Branch, Kitchen Station: Main Kitchen")
	on any site where the station doc did not exist — and the bare name
	could never validate even when it did. This helper ensures the Branch
	and the station doc exist (same on-demand pattern as
	_get_walk_in_customer) and returns the full docname. The seed patch
	(v0.4.0) also creates all four stations on migrate.
	"""
	branch_val = SINGLE_BRANCH
	if not frappe.db.exists("Branch", branch_val):
		try:
			b = frappe.get_doc({"doctype": "Branch", "branch": branch_val})
			b.flags.ignore_permissions = True
			b.insert()
		except Exception:
			pass
	docname = f"{branch_val}-{station}"
	if not frappe.db.exists("Food Kitchen Station", docname):
		try:
			st = frappe.get_doc({
				"doctype": "Food Kitchen Station",
				"branch": branch_val,
				"station_name": station,
				"is_active": 1,
			})
			st.flags.ignore_permissions = True
			st.insert()
		except Exception:
			pass
	return docname


@frappe.whitelist()
def create_kot(order_data):
	"""
	Generate Kitchen Order Ticket(s) (KOT) routed to appropriate kitchen stations
	without requiring payment settlement. Automatically marks the assigned table as
	Occupied for Dine-In orders.
	"""
	require_pos_access()
	if isinstance(order_data, str):
		order_data = json.loads(order_data)

	items = order_data.get("items") or order_data.get("cart_items") or []
	if not items:
		frappe.throw(_("Cannot create a Kitchen Order Ticket with zero items."))

	# Round 23 fix: every cart gets one POS order token, generated here if
	# the browser did not send one. The token is returned to the POS and is
	# the ONLY key KOT creation, hold/resume and settle may join on.
	pos_order_id = _resolve_pos_order_id(order_data)
	has_order_field = _kot_has_order_field()

	order_type = order_data.get("order_type", "Dine In")
	table_no = order_data.get("table", "")
	branch_val = SINGLE_BRANCH  # v2: single branch; a client-sent branch is ignored.

	if table_no and not frappe.db.exists("Restaurant Table", table_no):
		# The client may send the printed table number (e.g. "T5") instead
		# of the document name; resolve it by table_no, never by branch.
		table_no = frappe.db.get_value("Restaurant Table", {"table_no": str(table_no)}, "name") or ""

	# Multi-station routing: group items by kitchen station
	station_items = {}
	for row in items:
		stn = _get_item_station(row, branch_val)
		if stn not in station_items:
			station_items[stn] = []
		station_items[stn].append(row)

	created_kots = []
	reused_kot_names = set()
	for station, s_items in station_items.items():
		# v5.7: store the station DOCNAME ("Main Branch-Main Kitchen"),
		# not the bare station name — kitchen_station is a Link and the
		# bare name fails validation on save. The helper also creates
		# the Branch / station doc if it is missing.
		station_doc = _ensure_kitchen_station(station)
		# Round 23 fix: a second "Send to Kitchen" for the same order +
		# station must REUSE the open KOT, never create a duplicate.
		# (One KOT per station per order is allowed; two for the same
		# station is always a duplicate — that is how FKOT-00038/00039
		# were created for one Club Sandwich cart.)
		if has_order_field:
			existing = _find_open_kots_for_order(pos_order_id, kitchen_station=station_doc)
			if existing:
				reused = frappe.get_doc("Food KOT", existing[0].name)
				# Items added to the cart since the first send still have
				# to reach the kitchen: append only the missing ones.
				_have = {(r.item_code, r.item_note or "") for r in reused.items}
				_added = False
				for row in s_items:
					key = (row["item_code"], row.get("item_note", "") or "")
					if key not in _have:
						reused.append("items", {
							"item_code": row["item_code"],
							"item_name": row.get("item_name") or row["item_code"],
							"qty": flt(row.get("qty", 1)),
							"item_note": row.get("item_note", ""),
							"is_done": 0,
						})
						_added = True
				if _added:
					reused.save()
				reused_kot_names.add(reused.name)
				created_kots.append(reused)
				continue
		kot = frappe.new_doc("Food KOT")
		kot.status = "Pending"
		if has_order_field:
			kot.order_id = pos_order_id
		kot.order_type = order_type
		kot.table = table_no
		kot.order_note = order_data.get("order_note", "")
		kot.pos_profile = order_data.get("pos_profile", "")
		kot.branch = branch_val
		kot.kitchen_station = station_doc  # v5.7: full docname, not bare station name.

		if order_data.get("customer"):
			kot.customer = order_data["customer"]

		for row in s_items:
			kot.append("items", {
				"item_code": row["item_code"],
				"item_name": row.get("item_name") or row["item_code"],
				"qty": flt(row.get("qty", 1)),
				"item_note": row.get("item_note", ""),
				"is_done": 0
			})

		kot.save()
		created_kots.append(kot)

	# If Dine In, update the table state to Occupied
	if order_type == "Dine In" and table_no and frappe.db.exists("Restaurant Table", table_no):
		primary_kot = created_kots[0].name if created_kots else ""
		# v2: never reset the live table timer — a second station KOT for
		# the same order must not restart occupied_since.
		existing_since = frappe.db.get_value("Restaurant Table", table_no, "occupied_since")
		existing_status = frappe.db.get_value("Restaurant Table", table_no, "status")
		# v7.2: compute the timer start once — the publish below must
		# carry the SAME value the DB just stored.
		new_since = existing_since if existing_status == "Occupied" and existing_since else now_datetime()
		set_table_fields(table_no, {
				"status": "Occupied",
				"order_id": primary_kot,
				"occupied_since": new_since,
				"guests": cint(order_data.get("guests", 1))
			})
		frappe.publish_realtime(
			"fpos_table_status_changed",
			{
				"table": table_no,
				"status": "Occupied",
				"order_id": primary_kot,
				"occupied_since": str(new_since),
			},
		after_commit=True,
	)

	for kot_doc in created_kots:
		if kot_doc.name in reused_kot_names:
			continue  # Round 23 fix: a reused KOT was not created now.
		try:
			audit = frappe.new_doc("Food POS Audit Log")
			audit.timestamp = now_datetime()
			audit.action_type = "KOT Created"
			audit.branch = SINGLE_BRANCH
			audit.cashier = frappe.session.user
			audit.table = str(table_no or "")
			audit.details = f"Kitchen ticket {kot_doc.name} created for station {kot_doc.kitchen_station} ({len(kot_doc.items)} items)"
			audit.flags.ignore_permissions = True
			audit.insert()
		except Exception:
			pass

	kot_names = [k.name for k in created_kots]
	return {
		"success": True,
		"kot_names": kot_names,
		"kot_name": ", ".join(kot_names),
		"kot_id": ", ".join(kot_names),
		"order_id": pos_order_id,
		"status": "Pending",
		"table": table_no
	}


# ──────────────────────────────────────────────────────────────────────────────
# 6. Invoicing & Checkout (POS Invoice / Sales Invoice)
# ──────────────────────────────────────────────────────────────────────────────



def _get_or_create_pos_opening_entry(pos_profile, company):
	"""Name of today's open shift for the profile; opens one if needed. Raises on failure."""
	return open_shift(pos_profile, company, None)["name"]


def get_pos_invoice_doctype():
	"""
	Check POS Settings to determine whether the POS register is operating in
	'Sales Invoice' or 'POS Invoice' mode in Frappe/ERPNext v16.
	"""
	try:
		invoice_type = frappe.db.get_single_value("POS Settings", "invoice_type")
		if invoice_type == "Sales Invoice":
			return "Sales Invoice"
		if invoice_type == "POS Invoice" and _table_exists("tabPOS Invoice"):
			return "POS Invoice"
	except Exception:
		pass
	return "Sales Invoice"


@frappe.whitelist()
def submit_pos_invoice(order_data, payments):
	"""
	Generate, calculate taxes, and submit an ERPNext POS Invoice (or Sales Invoice fallback).
	Frees up the table into Available status and cancels pending KOTs.
	"""
	require_pos_access()
	if isinstance(order_data, str):
		order_data = json.loads(order_data)
	if isinstance(payments, str):
		payments = json.loads(payments)

	pos_profile_name = order_data.get("pos_profile")
	profile_data = get_pos_profile_data(pos_profile_name)
	branch_val = SINGLE_BRANCH  # v2: single branch; profile/client branch values are ignored.

	# Determine doctype dynamically from POS Settings
	inv_doctype = get_pos_invoice_doctype()

	company = profile_data["company"]
	raw_cust = order_data.get("customer") or order_data.get("customer_name")
	if raw_cust and frappe.db.exists("Customer", raw_cust):
		customer = raw_cust
	elif profile_data.get("customer") and frappe.db.exists("Customer", profile_data["customer"]):
		customer = profile_data["customer"]
	else:
		customer = _get_walk_in_customer(company)

	pos_opening_name = order_data.get("pos_opening_entry") or _get_or_create_pos_opening_entry(pos_profile_name, company)

	def _get_account_for_mode_of_payment(mode_of_payment, cmp):
		acc = frappe.db.get_value(
			"Mode of Payment Account",
			{"parent": mode_of_payment, "company": cmp},
			"default_account"
		)
		if not acc:
			acc = frappe.get_cached_value("Company", cmp, "default_cash_account")
		return acc

	def _build_invoice_doc(doctype, opening_name=None):
		draft_name = order_data.get("draft_invoice_name")
		doc = None
		if draft_name and frappe.db.exists(doctype, draft_name):
			existing = frappe.get_doc(doctype, draft_name)
			if existing.docstatus == 0:
				doc = existing

		if not doc:
			doc = frappe.new_doc(doctype)

		doc.company = company
		doc.pos_profile = pos_profile_name
		doc.posting_date = getdate()
		doc.posting_time = now_datetime().strftime("%H:%M:%S")
		doc.customer = customer
		doc.selling_price_list = profile_data.get("selling_price_list")
		doc.currency = profile_data.get("currency")
		doc.is_pos = 1
		doc.is_created_using_pos = 0
		doc.update_stock = cint(profile_data.get("update_stock", 0))

		if doctype == "POS Invoice" and opening_name:
			doc.pos_opening_entry = opening_name

		# Truthful cashier attribution: owner is the actual authenticated cashier session user
		doc.owner = frappe.session.user or "Administrator"

		# v7.1: when the invoice settles a KOT, the KOT is the source of
		# truth for order type + table — copy them when the client did not
		# send them (any resume/sync path), so a Dine-In order is stored
		# as "Dine In" instead of falling back to "Takeaway".
		kot_ref = order_data.get("linked_kot_id") or order_data.get("kot_id")
		if kot_ref and (not order_data.get("order_type") or not order_data.get("table")):
			try:
				kot_name = str(kot_ref).split(",")[0].strip()
				kot_vals = frappe.db.get_value("Food KOT", kot_name, ["order_type", "table"])
				if kot_vals:
					kot_type, kot_table = kot_vals
					if kot_type and not order_data.get("order_type"):
						order_data["order_type"] = kot_type
					if kot_table and not order_data.get("table"):
						order_data["table"] = kot_table
			except Exception:
				pass
		order_type = order_data.get("order_type") or ("Dine In" if order_data.get("table") else "Takeaway")
		# Delivery validation
		if order_type == "Delivery":
			cust_val = str(order_data.get("customer") or order_data.get("customer_name") or "").strip()
			phone = str(order_data.get("phone") or order_data.get("contact_phone") or "").strip()
			address = str(order_data.get("delivery_address") or "").strip()
			if not cust_val or cust_val == "Walk-in Customer":
				frappe.throw(_("Customer name is mandatory for Delivery orders."))
			if not phone:
				frappe.throw(_("Customer contact phone is mandatory for Delivery orders."))
			if not address:
				frappe.throw(_("Delivery address is mandatory for Delivery orders."))

		# v2 single branch: one naming series for every invoice. The BR1
		# series is kept so numbering continues from the existing sequence.
		doc.naming_series = SINGLE_NAMING_SERIES

		if profile_data.get("cost_center"):
			doc.cost_center = profile_data["cost_center"]

		# Restaurant custom fields (safe check)
		meta = frappe.get_meta(doctype)
		if meta.has_field("custom_order_type"):
			doc.custom_order_type = order_type
		if meta.has_field("order_type"):
			doc.order_type = order_type
		if meta.has_field("custom_table"):
			doc.custom_table = order_data.get("table", "")
		if meta.has_field("custom_order_note"):
			doc.custom_order_note = order_data.get("order_note", "")
		if meta.has_field("custom_branch"):
			doc.custom_branch = SINGLE_BRANCH  # legacy field kept
		if meta.has_field("custom_contact_phone"):
			doc.custom_contact_phone = order_data.get("phone") or order_data.get("contact_phone") or ""
		if meta.has_field("custom_delivery_address"):
			doc.custom_delivery_address = order_data.get("delivery_address") or ""
		if meta.has_field("custom_delivery_charges"):
			doc.custom_delivery_charges = flt(order_data.get("delivery_charges", 0))

		# Items — Round 23 fix: re-price server-side BEFORE building the
		# invoice. Client-supplied rates are never trusted (a direct API call
		# could otherwise sell a Rs 600 item for Rs 1, or for free).
		items_list = order_data.get("items") or order_data.get("cart_items") or []
		_reprice_and_validate_items(items_list, profile_data.get("selling_price_list"))
		for row in items_list:
			rate = flt(row.get("rate", 0))
			if rate <= 0:
				if not cint(row.get("is_free_item")):
					frappe.throw(_("Item '{0}' cannot be sold at Rs {1}. Free items require Manager PIN approval.").format(
						row.get("item_name") or row.get("item_code"), rate
					))

			doc.append("items", {
				"item_code": row["item_code"],
				"item_name": row.get("item_name") or row["item_code"],
				"qty": flt(row.get("qty", 1)),
				"rate": rate,
				"uom": row.get("uom") or "Nos",
				"description": row.get("item_note", ""),
				"warehouse": profile_data.get("warehouse"),
			})

		# Discount with Cashier Cap & Manager PIN Guard
		disc_pct = flt(order_data.get("discount_percentage", 0))
		disc_amt = flt(order_data.get("discount_amount", 0))
		if disc_pct > 10.0 or disc_amt > 100.0:
			# Round 23 fix: fresh PIN on EVERY over-cap settle. The old
			# discount_approved_by replay (any old audit row) is removed.
			_require_fresh_discount_pin(
				order_data,
				SINGLE_BRANCH,  # v2: PIN is no longer branch-scoped.
				disc_pct, disc_amt,
			)

		if disc_pct:
			doc.additional_discount_percentage = disc_pct
		elif disc_amt:
			doc.discount_amount = disc_amt

		# First set missing values & calculate totals before populating payments
		doc.set_missing_values(for_validate=True)
		doc.calculate_taxes_and_totals()

		# Determine total to settle
		total_amount = flt(doc.rounded_total) or flt(doc.grand_total)

		# Build and attach payments with mode, amount, base_amount and account
		doc.set("payments", [])
		total_paid = sum(flt(p.get("amount", 0)) for p in payments)

		# Guarantee full settlement coverage
		resolved_payments = [dict(p) for p in payments]
		if not resolved_payments or total_paid < total_amount:
			diff = total_amount - total_paid
			default_mop = "Cash"
			if profile_data.get("payments"):
				default_mop = profile_data["payments"][0].get("mode_of_payment") or "Cash"
			if resolved_payments:
				resolved_payments[0]["amount"] = flt(resolved_payments[0].get("amount", 0)) + diff
			else:
				resolved_payments = [{"mode_of_payment": default_mop, "amount": total_amount}]

		for p in resolved_payments:
			amt = flt(p.get("amount", 0))
			if amt <= 0:
				continue
			mop = p.get("mode_of_payment", "Cash")
			account = _get_account_for_mode_of_payment(mop, company)
			doc.append("payments", {
				"mode_of_payment": mop,
				"amount": amt,
				"base_amount": flt(amt * flt(doc.conversion_rate or 1.0)),
				"account": account,
			})

		doc.paid_amount = sum(flt(p.amount) for p in doc.payments)
		doc.base_paid_amount = flt(doc.paid_amount * flt(doc.conversion_rate or 1.0))

		if doc.paid_amount >= total_amount:
			doc.outstanding_amount = 0.0
			if doc.paid_amount > total_amount:
				doc.change_amount = doc.paid_amount - total_amount
				doc.base_change_amount = flt(doc.change_amount * flt(doc.conversion_rate or 1.0))
				if not doc.account_for_change_amount:
					doc.account_for_change_amount = frappe.get_cached_value("Company", company, "default_cash_account")
		else:
			doc.outstanding_amount = total_amount - doc.paid_amount

		doc.save()
		doc.submit()

		# Ensure custom_order_type is unconditionally persisted
		if meta.has_field("custom_order_type"):
			frappe.db.set_value(doctype, doc.name, "custom_order_type", order_type, update_modified=False)
			doc.custom_order_type = order_type
		if meta.has_field("order_type"):
			frappe.db.set_value(doctype, doc.name, "order_type", order_type, update_modified=False)
			doc.order_type = order_type

		# Maintain truthful cashier attribution to actual session user
		if frappe.session.user and doc.owner != frappe.session.user:
			frappe.db.set_value(doctype, doc.name, "owner", frappe.session.user, update_modified=False)
			doc.owner = frappe.session.user

		# Enforce status is Paid
		doc.reload()
		if (flt(doc.outstanding_amount) <= 0 or flt(doc.paid_amount) >= total_amount) and doc.status != "Paid":
			doc.db_set("outstanding_amount", 0.0)
			doc.db_set("status", "Paid")
			doc.status = "Paid"

		return doc

	inv = None
	actual_doctype = inv_doctype
	if inv_doctype == "POS Invoice":
		try:
			inv = _build_invoice_doc("POS Invoice", pos_opening_name)
		except Exception as e:
			frappe.log_error(frappe.get_traceback(), f"POS Invoice submit failed, falling back to Sales Invoice: {e}")
			if hasattr(frappe, "clear_messages"):
				frappe.clear_messages()
			if hasattr(frappe.local, "message_log"):
				frappe.local.message_log = []
			actual_doctype = "Sales Invoice"
			inv = _build_invoice_doc("Sales Invoice")
	else:
		inv = _build_invoice_doc("Sales Invoice")

	# Free table -> Available
	order_type = order_data.get("order_type") or getattr(inv, "custom_order_type", "") or "Takeaway"
	raw_table = order_data.get("table") or order_data.get("table_no")
	resolved_table = None
	if raw_table:
		if frappe.db.exists("Restaurant Table", raw_table):
			resolved_table = raw_table
		else:
			matched = frappe.db.get_value(
				"Restaurant Table",
				{"table_no": str(raw_table)},
				"name"
			)  # v2: table lookup by number only, no branch filter.
			if matched:
				resolved_table = matched

	if resolved_table:
		set_table_fields(resolved_table, {
				"status": "Available",
				"order_id": None,
				"occupied_since": None,
				# v7.1: clear the guest count too — force_free_table already
				# sets guests: 0, but the settle path did not, so an Available
				# table kept showing "Guests: 1" after payment.
				"guests": 0,
			})
		frappe.publish_realtime(
			"fpos_table_status_changed",
			{
				"table": resolved_table,
				"status": "Available",
				"order_id": None,
				"occupied_since": None,
			},
		after_commit=True,
	)

	# Link and reconcile KOTs with this settled invoice — Round 23 fix.
	# ONLY this order's KOTs (matched by order_id, items checked). The old
	# table-fallback and Takeaway-newest-KOT fallback are deleted here; they
	# were the Round 23 P0 (unrelated KOTs silently attached to invoices).
	linked_kot_names = _link_kots_to_invoice(
		inv, order_data, branch_val, pos_profile_name, order_type
	)

	# Comprehensive Audit Log for Order Settlement
	try:
		table_val = order_data.get("table_no") or order_data.get("table") or resolved_table or raw_table or ""
		audit_settle = frappe.new_doc("Food POS Audit Log")
		audit_settle.timestamp = now_datetime()
		audit_settle.cashier = frappe.session.user or "Administrator"
		audit_settle.branch = SINGLE_BRANCH
		audit_settle.pos_profile = pos_profile_name
		audit_settle.action_type = "Order Settled"
		audit_settle.order_id = inv.name
		audit_settle.table = str(table_val or "")
		mops_summary = ", ".join([f"{p.get('mode_of_payment')}: Rs {flt(p.get('amount'))}" for p in (payments or []) if flt(p.get('amount')) > 0])
		change_val = flt(getattr(inv, "change_amount", 0.0))
		kot_info = f", KOTs: {', '.join(linked_kot_names)}" if linked_kot_names else ""
		audit_settle.details = f"Settled invoice {inv.name} ({order_type}, Table: {table_val or 'N/A'}, Grand Total: Rs {inv.grand_total}, Tendered: [{mops_summary}], Change: Rs {change_val}{kot_info})"
		audit_settle.flags.ignore_permissions = True
		audit_settle.insert()
	except Exception as e:
		frappe.log_error(f"Audit log failed for order settlement: {e}", "Food POS Audit Log")


	slip_items = []
	for it in getattr(inv, "items", []):
		slip_items.append({
			"item_code": it.item_code,
			"item_name": it.item_name,
			"qty": flt(it.qty),
			"rate": flt(it.rate),
			"amount": flt(it.amount),
			"description": getattr(it, "description", "")
		})

	slip_payments = []
	for p in getattr(inv, "payments", []):
		slip_payments.append({
			"mode_of_payment": p.mode_of_payment,
			"amount": flt(p.amount)
		})

	return {
		"invoice": inv.name,
		"invoice_id": inv.name,
		"invoice_name": inv.name,
		"invoice_type": actual_doctype,
		"grand_total": flt(inv.grand_total),
		"paid_amount": flt(inv.paid_amount),
		"change_amount": flt(getattr(inv, "change_amount", 0.0)),
		"outstanding_amount": flt(getattr(inv, "outstanding_amount", 0.0)),
		"status": inv.status or "Paid",
		"customer": inv.customer,
		"customer_name": getattr(inv, "customer_name", inv.customer),
		"posting_date": str(inv.posting_date),
		"posting_time": _format_time_hh_mm(inv.posting_time),
		"currency": inv.currency,
		"company": inv.company,
		"pos_profile": pos_profile_name,
		"branch": SINGLE_BRANCH,
		"items": slip_items,
		"payments": slip_payments,
		"net_total": flt(getattr(inv, "net_total", inv.grand_total)),
		"total_taxes_and_charges": flt(getattr(inv, "total_taxes_and_charges", 0.0)),
		"discount_amount": flt(getattr(inv, "discount_amount", 0.0)),
		"order_type": order_type,
		"custom_order_type": getattr(inv, "custom_order_type", order_type) or order_type,
		"table": getattr(inv, "custom_table", order_data.get("table", "")) or "",
		"table_no": getattr(inv, "custom_table", order_data.get("table", "")) or "",
		"custom_table": getattr(inv, "custom_table", order_data.get("table", "")) or "",
		"custom_restaurant_table": getattr(inv, "custom_table", order_data.get("table", "")) or "",
		"phone": getattr(inv, "custom_contact_phone", order_data.get("phone", "")),
		"delivery_address": getattr(inv, "custom_delivery_address", order_data.get("delivery_address", "")),
		"delivery_charges": flt(getattr(inv, "custom_delivery_charges", order_data.get("delivery_charges", 0))),
	}


@frappe.whitelist()
def save_draft_order(order_data=None):
	"""
	Cart state lives strictly in client memory/localStorage until checkout.
	Guarantees no phantom draft Sales Invoices or POS Invoices are written to database
	on cart edits, item additions, or order type switches.
	"""
	require_pos_access()
	return {
		"success": True,
		"draft_invoice_name": None,
		"message": _("Cart state lives strictly in client memory until checkout.")
	}


@frappe.whitelist()
def get_active_draft_tabs(pos_profile=None):
	"""
	Retrieve all draft POS or Sales Invoices (docstatus = 0) for active cashier / POS Profile.
	Returns detailed tab structures including items, customer, table, and order type.
	"""
	require_pos_access()
	inv_doctype = get_pos_invoice_doctype()
	if not _table_exists(f"tab{inv_doctype}"):
		return []

	filters = {"docstatus": 0, "is_pos": 1}
	if pos_profile:
		filters["pos_profile"] = pos_profile

	meta = frappe.get_meta(inv_doctype)
	fields = ["name", "customer", "grand_total", "creation", "modified", "pos_profile", "owner"]
	if meta.has_field("custom_table"):
		fields.append("custom_table")
	if meta.has_field("custom_order_type"):
		fields.append("custom_order_type")
	if meta.has_field("custom_order_note"):
		fields.append("custom_order_note")

	draft_invoices = frappe.get_all(inv_doctype, filters=filters, fields=fields, order_by="creation asc")
	item_table = f"{inv_doctype} Item"

	tabs = []
	for inv in draft_invoices:
		items = frappe.get_all(
			item_table,
			filters={"parent": inv.name},
			fields=["item_code", "item_name", "qty", "rate", "amount", "uom", "description"],
		)
		tabs.append({
			"id": inv.name,
			"draft_invoice_name": inv.name,
			"invoice_type": inv_doctype,
			"customer": inv.customer,
			"table": inv.get("custom_table") or "",
			"order_type": inv.get("custom_order_type") or "Dine In",
			"order_note": inv.get("custom_order_note") or "",
			"grand_total": flt(inv.grand_total),
			"items": items,
			"creation": inv.creation,
		})

	return tabs


@frappe.whitelist()
def discard_draft_order(invoice_name, table=None):
	"""
	Discard a draft POS or Sales Invoice, free its table if no other active orders exist,
	and notify connected clients.
	"""
	require_pos_access()
	if not invoice_name:
		return {"success": False, "message": "No invoice specified"}

	for dt in ["Sales Invoice", "POS Invoice"]:
		if frappe.db.exists(dt, invoice_name):
			inv = frappe.get_doc(dt, invoice_name)
			if not table and hasattr(inv, "custom_table"):
				table = inv.custom_table
			if inv.docstatus == 0:
				frappe.delete_doc(dt, invoice_name)
			break

	if table and frappe.db.exists("Restaurant Table", table):
		# Check if any other draft POS/Sales Invoice or pending KOT exists for this table
		other_drafts = []
		for dt in ["Sales Invoice", "POS Invoice"]:
			if _table_exists(f"tab{dt}") and frappe.get_meta(dt).has_field("custom_table"):
				other_drafts.extend(frappe.get_all(
					dt,
					filters={"custom_table": table, "docstatus": 0},
					limit=1
				))
				if other_drafts:
					break

		other_kots = frappe.get_all(
			"Food KOT",
			filters={"table": table, "status": ["in", ["Pending", "In Progress", "Ready", "Served"]]},
			limit=1
		)

		if other_kots:
			frappe.throw(
				_("Cannot discard order for Table {0}. Kitchen ticket {1} is currently active or served. Settle payment or record an authorized Manager Void.").format(
					table, other_kots[0].name
				)
			)

		if not other_drafts and not other_kots:
			set_table_fields(table, {
					"status": "Available",
					"order_id": None,
					"occupied_since": None,
				})
			frappe.publish_realtime(
				"fpos_table_status_changed",
				{
					"table": table,
					"status": "Available",
					"order_id": None,
					"occupied_since": None,
				},
			after_commit=True,
		)

	return {"success": True}


def _unpaid_pos_invoice_rows(pos_profile=None):
	filters = {"docstatus": 1, "is_pos": 1, "outstanding_amount": [">", 0]}
	if pos_profile:
		filters["pos_profile"] = pos_profile
	return frappe.get_all(
		"Sales Invoice",
		filters=filters,
		fields=["name", "customer", "posting_date", "company", "grand_total", "outstanding_amount"],
		order_by="posting_date asc, name asc",
	)


@frappe.whitelist()
def get_unpaid_pos_invoices(pos_profile=None):
	"""Read-only: POS invoices with an outstanding balance."""
	require_pos_access()
	return _unpaid_pos_invoice_rows(pos_profile)


@frappe.whitelist()
def settle_unpaid_pos_invoices(pos_profile=None, invoices=None):
	"""Manager action: record a Cash Payment Entry for each outstanding POS invoice.

	Uses ERPNext's Payment Entry flow, so the receipt posts to the ledger.
	Each invoice runs in its own savepoint; a failed invoice is rolled back and
	reported without affecting the others.
	"""
	require_pos_access()
	require_pos_manager()
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	if isinstance(invoices, str):
		invoices = frappe.parse_json(invoices)
	rows = _unpaid_pos_invoice_rows(pos_profile)
	if invoices:
		wanted = set(invoices)
		rows = [r for r in rows if r.name in wanted]

	settled, failed = [], []
	for row in rows:
		savepoint = "settle_unpaid_pos"
		frappe.db.savepoint(savepoint)
		try:
			cash_account = frappe.get_cached_value("Company", row.company, "default_cash_account")
			if not cash_account:
				frappe.throw(_("Company {0} has no default cash account.").format(row.company))
			payment = get_payment_entry(
				"Sales Invoice",
				row.name,
				party_amount=row.outstanding_amount,
				bank_account=cash_account,
			)
			payment.mode_of_payment = "Cash"
			payment.insert()
			payment.submit()
			settled.append({"invoice": row.name, "payment_entry": payment.name})
		except Exception:
			frappe.db.rollback(save_point=savepoint)
			frappe.log_error(frappe.get_traceback(), f"Failed to settle unpaid POS invoice {row.name}")
			failed.append(row.name)

	return {"settled": settled, "failed": failed}


@frappe.whitelist()
def get_shift_closing_details(pos_profile=None, pos_opening_entry=None):
	"""
	Returns complete shift summary, invoices, taxes, and payment reconciliation
	for closing the current active POS Opening Entry in Frappe/ERPNext v16.
	"""
	require_pos_access()
	user = frappe.session.user or "Administrator"
	pos_profile_name = pos_profile or _get_default_pos_profile_for_user(user)
	profile_data = get_pos_profile_data(pos_profile_name) if pos_profile_name else {}
	company = profile_data.get("company") or frappe.defaults.get_global_default("company")
	currency = profile_data.get("currency") or "USD"
	today = getdate()

	opening_entry_doc = None
	if pos_opening_entry and _table_exists("tabPOS Opening Entry"):
		try:
			opening_entry_doc = frappe.get_doc("POS Opening Entry", pos_opening_entry)
		except Exception:
			pass

	if not opening_entry_doc and _table_exists("tabPOS Opening Entry") and pos_profile_name:
		openings = check_opening_entry(user=user, pos_profile=pos_profile_name)
		if openings:
			opening_entry_doc = frappe.get_doc("POS Opening Entry", openings[0].name)

	if not opening_entry_doc and _table_exists("tabPOS Opening Entry") and pos_profile_name:
		openings = frappe.db.get_all(
			"POS Opening Entry",
			filters={"pos_profile": pos_profile_name, "docstatus": 1, "status": "Open"},
			order_by="period_start_date desc",
			limit=1,
		)
		if openings:
			opening_entry_doc = frappe.get_doc("POS Opening Entry", openings[0].name)

	opening_name = opening_entry_doc.name if opening_entry_doc else None
	shift_start = str(opening_entry_doc.period_start_date) if opening_entry_doc else None
	if opening_entry_doc:
		company = opening_entry_doc.company

	# Opening amounts by payment mode
	opening_by_mode = {}
	opening_cash = 0.0
	if opening_entry_doc:
		for d in getattr(opening_entry_doc, "balance_details", []):
			mop = d.mode_of_payment
			amt = flt(d.opening_amount)
			opening_by_mode[mop] = amt
			if "cash" in (mop or "").lower():
				opening_cash += amt

	# Invoices query
	inv_doctype = get_pos_invoice_doctype()
	invoice_records = []

	if opening_entry_doc and opening_entry_doc.user:
		frappe.db.sql(
			"""
			UPDATE `tabSales Invoice`
			SET owner = %(user)s, is_created_using_pos = 1
			WHERE pos_profile = %(pos_profile)s
			  AND docstatus = 1
			  AND is_pos = 1
			  AND (pos_closing_entry IS NULL OR pos_closing_entry = '')
			  AND creation >= %(start_time)s
			""",
			{
				"user": opening_entry_doc.user,
				"pos_profile": pos_profile_name,
				"start_time": opening_entry_doc.period_start_date,
			}
		)

	if inv_doctype == "Sales Invoice" and _table_exists("tabSales Invoice"):
		si_conds = ["docstatus = 1", "is_pos = 1"]
		params = {}
		if pos_profile_name:
			si_conds.append("pos_profile = %(pos_profile)s")
			params["pos_profile"] = pos_profile_name
		if opening_entry_doc:
			si_conds.append("creation >= %(start_time)s")
			params["start_time"] = opening_entry_doc.period_start_date
			si_cols = frappe.db.get_table_columns("Sales Invoice") or []
			if "pos_closing_entry" in si_cols:
				si_conds.append("(pos_closing_entry IS NULL OR pos_closing_entry = '')")
		else:
			si_conds.append("posting_date = %(today)s")
			params["today"] = today

		si_cols = frappe.db.get_table_columns("Sales Invoice") or []
		order_type_col = "custom_order_type" if "custom_order_type" in si_cols else "NULL as custom_order_type"
		# v6.2: table columns feed the shared order-type fallback below.
		table_col = "custom_table" if "custom_table" in si_cols else "NULL as custom_table"
		rest_table_col = "custom_restaurant_table" if "custom_restaurant_table" in si_cols else "NULL as custom_restaurant_table"
		query = f"""
			SELECT
				name, 'Sales Invoice' as doctype, posting_date, posting_time, customer, customer_name,
				grand_total, net_total, total_qty, total_taxes_and_charges, discount_amount,
				paid_amount, outstanding_amount, change_amount, account_for_change_amount, {order_type_col}, {table_col}, {rest_table_col}
			FROM `tabSales Invoice`
			WHERE {' AND '.join(si_conds)}
			ORDER BY creation DESC
		"""
		try:
			invoice_records = frappe.db.sql(query, params, as_dict=True)
		except Exception:
			invoice_records = []
	elif _table_exists("tabPOS Invoice"):
		psi_conds = ["docstatus = 1", "(consolidated_invoice IS NULL OR consolidated_invoice = '')"]
		params = {}
		if pos_profile_name:
			psi_conds.append("pos_profile = %(pos_profile)s")
			params["pos_profile"] = pos_profile_name
		if opening_entry_doc:
			params["opening_entry"] = opening_name
			params["start_time"] = opening_entry_doc.period_start_date
			psi_cols = frappe.db.get_table_columns("POS Invoice") or []
			if "pos_opening_entry" in psi_cols:
				psi_conds.append("(pos_opening_entry = %(opening_entry)s OR creation >= %(start_time)s)")
			else:
				psi_conds.append("creation >= %(start_time)s")
		else:
			psi_conds.append("posting_date = %(today)s")
			params["today"] = today

		psi_cols = frappe.db.get_table_columns("POS Invoice") or []
		order_type_col = "custom_order_type" if "custom_order_type" in psi_cols else "NULL as custom_order_type"
		# v6.2: table columns feed the shared order-type fallback below.
		table_col = "custom_table" if "custom_table" in psi_cols else "NULL as custom_table"
		rest_table_col = "custom_restaurant_table" if "custom_restaurant_table" in psi_cols else "NULL as custom_restaurant_table"

		query = f"""
			SELECT
				name, 'POS Invoice' as doctype, posting_date, posting_time, customer, customer_name,
				grand_total, net_total, total_qty, total_taxes_and_charges, discount_amount,
				paid_amount, outstanding_amount, {order_type_col}, {table_col}, {rest_table_col}
			FROM `tabPOS Invoice`
			WHERE {' AND '.join(psi_conds)}
			ORDER BY creation DESC
		"""
		try:
			invoice_records = frappe.db.sql(query, params, as_dict=True)
		except Exception:
			invoice_records = []

	all_inv_names = [r["name"] for r in invoice_records]
	collected_by_mode = {}
	cash_sales = 0.0

	if all_inv_names:
		payments_data = frappe.db.sql(
			"""
			SELECT mode_of_payment, account, SUM(amount) as amount, COUNT(name) as count
			FROM `tabSales Invoice Payment`
			WHERE parent IN %(inv_names)s
			GROUP BY mode_of_payment, account
			""",
			{"inv_names": tuple(all_inv_names)},
			as_dict=True
		)

		change_by_account = {}
		for inv in invoice_records:
			acc = inv.get("account_for_change_amount")
			if acc:
				change_by_account[acc] = change_by_account.get(acc, 0) + flt(inv.get("change_amount", 0))

		for p in payments_data:
			mop = p.get("mode_of_payment") or "Cash"
			amt = flt(p.get("amount", 0))
			if change_by_account.get(p.get("account")):
				amt -= flt(change_by_account.get(p.get("account")))
				change_by_account[p.get("account")] = 0

			if mop not in collected_by_mode:
				collected_by_mode[mop] = {"mode_of_payment": mop, "amount": 0.0, "count": 0}
			collected_by_mode[mop]["amount"] += amt
			collected_by_mode[mop]["count"] += cint(p.get("count", 0))

			if "cash" in mop.lower():
				cash_sales += amt

	# Build full payment reconciliation
	all_modes = set(opening_by_mode.keys()) | set(collected_by_mode.keys())
	if profile_data.get("payments"):
		for p in profile_data["payments"]:
			all_modes.add(p.get("mode_of_payment"))
	if not all_modes:
		all_modes = {"Cash"}

	payment_reconciliation = []
	for mop in sorted(all_modes):
		op_amt = flt(opening_by_mode.get(mop, 0))
		inv_info = collected_by_mode.get(mop, {})
		inv_amt = flt(inv_info.get("amount", 0))
		exp_amt = op_amt + inv_amt
		payment_reconciliation.append({
			"mode_of_payment": mop,
			"opening_amount": op_amt,
			"invoice_amount": inv_amt,
			"expected_amount": exp_amt,
			"closing_amount": exp_amt,
			"difference": 0.0,
			"count": inv_info.get("count", 0),
		})

	# Summary metrics
	total_orders = len(invoice_records)
	net_sales = sum(flt(r.get("grand_total", 0)) for r in invoice_records)
	gross_sales = sum(flt(r.get("net_total", 0)) for r in invoice_records)
	total_taxes = sum(flt(r.get("total_taxes_and_charges", 0)) for r in invoice_records)
	total_discounts = sum(flt(r.get("discount_amount", 0)) for r in invoice_records)
	total_paid = sum(flt(r.get("paid_amount", 0)) for r in invoice_records)
	total_outstanding = sum(flt(r.get("outstanding_amount", 0)) for r in invoice_records)

	# Order types breakdown
	# v6.2: same fallback as get_recent_pos_orders — a missing type is
	# "Dine In" only when a table is set, else "Takeaway". The old
	# hard-coded "Dine In" made the closing page disagree with Home
	# for bills whose type was never stored.
	order_types_map = {}
	for r in invoice_records:
		_tbl = r.get("custom_table") or r.get("custom_restaurant_table") or ""
		ot = r.get("custom_order_type") or ("Dine In" if _tbl else "Takeaway")
		if ot not in order_types_map:
			order_types_map[ot] = {"order_type": ot, "count": 0, "amount": 0.0}
		order_types_map[ot]["count"] += 1
		order_types_map[ot]["amount"] += flt(r.get("grand_total", 0))
	order_types = list(order_types_map.values())

	# Top items
	top_items = []
	if all_inv_names:
		item_tables = ["tabPOS Invoice Item", "tabSales Invoice Item"]
		for itable in item_tables:
			if _table_exists(itable):
				try:
					top_items = frappe.db.sql(
						f"""
						SELECT
							item_code, item_name, SUM(qty) as qty, SUM(amount) as amount
						FROM `{itable}`
						WHERE parent IN %(inv_names)s
						GROUP BY item_code
						ORDER BY amount DESC
						LIMIT 8
						""",
						{"inv_names": tuple(all_inv_names)},
						as_dict=True
					)
					if top_items:
						break
				except Exception:
					pass

	return {
		"pos_profile": pos_profile_name,
		"company": company,
		"user": user,
		"user_fullname": frappe.utils.get_fullname(user),
		"today": str(today),
		"shift_start": shift_start,
		"currency": currency,
		"total_orders": total_orders,
		"net_sales": net_sales,
		"gross_sales": gross_sales,
		"total_taxes": total_taxes,
		"total_discounts": total_discounts,
		"total_paid": total_paid,
		"total_outstanding": total_outstanding,
		"payment_modes": list(collected_by_mode.values()),
		"payment_reconciliation": payment_reconciliation,
		"order_types": order_types,
		"top_items": top_items,
		"opening_cash": opening_cash,
		"cash_sales": cash_sales,
		"expected_cash": opening_cash + cash_sales,
		"opening_entry": opening_name,
		"invoices": invoice_records,
		"recent_invoices": invoice_records[:10],
	}


@frappe.whitelist()
def get_today_closing_details(pos_profile=None, pos_opening_entry=None):
	"""Compatibility alias for get_shift_closing_details."""
	require_pos_access()
	return get_shift_closing_details(pos_profile=pos_profile, pos_opening_entry=pos_opening_entry)


@frappe.whitelist()
def create_and_submit_pos_closing_entry(pos_profile, pos_opening_entry, payments=None, closing_notes=None):
	"""
	Aggregates all shift data and creates/submits a standard ERPNext v16 POS Closing Entry.
	Automatically triggers ERPNext v16's on_submit logic which:
	  - Consolidates POS Invoices into Sales Invoices
	  - Deducts inventory and posts Stock Ledger Entries
	  - Posts General Ledger accounting transactions
	  - Marks POS Opening Entry status as Closed
	"""
	require_pos_access()
	if not _table_exists("tabPOS Closing Entry"):
		# Without the POS Closing Entry DocType there is no reconciled closing
		# document, so the shift must not be marked closed silently.
		frappe.throw(_("POS Closing Entry is not installed on this site. The shift was not closed."))

	if not pos_opening_entry:
		frappe.throw(_("POS Opening Entry is required to close a shift."))

	if isinstance(payments, str):
		payments = json.loads(payments)
	payments = payments or []

	opening_doc = frappe.get_doc("POS Opening Entry", pos_opening_entry)

	if opening_doc.status != "Open":
		frappe.throw(_("Selected POS Opening Entry ({0}) is not Open (Status: {1}).").format(
			pos_opening_entry, opening_doc.status
		))

	company = opening_doc.company

	# 1. Retrieve all submitted POS / Sales Invoices for this shift window
	inv_doctype = get_pos_invoice_doctype()

	# Determine shift time window bounded by next opening entry if any
	next_opening_start = frappe.db.sql(
		"""
		SELECT period_start_date FROM `tabPOS Opening Entry`
		WHERE pos_profile = %s AND period_start_date > %s AND docstatus = 1
		ORDER BY period_start_date ASC LIMIT 1
		""",
		(pos_profile, opening_doc.period_start_date)
	)
	period_end = next_opening_start[0][0] if next_opening_start else now_datetime()

	if opening_doc.user:
		frappe.db.sql(
			"""
			UPDATE `tabSales Invoice`
			SET owner = %(user)s, is_created_using_pos = 1
			WHERE pos_profile = %(pos_profile)s
			  AND docstatus = 1
			  AND is_pos = 1
			  AND (pos_closing_entry IS NULL OR pos_closing_entry = '')
			  AND creation >= %(start_time)s
			  AND creation < %(end_time)s
			""",
			{
				"user": opening_doc.user,
				"pos_profile": pos_profile,
				"start_time": opening_doc.period_start_date,
				"end_time": period_end,
			}
		)

	params = {
		"pos_profile": pos_profile,
		"user": opening_doc.user,
		"period_start_date": opening_doc.period_start_date,
		"period_end_date": period_end,
		"opening_entry": pos_opening_entry,
	}

	invoices = []
	if inv_doctype == "Sales Invoice":
		inv_conds = [
			"docstatus = 1",
			"is_pos = 1",
			"pos_profile = %(pos_profile)s",
			"owner = %(user)s",
		]
		si_cols = frappe.db.get_table_columns("Sales Invoice") or []
		if "pos_closing_entry" in si_cols:
			inv_conds.append("(pos_closing_entry IS NULL OR pos_closing_entry = '')")
		if "is_created_using_pos" in si_cols:
			inv_conds.append("is_created_using_pos = 1")
		inv_conds.append("creation >= %(period_start_date)s")
		inv_conds.append("creation < %(period_end_date)s")

		invoices = frappe.db.sql(
			f"""
			SELECT name, posting_date, grand_total, net_total, total_qty, total_taxes_and_charges,
			       change_amount, account_for_change_amount, customer, is_return, return_against
			FROM `tabSales Invoice`
			WHERE {' AND '.join(inv_conds)}
			ORDER BY creation ASC
			""",
			params,
			as_dict=True,
		)
	else:
		inv_conds = [
			"docstatus = 1",
			"pos_profile = %(pos_profile)s",
			"owner = %(user)s",
			"(consolidated_invoice IS NULL OR consolidated_invoice = '')",
		]
		psi_cols = frappe.db.get_table_columns("POS Invoice") or []
		if "pos_opening_entry" in psi_cols:
			inv_conds.append("(pos_opening_entry = %(opening_entry)s OR (creation >= %(period_start_date)s AND creation < %(period_end_date)s))")
		else:
			inv_conds.append("creation >= %(period_start_date)s")
			inv_conds.append("creation < %(period_end_date)s")
			inv_conds.append("creation >= %(period_start_date)s")

		invoices = frappe.db.sql(
			f"""
			SELECT name, posting_date, grand_total, net_total, total_qty, total_taxes_and_charges,
			       change_amount, account_for_change_amount, customer, is_return, return_against
			FROM `tabPOS Invoice`
			WHERE {' AND '.join(inv_conds)}
			ORDER BY creation ASC
			""",
			params,
			as_dict=True,
		)

	# 2. Retrieve payment details from Sales Invoice Payment for these invoices
	inv_names = [inv.name for inv in invoices]
	collected_by_mode = {}
	if inv_names:
		payment_records = frappe.db.sql(
			"""
			SELECT mode_of_payment, account, SUM(amount) as amount
			FROM `tabSales Invoice Payment`
			WHERE parenttype = %(inv_doctype)s AND parent IN %(inv_names)s
			GROUP BY mode_of_payment, account
			""",
			{"inv_doctype": inv_doctype, "inv_names": tuple(inv_names)},
			as_dict=True,
		)
		# Deduct change amount
		change_by_account = {}
		for inv in invoices:
			acc = inv.get("account_for_change_amount")
			if acc:
				change_by_account[acc] = change_by_account.get(acc, 0) + flt(inv.get("change_amount", 0))

		for pr in payment_records:
			mop = pr.mode_of_payment
			amt = flt(pr.amount)
			if change_by_account.get(pr.account):
				amt -= flt(change_by_account.get(pr.account))
				change_by_account[pr.account] = 0
			collected_by_mode[mop] = collected_by_mode.get(mop, 0) + amt

	# 3. Retrieve taxes from Sales Taxes and Charges
	taxes_data = []
	if inv_names:
		taxes_data = frappe.db.sql(
			"""
			SELECT account_head, SUM(tax_amount_after_discount_amount) as tax_amount
			FROM `tabSales Taxes and Charges`
			WHERE parenttype = %(inv_doctype)s AND parent IN %(inv_names)s
			GROUP BY account_head
			""",
			{"inv_doctype": inv_doctype, "inv_names": tuple(inv_names)},
			as_dict=True,
		)

	# 4. Opening amounts from POS Opening Entry balance_details
	opening_by_mode = {}
	for d in getattr(opening_doc, "balance_details", []):
		opening_by_mode[d.mode_of_payment] = flt(d.opening_amount)

	# Build reconciled payment dictionary from caller input and system calculation
	all_modes = set(opening_by_mode.keys()) | set(collected_by_mode.keys())
	try:
		prof_doc = frappe.get_cached_doc("POS Profile", pos_profile)
		for p in (getattr(prof_doc, "payments", []) or []):
			all_modes.add(p.mode_of_payment)
	except Exception:
		pass

	caller_counts = {}
	for p in payments:
		mop = p.get("mode_of_payment")
		if mop:
			all_modes.add(mop)
			caller_counts[mop] = flt(p.get("closing_amount", p.get("amount", 0)))

	payment_reconciliation_rows = []
	for mop in sorted(all_modes):
		op_amt = flt(opening_by_mode.get(mop, 0))
		inv_amt = flt(collected_by_mode.get(mop, 0))
		exp_amt = op_amt + inv_amt
		closing_amt = caller_counts.get(mop, exp_amt)
		diff = closing_amt - exp_amt

		payment_reconciliation_rows.append({
			"mode_of_payment": mop,
			"opening_amount": op_amt,
			"expected_amount": exp_amt,
			"closing_amount": closing_amt,
			"difference": diff,
		})

	# 5. Build and populate POS Closing Entry
	closing = frappe.new_doc("POS Closing Entry")
	closing.pos_opening_entry = pos_opening_entry
	closing.pos_profile = pos_profile
	closing.user = opening_doc.user
	closing.company = company
	closing.period_start_date = opening_doc.period_start_date
	closing.period_end_date = period_end
	closing.posting_date = getdate()
	closing.posting_time = now_datetime().strftime("%H:%M:%S")

	closing.grand_total = 0.0
	closing.net_total = 0.0
	closing.total_quantity = 0.0
	closing.total_taxes_and_charges = 0.0

	# Attach invoices to pos_invoices or sales_invoices child table based on inv_doctype
	child_field = "sales_invoices" if inv_doctype == "Sales Invoice" else "pos_invoices"
	ref_field = "sales_invoice" if inv_doctype == "Sales Invoice" else "pos_invoice"
	for inv in invoices:
		closing.append(child_field, {
			ref_field: inv.name,
			"posting_date": inv.posting_date,
			"grand_total": flt(inv.grand_total),
			"customer": inv.customer,
			"is_return": cint(inv.is_return),
			"return_against": inv.return_against,
		})
		closing.grand_total += flt(inv.grand_total)
		closing.net_total += flt(inv.net_total)
		closing.total_quantity += flt(inv.total_qty)
		closing.total_taxes_and_charges += flt(inv.total_taxes_and_charges)

	# Attach taxes
	for t in taxes_data:
		closing.append("taxes", {
			"account_head": t.account_head,
			"amount": flt(t.tax_amount),
		})

	# Attach payment_reconciliation
	for pr in payment_reconciliation_rows:
		closing.append("payment_reconciliation", pr)

	if closing_notes:
		meta = frappe.get_meta("POS Closing Entry")
		if meta.has_field("custom_closing_notes"):
			closing.custom_closing_notes = closing_notes
		elif meta.has_field("remarks"):
			closing.remarks = closing_notes

	# Populate pos_transactions virtual attribute for compatibility
	closing.__dict__["pos_transactions"] = closing.sales_invoices if inv_doctype == "Sales Invoice" else closing.pos_invoices

	# 6. Insert and Submit
	closing.insert()
	closing.submit()

	# Re-populate pos_transactions attribute after reload/submit
	closing.__dict__["pos_transactions"] = closing.sales_invoices if inv_doctype == "Sales Invoice" else closing.pos_invoices

	# Ensure sales invoices have pos_closing_entry link updated
	if inv_doctype == "Sales Invoice":
		for row in (closing.sales_invoices or []):
			if row.sales_invoice:
				frappe.db.set_value("Sales Invoice", row.sales_invoice, "pos_closing_entry", closing.name, update_modified=False)

	# 7. Safety check: ensure POS Opening Entry is marked Closed
	if frappe.db.get_value("POS Opening Entry", pos_opening_entry, "status") != "Closed":
		frappe.db.set_value("POS Opening Entry", pos_opening_entry, {
			"status": "Closed",
			"pos_closing_entry": closing.name,
		}, update_modified=False)


	return {
		"success": True,
		"closing_entry": closing.name,
		"name": closing.name,
		"message": _("POS Closing Entry {0} submitted successfully.").format(closing.name),
	}



def autoname_pos_closing_entry(doc, method=None):
	"""
	Monotonic series allocation for POS Closing Entry.
	Guarantees no sequence numbers are burned on failed or aborted shift closures.
	"""
	year = now_datetime().year
	prefix = f"POS-CLO-{year}-"
	res = frappe.db.sql("""
		SELECT MAX(CAST(SUBSTRING_INDEX(name, '-', -1) AS UNSIGNED))
		FROM `tabPOS Closing Entry`
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
	doc.name = f"{prefix}{next_idx:05d}"

	if series_val:
		frappe.db.sql("UPDATE `tabSeries` SET current = %s WHERE name = %s", (next_idx, prefix))
	else:
		frappe.db.sql("INSERT INTO `tabSeries` (name, current) VALUES (%s, %s)", (prefix, next_idx))


def pos_closing_entry_onload(doc, method=None):
	"""Ensure doc.get('pos_transactions') and doc.pos_transactions return linked invoices."""
	txs = doc.get("sales_invoices") or doc.get("pos_invoices") or []
	doc.__dict__["pos_transactions"] = txs


# ──────────────────────────────────────────────────────────────────────────────
# 7. Offline Sync Engine
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def sync_offline_invoices(invoices):
	"""
	Bulk-processes invoices queued in localStorage while the POS was offline.
	Guarantees background failures do not surface intrusive popup modals in desk.
	"""
	require_pos_access()
	if isinstance(invoices, str):
		invoices = json.loads(invoices)

	results = []
	for item in invoices:
		offline_id = item.get("offline_id")
		order_data = item.get("order_data")
		payments = item.get("payments")

		try:
			res = submit_pos_invoice(order_data, payments)
			results.append({
				"offline_id": offline_id,
				"success": True,
				"invoice": res.get("invoice"),
			})
		except Exception as e:
			frappe.log_error(frappe.get_traceback(), f"POS Offline Sync Failed for {offline_id}")
			if hasattr(frappe, "clear_messages"):
				frappe.clear_messages()
			if hasattr(frappe.local, "message_log"):
				frappe.local.message_log = []
			results.append({
				"offline_id": offline_id,
				"success": False,
				"error": str(e),
			})

	# Ensure no server messages leak popup dialogs to the frontend during background sync
	if hasattr(frappe, "clear_messages"):
		frappe.clear_messages()
	if hasattr(frappe.local, "message_log"):
		frappe.local.message_log = []

	return results


def _table_exists(table_name):
	try:
		res = frappe.db.sql(
			"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %(t)s",
			{"t": table_name}
		)
		return bool(res and res[0][0])
	except Exception:
		return False


# ──────────────────────────────────────────────────────────────────────────────
# 8. Customer Order History & POS Slip Data
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_recent_pos_orders(pos_profile=None, branch=None, limit=15):
	"""
	Fetch the last N customer orders/invoices today with full items and customer details.
	Allows restaurant cashiers to review, view slip, or reload/edit in the cart.
	Resilient to pos_profile name or active shift opening. (v2: no branch.)
	"""
	require_pos_access()
	limit = cint(limit) or 15
	user = frappe.session.user

	# v2: `branch` is accepted for backward compatibility and ignored.
	pos_profiles = set()

	if pos_profile:
		if frappe.db.exists("POS Profile", pos_profile):
			pos_profiles.add(pos_profile)
		else:
			matched = frappe.db.get_all("POS Profile", filters={"name": ["like", f"%{pos_profile}%"]}, pluck="name")
			if matched:
				pos_profiles.update(matched)

	if not pos_profiles:
		open_shift_profile = frappe.db.get_value("POS Opening Entry", {"user": user, "status": "Open", "docstatus": 1}, "pos_profile")
		if open_shift_profile:
			pos_profiles.add(open_shift_profile)
		else:
			def_prof = _get_default_pos_profile_for_user(user)
			if def_prof:
				pos_profiles.add(def_prof)

	orders = []
	conds = []
	params = {"limit": limit}

	if pos_profiles:
		params["profiles"] = tuple(pos_profiles)
		conds.append("pos_profile IN %(profiles)s")

	where_str = (" AND " + " AND ".join(conds)) if conds else ""

	# Fetch from tabSales Invoice
	if _table_exists("tabSales Invoice"):
		si_cols = frappe.db.get_table_columns("Sales Invoice") or []
		order_type_col = "custom_order_type" if "custom_order_type" in si_cols else "NULL as custom_order_type"
		table_col = "custom_table" if "custom_table" in si_cols else "NULL as custom_table"

		si_sql = f"""
			SELECT
				name, 'Sales Invoice' as doctype, posting_date, posting_time,
				customer, customer_name, grand_total, paid_amount, outstanding_amount,
				status, {order_type_col}, {table_col}, creation
			FROM `tabSales Invoice`
			WHERE is_pos = 1 AND docstatus = 1{where_str}
			ORDER BY creation DESC
			LIMIT %(limit)s
		"""
		try:
			orders.extend(frappe.db.sql(si_sql, params, as_dict=True))
		except Exception as e:
			frappe.log_error(f"get_recent_pos_orders SI error: {e}")

	# Fetch from tabPOS Invoice
	if _table_exists("tabPOS Invoice"):
		psi_cols = frappe.db.get_table_columns("POS Invoice") or []
		order_type_col = "custom_order_type" if "custom_order_type" in psi_cols else "NULL as custom_order_type"
		table_col = "custom_table" if "custom_table" in psi_cols else "NULL as custom_table"

		psi_sql = f"""
			SELECT
				name, 'POS Invoice' as doctype, posting_date, posting_time,
				customer, customer_name, grand_total, paid_amount, outstanding_amount,
				status, {order_type_col}, {table_col}, creation
			FROM `tabPOS Invoice`
			WHERE docstatus = 1{where_str}
			ORDER BY creation DESC
			LIMIT %(limit)s
		"""
		try:
			existing_names = {o["name"] for o in orders}
			for r in frappe.db.sql(psi_sql, params, as_dict=True):
				if r["name"] not in existing_names:
					orders.append(r)
		except Exception as e:
			frappe.log_error(f"get_recent_pos_orders PSI error: {e}")

	# Sort descending by creation
	orders.sort(key=lambda x: str(x.get("creation") or ""), reverse=True)
	orders = orders[:limit]

	# Attach items for each order and format timestamp
	for o in orders:
		o["posting_time"] = _format_time_hh_mm(o.get("posting_time"))
		order_type_val = o.get("custom_order_type") or o.get("order_type") or ""
		table_val = o.get("custom_table") or o.get("custom_restaurant_table") or ""
		if not order_type_val:
			order_type_val = "Dine In" if table_val else "Takeaway"
		o["order_type"] = order_type_val
		o["custom_order_type"] = order_type_val
		o["custom_table"] = table_val
		o["custom_restaurant_table"] = table_val
		o["table_no"] = table_val
		o["table"] = table_val
		inv_name = o["name"]
		item_table = "tabSales Invoice Item" if o["doctype"] == "Sales Invoice" else "tabPOS Invoice Item"
		if _table_exists(item_table):
			items = frappe.db.sql(
				f"""
				SELECT item_code, item_name, qty, rate, amount, description
				FROM `{item_table}`
				WHERE parent = %s
				""",
				(inv_name,),
				as_dict=True
			)
			o["items"] = items
			o["item_summary"] = ", ".join([f"{int(i.qty) if i.qty == int(i.qty) else i.qty}x {i.item_name}" for i in items[:3]])
			if len(items) > 3:
				o["item_summary"] += f" +{len(items)-3} more"
		else:
			o["items"] = []
			o["item_summary"] = ""

	return orders


@frappe.whitelist()
def get_invoice_slip_data(invoice_name, doctype=None):
	"""Return comprehensive invoice and payment data for printing customer POS slip."""
	require_pos_access()
	if not doctype:
		doctype = "POS Invoice" if frappe.db.exists("POS Invoice", invoice_name) else "Sales Invoice"

	doc = frappe.get_doc(doctype, invoice_name)
	company = doc.company
	currency = doc.currency or "USD"

	items = []
	for it in doc.items:
		items.append({
			"item_code": it.item_code,
			"item_name": it.item_name,
			"qty": flt(it.qty),
			"rate": flt(it.rate),
			"amount": flt(it.amount),
			"description": getattr(it, "description", "")
		})

	payments = []
	for p in getattr(doc, "payments", []):
		payments.append({
			"mode_of_payment": p.mode_of_payment,
			"amount": flt(p.amount)
		})

	ot_val = getattr(doc, "custom_order_type", "") or getattr(doc, "order_type", "")
	tbl_val = getattr(doc, "custom_table", "") or getattr(doc, "table", "") or ""
	if not ot_val:
		ot_val = "Dine In" if tbl_val else "Takeaway"

	return {
		"invoice": doc.name,
		"doctype": doctype,
		"company": company,
		"pos_profile": getattr(doc, "pos_profile", ""),
		"branch": SINGLE_BRANCH,
		"posting_date": str(doc.posting_date),
		"posting_time": _format_time_hh_mm(doc.posting_time),
		"customer": doc.customer,
		"customer_name": getattr(doc, "customer_name", doc.customer),
		"currency": currency,
		"net_total": flt(getattr(doc, "net_total", doc.grand_total)),
		"total_taxes_and_charges": flt(getattr(doc, "total_taxes_and_charges", 0.0)),
		"discount_amount": flt(getattr(doc, "discount_amount", 0.0)),
		"grand_total": flt(doc.grand_total),
		"paid_amount": flt(doc.paid_amount),
		"change_amount": flt(getattr(doc, "change_amount", 0.0)),
		"outstanding_amount": flt(getattr(doc, "outstanding_amount", 0.0)),
		"status": doc.status or "Paid",
		"order_type": ot_val,
		"custom_order_type": ot_val,
		"table": tbl_val,
		"table_no": tbl_val,
		"custom_table": tbl_val,
		"custom_restaurant_table": tbl_val,
		"phone": getattr(doc, "custom_contact_phone", "") or getattr(doc, "contact_mobile", ""),
		"delivery_address": getattr(doc, "custom_delivery_address", "") or getattr(doc, "shipping_address", ""),
		"delivery_charges": flt(getattr(doc, "custom_delivery_charges", 0.0)),
		"items": items,
		"payments": payments,
		# v2 thermal bill: KOT numbers + pending amount, so the customer
		# bill (and the pre-payment dine-in slip) can show them.
		"kot_numbers": _kot_numbers_for_invoice(doc.name),
		"order_id": _order_id_for_invoice(doc.name),
		"pending_amount": max(0.0, flt(doc.grand_total) - flt(doc.paid_amount)),
		"payment_status": "Pending" if flt(getattr(doc, "outstanding_amount", 0.0)) > 0 else "Paid",
	}


# ──────────────────────────────────────────────────────────────────────────────
# 9. Real-time Kitchen Tracking (KOT)
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def get_active_kitchen_kots(pos_profile=None, branch=None, station=None):
	"""
	Fetch all active Kitchen Order Tickets (Pending, In Progress, Ready, Served)
	with items, remaining cooking items, table number, order type, and elapsed time.
	Supports filtering by POS profile and kitchen station. (v2: no branch.)
	Excludes settled, invoiced, voided, or cancelled tickets.
	v7.1: "Served" joins the list — a KOT the kitchen marked Served (food
	delivered) is still UNPAID until it is settled, so hiding it made it
	vanish from both the KDS drawer and the Pending page (live: FKOT-2026-00002
	was nowhere to be found). The same function feeds both views, so one
	fix covers both.
	"""
	require_pos_access()
	filters = {
		"status": ["in", ["Pending", "In Progress", "Ready", "Served"]],
		"is_settled": ["in", [0, None]],
		"sales_invoice": ["in", [None, ""]],
		"is_voided": ["in", [0, None]],
		"docstatus": ["!=", 2],
	}
	if pos_profile:
		filters["pos_profile"] = pos_profile  # v2: no branch filter.

	if station and station != "All":
		filters["kitchen_station"] = ["like", f"%{station}%"]

	kots = frappe.get_all(
		"Food KOT",
		filters=filters,
		fields=["name", "status", "order_type", "table", "customer", "order_note", "creation", "modified", "pos_profile", "branch", "kitchen_station", "order_id"],
		order_by="creation asc"
	)

	for kot in kots:
		items = frappe.get_all(
			"Food KOT Item",
			filters={"parent": kot.name},
			fields=["name", "item_code", "item_name", "qty", "item_note", "is_done"]
		)
		# v5.12: price items from the profile's selling price list (same
		# source as get_kot_for_payment) so the Pending Payments drawer can
		# show each bill's amount and print the pending bill.
		price_list = "Standard Selling"
		try:
			if kot.get("pos_profile"):
				profile_data = get_pos_profile_data(kot.pos_profile)
				price_list = profile_data.get("selling_price_list") or price_list
		except Exception:
			pass
		kot_total = 0
		for it in items:
			rate = frappe.db.get_value(
				"Item Price",
				{"item_code": it.item_code, "price_list": price_list, "selling": 1},
				"price_list_rate",
			)
			if rate is None:
				rate = frappe.db.get_value(
					"Item Price",
					{"item_code": it.item_code, "price_list": "Standard Selling", "selling": 1},
					"price_list_rate",
				) or 0
			it["rate"] = flt(rate)
			it["amount"] = flt(it.qty) * flt(rate)
			kot_total += it["amount"]
		kot["total"] = kot_total
		kot["items"] = items
		kot["total_items"] = len(items)
		if kot.status in ["Ready", "Served"]:
			kot["done_items"] = len(items)
			kot["remaining_items"] = 0
		else:
			kot["done_items"] = sum(1 for it in items if cint(it.get("is_done")))
			kot["remaining_items"] = max(0, len(items) - kot["done_items"])
		kot["time_ago"] = frappe.utils.pretty_date(kot.creation)
		if kot.table:
			kot["table_no"] = kot.table.split("-")[-1]

	return kots


@frappe.whitelist()
def get_kot_for_payment(kot_name):
	"""
	v5.9: return an unsettled KOT with priced items so the cashier can bill
	it from the Live Kitchen Orders drawer — even after a reload wiped the
	cart. Rates come from the profile's selling price list (same source as
	get_items); Food KOT Item itself stores no rate.
	"""
	require_pos_access()
	if not kot_name or not frappe.db.exists("Food KOT", kot_name):
		frappe.throw(_("Kitchen ticket {0} not found").format(kot_name))
	kot = frappe.get_doc("Food KOT", kot_name)
	if kot.is_settled or kot.sales_invoice:
		frappe.throw(_("Kitchen ticket {0} is already settled").format(kot_name))
	if kot.is_voided:
		frappe.throw(_("Kitchen ticket {0} is voided").format(kot_name))

	price_list = "Standard Selling"
	try:
		if kot.pos_profile:
			profile_data = get_pos_profile_data(kot.pos_profile)
			price_list = profile_data.get("selling_price_list") or price_list
	except Exception:
		pass

	items = []
	for it in kot.items or []:
		rate = frappe.db.get_value(
			"Item Price",
			{"item_code": it.item_code, "price_list": price_list, "selling": 1},
			"price_list_rate",
		)
		if rate is None:
			rate = frappe.db.get_value(
				"Item Price",
				{"item_code": it.item_code, "price_list": "Standard Selling", "selling": 1},
				"price_list_rate",
			) or 0
		items.append({
			"item_code": it.item_code,
			"item_name": it.item_name,
			"qty": flt(it.qty),
			"rate": flt(rate),
			"amount": flt(it.qty) * flt(rate),
			"item_note": it.item_note or "",
			"uom": "Nos",
		})

	return {
		"kot_name": kot.name,
		"order_id": kot.order_id or "",
		"order_type": kot.order_type or "Dine In",
		"table": kot.table or "",
		"customer": kot.customer or "",
		"pos_profile": kot.pos_profile or "",
		"order_note": kot.order_note or "",
		"status": kot.status,
		"items": items,
	}


@frappe.whitelist()
def update_kot_item_done_status(kot_name, item_name=None, is_done=0, row_id=None):
	"""Update completion flag for individual item in KOT with accurate row resolution."""
	require_pos_access()
	is_done = cint(is_done)
	target_row = None
	if row_id and frappe.db.exists("Food KOT Item", row_id):
		target_row = row_id
	elif kot_name:
		target_row = frappe.db.get_value("Food KOT Item", {"parent": kot_name, "name": item_name}, "name")
		if not target_row:
			target_row = frappe.db.get_value("Food KOT Item", {"parent": kot_name, "item_name": item_name}, "name")
		if not target_row:
			target_row = frappe.db.get_value("Food KOT Item", {"parent": kot_name, "item_code": item_name}, "name")

	if target_row:
		frappe.db.set_value("Food KOT Item", target_row, "is_done", is_done, update_modified=True)

	# Recalculate remaining & done count
	all_items = frappe.get_all("Food KOT Item", filters={"parent": kot_name}, fields=["is_done"])
	all_done = all(cint(it.is_done) for it in all_items) if all_items else False
	done_count = sum(1 for it in all_items if cint(it.is_done))
	remaining_count = len(all_items) - done_count

	current_status = frappe.db.get_value("Food KOT", kot_name, "status")
	new_status = current_status
	if all_done and current_status in ["Pending", "In Progress"]:
		new_status = "Ready"
		kot_doc = frappe.get_doc("Food KOT", kot_name)
		kot_doc.status = "Ready"
		kot_doc.save()
	elif not all_done and current_status == "Ready":
		new_status = "In Progress"
		kot_doc = frappe.get_doc("Food KOT", kot_name)
		kot_doc.status = "In Progress"
		kot_doc.save()

	return {
		"success": True,
		"kot_status": new_status,
		"all_done": all_done,
		"done_count": done_count,
		"remaining_count": remaining_count,
		"total_items": len(all_items),
	}


@frappe.whitelist()
def update_kot_stage(kot_name, status):
	"""Update KOT lifecycle status: Pending -> In Progress -> Ready -> Served -> Cancelled."""
	require_pos_access()
	allowed = ["Pending", "In Progress", "Ready", "Served", "Cancelled"]
	if status not in allowed:
		frappe.throw(_("Invalid KOT status: {0}").format(status))

	old_status = frappe.db.get_value("Food KOT", kot_name, "status")
	kot_doc = frappe.get_doc("Food KOT", kot_name)
	kot_doc.status = status
	if status in ["Ready", "Served"]:
		for item in kot_doc.items:
			item.is_done = 1
	if status == "Served" and kot_doc.docstatus == 0:
		kot_doc.submit()
	elif status == "Cancelled" and kot_doc.docstatus == 1:
		kot_doc.flags.allow_void_cancel = True
		kot_doc.cancel()
	else:
		kot_doc.save()

	# Audit Log entry for KOT status transition (guaranteed via FoodKOT.on_update or fallback)
	audit_id = getattr(kot_doc.flags, "audit_log_id", None)
	if not audit_id:
		try:
			audit = frappe.new_doc("Food POS Audit Log")
			audit.timestamp = now_datetime()
			audit.action_type = "KOT Status Change"
			audit.branch = kot_doc.branch
			audit.cashier = frappe.session.user
			audit.table = str(kot_doc.table or "")
			audit.details = f"Kitchen ticket {kot_name} status updated from {old_status} to {status} ({kot_doc.kitchen_station or 'Kitchen'})"
			audit.flags.ignore_permissions = True
			audit.insert()
			audit_id = audit.name
		except Exception as e:
			frappe.log_error(f"Audit log failed for KOT status change: {e}", "Food POS Audit Log")

	return {"success": True, "status": status, "audit_log_id": audit_id}


@frappe.whitelist()
def get_kitchen_orders(pos_profile=None, branch=None, station=None):
	"""Alias for get_active_kitchen_kots."""
	require_pos_access()
	return get_active_kitchen_kots(pos_profile=pos_profile, branch=branch, station=station)


@frappe.whitelist()
def update_kot_status(kot_name, status):
	"""Alias for update_kot_stage."""
	require_pos_access()
	return update_kot_stage(kot_name=kot_name, status=status)


@frappe.whitelist()
def toggle_kot_item_done(kot_name, item_name=None, is_done=0, row_id=None):
	"""Alias for update_kot_item_done_status."""
	require_pos_access()
	return update_kot_item_done_status(kot_name=kot_name, item_name=item_name, is_done=is_done, row_id=row_id)


@frappe.whitelist()
def check_table_has_unsettled_kot(table):
	"""
	Check if a table has any active or served KOT tickets not yet linked to a paid invoice.
	Used by frontend to prevent clearing orders or vacating occupied tables without settlement or void.
	"""
	require_pos_access()
	if not table:
		return {"has_kot": False}

	table_short = table.split("-")[-1].strip() if "-" in table else table
	unsettled = frappe.db.sql("""
		SELECT k.name, k.status, k.table
		FROM `tabFood KOT` k
		WHERE (k.table = %(table)s OR k.table = %(table_short)s)
		  AND k.status IN ('Pending', 'In Progress', 'Ready', 'Served')
		  AND NOT EXISTS (
			  SELECT 1 FROM `tabSales Invoice` inv
			  WHERE (inv.custom_table = k.table OR inv.custom_table = %(table)s)
			    AND inv.docstatus = 1
			    AND inv.creation >= k.creation
		  )
		ORDER BY k.creation ASC
		LIMIT 1
	""", {"table": table, "table_short": table_short}, as_dict=True)

	if unsettled:
		return {
			"has_kot": True,
			"kot_name": unsettled[0].name,
			"kot_status": unsettled[0].status,
		}
	return {"has_kot": False}


def _find_mismatched_linked_kots(branch=None, pos_profile=None):
	"""Return exception rows for Served KOTs linked to a mismatched invoice.

	One exception per invoice (not per KOT): a multi-station order has one
	KOT per station, so the KOT items must be aggregated across all KOTs
	linked to that invoice before comparing with the invoice items.
	"""
	conds = ["k.status = 'Served'", "k.sales_invoice IS NOT NULL", "k.sales_invoice != ''",
	         "(k.is_voided = 0 OR k.is_voided IS NULL)"]
	params = {}
	if pos_profile:
		conds.append("k.pos_profile = %(pos_profile)s")
		params["pos_profile"] = pos_profile  # v2: no branch filter.
	rows = frappe.db.sql(f"""
		SELECT k.name, k.branch, k.pos_profile, k.table, k.order_type, k.customer,
			k.order_note, k.creation, k.sales_invoice
		FROM `tabFood KOT` k
		WHERE {' AND '.join(conds)}
		ORDER BY k.creation DESC
	""", params, as_dict=True)
	if not rows:
		return []
	by_invoice = {}
	for r in rows:
		by_invoice.setdefault(r.sales_invoice, []).append(r)
	out = []
	now = now_datetime()
	for inv_name, kots in by_invoice.items():
		kot_items = _kot_items_by_code([k.name for k in kots])
		inv_items = {}
		inv_item_rows = []
		for row in frappe.get_all(
			"Sales Invoice Item", filters={"parent": inv_name, "docstatus": 1},
			fields=["item_code", "item_name", "qty", "rate", "amount"],
		):
			inv_items[row.item_code] = flt(inv_items.get(row.item_code, 0)) + flt(row.qty or 0)
			inv_item_rows.append({
				"item_code": row.item_code,
				"item_name": row.item_name or row.item_code,
				"qty": flt(row.qty or 0),
				"rate": flt(row.rate or 0),
				"amount": flt(row.amount or 0),
			})
		if not inv_items or kot_items == inv_items:
			continue
		# V2 fix: previously items=[] / estimated_total=0.0 were hardcoded
		# here, so mismatched KOTs showed "No items recorded / Rs 0.00".
		# Build the real KOT item lines (aggregated across stations) and
		# price them with the same lookup as uninvoiced rows.
		kot_item_rows, kot_total = _exception_items_from_codes(kot_items)
		first = kots[0]
		elapsed = int((now - first.creation).total_seconds() // 60)
		out.append({
			"name": first.name,
			"branch": first.branch,
			"pos_profile": first.pos_profile,
			"table": first.table or "N/A",
			"table_no": first.table.split("-")[-1].strip() if first.table and "-" in first.table else (first.table or "N/A"),
			"order_type": first.order_type,
			"customer": first.customer or "Walk-in",
			"order_note": first.order_note or "",
			"creation": str(first.creation),
			"elapsed_mins": elapsed,
			"time_ago": frappe.utils.pretty_date(first.creation),
			"items": kot_item_rows,
			"estimated_total": kot_total,
			"status": "Served (Invoice Mismatch)",
			"sales_invoice": inv_name,
			"linked_kots": [k.name for k in kots],
			"kot_items": kot_items,
			"invoice_items": inv_items,
			"invoice_item_rows": inv_item_rows,
		})
	return out


@frappe.whitelist()
def get_served_kot_exceptions(branch=None, pos_profile=None):
	"""
	Fetch all Served KOTs that have no linked submitted invoice and no manager void trace.
	This is the mandatory manager exception list reviewed daily to ensure no food order vanishes.
	"""
	require_pos_access()
	conds = [
		"k.status = 'Served'",
		"k.status != 'Cancelled'",
		"k.docstatus != 2",
		"(k.sales_invoice IS NULL OR k.sales_invoice = '')",
		"(k.is_voided = 0 OR k.is_voided IS NULL)"
	]
	params = {}

	if pos_profile:
		conds.append("k.pos_profile = %(pos_profile)s")
		params["pos_profile"] = pos_profile  # v2: no branch filter.

	where_str = " AND ".join(conds)
	sql = f"""
		SELECT
			k.name, k.branch, k.pos_profile, k.table, k.order_type, k.customer,
			k.order_note, k.creation, k.modified, k.owner
		FROM `tabFood KOT` k
		WHERE {where_str}
		ORDER BY k.creation DESC
	"""
	kots = frappe.db.sql(sql, params, as_dict=True)

	exceptions = []
	kot_names = [kot.name for kot in kots]
	items_by_kot = {}
	item_rates = {}
	if kot_names:
		all_items = frappe.db.sql("""
			SELECT parent, name, item_code, item_name, qty, item_note
			FROM `tabFood KOT Item`
			WHERE parent IN %s
		""", (tuple(kot_names),), as_dict=True)
		for it in all_items:
			items_by_kot.setdefault(it.parent, []).append(it)

		all_item_codes = tuple(set(it.item_code for it in all_items if it.item_code))
		if all_item_codes:
			price_records = frappe.db.sql("""
				SELECT item_code, price_list_rate
				FROM `tabItem Price`
				WHERE item_code IN %s AND price_list = 'Standard Selling'
			""", (all_item_codes,), as_dict=True)
			for pr in price_records:
				item_rates[pr.item_code] = flt(pr.price_list_rate)
			for code in all_item_codes:
				if code not in item_rates:
					item_rates[code] = flt(frappe.db.get_value("Item", code, "standard_rate") or 0.0)

	# Round 23 fix, rule 2: Served KOTs linked to the WRONG invoice.
	# The old query only caught Served KOTs with NO invoice, so a Club
	# Sandwich KOT linked to a Beef Burger invoice was invisible. Group
	# KOTs by their linked invoice, aggregate KOT items across all stations
	# for that invoice, and compare against the invoice's own items.
	try:
		_mismatch = _find_mismatched_linked_kots(branch, pos_profile)
		for _m in _mismatch:
			exceptions.append(_m)
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), f"FoodPOS: mismatch exception check failed: {e}")

	now = now_datetime()
	for kot in kots:
		items = items_by_kot.get(kot.name, [])
		est_total = 0.0
		for it in items:
			rate = item_rates.get(it.item_code, 0.0)
			it["rate"] = flt(rate)
			it["amount"] = flt(rate) * flt(it.qty)
			est_total += it["amount"]

		elapsed_mins = int((now - kot.creation).total_seconds() // 60)
		exceptions.append({
			"name": kot.name,
			"branch": kot.branch,
			"pos_profile": kot.pos_profile,
			"table": kot.table or "N/A",
			"table_no": kot.table.split("-")[-1].strip() if kot.table and "-" in kot.table else (kot.table or "N/A"),
			"order_type": kot.order_type,
			"customer": kot.customer or "Walk-in",
			"order_note": kot.order_note or "",
			"creation": str(kot.creation),
			"elapsed_mins": elapsed_mins,
			"time_ago": frappe.utils.pretty_date(kot.creation),
			"items": items,
			"estimated_total": est_total,
			"status": "Served (Uninvoiced)"
		})

	return {
		"count": len(exceptions),
		"exceptions": exceptions
	}


@frappe.whitelist()
def void_served_kot(kot_name, manager_pin, reason):
	"""
	Authorized manager void for an uninvoiced/served KOT.
	Requires valid Manager PIN and mandatory reason.
	Updates KOT with void trace and logs into Food POS Audit Log.
	"""
	require_pos_access()
	if not kot_name or not frappe.db.exists("Food KOT", kot_name):
		frappe.throw(_("Food KOT {0} not found").format(kot_name))

	if not (reason or "").strip():
		frappe.throw(_("Mandatory Void Reason is required to void a Served Kitchen Ticket."))

	# Round 23 fix: pass action_type="void". The old call passed neither,
	# so the capability check was skipped (any valid PIN could void, even
	# one without can_approve_void). v2: no branch is passed (single branch).
	kot = frappe.get_doc("Food KOT", kot_name)
	v = verify_manager_pin(
		(manager_pin or "").strip(),
		action_type="void",
		cashier=frappe.session.user,
		order_id=kot.name,
		table=kot.table,
		details=f"Void Served KOT {kot_name}: {(reason or '').strip()}",
	)
	if not v.get("success"):
		frappe.throw(_("Invalid Manager PIN. Void action denied."))

	manager_user = v.get("approved_by") or frappe.session.user or "Administrator"
	manager_name = v.get("manager_name") or manager_user

	kot.status = "Cancelled"
	kot.is_voided = 1
	kot.voided_by = manager_user
	kot.void_reason = (reason or "").strip()
	kot.void_timestamp = now_datetime()
	kot.flags.allow_void_cancel = True
	if kot.docstatus == 1:
		kot.cancel()
	else:
		kot.save()

	# If this KOT occupied a table, release it
	if kot.table and frappe.db.exists("Restaurant Table", kot.table):
		release_table_if_no_order(kot.table)

	# Calculate estimated value
	est_total = 0.0
	for it in getattr(kot, "items", []):
		rate = frappe.db.get_value("Item Price", {"item_code": it.item_code, "price_list": "Standard Selling"}, "price_list_rate") or 0.0
		est_total += flt(rate) * flt(it.qty)

	# Audit Log Trace
	audit = frappe.new_doc("Food POS Audit Log")
	audit.timestamp = now_datetime()
	audit.cashier = manager_user
	audit.branch = SINGLE_BRANCH  # v2: legacy field kept.
	audit.pos_profile = kot.pos_profile
	audit.action_type = "KOT Voided"
	audit.details = f"Served KOT {kot_name} ({kot.order_type}, Table: {kot.table or 'N/A'}, Est: Rs {est_total}) VOIDED by Manager {manager_name}. Reason: {reason}"
	audit.flags.ignore_permissions = True
	audit.insert()

	return {
		"success": True,
		"message": _("KOT {0} voided and recorded in Manager Audit Log.").format(kot_name)
	}


@frappe.whitelist()
def close_pos_opening_entry(pos_profile, pos_opening_entry=None, payments=None, closing_notes=None):
	"""
	Properly close the current POS Opening Entry for the user and profile.
	Called when the cashier clicks 'Finalize Shift & Exit to Desk' to create
	and submit the POS Closing Entry DocType.
	"""
	require_pos_access()
	if not pos_opening_entry:
		openings = check_opening_entry(user=frappe.session.user, pos_profile=pos_profile)
		if openings:
			pos_opening_entry = openings[0].name

	if not pos_opening_entry:
		return {"success": True, "message": _("No open POS Opening Entry found to close.")}

	return create_and_submit_pos_closing_entry(
		pos_profile=pos_profile,
		pos_opening_entry=pos_opening_entry,
		payments=payments,
		closing_notes=closing_notes,
	)


# ──────────────────────────────────────────────────────────────────────────────
# 10. Held Orders Management (Single Branch & Shift)
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def hold_order(order_data, reason=None):
	"""
	Persistently hold an active order in Food POS Held Order.
	Frees any associated table so other guests aren't blocked.
	"""
	require_pos_access()
	if isinstance(order_data, str):
		order_data = json.loads(order_data)

	items = order_data.get("items") or order_data.get("cart_items") or []
	if not items:
		frappe.throw(_("Cannot hold an empty cart."))

	pos_profile = order_data.get("pos_profile")
	company = (frappe.db.get_value("POS Profile", pos_profile, "company") if pos_profile else None) or frappe.defaults.get_global_default("company") or "Nextash"
	branch = SINGLE_BRANCH  # v2: single branch; client-sent branch is ignored.
	table_no = order_data.get("table")

	held = frappe.new_doc("Food POS Held Order")
	held.status = "Held"
	held.branch = branch
	held.pos_profile = pos_profile
	held.pos_opening_entry = order_data.get("pos_opening_entry")
	held.cashier = frappe.session.user
	held.order_type = order_data.get("order_type", "Dine In")
	held.table = table_no
	raw_cust = order_data.get("customer")
	if raw_cust and frappe.db.exists("Customer", raw_cust):
		held.customer = raw_cust
	else:
		held.customer = _get_walk_in_customer(company)
	held.customer_name = order_data.get("customer_name") or raw_cust or held.customer
	held.phone = order_data.get("phone") or order_data.get("contact_phone")
	held.delivery_address = order_data.get("delivery_address")
	held.delivery_charges = flt(order_data.get("delivery_charges", 0))

	# Price list lookup for live item pricing
	price_list = None
	if pos_profile:
		price_list = frappe.db.get_value("POS Profile", pos_profile, "selling_price_list")
	if not price_list:
		price_list = "Standard Selling"

	# Recompute totals and rates from live item price list
	calc_items_total = 0.0
	for it in items:
		code = it.get("item_code") or it.get("item_name")
		live_rate = None
		if code:
			live_rate = frappe.db.get_value("Item Price", {"item_code": code, "price_list": price_list}, "price_list_rate")
		if live_rate is not None and flt(live_rate) > 0:
			it["rate"] = flt(live_rate)
		elif not it.get("rate"):
			it["rate"] = flt(frappe.db.get_value("Item", code, "standard_rate") or 0)
		qty = flt(it.get("qty", 1))
		it["amount"] = flt(qty * flt(it.get("rate", 0)))
		calc_items_total += it["amount"]

	grand_total_val = calc_items_total + flt(order_data.get("delivery_charges", 0)) - flt(order_data.get("discount_amount", 0))
	held.grand_total = grand_total_val

	held.hold_reason = reason or _("Customer requested hold")

	# Normalize order_data payload so items is always present
	order_data["items"] = items
	order_data["cart_items"] = items
	order_data["grand_total"] = grand_total_val
	held.order_data = json.dumps(order_data)
	held.insert()

	# If Dine In table was specified, maintain Occupied status referencing the held order
	if table_no and frappe.db.exists("Restaurant Table", table_no):
		set_table_fields(table_no, {
				"status": "Occupied",
				"order_id": held.name,
				"occupied_since": now_datetime(),
			})
		frappe.publish_realtime("fpos_table_status_changed", {"table": table_no, "status": "Occupied", "order_id": held.name, "occupied_since": str(now_datetime())}, after_commit=True)

	# Comprehensive Audit Log for Order Held
	try:
		audit_hold = frappe.new_doc("Food POS Audit Log")
		audit_hold.timestamp = now_datetime()
		audit_hold.cashier = frappe.session.user or "Administrator"
		audit_hold.branch = SINGLE_BRANCH
		audit_hold.pos_profile = pos_profile
		audit_hold.action_type = "Order Held"
		audit_hold.order_id = held.name
		audit_hold.table = str(table_no or "")
		audit_hold.details = f"Held order {held.name} created ({held.order_type}, Table: {table_no or 'N/A'}, Grand Total: Rs {held.grand_total}). Reason: {held.hold_reason}"
		audit_hold.flags.ignore_permissions = True
		audit_hold.insert()
	except Exception as e:
		frappe.log_error(f"Audit log failed for order hold: {e}", "Food POS Audit Log")

	held_count = frappe.db.count("Food POS Held Order", filters={"status": "Held"})  # v2: no branch filter.
	return {"success": True, "held_order_id": held.name, "held_count": held_count}


@frappe.whitelist()
def get_held_orders(branch=None, pos_profile=None):
	"""
	Fetch all active held orders for the active shift.
	v2: `branch` is accepted for backward compatibility and ignored.
	"""
	require_pos_access()
	filters = {"status": "Held"}
	if pos_profile:
		filters["pos_profile"] = pos_profile

	orders = frappe.get_all(
		"Food POS Held Order",
		filters=filters,
		fields=["name", "creation", "branch", "pos_profile", "cashier", "order_type", "table", "customer", "customer_name", "phone", "grand_total", "hold_reason", "order_data"],
		order_by="creation desc"
	)
	return orders


@frappe.whitelist()
def resume_held_order(held_order_id):
	"""
	Resume a held order, marking it as Resumed and returning the full payload.
	If order had a table, re-occupies table if available.
	"""
	require_pos_access()
	if not frappe.db.exists("Food POS Held Order", held_order_id):
		frappe.throw(_("Held Order {0} not found.").format(held_order_id))

	doc = frappe.get_doc("Food POS Held Order", held_order_id)
	doc.status = "Resumed"
	doc.save()

	table_status = None
	if doc.table and frappe.db.exists("Restaurant Table", doc.table):
		current_status = frappe.db.get_value("Restaurant Table", doc.table, "status")
		if current_status == "Available":
			# v7.2: a resumed held order re-starts the table timer — the
			# old code set Occupied without occupied_since, so the floor
			# showed Reserved with no time running.
			resume_since = frappe.db.get_value("Restaurant Table", doc.table, "occupied_since") or now_datetime()
			set_table_fields(doc.table, {"status": "Occupied", "occupied_since": resume_since})
			frappe.publish_realtime("fpos_table_status_changed", {"table": doc.table, "status": "Occupied", "occupied_since": str(resume_since)}, after_commit=True)
			table_status = "Occupied"
		else:
			table_status = current_status

	# Comprehensive Audit Log for Order Resumed
	try:
		audit_res = frappe.new_doc("Food POS Audit Log")
		audit_res.timestamp = now_datetime()
		audit_res.cashier = frappe.session.user or "Administrator"
		audit_res.branch = SINGLE_BRANCH
		audit_res.pos_profile = doc.pos_profile
		audit_res.action_type = "Order Resumed"
		audit_res.order_id = doc.name
		audit_res.table = str(doc.table or "")
		audit_res.details = f"Held order {doc.name} resumed into active register ({doc.order_type}, Table: {doc.table or 'N/A'}, Grand Total: Rs {doc.grand_total})"
		audit_res.flags.ignore_permissions = True
		audit_res.insert()
	except Exception as e:
		frappe.log_error(f"Audit log failed for order resume: {e}", "Food POS Audit Log")

	held_count = frappe.db.count("Food POS Held Order", filters={"status": "Held"})  # v2: no branch filter.

	order_data = json.loads(doc.order_data) if isinstance(doc.order_data, str) else doc.order_data
	return {
		"success": True,
		"order_data": order_data,
		"held_order": doc.as_dict(),
		"table_status": table_status,
		"held_count": held_count
	}


@frappe.whitelist()
def discard_held_order(held_order_id, reason=None):
	"""
	Discard a held order.
	Frees associated table if it was reserved by this held order.
	"""
	require_pos_access()
	if not frappe.db.exists("Food POS Held Order", held_order_id):
		frappe.throw(_("Held Order {0} not found.").format(held_order_id))

	doc = frappe.get_doc("Food POS Held Order", held_order_id)
	doc.status = "Discarded"
	doc.save()

	if doc.table and frappe.db.exists("Restaurant Table", doc.table):
		current_order = frappe.db.get_value("Restaurant Table", doc.table, "order_id")
		if current_order == held_order_id:
			set_table_fields(doc.table, {
					"status": "Available",
					"order_id": None,
					"occupied_since": None,
				})
			frappe.publish_realtime("fpos_table_status_changed", {"table": doc.table, "status": "Available", "order_id": None, "occupied_since": None}, after_commit=True)

	# Comprehensive Audit Log for Order Discarded
	try:
		audit_disc = frappe.new_doc("Food POS Audit Log")
		audit_disc.timestamp = now_datetime()
		audit_disc.cashier = frappe.session.user or "Administrator"
		audit_disc.branch = SINGLE_BRANCH
		audit_disc.pos_profile = doc.pos_profile
		audit_disc.action_type = "Order Discarded"
		audit_disc.order_id = doc.name
		audit_disc.table = str(doc.table or "")
		audit_disc.details = f"Held order {doc.name} discarded ({doc.order_type}, Grand Total: Rs {doc.grand_total}). Reason: {reason or 'Customer cancellation'}"
		audit_disc.flags.ignore_permissions = True
		audit_disc.insert()
	except Exception as e:
		frappe.log_error(f"Audit log failed for order discard: {e}", "Food POS Audit Log")

	held_count = frappe.db.count("Food POS Held Order", filters={"status": "Held"})  # v2: no branch filter.
	return {"success": True, "held_count": held_count}


@frappe.whitelist()
def release_table_if_no_order(table):
	"""
	Safely release an abandoned or draft occupied table to Available if it has
	no active kitchen ticket, no held order, and no draft invoice.
	"""
	require_pos_access()
	if not table or not frappe.db.exists("Restaurant Table", table):
		return {"success": False, "message": _("Table not found")}

	# Check for active or served KOT
	has_kot = frappe.db.exists(
		"Food KOT",
		{
			"table": table,
			"docstatus": ["<", 2],
			"status": ["in", ["Pending", "In Progress", "Ready", "Served"]],
		}
	)
	if has_kot:
		return {"success": False, "message": _("Table has active kitchen ticket")}

	# Check for active Held order
	has_hold = frappe.db.exists(
		"Food POS Held Order",
		{
			"table": table,
			"status": "Held",
		}
	)
	if has_hold:
		return {"success": False, "message": _("Table has active held order")}

	set_table_fields(table, {
			"status": "Available",
			"order_id": None,
			"occupied_since": None,
		})
	frappe.publish_realtime("fpos_table_status_changed", {"table": table, "status": "Available", "order_id": None, "occupied_since": None}, after_commit=True)
	return {"success": True, "table": table, "status": "Available"}


# ──────────────────────────────────────────────────────────────────────────────
# v2 — Single-Branch Home / Day, Auto-KOT Confirm, Attendance, Daily Report
# ──────────────────────────────────────────────────────────────────────────────
# These APIs are new in v2. They reuse the existing Round-23 KOT logic,
# shift-closing flow and PIN guards; nothing here weakens them.

import re as _re


def _kot_numbers_for_invoice(invoice_name):
	"""KOT names linked to one settled invoice (for the thermal bill)."""
	try:
		return [
			r.name
			for r in frappe.get_all(
				"Food KOT",
				filters={"sales_invoice": invoice_name},
				fields=["name"],
				order_by="creation asc",
			)
		]
	except Exception:
		return []


def _order_id_for_invoice(invoice_name):
	"""The POS order token of the KOTs linked to one settled invoice."""
	try:
		rows = frappe.get_all(
			"Food KOT", filters={"sales_invoice": invoice_name}, fields=["order_id"], limit=1
		)
		return rows[0].order_id if rows and rows[0].get("order_id") else ""
	except Exception:
		return ""


@frappe.whitelist()
def confirm_order(order_data):
	"""v2: confirm an order WITHOUT settling it (payment stays Pending).

	Dine-in lifecycle step 2: confirming an order auto-creates the KOT
	(s) via :func:`create_kot` — there is no "Send to Kitchen" button any
	more. ``create_kot`` is idempotent per order_id + station (Round 23),
	so a double-click / double-confirm returns the SAME KOT(s) instead
	of a duplicate. For Dine In it also marks the table Occupied and
	starts the table timer (``occupied_since``). The invoice is NOT
	created here; the customer pays later via ``submit_pos_invoice``,
	which frees the table.

	BILL RULE v3 (hard rule): this function must never create an invoice
	or a customer bill. When an order goes to the kitchen the customer
	gets NO bill — only the KOT slip goes to the kitchen. The customer
	bill is generated/printed ONLY after payment, in
	``submit_pos_invoice`` (via ``get_invoice_slip_data``), or on an
	explicit reprint of an already-paid invoice. See TEST-REPORT-v3.md
	for the grep proof (no show_pos_slip / print_pos_slip /
	get_invoice_slip_data call on the confirm path, client or server).
	"""
	require_pos_access()
	if isinstance(order_data, str):
		order_data = json.loads(order_data)

	items = order_data.get("items") or order_data.get("cart_items") or []
	if not items:
		frappe.throw(_("Cannot confirm an empty order. Add items first."))

	order_data["order_type"] = normalise_order_type(
		order_data.get("order_type") or ("Dine In" if order_data.get("table") else "Takeaway")
	)
	order_data["branch"] = SINGLE_BRANCH  # v2: single branch; client value ignored.

	kot_res = create_kot(order_data)
	table = kot_res.get("table") or order_data.get("table") or ""
	occupied_since = ""
	if table and frappe.db.exists("Restaurant Table", table):
		occupied_since = str(frappe.db.get_value("Restaurant Table", table, "occupied_since") or "")

	return {
		"success": True,
		"order_id": kot_res.get("order_id"),
		"kot_names": kot_res.get("kot_names") or ([kot_res.get("kot_name")] if kot_res.get("kot_name") else []),
		"kot_name": kot_res.get("kot_name", ""),
		"table": table,
		"occupied_since": occupied_since,
		"payment_status": "Pending",
		"order_type": order_data["order_type"],
	}


def _day_times_from_opening(opening_name):
	"""Read user-set Day Start/End times for one POS Opening Entry.

	The times live in Custom Fields on POS Opening Entry
	(``custom_fpos_day_start_time`` / ``custom_fpos_day_end_time``, added
	by patch v0.3.0). Before that patch has run (``bench migrate``), the
	cache fallback below is used so the home screen still works.
	"""
	day_start = day_end = None
	try:
		meta = frappe.get_meta("POS Opening Entry")
		fields = []
		if meta.has_field("custom_fpos_day_start_time"):
			fields.append("custom_fpos_day_start_time")
		if meta.has_field("custom_fpos_day_end_time"):
			fields.append("custom_fpos_day_end_time")
		if fields:
			# v7.1: get_value with a ONE-field list returns a scalar, not a
			# tuple — the old vals[0]/vals[1] indexing read characters of
			# the time string instead. Map by field name, and normalise
			# Time values ("11:43:00") to HH:MM for the <input type="time">.
			vals = frappe.db.get_value("POS Opening Entry", opening_name, fields)
			if not isinstance(vals, (list, tuple)):
				vals = (vals,) if fields else ()
			by_field = dict(zip(fields, vals))
			day_start = _format_time_hh_mm(by_field.get("custom_fpos_day_start_time")) or None
			day_end = _format_time_hh_mm(by_field.get("custom_fpos_day_end_time")) or None
	except Exception:
		pass
	# v7.1: per-field cache fallback — the old code only fell back when
	# BOTH values were empty, so one saved time could mask the other.
	if not day_start or not day_end:
		try:
			cached = frappe.cache().get_value(f"fpos_day_times:{opening_name}") or {}
			if not day_start:
				day_start = _format_time_hh_mm(cached.get("day_start_time")) or None
			if not day_end:
				day_end = _format_time_hh_mm(cached.get("day_end_time")) or None
		except Exception:
			pass
	return day_start, day_end


@frappe.whitelist()
def get_day_status(pos_profile=None):
	"""v2 home screen: is the day open, when did it start, what times did
	the user set? Day Open == an open POS Opening Entry for the profile.
	"""
	require_pos_access()
	openings = []
	try:
		openings = check_opening_entry(user=frappe.session.user, pos_profile=pos_profile) or []
	except Exception:
		openings = []
	entry = openings[0] if openings else None
	day_start = day_end = None
	period_start = None
	if entry:
		period_start = str(entry.get("period_start_date") or "")
		day_start, day_end = _day_times_from_opening(entry.get("name"))
	return {
		"day_open": bool(entry),
		"pos_profile": pos_profile,
		"pos_opening_entry": entry.get("name") if entry else "",
		"period_start_date": period_start,
		"day_start_time": day_start,
		"day_end_time": day_end,
		"server_now": str(now_datetime()),
		"branch": SINGLE_BRANCH,
	}


@frappe.whitelist()
def set_day_times(pos_profile=None, day_start_time=None, day_end_time=None):
	"""v2 home screen: the user sets the Day Start and Day End times.

	Times are ``HH:MM`` (24-hour). They are stored on the open POS
	Opening Entry (custom fields, patch v0.3.0) or, until migrate has
	run, in cache for that opening entry. They do NOT close the day by
	themselves — Day Close still runs the shift-closing / Z-report flow.
	"""
	require_pos_access()
	for label, value in (("Day Start", day_start_time), ("Day End", day_end_time)):
		if value and not _re.match(r"^([01]\d|2[0-3]):[0-5]\d$", str(value).strip()):
			frappe.throw(_("{0} time must be HH:MM, e.g. 09:00.").format(label))
	openings = check_opening_entry(user=frappe.session.user, pos_profile=pos_profile) or []
	if not openings:
		frappe.throw(_("Open the day first — there is no open shift to attach times to."))
	entry_name = openings[0].get("name")
	stored_in = "cache"
	try:
		meta = frappe.get_meta("POS Opening Entry")
		updates = {}
		if meta.has_field("custom_fpos_day_start_time") and day_start_time:
			updates["custom_fpos_day_start_time"] = day_start_time
		if meta.has_field("custom_fpos_day_end_time") and day_end_time:
			updates["custom_fpos_day_end_time"] = day_end_time
		if updates:
			frappe.db.set_value("POS Opening Entry", entry_name, updates)
			stored_in = "POS Opening Entry"
	except Exception:
		pass
	try:
		frappe.cache().set_value(
			f"fpos_day_times:{entry_name}",
			{"day_start_time": day_start_time, "day_end_time": day_end_time},
			expires_in_sec=86400,
		)
	except Exception:
		pass
	return {
		"success": True,
		"pos_opening_entry": entry_name,
		"day_start_time": day_start_time,
		"day_end_time": day_end_time,
		"stored_in": stored_in,
	}


@frappe.whitelist()
def get_staff_attendance(attendance_date=None, pos_profile=None):
	"""v2: staff attendance rows for one day (default today)."""
	require_pos_access()
	date = attendance_date or str(getdate())
	if not frappe.db.exists("DocType", "Food POS Attendance"):
		return {"date": date, "rows": [], "note": "Food POS Attendance will appear after bench migrate."}
	filters = {"attendance_date": date}
	if pos_profile:
		filters["pos_profile"] = pos_profile
	rows = frappe.get_all(
		"Food POS Attendance",
		filters=filters,
		fields=["name", "staff_name", "user", "attendance_date", "check_in", "check_out", "status", "notes"],
		order_by="staff_name asc",
	)
	return {"date": date, "rows": rows}


@frappe.whitelist()
def mark_staff_attendance(staff_name, action, attendance_date=None, user=None):
	"""v2: mark attendance inline (no dialog). ``action`` is one of
	``check_in`` / ``check_out`` / ``absent``. One row per staff per day.
	"""
	require_pos_access()
	staff_name = (staff_name or "").strip()
	if not staff_name:
		frappe.throw(_("Staff name is required."))
	if action not in ("check_in", "check_out", "absent"):
		frappe.throw(_("Unknown attendance action."))
	date = attendance_date or str(getdate())
	if not frappe.db.exists("DocType", "Food POS Attendance"):
		frappe.throw(_("Food POS Attendance is not installed yet. Run bench migrate first."))
	existing = frappe.get_all(
		"Food POS Attendance",
		filters={"staff_name": staff_name, "attendance_date": date},
		fields=["name", "check_in", "check_out", "status"],
	)
	if action == "absent":
		if existing:
			doc = frappe.get_doc("Food POS Attendance", existing[0].name)
			doc.status = "Absent"
			doc.save()
		else:
			doc = frappe.new_doc("Food POS Attendance")
			doc.staff_name = staff_name
			doc.user = user or ""
			doc.attendance_date = date
			doc.status = "Absent"
			doc.flags.ignore_permissions = True
			doc.insert()
		return {"success": True, "action": "absent", "staff_name": staff_name, "date": date}

	if existing:
		doc = frappe.get_doc("Food POS Attendance", existing[0].name)
	else:
		doc = frappe.new_doc("Food POS Attendance")
		doc.staff_name = staff_name
		doc.user = user or ""
		doc.attendance_date = date
		doc.status = "Present"
		doc.flags.ignore_permissions = True
		doc.insert()
	if action == "check_in":
		if doc.check_in:
			return {"success": True, "action": "check_in", "already": True, "staff_name": staff_name, "date": date, "check_in": str(doc.check_in)}
		doc.check_in = now_datetime()
		doc.status = "Present"
	elif action == "check_out":
		if not doc.check_in:
			frappe.throw(_("Check-in first — {0} has not checked in today.").format(staff_name))
		doc.check_out = now_datetime()
	doc.save()
	return {
		"success": True,
		"action": action,
		"staff_name": staff_name,
		"date": date,
		"check_in": str(doc.check_in or ""),
		"check_out": str(doc.check_out or ""),
		"status": doc.status,
	}


@frappe.whitelist()
def get_daily_report(report_date=None, pos_profile=None):
	"""v2: one daily report for the home bottom nav (Reports).

	Aggregates today's submitted POS/Sales Invoices by order type, item
	sales, payment modes, plus pending dine-in (occupied tables + open
	KOTs) and today's attendance. Reuses the shift-closing totals where
	they exist, but is date-scoped, not shift-scoped, so it still works
	after Day Close. All queries are defensive: a missing table returns
	zeros instead of failing the page.
	"""
	require_pos_access()
	date = report_date or str(getdate())
	profile_cond = ""
	params = {"date": date}
	if pos_profile:
		profile_cond = " AND pos_profile = %(pos_profile)s"
		params["pos_profile"] = pos_profile

	def _invoice_totals(doctype):
		table = f"tab{doctype}"
		if not _table_exists(table):
			return {"orders": 0, "sales": 0.0}
		try:
			rows = frappe.db.sql(
				f"""SELECT COUNT(name) AS orders, COALESCE(SUM(grand_total), 0) AS sales
				FROM `{table}`
				WHERE posting_date = %(date)s AND docstatus = 1 AND is_pos = 1{profile_cond}""",
				params,
				as_dict=True,
			)
			row = rows[0] if rows else {}
			return {"orders": cint(row.get("orders", 0)), "sales": flt(row.get("sales", 0))}
		except Exception:
			return {"orders": 0, "sales": 0.0}

	def _by_order_type(doctype):
		table = f"tab{doctype}"
		if not _table_exists(table):
			return {}
		cols = frappe.db.get_table_columns(doctype) or []
		type_col = "custom_order_type" if "custom_order_type" in cols else "'Takeaway'"
		try:
			rows = frappe.db.sql(
				f"""SELECT {type_col} AS order_type, COUNT(name) AS orders,
					COALESCE(SUM(grand_total), 0) AS sales
				FROM `{table}`
				WHERE posting_date = %(date)s AND docstatus = 1 AND is_pos = 1{profile_cond}
				GROUP BY {type_col}""",
				params,
				as_dict=True,
			)
			return {str(r.get("order_type") or "Takeaway"): {"orders": cint(r.get("orders", 0)), "sales": flt(r.get("sales", 0))} for r in rows}
		except Exception:
			return {}

	def _payment_modes(doctype):
		# Payments live in the child table "<Doctype> Payment".
		child = f"tab{doctype} Payment"
		parent = f"tab{doctype}"
		if not _table_exists(child) or not _table_exists(parent):
			return {}
		try:
			rows = frappe.db.sql(
				f"""SELECT p.mode_of_payment AS mode, COALESCE(SUM(p.amount), 0) AS amount,
					COUNT(DISTINCT p.parent) AS invoices
				FROM `{child}` p JOIN `{parent}` i ON i.name = p.parent
				WHERE i.posting_date = %(date)s AND i.docstatus = 1 AND i.is_pos = 1{profile_cond}
				GROUP BY p.mode_of_payment""",
				params,
				as_dict=True,
			)
			return {str(r.get("mode") or "Cash"): {"amount": flt(r.get("amount", 0)), "invoices": cint(r.get("invoices", 0))} for r in rows}
		except Exception:
			return {}

	def _top_items(doctype, limit=5):
		child = f"tab{doctype} Item"
		parent = f"tab{doctype}"
		if not _table_exists(child) or not _table_exists(parent):
			return []
		try:
			rows = frappe.db.sql(
				f"""SELECT i.item_name AS item_name, COALESCE(SUM(i.qty), 0) AS qty,
					COALESCE(SUM(i.amount), 0) AS amount
				FROM `{child}` i JOIN `{parent}` p ON p.name = i.parent
				WHERE p.posting_date = %(date)s AND p.docstatus = 1 AND p.is_pos = 1{profile_cond}
				GROUP BY i.item_code, i.item_name ORDER BY qty DESC LIMIT %(limit)s""",
				dict(params, limit=limit),
				as_dict=True,
			)
			return [{"item_name": r.get("item_name"), "qty": flt(r.get("qty", 0)), "amount": flt(r.get("amount", 0))} for r in rows]
		except Exception:
			return []

	pos_totals = _invoice_totals("POS Invoice")
	sales_totals = _invoice_totals("Sales Invoice")
	by_type = _by_order_type("POS Invoice")
	for key, val in _by_order_type("Sales Invoice").items():
		merged = by_type.setdefault(key, {"orders": 0, "sales": 0.0})
		merged["orders"] += val["orders"]
		merged["sales"] += val["sales"]
	payments = _payment_modes("POS Invoice")
	for mode, val in _payment_modes("Sales Invoice").items():
		merged = payments.setdefault(mode, {"amount": 0.0, "invoices": 0})
		merged["amount"] += val["amount"]
		merged["invoices"] += val["invoices"]
	top_items = _top_items("POS Invoice") or _top_items("Sales Invoice")

	# Pending dine-in right now: occupied tables + open (unsettled) KOTs.
	pending_tables = []
	pending_kots = 0
	try:
		tables = get_available_tables(pos_profile=pos_profile) or []
		pending_tables = [
			{"table": t.get("table_no") or t.get("name"), "status": t.get("status"), "occupied_since": str(t.get("occupied_since") or ""), "guests": cint(t.get("guests", 0))}
			for t in tables
			if t.get("status") in ("Occupied", "Reserved")
		]
	except Exception:
		pass
	try:
		pending_kots = len(get_active_kitchen_kots(pos_profile=pos_profile) or [])
	except Exception:
		pending_kots = 0

	attendance = {"present": 0, "absent": 0, "total": 0}
	try:
		att = get_staff_attendance(attendance_date=date, pos_profile=pos_profile)
		rows = att.get("rows") or []
		attendance = {
			"present": sum(1 for r in rows if r.get("status") == "Present"),
			"absent": sum(1 for r in rows if r.get("status") == "Absent"),
			"total": len(rows),
		}
	except Exception:
		pass

	return {
		"date": date,
		"branch": SINGLE_BRANCH,
		"pos_profile": pos_profile,
		"total_orders": pos_totals["orders"] + sales_totals["orders"],
		"total_sales": pos_totals["sales"] + sales_totals["sales"],
		"by_order_type": by_type,
		"payment_modes": payments,
		"top_items": top_items,
		"pending_tables": pending_tables,
		"pending_kot_count": pending_kots,
		"tables_served": pos_totals["orders"] + sales_totals["orders"],
		"attendance": attendance,
	}
