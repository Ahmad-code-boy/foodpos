# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Food POS — Backend API
All methods are @frappe.whitelist() so they can be called from the browser.
"""

import json

import frappe
from frappe import _

# v2 single branch: see foodpos.foodpos.single_branch.
from foodpos.foodpos.single_branch import SINGLE_BRANCH, SINGLE_NAMING_SERIES, normalise_order_type
from frappe.utils import cint, flt, get_datetime, getdate, now_datetime, nowdate


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────


def _table_exists(table_name):
	"""Return True if a given MariaDB table exists in the current database."""
	try:
		result = frappe.db.sql(
			"SELECT COUNT(*) FROM information_schema.TABLES "
			"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
			(table_name,),
		)
		return bool(result and result[0][0])
	except Exception:
		return False


# ──────────────────────────────────────────────────────────────────────────────
# Item / Menu helpers
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def get_item_groups(pos_profile=None):
	"""Return item groups that are valid for this POS profile."""
	try:
		if pos_profile:
			profile = frappe.get_cached_doc("POS Profile", pos_profile)
			item_groups_in_profile = [row.item_group for row in (profile.item_groups or [])]
			if item_groups_in_profile:
				return frappe.get_all(
					"Item Group",
					filters={"name": ["in", item_groups_in_profile], "is_group": 0},
					fields=["name", "parent_item_group"],
					order_by="name asc",
				)

		# Fallback — return all leaf item groups
		ig_filters = {"is_group": 0}
		if "disabled" in (frappe.db.get_table_columns("Item Group") or []):
			ig_filters["disabled"] = 0

		return frappe.get_all(
			"Item Group",
			filters=ig_filters,
			fields=["name", "parent_item_group"],
			order_by="name asc",
		)
	except Exception:
		return []


@frappe.whitelist()
def get_food_items(pos_profile, item_group="", search_term="", start=0, page_length=40):
	"""
	Return paginated food items with price and stock data.

	Price data is fetched in a SINGLE batch query (one JOIN across all returned
	item codes) instead of the previous N+1 per-item loop, giving a significant
	speed improvement for large menus.
	"""
	start       = cint(start)
	page_length = cint(page_length)

	# Resolve warehouse and price list from POS Profile
	warehouse        = ""
	price_list       = "Standard Selling"
	hide_unavailable = 0

	if pos_profile:
		try:
			profile_data = frappe.db.get_value(
				"POS Profile",
				pos_profile,
				["warehouse", "selling_price_list", "hide_unavailable_items"],
				as_dict=True,
			)
			if profile_data:
				warehouse        = profile_data.warehouse or ""
				price_list       = profile_data.selling_price_list or "Standard Selling"
				hide_unavailable = cint(profile_data.hide_unavailable_items)
		except Exception:
			pass

	# Build item_group filter (supports parent group → children via nested set)
	ig_condition = ""
	if item_group:
		try:
			lft, rgt = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"])
			ig_condition = f"""
				AND item.item_group IN (
					SELECT name FROM `tabItem Group`
					WHERE lft >= {cint(lft)} AND rgt <= {cint(rgt)}
				)
			"""
		except Exception:
			ig_condition = f"AND item.item_group = {frappe.db.escape(item_group)}"

	# Search condition
	search_condition = ""
	if search_term:
		escaped = frappe.db.escape(f"%{search_term}%")
		search_condition = f"""
			AND (item.name LIKE {escaped}
			  OR item.item_name LIKE {escaped}
			  OR item.description LIKE {escaped})
		"""

	# Stock join for hide_unavailable
	bin_join = ""
	bin_cond = ""
	if hide_unavailable and warehouse:
		bin_join = "LEFT JOIN `tabBin` bin ON bin.item_code = item.name AND bin.warehouse = %(warehouse)s"
		bin_cond = "AND (item.is_stock_item = 0 OR bin.actual_qty > 0)"

	# Only select custom vegetarian/vegan columns if they actually exist in the DB.
	_item_cols = frappe.db.get_table_columns("Item")
	veg_col  = "IFNULL(item.custom_is_vegetarian, 0) AS is_vegetarian" if "custom_is_vegetarian" in _item_cols else "0 AS is_vegetarian"
	vegan_col = "IFNULL(item.custom_is_vegan, 0) AS is_vegan"          if "custom_is_vegan"       in _item_cols else "0 AS is_vegan"

	items = frappe.db.sql(
		f"""
		SELECT
			item.name          AS item_code,
			item.item_name,
			item.item_group,
			item.description,
			item.stock_uom,
			item.sales_uom,
			item.image         AS item_image,
			item.is_stock_item,
			{veg_col},
			{vegan_col}
		FROM `tabItem` item
		{bin_join}
		WHERE
			item.disabled = 0
			AND item.has_variants = 0
			AND item.is_sales_item = 1
			AND item.is_fixed_asset = 0
			{ig_condition}
			{search_condition}
			{bin_cond}
		ORDER BY item.item_name ASC
		LIMIT %(page_length)s OFFSET %(start)s
		""",
		{"warehouse": warehouse, "page_length": page_length, "start": start},
		as_dict=True,
	)

	if not items:
		return {"items": []}

	today     = nowdate()
	item_codes = [item.item_code for item in items]
	default_currency = frappe.defaults.get_global_default("currency") or "USD"

	# ── Batch price fetch (one query for all items) ───────────────────────────
	# Pick the cheapest/latest valid price per item_code using a window function.
	# Falling back to a plain subquery for MariaDB 10.2 compatibility.
	if item_codes:
		in_clause = ", ".join(frappe.db.escape(ic) for ic in item_codes)
		raw_prices = frappe.db.sql(
			f"""
			SELECT ip.item_code, ip.price_list_rate, ip.currency, ip.uom
			FROM `tabItem Price` ip
			INNER JOIN (
				SELECT item_code, MAX(COALESCE(valid_from, '1970-01-01')) AS max_valid
				FROM `tabItem Price`
				WHERE price_list = %(price_list)s
				  AND selling = 1
				  AND item_code IN ({in_clause})
				  AND (valid_from IS NULL OR valid_from <= %(today)s)
				GROUP BY item_code
			) best ON best.item_code = ip.item_code
			       AND COALESCE(ip.valid_from, '1970-01-01') = best.max_valid
			WHERE ip.price_list = %(price_list)s
			  AND ip.selling = 1
			  AND ip.item_code IN ({in_clause})
			""",
			{"price_list": price_list, "today": today},
			as_dict=True,
		)
		# Build lookup dict: item_code → first matching price row
		price_map = {}
		for row in raw_prices:
			if row.item_code not in price_map:
				price_map[row.item_code] = row
	else:
		price_map = {}

	# ── Batch stock fetch (one query for all items) ───────────────────────────
	qty_map = {}
	if warehouse and item_codes:
		in_clause = ", ".join(frappe.db.escape(ic) for ic in item_codes)
		qty_rows = frappe.db.sql(
			f"""
			SELECT item_code, actual_qty
			FROM `tabBin`
			WHERE warehouse = %(warehouse)s
			  AND item_code IN ({in_clause})
			""",
			{"warehouse": warehouse},
			as_dict=True,
		)
		qty_map = {row.item_code: flt(row.actual_qty) for row in qty_rows}

	# ── Attach price + stock to each item ────────────────────────────────────
	for item in items:
		price_row = price_map.get(item.item_code)
		if price_row:
			item.price_list_rate = flt(price_row.price_list_rate)
			item.currency        = price_row.currency or default_currency
			item.uom             = price_row.uom or item.stock_uom
		else:
			item.price_list_rate = 0.0
			item.currency        = default_currency
			item.uom             = item.stock_uom

		if item.is_stock_item and warehouse:
			item.actual_qty = qty_map.get(item.item_code, 0.0)
		else:
			item.actual_qty = 999  # non-stock items are always "available"

	return {"items": items}


# ──────────────────────────────────────────────────────────────────────────────
# Payment methods
# ──────────────────────────────────────────────────────────────────────────────

_PAYMENT_ICONS = {
	"Cash":        "💵",
	"Credit Card": "💳",
	"Debit Card":  "💳",
	"UPI":         "📱",
	"Wallet":      "👛",
	"Voucher":     "🎟️",
	"Bank Transfer": "🏦",
}


@frappe.whitelist()
def get_payment_methods(pos_profile=None):
	"""Return payment methods configured in POS Profile (or all active ones)."""
	try:
		if pos_profile:
			profile = frappe.get_cached_doc("POS Profile", pos_profile)
			methods = []
			for row in profile.payments or []:
				mop = row.mode_of_payment
				mop_type = frappe.db.get_value("Mode of Payment", mop, "type") or "General"
				methods.append({
					"mode_of_payment": mop,
					"type":            mop_type,
					"icon":            _PAYMENT_ICONS.get(mop, "💳"),
					"default":         cint(row.default),
				})
			if methods:
				return methods

		# Fallback — all active payment modes
		all_modes = frappe.get_all(
			"Mode of Payment",
			filters={"enabled": 1},
			fields=["name", "type"],
			order_by="name asc",
		)
		return [
			{
				"mode_of_payment": m.name,
				"type":            m.type or "General",
				"icon":            _PAYMENT_ICONS.get(m.name, "💳"),
				"default":         1 if m.type == "Cash" else 0,
			}
			for m in all_modes
		]
	except Exception:
		return [
			{"mode_of_payment": "Cash",        "type": "Cash",   "icon": "💵", "default": 1},
			{"mode_of_payment": "Credit Card",  "type": "Card",   "icon": "💳", "default": 0},
		]




def _api_live_rate_for_item(item_code, price_list):
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


def _api_has_recent_pin_approval(action_type, approved_by, item_text, hours=4):
	"""Same rule as the page helper: a fresh manager audit log must exist."""
	from datetime import timedelta
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


def _api_reprice_and_validate_items(items_list, price_list):
	"""Server-side re-price for the api settle path (see page helper)."""
	for row in items_list or []:
		code = row.get("item_code")
		name = row.get("item_name") or code
		client_rate = flt(row.get("rate", 0))
		is_free = cint(row.get("is_free_item"))
		if is_free or client_rate <= 0:
			if not is_free:
				continue
			approver = row.get("manager_approved_by") or ""
			if not _api_has_recent_pin_approval("free_item", approver, name) and not _api_has_recent_pin_approval("free_item", approver, code or ""):
				frappe.throw(_("Free item '{0}' requires a fresh Manager PIN approval.").format(name))
			row["rate"] = 0.0
			continue
		live = _api_live_rate_for_item(code, price_list)
		if live > 0 and abs(client_rate - live) > 0.01:
			approver = row.get("manager_approved_by") or ""
			ok = _api_has_recent_pin_approval("price_edit", approver, name) or _api_has_recent_pin_approval("price_edit", approver, code or "")
			if not ok:
				frappe.throw(
					_("Unit price for '{0}' is Rs {1}, not Rs {2}. Price edits require a fresh Manager PIN approval.").format(name, live, client_rate)
				)
		elif live > 0:
			row["rate"] = live


# ──────────────────────────────────────────────────────────────────────────────
# Invoice creation  (supports both POS Invoice and Sales Invoice modes)
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def create_pos_invoice(order, payments):
    """
    Create the correct invoice type based on the POS Profile setting.
    """
    if isinstance(order, str):
        order = json.loads(order)
    if isinstance(payments, str):
        payments = json.loads(payments)

    # ── Resolve POS Profile ──────────────────────────────────────────────
    pos_profile_name = order.get("pos_profile") or _get_default_pos_profile()
    if not pos_profile_name:
        frappe.throw(_("No POS Profile found. Please configure a POS Profile."))

    profile = frappe.get_cached_doc("POS Profile", pos_profile_name)
    company = profile.company or frappe.defaults.get_global_default("company")

    # ── Determine invoice doctype ────────────────────────────────────────
    invoice_doctype = _get_invoice_doctype(profile)

    # v7.1: heal the invoice fields first (same fix as the page module's
    # submit_pos_invoice) — on sites whose v0.1.0 patch never ran, the
    # has_field() guards below silently skipped storing order type/table,
    # so a Dine-In order read back as "Takeaway".
    try:
        from foodpos.foodpos.page.food_pos.food_pos import _ensure_invoice_custom_fields
        _ensure_invoice_custom_fields(invoice_doctype)
    except Exception:
        pass
    opening_name = None
    if invoice_doctype == "POS Invoice":
        try:
            opening_doc = create_opening_voucher(pos_profile_name, company, [])
            opening_name = opening_doc.get("name") if isinstance(opening_doc, dict) else getattr(opening_doc, "name", None)
        except Exception:
            opening_name = None

    # ── Resolve customer ─────────────────────────────────────────────────
    customer = (
        order.get("customer")
        or getattr(profile, "customer", None)
        or _get_walk_in_customer(company)
    )

    def _build_doc(dt, opening=None):
        doc = frappe.new_doc(dt)
        doc.update({
            "company":            company,
            "pos_profile":        pos_profile_name,
            "posting_date":       getdate(),
            "posting_time":       now_datetime().strftime("%H:%M:%S"),
            "customer":           customer,
            "selling_price_list": profile.selling_price_list or "Standard Selling",
            "currency":           frappe.defaults.get_global_default("currency") or "USD",
            "is_pos":             1,
            "update_stock":       cint(getattr(profile, "update_stock", 0)),
        })
        if dt == "POS Invoice" and opening:
            doc.pos_opening_entry = opening

        # v7.1: when the invoice settles a KOT, the KOT is the source of
        # truth for order type + table — copy them when the caller did not
        # send them, so a Dine-In order is stored as "Dine In".
        kot_ref = order.get("linked_kot_id") or order.get("kot_id")
        if kot_ref and (not order.get("order_type") or not order.get("table")):
            try:
                kot_name = str(kot_ref).split(",")[0].strip()
                kot_vals = frappe.db.get_value("Food KOT", kot_name, ["order_type", "table"])
                if kot_vals:
                    kot_type, kot_table = kot_vals
                    if kot_type and not order.get("order_type"):
                        order["order_type"] = kot_type
                    if kot_table and not order.get("table"):
                        order["table"] = kot_table
            except Exception:
                pass
        order_type = order.get("order_type", "Dine In")
        if order_type == "Delivery":
            phone = str(order.get("phone") or order.get("contact_phone") or "").strip()
            address = str(order.get("delivery_address") or "").strip()
            if not phone:
                frappe.throw(_("Customer contact phone is mandatory for Delivery orders."))
            if not address:
                frappe.throw(_("Delivery address is mandatory for Delivery orders."))

        # v2 single branch: one naming series for every invoice.
        doc.naming_series = SINGLE_NAMING_SERIES

        if getattr(profile, "cost_center", None):
            doc.cost_center = profile.cost_center

        # ── Safe custom fields using Meta ────────────────────────────────────
        meta = frappe.get_meta(dt)
        if meta.has_field("custom_order_type"):
            doc.custom_order_type = order_type
        if meta.has_field("custom_table"):
            doc.custom_table = order.get("table", "")
        if meta.has_field("custom_order_note"):
            doc.custom_order_note = order.get("order_note", "")
        if meta.has_field("custom_branch"):
            doc.custom_branch = SINGLE_BRANCH  # legacy field kept
        if meta.has_field("custom_contact_phone"):
            doc.custom_contact_phone = order.get("phone") or order.get("contact_phone") or ""
        if meta.has_field("custom_delivery_address"):
            doc.custom_delivery_address = order.get("delivery_address") or ""
        if meta.has_field("custom_delivery_charges"):
            doc.custom_delivery_charges = flt(order.get("delivery_charges", 0))

        # ── Items — Round 23 fix: re-price server-side (see page helper).
        _api_reprice_and_validate_items(order.get("items", []), profile.selling_price_list or "Standard Selling")
        for item in order.get("items", []):
            rate = flt(item.get("rate", 0))
            if rate <= 0 and not cint(item.get("is_free_item")):
                frappe.throw(_("Item '{0}' cannot be sold at Rs {1}. Free items require Manager PIN approval.").format(
                    item.get("item_name", item["item_code"]), rate
                ))
            row = {
                "item_code":   item["item_code"],
                "item_name":   item.get("item_name", item["item_code"]),
                "qty":         flt(item.get("qty", 1)),
                "rate":        rate,
                "uom":         item.get("uom", "Nos"),
                "description": item.get("item_note", ""),
                "warehouse":   item.get("warehouse") or profile.warehouse,
            }
            doc.append("items", row)

        # ── Discount with Cashier Cap & Manager PIN Guard ────────────────────
        # v5.2: discount is a flat Rs amount only (no % anymore). Cashier cap
        # is Rs 100 — anything above needs a fresh Manager PIN on every settle.
        disc_amt = flt(order.get("discount_amount", 0))
        if disc_amt > 100.0:
            # Round 23 fix: fresh PIN on every over-cap settle; the old
            # discount_approved_by replay is removed (see page helper).
            mgr_pin = order.get("manager_pin") or order.get("discount_manager_pin")
            if not mgr_pin:
                frappe.throw(_("Discounts exceeding Rs 100 require a fresh Manager PIN on every settle. A previous approval cannot be reused."))
            from foodpos.foodpos.page.food_pos.food_pos import verify_manager_pin
            verify_manager_pin(
                pin=mgr_pin,
                action_type="discount",
                cashier=frappe.session.user,
                order_id=order.get("order_id") or "",
                details=f"Discount override: Rs {disc_amt}"
            )

        if disc_amt:
            doc.discount_amount = disc_amt

        # ── Set missing values & calculate totals ────────────────────────────
        doc.flags.ignore_permissions = True
        doc.set_missing_values(for_validate=True)
        # v5.2: NO TAX — never apply the POS Profile's Sales Taxes and Charges
        # template to the invoice, even if one is configured on the profile.
        doc.taxes_and_charges = ""
        doc.set("taxes", [])
        doc.calculate_taxes_and_totals()

        total_amount = flt(doc.rounded_total) or flt(doc.grand_total)

        # ── Payments (attached after set_missing_values) ─────────────────────
        doc.set("payments", [])
        total_paid = sum(flt(p.get("amount", 0)) for p in payments)
        resolved_payments = [dict(p) for p in payments]
        if not resolved_payments or total_paid < total_amount:
            diff = total_amount - total_paid
            default_mop = "Cash"
            if getattr(profile, "payments", None):
                default_mop = profile.payments[0].mode_of_payment or "Cash"
            if resolved_payments:
                resolved_payments[0]["amount"] = flt(resolved_payments[0].get("amount", 0)) + diff
            else:
                resolved_payments = [{"mode_of_payment": default_mop, "amount": total_amount}]

        for pay in resolved_payments:
            amt = flt(pay.get("amount", 0))
            if amt <= 0:
                continue
            mop = pay.get("mode_of_payment", "Cash")
            acc = frappe.db.get_value(
                "Mode of Payment Account",
                {"parent": mop, "company": company},
                "default_account"
            ) or frappe.get_cached_value("Company", company, "default_cash_account")

            doc.append("payments", {
                "mode_of_payment": mop,
                "amount":          amt,
                "base_amount":     flt(amt * flt(doc.conversion_rate or 1.0)),
                "account":         acc,
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

        doc.reload()
        if (flt(doc.outstanding_amount) <= 0 or flt(doc.paid_amount) >= total_amount) and doc.status != "Paid":
            doc.db_set("outstanding_amount", 0.0)
            doc.db_set("status", "Paid")
            doc.status = "Paid"

        return doc

    inv = None
    actual_doctype = invoice_doctype
    if invoice_doctype == "POS Invoice":
        try:
            inv = _build_doc("POS Invoice", opening_name)
        except Exception as e:
            frappe.log_error(frappe.get_traceback(), f"POS Invoice failed, falling back to Sales Invoice: {e}")
            if hasattr(frappe, "clear_messages"):
                frappe.clear_messages()
            if hasattr(frappe.local, "message_log"):
                frappe.local.message_log = []
            actual_doctype = "Sales Invoice"
            inv = _build_doc("Sales Invoice")
    else:
        inv = _build_doc("Sales Invoice")

    # Round 23 fix: the api settle path previously never linked KOTs at all,
    # leaving them open to be grabbed by a later unrelated settle. Link only
    # this order's KOTs (by order_id); a linking failure must never break
    # the already-submitted invoice, so it is logged, not thrown.
    try:
        from foodpos.foodpos.page.food_pos.food_pos import _link_kots_to_invoice
        _link_kots_to_invoice(
            inv, order,
            SINGLE_BRANCH,
            pos_profile_name,
            order.get("order_type", "Dine In"),
        )
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), f"FoodPOS: KOT linking failed for invoice {inv.name}: {e}")

    return {
        "invoice":       inv.name,
        "grand_total":   inv.grand_total,
        "paid_amount":   inv.paid_amount,
        "status":        inv.status or "Paid",
        "invoice_type":  actual_doctype,
    }

@frappe.whitelist()
def verify_manager_pin(pin, action_type, branch=None, cashier=None, order_id=None, table=None, details=None):
	"""Proxy to food_pos page verify_manager_pin. v2: `branch` is ignored (single branch)."""
	from foodpos.foodpos.page.food_pos.food_pos import verify_manager_pin as _verify_pin
	return _verify_pin(pin, action_type, cashier=cashier, order_id=order_id, table=table, details=details)


def _get_default_pos_profile():
	profiles = frappe.get_all("POS Profile", filters={"disabled": 0}, limit=1, pluck="name")
	return profiles[0] if profiles else None


def _pos_invoice_exists():
	"""
	Return True if the POS Invoice doctype table exists in the database.
	Uses a direct MySQL query instead of frappe.db.exists() to avoid
	the ('DocType', 'tabPOS Invoice') exception in Frappe v16.
	"""
	try:
		result = frappe.db.sql(
			"SELECT COUNT(*) FROM information_schema.TABLES "
			"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabPOS Invoice'",
		)
		return bool(result and result[0][0])
	except Exception:
		return False


def _get_invoice_doctype(profile=None):
	"""
	Determine which invoice doctype to use.

	ERPNext v16 controls this via POS Settings → invoice_type (Single doctype).
	  - invoice_type == "Sales Invoice"  → create Sales Invoice
	  - invoice_type == "POS Invoice"    → create POS Invoice (only if table exists)
	  - POS Invoice table missing        → always Sales Invoice
	"""
	try:
		invoice_type_setting = frappe.db.get_single_value("POS Settings", "invoice_type")
		if invoice_type_setting == "Sales Invoice":
			return "Sales Invoice"
		if invoice_type_setting == "POS Invoice" and _pos_invoice_exists():
			return "POS Invoice"
	except Exception:
		pass

	return "Sales Invoice"


def _get_opening_entry_doctype():
	"""Return 'POS Opening Entry' if its table exists in DB, else None."""
	try:
		result = frappe.db.sql(
			"SELECT COUNT(*) FROM information_schema.TABLES "
			"WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabPOS Opening Entry'",
		)
		return "POS Opening Entry" if (result and result[0][0]) else None
	except Exception:
		return None


def _get_walk_in_customer(company):
	"""Return or create a Walk-in Customer for the company."""
	customer_name = f"Walk-in Customer - {company}"
	if not frappe.db.exists("Customer", customer_name):
		cust = frappe.new_doc("Customer")
		cust.customer_name   = customer_name
		cust.customer_type   = "Individual"
		cust.customer_group  = "Individual"
		cust.territory       = "All Territories"
		cust.flags.ignore_permissions = True
		cust.save()
	return customer_name


# ──────────────────────────────────────────────────────────────────────────────
# Kitchen Order Ticket (KOT)
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def create_kot(order):
	"""Create a KOT record in the Food KOT doctype.

	Round 23 fix: one order gets one KOT here (this API creates a single
	KOT, unlike the page version which splits by station). A second call
	for the same order_id reuses the open KOT instead of creating a
	duplicate. The order token is returned so the caller can store it.
	"""
	if isinstance(order, str):
		order = json.loads(order)

	try:
		from foodpos.foodpos.page.food_pos.food_pos import _resolve_pos_order_id, _find_open_kots_for_order, _kot_has_order_field
		pos_order_id = _resolve_pos_order_id(order)
		if _kot_has_order_field():
			existing = _find_open_kots_for_order(pos_order_id)
			if existing:
				reused = frappe.get_doc("Food KOT", existing[0].name)
				_have = {(r.item_code, r.item_note or "") for r in reused.items}
				_added = False
				for item in order.get("items", []):
					key = (item["item_code"], item.get("item_note", "") or "")
					if key not in _have:
						reused.append("items", {
							"item_code": item["item_code"],
							"item_name": item.get("item_name", item["item_code"]),
							"qty": flt(item.get("qty", 1)),
							"item_note": item.get("item_note", "") or "",
							"is_done": 0,
						})
						_added = True
				if _added:
					reused.flags.ignore_permissions = True
					reused.save()
					frappe.db.commit()
				return {"kot_name": reused.name, "order_id": pos_order_id, "reused": True}

		kot = frappe.new_doc("Food KOT")
		if _kot_has_order_field():
			kot.order_id = pos_order_id

		# Set fields individually to avoid any naming_series conflict
		kot.status     = "Pending"
		kot.order_type = order.get("order_type", "Dine In") or "Dine In"
		kot.table      = order.get("table", "") or ""
		kot.order_note = order.get("order_note", "") or ""
		kot.pos_profile = order.get("pos_profile", "") or ""
		kot.branch = SINGLE_BRANCH  # v2: legacy field kept, always the single branch.

		# customer is a Link field — only set if it's a valid non-empty value
		customer = order.get("customer", "")
		if customer:
			kot.customer = customer

		for item in order.get("items", []):
			kot.append("items", {
				"item_code": item["item_code"],
				"item_name": item["item_name"],
				"qty":       flt(item["qty"]),
				"item_note": item.get("item_note", "") or "",
				"is_done":   0,
			})

		kot.flags.ignore_permissions = True
		kot.flags.ignore_mandatory   = False
		kot.save()

		frappe.db.commit()
		return {"kot_name": kot.name, "order_id": pos_order_id}

	except Exception as e:
		frappe.db.rollback()
		frappe.log_error(frappe.get_traceback(), "Food POS: create_kot error")
		return {"error": str(e)}


@frappe.whitelist()
def get_kitchen_orders(pos_profile=None):
	"""Return active KOT orders (Pending, In Progress, Ready)."""
	try:
		filters = {"status": ["in", ["Pending", "In Progress", "Ready"]]}
		kots = frappe.get_all(
			"Food KOT",
			filters=filters,
			fields=[
				"name", "status", "order_type", "table",
				"customer", "order_note", "creation", "modified",
			],
			order_by="creation asc",
		)

		for kot in kots:
			kot["items"] = frappe.get_all(
				"Food KOT Item",
				filters={"parent": kot.name},
				fields=["name", "item_code", "item_name", "qty", "item_note", "is_done"],
			)

		return kots
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Food POS: get_kitchen_orders error")
		return []


@frappe.whitelist()
def update_kot_status(kot_name, status):
	"""Update KOT status: Pending → In Progress → Ready → Served."""
	allowed = ["Pending", "In Progress", "Ready", "Served", "Cancelled"]
	if status not in allowed:
		frappe.throw(_("Invalid KOT status: {0}").format(status))

	kot_doc = frappe.get_doc("Food KOT", kot_name)
	kot_doc.status = status
	kot_doc.flags.ignore_permissions = True
	if status == "Served" and kot_doc.docstatus == 0:
		kot_doc.submit()
	elif status == "Cancelled" and kot_doc.docstatus == 1:
		kot_doc.flags.allow_void_cancel = True
		kot_doc.cancel()
	else:
		kot_doc.save()
	frappe.db.commit()
	return {"success": True, "status": status}


@frappe.whitelist()
def toggle_kot_item_done(kot_name, item_name=None, is_done=0, row_id=None):
	"""Mark / unmark an individual KOT item as done."""
	from foodpos.foodpos.page.food_pos.food_pos import update_kot_item_done_status as _update_item
	return _update_item(kot_name=kot_name, item_name=item_name, is_done=is_done, row_id=row_id)


@frappe.whitelist()
def get_active_kitchen_kots(pos_profile=None, branch=None, station=None):
	"""Alias for page food_pos get_active_kitchen_kots. v2: branch is ignored (single branch)."""
	from foodpos.foodpos.page.food_pos.food_pos import get_active_kitchen_kots as _get_kots
	return _get_kots(pos_profile=pos_profile, station=station)


@frappe.whitelist()
def update_kot_stage(kot_name, status):
	"""Alias for page food_pos update_kot_stage."""
	from foodpos.foodpos.page.food_pos.food_pos import update_kot_stage as _update_stage
	return _update_stage(kot_name=kot_name, status=status)


@frappe.whitelist()
def update_kot_item_done_status(kot_name, item_name=None, is_done=0, row_id=None):
	"""Alias for page food_pos update_kot_item_done_status."""
	from foodpos.foodpos.page.food_pos.food_pos import update_kot_item_done_status as _update_item
	return _update_item(kot_name=kot_name, item_name=item_name, is_done=is_done, row_id=row_id)


# ──────────────────────────────────────────────────────────────────────────────
# Table management
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def get_tables(pos_profile=None, branch=None):
	"""Return restaurant tables with live status. v2: `branch` is ignored (single branch)."""
	try:
		filters = {"disabled": 0}

		tables = frappe.get_all(
			"Restaurant Table",
			filters=filters,
			fields=[
				"name", "table_no", "branch", "capacity", "status",
				"section", "waiter", "order_id", "occupied_since",
				"guests", "notes",
			],
			order_by="table_no asc, name asc",
		)
		return tables
	except Exception:
		return []


@frappe.whitelist()
def update_table_status(table_name, status, guests=None, waiter=None,
						notes=None, reservation_time=None, customer_name=None,
						order_id=None, occupied_since=None):
	"""Update a restaurant table's status and metadata."""
	try:
		values = {"status": status}
		if guests      is not None: values["guests"]           = cint(guests)
		if waiter      is not None: values["waiter"]           = waiter
		if notes       is not None: values["notes"]            = notes
		if order_id    is not None: values["order_id"]         = order_id
		if occupied_since is not None: values["occupied_since"] = occupied_since

		if status == "Occupied" and not occupied_since:
			values["occupied_since"] = now_datetime()
		if status in ("Available", "Cleaning"):
			values["occupied_since"] = None
			values["order_id"]       = None

		frappe.db.set_value("Restaurant Table", table_name, values)
		frappe.db.commit()
		return {"success": True}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Food POS: update_table_status error")
		return {"error": str(e)}


# ──────────────────────────────────────────────────────────────────────────────
# Opening entry (reuse ERPNext logic when available)
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def check_opening_entry(user=None):
	"""Return open POS Opening Entry vouchers for the user, or [] if the doctype doesn't exist."""
	if not _get_opening_entry_doctype():
		return []  # POS Opening Entry not installed — skip opening dialog

	user = user or frappe.session.user
	open_vouchers = frappe.db.get_all(
		"POS Opening Entry",
		filters={
			"user":              user,
			"pos_closing_entry": ["in", ["", None]],
			"docstatus":         1,
		},
		fields=["name", "company", "pos_profile", "period_start_date"],
		order_by="period_start_date desc",
	)
	return open_vouchers


@frappe.whitelist()
def create_opening_voucher(pos_profile, company, balance_details):
	"""Create a POS Opening Entry. Returns a dummy dict if the doctype doesn't exist."""
	if not _get_opening_entry_doctype():
		return {"name": None, "pos_profile": pos_profile, "company": company}

	if isinstance(balance_details, str):
		balance_details = json.loads(balance_details)

	# ── Always auto-populate balance_details from POS Profile ────────────────
	# Whether the caller sent [] or a populated list, we regenerate from the
	# profile's payment rows to guarantee ERPNext validation passes.
	try:
		profile_doc = frappe.get_cached_doc("POS Profile", pos_profile)
		payment_rows = profile_doc.payments or []
		if payment_rows:
			# Merge: keep any amounts the caller supplied, default to 0
			caller_amounts = {
				row.get("mode_of_payment"): flt(row.get("opening_amount", 0))
				for row in balance_details
			}
			balance_details = [
				{
					"mode_of_payment": row.mode_of_payment,
					"opening_amount":  caller_amounts.get(row.mode_of_payment, 0),
				}
				for row in payment_rows
			]
	except Exception:
		pass

	# ── Final fallback: Cash with 0 ──────────────────────────────────────────
	if not balance_details:
		balance_details = [{"mode_of_payment": "Cash", "opening_amount": 0}]

	# ── Check if an open session already exists for this user+profile ────────
	existing = frappe.db.get_all(
		"POS Opening Entry",
		filters={
			"user":              frappe.session.user,
			"pos_profile":       pos_profile,
			"pos_closing_entry": ["in", ["", None]],
			"docstatus":         1,
		},
		fields=["name", "period_start_date"],
		limit=1,
	)
	if existing:
		entry = existing[0]
		entry_date = getdate(entry.get("period_start_date"))
		if entry_date == getdate():
			# Already open for today — return it instead of creating a duplicate
			return frappe.get_doc("POS Opening Entry", entry.name).as_dict()
		else:
			# Stale entry from a previous day — close it
			try:
				from foodpos.foodpos.page.food_pos.food_pos import _close_stale_opening_entry
				_close_stale_opening_entry(entry.name)
			except Exception:
				# Fallback: force-close via status
				try:
					frappe.db.set_value("POS Opening Entry", entry.name, "status", "Closed", update_modified=False)
					frappe.db.commit()
				except Exception:
					pass

	new_opening = frappe.get_doc({
		"doctype":           "POS Opening Entry",
		"period_start_date": now_datetime(),
		"posting_date":      getdate(),
		"user":              frappe.session.user,
		"pos_profile":       pos_profile,
		"company":           company,
	})
	new_opening.set("balance_details", balance_details)
	new_opening.submit()
	return new_opening.as_dict()


@frappe.whitelist()
def get_shift_closing_details(pos_profile=None, pos_opening_entry=None):
	from foodpos.foodpos.page.food_pos.food_pos import get_shift_closing_details as _get_shift_closing_details
	return _get_shift_closing_details(pos_profile=pos_profile, pos_opening_entry=pos_opening_entry)


@frappe.whitelist()
def create_and_submit_pos_closing_entry(pos_profile, pos_opening_entry, payments=None, closing_notes=None):
	from foodpos.foodpos.page.food_pos.food_pos import create_and_submit_pos_closing_entry as _create_and_submit_pos_closing_entry
	return _create_and_submit_pos_closing_entry(
		pos_profile=pos_profile,
		pos_opening_entry=pos_opening_entry,
		payments=payments,
		closing_notes=closing_notes,
	)


# ──────────────────────────────────────────────────────────────────────────────
# Dashboard / reports
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def get_today_summary(pos_profile=None):
	"""Return today's sales summary for the dashboard header."""
	today = getdate()

	# Use whichever invoice table is available
	inv_table = "tabPOS Invoice" if _pos_invoice_exists() else "tabSales Invoice"
	profile_cond = f"AND pos_profile = {frappe.db.escape(pos_profile)}" if pos_profile else ""

	try:
		result = frappe.db.sql(
			f"""
			SELECT
				COUNT(name)       AS total_orders,
				SUM(grand_total)  AS total_sales,
				AVG(grand_total)  AS avg_order_value
			FROM `{inv_table}`
			WHERE posting_date = %(today)s
			  AND docstatus = 1
			  AND is_pos = 1
			  {profile_cond}
			""",
			{"today": today},
			as_dict=True,
		)
	except Exception:
		result = []

	row = result[0] if result else {}
	return {
		"total_orders":    cint(row.get("total_orders", 0)),
		"total_sales":     flt(row.get("total_sales", 0)),
		"avg_order_value": flt(row.get("avg_order_value", 0)),
	}


@frappe.whitelist()
def get_top_items(pos_profile=None, limit=5):
	"""Return top-selling items today."""
	today = getdate()
	limit = cint(limit)

	# Use whichever invoice table is available
	if _pos_invoice_exists():
		inv_table  = "tabPOS Invoice"
		item_table = "tabPOS Invoice Item"
	else:
		inv_table  = "tabSales Invoice"
		item_table = "tabSales Invoice Item"

	profile_cond = f"AND pi.pos_profile = {frappe.db.escape(pos_profile)}" if pos_profile else ""

	try:
		return frappe.db.sql(
			f"""
			SELECT
				pii.item_code,
				pii.item_name,
				SUM(pii.qty)    AS total_qty,
				SUM(pii.amount) AS total_amount
			FROM `{item_table}` pii
			JOIN `{inv_table}` pi ON pi.name = pii.parent
			WHERE pi.posting_date = %(today)s
			  AND pi.docstatus = 1
			  AND pi.is_pos = 1
			  {profile_cond}
			GROUP BY pii.item_code, pii.item_name
			ORDER BY total_qty DESC
			LIMIT {limit}
			""",
			{"today": today},
			as_dict=True,
		)
	except Exception:
		return []


# ──────────────────────────────────────────────────────────────────────────────
# POS Profile details (single round-trip on page load)                  T-054
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def get_pos_profile_details(pos_profile=None):
	"""
	Return all config values the frontend needs at startup in a single call,
	avoiding multiple frappe.call() round-trips on page load.
	"""
	if not pos_profile:
		pos_profile = _get_default_pos_profile()

	if not pos_profile:
		frappe.throw(_("No active POS Profile found. Please configure a POS Profile."))

	profile = frappe.get_cached_doc("POS Profile", pos_profile)

	# Resolve tax category from the profile's tax template (if set)
	tax_category = ""
	if getattr(profile, "taxes_and_charges", None):
		tax_category = (
			frappe.db.get_value(
				"Sales Taxes and Charges Template",
				profile.taxes_and_charges,
				"tax_category",
			)
			or ""
		)

	return {
		"company":            profile.company,
		"currency":           frappe.db.get_value("Company", profile.company, "default_currency")
		                      or frappe.defaults.get_global_default("currency")
		                      or "USD",
		"warehouse":          profile.warehouse or "",
		"selling_price_list": profile.selling_price_list or "Standard Selling",
		"taxes_and_charges":  getattr(profile, "taxes_and_charges", "") or "",
		"tax_category":       tax_category,
		"print_format":       getattr(profile, "print_format", "") or "",
		"update_stock":       cint(getattr(profile, "update_stock", 0)),
		"hide_unavailable_items": cint(getattr(profile, "hide_unavailable_items", 0)),
		"customer":           getattr(profile, "customer", "") or "",
	}


# ──────────────────────────────────────────────────────────────────────────────
# Void / cancel invoice                                                  T-056
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def void_invoice(invoice_name, reason=""):
	"""
	Cancel a submitted POS/Sales Invoice, reopen the linked table,
	and mark the linked KOT (if any) as Cancelled.

	Returns: {"success": True, "invoice": invoice_name}
	"""
	if not invoice_name:
		frappe.throw(_("Invoice name is required."))

	# Determine doctype
	if _pos_invoice_exists() and frappe.db.exists("POS Invoice", invoice_name):
		inv_doctype = "POS Invoice"
	elif frappe.db.exists("Sales Invoice", invoice_name):
		inv_doctype = "Sales Invoice"
	else:
		frappe.throw(_("Invoice {0} not found.").format(invoice_name))

	inv = frappe.get_doc(inv_doctype, invoice_name)

	if inv.docstatus != 1:
		frappe.throw(_("Only submitted invoices can be voided."))

	# Permission check
	if not frappe.has_permission(inv_doctype, "cancel", inv):
		frappe.throw(_("You do not have permission to cancel {0}.").format(invoice_name))

	# Add cancellation reason to remarks if provided
	if reason:
		inv.add_comment("Comment", text=_("Void reason: {0}").format(reason))

	inv.cancel()

	# Reopen the linked table (if any)
	table = getattr(inv, "custom_table", None)
	if table and frappe.db.exists("Restaurant Table", table):
		frappe.db.set_value(
			"Restaurant Table",
			table,
			{
				"status":         "Available",
				"order_id":       None,
				"occupied_since": None,
			},
		)

	# Cancel linked KOTs that reference this invoice (matched by table + posting_date)
	# KOTs don't store invoice_name directly, so we match on table + same-day creation
	if table:
		linked_kots = frappe.get_all(
			"Food KOT",
			filters={
				"table":  table,
				"status": ["in", ["Pending", "In Progress", "Ready", "Held"]],
			},
			pluck="name",
		)
		for kot_name in linked_kots:
			frappe.db.set_value("Food KOT", kot_name, "status", "Cancelled")

	frappe.db.commit()
	return {"success": True, "invoice": invoice_name, "doctype": inv_doctype}


# ──────────────────────────────────────────────────────────────────────────────
# Hold / recall orders                                              T-057 T-058
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def hold_order(order):
	"""
	Save the current cart as a Food KOT with status 'Held' so the cashier
	can serve another table and recall this order later.

	Accepts the same `order` dict shape as create_kot().
	Returns: {"kot_name": "FKOT-..."} or {"error": "..."}
	"""
	if isinstance(order, str):
		order = json.loads(order)

	try:
		kot = frappe.new_doc("Food KOT")
		kot.order_type = order.get("order_type", "Dine In") or "Dine In"
		kot.table      = order.get("table", "") or ""
		kot.order_note = order.get("order_note", "") or ""
		kot.pos_profile = order.get("pos_profile", "") or ""

		customer = order.get("customer", "")
		if customer:
			kot.customer = customer

		for item in order.get("items", []):
			kot.append("items", {
				"item_code": item["item_code"],
				"item_name": item.get("item_name", item["item_code"]),
				"qty":       flt(item.get("qty", 1)),
				"item_note": item.get("item_note", "") or "",
				"is_done":   0,
			})

		kot.flags.ignore_permissions = True
		# Insert first (before_insert forces Pending), then set Held and save
		kot.insert()
		frappe.db.set_value("Food KOT", kot.name, "status", "Held")
		frappe.db.commit()

		return {"kot_name": kot.name}

	except Exception as e:
		frappe.db.rollback()
		frappe.log_error(frappe.get_traceback(), "Food POS: hold_order error")
		return {"error": str(e)}


@frappe.whitelist()
def get_held_orders(pos_profile=None):
	"""
	Return all Food KOTs with status 'Held', optionally scoped to a POS Profile.
	Used to populate the "Recall Order" picker.
	"""
	try:
		filters = {"status": "Held"}
		if pos_profile:
			filters["pos_profile"] = pos_profile

		kots = frappe.get_all(
			"Food KOT",
			filters=filters,
			fields=[
				"name", "status", "order_type", "table",
				"customer", "order_note", "creation", "pos_profile",
			],
			order_by="creation desc",
		)

		for kot in kots:
			kot["items"] = frappe.get_all(
				"Food KOT Item",
				filters={"parent": kot.name},
				fields=["name", "item_code", "item_name", "qty", "item_note", "is_done"],
			)

		return kots

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "Food POS: get_held_orders error")
		return []


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 1 — ITEM MODIFIERS & ADD-ONS
# ══════════════════════════════════════════════════════════════════════════════
#
# Flow:
#   ItemSelector.show_item_detail() → get_item_modifiers(item_code)
#     └→ renders modifier checkboxes/radio in the item detail dialog
#        selected modifiers are appended to item_note and adjust the rate
#        before the item is pushed into the Cart via add_item_to_cart()
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def get_item_modifiers(item_code):
	"""
	Return the modifier group attached to this item (if any).

	Returns:
	  {
	    "group_name": "Cooking Level",
	    "selection_type": "Single",      # Single | Multiple
	    "min_selections": 1,
	    "max_selections": 1,
	    "is_required": 1,
	    "modifiers": [
	      {"modifier_name": "Rare",       "price_adjustment": 0,  "is_default": 0},
	      {"modifier_name": "Medium Rare","price_adjustment": 0,  "is_default": 1},
	      {"modifier_name": "Well Done",  "price_adjustment": 0,  "is_default": 0},
	    ]
	  }
	  or {} if no modifier group is attached.
	"""
	if not item_code:
		return {}

	# Detect whether the custom field was installed by this app's patch
	item_cols = frappe.db.get_table_columns("Item")
	if "custom_modifier_group" not in item_cols:
		return {}

	modifier_group_name = frappe.db.get_value("Item", item_code, "custom_modifier_group")
	if not modifier_group_name:
		return {}

	try:
		group = frappe.get_cached_doc("Food Item Modifier Group", modifier_group_name)
	except frappe.DoesNotExistError:
		return {}

	if group.disabled:
		return {}

	return {
		"group_name":      group.group_name,
		"selection_type":  group.selection_type,
		"min_selections":  cint(group.min_selections),
		"max_selections":  cint(group.max_selections),
		"is_required":     cint(group.is_required),
		"modifiers": [
			{
				"modifier_name":     m.modifier_name,
				"price_adjustment":  flt(m.price_adjustment),
				"is_default":        cint(m.is_default),
			}
			for m in group.modifiers
			if not cint(m.disabled)
		],
	}


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 2 — SPLIT BILLING
# ══════════════════════════════════════════════════════════════════════════════
#
# Flow:
#   Cart "Split Bill" button → SplitBill dialog
#     Mode A — Equal split:   divide grand_total / N; each part calls
#               create_pos_invoice() with proportional items or a single
#               description line for the split amount.
#     Mode B — Item selection: user drags specific items to "Bill 2";
#               each bill gets its own create_pos_invoice() call.
#
#   The backend validates totals so the sum of all splits equals the
#   original order total (within rounding tolerance).
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def create_split_invoices(splits, pos_profile=None):
	"""
	Create multiple invoices from one order (split billing).

	Args:
	    splits (list): [
	        {
	          "items": [...],          # subset of order items
	          "payments": [...],       # payment lines for this split
	          "customer": "...",       # optional, falls back to walk-in
	          "order_type": "Dine In",
	          "table": "T01",
	          "order_note": "...",
	          "discount_percentage": 0,
	          "discount_amount": 0,
	          "pos_profile": "..."
	        },
	        ...
	    ]
	    pos_profile: fallback POS profile if not in splits

	Returns:
	    {"invoices": [{"invoice": "...", "grand_total": ..., "invoice_type": "..."}, ...]}
	"""
	if isinstance(splits, str):
		splits = json.loads(splits)

	if not splits:
		frappe.throw(_("No splits provided."))

	results = []
	for idx, split in enumerate(splits):
		if not split.get("items"):
			frappe.throw(_("Split {0} has no items.").format(idx + 1))

		# Inject pos_profile fallback
		if not split.get("pos_profile"):
			split["pos_profile"] = pos_profile or _get_default_pos_profile()

		payments = split.pop("payments", [])

		try:
			result = create_pos_invoice(order=split, payments=payments)
			results.append(result)
		except Exception as e:
			frappe.log_error(frappe.get_traceback(), "FoodPOS: create_split_invoices error on split {0}".format(idx + 1))
			frappe.throw(_("Failed to create invoice for split {0}: {1}").format(idx + 1, str(e)))

	return {"invoices": results}


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE 3 — TABLE TRANSFERS & MERGING
# ══════════════════════════════════════════════════════════════════════════════
#
# Transfer flow:
#   Occupied source table  →  Available destination table
#   1. Validate source is Occupied, destination is Available
#   2. Copy source table's order_id, guests, waiter to destination
#   3. Update any active Food KOTs to point to the new table
#   4. Free the source table → Cleaning
#   5. Return updated table list so the frontend re-renders
#
# Merge flow:
#   Primary (Occupied) + one or more secondary (any status) tables
#   1. Validate no table is already in an active merge
#   2. Create a Food Table Merge record
#   3. Mark secondary tables as "Occupied" with the primary's order_id
#   4. Return the merge record name and updated tables
#
# Unmerge flow:
#   1. Find active Food Table Merge for the primary table
#   2. Set status = Unmerged, record unmerged_at
#   3. Mark secondary tables back to Available (or Cleaning if they had guests)
# ──────────────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def transfer_table_order(source_table, destination_table):
	"""
	Move an active order from source_table → destination_table.

	- source_table    must be Occupied
	- destination_table must be Available

	Returns: {"success": True, "source": source_table, "destination": destination_table}
	"""
	if not source_table or not destination_table:
		frappe.throw(_("Both source and destination tables are required."))

	if source_table == destination_table:
		frappe.throw(_("Source and destination cannot be the same table."))

	src = frappe.db.get_value(
		"Restaurant Table",
		source_table,
		["status", "order_id", "guests", "waiter", "notes", "occupied_since"],
		as_dict=True,
	)
	if not src:
		frappe.throw(_("Source table '{0}' not found.").format(source_table))
	if src.status != "Occupied":
		frappe.throw(_("Source table '{0}' is not Occupied (status: {1}).").format(source_table, src.status))

	dst = frappe.db.get_value("Restaurant Table", destination_table, ["status", "table_no"], as_dict=True)
	if not dst:
		frappe.throw(_("Destination table '{0}' not found.").format(destination_table))
	if dst.status != "Available":
		frappe.throw(
			_("Destination table '{0}' is not Available (status: {1}).").format(destination_table, dst.status)
		)

	# ── Move table metadata ──────────────────────────────────────────────────
	frappe.db.set_value(
		"Restaurant Table",
		destination_table,
		{
			"status":         "Occupied",
			"order_id":       src.order_id,
			"guests":         src.guests,
			"waiter":         src.waiter,
			"notes":          src.notes,
			"occupied_since": src.occupied_since,
		},
	)

	# Free source table
	frappe.db.set_value(
		"Restaurant Table",
		source_table,
		{
			"status":         "Cleaning",
			"order_id":       None,
			"guests":         0,
			"waiter":         None,
			"occupied_since": None,
		},
	)

	# ── Redirect active KOTs to the new table ────────────────────────────────
	# KOTs store table as a plain Data field — update all Pending/In Progress/Ready KOTs
	active_kots = frappe.get_all(
		"Food KOT",
		filters={
			"table":  source_table,
			"status": ["in", ["Pending", "In Progress", "Ready", "Held"]],
		},
		pluck="name",
	)
	for kot_name in active_kots:
		frappe.db.set_value("Food KOT", kot_name, "table", destination_table)

	frappe.db.commit()
	return {"success": True, "source": source_table, "destination": destination_table, "kots_moved": len(active_kots)}


@frappe.whitelist()
def merge_tables(primary_table, secondary_tables):
	"""
	Physically merge secondary_tables into primary_table for a large party.

	- primary_table      must be Occupied (has the active order)
	- secondary_tables   list of table names; must be Available or Reserved

	Creates a Food Table Merge record to track the merge.
	Secondary tables are marked Occupied with the primary's order_id.

	Returns: {"merge_name": "FTMRG-...", "success": True}
	"""
	if isinstance(secondary_tables, str):
		secondary_tables = json.loads(secondary_tables)

	if not secondary_tables:
		frappe.throw(_("At least one secondary table is required for merging."))

	# Validate primary
	primary = frappe.db.get_value(
		"Restaurant Table",
		primary_table,
		["status", "order_id", "table_no"],
		as_dict=True,
	)
	if not primary:
		frappe.throw(_("Primary table '{0}' not found.").format(primary_table))
	if primary.status not in ("Occupied", "Available"):
		frappe.throw(
			_("Primary table must be Occupied or Available (current: {0}).").format(primary.status)
		)

	# Validate secondaries
	for tbl in secondary_tables:
		row = frappe.db.get_value("Restaurant Table", tbl, ["status", "table_no"], as_dict=True)
		if not row:
			frappe.throw(_("Table '{0}' not found.").format(tbl))
		if row.status not in ("Available", "Reserved"):
			frappe.throw(
				_("Secondary table '{0}' must be Available or Reserved (current: {1}).").format(
					tbl, row.status
				)
			)

	# ── Create the merge record ──────────────────────────────────────────────
	merge_doc = frappe.new_doc("Food Table Merge")
	merge_doc.primary_table = primary_table
	merge_doc.status = "Active"
	for tbl in secondary_tables:
		merge_doc.append("secondary_tables", {"table": tbl})

	merge_doc.flags.ignore_permissions = True  # system-initiated
	merge_doc.insert()

	# ── Mark primary Occupied if it wasn't already ───────────────────────────
	if primary.status == "Available":
		frappe.db.set_value(
			"Restaurant Table",
			primary_table,
			{"status": "Occupied", "occupied_since": now_datetime()},
		)

	# ── Mark secondaries as Occupied under the primary's order_id ────────────
	for tbl in secondary_tables:
		frappe.db.set_value(
			"Restaurant Table",
			tbl,
			{
				"status":         "Occupied",
				"order_id":       primary.order_id or merge_doc.name,
				"occupied_since": now_datetime(),
				"notes":          _("Merged with {0}").format(primary_table),
			},
		)

	frappe.db.commit()
	return {"success": True, "merge_name": merge_doc.name}


@frappe.whitelist()
def unmerge_tables(primary_table):
	"""
	Undo an active merge for primary_table.
	Secondary tables are released back to Cleaning status.
	The Food Table Merge record is set to Unmerged.

	Returns: {"success": True, "merge_name": "FTMRG-..."}
	"""
	# Find the active merge for this primary table
	merge_name = frappe.db.get_value(
		"Food Table Merge",
		{"primary_table": primary_table, "status": "Active"},
		"name",
	)
	if not merge_name:
		frappe.throw(_("No active merge found for table '{0}'.").format(primary_table))

	merge_doc = frappe.get_doc("Food Table Merge", merge_name)

	# Release each secondary table
	for row in merge_doc.secondary_tables or []:
		frappe.db.set_value(
			"Restaurant Table",
			row.table,
			{
				"status":         "Cleaning",
				"order_id":       None,
				"occupied_since": None,
				"notes":          None,
			},
		)

	# Close the merge record
	frappe.db.set_value(
		"Food Table Merge",
		merge_name,
		{
			"status":      "Unmerged",
			"unmerged_at": now_datetime(),
		},
	)

	frappe.db.commit()
	return {"success": True, "merge_name": merge_name}


@frappe.whitelist()
def get_active_merge(table_name):
	"""
	Return the active Food Table Merge record that involves table_name
	(either as primary or secondary), or {} if none.

	Used by the frontend to show merged-table badges.
	"""
	# Check as primary
	merge_name = frappe.db.get_value(
		"Food Table Merge",
		{"primary_table": table_name, "status": "Active"},
		"name",
	)

	if not merge_name:
		# Check as secondary
		result = frappe.db.sql(
			"""
			SELECT ftm.name FROM `tabFood Table Merge` ftm
			JOIN `tabFood Table Merge Secondary` ftms ON ftms.parent = ftm.name
			WHERE ftms.table = %(tbl)s AND ftm.status = 'Active'
			LIMIT 1
			""",
			{"tbl": table_name},
			as_dict=True,
		)
		merge_name = result[0].name if result else None

	if not merge_name:
		return {}

	merge_doc = frappe.get_doc("Food Table Merge", merge_name)
	return {
		"merge_name":       merge_doc.name,
		"primary_table":    merge_doc.primary_table,
		"secondary_tables": [r.table for r in merge_doc.secondary_tables],
	}


# ──────────────────────────────────────────────────────────────────────────────
# Draft Tabs & Table Status API Wrappers
# ──────────────────────────────────────────────────────────────────────────────

@frappe.whitelist()
def save_draft_order(order_data):
	"""Proxy to page food_pos save_draft_order."""
	from foodpos.foodpos.page.food_pos.food_pos import save_draft_order as _save_draft_order
	return _save_draft_order(order_data)


@frappe.whitelist()
def get_active_draft_tabs(pos_profile=None):
	"""Proxy to page food_pos get_active_draft_tabs."""
	from foodpos.foodpos.page.food_pos.food_pos import get_active_draft_tabs as _get_active_draft_tabs
	return _get_active_draft_tabs(pos_profile)


@frappe.whitelist()
def discard_draft_order(invoice_name, table=None):
	"""Proxy to page food_pos discard_draft_order."""
	from foodpos.foodpos.page.food_pos.food_pos import discard_draft_order as _discard_draft_order
	return _discard_draft_order(invoice_name, table)


@frappe.whitelist()
def update_table_status(table, status):
	"""Proxy to page food_pos update_table_status."""
	from foodpos.foodpos.page.food_pos.food_pos import update_table_status as _update_table_status
	return _update_table_status(table, status)
