# Copyright (c) 2026, nextash and contributors
# License: MIT

"""
Patch v0.4.0 — v5.5 seed / demo data so the POS can be tested right after
``bench migrate`` (no manual Item / Table / Profile setup needed).

Creates ONLY what is missing (every create is guarded by frappe.db.exists),
so re-running the patch — or migrating a site that already has real data —
changes nothing:

  * Item Groups (categories): Pizza, Burgers, Noodles, Soup, Fast Food,
    Beverages (under "All Item Groups").
  * 8 Items (non-stock, so no Bin / warehouse stock is needed to sell them)
    with an Item Price on "Standard Selling" (created first if missing):
      Chicken Tikka Pizza 550, Margherita Pizza 520, Zinger Burger 450,
      Chicken Chowmein 480, Hot & Sour Soup 280, Fries & Cheese 220,
      Chicken Sandwich 350, Soft Drink 120.
    Prices match the v5 preview menu. Veg flags use custom_is_vegetarian
    only when that custom field exists (v0.1.0 patch).
  * Branch "Main Branch" (needed — Restaurant Table.branch links to Branch).
  * Restaurant Tables T1–T4 (Main Hall, 4 seats) + T5–T6 (Family Hall,
    6 seats), all Available.
  * Food Kitchen Stations "Main Kitchen", "Pizza", "Grill", "Beverages"
    (v5.7 — Food KOT.kitchen_station is a Link to Food Kitchen Station,
    named "Main Branch-<station>"; without these docs Confirm to Kitchen
    fails link validation with "Could not find ... Kitchen Station").
    create_kot also creates a missing station on demand, so confirm works
    even if this patch is skipped.
  * POS Profile "Food POS" — ONLY when the site has no enabled POS Profile
    at all. Company = site default company, warehouse = first warehouse of
    that company, selling price list "Standard Selling", item groups = the
    6 seed groups, payments Cash (default) + Credit Card when those Modes
    of Payment exist. If there is no company or no warehouse, the profile
    is skipped with a message (items + tables are still seeded).

The walk-in customer is NOT seeded here — the POS creates it on demand
(see _get_walk_in_customer in foodpos.page.food_pos.food_pos).

Register in patches.txt under [post_model_sync]:
    foodpos.patches.v0_4_0.add_seed_data
"""

import frappe

PRICE_LIST = "Standard Selling"

SEED_GROUPS = ("Pizza", "Burgers", "Noodles", "Soup", "Fast Food", "Beverages")

# (item_code, item_name, item_group, rate, is_vegetarian)
SEED_ITEMS = (
	("PIZZA-TIKKA", "Chicken Tikka Pizza", "Pizza", 550, 0),
	("PIZZA-MARG", "Margherita Pizza", "Pizza", 520, 1),
	("BURGER-ZINGER", "Zinger Burger", "Burgers", 450, 0),
	("NOODLE-CHOWMEIN", "Chicken Chowmein", "Noodles", 480, 0),
	("SOUP-HOTSOUR", "Hot & Sour Soup", "Soup", 280, 1),
	("FRIES-CHEESE", "Fries & Cheese", "Fast Food", 220, 1),
	("SANDWICH-CHICKEN", "Chicken Sandwich", "Fast Food", 350, 0),
	("DRINK-SOFT", "Soft Drink", "Beverages", 120, 1),
)

SEED_TABLES = (
	("T1", "Main Hall", 4),
	("T2", "Main Hall", 4),
	("T3", "Main Hall", 4),
	("T4", "Main Hall", 4),
	("T5", "Family Hall", 6),
	("T6", "Family Hall", 6),
)

# v5.7: every station _get_item_station can route to (see food_pos.py).
SEED_STATIONS = ("Main Kitchen", "Pizza", "Grill", "Beverages")


def _ensure_price_list(currency):
	if frappe.db.exists("Price List", PRICE_LIST):
		return
	pl = frappe.get_doc({
		"doctype": "Price List",
		"price_list_name": PRICE_LIST,
		"currency": currency or "PKR",
		"selling": 1,
		"buying": 0,
		"enabled": 1,
	})
	pl.flags.ignore_permissions = True
	pl.insert()
	print(f"  foodpos seed: created Price List {PRICE_LIST}")


def _ensure_item_groups():
	for group in SEED_GROUPS:
		if frappe.db.exists("Item Group", group):
			continue
		g = frappe.get_doc({
			"doctype": "Item Group",
			"item_group_name": group,
			"parent_item_group": "All Item Groups",
			"is_group": 0,
		})
		g.flags.ignore_permissions = True
		g.insert()
		print(f"  foodpos seed: created Item Group {group}")


def _ensure_items():
	has_veg_col = frappe.db.has_column("Item", "custom_is_vegetarian")
	for code, name, group, rate, veg in SEED_ITEMS:
		if not frappe.db.exists("Item", code):
			item = frappe.get_doc({
				"doctype": "Item",
				"item_code": code,
				"item_name": name,
				"item_group": group,
				"description": name,
				"stock_uom": "Nos",
				"is_stock_item": 0,  # service item: sells without stock / Bin
				"is_sales_item": 1,
				"is_purchase_item": 0,
				"is_fixed_asset": 0,
				"disabled": 0,
			})
			if has_veg_col:
				item.custom_is_vegetarian = veg
			item.flags.ignore_permissions = True
			item.insert()
			print(f"  foodpos seed: created Item {code} ({name})")
		if not frappe.db.exists("Item Price", {"price_list": PRICE_LIST, "item_code": code, "selling": 1}):
			ip = frappe.get_doc({
				"doctype": "Item Price",
				"price_list": PRICE_LIST,
				"item_code": code,
				"price_list_rate": rate,
				"selling": 1,
			})
			ip.flags.ignore_permissions = True
			ip.insert()
			print(f"  foodpos seed: priced {code} at {rate} on {PRICE_LIST}")


def _ensure_branch():
	if frappe.db.exists("Branch", "Main Branch"):
		return True
	try:
		b = frappe.get_doc({"doctype": "Branch", "branch": "Main Branch"})
		b.flags.ignore_permissions = True
		b.insert()
		print("  foodpos seed: created Branch Main Branch")
		return True
	except Exception as e:
		print(f"  foodpos seed: could not create Branch Main Branch ({e}) — tables skipped")
		return False


def _ensure_tables():
	if not _ensure_branch():
		return
	for table_no, section, capacity in SEED_TABLES:
		# Restaurant Table autoname is {branch}-{table_no}.
		if frappe.db.exists("Restaurant Table", f"Main Branch-{table_no}"):
			continue
		t = frappe.get_doc({
			"doctype": "Restaurant Table",
			"branch": "Main Branch",
			"table_no": table_no,
			"section": section,
			"capacity": capacity,
			"status": "Available",
		})
		t.flags.ignore_permissions = True
		t.insert()
		print(f"  foodpos seed: created Restaurant Table {table_no} ({section}, {capacity} seats)")


def _ensure_kitchen_stations():
	# Food Kitchen Station autoname is {branch}-{station_name}.
	for station in SEED_STATIONS:
		docname = f"Main Branch-{station}"
		if frappe.db.exists("Food Kitchen Station", docname):
			continue
		st = frappe.get_doc({
			"doctype": "Food Kitchen Station",
			"branch": "Main Branch",
			"station_name": station,
			"is_active": 1,
		})
		st.flags.ignore_permissions = True
		st.insert()
		print(f"  foodpos seed: created Food Kitchen Station {station}")


def _ensure_pos_profile(company):
	# Never create a second profile — only seed when the site has none.
	if frappe.get_all("POS Profile", filters={"disabled": 0}, limit=1):
		return
	if not company:
		print("  foodpos seed: no default company — POS Profile skipped (create one manually)")
		return
	warehouse = frappe.db.get_value("Warehouse", {"company": company}, "name")
	if not warehouse:
		print("  foodpos seed: no warehouse for company — POS Profile skipped (create one manually)")
		return
	currency = frappe.db.get_value("Company", company, "default_currency") or "PKR"
	profile = frappe.get_doc({
		"doctype": "POS Profile",
		"company": company,
		"warehouse": warehouse,
		"selling_price_list": PRICE_LIST,
		"currency": currency,
		"disabled": 0,
	})
	for group in SEED_GROUPS:
		profile.append("item_groups", {"item_group": group})
	for mop, default in (("Cash", 1), ("Credit Card", 0)):
		if frappe.db.exists("Mode of Payment", mop):
			profile.append("payments", {"mode_of_payment": mop, "default": default})
	profile.flags.ignore_permissions = True
	profile.insert()
	print(f"  foodpos seed: created POS Profile Food POS (company {company}, warehouse {warehouse})")


def execute():
	company = frappe.defaults.get_global_default("company")
	currency = frappe.db.get_value("Company", company, "default_currency") if company else "PKR"
	_ensure_price_list(currency)
	_ensure_item_groups()
	_ensure_items()
	_ensure_tables()
	_ensure_kitchen_stations()
	_ensure_pos_profile(company)
	frappe.db.commit()
	print("  foodpos seed: done — open /food-pos to test (Day Open, then order).")
