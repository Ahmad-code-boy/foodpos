# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Seed a ready-to-sell Food POS: company, payment accounts, tables, kitchen
stations, menu categories, menu items with real photos and prices, and a POS Profile.

Creates what is missing and brings existing menu items up to date, so it is
safe to run more than once.

    bench --site <site> execute foodpos.foodpos.seed.pos_demo.run
"""

import os
import re

import frappe
from frappe.utils import getdate

COMPANY = "Food POS Restaurant"
ABBR = "FPR"
CURRENCY = "PKR"
COUNTRY = "Pakistan"
PRICE_LIST = "Standard Selling"
PROFILE = "Food POS"
WALK_IN = "Walk-in Customer"
PHOTO_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")

GROUPS = ["Pizza", "Burgers", "Sandwiches", "Pasta", "Fried & Sides", "Desserts", "Beverages"]
# Categories used by an earlier version of this seed. Their items stay enabled
# (open orders may still need to be billed) but are not on the POS menu: the
# POS Profile shows only the GROUPS above.
LEGACY_GROUPS = ["Biryani & Rice", "Chinese", "Fast Food"]
RETIRED_GROUP = "Retired Menu"  # old dishes that are off the menu but still billable

# (item name, group, price, vegetarian, photo file, description)
MENU = [
	("Chicken Tikka Pizza", "Pizza", 1450, 0, "chicken_pizza.jpg", "Spiced chicken tikka, onion and mozzarella on a hand-stretched base"),
	("Cheese Lovers Pizza", "Pizza", 1250, 1, "cheese_pizza.jpg", "Three-cheese blend over a rich tomato sauce"),
	("Pepperoni Pizza", "Pizza", 1550, 0, "pepperoni_pizza.jpg", "Beef pepperoni, mozzarella and oregano"),
	("Classic Beef Burger", "Burgers", 850, 0, "classic_beef_burger.jpg", "Grilled beef patty, lettuce, tomato and house sauce"),
	("Cheese Burger", "Burgers", 750, 0, "cheese_burger.jpg", "Beef patty with melted cheddar and pickles"),
	("Club Sandwich", "Sandwiches", 590, 0, "club_sandwich.jpg", "Triple-decker with chicken, egg and cheese"),
	("Grilled Chicken Sandwich", "Sandwiches", 620, 0, "grilled_chicken_sandwich.jpg", "Char-grilled chicken with garlic mayo"),
	("Alfredo Pasta", "Pasta", 950, 1, "alfredo_pasta.jpg", "Fettuccine in a creamy parmesan sauce"),
	("Chicken Pasta", "Pasta", 1050, 0, "chicken_pasta.jpg", "Penne with grilled chicken in a tomato cream sauce"),
	("Fried Chicken (4 pcs)", "Fried & Sides", 890, 0, "fried_chicken.jpg", "Crispy golden fried chicken pieces"),
	("Hot Wings (6 pcs)", "Fried & Sides", 690, 0, "chicken_wings.jpg", "Saucy chicken wings with a cooling dip"),
	("French Fries", "Fried & Sides", 290, 1, "french_fries.jpg", "Crispy salted fries"),
	("Loaded Fries", "Fried & Sides", 490, 1, "loaded_fries.jpg", "Fries topped with cheese sauce and herbs"),
	("Fudge Brownie", "Desserts", 380, 1, "brownie.jpg", "Warm chocolate fudge brownie"),
	("Chocolate Cake", "Desserts", 450, 1, "chocolate_cake.jpg", "Rich layered chocolate cake"),
	("Ice Cream Sundae", "Desserts", 350, 1, "ice_cream.jpg", "Vanilla ice cream with chocolate sauce"),
	("Coca-Cola", "Beverages", 150, 1, "coca_cola.jpg", "Chilled 345 ml can"),
	("Fresh Lemonade", "Beverages", 250, 1, "fresh_lemonade.jpg", "Freshly squeezed lemon with mint"),
	("Mango Shake", "Beverages", 420, 1, "mango_shake.jpg", "Thick shake made with ripe mangoes"),
	("Strawberry Shake", "Beverages", 420, 1, "strawberry_shake.jpg", "Creamy strawberry milkshake"),
]

TABLES = [
	("T1", "Main Hall", 2), ("T2", "Main Hall", 4), ("T3", "Main Hall", 4), ("T4", "Main Hall", 6),
	("T5", "Family Hall", 4), ("T6", "Family Hall", 6), ("T7", "Family Hall", 8), ("T8", "Family Hall", 8),
	("T9", "Terrace", 2), ("T10", "Terrace", 4),
]

STATIONS = ["Main Kitchen", "Pizza", "Grill", "Beverages"]


def _insert(doc):
	doc = frappe.get_doc(doc)
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc


def _ensure_root(doctype, name, name_field):
	if not frappe.db.exists(doctype, name):
		_insert({"doctype": doctype, name_field: name, "is_group": 1})


def _ensure_leaf(doctype, name, name_field, parent_field, parent):
	if not frappe.db.exists(doctype, name):
		_insert({"doctype": doctype, name_field: name, parent_field: parent, "is_group": 0})


def _ensure_trees():
	_ensure_root("Item Group", "All Item Groups", "item_group_name")
	_ensure_root("Customer Group", "All Customer Groups", "customer_group_name")
	_ensure_root("Territory", "All Territories", "territory_name")
	_ensure_root("Supplier Group", "All Supplier Groups", "supplier_group_name")
	_ensure_leaf("Customer Group", "Individual", "customer_group_name", "parent_customer_group", "All Customer Groups")
	_ensure_leaf("Territory", COUNTRY, "territory_name", "parent_territory", "All Territories")
	for group in GROUPS:
		_ensure_leaf("Item Group", group, "item_group_name", "parent_item_group", "All Item Groups")


def _ensure_company():
	if not frappe.db.exists("Company", COMPANY):
		_insert({
			"doctype": "Company", "company_name": COMPANY, "abbr": ABBR,
			"default_currency": CURRENCY, "country": COUNTRY,
			"create_chart_of_accounts_based_on": "Standard Template", "chart_of_accounts": "Standard",
		})
	frappe.db.set_single_value("Global Defaults", {"default_company": COMPANY, "default_currency": CURRENCY, "country": COUNTRY})
	frappe.defaults.set_global_default("company", COMPANY)
	return frappe.get_doc("Company", COMPANY)


def _leaf_account(account_name, parent, account_type):
	name = f"{account_name} - {ABBR}"
	if not frappe.db.exists("Account", name):
		_insert({
			"doctype": "Account", "account_name": account_name, "parent_account": parent,
			"company": COMPANY, "account_type": account_type, "is_group": 0,
		})
	return name


def _ensure_payment_modes(company):
	cash_account = company.default_cash_account or frappe.db.get_value(
		"Account", {"company": COMPANY, "account_type": "Cash", "is_group": 0}, "name")
	bank_parent = frappe.db.get_value("Account", {"company": COMPANY, "account_type": "Bank", "is_group": 1}, "name") \
		or frappe.db.get_value("Account", {"company": COMPANY, "account_name": "Bank Accounts"}, "name")
	card_account = _leaf_account("POS Card and QR", bank_parent, "Bank")

	modes = {"Cash": ("Cash", cash_account), "Credit Card": ("Bank", card_account), "QR": ("Bank", card_account)}
	for mode, (mode_type, account) in modes.items():
		if not frappe.db.exists("Mode of Payment", mode):
			_insert({"doctype": "Mode of Payment", "mode_of_payment": mode, "type": mode_type, "enabled": 1})
		mop = frappe.get_doc("Mode of Payment", mode)
		if not any(r.company == COMPANY for r in mop.accounts):
			mop.append("accounts", {"company": COMPANY, "default_account": account})
			mop.flags.ignore_permissions = True
			mop.save()
	return list(modes)


def _ensure_price_list():
	if not frappe.db.exists("Price List", PRICE_LIST):
		_insert({"doctype": "Price List", "price_list_name": PRICE_LIST, "selling": 1, "currency": CURRENCY, "enabled": 1})


def _ensure_walk_in():
	if not frappe.db.exists("Customer", WALK_IN):
		_insert({"doctype": "Customer", "customer_name": WALK_IN, "customer_type": "Individual",
			"customer_group": "Individual", "territory": COUNTRY})


def _ensure_tables_and_stations():
	from foodpos.foodpos.page.food_pos.food_pos import _ensure_kitchen_station
	from foodpos.foodpos.single_branch import SINGLE_BRANCH

	if not frappe.db.exists("Branch", SINGLE_BRANCH):
		_insert({"doctype": "Branch", "branch": SINGLE_BRANCH})
	for table_no, section, capacity in TABLES:
		if not frappe.db.exists("Restaurant Table", {"table_no": table_no}):
			_insert({"doctype": "Restaurant Table", "branch": SINGLE_BRANCH, "table_no": table_no,
				"section": section, "capacity": capacity, "status": "Available", "disabled": 0})
	for station in STATIONS:
		_ensure_kitchen_station(station)


def _item_code(name):
	return re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-")


def _attach_photo(code, photo):
	"""Attach the menu photo as the item's image (replacing a different one)."""
	path = os.path.join(PHOTO_DIR, photo)
	if not os.path.exists(path):
		return None
	wanted = f"{code.lower()}.jpg"
	current = frappe.db.get_value("Item", code, "image") or ""
	if current.endswith("/" + wanted):
		return current
	for old in frappe.get_all("File", filters={"attached_to_doctype": "Item", "attached_to_name": code}, pluck="name"):
		frappe.delete_doc("File", old, force=True, ignore_permissions=True)
	with open(path, "rb") as f:
		file_doc = _insert({"doctype": "File", "file_name": wanted, "is_private": 0,
			"attached_to_doctype": "Item", "attached_to_name": code, "attached_to_field": "image",
			"content": f.read()})
	frappe.db.set_value("Item", code, "image", file_doc.file_url)
	return file_doc.file_url


def _ensure_items():
	has_veg = frappe.get_meta("Item").has_field("custom_is_vegetarian")
	menu_codes = set()
	created = 0
	for name, group, price, veg, photo, description in MENU:
		code = _item_code(name)
		menu_codes.add(code)
		values = {"item_name": name, "item_group": group, "description": description, "disabled": 0,
			"is_sales_item": 1}
		if has_veg:
			values["custom_is_vegetarian"] = veg
		if not frappe.db.exists("Item", code):
			_insert({"doctype": "Item", "item_code": code, "stock_uom": "Nos", "is_stock_item": 0,
				"include_item_in_manufacturing": 0, **values})
			created += 1
		else:
			frappe.db.set_value("Item", code, values)
		_attach_photo(code, photo)
		price_name = frappe.db.get_value("Item Price", {"item_code": code, "price_list": PRICE_LIST}, "name")
		if price_name:
			frappe.db.set_value("Item Price", price_name, "price_list_rate", price)
		else:
			_insert({"doctype": "Item Price", "item_code": code, "price_list": PRICE_LIST,
				"price_list_rate": price, "currency": CURRENCY})

	# Items from an earlier version of this menu leave the POS menu through the
	# profile's item groups, not by disabling: a disabled item cannot be billed,
	# and open orders may still contain it.
	_ensure_leaf("Item Group", RETIRED_GROUP, "item_group_name", "parent_item_group", "All Item Groups")
	off_menu = frappe.get_all("Item", filters={"item_group": ["in", GROUPS], "name": ["not in", list(menu_codes)]}, pluck="name")
	for code in off_menu:
		frappe.db.set_value("Item", code, "item_group", RETIRED_GROUP)
	legacy = frappe.get_all("Item", filters={"item_group": ["in", LEGACY_GROUPS + [RETIRED_GROUP]], "disabled": 1}, pluck="name")
	for code in legacy:
		frappe.db.set_value("Item", code, "disabled", 0)
	return created, len(legacy)


def _ensure_profile(company, modes):
	warehouse = frappe.db.get_value("Warehouse", {"company": COMPANY, "is_group": 0, "warehouse_name": "Stores"}, "name") \
		or frappe.db.get_value("Warehouse", {"company": COMPANY, "is_group": 0}, "name")
	cost_center = company.cost_center or frappe.db.get_value("Cost Center", {"company": COMPANY, "is_group": 0}, "name")
	if frappe.db.exists("POS Profile", PROFILE):
		_set_menu_groups(PROFILE)
		return PROFILE
	users = frappe.get_all("User", filters={"user_type": "System User", "enabled": 1, "name": ["!=", "Guest"]}, pluck="name")
	_insert({
		"doctype": "POS Profile", "name": PROFILE, "company": COMPANY, "warehouse": warehouse,
		"currency": CURRENCY, "country": COUNTRY, "selling_price_list": PRICE_LIST, "customer": WALK_IN,
		"write_off_account": company.write_off_account or frappe.db.get_value("Account", {"company": COMPANY, "account_name": "Write Off"}, "name"),
		"write_off_cost_center": cost_center, "cost_center": cost_center,
		"income_account": company.default_income_account, "expense_account": company.default_expense_account,
		"payments": [{"mode_of_payment": m, "default": 1 if m == "Cash" else 0} for m in modes],
		"applicable_for_users": [{"user": u, "default": 1} for u in users],
		"item_groups": [{"item_group": g} for g in GROUPS],
	})
	return PROFILE


def _set_menu_groups(profile):
	"""The POS menu shows exactly the seeded categories."""
	doc = frappe.get_doc("POS Profile", profile)
	if sorted(r.item_group for r in doc.item_groups) != sorted(GROUPS):
		doc.set("item_groups", [{"item_group": g} for g in GROUPS])
		doc.flags.ignore_permissions = True
		doc.save()


def _ensure_settings(company):
	"""Point ERPNext's selling and stock defaults at records that exist on this site."""
	warehouse = frappe.db.get_value("Warehouse", {"company": COMPANY, "is_group": 0, "warehouse_name": "Stores"}, "name") \
		or frappe.db.get_value("Warehouse", {"company": COMPANY, "is_group": 0}, "name")
	frappe.db.set_single_value("Selling Settings", {
		"customer_group": "Individual", "territory": COUNTRY, "selling_price_list": PRICE_LIST,
	})
	if warehouse:
		frappe.db.set_single_value("Stock Settings", "default_warehouse", warehouse)
	frappe.defaults.set_global_default("customer_group", "Individual")
	frappe.defaults.set_global_default("territory", COUNTRY)


def run():
	_ensure_trees()
	company = _ensure_company()
	modes = _ensure_payment_modes(company)
	_ensure_settings(company)
	_ensure_price_list()
	_ensure_walk_in()
	_ensure_tables_and_stations()
	created, retired = _ensure_items()
	profile = _ensure_profile(company, modes)
	frappe.db.commit()
	summary = {
		"company": COMPANY, "pos_profile": profile, "items_created": created, "legacy_items_reenabled": retired,
		"menu_items": frappe.db.count("Item", {"disabled": 0}),
		"with_photo": frappe.db.count("Item", {"disabled": 0, "image": ["is", "set"]}),
		"tables": frappe.db.count("Restaurant Table"), "fiscal_year_ok": bool(frappe.db.sql(
			"select 1 from `tabFiscal Year` where %s between year_start_date and year_end_date", getdate())),
	}
	print(summary)
	return summary
