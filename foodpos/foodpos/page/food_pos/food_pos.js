/**
 * Food POS - Restaurant Point of Sale for Frappe & ERPNext v16
 * Handles Cart, Offline Sync Queue, Table Floor Management, KOTs, and Invoicing.
 */

frappe.provide("foodpos.FoodPOS");

// v2 single branch: one branch only ("Main Branch"). The old branch
// columns are kept in the database for existing data, but the client
// never selects, filters or switches by branch any more.
const FPOS_SINGLE_BRANCH = "Main Branch";
const FPOS_ORDER_TYPES = ["Walk In", "Dine In", "Takeaway", "Delivery"];

// ── v3: SVG icon library — premium line icons (stroke 1.8, 24px grid).
// Emoji is never a UI icon in v3; v5 adds proper SVG food icons
// (pizza / burger / noodle / soup / fries / sandwich / drink / dessert /
// combo / plate) so item cards never fall back to a bare letter or emoji.
// Usage: fpos_icon("home").
const FPOS_ICONS = {
	grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
	menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
	bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
	home: '<path d="M3 9.5 12 3l9 6.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22v-8h6v8"/>',
	chef: '<path d="M4 17h16"/><path d="M12 9a8 8 0 0 1 8 8H4a8 8 0 0 1 8-8z"/><path d="M12 9V6"/><circle cx="12" cy="4.5" r="1.4"/>',
	cloche: '<path d="M4 16.5a8 8 0 0 1 16 0z"/><path d="M2 19.5h20M12 8.5V7"/><circle cx="12" cy="5.5" r="1.2"/>',
	table: '<ellipse cx="12" cy="8.5" rx="7.5" ry="3"/><path d="M12 11.5V20"/><path d="M7 20h10"/>',
	calendar: '<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
	truck: '<rect x="1.5" y="4" width="14" height="12" rx="1"/><path d="M15.5 9h4l3.5 3.5V16h-7.5z"/><circle cx="6" cy="18.5" r="1.8"/><circle cx="18.5" cy="18.5" r="1.8"/>',
	chart: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',
	settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
	filter: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>',
	logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
	receipt: '<path d="M5 2h14v20l-2.3-1.4L14.4 22l-2.4-1.4L9.6 22 7.3 20.6 5 22z"/><path d="M9 7.5h6M9 11.5h6M9 15.5h4"/>',
	clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
	users: '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7.5" r="3.8"/><path d="M22 21v-2a4 4 0 0 0-3-3.8M15.5 4a3.8 3.8 0 0 1 0 7.5"/>',
	user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21v-1a7.5 7.5 0 0 1 15 0v1"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5.5"/>',
	star: '<path d="M12 2.5 14.9 8.6l6.6.9-4.8 4.6 1.2 6.6L12 17.6 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9z"/>',
	people: '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9.5" cy="7.5" r="3.8"/><path d="M22 21v-2a4 4 0 0 0-3-3.8M15.5 4a3.8 3.8 0 0 1 0 7.5"/>',
	timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.5 1.5M10 2.5h4"/>',
	pause: '<path d="M9 5v14M15 5v14"/>',
	search: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.5 16.5"/>',
	plus: '<path d="M12 5v14M5 12h14"/>',
	minus: '<path d="M5 12h14"/>',
	card: '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/>',
	cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><path d="M5.5 9.5h.01M18.5 14.5h.01"/>',
	qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M21 18v3"/>',
	cart: '<circle cx="9" cy="20.5" r="1.4"/><circle cx="18" cy="20.5" r="1.4"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L22 7H6"/>',
	tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
	trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
	refresh: '<path d="M23 4v6h-6"/><path d="M20.5 15a9 9 0 1 1-1.6-9.4L23 10"/>',
	alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16.5h.01"/>',
	pin: '<path d="M21 10c0 7-9 12.5-9 12.5S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
	box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
	x: '<path d="M18 6 6 18M6 6l12 12"/>',
	printer: '<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7" rx="1"/>',
	edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
	// ── v5: food icons — used as the no-photo fallback inside item cards
	// (rich gradient tile + large SVG) and on category tiles. Never emoji.
	pizza: '<path d="M4.5 4.8 12 20.5 19.5 4.8A9 9 0 0 0 4.5 4.8z"/><path d="M12 20.5V9.5"/><circle cx="9" cy="8" r="1.1"/><circle cx="14.8" cy="7.2" r="1.1"/><circle cx="12" cy="13" r="1.1"/>',
	burger: '<path d="M5 10.5a7 5.5 0 0 1 14 0z"/><path d="M4 14.5h16"/><path d="M5.5 18h13a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 18z"/><path d="M9.5 7.8h.01M13.5 6.8h.01"/>',
	noodle: '<path d="M3.5 12.5h17c0 4.4-3.8 8-8.5 8s-8.5-3.6-8.5-8z"/><path d="M7.5 12.5c.5-2.5 1.5-3.5 2-5M11.5 12.5c.3-2.5 1-3.5 1.5-5M15.5 12.5c.3-2 1-3 1.5-4"/><path d="M15 2.5 20 6M17.5 2.5 21 5"/>',
	soup: '<path d="M4 13.5h16a8 8 0 0 1-16 0z"/><path d="M9 9.5c0-1.5 1-1.5 1-3M13 9.5c0-1.5 1-1.5 1-3"/><path d="M6 21h12"/>',
	fries: '<path d="M7 9h10l-1.2 10.5a2 2 0 0 1-2 1.8H10.2a2 2 0 0 1-2-1.8z"/><path d="M8.5 9V5M12 9V3.5M15.5 9V5"/>',
	sandwich: '<path d="M4 15.5 12 5.5l8 10z"/><path d="M4 15.5h16"/><path d="M6.5 19h11"/>',
	drink: '<path d="M7.5 4.5h9l-1.4 15a2 2 0 0 1-2 1.7h-2.2a2 2 0 0 1-2-1.7z"/><path d="M13.5 4.5 16.5 2"/><path d="M9 10h6"/>',
	dessert: '<path d="M6 21h12"/><path d="M7 21v-6a5 5 0 0 1 10 0v6"/><path d="M12 10V7"/><circle cx="12" cy="5.2" r="1.2"/>',
	combo: '<path d="M4 17.5h16"/><path d="M5.5 17.5a6.5 6.5 0 0 1 13 0"/><path d="M12 11V9"/><circle cx="12" cy="7.2" r="1.1"/>',
	plate: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>',
};
function fpos_icon(name, cls) {
	return `<svg class="fpos-ic ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${FPOS_ICONS[name] || ""}</svg>`;
}

frappe.pages["food-pos"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Food POS"),
		single_column: true,
		hide_sidebar: true,
	});

	wrapper.food_pos = new foodpos.FoodPOS.Controller(wrapper);
	window.cur_food_pos = wrapper.food_pos;
};

frappe.pages["food-pos"].refresh = function (wrapper) {
	if (wrapper.food_pos) {
		wrapper.food_pos.refresh();
	}
};

// Compatibility hook if accessed via route /foodpos
if (frappe.pages["foodpos"]) {
	frappe.pages["foodpos"].on_page_load = frappe.pages["food-pos"].on_page_load;
	frappe.pages["foodpos"].refresh = frappe.pages["food-pos"].refresh;
}

foodpos.FoodPOS.Controller = class {
	constructor(wrapper) {
		this.page_wrapper = $(wrapper);
		this.wrapper = this.page_wrapper.find(".page-content").length
			? this.page_wrapper.find(".page-content")
			: this.page_wrapper.find(".layout-main-section");
		if (!this.wrapper.length) this.wrapper = this.page_wrapper;
		this.pos_profile = null;
		this.profile_data = null;
		this.branch = FPOS_SINGLE_BRANCH; // v2: fixed, never switched.
		this.pos_opening = null;
		this.pos_opening_time = null;
		this.pos_opening_entry = null;

		// App state
		this.items = [];
		this.categories = [];
		this.current_category = "All";
		this.fast_food_category = "All";
		this.diet_filter = "all"; // all | veg | non-veg | spicy
		this.sort_by = "default"; // default | price-asc | price-desc | name-asc
		this.current_view = "home"; // v2: "home" | "pos" | "tables" | "attendance" | "report" | "closing" | "payment"
		this.day_open = false;
		this.day_start_time = "";
		this.day_end_time = "";
		this.home_timer_interval = null;
		this.table_timer_interval = null;
		this.attendance_rows = [];
		this.daily_report = null;
		this._confirming_order = false;
		this.search_term = "";
		this.tables = [];

		// Cart state
		this.order_type = "Dine In"; // v2: "Walk In" | "Dine In" | "Takeaway" | "Delivery"
		this.selected_table = null;
		this.selected_table_no = "";
		this.customer = "";
		this.delivery_phone = "";
		this.delivery_address = "";
		this.delivery_charges = 0;
		this.cart_items = []; // [{ item_code, item_name, qty, rate, amount, item_note, uom, item_image }]
		this.discount_percentage = 0;
		this.discount_amount = 0;
		this.order_note = "";

		// Multi-Order Tab System State
		this.tabs = {};
		this.active_tab_id = null;
		this._draft_save_timer = null;

		// Enhanced Restaurant Features State
		this.recent_orders = [];
		this.active_kots = [];
		this.held_orders = [];
		this.kitchen_station_filter = "All";
		this.payment_tendered = 0;
		this.selected_payment_mode = "Cash";
		this.auto_print_slip = false;
		this.kitchen_poll_interval = null;

		// Offline & Sync
		this.is_online = navigator.onLine;
		this.offline_queue_key = "fpos_offline_invoices";

		this.init();
	}

	style_dialog(d) {
		if (d && d.wrapper) {
			$(d.wrapper).addClass("fpos-custom-dialog");
		}
		return d;
	}

	async init() {
		this.bind_global_events();
		await this.check_pos_profile();
	}

	bind_global_events() {
		window.addEventListener("online", () => {
			this.is_online = true;
			this.update_connection_indicator();
			this.sync_offline_invoices();
		});

		window.addEventListener("offline", () => {
			this.is_online = false;
			this.update_connection_indicator();
			frappe.show_alert({ message: __("Working Offline. Orders will be queued locally."), indicator: "orange" });
		});

		window.addEventListener("beforeunload", (e) => {
			const has_items = (this.cart_items && this.cart_items.length > 0) ||
				(this.tabs && Object.values(this.tabs).some(t => t.cart_items && t.cart_items.length > 0));
			if (has_items) {
				e.preventDefault();
				e.returnValue = __("Active cart items will be lost on reload.");
				return e.returnValue;
			}
		});
	}

	format_time_hh_mm(val) {
		if (!val) return "";
		const str = String(val).split(".")[0].trim();
		const parts = str.split(":");
		if (parts.length >= 2) {
			const hh = parts[0].padStart(2, "0");
			const mm = parts[1].padStart(2, "0");
			return `${hh}:${mm}`;
		}
		return str;
	}

	format_money(val) {
		const amt = flt(val);
		return `Rs ${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}

	format_table_label(raw_tbl) {
		if (!raw_tbl) return "";
		let str = String(raw_tbl).trim();
		if (!str) return "";
		if (str.includes("-")) {
			const parts = str.split("-");
			const suffix = parts[parts.length - 1].trim();
			if (suffix) str = suffix;
		}
		str = str.replace(/^Table\s+/i, "").replace(/^T-/i, "").trim();
		return str ? `Table ${str}` : "";
	}

	// ─── 1. POS Profile & Session Initialization ──────────────────────────────

	async check_pos_profile() {
		this.wrapper.html(`
			<div class="fpos-loading-screen" style="display:flex;align-items:center;justify-content:center;height:70vh;flex-direction:column;gap:12px;">
				<div class="fpos-spinner" style="width:36px;height:36px;border:3px solid #eadfd2;border-top-color:#ea580c;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#78716c;font-size:14px;">${__("Loading Food POS environment...")}</span>
			</div>
		`);

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_pos_profiles",
			});
			const profiles = (res.message || []).filter((p) => !p.disabled);
			this.available_profiles = profiles;

			if (profiles.length === 0) {
				this.wrapper.html(`
					<div class="fpos-empty-profile" style="max-width:480px;margin:80px auto;text-align:center;background:#fff;padding:40px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.08);">
						<div style="margin-bottom:12px;color:#f59e0b;">${fpos_icon("alert", "fpos-ic-lg")}</div>
						<h3>${__("No POS Profile Found")}</h3>
						<p style="color:#78716c;margin:12px 0 20px;">${__("Please create or assign a POS Profile for your user in ERPNext to begin sales operations.")}</p>
						<button class="btn btn-primary" onclick="frappe.set_route('List', 'POS Profile')">${__("Open POS Profiles")}</button>
					</div>
				`);
				return;
			}

			// 1. Honor URL parameter ?pos_profile= if provided
			const url_params = new URLSearchParams(window.location.search);
			const url_profile_param = url_params.get("pos_profile") || (frappe.route_options && frappe.route_options.pos_profile);
			const matched_url = url_profile_param && profiles.find((p) => p.name === url_profile_param);
			if (matched_url) {
				await this.select_pos_profile(matched_url.name);
				return;
			}

			// 2. Validate session register: if an open shift is already active in THIS browser session, return to it
			const session_profile = sessionStorage.getItem("fpos_active_profile");
			const matched_session = session_profile && profiles.find((p) => p.name === session_profile);
			if (matched_session) {
				const shift_check = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.check_opening_entry",
					args: { pos_profile: matched_session.name },
				});
				const open_shifts = shift_check.message || [];
				if (open_shifts.length > 0) {
					await this.select_pos_profile(matched_session.name);
					return;
				} else {
					sessionStorage.removeItem("fpos_active_profile");
				}
			}

			// 3. For single-profile cashiers with an already open shift, enter directly
			if (profiles.length === 1) {
				const shift_check = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.check_opening_entry",
					args: { pos_profile: profiles[0].name },
				});
				if ((shift_check.message || []).length > 0) {
					await this.select_pos_profile(profiles[0].name);
					return;
				}
			}

			// 4. v2 single branch: no branch/register selector dialog any
			// more. Auto-select the (single) profile — prefer one with an
			// open shift — and land on the Home / Day screen.
			const auto_profile = profiles.find((p) => p.has_open_shift) || profiles[0];
			await this.select_pos_profile(auto_profile.name);
		} catch (err) {
			console.error(err);
			frappe.show_alert({ message: __("Failed to initialize POS profile"), indicator: "red" });
		}
	}

	// v2: render_profile_selection_dialog was deleted — single branch,
	// the profile is auto-selected in check_pos_profile().
	async select_pos_profile(profile_name) {
		if (!profile_name) return;

		this._force_unfreeze();
		frappe.dom.freeze(__("Switching to {0}...", [profile_name]));

		const safety_timer = setTimeout(() => {
			this._force_unfreeze();
		}, 3500);

		try {
			this.pos_profile = profile_name;
			localStorage.setItem("fpos_last_profile", profile_name);

			// Clean cart and selection state on branch switch
			this.cart_items = [];
			this.customer = "";
			this.order_type = "Takeaway";
			this.selected_table = null;
			this.selected_table_no = "";
			this.linked_kot_id = null;
			this.delivery_phone = "";
			this.delivery_address = "";
			this.delivery_charges = 0;
			this.discount_percentage = 0;
			this.discount_amount = 0;

			// Fetch profile settings
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_pos_profile_data",
				args: { pos_profile: this.pos_profile },
				freeze: false,
			});
			this.profile_data = res.message || {};
			this.customer = this.profile_data.customer || "";
			this.branch = FPOS_SINGLE_BRANCH; // v2: fixed.

			// Cache profile config locally
			localStorage.setItem(`fpos_profile_${this.pos_profile}`, JSON.stringify(this.profile_data));

			// Unfreeze freeze overlay BEFORE shift check so opening shift dialog can display cleanly
			clearTimeout(safety_timer);
			this._force_unfreeze();

			// Standard v16 POS Shift Check / Creation Workflow.
			// v2: a closed day still renders the app — Home shows Day Closed
			// and the Open Day button starts the shift from there.
			const shift_active = await this.init_pos_shift();
			if (!shift_active) {
				this.render_layout();
				await this.load_data();
				await this.init_tabs();
				this.show_home();
				return;
			}

			// Store active session profile ONLY when shift is actually open
			sessionStorage.setItem("fpos_active_profile", profile_name);

			// Synchronously restore cart draft from localStorage BEFORE first paint so cart and table are instantly visible
			const restored_early = this.restore_cart_backup();

			this.render_layout();

			if (restored_early) {
				this.update_order_type_ui();
				this.render_cart_items();
				this.update_cart_summary();
				this.render_tab_bar();
			}

			await this.load_data();
			this.show_home(); // v2: Home / Day screen is the first screen.
			await this.init_tabs();
			this.setup_realtime_table_listener();
			this.sync_offline_invoices();
			this.start_kitchen_polling();
			this.load_recent_orders();

			// Auto-reconcile existing unpaid POS invoices in background
			frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.settle_unpaid_pos_invoices",
				args: { pos_profile: this.pos_profile },
				freeze: false,
			});
		} catch (err) {
			console.error("Error loading POS profile:", err);
			// Offline fallback
			const cached = localStorage.getItem(`fpos_profile_${this.pos_profile}`);
			if (cached) {
				this.profile_data = JSON.parse(cached);
				this.customer = this.profile_data.customer || "";
				this.branch = FPOS_SINGLE_BRANCH;
				this.render_layout();
				this.load_data_offline();
			} else {
				frappe.show_alert({ message: __("Network error loading profile"), indicator: "red" });
			}
		} finally {
			clearTimeout(safety_timer);
			this._force_unfreeze();
		}
	}

	_force_unfreeze() {
		try {
			frappe.dom.unfreeze();
		} catch (e) {}
		frappe.dom.freeze_count = 0;
		$("#freeze").removeClass("in").remove();
		$(".freeze-message-container").remove();
	}

	async init_pos_shift() {
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.check_opening_entry",
				args: { user: frappe.session.user, pos_profile: this.pos_profile },
			});
			const open_entries = res.message || [];
			if (open_entries.length > 0) {
				const entry = open_entries[0];
				this.pos_opening = entry.name;
				this.pos_opening_time = entry.period_start_date;
				this.pos_opening_entry = entry;

				// Check if shift is outdated (e.g. opened on previous day)
				this.check_outdated_pos_opening_entry();
				this.setup_listener_for_pos_closing();
				return true;
			} else {
				// v2: no active shift — do NOT pop the opening dialog here.
				// The Home screen shows "Day Closed" with an Open Day button.
				return false;
			}
		} catch (err) {
			console.warn("Could not check POS Opening Entry, continuing in standalone mode:", err);
			return true;
		}
	}

	show_opening_shift_dialog() {
		const me = this;
		const company = (this.profile_data && this.profile_data.company) || frappe.defaults.get_default("company");
		const payments = (this.profile_data && this.profile_data.payments) || [];
		const modes = payments.length ? payments.map((p) => p.mode_of_payment) : ["Cash"];
		const today = frappe.datetime.get_today();

		// v6.1: a plain, guided Day Open card — no ERPNext jargon. A new
		// cashier understands it in seconds: count the cash, type it, tap
		// Open Day. Same API + same success path as the old dialog.
		this.wrapper.html(`
			<div class="fpos-shift-pending" style="display:flex;align-items:center;justify-content:center;min-height:65vh;flex-direction:column;gap:14px;color:#57534e;padding:20px;">
				<div style="color:#a8a29e;">${fpos_icon("receipt", "fpos-ic-lg")}</div>
				<div style="font-size:18px;font-weight:800;color:#292524;">${__("The day hasn't started yet")}</div>
				<p style="font-size:13px;color:#78716c;max-width:380px;text-align:center;margin:0;">${__("Count the cash in the drawer, then open the day to start taking orders.")}</p>
				<button class="btn btn-primary btn-sm fpos-reopen-shift-dialog-btn" style="margin-top:6px;font-weight:700;">${fpos_icon("refresh", "fpos-ic-sm")} ${__("Open the Day")}</button>
			</div>
			<div class="fpos-day-open-overlay">
				<div class="fpos-day-open-card">
					<div style="text-align:center;">
						<div style="width:56px;height:56px;border-radius:50%;background:#ffedd5;color:#ea580c;display:flex;align-items:center;justify-content:center;font-size:26px;margin:0 auto 10px;">${fpos_icon("cash", "fpos-ic-lg")}</div>
						<div style="font-size:22px;font-weight:900;color:#292524;">${__("Open the Day")}</div>
						<div style="font-size:13px;color:#78716c;margin-top:4px;">${__("Count the cash in the drawer, then start taking orders.")}</div>
						<div style="font-size:12px;color:#a8a29e;margin-top:6px;">${company || ""} &bull; ${this.pos_profile || ""} &bull; ${today}</div>
					</div>
					<div class="fpos-day-open-steps">
						<div class="fpos-day-open-step"><b>1</b>${__("Count the cash")}</div>
						<div class="fpos-day-open-step"><b>2</b>${__("Type it below")}</div>
						<div class="fpos-day-open-step"><b>3</b>${__("Tap Open Day")}</div>
					</div>
					${modes.map((m, i) => `
						<div class="fpos-day-open-cash-row">
							<label>${m === "Cash" ? __("Cash in the drawer") : m}</label>
							<span style="font-size:18px;font-weight:800;color:#78716c;">Rs</span>
							<input type="number" min="0" step="any" class="fpos-day-open-cash-input" data-mode="${m}" value="0" ${i === 0 ? "autofocus" : ""}>
						</div>`).join("")}
					<div style="font-size:12px;color:#78716c;text-align:center;margin:4px 0 16px;">${__("This is the money you start the day with. It is counted again when the day closes.")}</div>
					<button class="btn btn-primary fpos-day-open-submit" style="width:100%;font-size:17px;font-weight:800;background:#ea580c;border-color:#ea580c;border-radius:12px;padding:14px;min-height:56px;">${__("Open Day")}</button>
					<button class="btn btn-default fpos-day-open-cancel" style="width:100%;margin-top:10px;font-weight:700;border-radius:12px;padding:12px;min-height:48px;">${__("Not now")}</button>
				</div>
			</div>
		`);

		const close_modal = () => { $(document).off("keydown.fpos_day_open"); me.wrapper.find(".fpos-day-open-overlay").remove(); me.show_home(); };
		this.wrapper.find(".fpos-reopen-shift-dialog-btn").on("click", () => this.show_opening_shift_dialog());
		this.wrapper.find(".fpos-day-open-cancel").on("click", close_modal);
		this.wrapper.find(".fpos-day-open-overlay").on("click", (e) => { if (e.target === e.currentTarget) close_modal(); });
		$(document).off("keydown.fpos_day_open").on("keydown.fpos_day_open", (e) => {
			if (e.key === "Escape") close_modal();
			if (e.key === "Enter" && !$(e.target).is("textarea")) { e.preventDefault(); this.wrapper.find(".fpos-day-open-submit").click(); }
		});
		// Cash inputs: select-all on focus so typing replaces the 0.
		this.wrapper.find(".fpos-day-open-cash-input").on("focus", (e) => e.target.select());

		this.wrapper.find(".fpos-day-open-submit").on("click", async () => {
			const balance_details = modes.map((m) => {
				const v = flt(this.wrapper.find(`.fpos-day-open-cash-input[data-mode="${m}"]`).val());
				return { mode_of_payment: m, opening_amount: Math.max(0, v || 0) };
			}).filter((d) => d.mode_of_payment);
			if (!balance_details.length) {
				frappe.show_alert({ message: __("Please enter the opening cash."), indicator: "red" });
				return;
			}
			const $btn = this.wrapper.find(".fpos-day-open-submit");
			$btn.prop("disabled", true).text(__("Opening the day..."));
			$(document).off("keydown.fpos_day_open");
			frappe.dom.freeze(__("Opening the day..."));
			try {
				const res = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.create_opening_voucher",
					args: { pos_profile: me.pos_profile, company, balance_details: JSON.stringify(balance_details) },
				});
				frappe.dom.unfreeze();
				if (res && res.message) {
					me.pos_opening = res.message.name;
					me.pos_opening_time = res.message.period_start_date;
					me.pos_opening_entry = res.message;
					sessionStorage.setItem("fpos_active_profile", me.pos_profile);
					frappe.show_alert({ message: __("Day opened — have a great shift!"), indicator: "green" });
					me.setup_listener_for_pos_closing();
					me.day_open = true;
					const restored_early = me.restore_cart_backup();
					me.render_layout();
					if (restored_early) {
						me.update_order_type_ui();
						me.render_cart_items();
						me.update_cart_summary();
						me.render_tab_bar();
					}
					await me.load_data();
					await me.init_tabs();
					me.setup_realtime_table_listener();
					me.sync_offline_invoices();
					me.start_kitchen_polling();
					me.show_home();
				}
			} catch (e) {
				frappe.dom.unfreeze();
				$btn.prop("disabled", false).text(__("Open Day"));
				frappe.msgprint({
					title: __("Could not open the day"),
					indicator: "red",
					message: e.message || __("Something went wrong. Please try again."),
				});
			}
		});
	}

	check_outdated_pos_opening_entry() {
		if (this.pos_opening_time && frappe.datetime.get_day_diff(frappe.datetime.get_today(), this.pos_opening_time.slice(0, 10)) > 0) {
			console.warn(`Shift ${this.pos_opening} is from ${this.pos_opening_time}. Outdated shift.`);
		}
	}

	setup_listener_for_pos_closing() {
		if (!this.pos_opening || !frappe.realtime) return;
		frappe.realtime.on(`poe_${this.pos_opening}`, (data) => {
			if (data && data.operation === "Closed") {
				frappe.msgprint({
					title: __("POS Closed"),
					indicator: "orange",
					message: __("Shift {0} has been closed by another session. Please refresh.", [this.pos_opening]),
					primary_action_label: __("Refresh"),
					primary_action: {
						action() {
							window.location.reload();
						},
					},
				});
			}
		});
	}

	// ─── 2. Data Fetching & Local Caching ─────────────────────────────────────

	classify_fast_food_item(item) {
		const name = (item.item_name || "").toLowerCase();
		const group = (item.item_group || "").toLowerCase();
		const desc = (item.description || "").toLowerCase();
		const text = `${name} ${group} ${desc}`;

		let category = "Other Fast Food";
		// v5: `icon` is an FPOS_ICONS key (SVG food icon), never an emoji.
		let icon = "plate";
		let badge_color = "#57534e";
		let badge_bg = "#f5efe4";

		if (/burger|cheeseburger|whopper|patty|zinger|beef burger|chicken burger|smashburger|slider|bun/.test(text)) {
			category = "Burgers";
			icon = "burger";
			badge_color = "#166534";
			badge_bg = "#dcfce7";
		} else if (/pizza|slice|calzone|pepperoni|margherita|crust|mozzarella pizza/.test(text)) {
			category = "Pizzas";
			icon = "pizza";
			badge_color = "#b91c1c";
			badge_bg = "#fee2e2";
		} else if (/sandwich|wrap|roll|sub|panini|club sandwich|shawarma|taco|burrito|quesadilla|gyro|frankie/.test(text)) {
			category = "Sandwiches & Wraps";
			icon = "sandwich";
			badge_color = "#047857";
			badge_bg = "#d1fae5";
		} else if (/fries|french fry|wedges|onion ring|nugget|tenders|wings|popcorn chicken|garlic bread|dip|sauce|strips|side|appetizer/.test(text)) {
			category = "Sides & Fries";
			icon = "fries";
			badge_color = "#b45309";
			badge_bg = "#fef3c7";
		} else if (/drink|beverage|shake|smoothie|soda|cola|pepsi|coke|sprite|fanta|coffee|tea|latte|juice|water|mojito|lemonade|espresso|cappuccino/.test(text)) {
			category = "Drinks & Shakes";
			icon = "drink";
			badge_color = "#0369a1";
			badge_bg = "#e0f2fe";
		} else if (/combo|deal|meal|box|family pack|feast|platter|bucket|duo|trio/.test(text)) {
			category = "Combos & Deals";
			icon = "combo";
			badge_color = "#7c3aed";
			badge_bg = "#ede9fe";
		} else if (/dessert|cake|pie|ice cream|brownie|cookie|sundae|donut|pastry|churro|waffle|pancake|muffin/.test(text)) {
			category = "Desserts";
			icon = "dessert";
			badge_color = "#be185d";
			badge_bg = "#fce7f3";
		} else if (item.item_group && item.item_group !== "All Item Groups" && item.item_group !== "Products") {
			category = item.item_group;
			icon = "plate";
			badge_color = "#57534e";
			badge_bg = "#f5efe4";
		}

		const is_veg = Boolean(item.is_vegetarian || /veg|vegetarian|paneer|falafel|vegan|plant-based|tofu/.test(name));
		const is_spicy = /spicy|peri peri|peri-peri|hot|fire|jalape|chilli|chili|buffalo|schezwan|wasabi/.test(text);

		return {
			category,
			icon,
			badge_color,
			badge_bg,
			is_veg,
			is_spicy,
		};
	}

	async load_data() {
		if (!this.pos_profile) return;

		try {
			// v2: no branch — tables are fetched for the single branch.
			const [items_res, tables_res] = await Promise.all([
				frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_items",
					args: { pos_profile: this.pos_profile, page_length: 200 },
				}),
				frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_available_tables",
					args: { pos_profile: this.pos_profile },
				}),
			]);

			this.items = items_res.message || [];
			this.tables = tables_res.message || [];

			// Fast food classification
			this.items.forEach((item) => {
				const info = this.classify_fast_food_item(item);
				item._ff_category = info.category;
				item._ff_icon = info.icon;
				item._ff_badge_color = info.badge_color;
				item._ff_badge_bg = info.badge_bg;
				item._is_veg = info.is_veg;
				item._is_spicy = info.is_spicy;
			});

			// Derive categories dynamically from fast food classification
			const unique_cats = Array.from(new Set(this.items.map((i) => i._ff_category).filter(Boolean)));
			const priority_order = ["Burgers", "Pizzas", "Sandwiches & Wraps", "Sides & Fries", "Drinks & Shakes", "Combos & Deals", "Desserts"];
			unique_cats.sort((a, b) => {
				const ia = priority_order.indexOf(a);
				const ib = priority_order.indexOf(b);
				if (ia !== -1 && ib !== -1) return ia - ib;
				if (ia !== -1) return -1;
				if (ib !== -1) return 1;
				return a.localeCompare(b);
			});
			this.categories = ["All", ...unique_cats];

			// Cache locally for offline resilience
			localStorage.setItem(`fpos_items_${this.pos_profile}`, JSON.stringify(this.items));
			localStorage.setItem(`fpos_tables_${this.pos_profile}`, JSON.stringify(this.tables));

			this.render_categories();
			this.render_items_grid();
			this.update_cart_summary();
			this.load_recent_orders();
		} catch (e) {
			this.load_data_offline();
		}
	}

	load_data_offline() {
		const cached_items = localStorage.getItem(`fpos_items_${this.pos_profile}`);
		const cached_tables = localStorage.getItem(`fpos_tables_${this.pos_profile}`);

		if (cached_items) {
			this.items = JSON.parse(cached_items);
			this.items.forEach((item) => {
				const info = this.classify_fast_food_item(item);
				item._ff_category = info.category;
				item._ff_icon = info.icon;
				item._ff_badge_color = info.badge_color;
				item._ff_badge_bg = info.badge_bg;
				item._is_veg = info.is_veg;
				item._is_spicy = info.is_spicy;
			});
			const unique_cats = Array.from(new Set(this.items.map((i) => i._ff_category).filter(Boolean)));
			const priority_order = ["Burgers", "Pizzas", "Sandwiches & Wraps", "Sides & Fries", "Drinks & Shakes", "Combos & Deals", "Desserts"];
			unique_cats.sort((a, b) => {
				const ia = priority_order.indexOf(a);
				const ib = priority_order.indexOf(b);
				if (ia !== -1 && ib !== -1) return ia - ib;
				if (ia !== -1) return -1;
				if (ib !== -1) return 1;
				return a.localeCompare(b);
			});
			this.categories = ["All", ...unique_cats];
			this.render_categories();
			this.render_items_grid();
		}
		if (cached_tables) {
			this.tables = JSON.parse(cached_tables);
		}
	}

	// ─── 3. HTML Layout Generation ───────────────────────────────────────────

	render_layout() {

		this.wrapper.html(`
			<div class="fpos-wrapper">
				<!-- Zone 1: Slim Header Bar (Max 6 Elements) -->
								<header class="fpos-topbar">
					<!-- v4 CHILI: hamburger + brand left, ONE wide search centre, icon actions right.
					     No branch chip, no order-type tabs here (type lives in the right order panel). -->
					<div class="fpos-header-left">
						<button class="fpos-topbar-menu-btn" title="${__("Toggle sidebar")}">${fpos_icon("menu")}</button>
						<div class="fpos-brand">
							<span class="fpos-brand-icon">${fpos_icon("chef")}</span>
							<span class="fpos-brand-name">Food POS</span>
						</div>
					</div>

					<div class="fpos-header-center">
						<div class="fpos-topbar-search">
							<span class="fpos-search-icon">${fpos_icon("search", "fpos-ic-sm")}</span>
							<input class="fpos-search-input form-control" type="text" placeholder="${__("Search food, code or barcode...  ( / )")}" />
						<!-- v5.3: Filters live in the TOP BAR, same single row as the
						     search bar (user asked: "search bar ka samna 1 hi row ma").
						     v5.1 had wrongly moved it below the search bar — undone. -->
						<div class="fpos-filters-dropdown-wrapper">
							<button class="fpos-filters-dropdown-btn" title="${__("Categories, dietary filters & sort")}">
								${fpos_icon("filter", "fpos-ic-sm")}<span>${__("Filters")}</span>
								<span class="fpos-filter-active-badge" style="display:none;"></span>
								<span class="fpos-caret">▾</span>
							</button>
							<div class="fpos-filters-popover" style="display:none;">
								<div class="fpos-popover-header">
									<span class="fpos-popover-title">${__("Filters")}</span>
									<div class="fpos-popover-header-actions">
										<button class="fpos-reset-filters-btn fpos-link-btn" title="${__("Reset all filters")}">
											${__("Reset all")}
										</button>
										<button class="fpos-close-popover-btn fpos-icon-close-btn" title="${__("Close")}">✕</button>
									</div>
								</div>

								<div class="fpos-popover-section" style="margin-top:14px;">
									<div class="fpos-filter-section-title">${__("Dietary Preference")}</div>
									<div class="fpos-diet-toggles">
										<button class="fpos-subfilter-pill ${this.diet_filter === "all" ? "active" : ""}" data-diet="all">
											<span>${__("All")}</span>
										</button>
										<button class="fpos-subfilter-pill ${this.diet_filter === "veg" ? "active" : ""}" data-diet="veg">
											<span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#16a34a;margin-right:5px;"></i>${__("Veg")}</span>
										</button>
										<button class="fpos-subfilter-pill ${this.diet_filter === "non-veg" ? "active" : ""}" data-diet="non-veg">
											<span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#dc2626;margin-right:5px;"></i>${__("Non-Veg")}</span>
										</button>
										<button class="fpos-subfilter-pill ${this.diet_filter === "spicy" ? "active" : ""}" data-diet="spicy">
											<span><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#d97706;margin-right:5px;"></i>${__("Spicy")}</span>
										</button>
									</div>
								</div>

								<div class="fpos-popover-section" style="margin-top:14px;">
									<div class="fpos-filter-section-title">${__("Sort By")}</div>
									<div class="fpos-sort-box">
										<select class="fpos-sort-select form-control">
											<option value="default" ${this.sort_by === "default" ? "selected" : ""}>${__("Featured (Default)")}</option>
											<option value="price-asc" ${this.sort_by === "price-asc" ? "selected" : ""}>${__("Price: Low to High")}</option>
											<option value="price-desc" ${this.sort_by === "price-desc" ? "selected" : ""}>${__("Price: High to Low")}</option>
											<option value="name-asc" ${this.sort_by === "name-asc" ? "selected" : ""}>${__("Name: A-Z")}</option>
										</select>
									</div>
								</div>
							</div>
						</div>
						</div>
					</div>

					<div class="fpos-header-right">
						<button class="fpos-topbar-order-chip" title="${__("Current order — change table / customer")}">
							${fpos_icon("table", "fpos-ic-sm")} <span class="fpos-topbar-order-label">${this.selected_table_no ? __("Table") + " " + this.selected_table_no : (this.customer || __("Walk-in"))}</span> ${fpos_icon("edit", "fpos-ic-sm")}
						</button>
						<button class="fpos-topbar-icon-btn fpos-home-btn" title="${__("Home — Day Open / Close")}">
							${fpos_icon("home")}
						</button>
						<button class="fpos-topbar-icon-btn fpos-held-orders-btn" title="${__("Held Orders")}">
							${fpos_icon("pause")}
							<span class="fpos-held-badge" style="display:none;">0</span>
						</button>
						<div class="fpos-status-dot" title="${__("Online — Connected")}">
							<span class="fpos-dot"></span>
						</div>
						<div class="fpos-more-dropdown-wrapper">
							<button class="fpos-more-btn fpos-topbar-icon-btn" id="fpos-more-menu-btn" title="${__("More Actions")}">
								<span>⋮</span>
							</button>
				</header>

				<!-- v4 CHILI: no top order strip — open orders live in the bottom table-chips bar. -->
				<!-- v2: Home / Tables / Attendance / Daily Report views. Only one
				     view is visible at a time; show_home/show_pos/... toggle them. -->
				<div class="fpos-home-view"></div>
				<div class="fpos-tables-view" style="display:none;"></div>
				<div class="fpos-attendance-view" style="display:none;"></div>
				<div class="fpos-daily-report-view" style="display:none;"></div>

				<!-- Main Layout: Left Menu Area (Zone 3) + Right Cart (Zone 4) -->
				<div class="fpos-body">
					<!-- v3: left icon sidebar (image 4 concept) — every item goes somewhere real -->
					<nav class="fpos-pos-sidebar" aria-label="${__("POS sections")}">
						<button class="fpos-pos-nav-item active" data-nav="menu" title="${__("Menu")}">${fpos_icon("grid")}<span class="fpos-pos-nav-label">${__("Menu")}</span></button>
						<button class="fpos-pos-nav-item" data-nav="tables" title="${__("Table Services")}">${fpos_icon("table")}<span class="fpos-pos-nav-label">${__("Tables")}</span></button>
						<button class="fpos-pos-nav-item" data-nav="pending" title="${__("Pending Payments")}">${fpos_icon("receipt")}<span class="fpos-pos-nav-label">${__("Pending")}</span><span class="fpos-pending-badge" style="display:none;">0</span></button>
						<button class="fpos-pos-nav-item" data-nav="reservation" title="${__("Reservation")}">${fpos_icon("calendar")}<span class="fpos-pos-nav-label">${__("Reserve")}</span></button>
						<button class="fpos-pos-nav-item" data-nav="delivery" title="${__("Delivery")}">${fpos_icon("truck")}<span class="fpos-pos-nav-label">${__("Delivery")}</span></button>
						<button class="fpos-pos-nav-item" data-nav="accounting" title="${__("Accounting")}">${fpos_icon("chart")}<span class="fpos-pos-nav-label">${__("Accounts")}</span></button>
						<button class="fpos-pos-nav-item" data-nav="settings" title="${__("Settings")}">${fpos_icon("settings")}<span class="fpos-pos-nav-label">${__("Settings")}</span></button>
						<span class="fpos-pos-nav-spacer"></span>
						<button class="fpos-pos-nav-item fpos-pos-logout" data-nav="logout" title="${__("Logout")}">${fpos_icon("logout")}<span class="fpos-pos-nav-label">${__("Logout")}</span></button>
					</nav>
					<!-- Zone 3: Menu Area (Filter Bar + Items Grid) -->
					<div class="fpos-left-panel">
						<div class="fpos-menu-main">
						<!-- v4 CHILI: ONE category row — tiles only. No sidebar,
						     no second search. Filters live in the top bar, same row as search. -->
						<div class="fpos-cat-row">
							<div class="fpos-cat-tiles fpos-categories"></div>
						</div>

						<div class="fpos-items-grid-wrapper">
							<div class="fpos-items-grid"></div>
						</div>
						</div><!-- /fpos-menu-main -->
					</div>

					<!-- Zone 4: Fixed Sticky Cart Panel -->
					<div class="fpos-right-panel">
												<!-- v4 CHILI right panel header: order title + order-type tabs. -->
						<div class="fpos-cart-header-strip">
							<div class="fpos-order-head">
								<div class="fpos-order-title-row">
									<div class="fpos-order-titles">
										<div class="fpos-order-title"><span class="fpos-table-label">${this.selected_table_no ? __("Table") + " " + this.selected_table_no : ""}</span><span class="fpos-customer-label">${this.customer || __("Walk-in Customer")}</span></div>
										<div class="fpos-order-sub"></div>
									</div>
									<button class="fpos-order-edit-btn" title="${__("Change table / customer")}">${fpos_icon("edit", "fpos-ic-sm")}</button>
									<!-- Overflow ⋮ menu: Discount & Clear (Confirm lives in the sticky actions below) -->
									<div class="fpos-cart-overflow-wrapper">
										<button class="fpos-cart-overflow-btn" title="${__("More cart actions")}">⋮</button>
										<div class="fpos-cart-overflow-menu" style="display:none;">
											<button class="fpos-cart-overflow-item fpos-discount-btn">${fpos_icon("tag", "fpos-ic-sm")} ${__("Discount & Presets")}</button>
											<button class="fpos-cart-overflow-item fpos-danger-text fpos-clear-btn">${fpos_icon("trash", "fpos-ic-sm")} ${__("Clear Order")}</button>
										</div>
									</div>
								</div>
								<div class="fpos-order-type-tabs">
									<button class="fpos-ot-tab ${this.order_type === "Walk In" ? "active" : ""}" data-type="Walk In">${__("Walk In")}</button>
									<button class="fpos-ot-tab ${this.order_type === "Dine In" ? "active" : ""}" data-type="Dine In">${__("Dine In")}</button>
									<button class="fpos-ot-tab ${this.order_type === "Takeaway" ? "active" : ""}" data-type="Takeaway">${__("Takeaway")}</button>
									<button class="fpos-ot-tab ${this.order_type === "Delivery" ? "active" : ""}" data-type="Delivery">${__("Delivery")}</button>
								</div>
								<div class="fpos-meta-field fpos-delivery-field" style="display:${this.order_type === "Delivery" ? "flex" : "none"};">
									<span>${fpos_icon("truck", "fpos-ic-sm")}</span>
									<span class="fpos-delivery-label">${this.delivery_phone ? `${this.delivery_phone}` : __("Delivery Details *")}</span>
								</div>
							</div>
						</div>

						<!-- Cart Items list -->
						<div class="fpos-cart-items-wrapper">
							<div class="fpos-cart-items"></div>
							<div class="fpos-cart-empty">
								<div style="margin-bottom:8px;color:#a8a29e;">${fpos_icon("cart")}</div>
								<p style="font-weight:600;font-size:14px;color:#78716c;margin:0 0 4px;">${__("Current order is empty")}</p>
								<small style="color:#a8a29e;">${__("Tap items on the left to add them")}</small>
							</div>
						</div>

						<!-- Pricing Summary -->
						<div class="fpos-cart-totals">
							<div class="fpos-total-row" style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px;color:#57534e;">
								<span>${__("Subtotal")}</span>
								<span class="fpos-subtotal-val">Rs 0.00</span>
							</div>
							<div class="fpos-discount-row" style="display:none;justify-content:space-between;margin-bottom:5px;font-size:13px;color:#dc2626;">
								<span>${__("Discount")}</span>
								<span class="fpos-discount-val fpos-discount-badge">-Rs 0.00</span>
							</div>
							<div class="fpos-delivery-row" style="display:none;justify-content:space-between;margin-bottom:5px;font-size:13px;color:#0284c7;">
								<span>${__("Delivery Fee")}</span>
								<span class="fpos-delivery-val">Rs 0.00</span>
							</div>
							<!-- v5.2: NO TAX row — totals are Subtotal − Discount (Rs) + Delivery Fee only. -->
							<div class="fpos-total-due-row">
								<span>${__("Total Due")}</span>
								<span class="fpos-grand-total-val">Rs 0.00</span>
							</div>
						</div>

						<!-- v3: payment method pick (Cash / Card / QR) — sets the payment page default. -->
						<div class="fpos-pay-methods" role="group" aria-label="${__("Payment method")}">
							<button class="fpos-pay-method active" data-mode="Cash">${fpos_icon("cash")} <span>${__("Cash")}</span></button>
							<button class="fpos-pay-method" data-mode="Card">${fpos_icon("card")} <span>${__("Card")}</span></button>
							<button class="fpos-pay-method" data-mode="QR">${fpos_icon("qr")} <span>${__("QR")}</span></button>
						</div>
						<!-- v3: BILL RULE — the customer bill is printed ONLY at payment (Pay & Print Bill).
						     Confirming sends the KOT to the kitchen and leaves payment Pending; no bill yet. -->
						<div class="fpos-pending-banner" role="status"></div>
						<!-- Sticky Bottom Action Rows: Confirm (Kitchen) + Pay & Print Bill, then Hold -->
						<div class="fpos-sticky-actions">
							<!-- v2: Confirm Order — auto-creates the KOT, reserves the table, payment stays Pending -->
							<button class="fpos-btn fpos-confirm-order-btn" disabled>
								${fpos_icon("check")} <span>${__("Confirm Order — Kitchen")}</span>
							</button>

							<!-- Primary: Pay & Settle (full width, green) -->
							<button class="fpos-btn fpos-pay-btn" disabled>
								${fpos_icon("card")} <span>${__("Pay & Print Bill")}</span>
							</button>

							<!-- Secondary: Hold -->
							<div class="fpos-secondary-actions-row">
								<button class="fpos-action-btn-outline fpos-hold-btn" style="width:100%;">
								${fpos_icon("pause")} <span>${__("Hold")}</span>
							</button>
							</div>
						</div>
					</div>
				</div>

				<!-- v3: occupied-table chips (image 4 concept) — filled by render_table_chips() -->
				<div class="fpos-table-chips-bar" style="display:none;"></div>

				<!-- FULL-PAGE SLIDE-IN PAYMENT & CHECKOUT PAGE (Transitions Left to Right) -->
				<div class="fpos-payment-page"></div>

				<!-- FULL-PAGE REGISTER CLOSING & DAILY SALES DASHBOARD -->
				<div class="fpos-closing-page" style="display:none;"></div>

				<!-- DRAWER OVERLAY -->
				<div class="fpos-drawer-overlay"></div>

				<!-- RECENT ORDERS DRAWER (LAST 10 CUSTOMERS WITH EDIT ABILITY) -->
				<div class="fpos-drawer fpos-recent-drawer">
					<div class="fpos-drawer-header">
						<div class="fpos-drawer-title">
							<span>${fpos_icon("receipt")}</span>
							<span>${__("Recent Customer Orders")}</span>
						</div>
						<button class="fpos-drawer-close fpos-close-recent-drawer">&times;</button>
					</div>
					<div class="fpos-drawer-body fpos-recent-body"></div>
				</div>

				<!-- KITCHEN TRACKING DRAWER (TRACK ACTIVE KOTS & REMAINING ITEMS) -->
				<div class="fpos-drawer fpos-kitchen-drawer">
					<div class="fpos-drawer-header">
						<div class="fpos-drawer-title">
							<span>${fpos_icon("chef")}</span>
							<span>${__("Live Kitchen Orders")}</span>
							<span class="fpos-kitchen-count-pill" style="font-size:11px;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;font-weight:700;">0 active</span>
						</div>
						<button class="fpos-drawer-close fpos-close-kitchen-drawer">&times;</button>
					</div>
					<div class="fpos-kitchen-station-filters" style="padding:10px 16px;background:#faf6f0;border-bottom:1px solid #eadfd2;display:flex;gap:6px;overflow-x:auto;">
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn active" data-station="All" style="font-weight:700;border-radius:6px;">${__("All Stations")}</button>
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn" data-station="Main Kitchen" style="font-weight:700;border-radius:6px;">${__("Main Kitchen")}</button>
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn" data-station="Grill" style="font-weight:700;border-radius:6px;">${__("Grill")}</button>
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn" data-station="Pizza" style="font-weight:700;border-radius:6px;">${__("Pizza")}</button>
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn" data-station="Beverages" style="font-weight:700;border-radius:6px;">${__("Beverages")}</button>
					</div>
					<div class="fpos-drawer-body fpos-kitchen-body"></div>
				</div>

				<!-- PENDING PAYMENTS DRAWER (v5.12: bills waiting to be paid) -->
				<div class="fpos-drawer fpos-pending-drawer">
					<div class="fpos-drawer-header">
						<div class="fpos-drawer-title">
							<span>${fpos_icon("receipt")}</span>
							<span>${__("Pending Payments")}</span>
							<span class="fpos-pending-count-pill" style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:12px;font-weight:700;">0 pending</span>
						</div>
						<button class="fpos-drawer-close fpos-close-pending-drawer">&times;</button>
					</div>
					<div class="fpos-drawer-body fpos-pending-body"></div>
				</div>

				<!-- HELD ORDERS DRAWER -->
				<div class="fpos-drawer fpos-held-drawer">
					<div class="fpos-drawer-header">
						<div class="fpos-drawer-title">
							<span>${fpos_icon("pause")}</span>
							<span>${__("Held Orders")}</span>
							<span class="fpos-held-count-pill" style="font-size:11px;background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:12px;font-weight:700;">0 held</span>
						</div>
						<button class="fpos-drawer-close fpos-close-held-drawer">&times;</button>
					</div>
					<div class="fpos-drawer-body fpos-held-body"></div>
				</div>

				<!-- CUSTOMER POS SLIP MODAL CONTAINER -->
				<div class="fpos-slip-modal-container" style="display:none;"></div>
			</div>
		`);

		this.bind_ui_events();
		this.update_connection_indicator();
		this.update_filter_button_indicator();
		this.update_order_type_ui();
	}

	// ─── 4. Render Components ────────────────────────────────────────────────

	render_categories() {
		const $box = this.wrapper.find(".fpos-categories");
		// v3: SVG icons per category (no emoji in UI chrome).
		// v5: real food icons + a tinted icon circle (see .fpos-cat-tile-icon).
		const cat_icons = {
			All: "grid", Burgers: "burger", Pizzas: "pizza",
			"Sandwiches & Wraps": "sandwich", "Sides & Fries": "fries",
			"Drinks & Shakes": "drink", "Combos & Deals": "combo",
			Desserts: "dessert", Beverages: "drink", Starters: "plate",
			"Main Course": "plate",
		};

		// v4 CHILI: categories live ONLY in the tile row — no sidebar, no popover list.
		const $b = this.wrapper.find(".fpos-cat-tiles");
		$b.empty();
		this.categories.forEach((cat) => {
			const active = (cat === this.fast_food_category) ? "active" : "";
			const icon = cat_icons[cat] || "box";
			const count = (cat === "All")
				? this.items.length
				: this.items.filter((i) => i._ff_category === cat).length;
			$b.append(`
				<button class="fpos-cat-tile ${active}" data-cat="${cat}">
					<span class="fpos-cat-tile-name"><span class="fpos-cat-tile-icon">${fpos_icon(icon, "fpos-ic-sm")}</span> ${__(cat)}</span>
					<span class="fpos-cat-tile-count">${count} ${__("items")}</span>
				</button>
			`);
		});
	}

	// v5: item photo area — real Item image (object-fit: cover, fills the
	// 110px photo area) or, when the item has no image, a rich warm
	// gradient tile with a large SVG food icon for its category.
	// Never a bare letter, never an emoji. Card geometry is unchanged.
	item_media_html(item) {
		const icon = item._ff_icon || "plate";
		if (item.item_image) {
			const safe_name = (item.item_name || "").replace(/"/g, "");
			return `<div class="fpos-item-photo" style="background-image:url('${item.item_image}')" role="img" aria-label="${safe_name}"></div>`;
		}
		return `<div class="fpos-item-photo fpos-item-photo-fallback fpos-food-${icon}">${fpos_icon(icon, "fpos-ic-lg")}</div>`;
	}

	render_items_grid() {
		const $grid = this.wrapper.find(".fpos-items-grid");
		$grid.empty();

		let list = [...this.items];

		// 1. Fast Food Category Filter (Burgers vs Pizzas etc.)
		if (this.fast_food_category !== "All") {
			list = list.filter((i) => (i._ff_category || i.item_group) === this.fast_food_category);
		}

		// 2. Diet Filter (Veg / Non-Veg / Spicy)
		if (this.diet_filter === "veg") {
			list = list.filter((i) => i._is_veg);
		} else if (this.diet_filter === "non-veg") {
			list = list.filter((i) => !i._is_veg);
		} else if (this.diet_filter === "spicy") {
			list = list.filter((i) => i._is_spicy);
		}

		// 3. Search Term Filter — name, code, category AND barcode (v6).
		if (this.search_term) {
			const term = this.search_term.toLowerCase().trim();
			list = list.filter((i) =>
				(i.item_name || "").toLowerCase().includes(term) ||
				(i.item_code || "").toLowerCase().includes(term) ||
				(i.barcode || "").toLowerCase().includes(term) ||
				(i._ff_category || "").toLowerCase().includes(term)
			);
		}
		// v6: keep the last filtered list for Enter-to-add (barcode scan).
		this._last_search_results = list;

		// 4. Sort
		if (this.sort_by === "price-asc") {
			list.sort((a, b) => flt(a.rate) - flt(b.rate));
		} else if (this.sort_by === "price-desc") {
			list.sort((a, b) => flt(b.rate) - flt(a.rate));
		} else if (this.sort_by === "name-asc") {
			list.sort((a, b) => (a.item_name || "").localeCompare(b.item_name || ""));
		}

		if (list.length === 0) {
			$grid.html(`
				<div style="grid-column:1/-1;text-align:center;padding:50px 20px;color:#a8a29e;">
					<div style="margin-bottom:10px;color:#a8a29e;">${fpos_icon("search", "fpos-ic-lg")}</div>
					<h4 style="color:#78716c;font-weight:600;margin-bottom:6px;">${__("No matching food items found")}</h4>
					<p style="font-size:13px;">${__("Try clearing search filters or selecting another product category.")}</p>
					<button class="btn btn-default btn-xs fpos-reset-filters-btn" style="margin-top:10px;">${__("Reset Filters")}</button>
				</div>
			`);
			return;
		}

		list.forEach((item) => {
			const price = this.format_money(item.rate);
			const img = this.item_media_html(item);

			// Diet badges (Veg / Non-Veg / Spicy) + short description (v2 cards)
			let diet_badge = "";
			if (item._is_veg) {
				diet_badge = `<span class="fpos-card-diet-badge fpos-diet-veg">VEG</span>`;
			} else {
				diet_badge = `<span class="fpos-card-diet-badge fpos-diet-nonveg">NON-VEG</span>`;
			}
			if (item._is_spicy) {
				diet_badge += ` <span class="fpos-card-diet-badge fpos-diet-spicy">SPICY</span>`;
			}
			const item_desc = (item.description || "").trim();

			// Clean item card without category banner
			const card = $(`
				<div class="fpos-item-card" data-code="${item.item_code}">
					<div class="fpos-item-media">
						${img}
						${diet_badge}
					</div>
					<div class="fpos-item-details">
						<div class="fpos-item-title" title="${item.item_name}">
							${item.item_name}
						</div>
						${item_desc ? `<div class="fpos-item-desc" title="${item_desc}">${item_desc}</div>` : ""}
						<div class="fpos-item-footer">
							<span class="fpos-item-rate">${price}</span>
							${(() => {
								// v3: Add to Dish becomes a qty stepper once the item is in the cart.
								const in_cart = (this.cart_items || []).find((c) => c.item_code === item.item_code);
								if (in_cart) {
									return `<span class="fpos-stepper" data-code="${item.item_code}">
										<button class="fpos-step-minus" title="${__("Remove one")}">−</button>
										<span class="fpos-stepper-qty">${in_cart.qty}</span>
										<button class="fpos-step-plus" title="${__("Add one")}">+</button>
									</span>`;
								}
								return `<button class="fpos-add-dish-btn" title="${__("Add to Dish")}">${__("Add to Dish")}</button>`;
							})()}
						</div>
					</div>
				</div>
			`);

			card.on("click", () => this.add_item_to_cart(item));
			// v3: stepper buttons must not re-trigger the card click (which adds one more).
			card.find(".fpos-step-minus").on("click", (e) => { e.stopPropagation(); this.change_item_qty(item.item_code, -1); });
			card.find(".fpos-step-plus").on("click", (e) => { e.stopPropagation(); this.change_item_qty(item.item_code, 1); });
			$grid.append(card);
		});
	}

	// ─── 5. Cart Management ──────────────────────────────────────────────────

	// v3: change an item's cart qty by delta (stepper on the card); 0 removes it.
	change_item_qty(item_code, delta) {
		const idx = (this.cart_items || []).findIndex((c) => c.item_code === item_code);
		if (idx < 0) { if (delta > 0) { const it = (this.items || []).find((i) => i.item_code === item_code); if (it) this.add_item_to_cart(it); } return; }
		this.update_cart_item_qty(idx, (this.cart_items[idx].qty || 0) + delta);
		this.render_items_grid();
	}

	add_item_to_cart(item, qty = 1, item_note = "") {
		if (flt(item.rate) <= 0 && !item.is_free_item) {
			this.prompt_manager_pin_for_free_item(item, qty, item_note);
			return;
		}

		const existing = this.cart_items.find(
			(i) => i.item_code === item.item_code && i.item_note === item_note
		);

		if (existing) {
			existing.qty += qty;
			existing.amount = existing.qty * existing.rate;
		} else {
			this.cart_items.push({
				item_code: item.item_code,
				item_name: item.item_name,
				qty: qty,
				rate: flt(item.rate),
				amount: flt(item.rate) * qty,
				item_note: item_note,
				uom: item.stock_uom || "Nos",
				item_image: item.item_image || "",
				is_free_item: item.is_free_item ? 1 : 0,
				manager_pin: item.manager_pin || null,
				manager_approved_by: item.manager_approved_by || null,
			});
		}

		this.render_cart_items();
		this.update_cart_summary();
		this.render_items_grid(); // v3: card shows the stepper once added
	}

	prompt_manager_pin_for_free_item(item, qty = 1, item_note = "") {
		this.prompt_manager_pin({
			action_type: "free_item",
			title: __("Zero-Price / Complimentary Item"),
			details: `Approve Rs 0.00 item for ${item.item_name || item.item_code} (Qty: ${qty})`,
			on_success: (res) => {
				const free_item = Object.assign({}, item, {
					is_free_item: 1,
					rate: 0.0,
					manager_pin: "approved",
					manager_approved_by: res.approved_by,
				});
				this.add_item_to_cart(free_item, qty, item_note);
				frappe.show_alert({
					message: __("Free item authorized by manager {0}", [res.manager_name || res.approved_by]),
					indicator: "green",
				});
			},
		});
	}

	prompt_manager_pin({ action_type, title, details, on_success }) {
		const pin_dialog = new frappe.ui.Dialog({
			title: title || __("Manager PIN Authorization"),
			fields: [
				{
					fieldname: "info_html",
					fieldtype: "HTML",
					options: `<div style="padding:4px 0 10px;color:#78716c;font-size:13px;line-height:1.4;">${details || __("This privileged action requires Manager PIN override.")}</div>`,
				},
				{
					fieldname: "pin",
					fieldtype: "Password",
					label: __("Manager PIN"),
					reqd: 1,
					description: __("Enter the 4-digit security PIN"),
				},
				{
					fieldname: "reason",
					fieldtype: "Small Text",
					label: __("Reason / Override Note (Optional)"),
				},
			],
			primary_action_label: __("Verify & Authorize"),
			primary_action: async (vals) => {
				if (!vals.pin) {
					frappe.msgprint(__("Please enter a PIN."));
					return;
				}
				try {
					frappe.dom.freeze(__("Verifying Manager Authorization..."));
					const res = await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.verify_manager_pin",
						args: {
							pin: vals.pin,
							action_type: action_type,
							cashier: frappe.session.user,
							details: vals.reason ? `${details} | Reason: ${vals.reason}` : details,
						},
					});
					frappe.dom.unfreeze();

					if (res.message && res.message.success) {
						pin_dialog.hide();
						if (on_success) on_success(res.message);
					}
				} catch (err) {
					frappe.dom.unfreeze();
					console.error("Manager PIN verification error:", err);
				}
			},
		});
		this.style_dialog(pin_dialog);
		pin_dialog.show();
	}

	update_cart_item_qty(index, new_qty) {
		if (new_qty <= 0) {
			this.cart_items.splice(index, 1);
		} else {
			this.cart_items[index].qty = new_qty;
			this.cart_items[index].amount = new_qty * this.cart_items[index].rate;
		}
		this.render_cart_items();
		this.update_cart_summary();
	}

	update_cart_item_rate(index, new_rate) {
		this.cart_items[index].rate = flt(new_rate);
		this.cart_items[index].amount = this.cart_items[index].qty * flt(new_rate);
		this.render_cart_items();
		this.update_cart_summary();
	}

	edit_item_instruction(index) {
		const item = this.cart_items[index];
		const original_rate = flt(item.rate);

		const d = new frappe.ui.Dialog({
			title: __("Item Instructions & Modifiers"),
			fields: [
				{
					fieldname: "item_note",
					fieldtype: "Small Text",
					label: __("Cooking Instructions (e.g. Extra Spicy, No Onions)"),
					default: item.item_note || "",
				},
				{
					fieldname: "rate",
					fieldtype: "Currency",
					label: __("Unit Price (Locked)"),
					default: item.rate,
					read_only: 1,
					description: __("🔒 Unit price is locked for cashiers. Click 'Unlock Price' to edit with Manager PIN."),
				},
			],
			primary_action_label: __("Update Item"),
			primary_action: (values) => {
				const new_rate = flt(values.rate);
				if (new_rate !== original_rate && !item.manager_approved_price) {
					frappe.msgprint(__("Price is locked. Please click 'Unlock Price (Manager PIN)' first."));
					return;
				}
				if (new_rate <= 0 && !item.is_free_item) {
					frappe.msgprint(__("Unit rate cannot be Rs 0.00 without Manager Free-Item authorization."));
					return;
				}
				item.item_note = values.item_note || "";
				item.rate = new_rate;
				item.amount = item.qty * item.rate;
				d.hide();
				this.render_cart_items();
				this.update_cart_summary();
			},
		});

		d.set_secondary_action_label(__("Unlock Price (Manager PIN)"));
		d.set_secondary_action(() => {
			this.prompt_manager_pin({
				action_type: "price_edit",
				title: __("Manager Override: Edit Unit Price"),
				details: `Edit unit price for ${item.item_name} from Rs ${original_rate}`,
				on_success: (res) => {
					item.manager_approved_price = true;
					item.manager_approved_by = res.approved_by;
					const rate_f = d.get_field("rate");
					rate_f.df.read_only = 0;
					rate_f.df.label = __("Unit Price (Unlocked by {0})", [res.manager_name || res.approved_by]);
					rate_f.df.description = __("Authorized by Manager: {0}", [res.manager_name || res.approved_by]);
					rate_f.refresh();
					frappe.show_alert({
						message: __("Price unlocked by manager {0}", [res.manager_name || res.approved_by]),
						indicator: "green",
					});
				},
			});
		});

		this.style_dialog(d);
		d.show();
	}

	render_cart_items() {
		const $box = this.wrapper.find(".fpos-cart-items");
		const $empty = this.wrapper.find(".fpos-cart-empty");
		$box.empty();

		if (this.cart_items.length === 0) {
			$empty.show();
			this.wrapper.find(".fpos-pay-btn").prop("disabled", true);
			this.wrapper.find(".fpos-confirm-order-btn").prop("disabled", true).css("opacity", "0.5");
			return;
		}

		$empty.hide();
		this.wrapper.find(".fpos-pay-btn").prop("disabled", false);
		this.wrapper.find(".fpos-confirm-order-btn").prop("disabled", false).css("opacity", "1");

		this.cart_items.forEach((item, idx) => {
			const note_html = item.item_note
				? `<div class="fpos-cart-line-note">${item.item_note}</div>`
				: "";

			const row = $(`
				<div class="fpos-cart-row">
					<div class="fpos-cart-row-main">
						<div class="fpos-cart-row-info">
							<span class="fpos-cart-item-name">${item.item_name}</span>
							${note_html}
						</div>
						<div class="fpos-cart-row-pricing">
							<span class="fpos-cart-row-amount">${this.format_money(item.amount)}</span>
							${flt(item.qty) > 1 ? `<span class="fpos-cart-row-unit">@ ${this.format_money(item.rate)}</span>` : ""}
						</div>
					</div>

					<div class="fpos-cart-row-sub">
						<button class="fpos-note-trigger">${fpos_icon("edit", "fpos-ic-sm")} ${__("Note / Price")}</button>
						<div class="fpos-cart-row-stepper">
							<button class="fpos-qty-minus" title="${item.qty === 1 ? __("Remove Item") : __("Decrease")}">${item.qty === 1 ? "✕" : "−"}</button>
							<span class="fpos-cart-qty">${item.qty}</span>
							<button class="fpos-qty-plus" title="${__("Increase")}">+</button>
						</div>
					</div>
				</div>
			`);

			row.find(".fpos-qty-minus").on("click", () => this.update_cart_item_qty(idx, item.qty - 1));
			row.find(".fpos-qty-plus").on("click", () => this.update_cart_item_qty(idx, item.qty + 1));
			row.find(".fpos-note-trigger").on("click", () => this.edit_item_instruction(idx));

			$box.append(row);
		});
	}

	update_cart_summary() {
		const subtotal = this.cart_items.reduce((sum, i) => sum + i.amount, 0);

		// v5.2: NO TAX. Discount is a flat Rs amount only (no % anymore) and is
		// clamped to the subtotal so Total Due can never go below 0.
		const discount = Math.min(subtotal, Math.max(0, flt(this.discount_amount || 0)));

		const discounted_subtotal = Math.max(0, subtotal - discount);
		const delivery_fee = (this.order_type === "Delivery") ? flt(this.delivery_charges || 0) : 0;
		const grand_total = discounted_subtotal + delivery_fee;

		this.totals = {
			subtotal: subtotal,
			discount: discount,
			tax: 0,
			delivery_fee: delivery_fee,
			grand_total: grand_total,
		};

		this.wrapper.find(".fpos-subtotal-val").text(this.format_money(subtotal));
		this.wrapper.find(".fpos-grand-total-val").text(this.format_money(grand_total));
		this.update_order_sub();

		if (discount > 0) {
			this.wrapper.find(".fpos-discount-row").css("display", "flex");
			this.wrapper.find(".fpos-discount-val").text(`-${this.format_money(discount)}`);
		} else {
			this.wrapper.find(".fpos-discount-row").hide();
		}

		if (delivery_fee > 0) {
			this.wrapper.find(".fpos-delivery-row").css("display", "flex");
			this.wrapper.find(".fpos-delivery-val").text(`+${this.format_money(delivery_fee)}`);
		} else {
			this.wrapper.find(".fpos-delivery-row").hide();
		}

		// Keep active tab state in sync with current cart & debounce draft save
		if (this.active_tab_id && this.tabs[this.active_tab_id]) {
			const cur = this.tabs[this.active_tab_id];
			cur.cart_items = [...this.cart_items];
			cur.discount_percentage = this.discount_percentage;
			cur.discount_amount = this.discount_amount;
			cur.delivery_phone = this.delivery_phone;
			cur.delivery_address = this.delivery_address;
			cur.delivery_charges = this.delivery_charges;
			cur.order_note = this.order_note;
			cur.grand_total = grand_total;
			cur.order_type = this.order_type;
			cur.table = this.selected_table;
			cur.table_no = this.selected_table_no;
			cur.customer = this.customer;
			cur.linked_kot_id = this.linked_kot_id || cur.linked_kot_id || null;
			cur.pos_order_id = this.pos_order_id || cur.pos_order_id || null;
			this.update_tab_pill(this.active_tab_id);
			this.debounced_save_active_tab_draft();
		}

		this.save_cart_backup();
	}

	save_cart_backup() {
		try {
			const backup_key = "fpos_cart_backup_" + (this.pos_profile || "default");
			if (this.cart_items && this.cart_items.length > 0) {
				const backup = {
					cart_items: this.cart_items,
					order_type: this.order_type || "Dine In",
					table: this.selected_table || null,
					table_no: this.selected_table_no || (this.selected_table ? this.selected_table.split("-").pop().trim() : ""),
					linked_kot_id: this.linked_kot_id || (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]?.linked_kot_id) || null,
					pos_order_id: this.pos_order_id || (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]?.pos_order_id) || null,
					customer: this.customer || "",
					discount_percentage: flt(this.discount_percentage || 0),
					discount_amount: flt(this.discount_amount || 0),
					delivery_phone: this.delivery_phone || "",
					delivery_address: this.delivery_address || "",
					delivery_charges: flt(this.delivery_charges || 0),
					order_note: this.order_note || "",
				};
				localStorage.setItem(backup_key, JSON.stringify(backup));
			} else if (this._cart_ready_for_sync && !this.linked_kot_id) {
				// v5.9: a confirmed (KOT-linked) order must survive a reload
				// even if the cart is momentarily empty — never drop its
				// backup. clear_cart() still removes it (it nulls the link first).
				localStorage.removeItem(backup_key);
			}
		} catch (e) {
			console.warn("Could not save cart backup:", e);
		}
	}

	clear_cart() {
		this.hide_pending_banner();
		if (this.selected_table) {
			const tbl = this.selected_table;
			frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.release_table_if_no_order",
				args: { table: tbl },
				freeze: false,
			});
		}

		this.linked_kot_id = null;
		// Round 23 fix: a cleared cart is a new order — drop its token too,
		// so the next cart can never inherit the previous order's KOTs.
		this.pos_order_id = null;
		try {
			localStorage.removeItem("fpos_cart_backup_" + (this.pos_profile || "default"));
		} catch (e) {}

		this.cart_items = [];
		this.discount_percentage = 0;
		this.discount_amount = 0;
		this.discount_approved_by = null;
		this.discount_manager_pin = null;
		this.delivery_phone = "";
		this.delivery_address = "";
		this.delivery_charges = 0;
		this.order_note = "";
		this.wrapper.find(".fpos-delivery-label").text(__("Delivery Details *"));
		this.render_cart_items();
		this.update_cart_summary();
		// v5.9: re-render the grid too — otherwise item cards keep a stale
		// qty stepper ("− 1 +") for an item that is no longer in the cart.
		if (this.items && this.items.length) this.render_items_grid();
		if (this.active_tab_id && this.tabs[this.active_tab_id]) {
			this.sync_current_cart_to_active_tab();
		}
	}

	restore_cart_backup() {
		try {
			const raw = localStorage.getItem("fpos_cart_backup_" + (this.pos_profile || "default"));
			if (!raw) return false;
			const data = JSON.parse(raw);
			if (data && data.cart_items && data.cart_items.length > 0) {
				this.cart_items = data.cart_items;
				this.order_type = data.order_type || "Dine In";
				this.selected_table = data.table || null;
				this.selected_table_no = data.table_no || (data.table ? data.table.split("-").pop().trim() : "");
				this.linked_kot_id = data.linked_kot_id || null;
				this.pos_order_id = data.pos_order_id || null;
				this.discount_percentage = 0; // v5.2: % discounts removed — Rs only, stale % never restored.
				this.discount_amount = flt(data.discount_amount || 0);
				this.delivery_phone = data.delivery_phone || "";
				this.delivery_address = data.delivery_address || "";
				this.delivery_charges = flt(data.delivery_charges || 0);
				this.order_note = data.order_note || "";
				if (data.customer) this.customer = data.customer;

				const tab_id = this.active_tab_id || ("tab_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4));
				const tab_title = this.selected_table_no ? `Table ${this.selected_table_no}` : `${this.order_type} #1`;
				this.tabs = this.tabs || {};
				this.tabs[tab_id] = {
					id: tab_id,
					draft_invoice_name: null,
					order_type: this.order_type,
					table: this.selected_table,
					table_no: this.selected_table_no,
					linked_kot_id: this.linked_kot_id,
					pos_order_id: this.pos_order_id || null,
					customer: this.customer || (this.profile_data && this.profile_data.customer) || "",
					cart_items: [...this.cart_items],
					discount_percentage: this.discount_percentage,
					discount_amount: this.discount_amount,
					delivery_phone: this.delivery_phone,
					delivery_address: this.delivery_address,
					delivery_charges: this.delivery_charges,
					order_note: this.order_note,
					grand_total: 0,
					title: tab_title,
				};
				this.active_tab_id = tab_id;
				this._cart_ready_for_sync = true;
				return true;
			}
		} catch (e) {
			console.warn("Could not restore cart backup:", e);
		}
		return false;
	}

	// ─── 5.5 Multi-Order Tab Management ───────────────────────────────────────

	async init_tabs() {
		this.tabs = {};
		this.active_tab_id = null;

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_active_draft_tabs",
				args: { pos_profile: this.pos_profile },
				freeze: false,
			});
			const drafts = res.message || [];

			if (drafts.length > 0) {
				drafts.forEach((d) => {
					const tab_id = d.draft_invoice_name || d.id;
					const table_obj = this.tables.find((t) => t.name === d.table);
					const table_no = (table_obj && (table_obj.table_no || table_obj.name)) || d.table || "";

					let title = "";
					if (table_no) {
						title = `Table ${table_no}`;
					} else {
						title = `${d.order_type || "Order"} #${d.draft_invoice_name.slice(-4)}`;
					}

					this.tabs[tab_id] = {
						id: tab_id,
						draft_invoice_name: d.draft_invoice_name,
						order_type: d.order_type || "Dine In",
						table: d.table || null,
						table_no: table_no,
						customer: d.customer || (this.profile_data && this.profile_data.customer) || "",
						cart_items: (d.items || []).map((it) => {
							const matched_item = this.items.find((i) => i.item_code === it.item_code);
							return {
								item_code: it.item_code,
								item_name: it.item_name || it.item_code,
								qty: flt(it.qty),
								rate: flt(it.rate),
								amount: flt(it.amount || it.qty * it.rate),
								uom: it.uom || "Nos",
								item_note: it.description || "",
								item_image: (matched_item && matched_item.image) || "",
							};
						}),
						discount_percentage: 0,
						discount_amount: 0,
						order_note: d.order_note || "",
						grand_total: flt(d.grand_total || 0),
						title: title,
					};
				});

				const first_id = drafts[0].draft_invoice_name || drafts[0].id;
				// v5.9: a draft with no items must not wipe a restored
				// confirmed order — keep the local backup when it has items.
				const first_has_items = (drafts[0].items || []).length > 0;
				if (!first_has_items) {
					const kept = this.active_tab_id && this.tabs[this.active_tab_id]
						&& this.cart_items && this.cart_items.length > 0;
					if (kept) {
						this.render_tab_bar();
						this.update_order_type_ui();
						this.render_cart_items();
						this.update_cart_summary();
					} else if (this.restore_cart_backup()) {
						this.render_tab_bar();
						this.update_order_type_ui();
						this.render_cart_items();
						this.update_cart_summary();
					} else {
						this.switch_tab(first_id);
					}
				} else {
					this.switch_tab(first_id);
				}
			} else {
				let restored = false;
				if (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id] && this.cart_items && this.cart_items.length > 0) {
					const cur = this.tabs[this.active_tab_id];
					cur.table = this.selected_table;
					cur.table_no = this.selected_table_no;
					cur.linked_kot_id = this.linked_kot_id;
					if (this.selected_table_no) {
						cur.title = `Table ${this.selected_table_no}`;
					}
					this.render_tab_bar();
					this.update_order_type_ui();
					this.render_cart_items();
					this.update_cart_summary();
					restored = true;
				} else {
					restored = this.restore_cart_backup();
					if (restored) {
						this.render_tab_bar();
						this.update_order_type_ui();
						this.render_cart_items();
						this.update_cart_summary();
					}
				}

				if (!restored) {
					this.create_new_tab("Dine In", null, "", true);
				}
			}
			this._cart_ready_for_sync = true;
		} catch (e) {
			console.warn("Failed to load active draft tabs, creating fresh tab:", e);
			this.create_new_tab("Dine In", null, "", true);
			this._cart_ready_for_sync = true;
		}
	}

	render_tab_bar() {
		const $list = this.wrapper.find(".fpos-tabs-list");
		if (!$list.length) return;
		$list.empty();

		const curr = (this.profile_data && this.profile_data.currency) || "USD";
		const tab_keys = Object.keys(this.tabs);

		tab_keys.forEach((key) => {
			const tab = this.tabs[key];
			const is_active = (key === this.active_tab_id);
			const type_icons = { "Dine In": "table", "Takeaway": "box", "Delivery": "truck", "Walk In": "user" };
			const icon = fpos_icon(type_icons[tab.order_type] || "receipt", "fpos-ic-sm");
			const total_str = this.format_money(tab.grand_total || 0);
			const item_count = tab.cart_items ? tab.cart_items.length : 0;
			const count_str = item_count === 1 ? __("1 item") : (item_count > 1 ? `${item_count} ${__("items")}` : __("Empty"));

			const $tab = $(`
				<div class="fpos-tab-pill ${is_active ? "active" : ""}" data-tab-id="${key}" style="
					display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:12px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;
					background:${is_active ? "#ffffff" : "#f5efe4"};
					color:${is_active ? "#292524" : "#57534e"};
					border:1.5px solid ${is_active ? "#ea580c" : "#d8cbb8"};
					box-shadow:${is_active ? "0 2px 8px rgba(234,88,12,0.18)" : "none"};
					transition:all .15s ease;
				">
					${is_active ? `<span style="width:7px;height:7px;border-radius:50%;background:#ea580c;display:inline-block;"></span>` : ""}
					<span style="font-size:14px;">${icon}</span>
					<span class="fpos-tab-title" style="font-weight:700;max-width:140px;overflow:hidden;text-overflow:ellipsis;">${tab.title || __("Tab")}</span>
					<span class="fpos-tab-items-count" style="font-size:11px;color:${is_active ? "#78716c" : "#a8a29e"};background:${is_active ? "#faf6f0" : "#eadfd2"};padding:2px 7px;border-radius:10px;font-weight:600;">${count_str}</span>
					<span class="fpos-tab-total" style="font-size:12px;font-weight:800;color:${is_active ? "#ea580c" : "#78716c"};">${total_str}</span>
					${tab_keys.length > 1 ? `
						<span class="fpos-close-tab-btn" data-tab-id="${key}" title="${__("Close / Discard Tab")}" style="
							color:#a8a29e;font-size:14px;line-height:1;margin-left:4px;cursor:pointer;padding:2px 5px;border-radius:50%;
							transition:background .15s ease, color .15s ease;
						">×</span>
					` : ""}
				</div>
			`);

			$tab.on("click", (e) => {
				if ($(e.target).hasClass("fpos-close-tab-btn")) return;
				this.switch_tab(key);
			});

			$tab.find(".fpos-close-tab-btn").on("mouseenter", function() {
				$(this).css({ background: "#fee2e2", color: "#dc2626" });
			}).on("mouseleave", function() {
				$(this).css({ background: "transparent", color: "#a8a29e" });
			});

			$tab.find(".fpos-close-tab-btn").on("click", (e) => {
				e.stopPropagation();
				this.close_tab(key);
			});

			$list.append($tab);
		});
		this.render_table_chips();
	}

	update_tab_pill(tab_id) {
		const tab = this.tabs[tab_id];
		if (!tab) return;
		const curr = (this.profile_data && this.profile_data.currency) || "USD";
		const $pill = this.wrapper.find(`.fpos-tab-pill[data-tab-id="${tab_id}"]`);
		if ($pill.length) {
			const item_count = tab.cart_items ? tab.cart_items.length : 0;
			const count_str = item_count === 1 ? __("1 item") : (item_count > 1 ? `${item_count} ${__("items")}` : __("Empty"));
			$pill.find(".fpos-tab-title").text(tab.title || __("Tab"));
			$pill.find(".fpos-tab-items-count").text(count_str);
			$pill.find(".fpos-tab-total").text(this.format_money(tab.grand_total || 0));
		}
	}

	create_new_tab(order_type = "Dine In", table = null, table_no = "", activate = true) {
		// Sync current active tab state before creating new one
		if (this.active_tab_id && this.tabs[this.active_tab_id]) {
			this.sync_current_cart_to_active_tab();
		}

		const tab_id = "tab_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4);
		const tab_count = Object.keys(this.tabs).length + 1;

		let title = "";
		if (table_no || table) {
			title = `Table ${table_no || table}`;
		} else if (order_type === "Takeaway") {
			title = `Takeaway #${tab_count}`;
		} else if (order_type === "Delivery") {
			title = `Delivery #${tab_count}`;
		} else {
			title = `Order #${tab_count}`;
		}

		this.tabs[tab_id] = {
			id: tab_id,
			draft_invoice_name: null,
			order_type: order_type,
			table: table,
			table_no: table_no,
			customer: (this.profile_data && this.profile_data.customer) || "",
			cart_items: [],
			discount_percentage: 0,
			discount_amount: 0,
			order_note: "",
			grand_total: 0,
			title: title,
		};

		this.render_tab_bar();

		if (activate) {
			this.switch_tab(tab_id);
		}
		return tab_id;
	}

	switch_tab(target_tab_id) {
		if (!target_tab_id || !this.tabs[target_tab_id]) return;
		if (this.active_tab_id === target_tab_id) return;

		// Save state of current tab in client memory
		if (this.active_tab_id && this.tabs[this.active_tab_id]) {
			this.sync_current_cart_to_active_tab();
		}

		this.active_tab_id = target_tab_id;
		const target = this.tabs[target_tab_id];

		// Restore state into controller
		this.order_type = target.order_type || "Dine In";
		this.selected_table = target.table || null;
		this.selected_table_no = target.table_no || "";
		this.linked_kot_id = target.linked_kot_id || null;
		this.pos_order_id = target.pos_order_id || null;
		this.customer = target.customer || (this.profile_data && this.profile_data.customer) || "";
		this.cart_items = [...(target.cart_items || [])];
		this.discount_percentage = 0; // v5.2: % discounts removed — Rs only.
		this.discount_amount = target.discount_amount || 0;
		this.order_note = target.order_note || "";

		// Update Order Type UI (tabs, table/delivery fields)
		this.update_order_type_ui();

		// Update Customer label
		this.wrapper.find(".fpos-customer-label").text(this.customer || __("Walk-in Customer"));

		this.render_cart_items();
		this.update_cart_summary();
		this.render_tab_bar();
		// v5.9: keep the item-card steppers in sync with the switched tab's
		// cart — otherwise a card shows a stale qty from the previous tab.
		if (this.items && this.items.length) this.render_items_grid();
	}

	async close_tab(tab_id) {
		if (!this.tabs[tab_id]) return;
		const tab = this.tabs[tab_id];

		const perform_close = async () => {
			if (tab.draft_invoice_name) {
				try {
					await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.discard_draft_order",
						args: {
							invoice_name: tab.draft_invoice_name,
							table: tab.table || "",
						},
						freeze: false,
					});
				} catch (e) {
					console.error("Discard draft error:", e);
				}
			}

			delete this.tabs[tab_id];
			const remaining = Object.keys(this.tabs);

			if (this.active_tab_id === tab_id) {
				if (remaining.length > 0) {
					this.switch_tab(remaining[0]);
				} else {
					this.active_tab_id = null;
					this.create_new_tab("Dine In", null, "", true);
				}
			} else {
				this.render_tab_bar();
			}
		};

		if (tab && tab.table) {
			try {
				const res = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.check_table_has_unsettled_kot",
					args: { table: tab.table },
					freeze: false,
				});
				if (res.message && res.message.has_kot) {
					frappe.msgprint({
						title: __("Active Kitchen Tickets Exist"),
						indicator: "red",
						message: __("Tab '{0}' has a {1} kitchen order ticket ({2}) for Table {3}. Settle payment or perform an authorized Manager Void before closing.", [
							tab.title || "Tab",
							res.message.kot_status,
							res.message.kot_name,
							tab.table_no || tab.table
						])
					});
					return;
				}
			} catch (e) {
				console.warn("KOT check failed:", e);
			}
		}

		if (tab.cart_items && tab.cart_items.length > 0) {
			frappe.confirm(
				__("Discard open tab '{0}' with {1} item(s)?", [tab.title || "Tab", tab.cart_items.length]),
				() => perform_close()
			);
		} else {
			perform_close();
		}
	}

	sync_current_cart_to_active_tab() {
		if (!this.active_tab_id || !this.tabs[this.active_tab_id]) return;
		const cur = this.tabs[this.active_tab_id];
		cur.order_type = this.order_type;
		cur.table = this.selected_table;
		cur.table_no = this.selected_table_no;
		cur.customer = this.customer;
		cur.cart_items = [...this.cart_items];
		cur.discount_percentage = this.discount_percentage;
		cur.discount_amount = this.discount_amount;
		cur.order_note = this.order_note;
		cur.grand_total = (this.totals && this.totals.grand_total) || 0;
		if (cur.table_no) {
			cur.title = `Table ${cur.table_no}`;
		}
	}

	debounced_save_active_tab_draft() {
		// Cart state lives strictly in client memory/localStorage until checkout.
		// Never write phantom draft invoices to database on cart edits or order type switch.
		if (this._draft_save_timer) {
			clearTimeout(this._draft_save_timer);
		}
	}

	async save_active_tab_draft() {
		// Cart state lives strictly in client memory/localStorage until checkout.
		// Never write phantom draft invoices to database on cart edits or tab switch.
		return;
	}

	is_table_in_any_tab(table_name) {
		if (!table_name) return false;
		return Object.values(this.tabs).some((tab) => tab.table === table_name);
	}

	setup_realtime_table_listener() {
		if (!frappe.realtime) return;
		frappe.realtime.off("fpos_table_status_changed");
		frappe.realtime.on("fpos_table_status_changed", (data) => {
			if (!data || !data.table) return;

			// 1. Update in-memory tables
			const t = this.tables.find((x) => x.name === data.table || x.table_no === data.table);
			if (t) {
				t.status = data.status;
				t.order_id = data.order_id || null;
			}

			// 2. Dynamically update open table modal cards if present
			const card = $(`.fpos-tbl-card[data-table="${data.table}"]`);
			if (card.length) {
				const status_colors = {
					Available: "#22c55e",
					Free: "#22c55e",
					Occupied: "#ef4444",
					Reserved: "#f59e0b",
					Cleaning: "#3b82f6",
				};
				const color = status_colors[data.status] || "#a8a29e";
				card.find(".fpos-tbl-dot").css("background", color);
				card.find(".fpos-tbl-status").text(data.status).css("color", color);
			}
		});
	}

	// ─── 6. Restaurant Operations: Table Selection & KOT ───────────────────────

	async open_table_selector() {
		if (this._is_opening_table) return;
		this._is_opening_table = true;

		// Clean up any orphan modal-backdrops left over from preceding modals
		$(".modal-backdrop:not(.show)").remove();
		if (!$(".modal.show").length) {
			$(".modal-backdrop").remove();
			$("body").removeClass("modal-open");
		}

		try {
			// v2: tables are for the single branch — no branch filter.

			// Fetch latest tables from DB for this branch
			try {
				const res = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_available_tables",
					args: { pos_profile: this.pos_profile },
				});
				this.tables = res.message || [];
			} catch (e) {
				console.error("Failed to fetch tables:", e);
			}

			let table_selected = false;
			const previous_order_type = this.selected_table ? "Dine In" : (this.previous_order_type || "Takeaway");

			const d = new frappe.ui.Dialog({
				title: __("Select Table for Dine-In"),
				size: "large",
			});

		d.get_close_btn().on("click", () => {
			// Round 8 Item 3: Closing the table selector without choosing a table
			// leaves the order as Dine-In (unassigned table), blocking Pay & Settle.
			// It MUST NOT silently revert to Takeaway.
			if (!this.selected_table) {
				this.order_type = "Dine In";
				this.update_order_type_ui();
			}
		});

		const body = $(d.wrapper).find(".modal-body");
		body.html(`
			<div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;">
				<div style="font-size:13px;color:#78716c;">
					${this.tables.length} tables &bull; Main Branch
				</div>
				<div style="display:flex;gap:12px;font-size:11px;">
					<span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:#22c55e;"></span> Available</span>
					<span style="display:flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:#ef4444;"></span> Occupied</span>
				</div>
			</div>
			<div class="fpos-table-grid" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:12px;padding:6px 0;"></div>
		`);

		const grid = body.find(".fpos-table-grid");

		if (this.tables.length === 0) {
			grid.html(`<div style="grid-column:1/-1;text-align:center;padding:30px 10px;color:#78716c;">${__("No tables found. Add Restaurant Tables in Desk.")}</div>`);
		} else {
			this.tables.forEach((t) => {
				const is_occupied = t.status === "Occupied";
				const status_colors = {
					Available: "#22c55e",
					Free: "#22c55e",
					Occupied: "#ef4444",
					Reserved: "#f59e0b",
					Cleaning: "#3b82f6",
				};
				const color = status_colors[t.status] || "#a8a29e";
				const has_tab = this.is_table_in_any_tab(t.name);
				const display_name = t.table_no ? `Table ${t.table_no}` : t.name;

				const card = $(`
					<div class="fpos-tbl-card" data-table="${t.name}" style="border:2px solid ${t.name === this.selected_table ? "#ea580c" : "#eadfd2"};background:#fff;border-radius:10px;padding:12px;text-align:center;cursor:pointer;position:relative;transition:all .2s ease;">
						<div class="fpos-tbl-dot" style="width:10px;height:10px;border-radius:50%;background:${color};margin:0 auto 6px;"></div>
						<div style="font-weight:700;font-size:14px;color:#292524;">${display_name}</div>
						<small style="color:#78716c;font-size:11px;">${t.capacity || 4} ${__("Seats")}</small>
						<div class="fpos-tbl-status" style="font-size:10px;color:${color};font-weight:700;margin-top:4px;">${__(t.status)}</div>
						${is_occupied && t.occupied_since ? `<div class="fpos-tbl-timer" data-since="${t.occupied_since}" style="font-size:11px;color:#b45309;font-weight:700;margin-top:2px;">⏱ ${this.format_elapsed(t.occupied_since)}</div>` : ""}
						${has_tab ? `<span style="position:absolute;top:4px;right:6px;font-size:10px;background:#e0f2fe;color:#0284c7;padding:1px 5px;border-radius:6px;font-weight:700;">${__("Tab")}</span>` : ""}
						${is_occupied ? `
							<button class="btn btn-xs btn-default fpos-card-free-btn" data-table="${t.name}" style="margin-top:6px;font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid #fca5a5;color:#b91c1c;background:#fff5f5;font-weight:600;">
								${fpos_icon("checkCircle", "fpos-ic-sm")} Free Table
							</button>
						` : ""}
					</div>
				`);

				// Card click: Select table or switch to its tab
				card.on("click", (e) => {
					if ($(e.target).hasClass("fpos-card-free-btn")) return;

					table_selected = true;
					const existing_tab_id = Object.keys(this.tabs).find((k) => this.tabs[k].table === t.name);
					if (existing_tab_id && existing_tab_id !== this.active_tab_id) {
						d.hide();
						this.switch_tab(existing_tab_id);
						frappe.show_alert({
							message: __("Switched to active Tab for {0}", [display_name]),
							indicator: "blue",
						});
						return;
					}

					this.selected_table = t.name;
					this.selected_table_no = t.table_no || t.name;
					this.wrapper.find(".fpos-table-label").text(display_name);

					const cur = this.tabs[this.active_tab_id];
					if (cur) {
						cur.table = t.name;
						cur.table_no = this.selected_table_no;
						cur.title = display_name;
					}

					this.update_order_type_ui();
					this.update_cart_summary();
					this.save_cart_backup();
					this.render_tab_bar();
					d.hide();
				});

				// Free Table click: Manager PIN override
				card.find(".fpos-card-free-btn").on("click", (e) => {
					e.stopPropagation();
					this.prompt_manager_pin({
						action_type: "table_reset",
						title: __("Force-Free Occupied Table"),
						details: `Emergency unlock for ${display_name} to restore availability and prevent deadlock.`,
						on_success: async (res) => {
							frappe.dom.freeze(__("Unlocking table..."));
							await frappe.call({
								method: "foodpos.foodpos.page.food_pos.food_pos.force_free_table",
								args: {
									table: t.name,
									manager_pin: "approved",
									reason: "Manager PIN manual table release",
								},
							});
							frappe.dom.unfreeze();
							t.status = "Available";
							t.order_id = null;
							card.find(".fpos-tbl-dot").css("background", "#22c55e");
							card.find(".fpos-tbl-status").text("Available").css("color", "#22c55e");
							card.find(".fpos-card-free-btn").remove();
							frappe.show_alert({
								message: __("{0} freed and set to Available", [display_name]),
								indicator: "green",
							});
						},
					});
				});

				grid.append(card);
			});
		}

			this.style_dialog(d);
			d.show();
		} finally {
			this._is_opening_table = false;
		}
	}

	// BILL RULE v3 — HARD RULE, do not change without the user asking:
	// confirming an order prints the KOT slip ONLY — never the customer
	// bill. The customer bill is generated/printed ONLY in
	// process_invoice_submission() after payment, or on an explicit
	// reprint from Recent Orders (show_pos_slip, line ~3693). There is
	// NO show_pos_slip / print_pos_slip / get_invoice_slip_data call in
	// this function, and none may be added here. The server
	// confirm_order() likewise creates NO invoice (payment stays
	// Pending). The pending banner below makes this visible to the user.
	// v3: show/hide the "Payment Pending — no bill yet" banner in the cart.
	show_pending_banner(kot_name) {
		const $b = this.wrapper.find(".fpos-pending-banner");
		if (!$b.length) return;
		$b.html(`<b>${__("Payment Pending")}</b> — ${__("KOT {0} is in the kitchen. No bill has been given to the customer yet — the bill is printed only when the customer pays.", [kot_name || ""])}`);
		$b.addClass("show");
	}
	hide_pending_banner() {
		this.payment_pending = false;
		this.wrapper.find(".fpos-pending-banner").removeClass("show").empty();
	}

	// v3: bottom occupied-table chips (image 4) — built from open order tabs.
	render_table_chips() {
		const $bar = this.wrapper.find(".fpos-table-chips-bar");
		if (!$bar.length) return;
		// v4 CHILI bottom strip: staff avatars first, then ONE chip per OPEN order
		// (tables AND walk-in/takeaway/delivery — the top tabs bar is gone, so this
		// strip is the only order switcher).
		const tabs = Object.values(this.tabs || {});
		// v4: free tables join the strip too (CHILI shows T1/T2/T3 with "Available") —
		// tapping one starts a fresh Dine-In order on that table. Capped at 8 so the
		// strip stays a single scrollable row.
		const occupied = new Set(tabs.map((t) => t.table).filter(Boolean));
		const free = (this.tables || [])
			.filter((t) => t.status !== "Occupied" && !occupied.has(t.name))
			.slice(0, 8);
		if (!tabs.length && !free.length) { $bar.hide().empty(); return; }
		const chips = tabs.map((t) => {
			const items = (t.cart_items || []).length;
			const no = t.table_no ? `T${t.table_no}` : (t.order_type === "Walk In" ? "W" : t.order_type === "Takeaway" ? "TA" : "D");
			const meta = t.order_confirmed ? `${items} ${__("items")} → ${__("Kitchen")}` : (items ? `${items} ${__("items")} • ${__("Ordering")}` : __("Empty"));
			return `
			<button class="fpos-table-chip" data-tab-id="${t.id}">
				<span class="fpos-table-chip-dot ${t.order_confirmed ? "kitchen" : "ordering"}"></span>
				<span class="fpos-table-chip-no">${no}</span>
				<span>${t.customer || __("Walk-in")}</span>
				<span class="fpos-table-chip-meta">${meta}</span>
			</button>`;
		}).join("");
		const free_chips = free.map((t) => {
			const no = t.table_no || t.name;
			return `
			<button class="fpos-table-chip fpos-table-chip-available" data-table-name="${t.name}">
				<span class="fpos-table-chip-dot free"></span>
				<span class="fpos-table-chip-no">T${no}</span>
				<span>${__("Table")} ${no}</span>
				<span class="fpos-table-chip-meta">${__("Available")}</span>
			</button>`;
		}).join("");
		$bar.html(`
			<span class="fpos-chips-staff" title="${__("Staff on shift")}">
				<span class="fpos-chip-avatar fpos-chip-avatar-a">${fpos_icon("user", "fpos-ic-sm")}</span>
				<span class="fpos-chip-avatar fpos-chip-avatar-b">${fpos_icon("user", "fpos-ic-sm")}</span>
			</span>${chips}${free_chips}`);
		$bar.show();
	}

	// v4: tapping a free-table chip starts a fresh Dine-In order on that table
	// (same create_new_tab pattern the tables floor uses, line ~6112). If a tab
	// already exists for the table, switch to it instead.
	start_table_order(table_name) {
		const t = (this.tables || []).find((x) => x.name === table_name);
		if (!t) return;
		const existing_tab_id = Object.keys(this.tabs || {}).find((k) => this.tabs[k].table === t.name);
		if (existing_tab_id) { this.switch_tab(existing_tab_id); return; }
		this.create_new_tab("Dine In", t.name, t.table_no || "", true);
	}

	// v2: Confirm Order — the ONLY way a KOT reaches the kitchen now.
	// There is no manual "Send to Kitchen" button any more: confirming
	// an order auto-creates the KOT server-side (confirm_order API),
	// reserves the table and starts its timer, and leaves payment
	// PENDING until the customer pays at settle time. The server is
	// idempotent per order_id + station (Round 23), and the client
	// guard below stops a double-click from even sending twice.
	async confirm_order() {
		if (this._confirming_order) return; // double-click guard
		if (this.cart_items.length === 0) {
			frappe.show_alert({ message: __("Cart is empty. Add items first."), indicator: "orange" });
			return;
		}
		if (this.order_type === "Dine In" && !this.selected_table) {
			frappe.show_alert({ message: __("Please select a table before confirming the order."), indicator: "orange" });
			this.open_table_selector();
			return;
		}
		this._confirming_order = true;
		const order_payload = {
			// Round 23 fix: send this cart's order token; the server
			// generates one and returns it if this is the first call.
			order_id: this.pos_order_id || null,
			order_type: this.order_type,
			table: this.selected_table || "",
			customer: this.customer,
			pos_profile: this.pos_profile,
			guests: 1,
			order_note: this.order_note,
			items: this.cart_items,
		};
		try {
			frappe.dom.freeze(__("Confirming order — sending ticket to kitchen..."));
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.confirm_order",
				args: { order_data: order_payload },
			});
			frappe.dom.unfreeze();
			const msg = res.message || {};
			const kot_name = msg.kot_name;
			if (msg.order_id) {
				this.pos_order_id = msg.order_id;
				if (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]) {
					this.tabs[this.active_tab_id].pos_order_id = msg.order_id;
				}
			}
			if (kot_name) {
				this.linked_kot_id = kot_name;
				if (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]) {
					this.tabs[this.active_tab_id].linked_kot_id = kot_name;
				}
				this.save_cart_backup();
			}
			this.order_confirmed = true;
			if (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]) {
				this.tabs[this.active_tab_id].order_confirmed = true;
				this.tabs[this.active_tab_id].payment_status = "Pending";
			}
			frappe.show_alert({ message: __("Order confirmed! Kitchen Ticket {0} sent — payment pending.", [kot_name]), indicator: "green" });
			// BILL RULE v3: payment is Pending and NO bill has been given yet.
			this.payment_pending = true;
			this.show_pending_banner(kot_name);
			this.render_table_chips(); // v3: chip flips to "Kitchen • Pending"
			this.refresh_kitchen_badge();
			this.render_tables_view();
			// v5.10: NO auto slip/print on confirm. The live KDS screen IS
			// the kitchen ticket. Opening a slip tab with a print dialog on
			// confirm blocked the whole POS tab (no click worked until the
			// dialog was dismissed) — that is what killed Pay in v5.9 even
			// after the in-tab print fix. Paper slip: the Print button on the
			// KOT card in the Live Kitchen Orders drawer (open_kot_slip).
		} catch (e) {
			frappe.dom.unfreeze();
			frappe.show_alert({ message: __("Failed to confirm order: {0}", [e.message]), indicator: "red" });
		} finally {
			this._confirming_order = false;
			// v5.9: guarantee the confirmation freeze is torn down even if
			// the freeze counter is imbalanced — a stuck overlay swallows
			// every click on the page while looking like nothing is wrong.
			this._force_unfreeze();
		}
	}

	// Backwards-compatible alias (old callers, if any, get the auto flow).
	async send_to_kitchen() { return this.confirm_order(); }

	// ─── 7. Customer Picker & Creation ───────────────────────────────────────

	open_customer_dialog() {
		const d = new frappe.ui.Dialog({
			title: __("Customer Selection"),
			fields: [
				{
					fieldname: "search_customer",
					fieldtype: "Link",
					options: "Customer",
					label: __("Select Existing Customer"),
					change: () => {
						const val = d.get_value("search_customer");
						if (val) {
							this.customer = val;
							this.wrapper.find(".fpos-customer-label").text(this.customer);
							d.hide();
						}
					},
				},
				{
					fieldname: "sec_break",
					fieldtype: "Section Break",
					label: __("Or Quick Add New Customer"),
				},
				{
					fieldname: "customer_name",
					fieldtype: "Data",
					label: __("Customer Name"),
				},
				{
					fieldname: "mobile_no",
					fieldtype: "Data",
					label: __("Mobile Number"),
				},
			],
			primary_action_label: __("Create & Select"),
			primary_action: async (values) => {
				if (!values.customer_name) {
					frappe.msgprint(__("Customer Name is required."));
					return;
				}
				try {
					const res = await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.create_customer",
						args: {
							customer_name: values.customer_name,
							mobile_no: values.mobile_no,
						},
					});
					this.customer = res.message.name;
					this.wrapper.find(".fpos-customer-label").text(this.customer);
					d.hide();
					frappe.show_alert({ message: __("Customer created"), indicator: "green" });
				} catch (err) {
					frappe.show_alert({ message: err.message, indicator: "red" });
				}
			},
		});
		this.style_dialog(d);
		d.show();
	}

	open_delivery_dialog(callback) {
		if (this.delivery_dialog) {
			try {
				this.delivery_dialog.hide();
				this.delivery_dialog.$wrapper.remove();
				this.delivery_dialog.destroy();
			} catch (e) {}
			this.delivery_dialog = null;
		}
		$(".modal:contains('Delivery Order Details')").closest(".modal").remove();
		$(".modal:contains('Not found')").closest(".modal").remove();
		$(".modal-backdrop").remove();
		$("body").removeClass("modal-open");

		const d = new frappe.ui.Dialog({
			title: __("Delivery Order Details"),
			fields: [
				{
					fieldname: "customer_name",
					fieldtype: "Data",
					label: __("Customer Name *"),
					reqd: 1,
					default: (this.customer && this.customer !== "Walk-in Customer") ? this.customer : "",
				},
				{
					fieldname: "phone",
					fieldtype: "Data",
					label: __("Customer Contact Phone *"),
					reqd: 1,
					default: this.delivery_phone || "",
				},
				{
					fieldname: "delivery_address",
					fieldtype: "Small Text",
					label: __("Delivery Address *"),
					reqd: 1,
					default: this.delivery_address || "",
				},
				{
					fieldname: "delivery_charges",
					fieldtype: "Currency",
					label: __("Delivery Fee (Rs)"),
					default: this.delivery_charges || 0,
				}
			],
			primary_action_label: __("Save Delivery Info"),
			primary_action: (values) => {
				const name = (values.customer_name || "").trim();
				const phone = (values.phone || "").trim();
				const addr = (values.delivery_address || "").trim();
				if (!name || !phone || !addr) {
					frappe.msgprint({
						title: __("Missing Information"),
						indicator: "orange",
						message: __("Customer Name, Phone number, and Delivery address are required for Delivery orders.")
					});
					return;
				}

				this.customer = name;
				this.delivery_phone = phone;
				this.delivery_address = addr;
				this.delivery_charges = flt(values.delivery_charges || 0);
				this.wrapper.find(".fpos-customer-label").text(this.customer);
				this.wrapper.find(".fpos-delivery-label").text(`${phone} (${addr.substring(0, 15)}...)`);

				if (this.active_tab_id && this.tabs[this.active_tab_id]) {
					const cur = this.tabs[this.active_tab_id];
					cur.delivery_phone = this.delivery_phone;
					cur.delivery_address = this.delivery_address;
					cur.delivery_charges = this.delivery_charges;
					cur.customer = this.customer;
				}

				d.hide();
				setTimeout(() => {
					$(".modal-backdrop").remove();
					$("body").removeClass("modal-open");
				}, 150);
				this.update_cart_summary();
				if (typeof callback === "function") {
					callback();
				}
			}
		});

		this.style_dialog(d);
		this.delivery_dialog = d;
		d.show();
	}

	// ─── 8. Full-Page Slide-In Payment & Invoicing ─────────────────────────────

	show_payment_page() {
		if (this.cart_items.length === 0) {
			frappe.show_alert({ message: __("Cart is empty"), indicator: "orange" });
			return;
		}

		if (this.order_type === "Dine In" && !this.selected_table) {
			frappe.show_alert({ message: __("Please select a table before settling."), indicator: "orange" });
			this.open_table_selector();
			return;
		}

		if (this.order_type === "Delivery" && (!this.delivery_phone || !this.delivery_address || !this.customer || this.customer === "Walk-in Customer")) {
			this.open_delivery_dialog(() => this.show_payment_page());
			return;
		}

		this.current_view = "payment";
		$(".modal:contains('Not found')").closest(".modal").remove();
		$(".modal-backdrop").remove();
		this.payment_tendered = flt(this.totals.grand_total);
		const methods = (this.profile_data && this.profile_data.payment_methods) || [{ mode_of_payment: "Cash", type: "Cash" }];
		this.selected_payment_mode = (this.preferred_payment_mode && methods.some((m) => m.mode_of_payment === this.preferred_payment_mode))
			? this.preferred_payment_mode : methods[0].mode_of_payment;

		this.render_payment_page();
		const $page = this.wrapper.find(".fpos-payment-page");
		$page.addClass("active");
	}

	hide_payment_page() {
		this.current_view = "pos";
		const $page = this.wrapper.find(".fpos-payment-page");
		$page.removeClass("active");
		setTimeout(() => {
			if (this.current_view !== "payment") {
				$page.empty();
			}
		}, 350);
	}

	render_payment_page() {
		const total = this.totals.grand_total;
		const currency = "PKR";
		const format_curr = (val) => this.format_money(val);
		const methods = (this.profile_data && this.profile_data.payment_methods) || [
			{ mode_of_payment: "Cash", icon: "cash" },
			{ mode_of_payment: "Credit Card", icon: "card" }
		];

		// Initialize split amounts: Default to full total on Cash (or first mode)
		this.payment_splits = {};
		let default_mode = (this.selected_payment_mode && methods.some((m) => m.mode_of_payment === this.selected_payment_mode))
			? this.selected_payment_mode : methods[0].mode_of_payment;
		methods.forEach((m) => {
			this.payment_splits[m.mode_of_payment] = 0;
			if (m.mode_of_payment.toLowerCase().includes("cash") || m.default) {
				default_mode = m.mode_of_payment;
			}
		});
		this.payment_splits[default_mode] = total;
		this.active_payment_mode = default_mode;

		const cart_rows = this.cart_items.map((it) => `
			<tr style="border-bottom:1px solid #f5efe4;">
				<td style="padding:6px 0;">
					<div style="font-weight:700;color:#292524;">${it.item_name}</div>
					${it.item_note ? `<div style="font-size:10px;color:#d97706;">${it.item_note}</div>` : ""}
				</td>
				<td style="padding:6px 10px;text-align:center;font-weight:700;color:#78716c;">${it.qty}</td>
				<td style="padding:6px 0;text-align:right;font-weight:700;color:#292524;">${format_curr(it.amount)}</td>
			</tr>
		`).join("");

		const mop_rows_html = methods.map((m) => {
			const mop = m.mode_of_payment;
			const icon = m.icon || (mop.toLowerCase().includes("cash") ? "cash" :
				mop.toLowerCase().includes("card") ? "card" :
				mop.toLowerCase().includes("bank") ? "card" : "qr");
			const is_active = mop === default_mode;
			const init_amt = flt(this.payment_splits[mop] || 0);

			return `
				<div class="fpos-split-row" data-mode="${mop}" style="background:#fff;border:2px solid ${is_active ? "#ea580c" : "#eadfd2"};border-radius:12px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;">
					<div style="display:flex;align-items:center;gap:10px;min-width:140px;">
						<span style="color:#ea580c;">${fpos_icon(icon)}</span>
						<div>
							<div style="font-weight:800;color:#292524;font-size:14px;">${mop}</div>
							<div style="font-size:11px;color:#78716c;">${m.type || "Payment"}</div>
						</div>
					</div>

					<div style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end;">
						<button type="button" class="btn btn-default btn-xs fpos-split-fill-btn" data-mode="${mop}" style="font-weight:700;font-size:11px;padding:4px 8px;border-radius:6px;background:#faf6f0;">
							${__("Exact")}
						</button>
						<button type="button" class="btn btn-default btn-xs fpos-split-clear-btn" data-mode="${mop}" style="font-weight:700;font-size:11px;padding:4px 8px;border-radius:6px;color:#ef4444;background:#faf6f0;">
							0
						</button>
						<div style="position:relative;width:150px;">
							<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:13px;font-weight:700;color:#78716c;">Rs</span>
							<input type="text" class="form-control fpos-split-input" data-mode="${mop}" style="font-size:16px;font-weight:900;text-align:right;padding-left:45px;height:42px;border-radius:8px;border:1.5px solid #d8cbb8;color:#292524;" value="${init_amt.toFixed(2)}" />
						</div>
					</div>
				</div>
			`;
		}).join("");

		const $page = this.wrapper.find(".fpos-payment-page");
		$page.html(`
			<!-- Top Page Header -->
			<div class="fpos-payment-header" style="background:#fff;border-bottom:1px solid #eadfd2;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,0.03);">
				<div style="display:flex;align-items:center;gap:14px;">
					<button class="btn btn-default fpos-pay-back-btn" style="display:inline-flex;align-items:center;gap:6px;font-weight:700;border-radius:8px;padding:8px 16px;">
						<span>←</span>
						<span>${__("Return to Order")}</span>
					</button>
					<div>
						<h3 style="margin:0;font-size:18px;font-weight:800;color:#292524;display:flex;align-items:center;gap:8px;">
							<span>${fpos_icon("card")}</span> ${__("Payment & Order Settlement")}
						</h3>
						<div style="font-size:12px;color:#78716c;margin-top:2px;">
							${this.branch ? `<b style="color:#ea580c;">${this.branch}</b> &bull; ` : ""}
							<span>${this.order_type}</span>
							${this.selected_table_no ? `&bull; <b>Table ${this.selected_table_no}</b>` : ""}
							&bull; <span>Customer: <b>${this.customer || "Walk-in Customer"}</b></span>
						</div>
					</div>
				</div>

				<div style="display:flex;align-items:center;gap:12px;">
					<div style="background:#ffedd5;border:1px solid #fed7aa;padding:8px 16px;border-radius:12px;text-align:right;">
						<span style="font-size:11px;color:#c2410c;font-weight:700;text-transform:uppercase;">${__("Amount Due")}</span>
						<div style="font-size:22px;font-weight:900;color:#ea580c;line-height:1.2;">${format_curr(total)}</div>
					</div>
				</div>
			</div>

			<!-- Main 2-Column Responsive Body -->
			<div style="max-width:1150px;margin:24px auto;width:100%;padding:0 24px;display:grid;grid-template-columns:1.25fr 0.85fr;gap:24px;">
				<!-- Left Column: Payment Modes, Split Inputs & Touch Keypad -->
				<div style="background:#fff;border-radius:16px;border:1px solid #eadfd2;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.04);display:flex;flex-direction:column;gap:18px;">
					<!-- 1. Quick Full Pay Pills -->
					<div>
						<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
							<label style="font-size:13px;font-weight:800;color:#44403c;margin:0;">${__("1. Quick 100% Payment")}</label>
							<span style="font-size:11px;color:#78716c;">${__("Sets entire bill to single mode")}</span>
						</div>
						<div class="fpos-quick-full-mops" style="display:flex;gap:8px;flex-wrap:wrap;">
							${methods.map(m => `
								<button type="button" class="btn btn-default btn-sm fpos-quick-full-btn" data-mode="${m.mode_of_payment}" style="font-weight:700;border-radius:8px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px;">
									<span>${fpos_icon(m.icon || "card", "fpos-ic-sm")}</span>
									<span>${m.mode_of_payment}</span>
								</button>
							`).join("")}
						</div>
					</div>

					<!-- 2. Split Payment Mode Rows -->
					<div>
						<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
							<label style="font-size:13px;font-weight:800;color:#44403c;margin:0;">${__("2. Payment Breakdown / Split")}</label>
							<span style="font-size:11px;color:#78716c;">${__("Enter split amounts across multiple modes")}</span>
						</div>
						<div class="fpos-split-mop-list" style="display:flex;flex-direction:column;gap:8px;">
							${mop_rows_html}
						</div>
					</div>

					<!-- 3. Active Mode Quick Cash Pills & Touch Keypad -->
					<div style="border-top:1px solid #f5efe4;padding-top:14px;">
						<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
							<label style="font-size:12px;font-weight:800;color:#44403c;margin:0;">
								${__("Numpad for:")} <span class="fpos-active-mode-label" style="color:#ea580c;font-weight:900;">${default_mode}</span>
							</label>
							<div class="fpos-cash-pills" style="display:flex;gap:6px;flex-wrap:wrap;">
								<button type="button" class="btn btn-default btn-xs fpos-cp fpos-cp-exact" data-exact="1" data-amt="${total}">${__("Exact")} (${format_curr(total)})</button>
								<button type="button" class="btn btn-default btn-xs fpos-cp" data-amt="50">+${format_curr(50)}</button>
								<button type="button" class="btn btn-default btn-xs fpos-cp" data-amt="100">+${format_curr(100)}</button>
								<button type="button" class="btn btn-default btn-xs fpos-cp" data-amt="500">+${format_curr(500)}</button>
							</div>
						</div>

						<div class="fpos-keypad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
							<button class="fpos-keypad-btn" data-key="1">1</button>
							<button class="fpos-keypad-btn" data-key="2">2</button>
							<button class="fpos-keypad-btn" data-key="3">3</button>
							<button class="fpos-keypad-btn" data-key="4">4</button>
							<button class="fpos-keypad-btn" data-key="5">5</button>
							<button class="fpos-keypad-btn" data-key="6">6</button>
							<button class="fpos-keypad-btn" data-key="7">7</button>
							<button class="fpos-keypad-btn" data-key="8">8</button>
							<button class="fpos-keypad-btn" data-key="9">9</button>
							<button class="fpos-keypad-btn" data-key="C" style="color:#ef4444;font-size:16px;">CLR</button>
							<button class="fpos-keypad-btn" data-key="0">0</button>
							<button class="fpos-keypad-btn" data-key=".">.</button>
						</div>
					</div>

					<!-- Order Line Items Review -->
					<div style="border-top:1px solid #f5efe4;padding-top:10px;">
						<details style="cursor:pointer;">
							<summary style="font-size:12px;font-weight:700;color:#78716c;user-select:none;">
								${fpos_icon("cart", "fpos-ic-sm")} ${__("Review Line Items")} (${this.cart_items.length} ${__("items")})
							</summary>
							<div style="margin-top:8px;max-height:140px;overflow-y:auto;">
								<table style="width:100%;font-size:12px;border-collapse:collapse;">
									<tbody>${cart_rows}</tbody>
								</table>
							</div>
						</details>
					</div>
				</div>

				<!-- Right Column: Settlement Confirmation Card -->
				<div style="display:flex;flex-direction:column;gap:16px;">
					<div style="background:#fff;border-radius:16px;border:1px solid #eadfd2;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.04);display:flex;flex-direction:column;gap:14px;">
						<div style="font-size:15px;font-weight:800;color:#292524;border-bottom:1px solid #f5efe4;padding-bottom:10px;">
							${__("Settlement Breakdown")}
						</div>

						<div style="display:flex;justify-content:space-between;font-size:13px;color:#78716c;">
							<span>${__("Subtotal")}</span>
							<strong style="color:#292524;">${format_curr(this.totals.subtotal)}</strong>
						</div>

						${this.totals.discount > 0 ? `
						<div style="display:flex;justify-content:space-between;font-size:13px;color:#ef4444;">
							<span>${__("Discount")}</span>
							<strong>-${format_curr(this.totals.discount)}</strong>
						</div>` : ""}
						<!-- v5.2: NO TAX line — Subtotal − Discount (Rs) + Delivery Fee only. -->

						<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;color:#292524;border-top:2px dashed #eadfd2;padding-top:10px;">
							<span>${__("Grand Total Due")}</span>
							<span style="color:#ea580c;">${format_curr(total)}</span>
						</div>

						<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:#292524;background:#faf6f0;padding:10px 14px;border-radius:10px;">
							<span>${__("Total Tendered")}</span>
							<span class="fpos-pay-summary-tendered">${format_curr(total)}</span>
						</div>

						<!-- Split Breakdown Badges -->
						<div class="fpos-split-summary-pills" style="display:flex;gap:6px;flex-wrap:wrap;"></div>

						<!-- Live Change or Shortage Display -->
						<div class="fpos-pay-change-card" style="background:#ffedd5;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;">
							<div>
								<div class="fpos-pay-change-title" style="font-size:11px;font-weight:700;color:#ea580c;text-transform:uppercase;">${__("Change to Return")}</div>
								<div class="fpos-pay-summary-change" style="font-size:20px;font-weight:900;color:#16a34a;">${format_curr(0)}</div>
							</div>
							<span class="fpos-pay-change-icon" style="color:#ea580c;">${fpos_icon("cash")}</span>
						</div>

						<!-- Customer POS Slip Toggle -->
						<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;color:#57534e;">
							<input type="checkbox" id="fpos-auto-print-slip" ${this.auto_print_slip ? "checked" : ""} style="width:16px;height:16px;accent-color:#ea580c;cursor:pointer;" />
							<label for="fpos-auto-print-slip" style="margin:0;cursor:pointer;font-weight:600;">${__("Generate & Print POS Slip on Settlement")}</label>
						</div>

						<!-- Complete Order & Settle Button -->
						<button class="btn btn-success fpos-confirm-payment-btn" style="background:#22c55e;border:none;font-size:15px;font-weight:800;padding:14px;border-radius:12px;margin-top:10px;box-shadow:0 4px 12px rgba(34,197,94,0.3);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
							<span>✓</span>
							<span class="fpos-confirm-btn-label">${__("Confirm & Settle Payment")}</span>
						</button>
					</div>
				</div>
			</div>
		`);

		this.bind_payment_page_events(methods, total, currency);
	}

	bind_payment_page_events(methods, total, currency) {
		const $page = this.wrapper.find(".fpos-payment-page");
		const format_curr = (val) => this.format_money(val);
		const default_mode = this.active_payment_mode || methods[0].mode_of_payment;

		const calculate_totals = () => {
			let total_tendered = 0;
			const pills = [];

			methods.forEach((m) => {
				const mop = m.mode_of_payment;
				const amt = flt(this.payment_splits[mop] || 0);
				total_tendered += amt;
				if (amt > 0) {
					pills.push(`
						<span style="font-size:11px;font-weight:700;background:#f5efe4;color:#44403c;border:1px solid #d8cbb8;padding:3px 8px;border-radius:6px;">
							${fpos_icon(m.icon || "card", "fpos-ic-sm")} ${mop}: <b>${format_curr(amt)}</b>
						</span>
					`);
				}
			});

			$page.find(".fpos-pay-summary-tendered").text(format_curr(total_tendered));
			$page.find(".fpos-split-summary-pills").html(pills.join(""));

			const diff = total_tendered - total;
			const $card = $page.find(".fpos-pay-change-card");
			const $title = $page.find(".fpos-pay-change-title");
			const $change_val = $page.find(".fpos-pay-summary-change");
			const $icon = $page.find(".fpos-pay-change-icon");
			const $confirm_btn = $page.find(".fpos-confirm-payment-btn");
			const $btn_label = $page.find(".fpos-confirm-btn-label");

			if (diff >= -0.001) {
				const change = Math.max(0, diff);
				$card.css({ background: "#ffedd5", borderColor: "#bbf7d0" });
				$title.css("color", "#ea580c").text(__("Change to Return"));
				$change_val.css("color", "#16a34a").text(format_curr(change));
				$icon.text("");
				$confirm_btn.prop("disabled", false).css({ background: "#22c55e", cursor: "pointer", opacity: 1 });
				$btn_label.text(__("Confirm & Settle Payment ({0})", [format_curr(total_tendered)]));
			} else {
				const shortage = Math.abs(diff);
				$card.css({ background: "#fee2e2", borderColor: "#fca5a5" });
				$title.css("color", "#b91c1c").text(__("Remaining Amount Due"));
				$change_val.css("color", "#b91c1c").text(`-${format_curr(shortage)}`);
				$icon.text("");
				$confirm_btn.prop("disabled", true).css({ background: "#a8a29e", cursor: "not-allowed", opacity: 0.7 });
				$btn_label.text(__("Remaining Due: {0}", [format_curr(shortage)]));
			}
		};

		// Set active mode for numpad and input styling
		const set_active_mode = (mop) => {
			this.active_payment_mode = mop;
			$page.find(".fpos-active-mode-label").text(mop);
			$page.find(".fpos-split-row").each(function () {
				const row_mode = $(this).data("mode");
				if (row_mode === mop) {
					$(this).css({ borderColor: "#ea580c", background: "#fffaf5" });
				} else {
					$(this).css({ borderColor: "#eadfd2", background: "#fff" });
				}
			});
		};

		// Row click activates that mode
		$page.find(".fpos-split-row").on("click", (e) => {
			if (!$(e.target).is("input") && !$(e.target).is("button")) {
				const mop = $(e.currentTarget).data("mode");
				set_active_mode(mop);
			}
		});

		// Split input typing
		$page.find(".fpos-split-input").on("focus", (e) => {
			const mop = $(e.currentTarget).data("mode");
			set_active_mode(mop);
		});

		$page.find(".fpos-split-input").on("input", (e) => {
			const mop = $(e.currentTarget).data("mode");
			const val = flt($(e.currentTarget).val());
			this.payment_splits[mop] = val;
			calculate_totals();
		});

		// Quick 100% full pay buttons
		$page.find(".fpos-quick-full-btn").on("click", (e) => {
			const mop = $(e.currentTarget).data("mode");
			methods.forEach((m) => {
				this.payment_splits[m.mode_of_payment] = m.mode_of_payment === mop ? total : 0;
				$page.find(`.fpos-split-input[data-mode="${m.mode_of_payment}"]`).val(
					this.payment_splits[m.mode_of_payment].toFixed(2)
				);
			});
			set_active_mode(mop);
			calculate_totals();
		});

		// "Exact Remaining" fill button on each row
		$page.find(".fpos-split-fill-btn").on("click", (e) => {
			e.stopPropagation();
			const mop = $(e.currentTarget).data("mode");
			let other_total = 0;
			methods.forEach((m) => {
				if (m.mode_of_payment !== mop) {
					other_total += flt(this.payment_splits[m.mode_of_payment] || 0);
				}
			});
			const rem = Math.max(0, total - other_total);
			this.payment_splits[mop] = rem;
			$page.find(`.fpos-split-input[data-mode="${mop}"]`).val(rem.toFixed(2));
			set_active_mode(mop);
			calculate_totals();
		});

		// "0" clear button on each row
		$page.find(".fpos-split-clear-btn").on("click", (e) => {
			e.stopPropagation();
			const mop = $(e.currentTarget).data("mode");
			this.payment_splits[mop] = 0;
			$page.find(`.fpos-split-input[data-mode="${mop}"]`).val("0.00");
			set_active_mode(mop);
			calculate_totals();
		});

		// Quick Cash Pills (applies to active mode, purely local calculation, no server request)
		$page.find(".fpos-cp").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			$(".modal:contains('Not found')").closest(".modal").remove();
			$(".modal-backdrop").remove();

			const $btn = $(e.currentTarget);
			const mop = this.active_payment_mode || default_mode;
			const is_exact = $btn.hasClass("fpos-cp-exact") || $btn.data("exact");
			const add_amt = flt($btn.data("amt") || 0);
			const current_val = flt(this.payment_splits[mop] || 0);

			if (is_exact) {
				this.payment_splits[mop] = total;
			} else {
				this.payment_splits[mop] = current_val + add_amt;
			}

			$page.find(`.fpos-split-input[data-mode="${mop}"]`).val(this.payment_splits[mop].toFixed(2));
			calculate_totals();
		});

		// Touch Keypad Handling (targets active mode input)
		$page.find(".fpos-keypad-btn").on("click", (e) => {
			const key = $(e.currentTarget).data("key");
			const mop = this.active_payment_mode || default_mode;
			const $inp = $page.find(`.fpos-split-input[data-mode="${mop}"]`);
			let current_val = $inp.val().toString();

			if (key === "C") {
				current_val = "";
			} else if (key === ".") {
				if (!current_val.includes(".")) {
					current_val = current_val === "" ? "0." : current_val + ".";
				}
			} else {
				if (current_val === "0" || current_val === "0.00") {
					current_val = key.toString();
				} else {
					current_val += key.toString();
				}
			}

			$inp.val(current_val);
			this.payment_splits[mop] = flt(current_val);
			calculate_totals();
		});

		// Auto Print Slip Checkbox
		$page.find("#fpos-auto-print-slip").on("change", (e) => {
			this.auto_print_slip = $(e.target).is(":checked");
		});

		// Return to Order
		$page.find(".fpos-pay-back-btn").on("click", () => {
			this.hide_payment_page();
		});

		// Confirm & Settle Order
		$page.find(".fpos-confirm-payment-btn").on("click", async () => {
			let total_tendered = 0;
			const resolved_payments = [];

			methods.forEach((m) => {
				const mop = m.mode_of_payment;
				const amt = flt(this.payment_splits[mop] || 0);
				if (amt > 0) {
					resolved_payments.push({
						mode_of_payment: mop,
						amount: amt,
					});
					total_tendered += amt;
				}
			});

			if (total_tendered < total - 0.001) {
				frappe.msgprint({
					title: __("Insufficient Payment"),
					indicator: "red",
					message: __("Amount tendered ({0}) is less than the total order amount due ({1}).", [format_curr(total_tendered), format_curr(total)])
				});
				return;
			}

			this.hide_payment_page();
			await this.process_invoice_submission(resolved_payments);
		});

		// Initial calculation
		calculate_totals();
	}

	async process_invoice_submission(payments) {
		const order_payload = {
			order_type: this.order_type,
			table: this.selected_table || (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]?.table) || "",
			table_no: this.selected_table_no || (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]?.table_no) || "",
			linked_kot_id: this.linked_kot_id || (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]?.linked_kot_id) || null,
			// Round 23 fix: the settle joins KOTs by this token only.
			order_id: this.pos_order_id || (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]?.pos_order_id) || null,
			customer: this.customer,
			phone: this.delivery_phone || "",
			delivery_address: this.delivery_address || "",
			delivery_charges: flt(this.delivery_charges || 0),
			pos_profile: this.pos_profile,
			pos_opening_entry: this.pos_opening,
			discount_percentage: this.discount_percentage,
			discount_amount: this.discount_amount,
			discount_approved_by: this.discount_approved_by || null,
			discount_manager_pin: this.discount_manager_pin || null,
			manager_pin: this.discount_manager_pin || null,
			order_note: this.order_note,
			items: this.cart_items,
			draft_invoice_name: (this.active_tab_id && this.tabs[this.active_tab_id] && this.tabs[this.active_tab_id].draft_invoice_name) || null,
		};

		if (!this.is_online) {
			this.queue_offline_invoice(order_payload, payments);
			return;
		}

		try {
			frappe.dom.freeze(__("Generating POS Invoice..."));
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.submit_pos_invoice",
				args: {
					order_data: order_payload,
					payments: payments,
				},
			});
			frappe.dom.unfreeze();

			const inv = res.message.invoice;
			// BILL RULE v3: this is the FIRST time the customer gets a bill —
			// payment is made, so the pending banner goes away here.
			this.hide_pending_banner();
			frappe.show_alert({ message: __("Invoice {0} Submitted!", [inv]), indicator: "green" });

			const receipt_data = res.message.receipt_data || res.message;
			this.show_pos_slip(receipt_data, true);

			// Immediately prepend to recent orders cache so Recent panel updates without reload
			const resolved_order_type = receipt_data.order_type || receipt_data.custom_order_type || order_payload.order_type || "Takeaway";
			const resolved_table = receipt_data.table_no || receipt_data.custom_table || receipt_data.table || order_payload.table || "";
			const new_order_entry = {
				name: inv,
				doctype: (res.message && res.message.doctype) || "Sales Invoice",
				posting_date: receipt_data.posting_date,
				posting_time: this.format_time_hh_mm(receipt_data.posting_time),
				customer: receipt_data.customer,
				customer_name: receipt_data.customer_name || receipt_data.customer,
				grand_total: receipt_data.grand_total,
				paid_amount: receipt_data.paid_amount,
				outstanding_amount: 0,
				status: "Paid",
				order_type: resolved_order_type,
				custom_order_type: resolved_order_type,
				table_no: resolved_table,
				custom_table: resolved_table,
				custom_restaurant_table: resolved_table,
				items: receipt_data.items || [],
				item_summary: (receipt_data.items || []).map(i => `${i.qty}x ${i.item_name}`).join(", ")
			};
			this.recent_orders = [new_order_entry, ...(this.recent_orders || []).filter(o => o.name !== inv)];
			this.render_recent_orders(this.recent_orders);

			// Finalize and remove active tab
			this.linked_kot_id = null;
			this.pos_order_id = null;
			const closed_tab_id = this.active_tab_id;
			delete this.tabs[closed_tab_id];

			const remaining = Object.keys(this.tabs);
			if (remaining.length > 0) {
				this.switch_tab(remaining[0]);
			} else {
				this.clear_cart();
				this.selected_table = null;
				this.selected_table_no = "";
				this.wrapper.find(".fpos-table-label").text(__("Select Table"));
				this.create_new_tab("Dine In", null, "", true);
			}

			this.render_tab_bar();

			// Reset auto print slip checkbox to unchecked after each settle
			this.auto_print_slip = false;
			this.wrapper.find("#fpos-auto-print-slip").prop("checked", false);
			$("#fpos-auto-print-slip").prop("checked", false);

			// Invalidate kitchen drawer cache and refresh if drawer is currently open
			this.active_kots = [];
			const $kitchenDrawer = this.wrapper ? this.wrapper.find(".fpos-kitchen-drawer") : $(".fpos-kitchen-drawer");
			if ($kitchenDrawer.hasClass("active")) {
				this.show_kitchen_drawer();
			} else {
				if (this.wrapper) this.wrapper.find(".fpos-kitchen-body").empty();
				$(".fpos-kitchen-body").empty();
			}

			// Refresh live kitchen status in case table tickets were served
			this.refresh_kitchen_badge();
			this.refresh_exceptions_badge();
		} catch (err) {
			frappe.dom.unfreeze();
			console.warn("Server submission failed. Queuing offline.", err);
			this.queue_offline_invoice(order_payload, payments);
		}
	}

	// ─── 8.1 Customer POS Slip Generator & Thermal Printer ────────────────────

	show_pos_slip(receipt_data, is_settlement = false) {
		if (!receipt_data) return;
		const $container = this.wrapper.find(".fpos-slip-modal-container");
		const currency = "PKR";
		const format_curr = (val) => this.format_money(val);
		const change_due = flt(receipt_data.change_amount) || Math.max(0, flt(receipt_data.paid_amount) - flt(receipt_data.grand_total));

		const items_html = (receipt_data.items || []).map(i => `
			<tr style="border-bottom: 1px dashed #d8cbb8;">
				<td style="padding: 4px 0; text-align: left; vertical-align: top;">
					<div style="font-weight: 700;">${i.item_name}</div>
					${i.item_note ? `<div style="font-size: 10px; color: #78716c; font-style: italic;">* ${i.item_note}</div>` : ""}
				</td>
				<td style="padding: 4px 6px; text-align: center; vertical-align: top;">${i.qty}</td>
				<td style="padding: 4px 6px; text-align: right; vertical-align: top;">${format_curr(i.rate)}</td>
				<td style="padding: 4px 0; text-align: right; font-weight: 700; vertical-align: top;">${format_curr(i.amount)}</td>
			</tr>
		`).join("");

		const payments_html = (receipt_data.payments || []).map(p => `
			<div style="display: flex; justify-content: space-between; font-size: 12px;">
				<span>${p.mode_of_payment}:</span>
				<span>${format_curr(p.amount)}</span>
			</div>
		`).join("") || `
			<div style="display: flex; justify-content: space-between; font-size: 12px;">
				<span>Paid Amount:</span>
				<span>${format_curr(receipt_data.paid_amount || receipt_data.grand_total)}</span>
			</div>
		`;

		$container.html(`
			<div class="fpos-slip-modal-overlay">
				<div class="fpos-slip-card" style="position: relative;">
					<div class="fpos-slip-close-icon" style="position: absolute; top: 12px; right: 14px; cursor: pointer; font-size: 18px; color: #a8a29e; line-height: 1; padding: 4px;" title="${__("Close (Esc)")}">✕</div>

					${is_settlement ? `
					<div style="text-align: center; margin-bottom: 12px;">
						<div style="width: 54px; height: 54px; border-radius: 50%; background: #dcfce7; color: #16a34a; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: 900; margin: 0 auto 6px;">✓</div>
						<div style="font-size: 17px; font-weight: 900; color: #16a34a;">${__("Payment Successful")}</div>
						<div style="font-size: 12px; color: #78716c;">${__("Invoice")} ${receipt_data.invoice}</div>
					</div>` : ""}

					<div style="text-align: center; margin-bottom: 8px;">
						<div style="font-size: 20px; font-weight: 900; color: #292524;">${receipt_data.company || "FOOD POS RESTAURANT"}</div>
						<div style="font-size: 11px; color: #78716c;">${receipt_data.branch ? `<b style="color:#ea580c;">${receipt_data.branch}</b> &bull; ` : ""}${receipt_data.pos_profile || this.pos_profile} &bull; Register Receipt</div>
						<div style="font-size: 11px; color: #78716c;">${receipt_data.posting_date || ""} ${this.format_time_hh_mm(receipt_data.posting_time)}</div>
					</div>

					<div class="fpos-slip-divider"></div>

					<div style="font-size: 11px; display: flex; flex-direction: column; gap: 2px;">
						<div style="display: flex; justify-content: space-between;">
							<span>Invoice #:</span>
							<strong style="color: #292524;">${receipt_data.invoice}</strong>
						</div>
						${receipt_data.kot_numbers && receipt_data.kot_numbers.length ? `
						<div style="display: flex; justify-content: space-between;">
							<span>KOT #:</span>
							<strong>${receipt_data.kot_numbers.join(", ")}</strong>
						</div>` : ""}
						${flt(receipt_data.outstanding_amount) > 0 ? `
						<div style="display: flex; justify-content: space-between; background: #fef3c7; color: #92400e; font-weight: 800; padding: 4px 6px; border-radius: 4px; margin-top: 4px;">
							<span>⏳ PENDING PAYMENT:</span>
							<span>${format_curr(receipt_data.outstanding_amount)}</span>
						</div>` : ""}
						<div style="display: flex; justify-content: space-between;">
							<span>Order Type:</span>
							<strong>${receipt_data.order_type || receipt_data.custom_order_type || "Takeaway"}${this.format_table_label(receipt_data.table_no || receipt_data.custom_table || receipt_data.table) ? ` (${this.format_table_label(receipt_data.table_no || receipt_data.custom_table || receipt_data.table)})` : ""}</strong>
						</div>
						<div style="display: flex; justify-content: space-between;">
							<span>Customer:</span>
							<span>${receipt_data.customer_name || receipt_data.customer || "Walk-in"}</span>
						</div>
						${receipt_data.phone ? `
						<div style="display: flex; justify-content: space-between;">
							<span>Contact:</span>
							<span><b>${receipt_data.phone}</b></span>
						</div>` : ""}
						${receipt_data.delivery_address ? `
						<div style="display: flex; justify-content: space-between;">
							<span>Delivery Address:</span>
							<span style="max-width:180px;text-align:right;">${receipt_data.delivery_address}</span>
						</div>` : ""}
					</div>

					<div class="fpos-slip-divider"></div>

					<table style="width: 100%; font-size: 11px; border-collapse: collapse;">
						<thead>
							<tr style="border-bottom: 1px solid #292524; text-transform: uppercase; font-size: 10px;">
								<th style="text-align: left; padding: 2px 0;">Item</th>
								<th style="text-align: center; padding: 2px 6px;">Qty</th>
								<th style="text-align: right; padding: 2px 6px;">Rate</th>
								<th style="text-align: right; padding: 2px 0;">Amt</th>
							</tr>
						</thead>
						<tbody>
							${items_html}
						</tbody>
					</table>

					<div class="fpos-slip-divider"></div>

					<div style="display: flex; flex-direction: column; gap: 3px; font-size: 11px;">
						<div style="display: flex; justify-content: space-between;">
							<span>Subtotal:</span>
							<span>${format_curr(receipt_data.net_total || receipt_data.subtotal || receipt_data.grand_total)}</span>
						</div>
						${flt(receipt_data.discount_amount) > 0 ? `
						<div style="display: flex; justify-content: space-between; color: #b91c1c;">
							<span>Discount:</span>
							<span>-${format_curr(receipt_data.discount_amount)}</span>
						</div>` : ""}
						<!-- v5.2: NO TAX on the receipt. -->
						${flt(receipt_data.delivery_charges) > 0 ? `
						<div style="display: flex; justify-content: space-between; color: #0284c7;">
							<span>Delivery Fee:</span>
							<span>+${format_curr(receipt_data.delivery_charges)}</span>
						</div>` : ""}
						<div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 900; border-top: 1px solid #292524; padding-top: 4px; margin-top: 2px;">
							<span>TOTAL DUE:</span>
							<span>${format_curr(receipt_data.grand_total)}</span>
						</div>
					</div>

					<div class="fpos-slip-divider"></div>

					<div style="display: flex; flex-direction: column; gap: 3px;">
						${payments_html}
						${change_due > 0 ? `
						<div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; color: #ea580c; background: #ffedd5; padding: 4px 6px; border-radius: 4px; margin-top: 4px;">
							<span>Change Due:</span>
							<span>${format_curr(change_due)}</span>
						</div>` : ""}
					</div>

					<div class="fpos-slip-divider"></div>

					<div style="text-align: center; margin-top: 10px; font-size: 11px; color: #78716c;">
						<p style="margin: 0; font-weight: 700; color: #292524;">Thank you for dining with us!</p>
						<p style="margin: 2px 0 0;">Please visit us again.</p>
						<div style="letter-spacing: 4px; font-size: 16px; margin-top: 8px; color: #a8a29e;">|||| | ||||| || ||||||</div>
					</div>

					<!-- Slip Actions -->
					<div style="display: flex; gap: 8px; margin-top: 16px;">
						<button class="btn btn-default fpos-close-slip-btn" style="flex: 1; font-weight: 700; border-radius: 8px; cursor: pointer;">
							${is_settlement ? __("Next Order (Close)") : __("Close")}
						</button>
						<button class="btn btn-primary fpos-print-slip-btn" style="flex: 1; font-weight: 700; background: #ea580c; border-color: #ea580c; border-radius: 8px; cursor: pointer;">
							${fpos_icon("printer", "fpos-ic-sm")} ${__("Print Slip")}
						</button>
					</div>
				</div>
			</div>
		`).show();

		const dismiss_receipt = () => {
			$(document).off("keydown.fpos_slip");
			$(document).off("click.fpos_slip_close");
			$(document).off("click.fpos_slip_overlay");
			$container.hide().empty();
			$(".fpos-slip-modal-container").hide().empty();
			$(".modal-backdrop").remove();
			$("body").removeClass("modal-open");
			frappe.dom.unfreeze();

			if (is_settlement) {
				const has_other_non_empty_tab = Object.values(this.tabs).some(t => t.cart_items && t.cart_items.length > 0);
				if (!has_other_non_empty_tab) {
					this.tabs = {};
					this.active_tab_id = null;
					this.clear_cart();
					this.selected_table = null;
					this.selected_table_no = "";
					this.wrapper.find(".fpos-table-label").text(__("Select Table"));
					this.create_new_tab("Dine In", null, "", true);
				} else {
					this.clear_cart();
					const remaining = Object.keys(this.tabs);
					if (remaining.length > 0) {
						this.switch_tab(remaining[0]);
					} else {
						this.create_new_tab("Dine In", null, "", true);
					}
				}
				this.render_tab_bar();
				this.render_cart_items();
				this.update_cart_summary();
				this.update_order_type_ui();
			}
		};

		// 1-Click Dismissal Handlers: Local and Document-level delegation
		$container.find(".fpos-close-slip-btn, .fpos-slip-close-icon").on("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			dismiss_receipt();
		});

		$(document).off("click.fpos_slip_close").on("click.fpos_slip_close", ".fpos-close-slip-btn, .fpos-slip-close-icon", (e) => {
			e.preventDefault();
			e.stopPropagation();
			dismiss_receipt();
		});

		$container.find(".fpos-slip-modal-overlay").on("click", (e) => {
			if ($(e.target).hasClass("fpos-slip-modal-overlay")) {
				e.preventDefault();
				e.stopPropagation();
				dismiss_receipt();
			}
		});

		$(document).off("click.fpos_slip_overlay").on("click.fpos_slip_overlay", ".fpos-slip-modal-overlay", (e) => {
			if ($(e.target).hasClass("fpos-slip-modal-overlay")) {
				e.preventDefault();
				e.stopPropagation();
				dismiss_receipt();
			}
		});

		$(document).off("keydown.fpos_slip").on("keydown.fpos_slip", (e) => {
			if (e.key === "Escape" || e.keyCode === 27) {
				e.preventDefault();
				e.stopPropagation();
				dismiss_receipt();
			}
		});

		$container.find(".fpos-print-slip-btn").off("click.fpos_print").on("click.fpos_print", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.print_pos_slip(receipt_data);
		});

		// Defer auto-print to next tick so receipt modal is fully interactive and listeners are active
		if (this.auto_print_slip) {
			this.auto_print_slip = false;
			setTimeout(() => {
				this.print_pos_slip(receipt_data);
			}, 100);
		}
	}

	// ─── v5.11: one-tab print preview ─────────────────────────────
	// Every print (bill, KOT slip, Z-report) opens ONE centered dialog
	// in this tab — no new tab, no popup window, no auto print dialog.
	// Print runs window.print() (user-initiated, so the dialog is
	// expected) and @media print shows ONLY the slip (.fpos-print-area).
	show_print_preview({ title, subtitle, body_html, wide = false }) {
		this.close_print_preview();
		const $overlay = $(`
			<div class="fpos-print-preview-overlay">
				<div class="fpos-print-preview">
					<div class="fpos-print-preview-header">
						<div class="fpos-print-preview-title">
							<span class="fpos-print-preview-icon">${fpos_icon("printer")}</span>
							<div>
								<div class="fpos-print-preview-name">${title || __("Print Preview")}</div>
								${subtitle ? `<div class="fpos-print-preview-sub">${subtitle}</div>` : ""}
							</div>
						</div>
						<button class="fpos-print-preview-close" title="${__("Close")}">✕</button>
					</div>
					<div class="fpos-print-preview-paper">
						<div class="fpos-print-area ${wide ? "fpos-print-a4" : ""}">${body_html}</div>
					</div>
					<div class="fpos-print-preview-footer">
						<button class="fpos-print-preview-cancel">${__("Close")}</button>
						<button class="fpos-print-preview-print">${fpos_icon("printer", "fpos-ic-sm")} ${__("Print")}</button>
					</div>
				</div>
			</div>`);
		$overlay.on("click", (e) => {
			if ($(e.target).hasClass("fpos-print-preview-overlay")) this.close_print_preview();
		});
		$overlay.find(".fpos-print-preview-close, .fpos-print-preview-cancel").on("click", () => this.close_print_preview());
		$overlay.find(".fpos-print-preview-print").on("click", () => window.print());
		$(document).off("keydown.fpos_print_preview").on("keydown.fpos_print_preview", (e) => {
			if (e.key === "Escape" || e.keyCode === 27) this.close_print_preview();
		});
		$("body").append($overlay);
	}

	close_print_preview() {
		$(".fpos-print-preview-overlay").remove();
		$(document).off("keydown.fpos_print_preview");
	}

	print_pos_slip(receipt_data) {
		if (!receipt_data) return;
		const now = Date.now();
		if (this._last_print_time && (now - this._last_print_time < 1500)) {
			console.warn("print_pos_slip: Duplicate print request suppressed within 1500ms");
			return;
		}
		this._last_print_time = now;

		// Briefly disable print buttons to prevent rapid double-clicks
		const $btn = this.wrapper ? this.wrapper.find(".fpos-print-slip-btn") : $(".fpos-print-slip-btn");
		if ($btn && $btn.length) {
			$btn.prop("disabled", true).css("opacity", "0.6");
			setTimeout(() => {
				$btn.prop("disabled", false).css("opacity", "1");
			}, 1500);
		}

		const currency = "PKR";
		const format_curr = (val) => this.format_money(val);

		const items_html = (receipt_data.items || []).map(i => `
			<tr>
				<td style="padding: 2px 0; text-align: left;">
					<div>${i.item_name}</div>
					${i.item_note ? `<div style="font-size: 10px; color: #555;">* ${i.item_note}</div>` : ""}
				</td>
				<td style="padding: 2px; text-align: center;">${i.qty}</td>
				<td style="padding: 2px; text-align: right;">${format_curr(i.rate)}</td>
				<td style="padding: 2px 0; text-align: right;">${format_curr(i.amount)}</td>
			</tr>
		`).join("");

		// v5.11: a fragment, not a full document — it renders inside the
		// centered print-preview dialog (.fpos-print-area carries the
		// thermal styles from food_pos.css). No new tab any more.
		const body_html = `
				<div class="text-center bold" style="font-size:15px;">${receipt_data.company || "FOOD POS RESTAURANT"}</div>
				<div class="text-center" style="font-size:11px;">${receipt_data.pos_profile || ""}</div>
				<div class="text-center" style="font-size:10px;">${receipt_data.posting_date || ""} ${this.format_time_hh_mm(receipt_data.posting_time)}</div>
				<div class="divider"></div>
				<div class="row"><span>Invoice:</span><span class="bold">${receipt_data.invoice}</span></div>
				${receipt_data.kot_numbers && receipt_data.kot_numbers.length ? `<div class="row"><span>KOT #:</span><span class="bold">${receipt_data.kot_numbers.join(", ")}</span></div>` : ""}
				<div class="row"><span>Order:</span><span>${receipt_data.order_type || receipt_data.custom_order_type || "Takeaway"}${this.format_table_label(receipt_data.table_no || receipt_data.custom_table || receipt_data.table) ? ` (${this.format_table_label(receipt_data.table_no || receipt_data.custom_table || receipt_data.table)})` : ""}</span></div>
				<div class="row"><span>Customer:</span><span>${receipt_data.customer_name || receipt_data.customer || "Walk-in"}</span></div>
				<div class="divider"></div>
				<table>
					<thead>
						<tr style="border-bottom: 1px solid #000;">
							<th style="text-align: left;">Item</th>
							<th style="text-align: center;">Qty</th>
							<th style="text-align: right;">Rate</th>
							<th style="text-align: right;">Amt</th>
						</tr>
					</thead>
					<tbody>${items_html}</tbody>
				</table>
				<div class="divider"></div>
				<div class="row"><span>Subtotal:</span><span>${format_curr(receipt_data.net_total || receipt_data.subtotal || receipt_data.grand_total)}</span></div>
				${flt(receipt_data.discount_amount) > 0 ? `<div class="row"><span>Discount:</span><span>-${format_curr(receipt_data.discount_amount)}</span></div>` : ""}
				<!-- v5.2: NO TAX on the thermal receipt. -->
				${flt(receipt_data.delivery_charges) > 0 ? `<div class="row"><span>Delivery Fee:</span><span>${format_curr(receipt_data.delivery_charges)}</span></div>` : ""}
				<div class="row bold" style="font-size:14px; margin-top: 4px;"><span>GRAND TOTAL:</span><span>${format_curr(receipt_data.grand_total)}</span></div>
				${flt(receipt_data.outstanding_amount) > 0 ? `<div class="row bold" style="font-size:13px; color:#92400e;"><span>PENDING PAYMENT:</span><span>${format_curr(receipt_data.outstanding_amount)}</span></div>` : ""}
				<div class="divider"></div>
				<div class="row"><span>Paid Amount:</span><span>${format_curr(receipt_data.paid_amount || receipt_data.grand_total)}</span></div>
				${(flt(receipt_data.change_amount) || Math.max(0, flt(receipt_data.paid_amount) - flt(receipt_data.grand_total))) > 0 ? `<div class="row bold" style="font-size:13px; color:#ea580c;"><span>Change Due:</span><span>${format_curr(flt(receipt_data.change_amount) || Math.max(0, flt(receipt_data.paid_amount) - flt(receipt_data.grand_total)))}</span></div>` : ""}
				<div class="divider"></div>
				<div class="text-center" style="margin-top: 10px; font-size: 11px;">
					<p style="margin: 0;" class="bold">Thank you for dining with us!</p>
					<p style="margin: 2px 0;">Please visit again.</p>
				</div>
		`;

		this.show_print_preview({
			title: __("Receipt"),
			subtitle: receipt_data.invoice || "",
			body_html,
		});
	}

	// ─── 8.2 Recent Orders & Customers Drawer (Last 10 Customers with Edit Ability)

	async load_recent_orders() {
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_recent_pos_orders",
				args: {
					pos_profile: this.pos_profile || (this.profile_data && this.profile_data.name) || "",
					limit: 15,
				},
				freeze: false,
			});
			const orders = res.message || [];
			this.recent_orders = orders;
			this.render_recent_orders(orders);
			return orders;
		} catch (e) {
			console.warn("Could not load recent orders:", e);
			return [];
		}
	}

	async show_recent_orders_drawer() {
		const branch_name = FPOS_SINGLE_BRANCH;
		const d = new frappe.ui.Dialog({
			title: __("Recent Customer Orders — {0}", [branch_name]),
			size: "large",
		});

		const body = $(d.wrapper).find(".modal-body");
		if (this.recent_orders && this.recent_orders.length > 0) {
			this.render_recent_orders_in_dialog(this.recent_orders, body, d);
		} else {
			body.html(`
				<div style="display:flex;justify-content:center;align-items:center;height:180px;flex-direction:column;gap:10px;">
					<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #eadfd2;border-top-color:#ea580c;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
					<span style="color:#78716c;font-size:13px;">${__("Loading recent orders...")}</span>
				</div>
			`);
		}
		this.style_dialog(d);
		d.show();

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_recent_pos_orders",
				args: {
					pos_profile: this.pos_profile || (this.profile_data && this.profile_data.name) || "",
					limit: 15,
				},
				freeze: false,
			});
			const orders = res.message || [];
			this.recent_orders = orders;
			this.render_recent_orders_in_dialog(orders, body, d);
			this.render_recent_orders(orders);
		} catch (e) {
			console.error("Failed to load recent orders:", e);
			if (!this.recent_orders || this.recent_orders.length === 0) {
				body.html(`<div style="text-align:center;padding:30px;color:#ef4444;">${__("Failed to load recent orders")}</div>`);
			}
		}
	}

	hide_recent_orders_drawer() {
		this.wrapper.find(".fpos-recent-drawer").removeClass("active");
		this.wrapper.find(".fpos-drawer-overlay").removeClass("active");
		$(".fpos-recent-drawer").removeClass("active");
		$(".fpos-drawer-overlay").removeClass("active");
		frappe.dom.unfreeze();
		$(".modal-backdrop").remove();
		$("body").removeClass("modal-open");
	}

	render_recent_orders_in_dialog(orders, $body, d) {
		$body.empty();

		if (!orders || orders.length === 0) {
			$body.html(`
				<div style="text-align:center;padding:50px 20px;color:#a8a29e;">
					<div style="margin-bottom:8px;color:#a8a29e;">${fpos_icon("receipt")}</div>
					<div style="font-weight:600;font-size:14px;color:#78716c;">${__("No recent customer orders today")}</div>
					<p style="font-size:12px;margin-top:4px;">${__("Completed POS invoices will appear here.")}</p>
				</div>
			`);
			return;
		}

		const $container = $('<div style="display:flex;flex-direction:column;gap:10px;max-height:65vh;overflow-y:auto;padding-right:4px;"></div>');

		orders.forEach((o, index) => {
			const format_curr = (val) => this.format_money(val);
			const is_paid = flt(o.outstanding_amount) <= 0.001;
			const status_badge = is_paid
				? `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;">PAID</span>`
				: `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;">UNPAID</span>`;

			const items_preview = (o.items || []).map(i => `${i.qty}x ${i.item_name}`).join(", ");
			const raw_tbl = o.table_no || o.custom_table || o.custom_restaurant_table || "";
			const recent_tbl_label = this.format_table_label(raw_tbl);

			const card = $(`
				<div class="fpos-recent-card" data-idx="${index}">
					<div style="display:flex;justify-content:space-between;align-items:flex-start;">
						<div>
							<div style="font-weight:800;font-size:14px;color:#292524;">${o.name}</div>
							<div style="font-size:12px;color:#292524;font-weight:600;margin-top:2px;">
								${fpos_icon("user", "fpos-ic-sm")} ${o.customer_name || o.customer || "Walk-in"}
							</div>
							<div style="font-size:11px;color:#78716c;margin-top:2px;">
								${o.order_type || o.custom_order_type || "Takeaway"}${recent_tbl_label ? ` &bull; ${recent_tbl_label}` : ""} &bull; ${this.format_time_hh_mm(o.posting_time)}
							</div>
						</div>
						<div style="text-align:right;">
							<div style="font-weight:800;font-size:15px;color:#ea580c;">${format_curr(o.grand_total)}</div>
							<div style="margin-top:4px;">${status_badge}</div>
						</div>
					</div>

					<div style="font-size:11px;color:#57534e;background:#faf6f0;padding:6px 10px;border-radius:6px;line-height:1.4;">
						<b style="color:#292524;">${o.items_count || (o.items || []).length} items:</b> ${items_preview || "Items ordered"}
					</div>

					<!-- Restaurant Actions: Edit / Reload to Cart & Print Slip -->
					<div style="display:flex;gap:8px;margin-top:4px;border-top:1px dashed #eadfd2;padding-top:8px;">
						<button class="btn btn-default btn-xs fpos-reload-order-btn" style="flex:1;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:4px;color:#2563eb;background:#eff6ff;border-color:#bfdbfe;border-radius:6px;padding:6px 10px;">
							<span>${fpos_icon("edit", "fpos-ic-sm")}</span>
							<span>${__("Edit / Reload Cart")}</span>
						</button>
						<button class="btn btn-default btn-xs fpos-view-slip-btn" style="font-weight:600;display:inline-flex;align-items:center;gap:4px;border-radius:6px;padding:6px 10px;">
							<span>${fpos_icon("printer", "fpos-ic-sm")}</span>
							<span>${__("POS Slip")}</span>
						</button>
					</div>
				</div>
			`);

			// Reload into active cart for modifications
			card.find(".fpos-reload-order-btn").on("click", () => {
				if (d) d.hide();
				this.reload_order_to_cart(o);
			});

			// View & print slip
			card.find(".fpos-view-slip-btn").on("click", async () => {
				try {
					frappe.dom.freeze(__("Fetching POS slip data..."));
					const res = await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.get_invoice_slip_data",
						args: { invoice_name: o.name, doctype: o.doctype },
					});
					frappe.dom.unfreeze();
					if (res.message) {
						this.show_pos_slip(res.message);
					}
				} catch (err) {
					frappe.dom.unfreeze();
					frappe.msgprint(__("Could not load slip data: {0}", [err.message]));
				}
			});

			$container.append(card);
		});

		$body.append($container);
	}

	render_recent_orders(orders) {
		const $body = this.wrapper.find(".fpos-recent-body");
		if ($body.length) {
			this.render_recent_orders_in_dialog(orders, $body, null);
		}
		// v5: the same data feeds the home "Recent Orders" strip.
		this.render_home_recent_orders();
	}

	reload_order_to_cart(order) {
		const load = () => {
			this.cart_items = (order.items || []).map(i => ({
				item_code: i.item_code,
				item_name: i.item_name,
				qty: flt(i.qty) || 1,
				rate: flt(i.rate) || 0,
				amount: flt(i.amount) || (flt(i.rate) * (flt(i.qty) || 1)),
				item_note: i.item_note || "",
				uom: i.uom || "Nos",
				item_image: i.item_image || "",
			}));

			this.customer = order.customer || "";
			this.order_type = order.custom_order_type || "Dine In";
			this.selected_table = order.custom_restaurant_table || null;
			this.selected_table_no = order.custom_restaurant_table || "";

			// Update Order Type UI (tabs, table/delivery fields)
			this.update_order_type_ui();

			this.wrapper.find(".fpos-customer-label").text(order.customer_name || order.customer || __("Walk-in Customer"));

			this.render_cart_items();
			this.update_cart_summary();
			this.hide_recent_orders_drawer();

			frappe.show_alert({
				message: __("Order {0} reloaded into cart! You can modify items, add more food, or re-settle.", [order.name]),
				indicator: "green",
			});
		};

		if (this.cart_items.length > 0) {
			frappe.confirm(
				__("Your active cart has items. Replace active cart with Customer Order {0} to edit?", [order.name]),
				() => load()
			);
		} else {
			load();
		}
	}

	// ─── 8.3 Live Kitchen Order Tracking Drawer (Checklist & Remaining Items) ──

	async show_kitchen_drawer() {
		const $drawer = this.wrapper.find(".fpos-kitchen-drawer");
		const $overlay = this.wrapper.find(".fpos-drawer-overlay");
		const $body = $drawer.find(".fpos-kitchen-body");

		$overlay.addClass("active");
		$drawer.addClass("active");
		$body.html(`
			<div style="display:flex;justify-content:center;align-items:center;height:200px;flex-direction:column;gap:10px;">
				<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #eadfd2;border-top-color:#ea580c;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#78716c;font-size:13px;">${__("Loading active kitchen tickets...")}</span>
			</div>
		`);

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_active_kitchen_kots",
				args: {
					pos_profile: this.pos_profile,
					branch: this.branch,
					station: this.kitchen_station_filter || "All",
				},
				freeze: false,
				quiet: true,
				error: () => {},
			});
			const kots = res.message || [];
			this.active_kots = kots;
			this.render_kitchen_kots(kots);
			this.update_kitchen_badge(kots);
		} catch (e) {
			$body.html(`
				<div style="text-align:center;padding:30px;color:#ef4444;">
					<div style="margin-bottom:8px;color:#a8a29e;">${fpos_icon("chef", "fpos-ic-lg")}</div>
					<div style="font-weight:600;">${__("Failed to load kitchen tickets")}</div>
					<button class="btn btn-default btn-xs fpos-retry-kitchen-btn" style="margin-top:10px;font-weight:700;">${fpos_icon("refresh", "fpos-ic-sm")} ${__("Retry")}</button>
				</div>
			`);
			$body.find(".fpos-retry-kitchen-btn").on("click", () => this.show_kitchen_drawer());
		}
	}

	hide_kitchen_drawer() {
		this.wrapper.find(".fpos-kitchen-drawer").removeClass("active");
		this.wrapper.find(".fpos-drawer-overlay").removeClass("active");
		$(".fpos-kitchen-drawer").removeClass("active");
		$(".fpos-drawer-overlay").removeClass("active");
		frappe.dom.unfreeze();
		$(".modal-backdrop").remove();
		$("body").removeClass("modal-open");
	}

	// ─── v5.12: Pending Payments drawer ───────────────────────────
	// The answer to "the customer waited, the food is ready, now where
	// does the cashier print the pending bill from?" — the sidebar
	// Pending item (with a live count badge) opens this drawer: every
	// confirmed-but-unpaid order with its amount, ready to settle or to
	// print the bill. The bill itself is only final at payment; the
	// Print Bill slip is the unpaid check (PENDING PAYMENT, no paid amount).
	async show_pending_drawer() {
		const $drawer = this.wrapper.find(".fpos-pending-drawer");
		const $overlay = this.wrapper.find(".fpos-drawer-overlay");
		const $body = $drawer.find(".fpos-pending-body");

		this.wrapper.find(".fpos-kitchen-drawer, .fpos-held-drawer").removeClass("active");
		$overlay.addClass("active");
		$drawer.addClass("active");
		$body.html(`
			<div style="display:flex;justify-content:center;align-items:center;height:200px;flex-direction:column;gap:10px;">
				<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #eadfd2;border-top-color:#ea580c;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#78716c;font-size:13px;">${__("Loading pending payments...")}</span>
			</div>
		`);

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_active_kitchen_kots",
				args: { pos_profile: this.pos_profile, branch: this.branch },
				freeze: false,
				quiet: true,
				error: () => {},
			});
			const kots = res.message || [];
			this.pending_kots = kots;
			this.render_pending_kots(kots);
			this.update_kitchen_badge(kots);
		} catch (e) {
			$body.html(`
				<div style="text-align:center;padding:30px;color:#ef4444;">
					<div style="margin-bottom:8px;color:#a8a29e;">${fpos_icon("receipt", "fpos-ic-lg")}</div>
					<div style="font-weight:600;">${__("Failed to load pending payments")}</div>
					<button class="btn btn-default btn-xs fpos-retry-pending-btn" style="margin-top:10px;font-weight:700;">${fpos_icon("refresh", "fpos-ic-sm")} ${__("Retry")}</button>
				</div>
			`);
			$body.find(".fpos-retry-pending-btn").on("click", () => this.show_pending_drawer());
		}
	}

	hide_pending_drawer() {
		this.wrapper.find(".fpos-pending-drawer").removeClass("active");
		this.wrapper.find(".fpos-drawer-overlay").removeClass("active");
		$(".fpos-pending-drawer").removeClass("active");
		$(".fpos-drawer-overlay").removeClass("active");
		frappe.dom.unfreeze();
		$(".modal-backdrop").remove();
		$("body").removeClass("modal-open");
	}

	render_pending_kots(kots) {
		const $body = this.wrapper.find(".fpos-pending-body");
		$body.empty();

		if (!kots || kots.length === 0) {
			$body.html(`
				<div style="text-align:center;padding:50px 20px;color:#a8a29e;">
					<div style="margin-bottom:8px;color:#a8a29e;">${fpos_icon("receipt", "fpos-ic-lg")}</div>
					<div style="font-weight:600;font-size:14px;color:#78716c;">${__("No pending payments")}</div>
					<p style="font-size:12px;margin-top:4px;">${__("When a kitchen order is waiting for payment, it will appear here with its bill amount.")}</p>
				</div>
			`);
			return;
		}

		const grand = kots.reduce((s, k) => s + flt(k.total || 0), 0);
		$body.append(`
			<div style="display:flex;justify-content:space-between;align-items:center;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;">
				<span style="font-size:13px;font-weight:700;color:#92400e;">${__("{0} pending bill(s)", [kots.length])}</span>
				<span style="font-size:14px;font-weight:800;color:#92400e;">${__("Total Due")} ${this.format_money(grand)}</span>
			</div>
		`);

		kots.forEach((kot) => {
			const status_colors = {
				Pending: { bg: "#fef9c3", text: "#854d0e" },
				"In Progress": { bg: "#dbeafe", text: "#1d4ed8" },
				Ready: { bg: "#dcfce7", text: "#166534" },
			};
			const sc = status_colors[kot.status] || { bg: "#f5efe4", text: "#57534e" };
			const items = kot.items || [];
			const shown = items.slice(0, 3).map((it) => `${it.qty}× ${it.item_name}`).join(", ");
			const more = items.length > 3 ? ` +${items.length - 3} more` : "";

			const card = $(`
				<div class="fpos-recent-card" data-kot="${kot.name}" style="border-left: 4px solid #d97706;">
					<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
						<div>
							<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
								<span style="font-weight:800;font-size:14px;color:#292524;">${kot.name}</span>
								<span style="background:${sc.bg};color:${sc.text};padding:2px 7px;border-radius:10px;font-size:10px;font-weight:800;text-transform:uppercase;">${kot.status}</span>
							</div>
							<div style="font-size:11px;color:#78716c;margin-top:3px;">
								<span>${kot.order_type || "Dine In"}</span>
								${kot.table_no ? `&bull; <b>Table ${kot.table_no}</b>` : ""}
								${kot.customer ? `&bull; ${kot.customer}` : ""}
								&bull; <span>${kot.time_ago || ""}</span>
							</div>
						</div>
						<div style="text-align:right;flex-shrink:0;">
							<div style="font-size:11px;color:#92400e;font-weight:700;">${__("TOTAL DUE")}</div>
							<div style="font-size:18px;font-weight:800;color:#ea580c;">${this.format_money(kot.total || 0)}</div>
						</div>
					</div>
					<div style="font-size:12px;color:#57534e;">${shown}${more}</div>
					<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
						<button class="btn btn-default btn-xs fpos-pending-print-btn" data-kot="${kot.name}" style="font-weight:700;background:#faf6f0;color:#44403c;border-color:#d8cbb8;border-radius:6px;padding:5px 12px;">${fpos_icon("printer", "fpos-ic-sm")} ${__("Print Bill")}</button>
						<button class="btn btn-default btn-xs fpos-pending-settle-btn" data-kot="${kot.name}" style="font-weight:700;background:#ea580c;color:#fff;border-color:#ea580c;border-radius:6px;padding:5px 12px;">${__("Settle & Print Bill")}</button>
					</div>
				</div>
			`);
			card.find(".fpos-pending-settle-btn").on("click", async (e) => {
				const kot_id = $(e.currentTarget).data("kot");
				this.hide_pending_drawer();
				await this.resume_kot_for_payment(kot_id);
			});
			card.find(".fpos-pending-print-btn").on("click", (e) => {
				const kot_id = $(e.currentTarget).data("kot");
				const target = (this.pending_kots || []).find((k) => k.name === kot_id) || kot;
				this.print_pending_bill(target);
			});
			$body.append(card);
		});
	}

	// Print the bill of a confirmed-but-unpaid order (the "check"): the
	// customer sees the amount before paying. No paid amount on it — the
	// final receipt prints at settle (Settle & Print Bill).
	print_pending_bill(kot) {
		if (!kot) return;
		const format_curr = (val) => this.format_money(val);
		const items_html = (kot.items || []).map((i) => `
			<tr>
				<td style="padding: 2px 0; text-align: left;">${i.item_name}</td>
				<td style="padding: 2px; text-align: center;">${i.qty}</td>
				<td style="padding: 2px; text-align: right;">${format_curr(i.rate || 0)}</td>
				<td style="padding: 2px 0; text-align: right;">${format_curr(i.amount || 0)}</td>
			</tr>
		`).join("");
		const body_html = `
				<div class="text-center bold" style="font-size:15px;">${(this.profile_data && this.profile_data.company) || kot.pos_profile || "FOOD POS RESTAURANT"}</div>
				<div class="text-center" style="font-size:11px;">${kot.pos_profile || ""}</div>
				<div class="text-center" style="font-size:10px;">${new Date().toLocaleString()}</div>
				<div class="divider"></div>
				<div class="row"><span>KOT #:</span><span class="bold">${kot.name}</span></div>
				<div class="row"><span>Order:</span><span>${kot.order_type || "Dine In"}${kot.table_no ? ` (Table ${kot.table_no})` : ""}</span></div>
				<div class="row"><span>Customer:</span><span>${kot.customer || "Walk-in"}</span></div>
				<div class="divider"></div>
				<table>
					<thead>
						<tr style="border-bottom: 1px solid #000;">
							<th style="text-align: left;">Item</th>
							<th style="text-align: center;">Qty</th>
							<th style="text-align: right;">Rate</th>
							<th style="text-align: right;">Amt</th>
						</tr>
					</thead>
					<tbody>${items_html}</tbody>
				</table>
				<div class="divider"></div>
				<div class="row"><span>Subtotal:</span><span>${format_curr(kot.total || 0)}</span></div>
				<div class="row bold" style="font-size:14px; margin-top: 4px;"><span>TOTAL DUE:</span><span>${format_curr(kot.total || 0)}</span></div>
				<div class="row bold" style="font-size:13px; color:#92400e;"><span>PENDING PAYMENT</span><span>${format_curr(kot.total || 0)}</span></div>
				<div class="divider"></div>
				<div class="text-center" style="margin-top: 10px; font-size: 11px;">
					<p style="margin: 0;" class="bold">Please pay at the counter.</p>
					<p style="margin: 2px 0;">Thank you for dining with us!</p>
				</div>
		`;
		this.show_print_preview({
			title: __("Bill — Pending Payment"),
			subtitle: kot.name || "",
			body_html,
		});
	}

	render_kitchen_kots(kots) {
		const $body = this.wrapper.find(".fpos-kitchen-body");
		$body.empty();

		if (!kots || kots.length === 0) {
			$body.html(`
				<div style="text-align:center;padding:50px 20px;color:#a8a29e;">
					<div style="margin-bottom:8px;color:#a8a29e;">${fpos_icon("chef", "fpos-ic-lg")}</div>
					<div style="font-weight:600;font-size:14px;color:#78716c;">${__("No pending kitchen tickets")}</div>
					<p style="font-size:12px;margin-top:4px;">${__("When orders are sent to kitchen, they will appear here with live preparation status.")}</p>
				</div>
			`);
			return;
		}

		kots.forEach((kot) => {
			const status_colors = {
				Pending: { bg: "#fef9c3", text: "#854d0e", border: "#facc15" },
				"In Progress": { bg: "#dbeafe", text: "#1d4ed8", border: "#60a5fa" },
				Ready: { bg: "#dcfce7", text: "#166534", border: "#4ade80" },
			};
			const sc = status_colors[kot.status] || { bg: "#f5efe4", text: "#57534e", border: "#d8cbb8" };

			const items_list = (kot.items || []).map((it) => {
				const is_done = Boolean(it.is_done);
				return `
					<div class="fpos-kot-item-row" data-kot="${kot.name}" data-item="${it.item_name}" data-row="${it.name || ''}" style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #f5efe4;${is_done ? "opacity:0.5;text-decoration:line-through;" : ""}">
						<input type="checkbox" class="fpos-kot-item-check" data-kot="${kot.name}" data-item="${it.item_name}" data-row="${it.name || ''}" ${is_done ? "checked" : ""} style="width:16px;height:16px;accent-color:#22c55e;cursor:pointer;margin-top:2px;" />
						<div style="flex:1;">
							<div style="display:flex;justify-content:space-between;align-items:center;">
								<span style="font-weight:700;font-size:13px;color:#292524;">${it.qty}x ${it.item_name}</span>
								${is_done ? `<span style="font-size:10px;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:8px;font-weight:700;">DONE</span>` : `<span style="font-size:10px;background:#fef3c7;color:#b45309;padding:1px 6px;border-radius:8px;font-weight:700;">COOKING</span>`}
							</div>
							${it.item_note ? `<div style="font-size:11px;color:#ea580c;background:#ffedd5;padding:2px 6px;border-radius:4px;margin-top:3px;display:inline-block;">${it.item_note}</div>` : ""}
						</div>
					</div>
				`;
			}).join("");

			// Action buttons based on status
			let stage_btn = "";
			if (kot.status === "Pending") {
				stage_btn = `<button class="btn btn-default btn-xs fpos-kot-stage-btn" data-kot="${kot.name}" data-stage="In Progress" style="font-weight:700;background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;border-radius:6px;padding:5px 12px;">▶ ${__("Start Cooking")}</button>`;
			} else if (kot.status === "In Progress") {
				stage_btn = `<button class="btn btn-default btn-xs fpos-kot-stage-btn" data-kot="${kot.name}" data-stage="Ready" style="font-weight:700;background:#ffedd5;color:#ea580c;border-color:#bbf7d0;border-radius:6px;padding:5px 12px;">${fpos_icon("check", "fpos-ic-sm")} ${__("Mark Ready")}</button>`;
			} else if (kot.status === "Ready") {
				stage_btn = `<button class="btn btn-default btn-xs fpos-kot-stage-btn" data-kot="${kot.name}" data-stage="Served" style="font-weight:700;background:#faf6f0;color:#44403c;border-color:#d8cbb8;border-radius:6px;padding:5px 12px;">${fpos_icon("check", "fpos-ic-sm")} ${__("Mark Served")}</button>`;
			}

			const card = $(`
				<div class="fpos-recent-card" data-kot="${kot.name}" style="border-left: 4px solid ${sc.border};">
					<div style="display:flex;justify-content:space-between;align-items:flex-start;">
						<div>
							<div style="display:flex;align-items:center;gap:6px;">
								<span style="font-weight:800;font-size:14px;color:#292524;">${kot.name}</span>
								<span style="background:${sc.bg};color:${sc.text};padding:2px 7px;border-radius:10px;font-size:10px;font-weight:800;text-transform:uppercase;">
									${kot.status}
								</span>
								${kot.kitchen_station ? `<span style="background:#e0f2fe;color:#0369a1;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;">${kot.kitchen_station.split("-").pop()}</span>` : ""}
							</div>
							<div style="font-size:11px;color:#78716c;margin-top:3px;">
								<span>${kot.order_type || "Dine In"}</span>
								${kot.table_no ? `&bull; <b>Table ${kot.table_no}</b>` : ""}
								&bull; <span>${kot.time_ago || (kot.creation ? frappe.datetime.prettyDate(kot.creation) : "Just now")}</span>
							</div>
						</div>

						<div style="text-align:right;">
							<div style="font-size:12px;font-weight:800;color:${kot.status !== "Ready" && kot.remaining_items > 0 ? "#ea580c" : "#166534"};background:${kot.status !== "Ready" && kot.remaining_items > 0 ? "#ffedd5" : "#dcfce7"};padding:4px 8px;border-radius:8px;">
								${kot.status !== "Ready" && kot.remaining_items > 0 ? `${kot.remaining_items} of ${kot.total_items} left` : `✓ All Ready`}
							</div>
						</div>
					</div>

					<!-- Remaining items alert indicator -->
					${kot.status !== "Ready" && kot.remaining_items > 0 ? `
						<div style="font-size:11px;font-weight:600;color:#c2410c;background:#ffedd5;padding:4px 8px;border-radius:6px;">
							${__("{0} cooking item(s) remaining for this ticket", [kot.remaining_items])}
						</div>
					` : ""}

					<!-- Checklist of items -->
					<div style="display:flex;flex-direction:column;gap:2px;margin:4px 0;">
						${items_list}
					</div>

					<!-- Bottom Controls: Stage transition, Settle & Print Bill -->
					<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed #eadfd2;padding-top:8px;">
						<span style="font-size:11px;color:#a8a29e;">${kot.customer || "Walk-in"}</span>
						<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
							${stage_btn}
							<button class="btn btn-default btn-xs fpos-kot-print-btn" data-kot="${kot.name}" style="font-weight:700;background:#faf6f0;color:#44403c;border-color:#d8cbb8;border-radius:6px;padding:5px 12px;">${fpos_icon("printer", "fpos-ic-sm")} ${__("Print")}</button>
							<button class="btn btn-default btn-xs fpos-kot-settle-btn" data-kot="${kot.name}" style="font-weight:700;background:#ea580c;color:#fff;border-color:#ea580c;border-radius:6px;padding:5px 12px;">${__("Settle & Print Bill")}</button>
						</div>
					</div>
				</div>
			`);

			// Item done checkbox handler
			card.find(".fpos-kot-item-check").on("change", async (e) => {
				const is_checked = $(e.target).is(":checked");
				const item_name = $(e.target).data("item");
				const row_id = $(e.target).data("row");
				const kot_id = $(e.target).data("kot");

				try {
					await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.update_kot_item_done_status",
						args: {
							kot_name: kot_id,
							item_name: item_name,
							row_id: row_id,
							is_done: is_checked ? 1 : 0,
						},
					});
					frappe.show_alert({
						message: is_checked ? __("Item marked ready!") : __("Item marked cooking"),
						indicator: "green",
					});
					await this.show_kitchen_drawer();
					this.refresh_kitchen_badge();
				} catch (err) {
					frappe.msgprint(__("Error updating item: {0}", [err.message]));
				}
			});

			// Stage advance button
			card.find(".fpos-kot-stage-btn").on("click", async (e) => {
				const next_stage = $(e.currentTarget).data("stage");
				const kot_id = $(e.currentTarget).data("kot");

				try {
					frappe.dom.freeze(__("Updating stage..."));
					await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.update_kot_stage",
						args: { kot_name: kot_id, status: next_stage },
					});
					frappe.dom.unfreeze();
					frappe.show_alert({ message: __("KOT updated to {0}", [next_stage]), indicator: "green" });
					this.show_kitchen_drawer();
				} catch (err) {
					frappe.dom.unfreeze();
					frappe.msgprint(__("Could not update stage: {0}", [err.message]));
				}
			});

			// v5.10: paper KOT slip on demand (manual Print button inside the
			// slip tab) — never auto-printed, so the counter never blocks.
			card.find(".fpos-kot-print-btn").on("click", (e) => {
				const kot_id = $(e.currentTarget).data("kot");
				this.open_kot_slip(
					{ kot_name: kot_id, order_id: kot.order_id || "" },
					{
						order_type: kot.order_type,
						table: kot.table || "",
						order_note: kot.order_note || "",
						items: (kot.items || []).map((it) => ({
							item_code: it.item_code,
							item_name: it.item_name,
							qty: it.qty,
							item_note: it.item_note || "",
						})),
					}
				);
			});

			// v5.9: settle an open KOT — loads its items back into the cart
			// and opens payment, so a confirmed-but-unpaid ticket can always
			// be billed (even after a reload wiped the cart).
			card.find(".fpos-kot-settle-btn").on("click", async (e) => {
				const kot_id = $(e.currentTarget).data("kot");
				await this.resume_kot_for_payment(kot_id);
			});

			$body.append(card);
		});
	}

	// v5.9: bill a confirmed KOT — reload its items into the cart and open
	// the payment screen. Used from the Live Kitchen Orders drawer.
	async resume_kot_for_payment(kot_name) {
		if (!kot_name) return;
		const load = async () => {
			try {
				frappe.dom.freeze(__("Loading kitchen ticket..."));
				const res = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_kot_for_payment",
					args: { kot_name },
					freeze: false,
				});
				frappe.dom.unfreeze();
				const data = res.message || {};
				if (!data.items || !data.items.length) {
					frappe.msgprint(__("Kitchen ticket {0} has no items to bill.", [kot_name]));
					return;
				}
				this.hide_kitchen_drawer();
				this.cart_items = data.items.map((it) => ({
					item_code: it.item_code,
					item_name: it.item_name,
					qty: flt(it.qty),
					rate: flt(it.rate),
					amount: flt(it.amount),
					uom: it.uom || "Nos",
					item_note: it.item_note || "",
				}));
				this.order_type = data.order_type || "Walk In";
				this.selected_table = data.table || null;
				this.selected_table_no = (data.table || "").split("-").pop().trim() || "";
				this.linked_kot_id = kot_name;
				this.pos_order_id = data.order_id || null;
				this.customer = data.customer || this.customer;
				this.order_note = data.order_note || "";
				this.order_confirmed = true;
				this.payment_pending = true;
				this.show_pending_banner(kot_name);
				this.update_order_type_ui();
				this.render_cart_items();
				this.update_cart_summary();
				this.render_items_grid();
				if (this.active_tab_id && this.tabs[this.active_tab_id]) {
					this.tabs[this.active_tab_id].order_confirmed = true;
					this.tabs[this.active_tab_id].payment_status = "Pending";
					this.sync_current_cart_to_active_tab();
				}
				this.render_tab_bar();
				this.save_cart_backup();
				this.show_payment_page();
			} catch (e) {
				frappe.dom.unfreeze();
				frappe.msgprint(__("Could not load kitchen ticket: {0}", [e.message]));
			} finally {
				this._force_unfreeze();
			}
		};
		if (this.cart_items.length > 0 && this.linked_kot_id !== kot_name) {
			frappe.confirm(
				__("Your active cart has items. Replace it with kitchen ticket {0} to bill it?", [kot_name]),
				() => load()
			);
		} else {
			await load();
		}
	}

	update_kitchen_badge(kots) {
		const count = (kots || []).length;
		const $badge = this.wrapper.find(".fpos-kot-badge");
		const $pill = this.wrapper.find(".fpos-kitchen-count-pill");

		$pill.text(`${count} active`);
		if (count > 0) {
			$badge.text(count).show();
		} else {
			$badge.hide();
		}
		// v5.12: the same active KOTs are the pending bills — the sidebar
		// Pending badge and the drawer count pill ride the same poll.
		const $pending = this.wrapper.find(".fpos-pending-badge");
		const $pendingPill = this.wrapper.find(".fpos-pending-count-pill");
		$pendingPill.text(`${count} pending`);
		$pending.text(count).css("display", count > 0 ? "flex" : "none");
	}

	start_kitchen_polling() {
		if (this.kitchen_poll_interval) {
			clearInterval(this.kitchen_poll_interval);
		}

		this.refresh_kitchen_badge();
		this.refresh_held_badge();
		this.refresh_exceptions_badge();
		this.kitchen_poll_interval = setInterval(() => {
			this.refresh_kitchen_badge();
			this.refresh_held_badge();
			this.refresh_exceptions_badge();
		}, 5000);
	}

	async refresh_kitchen_badge() {
		if (!this.pos_profile || !this.is_online) return;
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_active_kitchen_kots",
				args: { pos_profile: this.pos_profile, branch: this.branch },
				freeze: false,
				quiet: true,
				error: () => {},
			});
			const kots = res.message || [];
			this.update_kitchen_badge(kots);
		} catch (e) {
			// Silent background polling
		}
	}

	async refresh_exceptions_badge() {
		if (!this.pos_profile || !this.is_online) return;
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_served_kot_exceptions",
				args: { pos_profile: this.pos_profile, branch: this.branch },
				freeze: false,
				quiet: true,
				error: () => {},
			});
			const count = (res.message && res.message.count) || 0;
			const $badge = this.wrapper.find(".fpos-exceptions-badge");
			if (count > 0) {
				$badge.text(count).show();
			} else {
				$badge.hide();
			}
		} catch (e) {}
	}

	async show_served_kot_exceptions_dialog() {
		const branch_name = FPOS_SINGLE_BRANCH;
		const d = new frappe.ui.Dialog({
			title: __("Served KOT Exceptions (Manager Review) — {0}", [branch_name]),
			size: "large",
		});

		const body = $(d.wrapper).find(".modal-body");
		body.html(`
			<div style="display:flex;justify-content:center;align-items:center;height:180px;flex-direction:column;gap:10px;">
				<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #eadfd2;border-top-color:#dc2626;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#78716c;font-size:13px;">${__("Loading served KOT exceptions...")}</span>
			</div>
		`);
		this.style_dialog(d);
		d.show();

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_served_kot_exceptions",
				args: { pos_profile: this.pos_profile, branch: this.branch },
			});
			const data = res.message || { count: 0, exceptions: [] };
			this.render_served_kot_exceptions_in_dialog(data, body, d);
			this.refresh_exceptions_badge();
		} catch (e) {
			body.html(`<div style="text-align:center;padding:30px;color:#ef4444;">${__("Failed to load exceptions")}</div>`);
		}
	}

	render_served_kot_exceptions_in_dialog(data, $body, d) {
		$body.empty();
		const exceptions = data.exceptions || [];

		if (!exceptions || exceptions.length === 0) {
			$body.html(`
				<div style="text-align:center;padding:50px 20px;color:#ea580c;">
					<div style="margin-bottom:8px;color:#ea580c;">${fpos_icon("checkCircle")}</div>
					<div style="font-weight:800;font-size:15px;color:#c2410c;">${__("All Served KOTs Fully Settled")}</div>
					<p style="font-size:12px;color:#78716c;margin-top:4px;">${__("No un-invoiced or un-voided kitchen tickets found. Shift data integrity intact.")}</p>
				</div>
			`);
			return;
		}

		const $container = $('<div style="display:flex;flex-direction:column;gap:12px;max-height:65vh;overflow-y:auto;padding-right:4px;"></div>');
		$container.append(`
			<div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:10px 14px;font-size:12px;color:#9f1239;line-height:1.4;">
				<b>Safeguard Warning:</b> The following kitchen tickets were marked <b>Served</b> but have no linked submitted invoice or manager void. Under restaurant policy, every served order must either be billed or voided with Manager PIN.
			</div>
		`);

		const format_curr = (val) => this.format_money(val);

		exceptions.forEach((ex) => {
			const items_str = (ex.items || []).map(i => `${i.qty}x ${i.item_name} (${format_curr(i.rate)})`).join(", ");
			const card = $(`
				<div class="fpos-exception-card" style="background:#fff;border:1.5px solid #fca5a5;border-left:5px solid #dc2626;border-radius:10px;padding:14px;box-shadow:0 2px 6px rgba(0,0,0,0.04);">
					<div style="display:flex;justify-content:space-between;align-items:flex-start;">
						<div>
							<div style="display:flex;align-items:center;gap:8px;">
								<span style="font-weight:900;font-size:15px;color:#292524;">${ex.name}</span>
								<span style="background:${(ex.status || '').includes('Mismatch') ? '#fef3c7' : '#fee2e2'};color:${(ex.status || '').includes('Mismatch') ? '#92400e' : '#b91c1c'};padding:2px 8px;border-radius:12px;font-size:10.5px;font-weight:800;">${(ex.status || 'Served (Uninvoiced)').toUpperCase()}</span>
							</div>
							<div style="font-size:12px;color:#57534e;margin-top:3px;font-weight:600;">
								${ex.branch} &bull; ${ex.order_type}${ex.table && ex.table !== 'N/A' ? ` &bull; Table ${ex.table_no}` : ''} &bull; ${ex.customer}
							</div>
							<div style="font-size:11px;color:#dc2626;font-weight:700;margin-top:2px;">
								⏱️ Elapsed: ${ex.time_ago} (${ex.elapsed_mins} mins ago)
							</div>
						</div>
						<div style="text-align:right;">
							<div style="font-size:11px;color:#78716c;font-weight:600;">Estimated Value</div>
							<div style="font-size:16px;font-weight:900;color:#ea580c;">${format_curr(ex.estimated_total)}</div>
						</div>
					</div>

					<div style="margin-top:10px;padding:8px 12px;background:#faf6f0;border-radius:6px;font-size:12px;color:#292524;border:1px dashed #eadfd2;">
						<b>Items Ordered:</b> ${items_str || "None"}
						${ex.sales_invoice ? `<div style="margin-top:4px;"><b>Linked invoice:</b> ${ex.sales_invoice}${(ex.invoice_item_rows || []).length ? ` — billed: ${(ex.invoice_item_rows || []).map(i => `${i.qty}x ${i.item_name}`).join(", ")}` : ''}</div>` : ''}
					</div>

					<div style="display:flex;gap:10px;margin-top:12px;border-top:1px solid #f5efe4;padding-top:10px;">
						<button class="btn btn-default btn-xs fpos-settle-kot-btn" style="flex:1;background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;font-weight:700;padding:6px 12px;border-radius:6px;">
							<span>${fpos_icon("card", "fpos-ic-sm")} ${__("Load to Cart & Settle")}</span>
						</button>
						<button class="btn btn-danger btn-xs fpos-void-kot-btn" style="background:#dc2626;color:#fff;font-weight:700;padding:6px 12px;border-radius:6px;">
							<span>${fpos_icon("trash", "fpos-ic-sm")} ${__("Manager Void (PIN)")}</span>
						</button>
					</div>
				</div>
			`);

			// Load to Cart & Settle action
			card.find(".fpos-settle-kot-btn").on("click", () => {
				this.cart_items = (ex.items || []).map(i => ({
					item_code: i.item_code,
					item_name: i.item_name,
					qty: flt(i.qty) || 1,
					rate: flt(i.rate) || 0,
					amount: flt(i.amount) || (flt(i.rate) * flt(i.qty)),
					item_note: i.item_note || "",
					uom: "Nos"
				}));
				this.order_type = ex.order_type || "Dine In";
				this.selected_table = ex.table && ex.table !== "N/A" ? ex.table : null;
				this.selected_table_no = ex.table_no && ex.table_no !== "N/A" ? ex.table_no : "";
				this.render_cart_items();
				this.update_cart_summary();
				this.update_order_type_ui();
				d.hide();
				frappe.show_alert({
					message: __("KOT {0} loaded into active cart! Ready for checkout and settlement.", [ex.name]),
					indicator: "green"
				});
			});

			// Manager Void Action
			card.find(".fpos-void-kot-btn").on("click", () => {
				const void_d = new frappe.ui.Dialog({
					title: __("Authorized Manager Void — {0}", [ex.name]),
					fields: [
						{
							fieldname: "info",
							fieldtype: "HTML",
							options: `
								<div style="padding:4px 0 10px;font-size:12px;color:#78716c;line-height:1.4;">
									You are recording an authorized void for <b>${ex.name}</b> (${format_curr(ex.estimated_total)}).
									This trace will be permanently recorded in the <b>Food POS Audit Log</b>.
								</div>
							`
						},
						{
							fieldname: "manager_pin",
							fieldtype: "Password",
							label: __("Manager PIN *"),
							reqd: 1
						},
						{
							fieldname: "reason",
							fieldtype: "Small Text",
							label: __("Mandatory Void Reason *"),
							reqd: 1
						}
					],
					primary_action_label: __("Confirm Manager Void"),
					primary_action: async (v) => {
						try {
							frappe.dom.freeze(__("Recording Manager Void..."));
							const vres = await frappe.call({
								method: "foodpos.foodpos.page.food_pos.food_pos.void_served_kot",
								args: {
									kot_name: ex.name,
									manager_pin: v.manager_pin,
									reason: v.reason
								}
							});
							frappe.dom.unfreeze();
							if (vres.message && vres.message.success) {
								frappe.show_alert({ message: vres.message.message, indicator: "green" });
								void_d.hide();
								d.hide();
								this.show_served_kot_exceptions_dialog();
							}
						} catch (err) {
							frappe.dom.unfreeze();
							frappe.msgprint(err.message || __("Void authorization failed."));
						}
					}
				});
				void_d.show();
			});

			$container.append(card);
		});

		$body.append($container);
	}

	// ─── 8.4 Held Orders Management ──────────────────────────────────────────

	async show_held_orders_drawer() {
		const $drawer = this.wrapper.find(".fpos-held-drawer");
		const $overlay = this.wrapper.find(".fpos-drawer-overlay");
		const $body = $drawer.find(".fpos-held-body");

		$overlay.addClass("active");
		$drawer.addClass("active");
		// Synchronize held badge immediately with drawer opening
		if (this.held_orders && this.held_orders.length) {
			this.update_held_badge(this.held_orders);
		} else {
			this.refresh_held_badge();
		}
		$body.html(`
			<div style="display:flex;justify-content:center;align-items:center;height:200px;flex-direction:column;gap:10px;">
				<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #eadfd2;border-top-color:#b45309;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#78716c;font-size:13px;">${__("Loading held orders...")}</span>
			</div>
		`);

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_held_orders",
				args: { branch: this.branch, pos_profile: this.pos_profile },
			});
			const orders = res.message || [];
			this.held_orders = orders;
			this.render_held_orders(orders);
			this.update_held_badge(orders);
		} catch (e) {
			$body.html(`<div style="text-align:center;padding:30px;color:#ef4444;">${__("Failed to load held orders")}</div>`);
		}
	}

	hide_held_orders_drawer() {
		this.wrapper.find(".fpos-held-drawer").removeClass("active");
		this.wrapper.find(".fpos-drawer-overlay").removeClass("active");
		$(".fpos-held-drawer").removeClass("active");
		$(".fpos-drawer-overlay").removeClass("active");
		frappe.dom.unfreeze();
		$(".modal-backdrop").remove();
		$("body").removeClass("modal-open");
		this.refresh_held_badge();
	}

	render_held_orders(orders) {
		const $body = this.wrapper.find(".fpos-held-body");
		$body.empty();
		const format_curr = (val) => this.format_money(val);

		if (!orders || orders.length === 0) {
			$body.html(`
				<div style="text-align:center;padding:50px 20px;color:#a8a29e;">
					<div style="margin-bottom:8px;color:#a8a29e;">${fpos_icon("pause")}</div>
					<div style="font-weight:600;font-size:14px;color:#78716c;">${__("No held orders")}</div>
					<p style="font-size:12px;margin-top:4px;">${__("When you put an order on hold, it will appear here so you can resume it later.")}</p>
				</div>
			`);
			return;
		}

		orders.forEach((o) => {
			let order_data = {};
			try {
				order_data = JSON.parse(o.order_data || "{}");
			} catch (e) {}

			const items = order_data.items || order_data.cart_items || [];
			const items_preview = items.map(i => `${i.qty}x ${i.item_name || i.item_code}`).join(", ");
			let order_total = flt(o.grand_total);
			if (order_total <= 0 && items.length > 0) {
				order_total = items.reduce((sum, it) => sum + (flt(it.amount) || (flt(it.qty || 1) * flt(it.rate || 0))), 0);
			}

			const card = $(`
				<div class="fpos-recent-card" data-held="${o.name}" style="border-left: 4px solid #f59e0b;background:#fff;border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid #eadfd2;border-left-width:4px;">
					<div style="display:flex;justify-content:space-between;align-items:flex-start;">
						<div>
							<div style="display:flex;align-items:center;gap:6px;">
								<span style="font-weight:800;font-size:14px;color:#292524;">${o.name}</span>
								<span style="background:#fef3c7;color:#b45309;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:800;text-transform:uppercase;">
									HELD
								</span>
							</div>
							<div style="font-size:11px;color:#78716c;margin-top:3px;">
								<span>${o.order_type}</span>
								${this.format_table_label(o.table || order_data.table || "") ? `&bull; <b>${this.format_table_label(o.table || order_data.table || "")}</b>` : ""}
								&bull; <span>Customer: <b>${o.customer_name || o.customer || "Walk-in"}</b></span>
							</div>
							${o.phone ? `<div style="font-size:11px;color:#78716c;">${o.phone}</div>` : ""}
						</div>

						<div style="text-align:right;">
							<div style="font-weight:900;font-size:16px;color:#ea580c;">${format_curr(order_total)}</div>
							<div style="font-size:11px;color:#a8a29e;margin-top:2px;">${o.creation ? o.creation.substring(11, 16) : ""}</div>
						</div>
					</div>

					<div style="font-size:11px;color:#57534e;background:#faf6f0;padding:6px 10px;border-radius:6px;line-height:1.4;margin:8px 0;">
						<b style="color:#292524;">${items.length} items:</b> ${items_preview || "Items"}
					</div>

					${o.hold_reason ? `<div style="font-size:11px;color:#92400e;background:#fef3c7;padding:3px 8px;border-radius:4px;margin-bottom:8px;">${o.hold_reason}</div>` : ""}

					<div style="display:flex;gap:8px;border-top:1px dashed #eadfd2;padding-top:8px;">
						<button class="btn btn-default btn-xs fpos-resume-held-btn" style="flex:1;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:4px;color:#ea580c;background:#ffedd5;border-color:#bbf7d0;border-radius:6px;padding:6px 10px;">
							<span>▶️</span>
							<span>${__("Resume Order")}</span>
						</button>
						<button class="btn btn-default btn-xs fpos-discard-held-btn" style="font-weight:700;display:inline-flex;align-items:center;gap:4px;color:#b91c1c;background:#fee2e2;border-color:#fca5a5;border-radius:6px;padding:6px 10px;">
							<span>${fpos_icon("trash", "fpos-ic-sm")}</span>
							<span>${__("Discard")}</span>
						</button>
					</div>
				</div>
			`);

			card.find(".fpos-resume-held-btn").on("click", () => this.resume_held_order_from_drawer(o.name));
			card.find(".fpos-discard-held-btn").on("click", () => this.discard_held_order_from_drawer(o.name));

			$body.append(card);
		});
	}

	async hold_current_order() {
		if (this.cart_items.length === 0) {
			frappe.show_alert({ message: __("Cart is empty. Nothing to hold."), indicator: "orange" });
			return;
		}

		const d = new frappe.ui.Dialog({
			title: __("Hold Order"),
			fields: [
				{
					fieldname: "hold_reason",
					fieldtype: "Data",
					label: __("Reason for Hold"),
					default: __("Customer requested hold"),
				}
			],
			primary_action_label: __("Confirm Hold"),
			primary_action: async (values) => {
				d.hide();
				const order_payload = {
					order_type: this.order_type,
					table: this.selected_table || "",
					customer: this.customer,
					customer_name: this.customer,
					phone: this.delivery_phone || "",
					delivery_address: this.delivery_address || "",
					delivery_charges: flt(this.delivery_charges || 0),
					pos_profile: this.pos_profile,
					pos_opening_entry: this.pos_opening,
					discount_percentage: this.discount_percentage,
					discount_amount: this.discount_amount,
					order_note: this.order_note,
					grand_total: this.totals.grand_total,
					items: this.cart_items,
					// Round 23 fix: preserve the order token through hold/
					// resume, so a resumed cart still links to its own KOTs.
					order_id: this.pos_order_id || null,
					linked_kot_id: this.linked_kot_id || null,
				};

				try {
					frappe.dom.freeze(__("Holding order..."));
					const res = await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.hold_order",
						args: { order_data: order_payload, reason: values.hold_reason },
					});
					frappe.dom.unfreeze();

					if (res.message && res.message.held_count !== undefined) {
						this.update_held_badge_count(res.message.held_count);
					}
					frappe.show_alert({ message: __("Order held: {0}", [res.message.held_order_id]), indicator: "orange" });
					this.clear_cart();
					await this.refresh_held_badge();
				} catch (err) {
					frappe.dom.unfreeze();
					frappe.msgprint(__("Could not hold order: {0}", [err.message]));
				}
			}
		});

		this.style_dialog(d);
		d.show();
	}

	async resume_held_order_from_drawer(held_order_id) {
		const load = async () => {
			try {
				frappe.dom.freeze(__("Resuming held order..."));
				const res = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.resume_held_order",
					args: { held_order_id: held_order_id },
				});
				frappe.dom.unfreeze();

				const data = res.message.order_data || {};
				if (res.message && res.message.held_count !== undefined) {
					this.update_held_badge_count(res.message.held_count);
				}
				this.cart_items = (data.items || []).map(i => ({
					item_code: i.item_code,
					item_name: i.item_name,
					qty: flt(i.qty) || 1,
					rate: flt(i.rate) || 0,
					amount: flt(i.amount) || (flt(i.rate) * (flt(i.qty) || 1)),
					item_note: i.item_note || "",
					uom: i.uom || "Nos",
					item_image: i.item_image || "",
				}));

				this.customer = data.customer || "";
				this.pos_order_id = data.order_id || null;
				this.linked_kot_id = data.linked_kot_id || null;
				this.order_type = data.order_type || "Dine In";
				this.selected_table = data.table || null;
				this.selected_table_no = data.table || "";
				this.delivery_phone = data.phone || "";
				this.delivery_address = data.delivery_address || "";
				this.delivery_charges = flt(data.delivery_charges || 0);
				this.discount_percentage = 0; // v5.2: % discounts removed — Rs only, stale % never restored.
				this.discount_amount = flt(data.discount_amount || 0);
				this.order_note = data.order_note || "";

				// Update Order Type UI (tabs, table/delivery fields)
				this.update_order_type_ui();

				this.wrapper.find(".fpos-customer-label").text(this.customer || __("Walk-in Customer"));

				this.render_cart_items();
				this.update_cart_summary();
				this.hide_held_orders_drawer();

				// Optimistically remove resumed order immediately from list and badge
				this.held_orders = (this.held_orders || []).filter(o => o.name !== held_order_id);
				this.render_held_orders(this.held_orders);
				this.update_held_badge(this.held_orders);

				const res_held = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_held_orders",
					args: { branch: this.branch, pos_profile: this.pos_profile },
					freeze: false,
				});
				const held_list = res_held.message || [];
				this.held_orders = held_list;
				this.render_held_orders(held_list);
				this.update_held_badge(held_list);
				frappe.show_alert({ message: __("Held order {0} resumed!", [held_order_id]), indicator: "green" });
			} catch (err) {
				frappe.dom.unfreeze();
				frappe.msgprint(__("Could not resume order: {0}", [err.message]));
			}
		};

		if (this.cart_items.length > 0) {
			frappe.confirm(
				__("Your active cart has items. Replace cart with Held Order {0}?", [held_order_id]),
				() => load()
			);
		} else {
			load();
		}
	}

	async discard_held_order_from_drawer(held_order_id) {
		frappe.confirm(__("Are you sure you want to discard Held Order {0}?", [held_order_id]), async () => {
			try {
				const res_disc = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.discard_held_order",
					args: { held_order_id: held_order_id },
				});
				if (res_disc.message && res_disc.message.held_count !== undefined) {
					this.update_held_badge_count(res_disc.message.held_count);
				}
				frappe.show_alert({ message: __("Order discarded"), indicator: "orange" });
				const res_held = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_held_orders",
					args: { branch: this.branch, pos_profile: this.pos_profile },
					freeze: false,
				});
				const held_list = res_held.message || [];
				this.held_orders = held_list;
				this.render_held_orders(held_list);
				this.update_held_badge(held_list);
			} catch (err) {
				frappe.msgprint(__("Could not discard order: {0}", [err.message]));
			}
		});
	}

	update_held_badge_count(count) {
		const cnt = cint(count) || 0;
		const $badge = this.wrapper ? this.wrapper.find(".fpos-held-badge").add($(".fpos-held-badge")) : $(".fpos-held-badge");
		const $pill = this.wrapper ? this.wrapper.find(".fpos-held-count-pill").add($(".fpos-held-count-pill")) : $(".fpos-held-count-pill");

		$pill.text(`${cnt} held`);
		if (cnt > 0) {
			$badge.text(cnt).show();
		} else {
			$badge.hide();
		}
	}

	update_held_badge(orders) {
		this.held_orders = orders || [];
		const count = this.held_orders.length;
		this.update_held_badge_count(count);
	}

	async refresh_held_badge() {
		if (!this.pos_profile || !this.is_online) return;
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_held_orders",
				args: { branch: this.branch, pos_profile: this.pos_profile },
				freeze: false,
				quiet: true,
				error: () => {},
			});
			const orders = res.message || [];
			this.held_orders = orders;
			this.render_held_orders(orders);
			this.update_held_badge(orders);
		} catch (e) {
			// Silent background refresh
		}
	}

	// ─── 9. Offline Queue & Sync ─────────────────────────────────────────────

	queue_offline_invoice(order_payload, payments) {
		const queue = JSON.parse(localStorage.getItem(this.offline_queue_key) || "[]");
		const offline_id = "OFFLINE-" + Date.now();

		queue.push({
			offline_id: offline_id,
			order_data: order_payload,
			payments: payments,
			created_at: new Date().toISOString(),
		});

		localStorage.setItem(this.offline_queue_key, JSON.stringify(queue));
		frappe.show_alert({ message: __("Invoice stored in Offline Queue ({0})", [offline_id]), indicator: "orange" });

		this.update_connection_indicator();
		this.clear_cart();
	}

	async sync_offline_invoices(manual = false) {
		const queue = JSON.parse(localStorage.getItem(this.offline_queue_key) || "[]");
		if (queue.length === 0) {
			if (manual) frappe.show_alert({ message: __("Nothing to sync"), indicator: "blue" });
			return;
		}

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.sync_offline_invoices",
				args: { invoices: queue },
				freeze: false,
				// v5.10: a failing background sync must never pop an
				// "Internal Server Error" dialog over the POS (the stale
				// v5.8 tab showed it six times on load).
				error: () => {},
			});

			const results = res.message || [];
			const success_ids = results.filter((r) => r.success).map((r) => r.offline_id);

			// Retain only un-synced items
			const remaining = queue.filter((item) => !success_ids.includes(item.offline_id));
			localStorage.setItem(this.offline_queue_key, JSON.stringify(remaining));

			if (success_ids.length > 0) {
				frappe.show_alert({
					message: __("Successfully synced {0} offline invoice(s) to server", [success_ids.length]),
					indicator: "green",
				});
			}

			// v5.9: a failed sync must say WHY instead of sitting silently
			// in the queue forever ("2 pending sync" with no error).
			const failed = results.filter((r) => !r.success);
			if (failed.length > 0) {
				frappe.show_alert({
					message: __("Could not sync {0} invoice(s): {1}", [failed.length, (failed[0].error || __("sync failed"))]),
					indicator: "red",
				});
			}

			this.update_connection_indicator();
			// v5.9: refresh the home sync pill count after a manual retry.
			if (manual && this.current_view === "home") this.show_home();
		} catch (e) {
			console.warn("Background offline sync completed with notice", e);
			if (manual) frappe.show_alert({ message: __("Sync failed: {0}", [e.message]), indicator: "red" });
		}
	}

	update_connection_indicator() {
		const queue = JSON.parse(localStorage.getItem(this.offline_queue_key) || "[]");
		const $ind = this.wrapper.find(".fpos-sync-indicator");
		const $dot = $ind.find(".fpos-dot, .fpos-indicator-dot");
		const $label = $ind.find(".fpos-indicator-label");

		if (!this.is_online) {
			$ind.removeClass("online").addClass("offline").attr("title", __("Offline ({0} queued) - Click to inspect", [queue.length]));
			$dot.css("background", "#a8a29e");
			if ($label.length) $label.text(__("Offline ({0})", [queue.length]));
		} else if (queue.length > 0) {
			$ind.removeClass("online offline").addClass("syncing").attr("title", __("Syncing ({0} queued) - Click to inspect", [queue.length]));
			$dot.css("background", "#f59e0b");
			if ($label.length) $label.text(__("Syncing ({0})", [queue.length]));
		} else {
			$ind.removeClass("offline syncing").addClass("online").attr("title", __("Online — Connected. Click to inspect sync queue."));
			$dot.css("background", "#16a34a");
			if ($label.length) $label.text(__("Online"));
		}
	}

	update_filter_button_indicator() {
		let active_count = 0;
		if (this.fast_food_category && this.fast_food_category !== "All") active_count++;
		if (this.diet_filter && this.diet_filter !== "all") active_count++;
		if (this.sort_by && this.sort_by !== "default") active_count++;
		const $btn = this.wrapper.find(".fpos-filters-dropdown-btn");
		const $badge = $btn.find(".fpos-filter-active-badge");
		if (active_count > 0) {
			$btn.addClass("has-active-filters");
			$badge.text(active_count).show();
		} else {
			$btn.removeClass("has-active-filters");
			$badge.hide();
		}
	}

	update_order_type_ui() {
		this.wrapper.find(".fpos-ot-tab").removeClass("active");
		this.wrapper.find(`.fpos-ot-tab[data-type="${this.order_type}"]`).addClass("active");

		// v4 CHILI order header: Dine In shows the table as the title, other types
		// show the customer. The .fpos-table-label / .fpos-customer-label spans are
		// kept (same class names) so every existing label update keeps working.
		const is_dinein = this.order_type === "Dine In";
		const $t = this.wrapper.find(".fpos-table-label");
		const $c = this.wrapper.find(".fpos-customer-label");
		const $d = this.wrapper.find(".fpos-delivery-field");
		if (is_dinein) {
			$t.show().text(this.selected_table_no ? __("Table") + " " + this.selected_table_no : __("Select Table"));
			$c.hide();
			$d.hide();
		} else if (this.order_type === "Delivery") {
			$t.hide();
			$c.show().text(this.customer || __("Walk-in Customer"));
			$d.show().css("display", "flex");
			$d.find(".fpos-delivery-label").text(this.delivery_phone || __("Delivery Details *"));
		} else {
			$t.hide();
			$c.show().text(this.customer || __("Walk-in Customer"));
			$d.hide();
		}
		this.wrapper.find(".fpos-topbar-order-label").text(
			is_dinein
				? (this.selected_table_no ? __("Table") + " " + this.selected_table_no : __("Select Table"))
				: (this.order_type === "Walk In" ? (this.customer || __("Walk-in")) : this.order_type));
		this.update_order_sub();
	}

	// v4: "{type} • N items" subtitle under the order title; refreshed on every cart change.
	update_order_sub() {
		const n = (this.cart_items || []).length;
		const sub = `${this.order_type} • ${n === 1 ? __("1 item") : `${n} ${__("items")}`}`
			+ (this.order_type === "Dine In" && this.customer ? ` • ${this.customer}` : "");
		this.wrapper.find(".fpos-order-sub").text(sub);
	}

	set_order_type(new_type) {
	}

	set_order_type(new_type) {
		if (!new_type) return;
		this.order_type = new_type;
		this.update_order_type_ui();
		if (this.order_type === "Takeaway") {
			this.selected_table = null;
			this.selected_table_no = "";
		}
		if (this.active_tab_id && this.tabs[this.active_tab_id]) {
			const cur = this.tabs[this.active_tab_id];
			cur.order_type = this.order_type;
			cur.table = this.selected_table;
			cur.table_no = this.selected_table_no;
			cur.title = `${this.order_type} #${Object.keys(this.tabs).indexOf(this.active_tab_id) + 1}`;
			this.update_tab_pill(this.active_tab_id);
			this.debounced_save_active_tab_draft();
		}
		this.update_cart_summary();
	}

	// ─── 10. UI Event Handlers ───────────────────────────────────────────────

	bind_ui_events() {
		// Clean up any previously attached events on wrapper to ensure handlers are never duplicated on branch switch
		this.wrapper.off();

		// Filters dropdown toggle
		this.wrapper.on("click", ".fpos-filters-dropdown-btn", (e) => {
			e.stopPropagation();
			const $pop = this.wrapper.find(".fpos-filters-popover");
			$pop.toggle();
			if ($pop.is(":visible")) {
				this.wrapper.find(".fpos-subfilter-pill").removeClass("active");
				this.wrapper.find(`.fpos-subfilter-pill[data-diet='${this.diet_filter || "all"}']`).addClass("active");
				this.wrapper.find(".fpos-sort-select").val(this.sort_by || "default");
			}
		});

		// Close button inside popover
		this.wrapper.on("click", ".fpos-close-popover-btn", (e) => {
			e.stopPropagation();
			this.wrapper.find(".fpos-filters-popover").hide();
		});

		// Prevent popover clicks from bubbling to document (which would close it)
		this.wrapper.on("click", ".fpos-filters-popover", (e) => {
			e.stopPropagation();
		});

		// Cart top overflow menu toggle (holds KOT & Clear)
		this.wrapper.on("click", ".fpos-cart-overflow-btn", (e) => {
			e.stopPropagation();
			this.wrapper.find(".fpos-cart-overflow-menu").toggle();
		});

		// Hide cart overflow menu when clicking its actions
		this.wrapper.on("click", ".fpos-cart-overflow-item", () => {
			this.wrapper.find(".fpos-cart-overflow-menu").hide();
		});

		// Document click handler to dismiss popovers when clicking outside
		$(document).off("click.fpos_popovers").on("click.fpos_popovers", (e) => {
			if (!$(e.target).closest(".fpos-filters-dropdown-wrapper").length) {
				this.wrapper.find(".fpos-filters-popover").hide();
			}
			if (!$(e.target).closest(".fpos-cart-overflow-wrapper").length) {
				this.wrapper.find(".fpos-cart-overflow-menu").hide();
			}
		});

		// Close popovers and drawers on Escape key
		$(document).off("keydown.fpos_popover").on("keydown.fpos_popover", (e) => {
			if (e.key === "Escape" || e.keyCode === 27) {
				this.wrapper.find(".fpos-filters-popover").hide();
				this.wrapper.find(".fpos-cart-overflow-menu").hide();
				this.wrapper.find(".fpos-more-menu").hide();
				this.hide_kitchen_drawer();
				this.hide_recent_orders_drawer();
				this.hide_held_orders_drawer();
				this.hide_pending_drawer();
			}
		});

		// v6: "/" (or Ctrl+K) focuses the product search from anywhere
		// on the keyboard — the cashier never has to reach for the mouse.
		$(document).off("keydown.fpos_search_shortcut").on("keydown.fpos_search_shortcut", (e) => {
			const tag = (e.target && e.target.tagName) || "";
			const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable);
			if (typing) return;
			if (e.key === "/" || ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K"))) {
				e.preventDefault();
				const $input = this.wrapper.find(".fpos-search-input");
				if ($input.length) { this.show_pos(); $input.focus(); $input.select(); }
			}
		});

		// Fast food category selection
		this.wrapper.on("click", ".fpos-ff-tab, .fpos-category-tab, .fpos-cat-tile", (e) => {
			this.fast_food_category = $(e.currentTarget).data("cat");
			this.current_category = this.fast_food_category;
			this.wrapper.find(".fpos-ff-tab, .fpos-category-tab, .fpos-cat-tile").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.wrapper.find(`.fpos-ff-tab[data-cat='${this.fast_food_category}'], .fpos-category-tab[data-cat='${this.fast_food_category}'], .fpos-cat-tile[data-cat='${this.fast_food_category}']`).addClass("active");
			this.update_filter_button_indicator();
			this.render_items_grid();
		});

		// Diet sub-filter pills (All, Veg, Non-Veg, Spicy)
		this.wrapper.on("click", ".fpos-subfilter-pill", (e) => {
			e.stopPropagation();
			this.diet_filter = $(e.currentTarget).data("diet");
			this.wrapper.find(".fpos-subfilter-pill").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.update_filter_button_indicator();
			this.render_items_grid();
		});

		// Sort dropdown (Featured, Price, Name) — handles change, input, select click, and direct option click/mousedown
		this.wrapper.on("change input", ".fpos-sort-select", (e) => {
			this.sort_by = $(e.target).val();
			this.update_filter_button_indicator();
			this.render_items_grid();
		});

		this.wrapper.on("click mousedown", ".fpos-sort-select option", (e) => {
			const val = $(e.currentTarget).val() || $(e.currentTarget).attr("value");
			if (val) {
				this.sort_by = val;
				this.wrapper.find(".fpos-sort-select").val(val);
				this.update_filter_button_indicator();
				this.render_items_grid();
			}
		});

		// Reset filters button
		this.wrapper.on("click", ".fpos-reset-filters-btn", (e) => {
			e.stopPropagation();
			this.fast_food_category = "All";
			this.current_category = "All";
			this.diet_filter = "all";
			this.sort_by = "default";
			this.wrapper.find(".fpos-ff-tab, .fpos-category-tab, .fpos-cat-tile").removeClass("active");
			this.wrapper.find(".fpos-ff-tab[data-cat='All'], .fpos-category-tab[data-cat='All'], .fpos-cat-tile[data-cat='All']").addClass("active");
			this.wrapper.find(".fpos-subfilter-pill").removeClass("active");
			this.wrapper.find(".fpos-subfilter-pill[data-diet='all']").addClass("active");
			this.wrapper.find(".fpos-sort-select").val("default");
			this.update_filter_button_indicator();
			this.render_items_grid();
			frappe.show_alert({ message: __("Filters reset to default"), indicator: "blue" });
		});

		// Search input — instant filter (name / code / barcode, v6).
		this.wrapper.on("input", ".fpos-search-input", (e) => {
			this.search_term = $(e.target).val();
			this.render_items_grid();
		});
		// v6: Enter in search adds the single match (barcode-scanner flow:
		// scan → one result → Enter → item in cart, search clears).
		this.wrapper.on("keydown", ".fpos-search-input", (e) => {
			if (e.key !== "Enter" && e.keyCode !== 13) return;
			const results = this._last_search_results || [];
			if (results.length === 1) {
				e.preventDefault();
				this.add_item_to_cart(results[0]);
				this.search_term = "";
				$(e.target).val("");
				this.render_items_grid();
			}
		});

		// Order type toggle with Confirmation & Dynamic State Sync
		this.wrapper.on("click", ".fpos-ot-tab", (e) => {
			const new_type = $(e.currentTarget).data("type");
			if (new_type === this.order_type) return;

			const apply_type_switch = () => {
				this.order_type = new_type;
				this.update_order_type_ui();

				if (this.order_type === "Dine In") {
					if (!this.selected_table) {
						this.open_table_selector();
					}
				} else if (this.order_type === "Delivery") {
					this.selected_table = null;
					this.selected_table_no = "";
					$(".modal:contains('Not found')").closest(".modal").remove();
					$(".modal-backdrop").remove();
					$("body").removeClass("modal-open");
					if (!this.delivery_phone || !this.delivery_address) {
						this.open_delivery_dialog();
					}
				} else {
					// Takeaway
					this.selected_table = null;
					this.selected_table_no = "";
				}

				if (this.active_tab_id && this.tabs[this.active_tab_id]) {
					const cur = this.tabs[this.active_tab_id];
					cur.order_type = this.order_type;
					cur.table = this.selected_table;
					cur.table_no = this.selected_table_no;
					cur.delivery_phone = this.delivery_phone;
					cur.delivery_address = this.delivery_address;
					cur.delivery_charges = this.delivery_charges;
					cur.title = `${this.order_type} #${Object.keys(this.tabs).indexOf(this.active_tab_id) + 1}`;
					this.update_tab_pill(this.active_tab_id);
					this.debounced_save_active_tab_draft();
				}
				this.update_cart_summary();
			};

			if (this.cart_items.length > 0) {
				frappe.confirm(
					__("Switch order type to {0}? Cart items will be retained.", [new_type]),
					() => apply_type_switch()
				);
			} else {
				apply_type_switch();
			}
		});

		// Delivery info click
		this.wrapper.on("click", ".fpos-delivery-field", () => this.open_delivery_dialog());

		// Hold Order click
		this.wrapper.on("click", ".fpos-hold-btn", () => this.hold_current_order());

		// Held orders drawer clicks
		this.wrapper.on("click", ".fpos-held-orders-btn", () => this.show_held_orders_drawer());
		this.wrapper.on("click", ".fpos-close-held-drawer", () => this.hide_held_orders_drawer());

		// Kitchen station filter clicks
		this.wrapper.on("click", ".fpos-kds-station-btn", (e) => {
			const st = $(e.currentTarget).data("station");
			this.kitchen_station_filter = st;
			this.wrapper.find(".fpos-kds-station-btn").removeClass("active btn-primary").addClass("btn-default");
			$(e.currentTarget).addClass("active btn-primary").removeClass("btn-default");
			this.show_kitchen_drawer();
		});

		// New Tab button click
		this.wrapper.on("click", ".fpos-new-tab-btn", () => {
			this.wrapper.find(".fpos-more-menu").hide();
			this.create_new_tab("Dine In", null, "", true);
		});

		// Table selector click
		this.wrapper.on("click", ".fpos-order-edit-btn, .fpos-topbar-order-chip", () => {
			if (this.order_type === "Dine In") this.open_table_selector();
			else this.open_customer_dialog();
		});
		this.wrapper.on("click", ".fpos-topbar-menu-btn", () => {
			this.wrapper.toggleClass("fpos-sidebar-collapsed");
		});

		// Customer picker click

		// v3: left icon sidebar — every item goes somewhere real.
		this.wrapper.on("click", ".fpos-pos-nav-item", (e) => {
			const key = $(e.currentTarget).data("nav");
			this.wrapper.find(".fpos-pos-nav-item").removeClass("active");
			$(e.currentTarget).addClass("active");
			if (key === "menu") this.show_pos();
			else if (key === "pending") {
				// v5.12: Pending Payments drawer — the POS view stays, so the
				// Menu nav item stays highlighted, not Pending.
				this.show_pending_drawer();
				this.wrapper.find(".fpos-pos-nav-item").removeClass("active");
				this.wrapper.find('.fpos-pos-nav-item[data-nav="menu"]').addClass("active");
			}
			else if (key === "tables" || key === "reservation") this.show_tables();
			else if (key === "delivery") this.show_daily_report();
			else if (key === "accounting") this.show_closing_page();
			else if (key === "settings") frappe.set_route("Form", "POS Profile", this.pos_profile);
			else if (key === "logout") {
				if (window.frappe && frappe.app && frappe.app.logout) frappe.app.logout();
				else frappe.set_route("desk");
			}
		});
		// v3: occupied-table chip -> open that order's tab.
		this.wrapper.on("click", ".fpos-table-chip", (e) => {
			const $chip = $(e.currentTarget);
			const tab_id = $chip.data("tab-id");
			if (tab_id && this.tabs && this.tabs[tab_id]) { this.switch_tab(tab_id); return; }
			// v4: a free-table chip starts a Dine-In order on that table.
			const table_name = $chip.data("table-name");
			if (table_name) this.start_table_order(table_name);
		});

		// v3: cart-panel payment method pick (Cash / Card / QR) — payment page default.
		this.wrapper.on("click", ".fpos-pay-method", (e) => {
			const mode = $(e.currentTarget).data("mode");
			this.preferred_payment_mode = mode;
			this.wrapper.find(".fpos-pay-method").removeClass("active");
			$(e.currentTarget).addClass("active");
		});

		// KOT button click
		this.wrapper.on("click", ".fpos-confirm-order-btn", () => this.confirm_order());
		this.wrapper.on("click", ".fpos-home-btn", () => this.show_home());

		// Clear cart click with KOT safeguard
		this.wrapper.on("click", ".fpos-clear-btn", async () => {
			if (this.selected_table) {
				try {
					const res = await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.check_table_has_unsettled_kot",
						args: { table: this.selected_table },
						freeze: false,
					});
					if (res.message && res.message.has_kot) {
						frappe.msgprint({
							title: __("Active Kitchen Tickets Exist"),
							indicator: "red",
							message: __("Table {0} has a {1} kitchen order ticket ({2}). You cannot clear the cart or abandon a served table without settling the bill or performing an authorized Manager Void.", [
								this.selected_table_no || this.selected_table,
								res.message.kot_status,
								res.message.kot_name
							])
						});
						return;
					}
				} catch (e) {
					console.warn("KOT check failed:", e);
				}
			}
			frappe.confirm(__("Are you sure you want to clear the entire cart?"), () => this.clear_cart());
		});

		// Pay button click -> Full Page Slide-in Transition from Left to Right
		this.wrapper.on("click", ".fpos-pay-btn", () => this.show_payment_page());

		// Live Kitchen Order Tracking Drawer click
		this.wrapper.on("click", ".fpos-kitchen-track-btn", () => {
			this.wrapper.find(".fpos-more-menu").hide();
			this.show_kitchen_drawer();
		});
		this.wrapper.on("click", ".fpos-close-kitchen-drawer", () => this.hide_kitchen_drawer());
		// v5.12: Pending Payments drawer close.
		this.wrapper.on("click", ".fpos-close-pending-drawer", () => this.hide_pending_drawer());
		$(document).off("click.fpos_close_kitchen").on("click.fpos_close_kitchen", ".fpos-close-kitchen-drawer", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.hide_kitchen_drawer();
		});

		// Recent Orders Drawer (Last 10 Customers) click
		this.wrapper.on("click", ".fpos-recent-orders-btn", () => {
			this.wrapper.find(".fpos-more-menu").hide();
			this.show_recent_orders_drawer();
		});
		this.wrapper.on("click", ".fpos-close-recent-drawer", () => this.hide_recent_orders_drawer());
		$(document).off("click.fpos_close_recent").on("click.fpos_close_recent", ".fpos-close-recent-drawer", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.hide_recent_orders_drawer();
		});

		// Held Orders Drawer close handler
		$(document).off("click.fpos_close_held").on("click.fpos_close_held", ".fpos-close-held-drawer", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.hide_held_orders_drawer();
		});

		// Served KOT Exceptions (Manager Review) click
		this.wrapper.on("click", ".fpos-exceptions-btn", () => {
			this.wrapper.find(".fpos-more-menu").hide();
			this.show_served_kot_exceptions_dialog();
		});

		// More overflow menu toggle
		this.wrapper.on("click", "#fpos-more-menu-btn, .fpos-more-btn", (e) => {
			e.stopPropagation();
			this.wrapper.find(".fpos-more-menu").toggle();
		});

		// Close More menu on clicking outside
		$(document).off("click.fpos_more").on("click.fpos_more", (e) => {
			if (!$(e.target).closest(".fpos-more-dropdown-wrapper").length) {
				this.wrapper.find(".fpos-more-menu").hide();
			}
		});

		// Refresh action in More menu
		this.wrapper.on("click", ".fpos-refresh-btn", () => {
			this.wrapper.find(".fpos-more-menu").hide();
			this.refresh();
			frappe.show_alert({ message: __("POS screen refreshed"), indicator: "blue" });
		});

		// v2: Switch Branch removed — single branch, no branch switching.

		// Exit to Desk action in More menu
		this.wrapper.on("click", ".fpos-exit-desk-btn", () => {
			this.wrapper.find(".fpos-more-menu").hide();
			frappe.set_route("desk");
		});

		// Close register action in More menu (separated at bottom, prompts manager PIN)
		this.wrapper.on("click", ".fpos-close-btn-menu", () => {
			this.wrapper.find(".fpos-more-menu").hide();
			frappe.confirm(
				__("Close Register & reconcile daily sales for this shift?"),
				() => {
					this.prompt_manager_pin({
						action_type: "Close Register",
						title: __("Manager PIN — Close Register"),
						details: __("Closing register for shift {0} requires manager PIN authorization.", [this.pos_opening || ""]),
						on_success: () => {
							this.show_closing_page();
						}
					});
				}
			);
		});

		// Drawer backdrop overlay click
		this.wrapper.on("click", ".fpos-drawer-overlay", () => {
			this.hide_kitchen_drawer();
			this.hide_recent_orders_drawer();
			this.hide_held_orders_drawer();
		});
		$(document).off("click.fpos_overlay_close").on("click.fpos_overlay_close", ".fpos-drawer-overlay", () => {
			this.hide_kitchen_drawer();
			this.hide_recent_orders_drawer();
			this.hide_held_orders_drawer();
		});

		// Manual sync click (v5.9: the home sync pill is one of these now)
		this.wrapper.on("click", ".fpos-manual-sync-btn", () => this.sync_offline_invoices(true));

		// Sync indicator click: view & manage queued invoices
		this.wrapper.on("click", ".fpos-sync-indicator", () => {
			const queue = JSON.parse(localStorage.getItem(this.offline_queue_key) || "[]");
			if (!queue.length) {
				frappe.show_alert({ message: __("System is connected. All orders are synchronized."), indicator: "green" });
				return;
			}

			const d = new frappe.ui.Dialog({
				title: __("Offline Orders ({0} pending)", [queue.length]),
				fields: [
					{
						fieldname: "info",
						fieldtype: "HTML",
						options: `<div style="padding:8px 0;font-size:13px;color:#57534e;">
							<p style="margin-bottom:8px;">${__("There are {0} offline invoice(s) queued in browser storage awaiting server submission.", [queue.length])}</p>
							<p style="margin-bottom:0;font-size:12px;color:#78716c;">${__("You can retry synchronizing now, or discard stuck local drafts if they were test records.")}</p>
						</div>`
					}
				],
				primary_action_label: __("Sync Now"),
				primary_action: () => {
					d.hide();
					this.sync_offline_invoices();
				},
				secondary_action_label: __("Discard Queue"),
				secondary_action: () => {
					frappe.confirm(__("Discard {0} pending offline invoices from browser storage?", [queue.length]), () => {
						localStorage.removeItem(this.offline_queue_key);
						this.update_connection_indicator();
						frappe.show_alert({ message: __("Offline queue cleared."), indicator: "blue" });
						d.hide();
					});
				}
			});
			this.style_dialog(d);
			d.show();
		});

		// Close / Exit click -> Open Full Page Closing Dashboard!
		this.wrapper.on("click", ".fpos-close-btn", () => {
			this.show_closing_page();
		});

		// v2: the branch/register chip is a static label now — no profile switching.

		// Discount modal
		this.wrapper.on("click", ".fpos-discount-btn", () => {
			this.open_discount_dialog();
		});
	}

	open_discount_dialog() {
		const format_curr = (val) => this.format_money(val);
		const subtotal = flt(this.totals && this.totals.subtotal) || 0;

		const d = new frappe.ui.Dialog({
			title: __("Apply Order Discount"),
			fields: [
				{
					fieldname: "info_html",
					fieldtype: "HTML",
					options: `
						<div style="background:#faf6f0;border:1px solid #eadfd2;border-radius:10px;padding:12px;margin-bottom:14px;">
							<div style="display:flex;justify-content:space-between;align-items:center;">
								<span style="font-size:13px;color:#78716c;font-weight:600;">${__("Current Order Subtotal:")}</span>
								<span style="font-size:16px;color:#292524;font-weight:800;">${format_curr(subtotal)}</span>
							</div>
							<div style="font-size:11px;color:#a8a29e;margin-top:4px;">
								${__("Cashier cap: Max Rs 100 without Manager PIN. Discount is always in Rs, never %.")}
							</div>
						</div>

						<div style="margin-bottom:14px;">
							<label style="font-size:12px;font-weight:700;color:#44403c;margin-bottom:6px;display:block;">${__("Discount Presets (Rs)")}</label>
							<div class="fpos-disc-presets" style="display:flex;gap:6px;flex-wrap:wrap;">
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="amt" data-val="50" style="font-weight:700;">Rs 50</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="amt" data-val="100" style="font-weight:700;">Rs 100</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="amt" data-val="200" style="font-weight:700;border-color:#f59e0b;color:#b45309;">Rs 200 (PIN)</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="amt" data-val="500" style="font-weight:700;border-color:#f59e0b;color:#b45309;">Rs 500 (PIN)</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-clear text-danger" style="font-weight:700;">${__("Clear")}</button>
							</div>
						</div>
					`
				},
				{
					// v5.2: discount is a flat Rs amount only — no % field anymore.
					fieldname: "discount_amount",
					fieldtype: "Currency",
					label: __("Discount Amount (Rs)"),
					default: this.discount_amount,
				},
				{
					fieldname: "pin_section",
					fieldtype: "Section Break",
					label: __("Manager Authorization Required"),
					hidden: 1,
				},
				{
					fieldname: "manager_pin",
					fieldtype: "Password",
					label: __("Manager PIN"),
					hidden: 1,
					description: __("Exceeds cashier cap (Max Rs 100). Manager PIN is required."),
				},
				{
					fieldname: "discount_reason",
					fieldtype: "Data",
					label: __("Reason for Override"),
					hidden: 1,
					default: __("Manager approved customer discount"),
				}
			],
			primary_action_label: __("Apply Discount"),
			// v5.2: discount is a flat Rs amount only — no % anywhere.
			primary_action: async (values) => {
				const amt = flt(values.discount_amount);

				if (amt <= 0) {
					this.discount_percentage = 0;
					this.discount_amount = 0;
					this.discount_approved_by = null;
					this.discount_manager_pin = null;
					d.hide();
					this.update_cart_summary();
					return;
				}

				const exceeds_cap = amt > 100.0;
				if (exceeds_cap) {
					const pin = (values.manager_pin || "").trim();
					if (!pin) {
						frappe.msgprint({
							title: __("Manager PIN Required"),
							indicator: "orange",
							message: __("Discount of {0} exceeds the cashier cap (Rs 100). Please provide a valid Manager PIN.", [format_curr(amt)])
						});
						d.set_df_property("pin_section", "hidden", 0);
						d.set_df_property("manager_pin", "hidden", 0);
						d.set_df_property("discount_reason", "hidden", 0);
						return;
					}

					try {
						frappe.dom.freeze(__("Verifying Manager PIN..."));
						const vres = await frappe.call({
							method: "foodpos.foodpos.page.food_pos.food_pos.verify_manager_pin",
							args: {
								pin: pin,
								action_type: "discount",
								cashier: frappe.session.user,
								details: `Discount override: Rs ${amt}. Reason: ${values.discount_reason || "Manager approval"}`
							}
						});
						frappe.dom.unfreeze();

						if (vres.message && vres.message.success) {
							this.discount_percentage = 0;
							this.discount_amount = amt;
							this.discount_approved_by = vres.message.approved_by;
							this.discount_manager_pin = pin;
							frappe.show_alert({
								message: __("Discount approved by {0}", [vres.message.manager_name]),
								indicator: "green"
							});
							d.hide();
							this.update_cart_summary();
						}
					} catch (e) {
						frappe.dom.unfreeze();
						frappe.msgprint({
							title: __("Authorization Failed"),
							indicator: "red",
							message: e.message || __("Invalid Manager PIN. Access denied.")
						});
					}
				} else {
					// Within cashier cap
					this.discount_percentage = 0;
					this.discount_amount = amt;
					this.discount_approved_by = null;
					this.discount_manager_pin = null;
					d.hide();
					this.update_cart_summary();
				}
			}
		});

		const check_cap_visibility = () => {
			const a = flt(d.get_value("discount_amount"));
			const show_pin = a > 100.0;
			d.set_df_property("pin_section", "hidden", show_pin ? 0 : 1);
			d.set_df_property("manager_pin", "hidden", show_pin ? 0 : 1);
			d.set_df_property("discount_reason", "hidden", show_pin ? 0 : 1);
		};

		d.$wrapper.on("input", "input[data-fieldname='discount_amount']", () => {
			check_cap_visibility();
		});

		d.$wrapper.on("click", ".fpos-preset-btn", (e) => {
			const val = flt($(e.currentTarget).data("val"));
			d.set_value("discount_amount", val);
			check_cap_visibility();
		});

		d.$wrapper.on("click", ".fpos-preset-clear", () => {
			d.set_value("discount_amount", 0);
			check_cap_visibility();
		});

		this.style_dialog(d);
		d.show();
		check_cap_visibility();
	}

	async show_closing_page() {
		this.current_view = "closing";
		// v6.2: hide EVERY top-level view, not just the POS body — the Home
		// view's fixed bottom nav (.fpos-home-nav) stayed visible and covered
		// the closing page's bottom "Close Day" button, so it could not be
		// clicked with a mouse. hide_closing_page() restores the POS view.
		this.wrapper.find(".fpos-body, .fpos-home-view, .fpos-tables-view, .fpos-attendance-view, .fpos-daily-report-view").hide();
		const $closing = this.wrapper.find(".fpos-closing-page");
		$closing.show().addClass("active").html(`
			<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:65vh;gap:16px;">
				<div class="fpos-spinner" style="width:44px;height:44px;border:3px solid #eadfd2;border-top-color:#ea580c;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<div style="color:#57534e;font-size:16px;font-weight:700;">${__("Getting today's sales ready...")}</div>
				<div style="color:#a8a29e;font-size:13px;">${__("Counting sales, cash and payments")}</div>
			</div>
		`);

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_shift_closing_details",
				args: { pos_profile: this.pos_profile, pos_opening_entry: this.pos_opening },
			});
			const data = res.message || {};
			this.render_closing_page(data);
		} catch (err) {
			console.error("Error loading closing details:", err);
			frappe.msgprint({
				title: __("Closing Error"),
				indicator: "red",
				message: __("Could not fetch closing summary. Please check connection.")
			});
			this.hide_closing_page();
		}
	}

	hide_closing_page() {
		this.current_view = "pos";
		this.wrapper.find(".fpos-closing-page").hide().removeClass("active").empty();
		this.wrapper.find(".fpos-body").show();
	}

	render_closing_page(data) {
		const format_curr = (val) => this.format_money(val);
		const $page = this.wrapper.find(".fpos-closing-page");

		// Top Selling Items HTML
		let top_items_html = "";
		if (data.top_items && data.top_items.length) {
			top_items_html = data.top_items.map((it, idx) => `
				<tr style="border-bottom: 1px solid #f5efe4;">
					<td style="padding: 10px 14px; font-weight: 700; color: #ea580c; width: 40px;">#${idx + 1}</td>
					<td style="padding: 10px 14px;">
						<div style="font-weight: 600; color: #292524;">${it.item_name}</div>
						<small style="color: #a8a29e;">${it.item_code}</small>
					</td>
					<td style="padding: 10px 14px; text-align: center; font-weight: 700; color: #44403c;">
						<span style="background: #f5efe4; padding: 3px 10px; border-radius: 12px;">${it.qty}</span>
					</td>
					<td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #292524;">${format_curr(it.amount)}</td>
				</tr>
			`).join("");
		} else {
			top_items_html = `<tr><td colspan="4" style="text-align:center;padding:20px;color:#a8a29e;">${__("No items sold today yet")}</td></tr>`;
		}

		// Payment Reconciliation Rows (Requirement 3: grouped by Mode of Payment with counted amounts & live variance)
		const reconciliation = data.payment_reconciliation || [];
		let total_opening = 0;
		let total_sales = 0;
		let total_expected = 0;
		let total_counted = 0;

		const recon_rows = reconciliation.map(p => {
			total_opening += flt(p.opening_amount);
			total_sales += flt(p.invoice_amount);
			total_expected += flt(p.expected_amount);
			total_counted += flt(p.closing_amount);

			const is_cash = (p.mode_of_payment || "").toLowerCase().includes("cash");
			const icon = "";

			return `
				<tr class="fpos-recon-row" data-mode="${p.mode_of_payment}" data-opening="${p.opening_amount}" data-sales="${p.invoice_amount}" data-expected="${p.expected_amount}" style="border-bottom: 1px solid #f5efe4;">
					<td style="padding: 10px 14px; font-weight: 700; color: #292524;">
						<span style="margin-right: 6px;">${icon}</span>${p.mode_of_payment}
					</td>
					<td style="padding: 10px 14px; text-align: right; color: #78716c; font-weight: 600;">
						${format_curr(p.opening_amount)}
					</td>
					<td style="padding: 10px 14px; text-align: right; color: #16a34a; font-weight: 700;">
						+${format_curr(p.invoice_amount)}
					</td>
					<td style="padding: 10px 14px; text-align: right; font-weight: 800; color: #292524;">
						${format_curr(p.expected_amount)}
					</td>
					<td style="padding: 8px 14px; text-align: right; width: 150px;">
						<input type="number" step="any" class="form-control fpos-recon-counted-input" data-mode="${p.mode_of_payment}" value="${flt(p.closing_amount)}" style="height: 36px; text-align: right; font-size: 14px; font-weight: 700; border-radius: 6px; border: 1px solid #d8cbb8;" />
					</td>
					<td style="padding: 8px 14px; text-align: center; width: 140px;">
						<span class="fpos-mode-variance-badge" data-mode="${p.mode_of_payment}" style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #dcfce7; color: #166534; white-space: nowrap;">
							● ${__("Exact Match")}
						</span>
					</td>
				</tr>
			`;
		}).join("") || `<tr><td colspan="6" style="text-align:center;padding:20px;color:#a8a29e;">${__("No payment modes found for this shift")}</td></tr>`;

		// Order Types Rows
		const ot_rows = (data.order_types || []).map(ot => {
			const icon = fpos_icon(ot.order_type === "Dine In" ? "table" : ot.order_type === "Takeaway" ? "box" : "truck", "fpos-ic-sm");
			return `
				<tr style="border-bottom: 1px solid #f5efe4;">
					<td style="padding: 10px 14px; font-weight: 600; color: #292524;">${icon} ${ot.order_type}</td>
					<td style="padding: 10px 14px; text-align: center; color: #78716c; font-weight: 600;">${ot.count}</td>
					<td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #292524;">${format_curr(ot.amount)}</td>
				</tr>
			`;
		}).join("") || `<tr><td colspan="3" style="text-align:center;padding:20px;color:#a8a29e;">${__("No sales recorded today")}</td></tr>`;

		// Invoices Table Rows
		let inv_rows = "";
		const invoices = data.invoices || [];
		if (invoices.length > 0) {
			inv_rows = invoices.map(inv => {
				// v6.2: same order-type fallback as the server (table -> Dine In,
				// else Takeaway) so a bill's type matches Home and the
				// "Where Orders Came From" breakdown above.
				const ot = inv.custom_order_type || ((inv.custom_table || inv.custom_restaurant_table) ? "Dine In" : "Takeaway");
				const ot_icon = fpos_icon(ot === "Dine In" ? "table" : ot === "Takeaway" ? "box" : "truck", "fpos-ic-sm");
				const doc_route = inv.doctype === "POS Invoice" ? `/app/pos-invoice/${inv.name}` : `/app/sales-invoice/${inv.name}`;
				const is_paid = flt(inv.outstanding_amount) <= 0.001;
				const status_badge = is_paid
					? `<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">Paid</span>`
					: `<span style="background: #fee2e2; color: #b91c1c; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">Unpaid (${format_curr(inv.outstanding_amount)})</span>`;

				return `
					<tr style="border-bottom: 1px solid #f5efe4;">
						<td style="padding: 10px 14px;">
							<a href="${doc_route}" target="_blank" style="font-weight: 700; color: #2563eb; text-decoration: none;">${inv.name} ↗</a>
						</td>
						<td style="padding: 10px 14px; color: #78716c; font-size: 12px;">${(inv.posting_time || "").substring(0, 5)}</td>
						<td style="padding: 10px 14px; font-weight: 500; color: #292524;">${inv.customer_name || inv.customer || "Walk-in"}</td>
						<td style="padding: 10px 14px; font-size: 12px; color: #57534e;">${ot_icon} ${ot}</td>
						<td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #292524;">${format_curr(inv.grand_total)}</td>
						<td style="padding: 10px 14px; text-align: center;">${status_badge}</td>
					</tr>
				`;
			}).join("");
		} else {
			inv_rows = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#a8a29e;">${__("No invoices generated in this shift")}</td></tr>`;
		}

		$page.html(`
			<div style="max-width: 1200px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 24px;">
				<!-- Top Header Navigation -->
				<div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 16px 24px; border-radius: 12px; border: 1px solid #eadfd2; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
					<div style="display: flex; align-items: center; gap: 14px;">
						<button class="btn btn-default fpos-back-to-pos-btn" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; border-radius: 8px;">
							<span>←</span>
							<span>${__("Back to POS")}</span>
						</button>
						<div>
							<h3 style="margin: 0; font-size: 18px; font-weight: 800; color: #292524; display: flex; align-items: center; gap: 8px;">
								<span>${fpos_icon("chart", "fpos-ic-sm")}</span> ${__("Close the Day")}
							</h3>
							<div style="font-size: 12px; color: #78716c; margin-top: 2px;">
								${__("Check the money, then close the day. Nothing is final until you tap “Close Day” below.")}
							</div>
							<div style="font-size: 12px; color: #78716c; margin-top: 2px;">
								${__("POS Profile")}: <b style="color: #292524;">${data.pos_profile || this.pos_profile}</b> &bull;
								${__("Date")}: <b>${data.today}</b> &bull;
								${__("Cashier")}: <b>${data.user_fullname || data.user}</b> &bull;
								${__("Opening Shift")}: <b style="color: #0369a1;">${data.opening_entry || this.pos_opening || __("Active")}</b>
							</div>
						</div>
					</div>

					<div style="display: flex; gap: 10px;">
						<button class="btn btn-default fpos-print-closing-btn" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; border-radius: 8px;">
							<span>${fpos_icon("printer", "fpos-ic-sm")}</span>
							<span>${__("Print Z-Report")}</span>
						</button>
						<button class="btn btn-danger fpos-exit-desk-btn" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 800; border-radius: 8px;">
							<span>${fpos_icon("checkCircle", "fpos-ic-sm")}</span>
							<span>${__("Close Day")}</span>
						</button>
					</div>
				</div>

				<!-- Close-the-day steps: plain words, so anyone can follow. -->
				<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px 20px;display:flex;gap:18px;flex-wrap:wrap;align-items:center;">
					<span style="font-weight:800;color:#92400e;font-size:14px;">${__("Close the day in 3 steps:")}</span>
					<span style="font-size:13px;color:#57534e;"><b style="color:#ea580c;">1</b> ${__("Count the cash in the drawer")}</span>
					<span style="font-size:13px;color:#57534e;"><b style="color:#ea580c;">2</b> ${__("Type it in the “You Counted” column — green means it matches")}</span>
					<span style="font-size:13px;color:#57534e;"><b style="color:#ea580c;">3</b> ${__("Tap “Close Day” below")}</span>
				</div>

				<!-- 4 Main KPI Cards -->
				<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
					<!-- Total Sales -->
					<div style="background: #fff; border: 1px solid #bbf7d0; border-left: 5px solid #22c55e; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
						<div style="font-size: 12px; font-weight: 700; color: #c2410c; text-transform: uppercase; letter-spacing: .5px;">${__("Today's Sales")}</div>
						<div style="font-size: 26px; font-weight: 900; color: #ea580c; margin: 6px 0 2px;">${format_curr(data.net_sales)}</div>
						<div style="font-size: 11px; color: #16a34a;">${__("Gross")}: ${format_curr(data.gross_sales)} &bull; ${__("Discounts")}: -${format_curr(data.total_discounts)}</div>
					</div>

					<!-- Total Orders -->
					<div style="background: #fff; border: 1px solid #bfdbfe; border-left: 5px solid #3b82f6; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
						<div style="font-size: 12px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: .5px;">${__("Orders")}</div>
						<div style="font-size: 26px; font-weight: 900; color: #1d4ed8; margin: 6px 0 2px;">${data.total_orders}</div>
						<div style="font-size: 11px; color: #3b82f6;">${__("Average Ticket")}: ${format_curr(data.total_orders ? data.net_sales / data.total_orders : 0)}</div>
					</div>

					<!-- Cash Drawer -->
					<div style="background: #fff; border: 1px solid #fed7aa; border-left: 5px solid #ea580c; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
						<div style="font-size: 12px; font-weight: 700; color: #9a3412; text-transform: uppercase; letter-spacing: .5px;">${__("Cash in Drawer")}</div>
						<div style="font-size: 26px; font-weight: 900; color: #ea580c; margin: 6px 0 2px;">${format_curr(data.expected_cash)}</div>
						<div style="font-size: 11px; color: #c2410c;">${__("Opening")}: ${format_curr(data.opening_cash)} &bull; ${__("Cash Sales")}: ${format_curr(data.cash_sales)}</div>
					</div>

					<!-- Settled Status -->
					<div style="background: #fff; border: 1px solid #e9d5ff; border-left: 5px solid #a855f7; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
						<div style="font-size: 12px; font-weight: 700; color: #6b21a8; text-transform: uppercase; letter-spacing: .5px;">${__("Money In")}</div>
						<div style="font-size: 26px; font-weight: 900; color: #7e22ce; margin: 6px 0 2px;">${format_curr(data.total_paid)}</div>
						<div style="font-size: 11px; color: ${flt(data.total_outstanding) > 0 ? "#dc2626" : "#7e22ce"};">
							${__("Outstanding")}: <b>${format_curr(data.total_outstanding)}</b>
						</div>
					</div>
				</div>

				<!-- Middle Section: Multi-Payment Reconciliation & Channel Breakdowns -->
				<div style="display: grid; grid-template-columns: 3fr 2fr; gap: 20px;">
					<!-- Multi-Payment Reconciliation Tool -->
					<div style="background: #fff; border-radius: 12px; border: 1px solid #eadfd2; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); display: flex; flex-direction: column; gap: 14px;">
						<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f5efe4; padding-bottom: 12px;">
							<div>
								<div style="font-size: 15px; font-weight: 800; color: #292524; display: flex; align-items: center; gap: 8px;">
									<span>${fpos_icon("cash", "fpos-ic-sm")}</span> ${__("Count the Cash")}
								</div>
								<div style="font-size: 12px; color: #78716c; margin-top: 2px;">
									${__("Type what you counted in the drawer. Green means it matches the expected amount.")}
								</div>
							</div>
							<span style="font-size: 11px; background: #eff6ff; color: #1d4ed8; font-weight: 700; padding: 4px 10px; border-radius: 6px;">
								${__("Opening Entry")}: <b>${data.opening_entry || this.pos_opening || __("Active")}</b>
							</span>
						</div>

						<div style="overflow-x: auto;">
							<table style="width: 100%; border-collapse: collapse; font-size: 12px;" class="fpos-recon-table">
								<thead>
									<tr style="background: #faf6f0; border-bottom: 2px solid #eadfd2; color: #78716c; text-transform: uppercase; font-size: 10px; font-weight: 700;">
										<th style="padding: 10px 14px; text-align: left;">${__("How They Paid")}</th>
										<th style="padding: 10px 14px; text-align: right;">${__("Started With")}</th>
										<th style="padding: 10px 14px; text-align: right;">${__("Sold Today")}</th>
										<th style="padding: 10px 14px; text-align: right;">${__("Should Be")}</th>
										<th style="padding: 10px 14px; text-align: right; width: 150px;">${__("You Counted")}</th>
										<th style="padding: 10px 14px; text-align: center; width: 140px;">${__("Match?")}</th>
									</tr>
								</thead>
								<tbody>
									${recon_rows}
								</tbody>
								<tfoot>
									<tr style="background: #faf6f0; font-weight: 800; border-top: 2px solid #eadfd2;">
										<td style="padding: 10px 14px; color: #292524;">${__("Total")}</td>
										<td style="padding: 10px 14px; text-align: right; color: #78716c;">${format_curr(total_opening)}</td>
										<td style="padding: 10px 14px; text-align: right; color: #16a34a;">+${format_curr(total_sales)}</td>
										<td style="padding: 10px 14px; text-align: right; color: #292524;" class="fpos-recon-total-expected">${format_curr(total_expected)}</td>
										<td style="padding: 10px 14px; text-align: right; color: #292524;" class="fpos-recon-total-counted">${format_curr(total_counted)}</td>
										<td style="padding: 10px 14px; text-align: center;" class="fpos-recon-total-variance">
											<span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #dcfce7; color: #166534;">● ${__("Balanced")}</span>
										</td>
									</tr>
								</tfoot>
							</table>
						</div>

						<div style="margin-top: 6px;">
							<label style="font-size: 12px; font-weight: 700; color: #57534e;">${__("Notes (optional):")}</label>
							<textarea class="form-control fpos-closing-notes" rows="2" placeholder="${__("Anything to tell the next shift? (optional)")}" style="font-size: 12px; border-radius: 8px;"></textarea>
						</div>
					</div>

					<!-- Order Types & Channels Breakdown -->
					<div style="display: flex; flex-direction: column; gap: 16px;">
						<!-- Order Channels Breakdown -->
						<div style="background: #fff; border-radius: 12px; border: 1px solid #eadfd2; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
							<div style="background: #faf6f0; padding: 12px 16px; font-size: 13px; font-weight: 800; color: #292524; border-bottom: 1px solid #eadfd2; display: flex; justify-content: space-between; align-items: center;">
								<span>${fpos_icon("receipt", "fpos-ic-sm")} ${__("Where Orders Came From")}</span>
								<span style="font-size: 11px; font-weight: 600; color: #78716c;">${(data.order_types || []).length} ${__("Channels")}</span>
							</div>
							<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
								<thead>
									<tr style="background: #fafafa; border-bottom: 1px solid #eadfd2; color: #78716c; text-transform: uppercase; font-size: 10px; font-weight: 700;">
										<th style="padding: 8px 14px; text-align: left;">${__("Channel")}</th>
										<th style="padding: 8px 14px; text-align: center;">${__("Orders")}</th>
										<th style="padding: 8px 14px; text-align: right;">${__("Total Sales")}</th>
									</tr>
								</thead>
								<tbody>${ot_rows}</tbody>
							</table>
						</div>

						<!-- Shift Details Quick Info -->
						<div style="background: #fff; border-radius: 12px; border: 1px solid #eadfd2; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); display: flex; flex-direction: column; gap: 8px;">
							<div style="font-size: 13px; font-weight: 800; color: #292524;">ℹ️ ${__("About This Day")}</div>
							<div style="font-size: 12px; color: #78716c; display: flex; justify-content: space-between;">
								<span>${__("Day started at")}:</span>
								<b style="color: #292524;">${data.shift_start ? frappe.datetime.str_to_user(data.shift_start) : __("Current Session")}</b>
							</div>
							<div style="font-size: 12px; color: #78716c; display: flex; justify-content: space-between;">
								<span>${__("Cashier")}:</span>
								<b style="color: #292524;">${data.user} (${data.user_fullname || ""})</b>
							</div>
							<div style="font-size: 12px; color: #78716c; display: flex; justify-content: space-between;">
								<span>${__("Company")}:</span>
								<b style="color: #292524;">${data.company || ""}</b>
							</div>
							<div style="font-size: 12px; color: #78716c; display: flex; justify-content: space-between;">
								<span>${__("Bills today")}:</span>
								<b style="color: #292524;">${(data.invoices || []).length}</b>
							</div>
						</div>
					</div>
				</div>

				<!-- Top Selling Fast Food Items Table -->
				<div style="background: #fff; border-radius: 12px; border: 1px solid #eadfd2; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
					<div style="background: #faf6f0; padding: 14px 18px; font-size: 14px; font-weight: 800; color: #292524; border-bottom: 1px solid #eadfd2; display: flex; justify-content: space-between; align-items: center;">
						<span>${fpos_icon("chef", "fpos-ic-sm")} ${__("Best Sellers Today")}</span>
						<span style="font-size: 11px; color: #78716c; font-weight: 600;">${(data.top_items || []).length} ${__("Products Ranked")}</span>
					</div>
					<table style="width: 100%; border-collapse: collapse; font-size: 13px;">
						<thead>
							<tr style="background: #fafafa; border-bottom: 1px solid #eadfd2; color: #78716c; text-transform: uppercase; font-size: 10px; font-weight: 700;">
								<th style="padding: 8px 14px; text-align: left;">${__("Rank")}</th>
								<th style="padding: 8px 14px; text-align: left;">${__("Item Description")}</th>
								<th style="padding: 8px 14px; text-align: center;">${__("Quantity Sold")}</th>
								<th style="padding: 8px 14px; text-align: right;">${__("Total Revenue")}</th>
							</tr>
						</thead>
						<tbody>${top_items_html}</tbody>
					</table>
				</div>

				<!-- Today's Transaction Journal (Sales Invoices) Table -->
				<div style="background: #fff; border-radius: 12px; border: 1px solid #eadfd2; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
					<div style="background: #faf6f0; padding: 14px 18px; font-size: 14px; font-weight: 800; color: #292524; border-bottom: 1px solid #eadfd2; display: flex; justify-content: space-between; align-items: center;">
						<span>${fpos_icon("receipt", "fpos-ic-sm")} ${__("Today's Bills")}</span>
						<span style="font-size: 11px; color: #78716c; font-weight: 600;">${invoices.length} ${__("Total Invoices Generated")}</span>
					</div>
					<div style="max-height: 380px; overflow-y: auto;">
						<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
							<thead style="position: sticky; top: 0; background: #fafafa; z-index: 2;">
								<tr style="border-bottom: 1px solid #eadfd2; color: #78716c; text-transform: uppercase; font-size: 10px; font-weight: 700;">
									<th style="padding: 8px 14px; text-align: left;">${__("Invoice Number")}</th>
									<th style="padding: 8px 14px; text-align: left;">${__("Time")}</th>
									<th style="padding: 8px 14px; text-align: left;">${__("Customer")}</th>
									<th style="padding: 8px 14px; text-align: left;">${__("Order Type")}</th>
									<th style="padding: 8px 14px; text-align: right;">${__("Grand Total")}</th>
									<th style="padding: 8px 14px; text-align: center;">${__("Status")}</th>
								</tr>
							</thead>
							<tbody>${inv_rows}</tbody>
						</table>
					</div>
				</div>

				<!-- Bottom Sticky Action Bar -->
				<div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 16px 24px; border-radius: 12px; border: 1px solid #eadfd2; box-shadow: 0 2px 8px rgba(0,0,0,0.05); margin-bottom: 24px;">
					<button class="btn btn-default fpos-back-to-pos-btn" style="font-weight: 700; border-radius: 8px; padding: 8px 18px;">
						<span>← ${__("Back to POS")}</span>
					</button>

					<div style="display: flex; gap: 12px;">
						<button class="btn btn-default fpos-print-closing-btn" style="font-weight: 700; border-radius: 8px; padding: 8px 18px; border: 1px solid #d8cbb8;">
							<span>${fpos_icon("printer", "fpos-ic-sm")} ${__("Print Z-Report")}</span>
						</button>
						<button class="btn btn-danger fpos-exit-desk-btn" style="font-weight: 800; border-radius: 8px; padding: 8px 22px;">
							<span>${fpos_icon("checkCircle", "fpos-ic-sm")} ${__("Close Day")}</span>
						</button>
					</div>
				</div>
			</div>
		`);

		this.bind_closing_page_events(data);
	}

	bind_closing_page_events(data) {
		const $page = this.wrapper.find(".fpos-closing-page");
		const format_curr = (val) => this.format_money(val);

		// Back to POS Register
		$page.on("click", ".fpos-back-to-pos-btn", () => {
			this.hide_closing_page();
		});

		// Realtime Multi-Payment Variance Calculator
		const update_variance = () => {
			let total_exp = 0;
			let total_cnt = 0;

			$page.find(".fpos-recon-row").each(function () {
				const $row = $(this);
				const expected = flt($row.data("expected") || 0);
				const counted_val = $row.find(".fpos-recon-counted-input").val();
				const counted = counted_val === "" ? expected : flt(counted_val);
				const diff = counted - expected;

				total_exp += expected;
				total_cnt += counted;

				const $badge = $row.find(".fpos-mode-variance-badge");
				if (Math.abs(diff) < 0.01) {
					$badge.css({ background: "#dcfce7", color: "#166534" }).text(`● ${__("Exact Match")}`);
				} else if (diff < 0) {
					$badge.css({ background: "#fee2e2", color: "#b91c1c" }).text(`● ${__("Short")}: -${format_curr(Math.abs(diff))}`);
				} else {
					$badge.css({ background: "#fef3c7", color: "#b45309" }).text(`● ${__("Surplus")}: +${format_curr(diff)}`);
				}
			});

			$page.find(".fpos-recon-total-expected").text(format_curr(total_exp));
			$page.find(".fpos-recon-total-counted").text(format_curr(total_cnt));

			const total_diff = total_cnt - total_exp;
			const $tot_badge = $page.find(".fpos-recon-total-variance");
			if (Math.abs(total_diff) < 0.01) {
				$tot_badge.html(`<span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #dcfce7; color: #166534;">● ${__("Balanced")}</span>`);
			} else if (total_diff < 0) {
				$tot_badge.html(`<span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #fee2e2; color: #b91c1c;">● -${format_curr(Math.abs(total_diff))}</span>`);
			} else {
				$tot_badge.html(`<span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #fef3c7; color: #b45309;">● +${format_curr(total_diff)}</span>`);
			}
		};

		$page.on("input", ".fpos-recon-counted-input", () => {
			update_variance();
		});

		// Trigger initial calculation
		update_variance();

		// Print Z-Report
		$page.on("click", ".fpos-print-closing-btn", () => {
			this.print_closing_summary(data);
		});

		// Finalize the day & submit the closing entry
		$page.on("click", ".fpos-exit-desk-btn", () => {
			frappe.confirm(
				__("Are you sure you want to finalize this shift and submit the POS Closing Entry?<br><br>This will consolidate all shift invoices, record counted payments, deduct stock, and post General Ledger entries."),
				() => {
					// Collect payment reconciliation rows
					const recon_data = [];
					$page.find(".fpos-recon-row").each(function () {
						const $row = $(this);
						const mop = $row.data("mode");
						const opening_amt = flt($row.data("opening") || 0);
						const expected_amt = flt($row.data("expected") || 0);
						const counted_val = $row.find(".fpos-recon-counted-input").val();
						const counted_amt = counted_val === "" ? expected_amt : flt(counted_val);
						recon_data.push({
							mode_of_payment: mop,
							opening_amount: opening_amt,
							expected_amount: expected_amt,
							closing_amount: counted_amt,
							difference: counted_amt - expected_amt,
						});
					});

					const closing_notes = $page.find(".fpos-closing-notes").val() || "";

					frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.create_and_submit_pos_closing_entry",
						args: {
							pos_profile: this.pos_profile,
							pos_opening_entry: data.opening_entry || this.pos_opening,
							payments: JSON.stringify(recon_data),
							closing_notes: closing_notes,
						},
						freeze: true,
						freeze_message: __("Consolidating shift and submitting POS Closing Entry..."),
						callback: (r) => {
							sessionStorage.removeItem("fpos_active_profile");
							this.pos_opening = null;
							this.pos_opening_time = null;
							this.pos_opening_entry = null;

							const closing_name = (r.message && (r.message.closing_entry || r.message.name)) || "";
							frappe.msgprint({
								title: __("Shift Closed Successfully"),
								indicator: "green",
								message: __(
									"POS Closing Entry <b><a href='/app/pos-closing-entry/{0}'>{0}</a></b> has been submitted.<br>All shift invoices have been consolidated and inventory/ledger entries posted.",
									[closing_name]
								),
								primary_action_label: __("Go to Desk"),
								primary_action: {
									action() {
										frappe.set_route("");
									},
								},
							});
						},
						error: (err) => {
							frappe.msgprint({
								title: __("Shift Closing Error"),
								indicator: "red",
								message: (err && err.message) || __("Failed to submit POS Closing Entry. Please check error log."),
							});
						},
					});
				}
			);
		});
	}

	print_closing_summary(data) {
		const format_curr = (val) => this.format_money(val);

		const payments_html = (data.payment_modes || []).map(p => `
			<tr>
				<td style="padding:4px 0;">${p.mode_of_payment} (${p.count})</td>
				<td style="text-align:right;padding:4px 0;">${format_curr(p.amount)}</td>
			</tr>
		`).join("") || `<tr><td colspan="2" style="text-align:center;">None</td></tr>`;

		const orders_html = (data.order_types || []).map(ot => `
			<tr>
				<td style="padding:4px 0;">${ot.order_type} (${ot.count})</td>
				<td style="text-align:right;padding:4px 0;">${format_curr(ot.amount)}</td>
			</tr>
		`).join("") || `<tr><td colspan="2" style="text-align:center;">None</td></tr>`;

		// v5.11: fragment for the centered print-preview dialog (wide A4
		// paper). No new tab — the dialog's own Print button prints it.
		const body_html = `
				<div class="text-center bold" style="font-size:16px;">${data.company || "RESTAURANT POS"}</div>
				<div class="text-center" style="font-size:13px;margin:2px 0;">DAILY REGISTER CLOSING (Z-REPORT)</div>
				<div class="divider"></div>
				<div class="row"><span>Profile:</span><span class="bold">${data.pos_profile}</span></div>
				<div class="row"><span>Date:</span><span>${data.today}</span></div>
				<div class="row"><span>Cashier:</span><span>${data.user_fullname || data.user}</span></div>
				<div class="divider"></div>

				<div class="bold" style="margin:4px 0;">SALES TOTALS</div>
				<div class="row"><span>Total Orders:</span><span class="bold">${data.total_orders}</span></div>
				<div class="row"><span>Gross Sales:</span><span>${format_curr(data.gross_sales)}</span></div>
				<div class="row"><span>Discounts:</span><span>-${format_curr(data.total_discounts)}</span></div>
				<div class="row bold" style="font-size:14px;margin-top:4px;"><span>NET TOTAL SALES:</span><span>${format_curr(data.net_sales)}</span></div>
				<div class="divider"></div>

				<div class="bold" style="margin:4px 0;">PAYMENTS BREAKDOWN</div>
				<table>${payments_html}</table>
				<div class="divider"></div>

				<div class="bold" style="margin:4px 0;">ORDER TYPES BREAKDOWN</div>
				<table>${orders_html}</table>
				<div class="divider"></div>

				<div class="bold" style="margin:4px 0;">CASH DRAWER RECONCILIATION</div>
				<div class="row"><span>Opening Cash:</span><span>${format_curr(data.opening_cash)}</span></div>
				<div class="row"><span>Cash Sales:</span><span>${format_curr(data.cash_sales)}</span></div>
				<div class="row bold" style="font-size:13px;margin-top:2px;"><span>EXPECTED CASH:</span><span>${format_curr(data.expected_cash)}</span></div>
				<div class="divider"></div>

				<div style="margin-top:30px;" class="row">
					<div style="border-top:1px solid #000;width:45%;text-align:center;padding-top:4px;">Cashier Sign</div>
					<div style="border-top:1px solid #000;width:45%;text-align:center;padding-top:4px;">Manager Sign</div>
				</div>
				<div class="text-center" style="margin-top:20px;font-size:10px;color:#666;">Generated on ${new Date().toLocaleTimeString()}</div>
		`;

		this.show_print_preview({
			title: __("Z-Report"),
			subtitle: `${data.pos_profile || ""} • ${data.today || ""}`,
			body_html,
			wide: true,
		});
	}

	// ─── v2: Home / Day Open-Close, Tables, Attendance, Daily Report ───
	// All views live inside the POS page (no new frappe.ui.Dialog).

	// Live elapsed time, e.g. "04:37" or "01:12:05" (hh:mm:ss once over an hour).
	format_elapsed(since) {
		if (!since) return "00:00";
		let start = new Date(since);
		if (isNaN(start.getTime())) {
			// Frappe datetimes come as "2026-11-14 09:15:00" — parse as local time.
			start = new Date(String(since).replace(" ", "T"));
		}
		if (isNaN(start.getTime())) return "00:00";
		let secs = Math.max(0, Math.floor((Date.now() - start.getTime()) / 1000));
		const h = Math.floor(secs / 3600); secs -= h * 3600;
		const m = Math.floor(secs / 60); const s = secs - m * 60;
		const pad = (n) => String(n).padStart(2, "0");
		return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
	}

	// One 1-second ticker for every live timer on screen (home day timer +
	// occupied-table timers). Ticks without any page reload.
	start_home_timers() {
		if (this._home_timer) return;
		this._home_timer = setInterval(() => {
			this.wrapper.find("[data-since]").each((_, el) => {
				const $el = $(el);
				$el.text("⏱ " + this.format_elapsed($el.attr("data-since")));
			});
			const $day = this.wrapper.find("#fpos-day-elapsed");
			if ($day.length && $day.attr("data-since")) {
				$day.text(this.format_elapsed($day.attr("data-since")));
			}
		}, 1000);
	}

	// Show exactly one view: "home" | "pos" | "tables" | "attendance" | "report".
	set_view(name) {
		this.current_view = name;
		// v4: each view has exactly one header — on Home/Tables/Attendance/Report
		// the POS topbar hides (those views have their own header + Home button).
		this.wrapper.toggleClass("fpos-view-pos", name === "pos");
		const show = (sel, on) => this.wrapper.find(sel).toggle(!!on);
		show(".fpos-home-view", name === "home");
		show(".fpos-tables-view", name === "tables");
		show(".fpos-attendance-view", name === "attendance");
		show(".fpos-daily-report-view", name === "report");
		show(".fpos-body", name === "pos");
		this.start_home_timers();
	}


	// ── v5.4 (restaurant feel): a home dish photo comes from the cached menu
	// items (same localStorage the POS menu writes) — real ERPNext Item image
	// when set, else a warm gradient tile + big food SVG. Never a bare letter.
	home_cached_items() {
		if (this.items && this.items.length) return this.items;
		try { return JSON.parse(localStorage.getItem(`fpos_items_${this.pos_profile}`) || "[]"); }
		catch (e) { return []; }
	}

	home_dish_photo_html(item_name, fallback_icon) {
		const found = this.home_cached_items().find((i) => i.item_name === item_name);
		if (found && found.item_image) {
			return `<div class="fpos-home-dish-photo" style="background-image:url('${found.item_image}')"></div>`;
		}
		return `<div class="fpos-home-dish-photo fpos-home-dish-fallback">${fpos_icon(fallback_icon || "cloche", "fpos-ic-lg")}</div>`;
	}

	// ── Home screen (the main screen): Sync status, Shift / Day Open state,
	// Day Open time + running elapsed, user-settable Day Start / Day End,
	// four order-type tiles, bottom nav. No dialog is opened to get here.
	async show_home() {
		this.set_view("home");
		const $home = this.wrapper.find(".fpos-home-view");
		let day = { day_open: !!this.pos_opening, day_start_time: "", day_end_time: "", period_start_date: "" };
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_day_status",
				args: { pos_profile: this.pos_profile },
			});
			day = Object.assign(day, res.message || {});
		} catch (e) { console.warn("get_day_status failed:", e); }
		if (day.pos_opening_entry) this.pos_opening = day.pos_opening_entry;
		this.day_open = !!day.day_open;
		this.day_open_time = day.period_start_date || "";

		// v5: "Today at a glance" — reuses the EXISTING daily-report hook
		// (get_daily_report, same endpoint the Reports nav uses). No new
		// server API. On failure the cards render "—" instead of blocking.
		let daily = null;
		try {
			const rres = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_daily_report",
				args: { pos_profile: this.pos_profile },
			});
			daily = rres.message || null;
		} catch (e) { console.warn("get_daily_report failed (home stats):", e); }
		this.home_daily = daily;
		const stat_sales = daily ? (daily.total_sales || 0) : null;
		const stat_orders = daily ? (daily.total_orders || 0) : null;
		const stat_avg = (stat_orders && stat_orders > 0) ? stat_sales / stat_orders : null;
		const stat_top = (daily && daily.top_items && daily.top_items[0]) ? daily.top_items[0] : null;
		// v6.3: on a fresh day with no sales yet, the hero's Chef's Pick
		// still shows the first menu item ("Try it today") so the hero
		// never looks empty.
		const pick_item = stat_top || ((this.home_cached_items() || [])[0] || null);
		const pick_sub = stat_top ? `× ${stat_top.qty} ${__("sold today")}` : __("Try it today");

		const queue = JSON.parse(localStorage.getItem(this.offline_queue_key) || "[]");
		const online = navigator.onLine !== false;
		const sync_label = online
			? (queue.length ? `${queue.length} ${__("pending sync")}` : __("Connected — Synced"))
			: __("Offline — will sync when back online");
		// v3: SVG icons, not emoji, on the home tiles.
		const tiles = [
			{ type: "Walk In", icon: "user", desc: __("Counter orders") },
			{ type: "Take Away", icon: "box", desc: __("Takeaway orders") },
			{ type: "Delivery", icon: "truck", desc: __("Delivery orders") },
			{ type: "Dine In", icon: "table", desc: __("Tables — dine in") },
		];
		// v3: SVG icons, not emoji, on the bottom nav.
		const nav = [
			{ key: "orders", icon: "receipt", label: __("Orders") },
			{ key: "dispatch", icon: "truck", label: __("Dispatch") },
			{ key: "cashier", icon: "cash", label: __("Cashier") },
			{ key: "kds", icon: "chef", label: __("KDS") },
			{ key: "shifts", icon: "clock", label: __("Shifts") },
			{ key: "staff", icon: "users", label: __("Staff") },
			{ key: "attendance", icon: "checkCircle", label: __("Attendance") },
			{ key: "reports", icon: "chart", label: __("Reports") },
			{ key: "printer", icon: "printer", label: __("Printer") },
			{ key: "settings", icon: "settings", label: __("Settings") },
		];
		$home.html(`
			<div class="fpos-home">
				<!-- v5.4: restaurant hero — warm deep-green banner with a time-based
				     greeting, Day Open status, and the Chef's Pick (today's top item
				     with its real photo when the menu cache has one). Sync pill and
				     Day Open state live here now; the shift card below is unchanged. -->
				<div class="fpos-home-hero">
					<span class="fpos-hero-cloche">${fpos_icon("cloche")}</span>
					<div class="fpos-hero-copy">
						<div class="fpos-hero-eyebrow">${__("Main Branch")} &bull; ${this.pos_profile || ""}</div>
						<div class="fpos-hero-greet">${(new Date().getHours() < 12 ? __("Good morning") : new Date().getHours() < 17 ? __("Good afternoon") : __("Good evening"))}, ${__("Chef")}</div>
						<div class="fpos-hero-sub">${day.day_open ? __("The kitchen is open — orders are flowing in.") : __("The kitchen is closed — open the day to start taking orders.")}</div>
						<div class="fpos-hero-pills">
							<button type="button" class="fpos-home-sync fpos-manual-sync-btn ${online ? "online" : "offline"}" title="${__("Tap to retry sync")}"><span class="fpos-sync-dot"></span> ${sync_label}</button>
							<span class="fpos-hero-day ${day.day_open ? "open" : "closed"}">${day.day_open ? __("● Day Open") : __("○ Day Closed")}</span>
						</div>
					</div>
					${pick_item ? `
					<button class="fpos-hero-pick" title="${__("Open menu")}">
						${this.home_dish_photo_html(pick_item.item_name, "pizza")}
						<span class="fpos-hero-pick-body">
							<span class="fpos-hero-pick-label">${__("Chef's Pick")}</span>
							<span class="fpos-hero-pick-name">${pick_item.item_name}</span>
							<span class="fpos-hero-pick-sub">${pick_sub}</span>
						</span>
					</button>` : ""}
				</div>

				<div class="fpos-home-shift">
					<div class="fpos-shift-card">
						<div class="fpos-shift-label">${__("Your Day")}</div>
						<div class="fpos-shift-state ${day.day_open ? "open" : "closed"}">
							${day.day_open ? __("● Day is Open") : __("○ Day is Closed")}
						</div>
						${day.day_open && this.day_open_time ? `
							<div class="fpos-shift-opened">
								${__("Opened at")}: ${this.day_open_time}
								&bull; <span id="fpos-day-elapsed" data-since="${this.day_open_time}">${this.format_elapsed(this.day_open_time)}</span>
							</div>` : `
							<div class="fpos-shift-guide">
								<span><b>1</b>${__("Count the cash in the drawer")}</span>
								<span><b>2</b>${__("Tap Open Day")}</span>
								<span><b>3</b>${__("Start taking orders")}</span>
							</div>`}
						<div class="fpos-shift-times">
							<label>${__("Day starts at")}
								<input type="time" class="fpos-day-start" value="${day.day_start_time || ""}">
							</label>
							<label>${__("Day ends at")}
								<input type="time" class="fpos-day-end" value="${day.day_end_time || ""}">
							</label>
							<button class="fpos-btn fpos-day-times-save">${__("Save")}</button>
						</div>
						<div class="fpos-shift-actions">
							${day.day_open
								? `<button class="fpos-btn fpos-day-close-btn">${__("Close Day")}</button>
								   <div class="fpos-shift-action-sub">${__("See today's sales & print the Z-Report")}</div>`
								: `<button class="fpos-btn fpos-day-open-btn">${__("Open Day")}</button>`}
						</div>
					</div>
				</div>

				<div class="fpos-home-stats">
					<div class="fpos-home-stat">
						<div class="fpos-home-stat-label">${__("Today's Sales")}</div>
						<div class="fpos-home-stat-value fpos-home-stat-gold">${stat_sales === null ? "—" : this.format_money(stat_sales)}</div>
						<div class="fpos-home-stat-sub">${stat_orders === null ? "" : `${stat_orders} ${__("orders today")}`}</div>
					</div>
					<div class="fpos-home-stat">
						<div class="fpos-home-stat-label">${__("Orders")}</div>
						<div class="fpos-home-stat-value">${stat_orders === null ? "—" : stat_orders}</div>
						<div class="fpos-home-stat-sub">${__("today")}</div>
					</div>
					<div class="fpos-home-stat">
						<div class="fpos-home-stat-label">${__("Avg Bill")}</div>
						<div class="fpos-home-stat-value">${stat_avg === null ? "—" : this.format_money(stat_avg)}</div>
						<div class="fpos-home-stat-sub">${__("per order")}</div>
					</div>
					<div class="fpos-home-stat">
						<div class="fpos-home-stat-label">${__("Top Item")}</div>
						<div class="fpos-home-stat-value fpos-home-stat-item">${stat_top ? stat_top.item_name : "—"}</div>
						<div class="fpos-home-stat-sub">${stat_top ? `× ${stat_top.qty} ${__("sold")}` : __("no sales yet")}</div>
					</div>
				</div>

				<div class="fpos-home-tiles">
					${tiles.map((t) => `
						<button class="fpos-home-tile" data-type="${t.type}">
							<span class="fpos-tile-icon">${fpos_icon(t.icon)}</span>
							<span class="fpos-tile-label">${__(t.type)}</span>
							<span class="fpos-tile-desc">${t.desc}</span>
						</button>`).join("")}
				</div>

				${(daily && daily.top_items && daily.top_items.length) ? `
				<div class="fpos-home-popular">
					<div class="fpos-home-popular-head">
						<span class="fpos-home-popular-title">${__("Popular today")}</span>
						<button class="fpos-home-popular-all">${__("Open Menu")} →</button>
					</div>
					<div class="fpos-home-popular-list">
						${daily.top_items.slice(0, 3).map((t) => `
							<button class="fpos-home-popular-card">
								${this.home_dish_photo_html(t.item_name, "plate")}
								<span class="fpos-home-popular-name">${t.item_name}</span>
								<span class="fpos-home-popular-sub">× ${t.qty} ${__("sold")}</span>
							</button>`).join("")}
					</div>
				</div>` : ""}

				<div class="fpos-home-recent">
					<div class="fpos-home-recent-head">
						<span class="fpos-home-recent-title">${__("Recent Orders")}</span>
						<button class="fpos-home-recent-all">${__("View all")}</button>
					</div>
					<div class="fpos-home-recent-list" id="fpos-home-recent-list">
						${this.home_recent_rows_html()}
					</div>
				</div>

				<nav class="fpos-home-nav">
					${nav.map((n) => `
						<button class="fpos-home-nav-item" data-nav="${n.key}">
							<span class="fpos-nav-icon">${fpos_icon(n.icon)}</span>
							<span>${n.label}</span>
						</button>`).join("")}
				</nav>
			</div>
		`);

		// Tiles: start an order of that type (Dine In goes to the floor plan).
		$home.find(".fpos-home-tile").on("click", (e) => {
			this.start_order($(e.currentTarget).data("type"));
		});
		// Day times: user-settable, saved on the POS Opening Entry.
		$home.find(".fpos-day-times-save").on("click", async () => {
			const start = $home.find(".fpos-day-start").val();
			const end = $home.find(".fpos-day-end").val();
			try {
				await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.set_day_times",
					args: { pos_profile: this.pos_profile, day_start_time: start, day_end_time: end },
				});
				frappe.show_alert({ message: __("Day times saved."), indicator: "green" });
			} catch (e) {
				frappe.show_alert({ message: __("Could not save day times: {0}", [e.message]), indicator: "red" });
			}
		});
		$home.find(".fpos-day-open-btn").on("click", () => this.show_opening_shift_dialog());
		$home.find(".fpos-day-close-btn").on("click", () => this.start_day_close());
		// Bottom nav — each item goes to the existing page/drawer or a new view.
		$home.find(".fpos-home-nav-item").on("click", (e) => {
			const key = $(e.currentTarget).data("nav");
			if (key === "orders") this.show_recent_orders_drawer();
			else if (key === "dispatch") this.show_daily_report();
			else if (key === "cashier") this.show_pos();
			else if (key === "kds") this.show_kitchen_drawer();
			else if (key === "shifts") frappe.set_route("List", "POS Opening Entry");
			else if (key === "staff" || key === "attendance") this.show_attendance();
			else if (key === "reports") this.show_daily_report();
			else if (key === "printer") this.show_recent_orders_drawer();
			else if (key === "settings") frappe.set_route("Form", "POS Profile", this.pos_profile);
		});
		// v5.4: Chef's Pick + Popular today open the POS menu.
		$home.find(".fpos-hero-pick, .fpos-home-popular-all, .fpos-home-popular-card").on("click", () => this.show_pos());
		// v5: Recent Orders strip — "View all" + row tap open the existing drawer.
		$home.on("click", ".fpos-home-recent-all", () => this.show_recent_orders_drawer());
		$home.on("click", ".fpos-home-recent-row", () => this.show_recent_orders_drawer());
		// Refresh the strip from the already-fetched Recent Orders data.
		this.load_recent_orders();
	}

	// v5: home "Recent Orders" strip rows — reuses this.recent_orders,
	// already fetched by load_recent_orders(); no new endpoint. Shows
	// the latest 3 so the strip fits above the fixed bottom nav.
	home_recent_rows_html() {
		const orders = (this.recent_orders || []).slice(0, 3);
		if (!orders.length) {
			return `<div class="fpos-home-recent-empty">${__("No orders yet today — new bills will appear here.")}</div>`;
		}
		return orders.map((o) => {
			const is_paid = flt(o.outstanding_amount) <= 0.001;
			const tbl = o.table_no || o.custom_table || o.custom_restaurant_table || "";
			const type = o.order_type || o.custom_order_type || "";
			const meta_bits = [type, tbl ? this.format_table_label(tbl) : "", this.format_time_hh_mm(o.posting_time)].filter(Boolean);
			return `<button class="fpos-home-recent-row" data-order="${o.name}">
				<span class="fpos-home-recent-id">${o.name}</span>
				<span class="fpos-home-recent-cust">${o.customer_name || o.customer || __("Walk-in")}</span>
				<span class="fpos-home-recent-meta">${meta_bits.join(" • ")}</span>
				<span class="fpos-home-recent-amt">${this.format_money(o.grand_total)}</span>
				<span class="fpos-home-recent-pill ${is_paid ? "paid" : "unpaid"}">${is_paid ? "PAID" : "UNPAID"}</span>
			</button>`;
		}).join("");
	}

	// Refresh the home strip whenever Recent Orders data lands.
	render_home_recent_orders() {
		const $list = this.wrapper.find("#fpos-home-recent-list");
		if ($list.length) $list.html(this.home_recent_rows_html());
	}

	// Back to the order screen (menu + cart).
	show_pos() {
		this.set_view("pos");
	}

	// Start an order of a type from the home tiles.
	start_order(order_type) {
		const type = FPOS_ORDER_TYPES.includes(order_type) ? order_type : "Walk In";
		if (type === "Dine In") {
			this.show_tables();
			return;
		}
		this.order_type = type;
		this.update_order_type_ui();
		this.create_new_tab(type, null, "", true);
		this.show_pos();
	}

	// ── Tables — floor plan with a realistic look: table shape + chairs,
	// capacity, section, live status colours, live timer, guests, tap to open.
	async show_tables() {
		this.set_view("tables");
		const $view = this.wrapper.find(".fpos-tables-view");
		$view.html(`<div class="fpos-tables-loading">${__("Loading tables...")}</div>`);
		let tables = [];
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_available_tables",
				args: { pos_profile: this.pos_profile },
			});
			tables = res.message || [];
		} catch (e) {
			$view.html(`<div class="fpos-tables-loading">${__("Could not load tables: {0}", [e.message])}</div>`);
			return;
		}
		this.tables = tables;
		const sections = [...new Set(tables.map((t) => t.section || __("Main Hall")))];
		const status_class = (s) => ({
			"Available": "available", "Occupied": "occupied",
			"Reserved": "reserved", "Cleaning": "cleaning",
		})[s] || "available";
		$view.html(`
			<div class="fpos-floor">
				<div class="fpos-floor-head">
					<div>
						<div class="fpos-floor-title">${__("Dine-In — Tables")}</div>
						<div class="fpos-floor-sub">${tables.length} ${__("tables")} &bull; ${tables.filter((t) => t.status === "Occupied").length} ${__("occupied")} &bull; ${__("Main Branch")}</div>
					</div>
					<div class="fpos-floor-actions">
						<button class="fpos-btn fpos-floor-home">${fpos_icon("home", "fpos-ic-sm")} ${__("Home")}</button>
						<button class="fpos-btn fpos-floor-edit">${fpos_icon("settings", "fpos-ic-sm")} ${__("Edit Layout")}</button>
					</div>
				</div>
				${sections.map((sec) => `
					<div class="fpos-floor-section">
						<div class="fpos-floor-section-title">${sec}</div>
						<div class="fpos-floor-grid">
							${tables.filter((t) => (t.section || __("Main Hall")) === sec).map((t) => {
								const occupied = t.status === "Occupied";
								// v3: realistic round wooden table — chairs left/right (2-4 by
								// capacity), pedestal under the top, status pill + dot, live timer.
								const cap = Math.max(2, t.capacity || 4);
								const pill_icon = t.status === "Available" ? "checkCircle" : t.status === "Occupied" ? "people" : t.status === "Reserved" ? "star" : "clock";
								return `
								<button class="fpos-table-card fpos-table-${status_class(t.status)}" data-table="${t.name}">
									<span class="fpos-table-dot ${status_class(t.status)}"></span>
									<span class="fpos-table-scene">
										<span class="fpos-chair fpos-chair-left"></span>
										<span class="fpos-table-top">${t.table_no || t.name}</span>
										<span class="fpos-chair fpos-chair-right"></span>
										<span class="fpos-table-pedestal"></span>
									</span>
									<span class="fpos-table-num">${__("Table")} ${t.table_no || t.name}</span>
									<span class="fpos-table-status-pill ${status_class(t.status)}">${fpos_icon(pill_icon)} ${__(t.status)}</span>
									${occupied && t.occupied_since ? `<span class="fpos-table-time" data-since="${t.occupied_since}">${fpos_icon("timer", "fpos-ic-sm")} ${this.format_elapsed(t.occupied_since)}</span>` : ""}
									<span class="fpos-table-meta2">${cap} ${__("seats")}${t.guests ? ` &bull; ${__("Guests")}: ${t.guests}` : ""}${t.order_id ? ` &bull; ${t.order_id}` : ""}</span>
								</button>`;
							}).join("")}
						</div>
					</div>`).join("")}
				<div class="fpos-floor-legend">
					<span><i class="dot available"></i> ${__("Available")}</span>
					<span><i class="dot occupied"></i> ${__("Occupied")}</span>
					<span><i class="dot reserved"></i> ${__("Reserved")}</span>
					<span><i class="dot cleaning"></i> ${__("Cleaning")}</span>
				</div>
			</div>
		`);
		$view.find(".fpos-floor-home").on("click", () => this.show_home());
		$view.find(".fpos-floor-edit").on("click", () => frappe.set_route("List", "Restaurant Table"));
		$view.find(".fpos-table-card").on("click", (e) => {
			const name = $(e.currentTarget).data("table");
			const table = (this.tables || []).find((t) => t.name === name);
			if (table) this.open_table_order(table);
		});
		this.start_home_timers();
	}

	// Light refresh of the tables view after a confirm/settle (no full reload).
	render_tables_view() {
		if (this.current_view === "tables") this.show_tables();
	}

	// Tap a table → open its order (or start a new Dine-In order on it).
	open_table_order(table) {
		this.order_type = "Dine In";
		this.selected_table = table.name;
		this.selected_table_no = table.table_no || "";
		if (table.order_id) this.pos_order_id = table.order_id;
		this.create_new_tab("Dine In", table.name, table.table_no || "", true);
		this.update_order_type_ui();
		this.show_pos();
	}

	// ── Staff Attendance — inline controls inside the POS page (no dialog).
	// One row per staff per day, tied to the Day Open/Close day.
	async show_attendance() {
		this.set_view("attendance");
		const $view = this.wrapper.find(".fpos-attendance-view");
		$view.html(`<div class="fpos-tables-loading">${__("Loading attendance...")}</div>`);
		let data = { date: "", rows: [], note: "" };
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_staff_attendance",
				args: { pos_profile: this.pos_profile },
			});
			data = res.message || data;
		} catch (e) {
			$view.html(`<div class="fpos-tables-loading">${__("Could not load attendance: {0}", [e.message])}</div>`);
			return;
		}
		const rows = data.rows || [];
		$view.html(`
			<div class="fpos-attendance">
				<div class="fpos-floor-head">
					<div>
						<div class="fpos-floor-title">${__("Staff Attendance")}</div>
						<div class="fpos-floor-sub">${data.date || ""} &bull; ${rows.length} ${__("staff")} &bull; ${__("Main Branch")}</div>
					</div>
					<button class="fpos-btn fpos-att-home">${fpos_icon("home", "fpos-ic-sm")} ${__("Home")}</button>
				</div>
				${data.note ? `<div class="fpos-att-note">${data.note}</div>` : ""}
				<div class="fpos-att-mark">
					<input class="fpos-att-name" placeholder="${__("Staff name")}">
					<button class="fpos-btn fpos-att-checkin">${__("Check In")}</button>
					<button class="fpos-btn fpos-att-checkout">${__("Check Out")}</button>
					<button class="fpos-btn fpos-att-absent">${__("Absent")}</button>
				</div>
				<table class="fpos-att-table">
					<thead><tr><th>${__("Staff")}</th><th>${__("Status")}</th><th>${__("Check In")}</th><th>${__("Check Out")}</th><th></th></tr></thead>
					<tbody>
						${rows.length ? rows.map((r) => `
							<tr>
								<td>${r.staff_name || ""}</td>
								<td>${__(r.status || "")}</td>
								<td>${r.check_in || "—"}</td>
								<td>${r.check_out || "—"}</td>
								<td>${r.check_in && !r.check_out ? `<button class="fpos-btn fpos-att-row-out" data-name="${r.staff_name}">${__("Check Out")}</button>` : ""}</td>
							</tr>`).join("") : `<tr><td colspan="5" style="text-align:center;color:#78716c;">${__("No attendance marked yet today.")}</td></tr>`}
					</tbody>
				</table>
			</div>
		`);
		const mark = async (action) => {
			const name = $view.find(".fpos-att-name").val().trim();
			if (!name) { frappe.show_alert({ message: __("Enter a staff name first."), indicator: "orange" }); return; }
			try {
				await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.mark_staff_attendance",
					args: { staff_name: name, action },
				});
				frappe.show_alert({ message: __("Attendance saved for {0}.", [name]), indicator: "green" });
				this.show_attendance();
			} catch (e) {
				frappe.show_alert({ message: __("Could not save attendance: {0}", [e.message]), indicator: "red" });
			}
		};
		$view.find(".fpos-att-home").on("click", () => this.show_home());
		$view.find(".fpos-att-checkin").on("click", () => mark("check_in"));
		$view.find(".fpos-att-checkout").on("click", () => mark("check_out"));
		$view.find(".fpos-att-absent").on("click", () => mark("absent"));
		$view.find(".fpos-att-row-out").on("click", async (e) => {
			const name = $(e.currentTarget).data("name");
			try {
				await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.mark_staff_attendance",
					args: { staff_name: name, action: "check_out" },
				});
				this.show_attendance();
			} catch (err) {
				frappe.show_alert({ message: __("Could not check out: {0}", [err.message]), indicator: "red" });
			}
		});
	}

	// ── Daily Orders Report — POS-page section (simpler + reliable than a
	// full Frappe report; data from get_daily_report, which reuses the
	// closing-details queries where possible).
	async show_daily_report() {
		this.set_view("report");
		const $view = this.wrapper.find(".fpos-daily-report-view");
		$view.html(`<div class="fpos-tables-loading">${__("Loading daily report...")}</div>`);
		let r = null;
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_daily_report",
				args: { pos_profile: this.pos_profile },
			});
			r = res.message || null;
		} catch (e) {
			$view.html(`<div class="fpos-tables-loading">${__("Could not load report: {0}", [e.message])}</div>`);
			return;
		}
		if (!r) { $view.html(`<div class="fpos-tables-loading">${__("No report data.")}</div>`); return; }
		const money = (v) => this.format_money(v || 0);
		$view.html(`
			<div class="fpos-report">
				<div class="fpos-floor-head">
					<div>
						<div class="fpos-floor-title">${__("Daily Orders Report")}</div>
						<div class="fpos-floor-sub">${r.date || ""} &bull; ${__("Main Branch")}</div>
					</div>
					<button class="fpos-btn fpos-report-home">${fpos_icon("home", "fpos-ic-sm")} ${__("Home")}</button>
				</div>
				<div class="fpos-report-cards">
					<div class="fpos-report-card"><div class="fpos-rc-label">${__("Total Orders")}</div><div class="fpos-rc-value">${r.total_orders || 0}</div></div>
					<div class="fpos-report-card"><div class="fpos-rc-label">${__("Total Sales")}</div><div class="fpos-rc-value">${money(r.total_sales)}</div></div>
					<div class="fpos-report-card"><div class="fpos-rc-label">${__("Pending KOTs")}</div><div class="fpos-rc-value">${r.pending_kot_count || 0}</div></div>
					<div class="fpos-report-card"><div class="fpos-rc-label">${__("Staff Present")}</div><div class="fpos-rc-value">${(r.attendance && r.attendance.present) || 0} / ${(r.attendance && r.attendance.total) || 0}</div></div>
				</div>
				<div class="fpos-report-cols">
					<div class="fpos-report-col">
						<div class="fpos-report-h">${__("Orders by Type")}</div>
						${Object.entries(r.by_order_type || {}).map(([k, v]) => `<div class="fpos-report-row"><span>${k}</span><span>${v.orders} &bull; ${money(v.sales)}</span></div>`).join("") || `<div class="fpos-report-row">${__("No orders yet.")}</div>`}
						<div class="fpos-report-h" style="margin-top:16px;">${__("Payment Modes")}</div>
						${Object.entries(r.payment_modes || {}).map(([k, v]) => `<div class="fpos-report-row"><span>${k}</span><span>${v.invoices} &bull; ${money(v.amount)}</span></div>`).join("") || `<div class="fpos-report-row">${__("No payments yet.")}</div>`}
					</div>
					<div class="fpos-report-col">
						<div class="fpos-report-h">${__("Top Items Sold")}</div>
						${(r.top_items || []).map((i) => `<div class="fpos-report-row"><span>${i.item_name} × ${i.qty}</span><span>${money(i.amount)}</span></div>`).join("") || `<div class="fpos-report-row">${__("No items sold yet.")}</div>`}
						<div class="fpos-report-h" style="margin-top:16px;">${__("Pending Dine-In Payments")}</div>
						${(r.pending_tables || []).length
							? r.pending_tables.map((t) => `<div class="fpos-report-row"><span>${__("Table")} ${t.table} &bull; ${__(t.status)}${t.occupied_since ? ` &bull; <span data-since="${t.occupied_since}">⏱ ${this.format_elapsed(t.occupied_since)}</span>` : ""}</span><span>${t.guests ? __("Guests") + ": " + t.guests : ""}</span></div>`).join("")
							: `<div class="fpos-report-row">${__("No pending dine-in tables.")}</div>`}
					</div>
				</div>
			</div>
		`);
		$view.find(".fpos-report-home").on("click", () => this.show_home());
		this.start_home_timers();
	}

	// Day Close — reuses the existing PIN-gated close-register flow, which
	// opens the closing page / Z-report. Closing never deletes data.
	start_day_close() {
		frappe.confirm(
			__("Close the day? Today's sales will be counted and the day will end."),
			() => {
				this.prompt_manager_pin({
					action_type: "Close Register",
					title: __("Manager PIN — Close Day"),
					details: __("Only a manager can close the day. Please enter the manager PIN."),
					on_success: () => { this.show_closing_page(); },
				});
			}
		);
	}

	// v2 thermal: kitchen slip (KOT parchi) — 80mm/58mm monospace, printed
	// automatically when an order is confirmed, so the kitchen gets paper
	// as well as the live KDS ticket.
	// v5.10: open the paper KOT slip in a new tab — NEVER auto-print.
	// Any print dialog opened automatically on Confirm blocked the whole
	// POS tab (v5.9 proved even in-tab print() does it), so the slip only
	// opens from the drawer's Print button, with a manual Print button
	// inside it. Same pattern as the customer bill (print_pos_slip).
	open_kot_slip(msg, order_payload) {
		const kot = (msg && (msg.kot_name || msg.kot)) || this.linked_kot_id || "";
		const items = (order_payload && order_payload.items) || this.cart_items || [];
		if (!items.length) return;
		const lines = items.map((i) => {
			const qty = i.qty || 1;
			const name = (i.item_name || i.item_code || "").toUpperCase();
			const note = i.item_note ? `  (${i.item_note})` : "";
			return `<div class="row"><span>${qty} x ${name}${note}</span></div>`;
		}).join("");
		// v5.11: fragment for the centered print-preview dialog (styles
		// live in .fpos-print-area). No new tab — the dialog's own Print
		// button does the printing.
		const body_html = `
				<div class="center bold big">*** KITCHEN TICKET ***</div>
				<div class="center bold">${kot || ""}</div>
				<div class="divider"></div>
				<div class="row"><span>Order:</span><span class="bold">${(msg && msg.order_id) || this.pos_order_id || ""}</span></div>
				<div class="row"><span>Type:</span><span class="bold">${order_payload.order_type || this.order_type}</span></div>
				${order_payload.table ? `<div class="row"><span>Table:</span><span class="bold">${order_payload.table}</span></div>` : ""}
				<div class="row"><span>Time:</span><span>${new Date().toLocaleString()}</span></div>
				<div class="divider"></div>
				${lines}
				<div class="divider"></div>
				${order_payload.order_note ? `<div>Note: ${order_payload.order_note}</div>` : ""}
				<div class="center" style="margin-top:8px;">— ${__("Please prepare") } —</div>
		`;
		this.show_print_preview({
			title: __("Kitchen Ticket"),
			subtitle: kot || "",
			body_html,
		});
	}

	// Backwards-compatible alias (old callers, if any, get the manual slip).
	print_kot_slip(msg, order_payload) { return this.open_kot_slip(msg, order_payload); }

	refresh() {
		if (this.pos_profile) {
			this.load_data();
		}
	}
};
