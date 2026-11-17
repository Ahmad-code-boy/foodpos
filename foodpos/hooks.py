app_name = "foodpos"
app_title = "Foodpos"
app_publisher = "nextash"
app_description = "Customized Food POS system for restaurants"
app_email = "support@nextash.com"
app_license = "mit"

# ── Required apps ─────────────────────────────────────────────────────────────
required_apps = ["erpnext"]

# ── App screen entry ──────────────────────────────────────────────────────────
add_to_apps_screen = [
	{
		"name":           "foodpos",
		"logo":           "/assets/foodpos/images/foodpos_logo.png",
		"title":          "Food POS",
		"route":          "/app/food-pos",
		"has_permission": "foodpos.foodpos.api.food_pos_hooks.has_app_permission",
	}
]

# ── Global assets (NO bench build needed — served directly via symlink) ────────
# The symlink /sites/assets/foodpos → apps/foodpos/foodpos/public is created
# automatically by `bench setup` / `bench build --apps foodpos`.
# Files in public/ are immediately accessible at /assets/foodpos/...
app_include_css = "/assets/foodpos/css/food_pos.css"
app_include_js  = "/assets/foodpos/js/food_pos_bundle.js"

# ── Document events ───────────────────────────────────────────────────────────
doc_events = {
	"Sales Invoice": {
		"on_submit": "foodpos.foodpos.api.food_pos_hooks.on_pos_invoice_submit",
	},
	"POS Invoice": {
		"on_submit": "foodpos.foodpos.api.food_pos_hooks.on_pos_invoice_submit",
	},
	"POS Closing Entry": {
		"autoname": "foodpos.foodpos.page.food_pos.food_pos.autoname_pos_closing_entry",
		"onload": "foodpos.foodpos.page.food_pos.food_pos.pos_closing_entry_onload",
	},
}

# ── Scheduled tasks ───────────────────────────────────────────────────────────
scheduler_events = {
	"hourly": [
		"foodpos.foodpos.api.food_pos_hooks.auto_clear_served_kots",
	],
}

# ── Fixtures ──────────────────────────────────────────────────────────────────
# Restaurant Table rows are site business data (layout plus live status), so they
# are not exported as fixtures. Seed tables come from the v0.4.0 and v7.2.0 patches.
fixtures = [
	{
		"doctype": "Custom Field",
		"filters": [
			["dt", "in", ["Sales Invoice", "POS Invoice", "Item", "POS Profile"]],
			["fieldname", "in", [
				"custom_order_type", "custom_table", "custom_order_note", "custom_branch",
				"custom_is_vegetarian", "custom_is_vegan", "custom_modifier_group",
			]],
		],
	},
	{
		"doctype": "Property Setter",
		"filters": [
			["doc_type", "=", "POS Closing Entry"],
			["field_name", "in", ["pos_invoices", "sales_invoices"]],
		],
	},
]
