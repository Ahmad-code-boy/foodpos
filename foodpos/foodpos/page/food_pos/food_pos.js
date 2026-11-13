/**
 * Food POS - Restaurant Point of Sale for Frappe & ERPNext v16
 * Handles Cart, Offline Sync Queue, Table Floor Management, KOTs, and Invoicing.
 */

frappe.provide("foodpos.FoodPOS");

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
		this.current_view = "pos"; // "pos" | "closing" | "payment"
		this.search_term = "";
		this.tables = [];

		// Cart state
		this.order_type = "Dine In"; // Dine In | Takeaway | Delivery
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
				<div class="fpos-spinner" style="width:36px;height:36px;border:3px solid #e2e8f0;border-top-color:#f97316;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#64748b;font-size:14px;">${__("Loading Food POS environment...")}</span>
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
						<div style="font-size:48px;margin-bottom:12px;">⚠️</div>
						<h3>${__("No POS Profile Found")}</h3>
						<p style="color:#64748b;margin:12px 0 20px;">${__("Please create or assign a POS Profile for your user in ERPNext to begin sales operations.")}</p>
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

			// 4. On every fresh load (or when no active shift is in session), show the branch selector
			this.render_profile_selection_dialog(profiles, false);
		} catch (err) {
			console.error(err);
			frappe.show_alert({ message: __("Failed to initialize POS profile"), indicator: "red" });
		}
	}

	render_profile_selection_dialog(profiles, can_close = false) {
		// Ensure only one instance of the register dialog ever exists
		if (this.branch_select_dialog) {
			try {
				this.branch_select_dialog.hide();
				this.branch_select_dialog.$wrapper.remove();
				this.branch_select_dialog.destroy();
			} catch (e) {}
			this.branch_select_dialog = null;
		}
		$(".modal:contains('Select POS Register & Branch')").closest(".modal").remove();
		$(".modal-backdrop").remove();
		$("body").removeClass("modal-open");

		const options = (profiles || []).map((p) => ({
			label: p.custom_branch
				? `📍 ${p.custom_branch} — ${p.name}${p.has_open_shift ? ` (${__("🟢 Shift Active")})` : ` (${__("⚪ Closed")})`}`
				: `${p.name}${p.has_open_shift ? ` (${__("🟢 Shift Active")})` : ` (${__("⚪ Closed")})`}`,
			value: p.name,
		}));
		const last_profile = sessionStorage.getItem("fpos_active_profile") || localStorage.getItem("fpos_last_profile");
		const active_profile = (last_profile && profiles.some((p) => p.name === last_profile && p.has_open_shift))
			? last_profile
			: (profiles.find((p) => p.has_open_shift) ? profiles.find((p) => p.has_open_shift).name : (options[0] ? options[0].value : ""));
		let selected_profile = active_profile;

		// Build interactive branch cards for effortless mouse clicking
		const cards_html = `
			<div class="fpos-branch-cards-grid" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
				${(profiles || []).map((p) => {
					const is_sel = p.name === selected_profile;
					const b_name = p.custom_branch || p.name;
					const badge = p.has_open_shift
						? `<span style="background:#ecfdf5;color:#059669;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;">🟢 Active Shift</span>`
						: `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;">⚪ Closed</span>`;
					return `
						<div class="fpos-branch-card-row ${is_sel ? "selected" : ""}" data-profile="${p.name}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:2px solid ${is_sel ? "#ea580c" : "#e2e8f0"};border-radius:10px;cursor:pointer;background:${is_sel ? "#fff7ed" : "#ffffff"};transition:all .15s ease;">
							<div style="display:flex;align-items:center;gap:10px;">
								<span style="font-size:20px;">📍</span>
								<div>
									<div style="font-weight:700;font-size:13.5px;color:#1e293b;">${b_name}</div>
									<div style="font-size:11.5px;color:#64748b;">${p.name}</div>
								</div>
							</div>
							<div>${badge}</div>
						</div>
					`;
				}).join("")}
			</div>
		`;

		const me = this;
		const d = new frappe.ui.Dialog({
			title: __("Select POS Register & Branch"),
			fields: [
				{
					fieldname: "pos_profile",
					fieldtype: "Select",
					label: __("Select Branch POS Profile"),
					options: options,
					default: selected_profile,
					description: __("Select your branch and register profile to begin"),
				},
				{
					fieldname: "branch_cards_html",
					fieldtype: "HTML",
					options: cards_html,
				},
			],
			primary_action_label: __("Select Branch / Open Register"),
			primary_action: async (values) => {
				const prof = (values && values.pos_profile) || selected_profile || d.get_value("pos_profile");
				if (!prof) {
					frappe.msgprint(__("Please select a POS Profile."));
					return;
				}
				d.hide();
				await this.select_pos_profile(prof);
			},
		});

		this.style_dialog(d);
		this.branch_select_dialog = d;

		// Attach mouse handlers to branch cards
		d.$wrapper.on("click", ".fpos-branch-card-row", function () {
			const prof = $(this).data("profile");
			selected_profile = prof;
			d.set_value("pos_profile", prof);
			try {
				d.get_field("pos_profile").$input.val(prof);
			} catch (e) {}
			d.$wrapper.find(".fpos-branch-card-row").each(function () {
				const cur_prof = $(this).data("profile");
				const match = cur_prof === prof;
				$(this).toggleClass("selected", match);
				$(this).css({
					"border-color": match ? "#ea580c" : "#e2e8f0",
					"background-color": match ? "#fff7ed" : "#ffffff",
				});
			});
		});

		// Double click triggers selection immediately
		d.$wrapper.on("dblclick", ".fpos-branch-card-row", function () {
			const prof = $(this).data("profile");
			selected_profile = prof;
			d.hide();
			me.select_pos_profile(prof);
		});

		// Sync select field changes back to card highlights (supports change, input, click, mousedown, and option selection)
		const apply_profile_selection = (prof) => {
			if (!prof) return;
			selected_profile = prof;
			d.set_value("pos_profile", prof);
			try {
				d.get_field("pos_profile").$input.val(prof);
			} catch (e) {}
			d.$wrapper.find(".fpos-branch-card-row").each(function () {
				const cur_prof = $(this).data("profile");
				const match = cur_prof === prof;
				$(this).toggleClass("selected", match);
				$(this).css({
					"border-color": match ? "#ea580c" : "#e2e8f0",
					"background-color": match ? "#fff7ed" : "#ffffff",
				});
			});
		};

		d.$wrapper.on("change input click", "select[data-fieldname='pos_profile']", function () {
			apply_profile_selection($(this).val());
		});

		d.$wrapper.on("click mousedown", "select[data-fieldname='pos_profile'] option", function () {
			const prof = $(this).val() || $(this).attr("value");
			apply_profile_selection(prof);
		});

		if (!can_close) {
			d.get_close_btn().hide();
		} else {
			d.get_close_btn().show();
		}
		d.show();
	}

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
			this.branch = this.profile_data.custom_branch || this.profile_data.branch || "";

			// Cache profile config locally
			localStorage.setItem(`fpos_profile_${this.pos_profile}`, JSON.stringify(this.profile_data));

			// Unfreeze freeze overlay BEFORE shift check so opening shift dialog can display cleanly
			clearTimeout(safety_timer);
			this._force_unfreeze();

			// Standard v16 POS Shift Check / Creation Workflow
			const shift_active = await this.init_pos_shift();
			if (!shift_active) {
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
			console.error("Error switching branch profile:", err);
			// Offline fallback
			const cached = localStorage.getItem(`fpos_profile_${this.pos_profile}`);
			if (cached) {
				this.profile_data = JSON.parse(cached);
				this.customer = this.profile_data.customer || "";
				this.branch = this.profile_data.custom_branch || this.profile_data.branch || "";
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
				// No active shift: show standard Create POS Opening Entry dialog
				this.show_opening_shift_dialog();
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

		// Show informative placeholder in main view while shift opening dialog is open
		this.wrapper.html(`
			<div class="fpos-shift-pending" style="display:flex;align-items:center;justify-content:center;height:65vh;flex-direction:column;gap:14px;color:#475569;">
				<div style="font-size:42px;">📋</div>
				<div style="font-size:16px;font-weight:700;color:#1e293b;">${__("Register Shift Not Open")}</div>
				<p style="font-size:13px;color:#64748b;max-width:380px;text-align:center;margin:0;">${__("Please enter opening float cash in the dialog to start sales operations for {0}.", [this.branch || this.pos_profile])}</p>
				<button class="btn btn-primary btn-sm fpos-reopen-shift-dialog-btn" style="margin-top:6px;font-weight:600;">🔄 ${__("Open Shift Dialog")}</button>
			</div>
		`);
		this.wrapper.find(".fpos-reopen-shift-dialog-btn").on("click", () => {
			this.show_opening_shift_dialog();
		});

		// Build table rows from profile payments
		let balance_data = [];
		const payments = (this.profile_data && this.profile_data.payments) || [];
		if (payments.length) {
			balance_data = payments.map((p) => ({
				mode_of_payment: p.mode_of_payment,
				opening_amount: 0,
			}));
		} else {
			balance_data = [{ mode_of_payment: "Cash", opening_amount: 0 }];
		}

		const table_fields = [
			{
				fieldname: "mode_of_payment",
				fieldtype: "Link",
				in_list_view: 1,
				label: __("Mode of Payment"),
				options: "Mode of Payment",
				reqd: 1,
			},
			{
				fieldname: "opening_amount",
				fieldtype: "Currency",
				in_list_view: 1,
				label: __("Opening Amount"),
				options: "company:company_currency",
				default: 0,
			},
		];

		const profile_options = (this.available_profiles || []).map((p) => ({
			label: p.custom_branch ? `📍 ${p.custom_branch} — ${p.name}` : p.name,
			value: p.name,
		}));

		const dialog = new frappe.ui.Dialog({
			title: __("Create POS Opening Entry"),
			fields: [
				{
					fieldtype: "Link",
					label: __("Company"),
					default: company,
					options: "Company",
					fieldname: "company",
					reqd: 1,
				},
				{
					fieldtype: "Select",
					label: __("POS Profile"),
					options: profile_options,
					fieldname: "pos_profile",
					default: me.pos_profile,
					reqd: 1,
					change: async () => {
						const selected_prof = dialog.get_value("pos_profile");
						if (selected_prof && selected_prof !== me.pos_profile) {
							dialog.hide();
							await me.select_pos_profile(selected_prof);
						}
					},
				},
				{
					fieldname: "balance_details",
					fieldtype: "Table",
					label: __("Opening Balance Details (Float Cash)"),
					cannot_add_rows: false,
					in_place_edit: true,
					reqd: 1,
					data: balance_data,
					fields: table_fields,
				},
			],
			primary_action_label: __("Open Shift"),
			secondary_action_label: __("Switch Branch / Cancel"),
			secondary_action: () => {
				dialog.hide();
				sessionStorage.removeItem("fpos_active_profile");
				me.render_profile_selection_dialog(me.available_profiles, false);
			},
			primary_action: async function ({ company, pos_profile, balance_details }) {
				if (!balance_details || !balance_details.length) {
					frappe.show_alert({
						message: __("Please add Mode of Payment and opening balance details."),
						indicator: "red",
					});
					return;
				}

				balance_details = balance_details.filter((d) => d.mode_of_payment);

				frappe.dom.freeze(__("Creating POS Opening Entry..."));
				try {
					const res = await frappe.call({
						method: "foodpos.foodpos.page.food_pos.food_pos.create_opening_voucher",
						args: { pos_profile, company, balance_details: JSON.stringify(balance_details) },
					});
					frappe.dom.unfreeze();

					if (res && res.message) {
						me.pos_opening = res.message.name;
						me.pos_opening_time = res.message.period_start_date;
						me.pos_opening_entry = res.message;
						sessionStorage.setItem("fpos_active_profile", me.pos_profile);
						frappe.show_alert({
							message: __("Shift opened successfully: {0}", [me.pos_opening]),
							indicator: "green",
						});
						me.setup_listener_for_pos_closing();
						dialog.hide();

						// Proceed with rendering app
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
					}
				} catch (e) {
					frappe.dom.unfreeze();
					frappe.msgprint({
						title: __("Failed to Open Shift"),
						indicator: "red",
						message: e.message || __("Error creating POS Opening Entry"),
					});
				}
			},
		});

		dialog.get_close_btn().show().on("click", () => {
			dialog.hide();
			sessionStorage.removeItem("fpos_active_profile");
			me.render_profile_selection_dialog(me.available_profiles, false);
		});

		this.style_dialog(dialog);
		dialog.show();
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
		let icon = "🍴";
		let badge_color = "#475569";
		let badge_bg = "#f1f5f9";

		if (/burger|cheeseburger|whopper|patty|zinger|beef burger|chicken burger|smashburger|slider|bun/.test(text)) {
			category = "Burgers";
			icon = "🍔";
			badge_color = "#c2410c";
			badge_bg = "#ffedd5";
		} else if (/pizza|slice|calzone|pepperoni|margherita|crust|mozzarella pizza/.test(text)) {
			category = "Pizzas";
			icon = "🍕";
			badge_color = "#b91c1c";
			badge_bg = "#fee2e2";
		} else if (/sandwich|wrap|roll|sub|panini|club sandwich|shawarma|taco|burrito|quesadilla|gyro|frankie/.test(text)) {
			category = "Sandwiches & Wraps";
			icon = "🥪";
			badge_color = "#047857";
			badge_bg = "#d1fae5";
		} else if (/fries|french fry|wedges|onion ring|nugget|tenders|wings|popcorn chicken|garlic bread|dip|sauce|strips|side|appetizer/.test(text)) {
			category = "Sides & Fries";
			icon = "🍟";
			badge_color = "#b45309";
			badge_bg = "#fef3c7";
		} else if (/drink|beverage|shake|smoothie|soda|cola|pepsi|coke|sprite|fanta|coffee|tea|latte|juice|water|mojito|lemonade|espresso|cappuccino/.test(text)) {
			category = "Drinks & Shakes";
			icon = "🥤";
			badge_color = "#0369a1";
			badge_bg = "#e0f2fe";
		} else if (/combo|deal|meal|box|family pack|feast|platter|bucket|duo|trio/.test(text)) {
			category = "Combos & Deals";
			icon = "🍱";
			badge_color = "#7c3aed";
			badge_bg = "#ede9fe";
		} else if (/dessert|cake|pie|ice cream|brownie|cookie|sundae|donut|pastry|churro|waffle|pancake|muffin/.test(text)) {
			category = "Desserts";
			icon = "🍰";
			badge_color = "#be185d";
			badge_bg = "#fce7f3";
		} else if (item.item_group && item.item_group !== "All Item Groups" && item.item_group !== "Products") {
			category = item.item_group;
			icon = "🍴";
			badge_color = "#475569";
			badge_bg = "#f1f5f9";
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
			const branch = this.branch || (this.profile_data && this.profile_data.custom_branch) || "";
			const [items_res, tables_res] = await Promise.all([
				frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_items",
					args: { pos_profile: this.pos_profile, page_length: 200 },
				}),
				frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_available_tables",
					args: { pos_profile: this.pos_profile, branch: branch },
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
		const branch_name = this.branch || (this.profile_data && this.profile_data.custom_branch) || "Main Branch";
		const shift_label = this.pos_opening || __("Shift Open");

		this.wrapper.html(`
			<div class="fpos-wrapper">
				<!-- Zone 1: Slim Header Bar (Max 6 Elements) -->
				<header class="fpos-topbar">
					<div class="fpos-header-left">
						<!-- Element 1: Food POS Brand once -->
						<div class="fpos-brand">
							<span class="fpos-brand-icon">🍔</span>
							<span class="fpos-brand-name">Food POS</span>
						</div>

						<!-- Element 2: Combined branch/register chip once -->
						<button class="fpos-combined-chip fpos-switch-profile-btn" title="${__("Click to switch branch or register")}">
							<span class="fpos-chip-branch">📍 ${branch_name}</span>
							<span class="fpos-chip-sep">•</span>
							<span class="fpos-chip-shift">${shift_label}</span>
							<span class="fpos-chip-sep">•</span>
							<span class="fpos-chip-status">${__("Open")}</span>
						</button>
					</div>

					<div class="fpos-header-center">
						<!-- Element 3: 3-Segmented order-type control -->
						<div class="fpos-segmented-control">
							<button class="fpos-ot-tab ${this.order_type === "Dine In" ? "active" : ""}" data-type="Dine In">${__("Dine-In")}</button>
							<button class="fpos-ot-tab ${this.order_type === "Takeaway" ? "active" : ""}" data-type="Takeaway">${__("Takeaway")}</button>
							<button class="fpos-ot-tab ${this.order_type === "Delivery" ? "active" : ""}" data-type="Delivery">${__("Delivery")}</button>
						</div>
					</div>

					<div class="fpos-header-right">
						<!-- Element 4: Held Orders button with count badge -->
						<button class="fpos-held-orders-btn" title="${__("Held Orders")}">
							<span>⏸️ ${__("Held")}</span>
							<span class="fpos-held-badge" style="display:none;">0</span>
						</button>

						<!-- Element 5: Small Online/Offline status dot (non-clickable indicator) -->
						<div class="fpos-status-dot" title="${__("Online — Connected")}">
							<span class="fpos-dot"></span>
						</div>

						<!-- Element 6: Single More overflow menu -->
						<div class="fpos-more-dropdown-wrapper">
							<button class="fpos-more-btn" id="fpos-more-menu-btn" title="${__("More Actions")}">
								<span>⋮</span>
								<span>${__("More")}</span>
							</button>
							<div class="fpos-more-menu" style="display:none;">
								<button class="fpos-menu-item fpos-new-tab-btn" style="font-weight:700;color:#ea580c;">
									<span class="fpos-menu-icon">➕</span>
									<span>${__("New Order Tab")}</span>
								</button>
								<button class="fpos-menu-item fpos-kitchen-track-btn">
									<span class="fpos-menu-icon">🧑‍🍳</span>
									<span>${__("Kitchen")}</span>
									<span class="fpos-kot-badge" style="display:none;background:#ea580c;color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:auto;">0</span>
								</button>
								<button class="fpos-menu-item fpos-recent-orders-btn">
									<span class="fpos-menu-icon">🧾</span>
									<span>${__("Recent Orders")}</span>
								</button>
								<button class="fpos-menu-item fpos-exceptions-btn" style="color:#b91c1c;">
									<span class="fpos-menu-icon">🚨</span>
									<span>${__("Served Exceptions")}</span>
									<span class="fpos-exceptions-badge" style="display:none;background:#dc2626;color:#fff;font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700;margin-left:auto;">0</span>
								</button>
								<button class="fpos-menu-item fpos-refresh-btn">
									<span class="fpos-menu-icon">🔄</span>
									<span>${__("Refresh")}</span>
								</button>
								<button class="fpos-menu-item fpos-switch-branch-btn">
									<span class="fpos-menu-icon">📍</span>
									<span>${__("Switch Branch")}</span>
								</button>
								<button class="fpos-menu-item fpos-exit-desk-btn">
									<span class="fpos-menu-icon">🏠</span>
									<span>${__("Exit to Desk")}</span>
								</button>
								<div class="fpos-menu-divider"></div>
								<button class="fpos-menu-item fpos-menu-danger fpos-close-btn-menu">
									<span class="fpos-menu-icon">📊</span>
									<span>${__("Close Register")}</span>
								</button>
							</div>
						</div>
					</div>
				</header>

				<!-- Zone 2: Orders Strip (Single tab pill when 1 order active) -->
				<div class="fpos-page-tabs-bar">
					<div class="fpos-tabs-list"></div>
				</div>

				<!-- Main Layout: Left Menu Area (Zone 3) + Right Cart (Zone 4) -->
				<div class="fpos-body">
					<!-- Zone 3: Menu Area (Filter Bar + Items Grid) -->
					<div class="fpos-left-panel">
						<!-- Consolidated filter row (Search input + Filters button) -->
						<div class="fpos-filter-bar">
							<div class="fpos-search-box">
								<span class="fpos-search-icon">🔍</span>
								<input class="fpos-search-input form-control" type="text" placeholder="${__("Search menu items...")}" />
							</div>

							<div class="fpos-filters-dropdown-wrapper">
								<button class="fpos-filters-dropdown-btn" title="${__("Categories, dietary filters & sort")}">
									<span>⚡ ${__("Filters")}</span>
									<span class="fpos-filter-active-badge" style="display:none;"></span>
									<span class="fpos-caret">▾</span>
								</button>
								<div class="fpos-filters-popover" style="display:none;">
									<div class="fpos-popover-header">
										<span class="fpos-popover-title">${__("Categories & Filters")}</span>
										<div class="fpos-popover-header-actions">
											<button class="fpos-reset-filters-btn fpos-link-btn" title="${__("Reset all filters")}">
												${__("Reset all")}
											</button>
											<button class="fpos-close-popover-btn fpos-icon-close-btn" title="${__("Close")}">✕</button>
										</div>
									</div>

									<div class="fpos-popover-section">
										<div class="fpos-filter-section-title">${__("Category")}</div>
										<div class="fpos-categories fpos-popover-categories"></div>
									</div>

									<div class="fpos-popover-section" style="margin-top:14px;">
										<div class="fpos-filter-section-title">${__("Dietary Preference")}</div>
										<div class="fpos-diet-toggles">
											<button class="fpos-subfilter-pill ${this.diet_filter === "all" ? "active" : ""}" data-diet="all">
												<span>${__("All")}</span>
											</button>
											<button class="fpos-subfilter-pill ${this.diet_filter === "veg" ? "active" : ""}" data-diet="veg">
												<span>🌱 ${__("Veg")}</span>
											</button>
											<button class="fpos-subfilter-pill ${this.diet_filter === "non-veg" ? "active" : ""}" data-diet="non-veg">
												<span>🍗 ${__("Non-Veg")}</span>
											</button>
											<button class="fpos-subfilter-pill ${this.diet_filter === "spicy" ? "active" : ""}" data-diet="spicy">
												<span>🌶️ ${__("Spicy")}</span>
											</button>
										</div>
									</div>

									<div class="fpos-popover-section" style="margin-top:14px;">
										<div class="fpos-filter-section-title">${__("Sort By")}</div>
										<div class="fpos-sort-box">
											<select class="fpos-sort-select form-control">
												<option value="default" ${this.sort_by === "default" ? "selected" : ""}>⚡ ${__("Featured (Default)")}</option>
												<option value="price-asc" ${this.sort_by === "price-asc" ? "selected" : ""}>💲 ${__("Price: Low to High")}</option>
												<option value="price-desc" ${this.sort_by === "price-desc" ? "selected" : ""}>💲 ${__("Price: High to Low")}</option>
												<option value="name-asc" ${this.sort_by === "name-asc" ? "selected" : ""}>🔤 ${__("Name: A-Z")}</option>
											</select>
										</div>
									</div>
								</div>
							</div>
						</div>

						<div class="fpos-items-grid-wrapper">
							<div class="fpos-items-grid"></div>
						</div>
					</div>

					<!-- Zone 4: Fixed Sticky Cart Panel -->
					<div class="fpos-right-panel">
						<!-- Cart Header Strip: Customer, Table & Delivery selector + '⋮' Overflow -->
						<div class="fpos-cart-header-strip">
							<div class="fpos-cart-meta">
								<div class="fpos-meta-field fpos-customer-field">
									<span>👤</span>
									<span class="fpos-customer-label">${this.customer || __("Walk-in Customer")}</span>
								</div>

								<div class="fpos-meta-field fpos-table-field ${this.order_type === "Dine In" ? "" : "fpos-hidden"}" style="display:${this.order_type === "Dine In" ? "flex" : "none"};">
									<span>🪑</span>
									<span class="fpos-table-label">${this.selected_table_no ? __("Table") + " " + this.selected_table_no : __("Select Table")}</span>
								</div>

								<div class="fpos-meta-field fpos-delivery-field ${this.order_type === "Delivery" ? "" : "fpos-hidden"}" style="display:${this.order_type === "Delivery" ? "flex" : "none"};">
									<span>🛵</span>
									<span class="fpos-delivery-label">${this.delivery_phone ? `${this.delivery_phone}` : __("Delivery Details *")}</span>
								</div>
							</div>

							<!-- Overflow ⋮ menu: KOT, Discount & Clear -->
							<div class="fpos-cart-overflow-wrapper">
								<button class="fpos-cart-overflow-btn" title="${__("More cart actions")}">⋮</button>
								<div class="fpos-cart-overflow-menu" style="display:none;">
									<button class="fpos-cart-overflow-item fpos-kot-btn">🧑‍🍳 ${__("Send to Kitchen (KOT)")}</button>
									<button class="fpos-cart-overflow-item fpos-discount-btn">🏷️ ${__("Discount & Presets")}</button>
									<button class="fpos-cart-overflow-item fpos-danger-text fpos-clear-btn">🗑️ ${__("Clear Order")}</button>
								</div>
							</div>
						</div>

						<!-- Cart Items list -->
						<div class="fpos-cart-items-wrapper">
							<div class="fpos-cart-items"></div>
							<div class="fpos-cart-empty">
								<div style="font-size:36px;margin-bottom:8px;">🛒</div>
								<p style="font-weight:600;font-size:14px;color:#64748b;margin:0 0 4px;">${__("Current order is empty")}</p>
								<small style="color:#94a3b8;">${__("Tap items on the left to add them")}</small>
							</div>
						</div>

						<!-- Pricing Summary -->
						<div class="fpos-cart-totals">
							<div class="fpos-total-row" style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px;color:#475569;">
								<span>${__("Subtotal")}</span>
								<span class="fpos-subtotal-val">Rs 0.00</span>
							</div>
							<div class="fpos-discount-row" style="display:none;justify-content:space-between;margin-bottom:5px;font-size:13px;color:#dc2626;">
								<span>${__("Discount")}</span>
								<span class="fpos-discount-val">-Rs 0.00</span>
							</div>
							<div class="fpos-delivery-row" style="display:none;justify-content:space-between;margin-bottom:5px;font-size:13px;color:#0284c7;">
								<span>${__("Delivery Fee")}</span>
								<span class="fpos-delivery-val">Rs 0.00</span>
							</div>
							<div class="fpos-tax-row" style="display:flex;justify-content:space-between;margin-bottom:5px;font-size:13px;color:#475569;">
								<span>${__("Tax")} (<span class="fpos-tax-rate">${this.profile_data.tax_rate || 0}%</span>)</span>
								<span class="fpos-tax-val">Rs 0.00</span>
							</div>
							<div class="fpos-total-due-row">
								<span>${__("Total Due")}</span>
								<span class="fpos-grand-total-val">Rs 0.00</span>
							</div>
						</div>

						<!-- Sticky Bottom Action Rows (Exactly 2 Buttons: Pay & Settle, Hold) -->
						<div class="fpos-sticky-actions">
							<!-- Primary: Pay & Settle (full width, green) -->
							<button class="fpos-btn fpos-pay-btn" disabled>
								<span>💳 ${__("Pay & Settle")}</span>
							</button>

							<!-- Secondary: Hold -->
							<div class="fpos-secondary-actions-row">
								<button class="fpos-action-btn-outline fpos-hold-btn" style="width:100%;">
									<span>⏸️ ${__("Hold")}</span>
								</button>
							</div>
						</div>
					</div>
				</div>

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
							<span>🧾</span>
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
							<span>🧑‍🍳</span>
							<span>${__("Live Kitchen Orders")}</span>
							<span class="fpos-kitchen-count-pill" style="font-size:11px;background:#ffedd5;color:#c2410c;padding:2px 8px;border-radius:12px;font-weight:700;">0 active</span>
						</div>
						<button class="fpos-drawer-close fpos-close-kitchen-drawer">&times;</button>
					</div>
					<div class="fpos-kitchen-station-filters" style="padding:10px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;gap:6px;overflow-x:auto;">
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn active" data-station="All" style="font-weight:700;border-radius:6px;">${__("All Stations")}</button>
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn" data-station="Main Kitchen" style="font-weight:700;border-radius:6px;">🍳 ${__("Main Kitchen")}</button>
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn" data-station="Grill" style="font-weight:700;border-radius:6px;">🥩 ${__("Grill")}</button>
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn" data-station="Pizza" style="font-weight:700;border-radius:6px;">🍕 ${__("Pizza")}</button>
						<button type="button" class="btn btn-default btn-xs fpos-kds-station-btn" data-station="Beverages" style="font-weight:700;border-radius:6px;">🥤 ${__("Beverages")}</button>
					</div>
					<div class="fpos-drawer-body fpos-kitchen-body"></div>
				</div>

				<!-- HELD ORDERS DRAWER -->
				<div class="fpos-drawer fpos-held-drawer">
					<div class="fpos-drawer-header">
						<div class="fpos-drawer-title">
							<span>⏸️</span>
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
		$box.empty();

		const cat_icons = {
			All: "🍽️",
			Burgers: "🍔",
			Pizzas: "🍕",
			"Sandwiches & Wraps": "🥪",
			"Sides & Fries": "🍟",
			"Drinks & Shakes": "🥤",
			"Combos & Deals": "🍱",
			Desserts: "🍰",
			Beverages: "🥤",
			Starters: "🥗",
			"Main Course": "🍛",
		};

		this.categories.forEach((cat) => {
			const active = (cat === this.fast_food_category) ? "active" : "";
			const icon = cat_icons[cat] || "🍴";
			const count = (cat === "All")
				? this.items.length
				: this.items.filter((i) => i._ff_category === cat).length;

			$box.append(`
				<button class="fpos-ff-tab ${active}" data-cat="${cat}">
					<span>${icon}</span>
					<span>${__(cat)}</span>
					<span class="fpos-cat-count">${count}</span>
				</button>
			`);
		});
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

		// 3. Search Term Filter
		if (this.search_term) {
			const term = this.search_term.toLowerCase().trim();
			list = list.filter((i) =>
				(i.item_name || "").toLowerCase().includes(term) ||
				(i.item_code || "").toLowerCase().includes(term) ||
				(i._ff_category || "").toLowerCase().includes(term)
			);
		}

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
				<div style="grid-column:1/-1;text-align:center;padding:50px 20px;color:#94a3b8;">
					<div style="font-size:44px;margin-bottom:10px;">🔍</div>
					<h4 style="color:#64748b;font-weight:600;margin-bottom:6px;">${__("No matching food items found")}</h4>
					<p style="font-size:13px;">${__("Try clearing search filters or selecting another product category.")}</p>
					<button class="btn btn-default btn-xs fpos-reset-filters-btn" style="margin-top:10px;">${__("Reset Filters")}</button>
				</div>
			`);
			return;
		}

		list.forEach((item) => {
			const price = this.format_money(item.rate);
			const img = item.item_image
				? `<img src="${item.item_image}" style="width:100%;height:110px;object-fit:cover;border-radius:10px 10px 0 0;" loading="lazy" />`
				: `<div style="height:110px;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-size:42px;border-radius:10px 10px 0 0;user-select:none;">${item._ff_icon || "🍔"}</div>`;

			// Diet badge (Veg / Spicy)
			let diet_badge = "";
			if (item._is_veg) {
				diet_badge = `<span class="fpos-card-diet-badge fpos-diet-veg">🌱 VEG</span>`;
			} else if (item._is_spicy) {
				diet_badge = `<span class="fpos-card-diet-badge fpos-diet-spicy">🌶️ SPICY</span>`;
			}

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
						<div class="fpos-item-footer">
							<span class="fpos-item-rate">${price}</span>
							<button class="fpos-quick-add-btn" title="${__("Add to Cart")}">+</button>
						</div>
					</div>
				</div>
			`);

			card.on("click", () => this.add_item_to_cart(item));
			$grid.append(card);
		});
	}

	// ─── 5. Cart Management ──────────────────────────────────────────────────

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
					options: `<div style="padding:4px 0 10px;color:#64748b;font-size:13px;line-height:1.4;">${details || __("This privileged action requires Manager PIN override.")}</div>`,
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
							branch: (this.profile_data && this.profile_data.custom_branch) || "",
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
			this.wrapper.find(".fpos-kot-btn").prop("disabled", true).css("opacity", "0.5");
			return;
		}

		$empty.hide();
		this.wrapper.find(".fpos-pay-btn").prop("disabled", false);
		this.wrapper.find(".fpos-kot-btn").prop("disabled", false).css("opacity", "1");

		this.cart_items.forEach((item, idx) => {
			const note_html = item.item_note
				? `<div class="fpos-cart-line-note">📝 ${item.item_note}</div>`
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
						<button class="fpos-note-trigger">✏️ ${__("Note / Price")}</button>
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

		let discount = 0;
		if (this.discount_percentage > 0) {
			discount = (subtotal * this.discount_percentage) / 100;
		} else if (this.discount_amount > 0) {
			discount = this.discount_amount;
		}

		const discounted_subtotal = Math.max(0, subtotal - discount);
		const tax_rate = flt(this.profile_data.tax_rate || 0);
		const tax = (discounted_subtotal * tax_rate) / 100;
		const delivery_fee = (this.order_type === "Delivery") ? flt(this.delivery_charges || 0) : 0;
		const grand_total = discounted_subtotal + tax + delivery_fee;

		this.totals = {
			subtotal: subtotal,
			discount: discount,
			tax: tax,
			delivery_fee: delivery_fee,
			grand_total: grand_total,
		};

		this.wrapper.find(".fpos-subtotal-val").text(this.format_money(subtotal));
		this.wrapper.find(".fpos-tax-val").text(this.format_money(tax));
		this.wrapper.find(".fpos-grand-total-val").text(this.format_money(grand_total));

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
			} else if (this._cart_ready_for_sync) {
				localStorage.removeItem(backup_key);
			}
		} catch (e) {
			console.warn("Could not save cart backup:", e);
		}
	}

	clear_cart() {
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
				this.discount_percentage = flt(data.discount_percentage || 0);
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
				this.switch_tab(first_id);
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
			const type_icons = { "Dine In": "🪑", "Takeaway": "🥡", "Delivery": "🛵" };
			const icon = type_icons[tab.order_type] || "📋";
			const total_str = this.format_money(tab.grand_total || 0);
			const item_count = tab.cart_items ? tab.cart_items.length : 0;
			const count_str = item_count === 1 ? __("1 item") : (item_count > 1 ? `${item_count} ${__("items")}` : __("Empty"));

			const $tab = $(`
				<div class="fpos-tab-pill ${is_active ? "active" : ""}" data-tab-id="${key}" style="
					display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:12px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;
					background:${is_active ? "#ffffff" : "#f1f5f9"};
					color:${is_active ? "#0f172a" : "#475569"};
					border:1.5px solid ${is_active ? "#f97316" : "#cbd5e1"};
					box-shadow:${is_active ? "0 2px 8px rgba(249,115,22,0.18)" : "none"};
					transition:all .15s ease;
				">
					${is_active ? `<span style="width:7px;height:7px;border-radius:50%;background:#f97316;display:inline-block;"></span>` : ""}
					<span style="font-size:14px;">${icon}</span>
					<span class="fpos-tab-title" style="font-weight:700;max-width:140px;overflow:hidden;text-overflow:ellipsis;">${tab.title || __("Tab")}</span>
					<span class="fpos-tab-items-count" style="font-size:11px;color:${is_active ? "#64748b" : "#94a3b8"};background:${is_active ? "#f8fafc" : "#e2e8f0"};padding:2px 7px;border-radius:10px;font-weight:600;">${count_str}</span>
					<span class="fpos-tab-total" style="font-size:12px;font-weight:800;color:${is_active ? "#ea580c" : "#64748b"};">${total_str}</span>
					${tab_keys.length > 1 ? `
						<span class="fpos-close-tab-btn" data-tab-id="${key}" title="${__("Close / Discard Tab")}" style="
							color:#94a3b8;font-size:14px;line-height:1;margin-left:4px;cursor:pointer;padding:2px 5px;border-radius:50%;
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
				$(this).css({ background: "transparent", color: "#94a3b8" });
			});

			$tab.find(".fpos-close-tab-btn").on("click", (e) => {
				e.stopPropagation();
				this.close_tab(key);
			});

			$list.append($tab);
		});
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
		this.discount_percentage = target.discount_percentage || 0;
		this.discount_amount = target.discount_amount || 0;
		this.order_note = target.order_note || "";

		// Update Order Type UI (tabs, table/delivery fields)
		this.update_order_type_ui();

		// Update Customer label
		this.wrapper.find(".fpos-customer-label").text(this.customer || __("Walk-in Customer"));

		this.render_cart_items();
		this.update_cart_summary();
		this.render_tab_bar();
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
				const color = status_colors[data.status] || "#94a3b8";
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
			const branch = this.branch || (this.profile_data && this.profile_data.custom_branch) || "";

			// Fetch latest tables from DB for this branch
			try {
				const res = await frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_available_tables",
					args: { pos_profile: this.pos_profile, branch: branch },
				});
				this.tables = res.message || [];
			} catch (e) {
				console.error("Failed to fetch tables:", e);
			}

			let table_selected = false;
			const previous_order_type = this.selected_table ? "Dine In" : (this.previous_order_type || "Takeaway");

			const d = new frappe.ui.Dialog({
				title: __("Select Table for Dine-In ({0})", [branch || __("All")]),
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
				<div style="font-size:13px;color:#64748b;">
					Branch: <strong>${branch || __("All Branches")}</strong> (${this.tables.length} tables)
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
			grid.html(`<div style="grid-column:1/-1;text-align:center;padding:30px 10px;color:#64748b;">${__("No tables found for {0}. Add Restaurant Tables in Desk.", [branch])}</div>`);
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
				const color = status_colors[t.status] || "#94a3b8";
				const has_tab = this.is_table_in_any_tab(t.name);
				const display_name = t.table_no ? `Table ${t.table_no}` : t.name;

				const card = $(`
					<div class="fpos-tbl-card" data-table="${t.name}" style="border:2px solid ${t.name === this.selected_table ? "#f97316" : "#e2e8f0"};background:#fff;border-radius:10px;padding:12px;text-align:center;cursor:pointer;position:relative;transition:all .2s ease;">
						<div class="fpos-tbl-dot" style="width:10px;height:10px;border-radius:50%;background:${color};margin:0 auto 6px;"></div>
						<div style="font-weight:700;font-size:14px;color:#0f172a;">${display_name}</div>
						<small style="color:#64748b;font-size:11px;">${t.capacity || 4} ${__("Seats")}</small>
						<div class="fpos-tbl-status" style="font-size:10px;color:${color};font-weight:700;margin-top:4px;">${__(t.status)}</div>
						${has_tab ? `<span style="position:absolute;top:4px;right:6px;font-size:10px;background:#e0f2fe;color:#0284c7;padding:1px 5px;border-radius:6px;font-weight:700;">${__("Tab")}</span>` : ""}
						${is_occupied ? `
							<button class="btn btn-xs btn-default fpos-card-free-btn" data-table="${t.name}" style="margin-top:6px;font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid #fca5a5;color:#b91c1c;background:#fff5f5;font-weight:600;">
								🔓 Free Table
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

	async send_to_kitchen() {
		if (this.cart_items.length === 0) {
			frappe.show_alert({ message: __("Cart is empty. Add items first."), indicator: "orange" });
			return;
		}

		if (this.order_type === "Dine In" && !this.selected_table) {
			frappe.show_alert({ message: __("Please select a table before sending to kitchen."), indicator: "orange" });
			this.open_table_selector();
			return;
		}

		const order_payload = {
			// Round 23 fix: send this cart's order token; the server
			// generates one and returns it if this is the first call.
			order_id: this.pos_order_id || null,
			order_type: this.order_type,
			table: this.selected_table || "",
			customer: this.customer,
			pos_profile: this.pos_profile,
			branch: this.branch || (this.profile_data && this.profile_data.branch) || "",
			order_note: this.order_note,
			items: this.cart_items,
		};

		try {
			frappe.dom.freeze(__("Sending ticket to kitchen..."));
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.create_kot",
				args: { order_data: order_payload },
			});
			frappe.dom.unfreeze();

			const kot_name = res.message?.kot_name;
			if (res.message?.order_id) {
				this.pos_order_id = res.message.order_id;
				if (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]) {
					this.tabs[this.active_tab_id].pos_order_id = res.message.order_id;
				}
			}
			if (kot_name) {
				this.linked_kot_id = kot_name;
				if (this.active_tab_id && this.tabs && this.tabs[this.active_tab_id]) {
					this.tabs[this.active_tab_id].linked_kot_id = kot_name;
				}
				this.save_cart_backup();
			}
			frappe.show_alert({ message: __("Kitchen Ticket {0} dispatched!", [kot_name]), indicator: "green" });
			this.refresh_kitchen_badge();
		} catch (e) {
			frappe.dom.unfreeze();
			frappe.show_alert({ message: __("Failed to create KOT: {0}", [e.message]), indicator: "red" });
		}
	}

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
		this.selected_payment_mode = methods[0].mode_of_payment;

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
			{ mode_of_payment: "Cash", icon: "💵" },
			{ mode_of_payment: "Credit Card", icon: "💳" }
		];

		// Initialize split amounts: Default to full total on Cash (or first mode)
		this.payment_splits = {};
		let default_mode = methods[0].mode_of_payment;
		methods.forEach((m) => {
			this.payment_splits[m.mode_of_payment] = 0;
			if (m.mode_of_payment.toLowerCase().includes("cash") || m.default) {
				default_mode = m.mode_of_payment;
			}
		});
		this.payment_splits[default_mode] = total;
		this.active_payment_mode = default_mode;

		const cart_rows = this.cart_items.map((it) => `
			<tr style="border-bottom:1px solid #f1f5f9;">
				<td style="padding:6px 0;">
					<div style="font-weight:700;color:#1e293b;">${it.item_name}</div>
					${it.item_note ? `<div style="font-size:10px;color:#d97706;">📝 ${it.item_note}</div>` : ""}
				</td>
				<td style="padding:6px 10px;text-align:center;font-weight:700;color:#64748b;">${it.qty}</td>
				<td style="padding:6px 0;text-align:right;font-weight:700;color:#0f172a;">${format_curr(it.amount)}</td>
			</tr>
		`).join("");

		const mop_rows_html = methods.map((m) => {
			const mop = m.mode_of_payment;
			const icon = m.icon || (mop.toLowerCase().includes("cash") ? "💵" :
				mop.toLowerCase().includes("card") ? "💳" :
				mop.toLowerCase().includes("bank") ? "🏦" : "📱");
			const is_active = mop === default_mode;
			const init_amt = flt(this.payment_splits[mop] || 0);

			return `
				<div class="fpos-split-row" data-mode="${mop}" style="background:#fff;border:2px solid ${is_active ? "#ea580c" : "#e2e8f0"};border-radius:12px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;">
					<div style="display:flex;align-items:center;gap:10px;min-width:140px;">
						<span style="font-size:22px;">${icon}</span>
						<div>
							<div style="font-weight:800;color:#0f172a;font-size:14px;">${mop}</div>
							<div style="font-size:11px;color:#64748b;">${m.type || "Payment"}</div>
						</div>
					</div>

					<div style="display:flex;align-items:center;gap:8px;flex:1;justify-content:flex-end;">
						<button type="button" class="btn btn-default btn-xs fpos-split-fill-btn" data-mode="${mop}" style="font-weight:700;font-size:11px;padding:4px 8px;border-radius:6px;background:#f8fafc;">
							${__("Exact")}
						</button>
						<button type="button" class="btn btn-default btn-xs fpos-split-clear-btn" data-mode="${mop}" style="font-weight:700;font-size:11px;padding:4px 8px;border-radius:6px;color:#ef4444;background:#f8fafc;">
							0
						</button>
						<div style="position:relative;width:150px;">
							<span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);font-size:13px;font-weight:700;color:#64748b;">Rs</span>
							<input type="text" class="form-control fpos-split-input" data-mode="${mop}" style="font-size:16px;font-weight:900;text-align:right;padding-left:45px;height:42px;border-radius:8px;border:1.5px solid #cbd5e1;color:#0f172a;" value="${init_amt.toFixed(2)}" />
						</div>
					</div>
				</div>
			`;
		}).join("");

		const $page = this.wrapper.find(".fpos-payment-page");
		$page.html(`
			<!-- Top Page Header -->
			<div class="fpos-payment-header" style="background:#fff;border-bottom:1px solid #e2e8f0;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 1px 3px rgba(0,0,0,0.03);">
				<div style="display:flex;align-items:center;gap:14px;">
					<button class="btn btn-default fpos-pay-back-btn" style="display:inline-flex;align-items:center;gap:6px;font-weight:700;border-radius:8px;padding:8px 16px;">
						<span>←</span>
						<span>${__("Return to Order")}</span>
					</button>
					<div>
						<h3 style="margin:0;font-size:18px;font-weight:800;color:#0f172a;display:flex;align-items:center;gap:8px;">
							<span>💳</span> ${__("Payment & Order Settlement")}
						</h3>
						<div style="font-size:12px;color:#64748b;margin-top:2px;">
							${this.branch ? `<b style="color:#ea580c;">📍 ${this.branch}</b> &bull; ` : ""}
							<span>${this.order_type}</span>
							${this.selected_table_no ? `&bull; <b>Table ${this.selected_table_no}</b>` : ""}
							&bull; <span>Customer: <b>${this.customer || "Walk-in Customer"}</b></span>
						</div>
					</div>
				</div>

				<div style="display:flex;align-items:center;gap:12px;">
					<div style="background:#fff7ed;border:1px solid #fed7aa;padding:8px 16px;border-radius:12px;text-align:right;">
						<span style="font-size:11px;color:#c2410c;font-weight:700;text-transform:uppercase;">${__("Amount Due")}</span>
						<div style="font-size:22px;font-weight:900;color:#ea580c;line-height:1.2;">${format_curr(total)}</div>
					</div>
				</div>
			</div>

			<!-- Main 2-Column Responsive Body -->
			<div style="max-width:1150px;margin:24px auto;width:100%;padding:0 24px;display:grid;grid-template-columns:1.25fr 0.85fr;gap:24px;">
				<!-- Left Column: Payment Modes, Split Inputs & Touch Keypad -->
				<div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.04);display:flex;flex-direction:column;gap:18px;">
					<!-- 1. Quick Full Pay Pills -->
					<div>
						<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
							<label style="font-size:13px;font-weight:800;color:#334155;margin:0;">${__("1. Quick 100% Payment")}</label>
							<span style="font-size:11px;color:#64748b;">${__("Sets entire bill to single mode")}</span>
						</div>
						<div class="fpos-quick-full-mops" style="display:flex;gap:8px;flex-wrap:wrap;">
							${methods.map(m => `
								<button type="button" class="btn btn-default btn-sm fpos-quick-full-btn" data-mode="${m.mode_of_payment}" style="font-weight:700;border-radius:8px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px;">
									<span>${m.icon || "💳"}</span>
									<span>${m.mode_of_payment}</span>
								</button>
							`).join("")}
						</div>
					</div>

					<!-- 2. Split Payment Mode Rows -->
					<div>
						<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
							<label style="font-size:13px;font-weight:800;color:#334155;margin:0;">${__("2. Payment Breakdown / Split")}</label>
							<span style="font-size:11px;color:#64748b;">${__("Enter split amounts across multiple modes")}</span>
						</div>
						<div class="fpos-split-mop-list" style="display:flex;flex-direction:column;gap:8px;">
							${mop_rows_html}
						</div>
					</div>

					<!-- 3. Active Mode Quick Cash Pills & Touch Keypad -->
					<div style="border-top:1px solid #f1f5f9;padding-top:14px;">
						<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
							<label style="font-size:12px;font-weight:800;color:#334155;margin:0;">
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
					<div style="border-top:1px solid #f1f5f9;padding-top:10px;">
						<details style="cursor:pointer;">
							<summary style="font-size:12px;font-weight:700;color:#64748b;user-select:none;">
								🛒 ${__("Review Line Items")} (${this.cart_items.length} ${__("items")})
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
					<div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,0.04);display:flex;flex-direction:column;gap:14px;">
						<div style="font-size:15px;font-weight:800;color:#0f172a;border-bottom:1px solid #f1f5f9;padding-bottom:10px;">
							${__("Settlement Breakdown")}
						</div>

						<div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;">
							<span>${__("Subtotal")}</span>
							<strong style="color:#0f172a;">${format_curr(this.totals.subtotal)}</strong>
						</div>

						${this.totals.discount > 0 ? `
						<div style="display:flex;justify-content:space-between;font-size:13px;color:#ef4444;">
							<span>${__("Discount")}</span>
							<strong>-${format_curr(this.totals.discount)}</strong>
						</div>` : ""}

						<div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;">
							<span>${__("Taxes & Charges")} (${this.profile_data.tax_rate || 0}%)</span>
							<strong style="color:#0f172a;">${format_curr(this.totals.tax)}</strong>
						</div>

						<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;color:#0f172a;border-top:2px dashed #e2e8f0;padding-top:10px;">
							<span>${__("Grand Total Due")}</span>
							<span style="color:#ea580c;">${format_curr(total)}</span>
						</div>

						<div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;color:#1e293b;background:#f8fafc;padding:10px 14px;border-radius:10px;">
							<span>${__("Total Tendered")}</span>
							<span class="fpos-pay-summary-tendered">${format_curr(total)}</span>
						</div>

						<!-- Split Breakdown Badges -->
						<div class="fpos-split-summary-pills" style="display:flex;gap:6px;flex-wrap:wrap;"></div>

						<!-- Live Change or Shortage Display -->
						<div class="fpos-pay-change-card" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;">
							<div>
								<div class="fpos-pay-change-title" style="font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;">${__("Change to Return")}</div>
								<div class="fpos-pay-summary-change" style="font-size:20px;font-weight:900;color:#16a34a;">${format_curr(0)}</div>
							</div>
							<span class="fpos-pay-change-icon" style="font-size:26px;">💵</span>
						</div>

						<!-- Customer POS Slip Toggle -->
						<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px;color:#475569;">
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
						<span style="font-size:11px;font-weight:700;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;padding:3px 8px;border-radius:6px;">
							${m.icon || "💳"} ${mop}: <b>${format_curr(amt)}</b>
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
				$card.css({ background: "#f0fdf4", borderColor: "#bbf7d0" });
				$title.css("color", "#15803d").text(__("Change to Return"));
				$change_val.css("color", "#16a34a").text(format_curr(change));
				$icon.text("💵");
				$confirm_btn.prop("disabled", false).css({ background: "#22c55e", cursor: "pointer", opacity: 1 });
				$btn_label.text(__("Confirm & Settle Payment ({0})", [format_curr(total_tendered)]));
			} else {
				const shortage = Math.abs(diff);
				$card.css({ background: "#fee2e2", borderColor: "#fca5a5" });
				$title.css("color", "#b91c1c").text(__("Remaining Amount Due"));
				$change_val.css("color", "#b91c1c").text(`-${format_curr(shortage)}`);
				$icon.text("⚠️");
				$confirm_btn.prop("disabled", true).css({ background: "#94a3b8", cursor: "not-allowed", opacity: 0.7 });
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
					$(this).css({ borderColor: "#e2e8f0", background: "#fff" });
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
			branch: this.branch || (this.profile_data && this.profile_data.custom_branch) || null,
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
			<tr style="border-bottom: 1px dashed #cbd5e1;">
				<td style="padding: 4px 0; text-align: left; vertical-align: top;">
					<div style="font-weight: 700;">${i.item_name}</div>
					${i.item_note ? `<div style="font-size: 10px; color: #64748b; font-style: italic;">* ${i.item_note}</div>` : ""}
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
					<div class="fpos-slip-close-icon" style="position: absolute; top: 12px; right: 14px; cursor: pointer; font-size: 18px; color: #94a3b8; line-height: 1; padding: 4px;" title="${__("Close (Esc)")}">✕</div>

					<div style="text-align: center; margin-bottom: 8px;">
						<div style="font-size: 20px; font-weight: 900; color: #0f172a;">${receipt_data.company || "FOOD POS RESTAURANT"}</div>
						<div style="font-size: 11px; color: #64748b;">${receipt_data.branch ? `<b style="color:#ea580c;">📍 ${receipt_data.branch}</b> &bull; ` : ""}${receipt_data.pos_profile || this.pos_profile} &bull; Register Receipt</div>
						<div style="font-size: 11px; color: #64748b;">${receipt_data.posting_date || ""} ${this.format_time_hh_mm(receipt_data.posting_time)}</div>
					</div>

					<div class="fpos-slip-divider"></div>

					<div style="font-size: 11px; display: flex; flex-direction: column; gap: 2px;">
						<div style="display: flex; justify-content: space-between;">
							<span>Invoice #:</span>
							<strong style="color: #0f172a;">${receipt_data.invoice}</strong>
						</div>
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
							<tr style="border-bottom: 1px solid #0f172a; text-transform: uppercase; font-size: 10px;">
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
						${flt(receipt_data.total_taxes_and_charges) > 0 ? `
						<div style="display: flex; justify-content: space-between;">
							<span>Tax:</span>
							<span>${format_curr(receipt_data.total_taxes_and_charges)}</span>
						</div>` : ""}
						${flt(receipt_data.delivery_charges) > 0 ? `
						<div style="display: flex; justify-content: space-between; color: #0284c7;">
							<span>Delivery Fee:</span>
							<span>+${format_curr(receipt_data.delivery_charges)}</span>
						</div>` : ""}
						<div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: 900; border-top: 1px solid #0f172a; padding-top: 4px; margin-top: 2px;">
							<span>TOTAL DUE:</span>
							<span>${format_curr(receipt_data.grand_total)}</span>
						</div>
					</div>

					<div class="fpos-slip-divider"></div>

					<div style="display: flex; flex-direction: column; gap: 3px;">
						${payments_html}
						${change_due > 0 ? `
						<div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; color: #15803d; background: #f0fdf4; padding: 4px 6px; border-radius: 4px; margin-top: 4px;">
							<span>Change Due:</span>
							<span>${format_curr(change_due)}</span>
						</div>` : ""}
					</div>

					<div class="fpos-slip-divider"></div>

					<div style="text-align: center; margin-top: 10px; font-size: 11px; color: #64748b;">
						<p style="margin: 0; font-weight: 700; color: #0f172a;">Thank you for dining with us!</p>
						<p style="margin: 2px 0 0;">Please visit us again.</p>
						<div style="letter-spacing: 4px; font-size: 16px; margin-top: 8px; color: #94a3b8;">|||| | ||||| || ||||||</div>
					</div>

					<!-- Slip Actions -->
					<div style="display: flex; gap: 8px; margin-top: 16px;">
						<button class="btn btn-default fpos-close-slip-btn" style="flex: 1; font-weight: 700; border-radius: 8px; cursor: pointer;">
							${is_settlement ? __("Next Order (Close)") : __("Close")}
						</button>
						<button class="btn btn-primary fpos-print-slip-btn" style="flex: 1; font-weight: 700; background: #ea580c; border-color: #ea580c; border-radius: 8px; cursor: pointer;">
							🖨️ ${__("Print Slip")}
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

		const html = `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<title>POS Receipt - ${receipt_data.invoice}</title>
				<style>
					body { font-family: 'Courier New', Courier, monospace; width: 78mm; margin: 0 auto; padding: 8px; font-size: 12px; color: #000; }
					.text-center { text-align: center; }
					.bold { font-weight: bold; }
					.divider { border-top: 1px dashed #000; margin: 6px 0; }
					.row { display: flex; justify-content: space-between; margin: 2px 0; }
					table { width: 100%; border-collapse: collapse; font-size: 11px; }
					@media print {
						body { width: 100%; margin: 0; padding: 0; }
					}
				</style>
			</head>
			<body>
				<div class="text-center bold" style="font-size:15px;">${receipt_data.company || "FOOD POS RESTAURANT"}</div>
				<div class="text-center" style="font-size:11px;">${receipt_data.pos_profile || ""}</div>
				<div class="text-center" style="font-size:10px;">${receipt_data.posting_date || ""} ${this.format_time_hh_mm(receipt_data.posting_time)}</div>
				<div class="divider"></div>
				<div class="row"><span>Invoice:</span><span class="bold">${receipt_data.invoice}</span></div>
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
				${flt(receipt_data.total_taxes_and_charges) > 0 ? `<div class="row"><span>Tax:</span><span>${format_curr(receipt_data.total_taxes_and_charges)}</span></div>` : ""}
				<div class="row bold" style="font-size:14px; margin-top: 4px;"><span>GRAND TOTAL:</span><span>${format_curr(receipt_data.grand_total)}</span></div>
				<div class="divider"></div>
				<div class="row"><span>Paid Amount:</span><span>${format_curr(receipt_data.paid_amount || receipt_data.grand_total)}</span></div>
				${(flt(receipt_data.change_amount) || Math.max(0, flt(receipt_data.paid_amount) - flt(receipt_data.grand_total))) > 0 ? `<div class="row bold" style="font-size:13px; color:#15803d;"><span>Change Due:</span><span>${format_curr(flt(receipt_data.change_amount) || Math.max(0, flt(receipt_data.paid_amount) - flt(receipt_data.grand_total)))}</span></div>` : ""}
				<div class="divider"></div>
				<div class="text-center" style="margin-top: 10px; font-size: 11px;">
					<p style="margin: 0;" class="bold">Thank you for dining with us!</p>
					<p style="margin: 2px 0;">Please visit again.</p>
				</div>
				<script>
					window.addEventListener("load", function() {
						setTimeout(function() {
							try { window.print(); } catch(e) {}
						}, 300);
					});
					window.addEventListener("afterprint", function() {
						try { window.close(); } catch(e) {}
					});
				</script>
			</body>
			</html>
		`;

		try {
			const blob = new Blob([html], { type: "text/html;charset=utf-8" });
			const blobUrl = URL.createObjectURL(blob);
			const win = window.open(blobUrl, "_blank", "noopener,noreferrer,width=420,height=650");
			setTimeout(() => {
				try { URL.revokeObjectURL(blobUrl); } catch (e) {}
			}, 30000);
		} catch (e) {
			console.warn("Print popup error:", e);
		}
	}

	// ─── 8.2 Recent Orders & Customers Drawer (Last 10 Customers with Edit Ability)

	async load_recent_orders() {
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.get_recent_pos_orders",
				args: {
					pos_profile: this.pos_profile || (this.profile_data && this.profile_data.name) || "",
					branch: this.branch || (this.profile_data && this.profile_data.custom_branch) || "",
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
		const branch_name = this.branch || (this.profile_data && this.profile_data.custom_branch) || "Branch";
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
					<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #e2e8f0;border-top-color:#15803d;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
					<span style="color:#64748b;font-size:13px;">${__("Loading recent orders...")}</span>
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
					branch: this.branch || (this.profile_data && this.profile_data.custom_branch) || "",
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
				<div style="text-align:center;padding:50px 20px;color:#94a3b8;">
					<div style="font-size:40px;margin-bottom:8px;">🧾</div>
					<div style="font-weight:600;font-size:14px;color:#64748b;">${__("No recent customer orders today")}</div>
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
				? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;">PAID</span>`
				: `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:800;">UNPAID</span>`;

			const items_preview = (o.items || []).map(i => `${i.qty}x ${i.item_name}`).join(", ");
			const raw_tbl = o.table_no || o.custom_table || o.custom_restaurant_table || "";
			const recent_tbl_label = this.format_table_label(raw_tbl);

			const card = $(`
				<div class="fpos-recent-card" data-idx="${index}">
					<div style="display:flex;justify-content:space-between;align-items:flex-start;">
						<div>
							<div style="font-weight:800;font-size:14px;color:#0f172a;">${o.name}</div>
							<div style="font-size:12px;color:#1e293b;font-weight:600;margin-top:2px;">
								👤 ${o.customer_name || o.customer || "Walk-in"}
							</div>
							<div style="font-size:11px;color:#64748b;margin-top:2px;">
								${o.order_type || o.custom_order_type || "Takeaway"}${recent_tbl_label ? ` &bull; ${recent_tbl_label}` : ""} &bull; ${this.format_time_hh_mm(o.posting_time)}
							</div>
						</div>
						<div style="text-align:right;">
							<div style="font-weight:800;font-size:15px;color:#ea580c;">${format_curr(o.grand_total)}</div>
							<div style="margin-top:4px;">${status_badge}</div>
						</div>
					</div>

					<div style="font-size:11px;color:#475569;background:#f8fafc;padding:6px 10px;border-radius:6px;line-height:1.4;">
						<b style="color:#0f172a;">${o.items_count || (o.items || []).length} items:</b> ${items_preview || "Items ordered"}
					</div>

					<!-- Restaurant Actions: Edit / Reload to Cart & Print Slip -->
					<div style="display:flex;gap:8px;margin-top:4px;border-top:1px dashed #e2e8f0;padding-top:8px;">
						<button class="btn btn-default btn-xs fpos-reload-order-btn" style="flex:1;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:4px;color:#2563eb;background:#eff6ff;border-color:#bfdbfe;border-radius:6px;padding:6px 10px;">
							<span>✏️</span>
							<span>${__("Edit / Reload Cart")}</span>
						</button>
						<button class="btn btn-default btn-xs fpos-view-slip-btn" style="font-weight:600;display:inline-flex;align-items:center;gap:4px;border-radius:6px;padding:6px 10px;">
							<span>🖨️</span>
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
				<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #e2e8f0;border-top-color:#ea580c;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#64748b;font-size:13px;">${__("Loading active kitchen tickets...")}</span>
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
					<div style="font-size:24px;margin-bottom:8px;">🧑‍🍳</div>
					<div style="font-weight:600;">${__("Failed to load kitchen tickets")}</div>
					<button class="btn btn-default btn-xs fpos-retry-kitchen-btn" style="margin-top:10px;font-weight:700;">🔄 ${__("Retry")}</button>
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

	render_kitchen_kots(kots) {
		const $body = this.wrapper.find(".fpos-kitchen-body");
		$body.empty();

		if (!kots || kots.length === 0) {
			$body.html(`
				<div style="text-align:center;padding:50px 20px;color:#94a3b8;">
					<div style="font-size:40px;margin-bottom:8px;">🧑‍🍳</div>
					<div style="font-weight:600;font-size:14px;color:#64748b;">${__("No pending kitchen tickets")}</div>
					<p style="font-size:12px;margin-top:4px;">${__("When orders are sent to kitchen, they will appear here with live preparation status.")}</p>
				</div>
			`);
			return;
		}

		kots.forEach((kot) => {
			const status_colors = {
				Pending: { bg: "#fef9c3", text: "#854d0e", border: "#facc15" },
				"In Progress": { bg: "#dbeafe", text: "#1d4ed8", border: "#60a5fa" },
				Ready: { bg: "#dcfce7", text: "#15803d", border: "#4ade80" },
			};
			const sc = status_colors[kot.status] || { bg: "#f1f5f9", text: "#475569", border: "#cbd5e1" };

			const items_list = (kot.items || []).map((it) => {
				const is_done = Boolean(it.is_done);
				return `
					<div class="fpos-kot-item-row" data-kot="${kot.name}" data-item="${it.item_name}" data-row="${it.name || ''}" style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f9;${is_done ? "opacity:0.5;text-decoration:line-through;" : ""}">
						<input type="checkbox" class="fpos-kot-item-check" data-kot="${kot.name}" data-item="${it.item_name}" data-row="${it.name || ''}" ${is_done ? "checked" : ""} style="width:16px;height:16px;accent-color:#22c55e;cursor:pointer;margin-top:2px;" />
						<div style="flex:1;">
							<div style="display:flex;justify-content:space-between;align-items:center;">
								<span style="font-weight:700;font-size:13px;color:#1e293b;">${it.qty}x ${it.item_name}</span>
								${is_done ? `<span style="font-size:10px;background:#dcfce7;color:#15803d;padding:1px 6px;border-radius:8px;font-weight:700;">DONE</span>` : `<span style="font-size:10px;background:#fef3c7;color:#b45309;padding:1px 6px;border-radius:8px;font-weight:700;">COOKING</span>`}
							</div>
							${it.item_note ? `<div style="font-size:11px;color:#ea580c;background:#fff7ed;padding:2px 6px;border-radius:4px;margin-top:3px;display:inline-block;">📝 ${it.item_note}</div>` : ""}
						</div>
					</div>
				`;
			}).join("");

			// Action buttons based on status
			let stage_btn = "";
			if (kot.status === "Pending") {
				stage_btn = `<button class="btn btn-default btn-xs fpos-kot-stage-btn" data-kot="${kot.name}" data-stage="In Progress" style="font-weight:700;background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;border-radius:6px;padding:5px 12px;">▶ ${__("Start Cooking")}</button>`;
			} else if (kot.status === "In Progress") {
				stage_btn = `<button class="btn btn-default btn-xs fpos-kot-stage-btn" data-kot="${kot.name}" data-stage="Ready" style="font-weight:700;background:#f0fdf4;color:#15803d;border-color:#bbf7d0;border-radius:6px;padding:5px 12px;">✓ ${__("Mark Ready")}</button>`;
			} else if (kot.status === "Ready") {
				stage_btn = `<button class="btn btn-default btn-xs fpos-kot-stage-btn" data-kot="${kot.name}" data-stage="Served" style="font-weight:700;background:#f8fafc;color:#334155;border-color:#cbd5e1;border-radius:6px;padding:5px 12px;">🍽️ ${__("Mark Served")}</button>`;
			}

			const card = $(`
				<div class="fpos-recent-card" data-kot="${kot.name}" style="border-left: 4px solid ${sc.border};">
					<div style="display:flex;justify-content:space-between;align-items:flex-start;">
						<div>
							<div style="display:flex;align-items:center;gap:6px;">
								<span style="font-weight:800;font-size:14px;color:#0f172a;">${kot.name}</span>
								<span style="background:${sc.bg};color:${sc.text};padding:2px 7px;border-radius:10px;font-size:10px;font-weight:800;text-transform:uppercase;">
									${kot.status}
								</span>
								${kot.kitchen_station ? `<span style="background:#e0f2fe;color:#0369a1;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;">📍 ${kot.kitchen_station.split("-").pop()}</span>` : ""}
							</div>
							<div style="font-size:11px;color:#64748b;margin-top:3px;">
								<span>${kot.order_type || "Dine In"}</span>
								${kot.table_no ? `&bull; <b>Table ${kot.table_no}</b>` : ""}
								&bull; <span>${kot.time_ago || (kot.creation ? frappe.datetime.prettyDate(kot.creation) : "Just now")}</span>
							</div>
						</div>

						<div style="text-align:right;">
							<div style="font-size:12px;font-weight:800;color:${kot.status !== "Ready" && kot.remaining_items > 0 ? "#ea580c" : "#15803d"};background:${kot.status !== "Ready" && kot.remaining_items > 0 ? "#fff7ed" : "#dcfce7"};padding:4px 8px;border-radius:8px;">
								${kot.status !== "Ready" && kot.remaining_items > 0 ? `🍳 ${kot.remaining_items} of ${kot.total_items} left` : `✓ All Ready`}
							</div>
						</div>
					</div>

					<!-- Remaining items alert indicator -->
					${kot.status !== "Ready" && kot.remaining_items > 0 ? `
						<div style="font-size:11px;font-weight:600;color:#c2410c;background:#fff7ed;padding:4px 8px;border-radius:6px;">
							⚠️ ${__("{0} cooking item(s) remaining for this ticket", [kot.remaining_items])}
						</div>
					` : ""}

					<!-- Checklist of items -->
					<div style="display:flex;flex-direction:column;gap:2px;margin:4px 0;">
						${items_list}
					</div>

					<!-- Bottom Controls: Stage transition & Reprint -->
					<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed #e2e8f0;padding-top:8px;">
						<span style="font-size:11px;color:#94a3b8;">${kot.customer || "Walk-in"}</span>
						<div style="display:flex;gap:6px;">
							${stage_btn}
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

			$body.append(card);
		});
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
		const branch_name = this.branch || (this.profile_data && this.profile_data.custom_branch) || "Branch";
		const d = new frappe.ui.Dialog({
			title: __("🚨 Served KOT Exceptions (Manager Review) — {0}", [branch_name]),
			size: "large",
		});

		const body = $(d.wrapper).find(".modal-body");
		body.html(`
			<div style="display:flex;justify-content:center;align-items:center;height:180px;flex-direction:column;gap:10px;">
				<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #e2e8f0;border-top-color:#dc2626;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#64748b;font-size:13px;">${__("Loading served KOT exceptions...")}</span>
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
				<div style="text-align:center;padding:50px 20px;color:#15803d;">
					<div style="font-size:40px;margin-bottom:8px;">✅</div>
					<div style="font-weight:800;font-size:15px;color:#166534;">${__("All Served KOTs Fully Settled")}</div>
					<p style="font-size:12px;color:#64748b;margin-top:4px;">${__("No un-invoiced or un-voided kitchen tickets found. Shift data integrity intact.")}</p>
				</div>
			`);
			return;
		}

		const $container = $('<div style="display:flex;flex-direction:column;gap:12px;max-height:65vh;overflow-y:auto;padding-right:4px;"></div>');
		$container.append(`
			<div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:10px 14px;font-size:12px;color:#9f1239;line-height:1.4;">
				<b>⚠️ Safeguard Warning:</b> The following kitchen tickets were marked <b>Served</b> but have no linked submitted invoice or manager void. Under restaurant policy, every served order must either be billed or voided with Manager PIN.
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
								<span style="font-weight:900;font-size:15px;color:#0f172a;">${ex.name}</span>
								<span style="background:${(ex.status || '').includes('Mismatch') ? '#fef3c7' : '#fee2e2'};color:${(ex.status || '').includes('Mismatch') ? '#92400e' : '#b91c1c'};padding:2px 8px;border-radius:12px;font-size:10.5px;font-weight:800;">${(ex.status || 'Served (Uninvoiced)').toUpperCase()}</span>
							</div>
							<div style="font-size:12px;color:#475569;margin-top:3px;font-weight:600;">
								📍 ${ex.branch} &bull; ${ex.order_type}${ex.table && ex.table !== 'N/A' ? ` &bull; Table ${ex.table_no}` : ''} &bull; 👤 ${ex.customer}
							</div>
							<div style="font-size:11px;color:#dc2626;font-weight:700;margin-top:2px;">
								⏱️ Elapsed: ${ex.time_ago} (${ex.elapsed_mins} mins ago)
							</div>
						</div>
						<div style="text-align:right;">
							<div style="font-size:11px;color:#64748b;font-weight:600;">Estimated Value</div>
							<div style="font-size:16px;font-weight:900;color:#ea580c;">${format_curr(ex.estimated_total)}</div>
						</div>
					</div>

					<div style="margin-top:10px;padding:8px 12px;background:#f8fafc;border-radius:6px;font-size:12px;color:#1e293b;border:1px dashed #e2e8f0;">
						<b>Items Ordered:</b> ${items_str || "None"}
						${ex.sales_invoice ? `<div style="margin-top:4px;"><b>Linked invoice:</b> ${ex.sales_invoice}${(ex.invoice_item_rows || []).length ? ` — billed: ${(ex.invoice_item_rows || []).map(i => `${i.qty}x ${i.item_name}`).join(", ")}` : ''}</div>` : ''}
					</div>

					<div style="display:flex;gap:10px;margin-top:12px;border-top:1px solid #f1f5f9;padding-top:10px;">
						<button class="btn btn-default btn-xs fpos-settle-kot-btn" style="flex:1;background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe;font-weight:700;padding:6px 12px;border-radius:6px;">
							<span>💳 ${__("Load to Cart & Settle")}</span>
						</button>
						<button class="btn btn-danger btn-xs fpos-void-kot-btn" style="background:#dc2626;color:#fff;font-weight:700;padding:6px 12px;border-radius:6px;">
							<span>🗑️ ${__("Manager Void (PIN)")}</span>
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
								<div style="padding:4px 0 10px;font-size:12px;color:#64748b;line-height:1.4;">
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
				<div class="fpos-spinner" style="width:32px;height:32px;border:3px solid #e2e8f0;border-top-color:#b45309;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<span style="color:#64748b;font-size:13px;">${__("Loading held orders...")}</span>
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
				<div style="text-align:center;padding:50px 20px;color:#94a3b8;">
					<div style="font-size:40px;margin-bottom:8px;">⏸️</div>
					<div style="font-weight:600;font-size:14px;color:#64748b;">${__("No held orders")}</div>
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
				<div class="fpos-recent-card" data-held="${o.name}" style="border-left: 4px solid #f59e0b;background:#fff;border-radius:12px;padding:14px;margin-bottom:12px;border:1px solid #e2e8f0;border-left-width:4px;">
					<div style="display:flex;justify-content:space-between;align-items:flex-start;">
						<div>
							<div style="display:flex;align-items:center;gap:6px;">
								<span style="font-weight:800;font-size:14px;color:#0f172a;">${o.name}</span>
								<span style="background:#fef3c7;color:#b45309;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:800;text-transform:uppercase;">
									HELD
								</span>
							</div>
							<div style="font-size:11px;color:#64748b;margin-top:3px;">
								<span>${o.order_type}</span>
								${this.format_table_label(o.table || order_data.table || "") ? `&bull; <b>${this.format_table_label(o.table || order_data.table || "")}</b>` : ""}
								&bull; <span>Customer: <b>${o.customer_name || o.customer || "Walk-in"}</b></span>
							</div>
							${o.phone ? `<div style="font-size:11px;color:#64748b;">📞 ${o.phone}</div>` : ""}
						</div>

						<div style="text-align:right;">
							<div style="font-weight:900;font-size:16px;color:#ea580c;">${format_curr(order_total)}</div>
							<div style="font-size:11px;color:#94a3b8;margin-top:2px;">${o.creation ? o.creation.substring(11, 16) : ""}</div>
						</div>
					</div>

					<div style="font-size:11px;color:#475569;background:#f8fafc;padding:6px 10px;border-radius:6px;line-height:1.4;margin:8px 0;">
						<b style="color:#0f172a;">${items.length} items:</b> ${items_preview || "Items"}
					</div>

					${o.hold_reason ? `<div style="font-size:11px;color:#92400e;background:#fef3c7;padding:3px 8px;border-radius:4px;margin-bottom:8px;">📝 ${o.hold_reason}</div>` : ""}

					<div style="display:flex;gap:8px;border-top:1px dashed #e2e8f0;padding-top:8px;">
						<button class="btn btn-default btn-xs fpos-resume-held-btn" style="flex:1;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:4px;color:#15803d;background:#f0fdf4;border-color:#bbf7d0;border-radius:6px;padding:6px 10px;">
							<span>▶️</span>
							<span>${__("Resume Order")}</span>
						</button>
						<button class="btn btn-default btn-xs fpos-discard-held-btn" style="font-weight:700;display:inline-flex;align-items:center;gap:4px;color:#b91c1c;background:#fee2e2;border-color:#fca5a5;border-radius:6px;padding:6px 10px;">
							<span>🗑️</span>
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
					branch: this.branch || (this.profile_data && this.profile_data.custom_branch) || null,
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
				this.discount_percentage = flt(data.discount_percentage || 0);
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

	async sync_offline_invoices() {
		const queue = JSON.parse(localStorage.getItem(this.offline_queue_key) || "[]");
		if (queue.length === 0) return;

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.page.food_pos.food_pos.sync_offline_invoices",
				args: { invoices: queue },
				freeze: false,
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

			this.update_connection_indicator();
		} catch (e) {
			console.warn("Background offline sync completed with notice", e);
		}
	}

	update_connection_indicator() {
		const queue = JSON.parse(localStorage.getItem(this.offline_queue_key) || "[]");
		const $ind = this.wrapper.find(".fpos-sync-indicator");
		const $dot = $ind.find(".fpos-dot, .fpos-indicator-dot");
		const $label = $ind.find(".fpos-indicator-label");

		if (!this.is_online) {
			$ind.removeClass("online").addClass("offline").attr("title", __("Offline ({0} queued) - Click to inspect", [queue.length]));
			$dot.css("background", "#94a3b8");
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

		const $tableField = this.wrapper.find(".fpos-table-field");
		const $deliveryField = this.wrapper.find(".fpos-delivery-field");

		if (this.order_type === "Dine In") {
			$tableField.removeClass("fpos-hidden").show().css("display", "flex");
			$deliveryField.addClass("fpos-hidden").hide();
			$tableField.find(".fpos-table-label").text(
				this.selected_table_no ? __("Table") + " " + this.selected_table_no : __("Select Table")
			);
		} else if (this.order_type === "Delivery") {
			$tableField.addClass("fpos-hidden").hide();
			$deliveryField.removeClass("fpos-hidden").show().css("display", "flex");
			$deliveryField.find(".fpos-delivery-label").text(this.delivery_phone || __("Delivery Details *"));
		} else {
			// Takeaway — permanently hide both Table and Delivery rows
			$tableField.addClass("fpos-hidden").hide();
			$deliveryField.addClass("fpos-hidden").hide();
		}
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
			}
		});

		// Fast food category selection
		this.wrapper.on("click", ".fpos-ff-tab, .fpos-category-tab", (e) => {
			this.fast_food_category = $(e.currentTarget).data("cat");
			this.current_category = this.fast_food_category;
			this.wrapper.find(".fpos-ff-tab, .fpos-category-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
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
			this.wrapper.find(".fpos-ff-tab, .fpos-category-tab").removeClass("active");
			this.wrapper.find(".fpos-ff-tab[data-cat='All'], .fpos-category-tab[data-cat='All']").addClass("active");
			this.wrapper.find(".fpos-subfilter-pill").removeClass("active");
			this.wrapper.find(".fpos-subfilter-pill[data-diet='all']").addClass("active");
			this.wrapper.find(".fpos-sort-select").val("default");
			this.update_filter_button_indicator();
			this.render_items_grid();
			frappe.show_alert({ message: __("Filters reset to default"), indicator: "blue" });
		});

		// Search input
		this.wrapper.on("input", ".fpos-search-input", (e) => {
			this.search_term = $(e.target).val();
			this.render_items_grid();
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
		this.wrapper.on("click", ".fpos-table-field", () => this.open_table_selector());

		// Customer picker click
		this.wrapper.on("click", ".fpos-customer-field", () => this.open_customer_dialog());

		// KOT button click
		this.wrapper.on("click", ".fpos-kot-btn", () => this.send_to_kitchen());

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

		// Switch branch action in More menu
		this.wrapper.on("click", ".fpos-switch-branch-btn", () => {
			this.wrapper.find(".fpos-more-menu").hide();
			this.render_profile_selection_dialog(this.available_profiles, true);
		});

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

		// Manual sync click
		this.wrapper.on("click", ".fpos-manual-sync-btn", () => this.sync_offline_invoices());

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
						options: `<div style="padding:8px 0;font-size:13px;color:#475569;">
							<p style="margin-bottom:8px;">${__("There are {0} offline invoice(s) queued in browser storage awaiting server submission.", [queue.length])}</p>
							<p style="margin-bottom:0;font-size:12px;color:#64748b;">${__("You can retry synchronizing now, or discard stuck local drafts if they were test records.")}</p>
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

		// Switch POS Profile click
		this.wrapper.on("click", ".fpos-switch-profile-btn", () => {
			if (this.available_profiles && this.available_profiles.length) {
				this.render_profile_selection_dialog(this.available_profiles, true);
			} else {
				frappe.call({
					method: "foodpos.foodpos.page.food_pos.food_pos.get_pos_profiles",
					callback: (r) => {
						this.available_profiles = r.message || [];
						this.render_profile_selection_dialog(this.available_profiles, true);
					},
				});
			}
		});

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
						<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:14px;">
							<div style="display:flex;justify-content:space-between;align-items:center;">
								<span style="font-size:13px;color:#64748b;font-weight:600;">${__("Current Order Subtotal:")}</span>
								<span style="font-size:16px;color:#0f172a;font-weight:800;">${format_curr(subtotal)}</span>
							</div>
							<div style="font-size:11px;color:#94a3b8;margin-top:4px;">
								${__("Cashier cap: Max 10% or Rs 100 without Manager PIN.")}
							</div>
						</div>

						<div style="margin-bottom:14px;">
							<label style="font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;display:block;">${__("Discount Presets")}</label>
							<div class="fpos-disc-presets" style="display:flex;gap:6px;flex-wrap:wrap;">
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="pct" data-val="5" style="font-weight:700;">5%</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="pct" data-val="10" style="font-weight:700;">10%</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="pct" data-val="15" style="font-weight:700;border-color:#f59e0b;color:#b45309;">15% 🔒</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="pct" data-val="20" style="font-weight:700;border-color:#f59e0b;color:#b45309;">20% 🔒</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="amt" data-val="50" style="font-weight:700;">Rs 50</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="amt" data-val="100" style="font-weight:700;">Rs 100</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-btn" data-type="amt" data-val="200" style="font-weight:700;border-color:#f59e0b;color:#b45309;">Rs 200 🔒</button>
								<button type="button" class="btn btn-default btn-sm fpos-preset-clear text-danger" style="font-weight:700;">${__("Clear")}</button>
							</div>
						</div>
					`
				},
				{
					fieldname: "discount_percentage",
					fieldtype: "Percent",
					label: __("Discount Percentage (%)"),
					default: this.discount_percentage,
				},
				{
					fieldname: "discount_amount",
					fieldtype: "Currency",
					label: __("Flat Discount Amount"),
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
					description: __("Exceeds cashier cap (Max 10% or Rs 100). Manager PIN is required."),
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
			primary_action: async (values) => {
				const pct = flt(values.discount_percentage);
				const amt = flt(values.discount_amount);

				if (pct <= 0 && amt <= 0) {
					this.discount_percentage = 0;
					this.discount_amount = 0;
					this.discount_approved_by = null;
					this.discount_manager_pin = null;
					d.hide();
					this.update_cart_summary();
					return;
				}

				const exceeds_cap = pct > 10.0 || amt > 100.0;
				if (exceeds_cap) {
					const pin = (values.manager_pin || "").trim();
					if (!pin) {
						frappe.msgprint({
							title: __("Manager PIN Required"),
							indicator: "orange",
							message: __("Discount of {0}% or {1} exceeds the cashier cap (10% or Rs 100). Please provide a valid Manager PIN.", [pct, format_curr(amt)])
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
								branch: this.branch || (this.profile_data && this.profile_data.custom_branch) || null,
								cashier: frappe.session.user,
								details: `Discount override: ${pct}% or Rs ${amt}. Reason: ${values.discount_reason || "Manager approval"}`
							}
						});
						frappe.dom.unfreeze();

						if (vres.message && vres.message.success) {
							this.discount_percentage = pct;
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
					this.discount_percentage = pct;
					this.discount_amount = amt;
					this.discount_approved_by = null;
					this.discount_manager_pin = null;
					d.hide();
					this.update_cart_summary();
				}
			}
		});

		const check_cap_visibility = () => {
			const p = flt(d.get_value("discount_percentage"));
			const a = flt(d.get_value("discount_amount"));
			const show_pin = p > 10.0 || a > 100.0;
			d.set_df_property("pin_section", "hidden", show_pin ? 0 : 1);
			d.set_df_property("manager_pin", "hidden", show_pin ? 0 : 1);
			d.set_df_property("discount_reason", "hidden", show_pin ? 0 : 1);
		};

		d.$wrapper.on("input", "input[data-fieldname='discount_percentage']", () => {
			d.set_value("discount_amount", 0);
			check_cap_visibility();
		});

		d.$wrapper.on("input", "input[data-fieldname='discount_amount']", () => {
			d.set_value("discount_percentage", 0);
			check_cap_visibility();
		});

		d.$wrapper.on("click", ".fpos-preset-btn", (e) => {
			const type = $(e.currentTarget).data("type");
			const val = flt($(e.currentTarget).data("val"));
			if (type === "pct") {
				d.set_value("discount_amount", 0);
				d.set_value("discount_percentage", val);
			} else {
				d.set_value("discount_percentage", 0);
				d.set_value("discount_amount", val);
			}
			check_cap_visibility();
		});

		d.$wrapper.on("click", ".fpos-preset-clear", () => {
			d.set_value("discount_percentage", 0);
			d.set_value("discount_amount", 0);
			check_cap_visibility();
		});

		this.style_dialog(d);
		d.show();
		check_cap_visibility();
	}

	async show_closing_page() {
		this.current_view = "closing";
		this.wrapper.find(".fpos-body").hide();
		const $closing = this.wrapper.find(".fpos-closing-page");
		$closing.show().addClass("active").html(`
			<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:65vh;gap:16px;">
				<div class="fpos-spinner" style="width:44px;height:44px;border:3px solid #e2e8f0;border-top-color:#ea580c;border-radius:50%;animation:fpos-spin .8s linear infinite;"></div>
				<div style="color:#475569;font-size:16px;font-weight:700;">${__("Compiling Today's Register Closing & Sales Analytics...")}</div>
				<div style="color:#94a3b8;font-size:13px;">${__("Reconciling Sales Invoices, Cash Drawer & Payment Modes")}</div>
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
				<tr style="border-bottom: 1px solid #f1f5f9;">
					<td style="padding: 10px 14px; font-weight: 700; color: #ea580c; width: 40px;">#${idx + 1}</td>
					<td style="padding: 10px 14px;">
						<div style="font-weight: 600; color: #1e293b;">${it.item_name}</div>
						<small style="color: #94a3b8;">${it.item_code}</small>
					</td>
					<td style="padding: 10px 14px; text-align: center; font-weight: 700; color: #334155;">
						<span style="background: #f1f5f9; padding: 3px 10px; border-radius: 12px;">${it.qty}</span>
					</td>
					<td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #0f172a;">${format_curr(it.amount)}</td>
				</tr>
			`).join("");
		} else {
			top_items_html = `<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8;">${__("No items sold today yet")}</td></tr>`;
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
			const icon = is_cash ? "💵" : (p.mode_of_payment || "").toLowerCase().includes("card") ? "💳" : "📱";

			return `
				<tr class="fpos-recon-row" data-mode="${p.mode_of_payment}" data-opening="${p.opening_amount}" data-sales="${p.invoice_amount}" data-expected="${p.expected_amount}" style="border-bottom: 1px solid #f1f5f9;">
					<td style="padding: 10px 14px; font-weight: 700; color: #1e293b;">
						<span style="margin-right: 6px;">${icon}</span>${p.mode_of_payment}
					</td>
					<td style="padding: 10px 14px; text-align: right; color: #64748b; font-weight: 600;">
						${format_curr(p.opening_amount)}
					</td>
					<td style="padding: 10px 14px; text-align: right; color: #16a34a; font-weight: 700;">
						+${format_curr(p.invoice_amount)}
					</td>
					<td style="padding: 10px 14px; text-align: right; font-weight: 800; color: #0f172a;">
						${format_curr(p.expected_amount)}
					</td>
					<td style="padding: 8px 14px; text-align: right; width: 150px;">
						<input type="number" step="any" class="form-control fpos-recon-counted-input" data-mode="${p.mode_of_payment}" value="${flt(p.closing_amount)}" style="height: 36px; text-align: right; font-size: 14px; font-weight: 700; border-radius: 6px; border: 1px solid #cbd5e1;" />
					</td>
					<td style="padding: 8px 14px; text-align: center; width: 140px;">
						<span class="fpos-mode-variance-badge" data-mode="${p.mode_of_payment}" style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #dcfce7; color: #15803d; white-space: nowrap;">
							🟢 ${__("Exact Match")}
						</span>
					</td>
				</tr>
			`;
		}).join("") || `<tr><td colspan="6" style="text-align:center;padding:20px;color:#94a3b8;">${__("No payment modes found for this shift")}</td></tr>`;

		// Order Types Rows
		const ot_rows = (data.order_types || []).map(ot => {
			const icon = ot.order_type === "Dine In" ? "🍽️" : ot.order_type === "Takeaway" ? "🥡" : "🛵";
			return `
				<tr style="border-bottom: 1px solid #f1f5f9;">
					<td style="padding: 10px 14px; font-weight: 600; color: #1e293b;">${icon} ${ot.order_type}</td>
					<td style="padding: 10px 14px; text-align: center; color: #64748b; font-weight: 600;">${ot.count}</td>
					<td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #0f172a;">${format_curr(ot.amount)}</td>
				</tr>
			`;
		}).join("") || `<tr><td colspan="3" style="text-align:center;padding:20px;color:#94a3b8;">${__("No sales recorded today")}</td></tr>`;

		// Invoices Table Rows
		let inv_rows = "";
		const invoices = data.invoices || [];
		if (invoices.length > 0) {
			inv_rows = invoices.map(inv => {
				const ot_icon = inv.custom_order_type === "Dine In" ? "🍽️" : inv.custom_order_type === "Takeaway" ? "🥡" : "🛵";
				const doc_route = inv.doctype === "POS Invoice" ? `/app/pos-invoice/${inv.name}` : `/app/sales-invoice/${inv.name}`;
				const is_paid = flt(inv.outstanding_amount) <= 0.001;
				const status_badge = is_paid
					? `<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">Paid</span>`
					: `<span style="background: #fee2e2; color: #b91c1c; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;">Unpaid (${format_curr(inv.outstanding_amount)})</span>`;

				return `
					<tr style="border-bottom: 1px solid #f1f5f9;">
						<td style="padding: 10px 14px;">
							<a href="${doc_route}" target="_blank" style="font-weight: 700; color: #2563eb; text-decoration: none;">${inv.name} ↗</a>
						</td>
						<td style="padding: 10px 14px; color: #64748b; font-size: 12px;">${(inv.posting_time || "").substring(0, 5)}</td>
						<td style="padding: 10px 14px; font-weight: 500; color: #1e293b;">${inv.customer_name || inv.customer || "Walk-in"}</td>
						<td style="padding: 10px 14px; font-size: 12px; color: #475569;">${ot_icon} ${inv.custom_order_type || "Dine In"}</td>
						<td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #0f172a;">${format_curr(inv.grand_total)}</td>
						<td style="padding: 10px 14px; text-align: center;">${status_badge}</td>
					</tr>
				`;
			}).join("");
		} else {
			inv_rows = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">${__("No invoices generated in this shift")}</td></tr>`;
		}

		$page.html(`
			<div style="max-width: 1200px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 24px;">
				<!-- Top Header Navigation -->
				<div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 16px 24px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
					<div style="display: flex; align-items: center; gap: 14px;">
						<button class="btn btn-default fpos-back-to-pos-btn" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; border-radius: 8px;">
							<span>←</span>
							<span>${__("Back to Register")}</span>
						</button>
						<div>
							<h3 style="margin: 0; font-size: 18px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
								<span>📊</span> ${__("POS Shift Complete & Shift-Closing")}
							</h3>
							<div style="font-size: 12px; color: #64748b; margin-top: 2px;">
								${__("POS Profile")}: <b style="color: #1e293b;">${data.pos_profile || this.pos_profile}</b> &bull;
								${__("Date")}: <b>${data.today}</b> &bull;
								${__("Cashier")}: <b>${data.user_fullname || data.user}</b> &bull;
								${__("Opening Shift")}: <b style="color: #0369a1;">${data.opening_entry || this.pos_opening || __("Active")}</b>
							</div>
						</div>
					</div>

					<div style="display: flex; gap: 10px;">
						<button class="btn btn-default fpos-print-closing-btn" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; border-radius: 8px;">
							<span>🖨️</span>
							<span>${__("Print Z-Report")}</span>
						</button>
						<button class="btn btn-danger fpos-exit-desk-btn" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 800; border-radius: 8px;">
							<span>🔒</span>
							<span>${__("Submit POS Closing Entry & Exit")}</span>
						</button>
					</div>
				</div>

				<!-- 4 Main KPI Cards -->
				<div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
					<!-- Total Sales -->
					<div style="background: #fff; border: 1px solid #bbf7d0; border-left: 5px solid #22c55e; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
						<div style="font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: .5px;">${__("Total Net Sales")}</div>
						<div style="font-size: 26px; font-weight: 900; color: #15803d; margin: 6px 0 2px;">${format_curr(data.net_sales)}</div>
						<div style="font-size: 11px; color: #16a34a;">${__("Gross")}: ${format_curr(data.gross_sales)} &bull; ${__("Taxes")}: ${format_curr(data.total_taxes)}</div>
					</div>

					<!-- Total Orders -->
					<div style="background: #fff; border: 1px solid #bfdbfe; border-left: 5px solid #3b82f6; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
						<div style="font-size: 12px; font-weight: 700; color: #1e40af; text-transform: uppercase; letter-spacing: .5px;">${__("Orders Completed")}</div>
						<div style="font-size: 26px; font-weight: 900; color: #1d4ed8; margin: 6px 0 2px;">${data.total_orders}</div>
						<div style="font-size: 11px; color: #3b82f6;">${__("Average Ticket")}: ${format_curr(data.total_orders ? data.net_sales / data.total_orders : 0)}</div>
					</div>

					<!-- Cash Drawer -->
					<div style="background: #fff; border: 1px solid #fed7aa; border-left: 5px solid #ea580c; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
						<div style="font-size: 12px; font-weight: 700; color: #9a3412; text-transform: uppercase; letter-spacing: .5px;">${__("Expected Cash in Drawer")}</div>
						<div style="font-size: 26px; font-weight: 900; color: #ea580c; margin: 6px 0 2px;">${format_curr(data.expected_cash)}</div>
						<div style="font-size: 11px; color: #c2410c;">${__("Opening")}: ${format_curr(data.opening_cash)} &bull; ${__("Cash Sales")}: ${format_curr(data.cash_sales)}</div>
					</div>

					<!-- Settled Status -->
					<div style="background: #fff; border: 1px solid #e9d5ff; border-left: 5px solid #a855f7; border-radius: 12px; padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
						<div style="font-size: 12px; font-weight: 700; color: #6b21a8; text-transform: uppercase; letter-spacing: .5px;">${__("Settled Volume")}</div>
						<div style="font-size: 26px; font-weight: 900; color: #7e22ce; margin: 6px 0 2px;">${format_curr(data.total_paid)}</div>
						<div style="font-size: 11px; color: ${flt(data.total_outstanding) > 0 ? "#dc2626" : "#7e22ce"};">
							${__("Outstanding")}: <b>${format_curr(data.total_outstanding)}</b>
						</div>
					</div>
				</div>

				<!-- Middle Section: Multi-Payment Reconciliation & Channel Breakdowns -->
				<div style="display: grid; grid-template-columns: 3fr 2fr; gap: 20px;">
					<!-- Multi-Payment Reconciliation Tool -->
					<div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); display: flex; flex-direction: column; gap: 14px;">
						<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px;">
							<div>
								<div style="font-size: 15px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
									<span>💵</span> ${__("Payment Reconciliation & Cash Drawer Count")}
								</div>
								<div style="font-size: 12px; color: #64748b; margin-top: 2px;">
									${__("Physical count vs. expected totals (Opening Float + Shift Invoices)")}
								</div>
							</div>
							<span style="font-size: 11px; background: #eff6ff; color: #1d4ed8; font-weight: 700; padding: 4px 10px; border-radius: 6px;">
								${__("Opening Entry")}: <b>${data.opening_entry || this.pos_opening || __("Active")}</b>
							</span>
						</div>

						<div style="overflow-x: auto;">
							<table style="width: 100%; border-collapse: collapse; font-size: 12px;" class="fpos-recon-table">
								<thead>
									<tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #64748b; text-transform: uppercase; font-size: 10px; font-weight: 700;">
										<th style="padding: 10px 14px; text-align: left;">${__("Mode of Payment")}</th>
										<th style="padding: 10px 14px; text-align: right;">${__("Opening Float")}</th>
										<th style="padding: 10px 14px; text-align: right;">${__("Invoices")}</th>
										<th style="padding: 10px 14px; text-align: right;">${__("Expected")}</th>
										<th style="padding: 10px 14px; text-align: right; width: 150px;">${__("Physically Counted")}</th>
										<th style="padding: 10px 14px; text-align: center; width: 140px;">${__("Variance")}</th>
									</tr>
								</thead>
								<tbody>
									${recon_rows}
								</tbody>
								<tfoot>
									<tr style="background: #f8fafc; font-weight: 800; border-top: 2px solid #e2e8f0;">
										<td style="padding: 10px 14px; color: #1e293b;">${__("Total Reconciliation")}</td>
										<td style="padding: 10px 14px; text-align: right; color: #64748b;">${format_curr(total_opening)}</td>
										<td style="padding: 10px 14px; text-align: right; color: #16a34a;">+${format_curr(total_sales)}</td>
										<td style="padding: 10px 14px; text-align: right; color: #0f172a;" class="fpos-recon-total-expected">${format_curr(total_expected)}</td>
										<td style="padding: 10px 14px; text-align: right; color: #0f172a;" class="fpos-recon-total-counted">${format_curr(total_counted)}</td>
										<td style="padding: 10px 14px; text-align: center;" class="fpos-recon-total-variance">
											<span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #dcfce7; color: #15803d;">🟢 ${__("Balanced")}</span>
										</td>
									</tr>
								</tfoot>
							</table>
						</div>

						<div style="margin-top: 6px;">
							<label style="font-size: 12px; font-weight: 700; color: #475569;">${__("Shift Closing Notes & Remarks:")}</label>
							<textarea class="form-control fpos-closing-notes" rows="2" placeholder="${__("Optional notes regarding cash drawer count, discrepancies, or shift handover...")}" style="font-size: 12px; border-radius: 8px;"></textarea>
						</div>
					</div>

					<!-- Order Types & Channels Breakdown -->
					<div style="display: flex; flex-direction: column; gap: 16px;">
						<!-- Order Channels Breakdown -->
						<div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
							<div style="background: #f8fafc; padding: 12px 16px; font-size: 13px; font-weight: 800; color: #1e293b; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
								<span>📋 ${__("Order Channels (Dine-In, Takeaway, Delivery)")}</span>
								<span style="font-size: 11px; font-weight: 600; color: #64748b;">${(data.order_types || []).length} ${__("Channels")}</span>
							</div>
							<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
								<thead>
									<tr style="background: #fafafa; border-bottom: 1px solid #e2e8f0; color: #64748b; text-transform: uppercase; font-size: 10px; font-weight: 700;">
										<th style="padding: 8px 14px; text-align: left;">${__("Channel")}</th>
										<th style="padding: 8px 14px; text-align: center;">${__("Orders")}</th>
										<th style="padding: 8px 14px; text-align: right;">${__("Total Sales")}</th>
									</tr>
								</thead>
								<tbody>${ot_rows}</tbody>
							</table>
						</div>

						<!-- Shift Details Quick Info -->
						<div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); display: flex; flex-direction: column; gap: 8px;">
							<div style="font-size: 13px; font-weight: 800; color: #1e293b;">ℹ️ ${__("Shift Information")}</div>
							<div style="font-size: 12px; color: #64748b; display: flex; justify-content: space-between;">
								<span>${__("Shift Start Time")}:</span>
								<b style="color: #1e293b;">${data.shift_start ? frappe.datetime.str_to_user(data.shift_start) : __("Current Session")}</b>
							</div>
							<div style="font-size: 12px; color: #64748b; display: flex; justify-content: space-between;">
								<span>${__("Cashier User")}:</span>
								<b style="color: #1e293b;">${data.user} (${data.user_fullname || ""})</b>
							</div>
							<div style="font-size: 12px; color: #64748b; display: flex; justify-content: space-between;">
								<span>${__("Company")}:</span>
								<b style="color: #1e293b;">${data.company || ""}</b>
							</div>
							<div style="font-size: 12px; color: #64748b; display: flex; justify-content: space-between;">
								<span>${__("Total Invoices Generated")}:</span>
								<b style="color: #1e293b;">${(data.invoices || []).length}</b>
							</div>
						</div>
					</div>
				</div>

				<!-- Top Selling Fast Food Items Table -->
				<div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
					<div style="background: #f8fafc; padding: 14px 18px; font-size: 14px; font-weight: 800; color: #1e293b; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
						<span>🍔 ${__("Top Selling Fast Food Items in this Shift")}</span>
						<span style="font-size: 11px; color: #64748b; font-weight: 600;">${(data.top_items || []).length} ${__("Products Ranked")}</span>
					</div>
					<table style="width: 100%; border-collapse: collapse; font-size: 13px;">
						<thead>
							<tr style="background: #fafafa; border-bottom: 1px solid #e2e8f0; color: #64748b; text-transform: uppercase; font-size: 10px; font-weight: 700;">
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
				<div style="background: #fff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
					<div style="background: #f8fafc; padding: 14px 18px; font-size: 14px; font-weight: 800; color: #1e293b; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
						<span>🧾 ${__("Shift Invoice Transactions")}</span>
						<span style="font-size: 11px; color: #64748b; font-weight: 600;">${invoices.length} ${__("Total Invoices Generated")}</span>
					</div>
					<div style="max-height: 380px; overflow-y: auto;">
						<table style="width: 100%; border-collapse: collapse; font-size: 12px;">
							<thead style="position: sticky; top: 0; background: #fafafa; z-index: 2;">
								<tr style="border-bottom: 1px solid #e2e8f0; color: #64748b; text-transform: uppercase; font-size: 10px; font-weight: 700;">
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
				<div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 16px 24px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(0,0,0,0.05); margin-bottom: 24px;">
					<button class="btn btn-default fpos-back-to-pos-btn" style="font-weight: 700; border-radius: 8px; padding: 8px 18px;">
						<span>← ${__("Return to POS Register")}</span>
					</button>

					<div style="display: flex; gap: 12px;">
						<button class="btn btn-default fpos-print-closing-btn" style="font-weight: 700; border-radius: 8px; padding: 8px 18px; border: 1px solid #cbd5e1;">
							<span>🖨️ ${__("Print Z-Report")}</span>
						</button>
						<button class="btn btn-danger fpos-exit-desk-btn" style="font-weight: 800; border-radius: 8px; padding: 8px 22px;">
							<span>🔒 ${__("Submit POS Closing Entry & Exit")}</span>
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
					$badge.css({ background: "#dcfce7", color: "#15803d" }).text(`🟢 ${__("Exact Match")}`);
				} else if (diff < 0) {
					$badge.css({ background: "#fee2e2", color: "#b91c1c" }).text(`🔴 ${__("Short")}: -${format_curr(Math.abs(diff))}`);
				} else {
					$badge.css({ background: "#fef3c7", color: "#b45309" }).text(`🟡 ${__("Surplus")}: +${format_curr(diff)}`);
				}
			});

			$page.find(".fpos-recon-total-expected").text(format_curr(total_exp));
			$page.find(".fpos-recon-total-counted").text(format_curr(total_cnt));

			const total_diff = total_cnt - total_exp;
			const $tot_badge = $page.find(".fpos-recon-total-variance");
			if (Math.abs(total_diff) < 0.01) {
				$tot_badge.html(`<span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #dcfce7; color: #15803d;">🟢 ${__("Balanced")}</span>`);
			} else if (total_diff < 0) {
				$tot_badge.html(`<span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #fee2e2; color: #b91c1c;">🔴 -${format_curr(Math.abs(total_diff))}</span>`);
			} else {
				$tot_badge.html(`<span style="font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; background: #fef3c7; color: #b45309;">🟡 +${format_curr(total_diff)}</span>`);
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

		// Finalize Shift & Submit POS Closing Entry
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

		const print_content = `
			<!DOCTYPE html>
			<html>
			<head>
				<meta charset="utf-8">
				<title>POS Register Closing Report</title>
				<style>
					body { font-family: monospace, sans-serif; width: 300px; margin: 0 auto; padding: 15px; font-size: 12px; color: #000; }
					.text-center { text-align: center; }
					.bold { font-weight: bold; }
					.divider { border-top: 1px dashed #000; margin: 8px 0; }
					.row { display: flex; justify-content: space-between; margin: 3px 0; }
					table { width: 100%; border-collapse: collapse; margin: 4px 0; }
					@media print {
						body { width: 100%; margin: 0; padding: 0; }
					}
				</style>
			</head>
			<body>
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
				<div class="row"><span>Taxes:</span><span>${format_curr(data.total_taxes)}</span></div>
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
			</body>
			</html>
		`;

		const win = window.open("", "_blank");
		win.document.write(print_content);
		win.document.close();
		setTimeout(() => {
			win.focus();
			win.print();
		}, 300);
	}

	refresh() {
		if (this.pos_profile) {
			this.load_data();
		}
	}
};
