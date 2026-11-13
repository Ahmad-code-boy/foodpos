// ── Universal Static Title & Report Initialization Guard (Zero 'undefined' Flash) ──
(function() {
	function get_active_report_title() {
		const path = (window.location && window.location.pathname) || "";
		const hash = (window.location && window.location.hash) || "";
		if (path.includes("Served") || hash.includes("Served")) {
			return "Served KOT Exception List";
		}
		const route = (window.frappe && frappe.get_route && frappe.get_route()) || [];
		if (route && (route[1] === "Served KOT Exception List" || route[0] === "Served KOT Exception List")) {
			return "Served KOT Exception List";
		}
		if (route && route[0] === "query-report" && route[1]) {
			return route[1];
		}
		return null;
	}

	// 1. Patch QueryReport.prototype.setup_defaults so page_title is never undefined during init()
	if (window.frappe && frappe.views && frappe.views.QueryReport) {
		const _orig_qr_setup = frappe.views.QueryReport.prototype.setup_defaults;
		frappe.views.QueryReport.prototype.setup_defaults = function() {
			if (_orig_qr_setup) _orig_qr_setup.call(this);
			this.route = (frappe.get_route && frappe.get_route()) || [];
			this.report_name = this.route[1] || "";
			this.page_title = __(this.report_name || get_active_report_title() || "Query Report");
		};
	}

	// 2. Patch BaseList.prototype.set_title to guard against undefined page_title
	if (window.frappe && frappe.views && frappe.views.BaseList) {
		const _orig_bl_title = frappe.views.BaseList.prototype.set_title;
		frappe.views.BaseList.prototype.set_title = function() {
			if (!this.page_title || this.page_title === "undefined") {
				const rep = get_active_report_title();
				if (rep) this.page_title = __(rep);
			}
			if (this.page_title && this.page_title !== "undefined") {
				if (_orig_bl_title) _orig_bl_title.call(this);
			}
		};
	}

	// 3. Patch frappe.utils.set_title to never write 'undefined' to document.title
	if (window.frappe && frappe.utils) {
		const _orig_utils_title = frappe.utils.set_title;
		frappe.utils.set_title = function(title) {
			const str = String(title);
			if (!title || str === "undefined") {
				const rep = get_active_report_title();
				if (rep) title = rep;
				else return;
			}
			return _orig_utils_title.call(this, title);
		};
	}

	// 4. Pre-populate route_titles
	if (window.frappe) {
		if (!frappe.route_titles) frappe.route_titles = {};
		frappe.route_titles["query-report/Served KOT Exception List"] = "Served KOT Exception List";
		frappe.route_titles["app/query-report/Served KOT Exception List"] = "Served KOT Exception List";
		frappe.route_titles["Served KOT Exception List"] = "Served KOT Exception List";
	}

	// 5. Initial title sync if on report URL directly
	const init_title = get_active_report_title();
	if (init_title) {
		document.title = init_title;
	}
})();

// Food POS — Main Bundle Entry
// This file is loaded by frappe.require("food-pos.bundle.js") from food_pos.js
// It stitches together ItemSelector, Cart, Payment, Kitchen, and TableManager
// into a single Controller class.

frappe.provide("foodpos.FoodPOS");

/* ── Import component modules ───────────────────────────────────────────────
   Frappe's bundler (esbuild via bench build) resolves these paths relative to
   the page directory when declared in hooks page_js. We use inline class
   definitions here so that a single bundle file is self-contained and works
   even without a separate build step (plain <script> include).                */

// ─────────────────────────────────────────────────────────────────────────────
// Inline: ItemSelector
// ─────────────────────────────────────────────────────────────────────────────
foodpos.FoodPOS.ItemSelector = class {
	constructor({ wrapper, events, pos_profile, settings }) {
		this.wrapper = wrapper;
		this.events = events;
		this.pos_profile = pos_profile;
		this.settings = settings || {};
		this.search_term = "";
		this.current_category = "All";
		this.categories = [];
		this.page = 0;
		this.page_size = 40;
		this.loading = false;
		this.init();
	}
	init() { this.prepare_dom(); this.load_categories(); this.load_items(); this.bind_events(); }
	prepare_dom() {
		this.wrapper.append(`
			<section class="fpos-item-selector">
				<div class="fpos-search-bar">
					<span class="fpos-search-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
					<input class="fpos-search-input" type="text" placeholder="${__("Search items...")}" autocomplete="off"/>
					<button class="fpos-search-clear" style="display:none;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
				</div>
				<div class="fpos-category-scroll"><div class="fpos-categories"></div></div>
				<div class="fpos-items-grid-wrapper">
					<div class="fpos-items-grid"></div>
					<div class="fpos-items-loading" style="display:none;"><div class="fpos-spinner"></div><span>${__("Loading...")}</span></div>
					<div class="fpos-items-empty" style="display:none;"><svg viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="38" stroke="#e2e8f0" stroke-width="2"/></svg><p>${__("No items found")}</p><small>${__("Try a different category or search term")}</small></div>
				</div>
			</section>`);
		this.$component = this.wrapper.find(".fpos-item-selector");
		this.$search_input = this.$component.find(".fpos-search-input");
		this.$search_clear = this.$component.find(".fpos-search-clear");
		this.$categories = this.$component.find(".fpos-categories");
		this.$items_grid = this.$component.find(".fpos-items-grid");
		this.$loading = this.$component.find(".fpos-items-loading");
		this.$empty = this.$component.find(".fpos-items-empty");
	}
	async load_categories() {
		try {
			const res = await frappe.call({ method: "foodpos.foodpos.api.food_pos.get_item_groups", args: { pos_profile: this.pos_profile } });
			const groups = res.message || [];
			this.categories = ["All", ...groups.map(g => g.name)];
		} catch(_) { this.categories = ["All"]; }
		this.render_categories();
	}
	render_categories() {
		this.$categories.empty();
		const icons = { All:"🍽️", Beverages:"🥤", Starters:"🥗", "Main Course":"🍛", Desserts:"🍰", Burgers:"🍔", Pizza:"🍕", Pasta:"🍝", Sushi:"🍣", Salads:"🥙", Soups:"🍲", Sandwiches:"🥪", Wraps:"🌯", Sides:"🍟", Breakfast:"🍳", Seafood:"🦐", Grill:"🥩", Vegan:"🌱" };
		this.categories.forEach(cat => {
			this.$categories.append(`<button class="fpos-category-tab ${cat === this.current_category ? "active" : ""}" data-category="${cat}"><span class="fpos-cat-icon">${icons[cat]||"🍴"}</span><span class="fpos-cat-label">${__(cat)}</span></button>`);
		});
	}
	async load_items(reset = true) {
		if (this.loading) return;
		this.loading = true;
		if (reset) { this.page = 0; this.$items_grid.empty(); }
		this.$loading.show(); this.$empty.hide();
		try {
			const res = await frappe.call({ method: "foodpos.foodpos.api.food_pos.get_food_items", args: { pos_profile: this.pos_profile, item_group: this.current_category === "All" ? "" : this.current_category, search_term: this.search_term, start: this.page * this.page_size, page_length: this.page_size } });
			const items = (res.message && res.message.items) || [];
			if (reset && items.length === 0) { this.$empty.show(); } else { items.forEach(i => this.render_item_card(i)); this.page++; }
		} catch(_) { frappe.show_alert({ message: __("Failed to load items"), indicator: "red" }); }
		finally { this.$loading.hide(); this.loading = false; }
	}
	render_item_card(item) {
		const price = format_currency(item.price_list_rate || 0, item.currency);
		const img = item.item_image ? `<img src="${item.item_image}" alt="${item.item_name}" loading="lazy"/>` : `<div class="fpos-item-placeholder">${this.get_emoji(item.item_group)}</div>`;
		const unavailable = (item.actual_qty <= 0 && item.is_stock_item) ? "fpos-item-unavailable" : "";
		const badge = item.is_vegetarian ? `<span class="fpos-veg-badge">🌱</span>` : "";
		const card = $(`<div class="fpos-item-card ${unavailable}" data-item-code="${item.item_code}"><div class="fpos-item-image">${img}${badge}${unavailable ? `<div class="fpos-unavail-overlay">${__("Unavailable")}</div>` : ""}</div><div class="fpos-item-info"><div class="fpos-item-name" title="${item.item_name}">${item.item_name}</div><div class="fpos-item-price">${price}</div></div><button class="fpos-add-btn" ${unavailable?"disabled":""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button></div>`);
		card.find(".fpos-add-btn").on("click", e => { e.stopPropagation(); if (!unavailable) { this.events.add_item_to_cart(item); card.addClass("fpos-item-added"); setTimeout(() => card.removeClass("fpos-item-added"), 400); } });
		card.on("click", () => { if (!unavailable) this.show_item_detail(item); });
		this.$items_grid.append(card);
	}
	show_item_detail(item) {
		const d = new frappe.ui.Dialog({ title: item.item_name, fields: [{ fieldname:"item_note", fieldtype:"Small Text", label:__("Special Instructions"), placeholder:__("e.g. No onions...") }, { fieldname:"qty", fieldtype:"Int", label:__("Quantity"), default:1, reqd:1 }], primary_action_label: __("Add to Order"), primary_action: ({ qty, item_note }) => { this.events.add_item_to_cart({ ...item, qty: qty||1, item_note }); d.hide(); } });
		if (item.item_image) $(d.wrapper).find(".modal-body").prepend(`<img src="${item.item_image}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;margin-bottom:12px;"/>`);
		d.show();
	}
	get_emoji(g) { return { Beverages:"🥤",Starters:"🥗","Main Course":"🍛",Desserts:"🍰",Burgers:"🍔",Pizza:"🍕",Pasta:"🍝",Soups:"🍲",Seafood:"🦐",Grill:"🥩" }[g] || "🍴"; }
	bind_events() {
		let t;
		this.$search_input.on("input", e => { this.search_term = e.target.value.trim(); this.$search_clear.toggle(!!this.search_term); clearTimeout(t); t = setTimeout(() => this.load_items(), 300); });
		this.$search_clear.on("click", () => { this.search_term = ""; this.$search_input.val("").focus(); this.$search_clear.hide(); this.load_items(); });
		this.$categories.on("click", ".fpos-category-tab", e => { const cat = $(e.currentTarget).data("category"); if (cat === this.current_category) return; this.current_category = cat; this.$categories.find(".fpos-category-tab").removeClass("active"); $(e.currentTarget).addClass("active"); this.load_items(); });
		this.$component.find(".fpos-items-grid-wrapper").on("scroll", e => { const el = e.target; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) this.load_items(false); });
	}
	refresh() { this.search_term = ""; this.current_category = "All"; this.$search_input.val(""); this.$search_clear.hide(); this.$categories.find(".fpos-category-tab").removeClass("active").first().addClass("active"); this.load_items(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Inline: Cart
// ─────────────────────────────────────────────────────────────────────────────
foodpos.FoodPOS.Cart = class {
	constructor({ wrapper, events, pos_profile, settings }) {
		this.wrapper = wrapper; this.events = events; this.pos_profile = pos_profile; this.settings = settings || {};
		this.order_items = []; this.customer = null; this.order_type = "Dine In"; this.table = null;
		this.discount_amount = 0; this.discount_percentage = 0; this.tax_rate = (settings||{}).tax_rate || 0; this.order_note = "";
		this.init();
	}
	init() { this.prepare_dom(); this.bind_events(); }
	prepare_dom() {
		this.wrapper.append(`
			<section class="fpos-cart">
				<div class="fpos-cart-header">
					<div class="fpos-cart-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg><span>${__("Current Order")}</span></div>
					<div class="fpos-order-type-tabs">
						<button class="fpos-ot-tab active" data-type="Dine In">🪑 ${__("Dine In")}</button>
						<button class="fpos-ot-tab" data-type="Takeaway">🥡 ${__("Takeaway")}</button>
						<button class="fpos-ot-tab" data-type="Delivery">🛵 ${__("Delivery")}</button>
					</div>
				</div>
				<div class="fpos-cart-meta">
					<div class="fpos-meta-field fpos-customer-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="fpos-meta-value fpos-customer-label">${__("Add Customer")}</span></div>
					<div class="fpos-meta-field fpos-table-field"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="4" rx="1"/><line x1="7" y1="12" x2="7" y2="20"/><line x1="17" y1="12" x2="17" y2="20"/></svg><span class="fpos-meta-value fpos-table-label">${__("Select Table")}</span></div>
				</div>
				<div class="fpos-cart-items-wrapper">
					<div class="fpos-cart-items"></div>
					<div class="fpos-cart-empty"><svg viewBox="0 0 80 80" fill="none"><circle cx="40" cy="40" r="38" stroke="#e2e8f0" stroke-width="2"/><path d="M28 44c0 0 4-8 12-8s12 8 12 8" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/><circle cx="32" cy="34" r="2" fill="#94a3b8"/><circle cx="48" cy="34" r="2" fill="#94a3b8"/></svg><p>${__("Your order is empty")}</p><small>${__("Add items from the menu")}</small></div>
				</div>
				<div class="fpos-order-note-row"><button class="fpos-add-note-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span class="fpos-note-label">${__("Add order note")}</span></button></div>
				<div class="fpos-cart-totals">
					<div class="fpos-total-row"><span>${__("Subtotal")}</span><span class="fpos-subtotal-val">—</span></div>
					<div class="fpos-total-row fpos-discount-row" style="display:none;"><span>${__("Discount")}</span><span class="fpos-discount-val fpos-negative">—</span></div>
					<div class="fpos-total-row fpos-tax-row" style="display:none;"><span>${__("Tax")} (<span class="fpos-tax-pct">${this.tax_rate}%</span>)</span><span class="fpos-tax-val">—</span></div>
					<div class="fpos-total-row fpos-grand-total-row"><span>${__("Total")}</span><span class="fpos-grand-total-val">—</span></div>
				</div>
				<div class="fpos-cart-actions">
					<button class="fpos-btn fpos-btn-secondary fpos-discount-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>${__("Discount")}</button>
					<button class="fpos-btn fpos-btn-secondary fpos-kot-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/></svg>${__("Send KOT")}</button>
					<button class="fpos-btn fpos-btn-danger fpos-clear-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>${__("Clear")}</button>
					<button class="fpos-btn fpos-btn-primary fpos-pay-btn" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>${__("Pay")}</button>
				</div>
			</section>`);
		this.$component = this.wrapper.find(".fpos-cart");
		this.$items_list = this.$component.find(".fpos-cart-items");
		this.$empty_state = this.$component.find(".fpos-cart-empty");
		this.$subtotal = this.$component.find(".fpos-subtotal-val");
		this.$grand_total = this.$component.find(".fpos-grand-total-val");
		this.$pay_btn = this.$component.find(".fpos-pay-btn");
		this.$customer_label = this.$component.find(".fpos-customer-label");
		this.$table_label = this.$component.find(".fpos-table-label");
		this.$note_label = this.$component.find(".fpos-note-label");
	}
	add_item(item) {
		const qty = item.qty || 1;
		const existing = this.order_items.find(i => i.item_code === item.item_code && !item.item_note && !i.item_note);
		if (existing) { existing.qty += qty; existing.amount = existing.qty * existing.rate; }
		else { this.order_items.push({ item_code: item.item_code, item_name: item.item_name, qty, rate: item.price_list_rate || 0, amount: (item.price_list_rate || 0) * qty, item_note: item.item_note || "", uom: item.uom || item.stock_uom || "Nos", item_image: item.item_image || "", item_group: item.item_group || "" }); }
		this.render(); this.events.on_cart_update && this.events.on_cart_update(this.get_order());
	}
	get_order() {
		const t = this.calc(); return { items: this.order_items, customer: this.customer, table: this.table, order_type: this.order_type, order_note: this.order_note, discount_amount: t.discount, discount_percentage: this.discount_percentage, tax_amount: t.tax, grand_total: t.grand_total, subtotal: t.subtotal };
	}
	set_customer(c) { this.customer = c; this.$customer_label.text(c || __("Add Customer")); }
	set_table(t, no) { this.table = t; this.$table_label.text(no ? `🪑 ${__("Table")} ${no}` : __("Select Table")); }
	clear_cart() { this.order_items = []; this.discount_amount = 0; this.discount_percentage = 0; this.order_note = ""; this.$note_label.text(__("Add order note")); this.render(); }
	calc() {
		const subtotal = this.order_items.reduce((a, i) => a + i.amount, 0);
		const discount = this.discount_percentage > 0 ? (subtotal * this.discount_percentage) / 100 : this.discount_amount;
		const taxable = subtotal - discount; const tax = (taxable * this.tax_rate) / 100;
		return { subtotal, discount, tax, grand_total: taxable + tax };
	}
	render() {
		this.$items_list.empty();
		if (!this.order_items.length) { this.$empty_state.show(); this.$pay_btn.prop("disabled", true); this.render_totals({ subtotal:0, discount:0, tax:0, grand_total:0 }); return; }
		this.$empty_state.hide(); this.order_items.forEach((item, idx) => this.render_row(item, idx)); this.$pay_btn.prop("disabled", false); this.render_totals(this.calc());
	}
	render_row(item, idx) {
		const fmt = v => format_currency(v, frappe.defaults.get_default("currency"));
		const row = $(`<div class="fpos-cart-row" data-idx="${idx}"><div class="fpos-cart-row-left">${item.item_image ? `<img class="fpos-cart-thumb" src="${item.item_image}" alt=""/>` : `<div class="fpos-cart-thumb fpos-thumb-placeholder">${this.get_emoji(item.item_group)}</div>`}</div><div class="fpos-cart-row-body"><div class="fpos-cart-row-name">${item.item_name}</div>${item.item_note ? `<div class="fpos-cart-row-note">📝 ${item.item_note}</div>` : ""}<div class="fpos-cart-row-price">${fmt(item.rate)} × ${item.qty}</div></div><div class="fpos-cart-row-right"><div class="fpos-qty-ctrl"><button class="fpos-qty-btn fpos-qty-dec" data-idx="${idx}">−</button><span class="fpos-qty-val">${item.qty}</span><button class="fpos-qty-btn fpos-qty-inc" data-idx="${idx}">+</button></div><div class="fpos-cart-row-amount">${fmt(item.amount)}</div><button class="fpos-row-remove" data-idx="${idx}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div></div>`);
		this.$items_list.append(row);
	}
	render_totals({ subtotal, discount, tax, grand_total }) {
		const fmt = v => format_currency(v, frappe.defaults.get_default("currency"));
		this.$subtotal.text(fmt(subtotal)); this.$grand_total.text(fmt(grand_total));
		discount > 0 ? this.$component.find(".fpos-discount-row").show().find(".fpos-discount-val").text(`− ${fmt(discount)}`) : this.$component.find(".fpos-discount-row").hide();
		this.tax_rate > 0 ? this.$component.find(".fpos-tax-row").show().find(".fpos-tax-val").text(fmt(tax)) : this.$component.find(".fpos-tax-row").hide();
	}
	get_emoji(g) { return { Beverages:"🥤",Starters:"🥗","Main Course":"🍛",Desserts:"🍰",Burgers:"🍔",Pizza:"🍕" }[g] || "🍴"; }
	bind_events() {
		const me = this;
		this.$component.on("click", ".fpos-ot-tab", function() { me.$component.find(".fpos-ot-tab").removeClass("active"); $(this).addClass("active"); me.order_type = $(this).data("type"); me.$component.find(".fpos-table-field").toggle(me.order_type === "Dine In"); });
		this.$items_list.on("click", ".fpos-qty-dec", function() { const i = parseInt($(this).data("idx")); if (me.order_items[i].qty > 1) { me.order_items[i].qty--; me.order_items[i].amount = me.order_items[i].qty * me.order_items[i].rate; } else { me.order_items.splice(i,1); } me.render(); me.events.on_cart_update && me.events.on_cart_update(me.get_order()); });
		this.$items_list.on("click", ".fpos-qty-inc", function() { const i = parseInt($(this).data("idx")); me.order_items[i].qty++; me.order_items[i].amount = me.order_items[i].qty * me.order_items[i].rate; me.render(); me.events.on_cart_update && me.events.on_cart_update(me.get_order()); });
		this.$items_list.on("click", ".fpos-row-remove", function() { me.order_items.splice(parseInt($(this).data("idx")),1); me.render(); me.events.on_cart_update && me.events.on_cart_update(me.get_order()); });
		this.$component.find(".fpos-customer-field").on("click", () => { const d = new frappe.ui.Dialog({ title:__("Select Customer"), fields:[{ fieldname:"customer", fieldtype:"Link", label:__("Customer"), options:"Customer", reqd:1 }], primary_action_label:__("Select"), primary_action:({customer}) => { me.set_customer(customer); d.hide(); } }); d.show(); });
		this.$component.find(".fpos-table-field").on("click", () => { me.events.open_table_selector && me.events.open_table_selector(); });
		this.$component.find(".fpos-add-note-btn").on("click", () => { const d = new frappe.ui.Dialog({ title:__("Order Note"), fields:[{ fieldname:"order_note", fieldtype:"Small Text", label:__("Note"), default:me.order_note }], primary_action_label:__("Save"), primary_action:({order_note}) => { me.order_note = order_note||""; me.$note_label.text(me.order_note ? `📝 ${me.order_note.substring(0,30)}` : __("Add order note")); d.hide(); } }); d.show(); });
		this.$component.find(".fpos-discount-btn").on("click", () => { const d = new frappe.ui.Dialog({ title:__("Apply Discount"), fields:[{ fieldname:"discount_type", fieldtype:"Select", label:__("Type"), options:["Percentage","Flat Amount"], default:"Percentage" },{ fieldname:"discount_value", fieldtype:"Float", label:__("Value"), reqd:1 }], primary_action_label:__("Apply"), primary_action:({discount_type,discount_value}) => { if(discount_type==="Percentage"){me.discount_percentage=discount_value;me.discount_amount=0;}else{me.discount_amount=discount_value;me.discount_percentage=0;} me.render(); d.hide(); frappe.show_alert({message:__("Discount applied"),indicator:"green"}); } }); d.show(); });
		this.$component.find(".fpos-clear-btn").on("click", () => { if (!me.order_items.length) return; frappe.confirm(__("Clear the current order?"), () => me.clear_cart()); });
		this.$component.find(".fpos-kot-btn").on("click", () => { if (!me.order_items.length) { frappe.show_alert({message:__("Add items before sending KOT"),indicator:"orange"}); return; } me.events.send_kot && me.events.send_kot(me.get_order()); });
		this.$pay_btn.on("click", () => { if (!me.order_items.length) return; me.events.open_payment && me.events.open_payment(me.get_order()); });
	}
	refresh() { this.render(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Inline: Payment
// ─────────────────────────────────────────────────────────────────────────────
foodpos.FoodPOS.Payment = class {
	constructor({ wrapper, events, pos_profile, settings }) {
		this.wrapper = wrapper; this.events = events; this.pos_profile = pos_profile;
		this.order = null; this.payment_methods = []; this.payment_lines = [];
		this.active_method = null; this.numpad_target = null;
		this.load_payment_methods();
	}
	async load_payment_methods() {
		try { const res = await frappe.call({ method:"foodpos.foodpos.api.food_pos.get_payment_methods", args:{pos_profile:this.pos_profile} }); this.payment_methods = res.message || []; }
		catch(_) { this.payment_methods = [{ mode_of_payment:"Cash", type:"Cash", icon:"💵" },{ mode_of_payment:"Credit Card", type:"Card", icon:"💳" },{ mode_of_payment:"UPI", type:"UPI", icon:"📱" }]; }
	}
	open(order) {
		this.order = order; this.payment_lines = [];
		const def = this.payment_methods.find(m => m.type==="Cash") || this.payment_methods[0];
		if (def) { this.payment_lines.push({ mode_of_payment:def.mode_of_payment, icon:def.icon||"💵", amount:order.grand_total }); this.active_method = def.mode_of_payment; this.numpad_target = def.mode_of_payment; }
		this.render_dialog();
	}
	render_dialog() {
		if (this.dialog) { try { this.dialog.hide(); } catch(_){} }
		this.dialog = new frappe.ui.Dialog({ title:__("Payment"), size:"large", indicator:"green" });
		$(this.dialog.wrapper).find(".modal-footer").hide();
		const body = $(this.dialog.wrapper).find(".modal-body");
		body.css({ padding:0 });
		const fmt = v => format_currency(v, frappe.defaults.get_default("currency"));
		const cur = frappe.defaults.get_default("currency") || "";
		body.html(`<div class="fpos-payment-panel">
			<div class="fpos-pay-left">
				<div class="fpos-pay-summary">
					<div class="fpos-pay-summary-row"><span>${__("Amount Due")}</span><span style="font-size:18px;font-weight:800;">${fmt(this.order.grand_total)}</span></div>
					${this.order.discount_amount > 0 ? `<div class="fpos-pay-summary-row fpos-negative"><span>${__("Discount")}</span><span>− ${fmt(this.order.discount_amount)}</span></div>` : ""}
					${this.order.tax_amount > 0 ? `<div class="fpos-pay-summary-row"><span>${__("Tax")}</span><span>${fmt(this.order.tax_amount)}</span></div>` : ""}
				</div>
				<div class="fpos-pay-methods-label">${__("Payment Method")}</div>
				<div class="fpos-pay-methods"></div>
				<div class="fpos-pay-lines-label">${__("Payment Details")}</div>
				<div class="fpos-pay-lines"></div>
				<div class="fpos-pay-remaining">
					<div class="fpos-remaining-row"><span>${__("Remaining")}</span><span class="fpos-remaining-val fpos-negative">—</span></div>
					<div class="fpos-change-row" style="display:none;"><span>${__("Change")}</span><span class="fpos-change-val">—</span></div>
				</div>
				<div class="fpos-pay-actions">
					<button class="fpos-btn fpos-btn-secondary fpos-pay-cancel-btn">${__("Cancel")}</button>
					<button class="fpos-btn fpos-btn-primary fpos-pay-confirm-btn" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>${__("Confirm Payment")}</button>
				</div>
			</div>
			<div class="fpos-pay-right">
				<div class="fpos-numpad-label">${__("Enter Amount")}</div>
				<div class="fpos-numpad-display"><span class="fpos-numpad-currency">${cur}</span><span class="fpos-numpad-val">0</span></div>
				<div class="fpos-numpad">${["7","8","9","4","5","6","1","2","3",".","0","⌫"].map(k=>`<button class="fpos-num-key" data-key="${k}">${k==="⌫"?`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>`:k}</button>`).join("")}</div>
				<div class="fpos-quick-amounts"></div>
			</div>
		</div>`);
		this.$dlg = $(this.dialog.wrapper).find(".fpos-payment-panel");
		this.render_payment_methods(); this.render_payment_lines(); this.update_remaining(); this.bind_dialog_events();
		// set numpad display
		const line = this.payment_lines[0]; if (line) this.$dlg.find(".fpos-numpad-val").text(line.amount || 0);
		this.dialog.show();
	}
	render_payment_methods() {
		const $m = this.$dlg.find(".fpos-pay-methods"); $m.empty();
		this.payment_methods.forEach(m => $m.append(`<button class="fpos-pay-method-pill ${m.mode_of_payment===this.active_method?"active":""}" data-method="${m.mode_of_payment}"><span class="fpos-method-icon">${m.icon||"💳"}</span><span>${__(m.mode_of_payment)}</span></button>`));
		// quick amounts for cash
		const $qa = this.$dlg.find(".fpos-quick-amounts"); $qa.empty();
		const is_cash = this.payment_methods.find(m => m.mode_of_payment===this.active_method)?.type === "Cash";
		if (is_cash) { const due = this.order.grand_total; const bases=[10,20,50,100,200,500,1000]; const amts=new Set([due]); for(const b of bases){const r=Math.ceil(due/b)*b; if(r>=due) amts.add(r); if(amts.size>=5)break;} [...amts].sort((a,b)=>a-b).slice(0,5).forEach(a=>$qa.append(`<button class="fpos-quick-amt" data-amt="${a}">${format_currency(a,frappe.defaults.get_default("currency"))}</button>`)); }
	}
	render_payment_lines() {
		const $l = this.$dlg.find(".fpos-pay-lines"); $l.empty();
		const fmt = v => format_currency(v, frappe.defaults.get_default("currency"));
		this.payment_lines.forEach((line,idx) => $l.append(`<div class="fpos-pay-line ${line.mode_of_payment===this.numpad_target?"fpos-pay-line-active":""}" data-idx="${idx}"><div class="fpos-pay-line-method"><span class="fpos-method-icon">${line.icon||"💳"}</span><span>${__(line.mode_of_payment)}</span></div><div class="fpos-pay-line-amount-wrap"><span class="fpos-pay-line-amount">${fmt(line.amount)}</span>${this.payment_lines.length>1?`<button class="fpos-pay-line-remove" data-idx="${idx}">✕</button>`:""}</div></div>`));
		const remaining = this.get_remaining();
		if (this.payment_lines.length < this.payment_methods.length && remaining > 0) $l.append(`<button class="fpos-add-split-btn">+ ${__("Split with another method")}</button>`);
	}
	update_remaining() {
		const paid = this.payment_lines.reduce((s,l)=>s+(l.amount||0),0);
		const due = this.order.grand_total; const remaining = due - paid; const change = paid - due;
		const fmt = v => format_currency(Math.abs(v), frappe.defaults.get_default("currency"));
		if (remaining > 0.001) { this.$dlg.find(".fpos-remaining-val").text(`− ${fmt(remaining)}`).removeClass("fpos-positive"); this.$dlg.find(".fpos-change-row").hide(); this.$dlg.find(".fpos-pay-confirm-btn").prop("disabled",true); }
		else { this.$dlg.find(".fpos-remaining-val").text(__("Paid ✓")).addClass("fpos-positive"); if(change>0.001){this.$dlg.find(".fpos-change-row").show().find(".fpos-change-val").text(fmt(change));}else{this.$dlg.find(".fpos-change-row").hide();} this.$dlg.find(".fpos-pay-confirm-btn").prop("disabled",false); }
		const al = this.payment_lines.find(l=>l.mode_of_payment===this.numpad_target); if(al) this.$dlg.find(".fpos-numpad-val").text(al.amount||0);
	}
	get_remaining() { return Math.max(0, this.order.grand_total - this.payment_lines.reduce((s,l)=>s+(l.amount||0),0)); }
	numpad_input(key) {
		const $d = this.$dlg.find(".fpos-numpad-val"); let cur = $d.text();
		if(key==="⌫"){cur=cur.length>1?cur.slice(0,-1):"0";}else if(key==="."){if(cur.includes("."))return;cur+="."}else{cur=cur==="0"?key:cur+key;const p=cur.split(".");if(p[1]&&p[1].length>2)return;}
		$d.text(cur);
		const line=this.payment_lines.find(l=>l.mode_of_payment===this.numpad_target); if(line){line.amount=parseFloat(cur)||0;this.render_payment_lines();this.update_remaining();}
	}
	bind_dialog_events() {
		const me=this;
		this.$dlg.on("click",".fpos-pay-method-pill",function(){const method=$(this).data("method");me.active_method=method;me.$dlg.find(".fpos-pay-method-pill").removeClass("active");$(this).addClass("active");const ex=me.payment_lines.find(l=>l.mode_of_payment===method);if(ex){me.numpad_target=method;}else{const m=me.payment_methods.find(pm=>pm.mode_of_payment===method);if(me.payment_lines.length===1){me.payment_lines[0]={mode_of_payment:method,icon:m?.icon||"💳",amount:me.order.grand_total};me.numpad_target=method;}}me.render_payment_lines();me.update_remaining();me.render_payment_methods();const ln=me.payment_lines.find(l=>l.mode_of_payment===method);if(ln)me.$dlg.find(".fpos-numpad-val").text(ln.amount||0);});
		this.$dlg.on("click",".fpos-pay-line",function(){const idx=parseInt($(this).data("idx"));me.numpad_target=me.payment_lines[idx]?.mode_of_payment;me.$dlg.find(".fpos-numpad-val").text(me.payment_lines[idx]?.amount||0);me.render_payment_lines();});
		this.$dlg.on("click",".fpos-pay-line-remove",function(e){e.stopPropagation();me.payment_lines.splice(parseInt($(this).data("idx")),1);if(me.payment_lines.length===1)me.payment_lines[0].amount=me.order.grand_total;me.numpad_target=me.payment_lines[0]?.mode_of_payment;me.render_payment_lines();me.update_remaining();});
		this.$dlg.on("click",".fpos-add-split-btn",()=>{const used=me.payment_lines.map(l=>l.mode_of_payment);const avail=me.payment_methods.filter(m=>!used.includes(m.mode_of_payment));if(!avail.length)return;const remaining=me.get_remaining();const next=avail[0];me.payment_lines.push({mode_of_payment:next.mode_of_payment,icon:next.icon||"💳",amount:remaining});me.numpad_target=next.mode_of_payment;me.$dlg.find(".fpos-numpad-val").text(remaining);me.render_payment_lines();me.update_remaining();});
		this.$dlg.find(".fpos-numpad").on("click",".fpos-num-key",function(){me.numpad_input($(this).data("key"));});
		this.$dlg.on("click",".fpos-quick-amt",function(){const amt=parseFloat($(this).data("amt"));const line=me.payment_lines.find(l=>l.mode_of_payment===me.numpad_target);if(line){line.amount=amt;me.$dlg.find(".fpos-numpad-val").text(amt);me.render_payment_lines();me.update_remaining();}});
		this.$dlg.find(".fpos-pay-cancel-btn").on("click",()=>this.dialog.hide());
		this.$dlg.find(".fpos-pay-confirm-btn").on("click",()=>this.confirm_payment());
	}
	async confirm_payment() {
		const btn = this.$dlg.find(".fpos-pay-confirm-btn"); btn.prop("disabled",true).text(__("Processing..."));
		try {
			const res = await frappe.call({ method:"foodpos.foodpos.api.food_pos.create_pos_invoice", args:{ order:JSON.stringify(this.order), payments:JSON.stringify(this.payment_lines) } });
			if (res.message && res.message.invoice) {
				const inv_type = res.message.invoice_type || "Invoice";
				frappe.show_alert({message:__("Payment successful! {0}: {1}",[inv_type, res.message.invoice]),indicator:"green"});
				this.dialog.hide();
				this.events.on_payment_success && this.events.on_payment_success(res.message);
			} else { throw new Error(res.message?.error || __("Payment failed")); }
		} catch(err) { frappe.show_alert({message:err.message||__("Payment failed"),indicator:"red"}); btn.prop("disabled",false).html(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>${__("Confirm Payment")}`); }
	}
};

// ─────────────────────────────────────────────────────────────────────────────
// Inline: Kitchen (lightweight, full version in food_pos_kitchen.js)
// ─────────────────────────────────────────────────────────────────────────────
foodpos.FoodPOS.Kitchen = class {
	constructor({ wrapper, events, pos_profile }) {
		this.wrapper = wrapper; this.events = events; this.pos_profile = pos_profile;
		this.kots = []; this.active_filter = "all"; this.poll_interval = null;
		this.init();
	}
	init() { this.prepare_dom(); this.bind_events(); this.load_kots(); this.start_polling(); }
	prepare_dom() {
		this.wrapper.append(`<section class="fpos-kitchen">
			<div class="fpos-kitchen-header">
				<div class="fpos-kitchen-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg><span>${__("Kitchen Display")}</span><span class="fpos-kitchen-live-badge">${__("LIVE")}</span></div>
				<div class="fpos-kitchen-filters">
					<button class="fpos-kf-btn active" data-status="all">${__("All")}</button>
					<button class="fpos-kf-btn" data-status="Pending"><span class="fpos-status-dot pending"></span>${__("Pending")}</button>
					<button class="fpos-kf-btn" data-status="In Progress"><span class="fpos-status-dot in-progress"></span>${__("In Progress")}</button>
					<button class="fpos-kf-btn" data-status="Ready"><span class="fpos-status-dot ready"></span>${__("Ready")}</button>
				</div>
				<div class="fpos-kitchen-toolbar"><span class="fpos-kitchen-clock"></span><button class="fpos-kitchen-refresh-btn" title="${__("Refresh")}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button></div>
			</div>
			<div class="fpos-kitchen-stats">
				<div class="fpos-stat-card"><span class="fpos-stat-num fpos-stat-pending">0</span><span class="fpos-stat-label">${__("Pending")}</span></div>
				<div class="fpos-stat-card"><span class="fpos-stat-num fpos-stat-inprogress">0</span><span class="fpos-stat-label">${__("In Progress")}</span></div>
				<div class="fpos-stat-card"><span class="fpos-stat-num fpos-stat-ready">0</span><span class="fpos-stat-label">${__("Ready")}</span></div>
				<div class="fpos-stat-card"><span class="fpos-stat-num fpos-stat-avg-time">—</span><span class="fpos-stat-label">${__("Avg Time")}</span></div>
			</div>
			<div class="fpos-kitchen-board">
				<div class="fpos-kitchen-loading" style="display:none;"><div class="fpos-spinner"></div><span>${__("Loading...")}</span></div>
				<div class="fpos-kitchen-empty" style="display:none;"><p>${__("No active kitchen orders")}</p></div>
				<div class="fpos-kot-cards"></div>
			</div>
		</section>`);
		this.$component = this.wrapper.find(".fpos-kitchen");
		this.$board = this.$component.find(".fpos-kot-cards");
		this.$loading = this.$component.find(".fpos-kitchen-loading");
		this.$empty = this.$component.find(".fpos-kitchen-empty");
		this.$clock = this.$component.find(".fpos-kitchen-clock");
		setInterval(() => this.$clock.text(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})), 1000);
	}
	async load_kots(silent=false) {
		if (!silent) { this.$loading.show(); this.$board.empty(); this.$empty.hide(); }
		try { const res = await frappe.call({ method:"foodpos.foodpos.api.food_pos.get_kitchen_orders", args:{pos_profile:this.pos_profile} }); this.kots = res.message||[]; this.render_board(); this.render_stats(); }
		catch(_) {} finally { this.$loading.hide(); }
	}
	start_polling() { this.poll_interval = setInterval(()=>this.load_kots(true), 15000); }
	render_board() {
		this.$board.empty();
		const filtered = this.active_filter==="all" ? this.kots : this.kots.filter(k=>k.status===this.active_filter);
		if (!filtered.length) { this.$empty.show(); return; }
		this.$empty.hide(); filtered.forEach(kot=>this.render_kot(kot));
	}
	render_kot(kot) {
		const age = Math.floor((Date.now()-new Date(kot.creation).getTime())/60000);
		const urgency = age>=20?"urgent":age>=10?"warning":"";
		const sc = {"Pending":"fpos-kot-pending","In Progress":"fpos-kot-inprogress","Ready":"fpos-kot-ready","Served":"fpos-kot-served"}[kot.status]||"";
		const actions = {"Pending":{a:"start",l:"Start Cooking",i:"🔥"},"In Progress":{a:"ready",l:"Mark Ready",i:"✅"},"Ready":{a:"served",l:"Mark Served",i:"🍽️"}};
		const na = actions[kot.status];
		const card = $(`<div class="fpos-kot-card ${sc} ${urgency}" data-kot="${kot.name}">
			<div class="fpos-kot-card-header">
				<div class="fpos-kot-meta"><span class="fpos-kot-number">#${kot.name}</span>${kot.table?`<span class="fpos-kot-table">🪑 ${__("Table")} ${kot.table}</span>`:""}</div>
				<div class="fpos-kot-timing"><span class="fpos-kot-age ${urgency}">${age}${__("m")}</span><span class="fpos-kot-status-badge ${sc}">${__(kot.status)}</span></div>
			</div>
			<div class="fpos-kot-items">${(kot.items||[]).map(i=>`<div class="fpos-kot-item ${i.is_done?"fpos-kot-item-done":""}" data-kot="${kot.name}" data-item="${i.name}"><div class="fpos-kot-item-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div><span class="fpos-kot-item-qty">${i.qty}×</span><span class="fpos-kot-item-name">${i.item_name}</span>${i.item_note?`<span class="fpos-kot-item-note">📝 ${i.item_note}</span>`:""}</div>`).join("")}</div>
			${kot.order_note?`<div class="fpos-kot-order-note">📋 ${kot.order_note}</div>`:""}
			<div class="fpos-kot-card-footer">
				${na?`<button class="fpos-btn fpos-btn-primary fpos-kot-action-btn" data-kot="${kot.name}" data-action="${na.a}">${na.i} ${__(na.l)}</button>`:""}
				<button class="fpos-btn fpos-btn-secondary fpos-kot-print-btn" data-kot="${kot.name}">🖨️ ${__("Print")}</button>
			</div>
		</div>`);
		card.find(".fpos-kot-item").on("click", e => { const $el=$(e.currentTarget); $el.toggleClass("fpos-kot-item-done"); frappe.call({method:"foodpos.foodpos.api.food_pos.toggle_kot_item_done",args:{kot_name:kot.name,item_name:$el.data("item"),is_done:$el.hasClass("fpos-kot-item-done")?1:0}}); });
		this.$board.append(card);
	}
	render_stats() {
		const c=s=>this.kots.filter(k=>k.status===s).length;
		this.$component.find(".fpos-stat-pending").text(c("Pending"));
		this.$component.find(".fpos-stat-inprogress").text(c("In Progress"));
		this.$component.find(".fpos-stat-ready").text(c("Ready"));
	}
	async update_status(kot_name, action) {
		const map={start:"In Progress",ready:"Ready",served:"Served"};
		try { await frappe.call({method:"foodpos.foodpos.api.food_pos.update_kot_status",args:{kot_name,status:map[action]}}); frappe.show_alert({message:__("Updated"),indicator:"green"}); this.load_kots(true); }
		catch(_) { frappe.show_alert({message:__("Failed"),indicator:"red"}); }
	}
	async send_kot(order) {
		try { const res=await frappe.call({method:"foodpos.foodpos.api.food_pos.create_kot",args:{order:JSON.stringify(order)}}); if(res.message?.kot_name){frappe.show_alert({message:__("KOT #{0} sent to kitchen",[res.message.kot_name]),indicator:"green"});this.events.on_kot_sent&&this.events.on_kot_sent(res.message.kot_name);this.load_kots(true);}else{throw new Error(res.message?.error);} }
		catch(err){frappe.show_alert({message:err.message||__("KOT failed"),indicator:"red"});}
	}
	bind_events() {
		this.wrapper.on("click",".fpos-kf-btn",e=>{this.wrapper.find(".fpos-kf-btn").removeClass("active");$(e.currentTarget).addClass("active");this.active_filter=$(e.currentTarget).data("status");this.render_board();});
		this.wrapper.on("click",".fpos-kot-action-btn",e=>{e.stopPropagation();this.update_status($(e.currentTarget).data("kot"),$(e.currentTarget).data("action"));});
		this.wrapper.on("click",".fpos-kitchen-refresh-btn",()=>this.load_kots());
	}
	show(){this.$component.show();this.load_kots(true);}
	hide(){this.$component.hide();}
	destroy(){if(this.poll_interval)clearInterval(this.poll_interval);}
};

// ─────────────────────────────────────────────────────────────────────────────
// Inline: TableManager
// ─────────────────────────────────────────────────────────────────────────────
foodpos.FoodPOS.TableManager = class {
	constructor({ wrapper, events, pos_profile }) {
		this.wrapper=wrapper; this.events=events; this.pos_profile=pos_profile;
		this.tables=[]; this.sections=[]; this.active_section="All"; this.selected_table=null;
		this.init();
	}
	init(){this.prepare_dom();this.load_tables();this.bind_events();}
	prepare_dom(){
		this.wrapper.append(`<section class="fpos-tables">
			<div class="fpos-tables-header">
				<div class="fpos-tables-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="4" rx="1"/><line x1="7" y1="12" x2="7" y2="20"/><line x1="17" y1="12" x2="17" y2="20"/></svg><span>${__("Table Management")}</span></div>
				<div class="fpos-tables-legend"><span class="fpos-legend-item"><span class="fpos-legend-dot available"></span>${__("Available")}</span><span class="fpos-legend-item"><span class="fpos-legend-dot occupied"></span>${__("Occupied")}</span><span class="fpos-legend-item"><span class="fpos-legend-dot reserved"></span>${__("Reserved")}</span><span class="fpos-legend-item"><span class="fpos-legend-dot cleaning"></span>${__("Cleaning")}</span></div>
				<button class="fpos-tables-refresh-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg></button>
			</div>
			<div class="fpos-section-tabs"></div>
			<div class="fpos-tables-summary">
				<div class="fpos-tsummary-card available"><span class="fpos-tsummary-num">0</span><span>${__("Available")}</span></div>
				<div class="fpos-tsummary-card occupied"><span class="fpos-tsummary-num">0</span><span>${__("Occupied")}</span></div>
				<div class="fpos-tsummary-card reserved"><span class="fpos-tsummary-num">0</span><span>${__("Reserved")}</span></div>
				<div class="fpos-tsummary-card cleaning"><span class="fpos-tsummary-num">0</span><span>${__("Cleaning")}</span></div>
			</div>
			<div class="fpos-tables-grid-wrapper"><div class="fpos-tables-grid"></div><div class="fpos-tables-loading" style="display:none;"><div class="fpos-spinner"></div></div><div class="fpos-tables-empty" style="display:none;"><p>${__("No tables configured")}</p></div></div>
		</section>`);
		this.$component=this.wrapper.find(".fpos-tables");
		this.$section_tabs=this.$component.find(".fpos-section-tabs");
		this.$grid=this.$component.find(".fpos-tables-grid");
		this.$loading=this.$component.find(".fpos-tables-loading");
		this.$empty=this.$component.find(".fpos-tables-empty");
	}
	async load_tables(){
		this.$loading.show();this.$grid.empty();this.$empty.hide();
		try{const res=await frappe.call({method:"foodpos.foodpos.api.food_pos.get_tables",args:{pos_profile:this.pos_profile}});this.tables=res.message||[];}
		catch(_){this.tables=this.demo_tables();}
		this.sections=["All",...new Set(this.tables.map(t=>t.section||__("Main Floor")))];
		this.render_section_tabs();this.render_grid();this.render_summary();this.$loading.hide();
	}
	demo_tables(){return Array.from({length:8},(_,i)=>({name:`T-0${i+1}`,table_no:`${i+1}`,capacity:[2,4,4,6,2,4,8,4][i],status:["Available","Occupied","Available","Reserved","Available","Occupied","Available","Cleaning"][i],section:i<4?"Main Floor":"Outdoor"}));}
	render_section_tabs(){
		this.$section_tabs.empty();
		this.sections.forEach(sec=>{const c=sec==="All"?this.tables.length:this.tables.filter(t=>(t.section||__("Main Floor"))===sec).length;this.$section_tabs.append(`<button class="fpos-section-tab ${sec===this.active_section?"active":""}" data-section="${sec}">${__(sec)}<span class="fpos-section-count">${c}</span></button>`);});
	}
	render_grid(){
		this.$grid.empty();
		const visible=this.active_section==="All"?this.tables:this.tables.filter(t=>(t.section||__("Main Floor"))===this.active_section);
		if(!visible.length){this.$empty.show();return;}this.$empty.hide();visible.forEach(t=>this.render_card(t));
	}
	render_card(table){
		const st=table.status||"Available",sc=st.toLowerCase().replace(" ","-"),sel=this.selected_table===table.name;
		const seats=Array.from({length:table.capacity||4},(_,i)=>`<span class="fpos-seat ${st==="Occupied"&&i<(table.capacity||4)?"filled":""}" >👤</span>`).join("");
		const card=$(`<div class="fpos-table-card ${sc} ${sel?"selected":""}" data-table="${table.name}">
			<div class="fpos-table-status-badge ${sc}">${__(st)}</div>
			<div class="fpos-table-number"><span class="fpos-table-icon">🪑</span><span class="fpos-table-num-text">${__("Table")} ${table.table_no||table.name}</span></div>
			<div class="fpos-table-seats">${seats}</div>
			<div class="fpos-table-capacity">${table.capacity||4} ${__("seats")}</div>
			${st==="Occupied"&&table.order_id?`<div class="fpos-table-occupied-info"><div class="fpos-table-order">#${table.order_id}</div>${table.waiter?`<div class="fpos-table-waiter">👤 ${table.waiter}</div>`:""}</div>`:""}
			<div class="fpos-table-actions">
				${st==="Available"?`<button class="fpos-tbl-btn fpos-tbl-assign" data-table="${table.name}" data-table-no="${table.table_no||table.name}">${__("Assign")}</button>`:""}
				${st==="Occupied"?`<button class="fpos-tbl-btn fpos-tbl-clear" data-table="${table.name}">${__("Clear")}</button>`:""}
				${st==="Reserved"?`<button class="fpos-tbl-btn fpos-tbl-checkin" data-table="${table.name}" data-table-no="${table.table_no||table.name}">${__("Check In")}</button>`:""}
				${st==="Cleaning"?`<button class="fpos-tbl-btn fpos-tbl-ready" data-table="${table.name}">${__("Mark Ready")}</button>`:""}
			</div>
		</div>`);
		card.on("click",()=>this.show_detail(table.name));
		this.$grid.append(card);
	}
	render_summary(){const c=s=>this.tables.filter(t=>t.status===s).length;this.$component.find(".fpos-tsummary-card.available .fpos-tsummary-num").text(c("Available"));this.$component.find(".fpos-tsummary-card.occupied .fpos-tsummary-num").text(c("Occupied"));this.$component.find(".fpos-tsummary-card.reserved .fpos-tsummary-num").text(c("Reserved"));this.$component.find(".fpos-tsummary-card.cleaning .fpos-tsummary-num").text(c("Cleaning"));}
	show_detail(name){const t=this.tables.find(x=>x.name===name);if(!t)return;const d=new frappe.ui.Dialog({title:`${__("Table")} ${t.table_no||name}`,fields:[{fieldname:"status",fieldtype:"Select",label:__("Status"),options:["Available","Occupied","Reserved","Cleaning"],default:t.status,reqd:1},{fieldname:"guests",fieldtype:"Int",label:__("Guests"),default:t.guests||0},{fieldname:"waiter",fieldtype:"Data",label:__("Waiter"),default:t.waiter||""},{fieldname:"notes",fieldtype:"Small Text",label:__("Notes"),default:t.notes||""}],primary_action_label:__("Save"),primary_action:v=>{this.update_status(name,v);d.hide();}});d.show();}
	async update_status(name,vals){try{await frappe.call({method:"foodpos.foodpos.api.food_pos.update_table_status",args:{table_name:name,...vals}});const idx=this.tables.findIndex(t=>t.name===name);if(idx>=0)Object.assign(this.tables[idx],vals);this.render_grid();this.render_summary();frappe.show_alert({message:__("Table updated"),indicator:"green"});}catch(_){frappe.show_alert({message:__("Failed"),indicator:"red"});}}
	assign_table(name,no){this.selected_table=name;const idx=this.tables.findIndex(t=>t.name===name);if(idx>=0){this.tables[idx].status="Occupied";this.tables[idx].occupied_since=new Date().toISOString();}this.render_grid();this.render_summary();this.events.on_table_selected&&this.events.on_table_selected(name,no);}
	open_selector(cb){
		const avail=this.tables.filter(t=>t.status==="Available");
		const d=new frappe.ui.Dialog({title:__("Select Table"),size:"large"});
		$(d.wrapper).find(".modal-footer").hide();
		const body=$(d.wrapper).find(".modal-body").css({padding:0});
		if(!avail.length){body.html(`<div style="padding:40px;text-align:center"><p>${__("No tables available")}</p></div>`);d.show();return;}
		const grid=$(`<div class="fpos-table-picker-grid"></div>`);
		avail.forEach(t=>{const btn=$(`<button class="fpos-table-pick-btn" data-table="${t.name}" data-table-no="${t.table_no||t.name}"><span class="fpos-tp-icon">🪑</span><span class="fpos-tp-no">${__("Table")} ${t.table_no||t.name}</span><span class="fpos-tp-cap">${t.capacity||4} ${__("seats")}</span><span class="fpos-tp-section">${t.section||__("Main Floor")}</span></button>`);btn.on("click",()=>{this.assign_table(t.name,t.table_no||t.name);if(cb)cb(t.name,t.table_no||t.name);d.hide();});grid.append(btn);});
		body.append(grid);d.show();
	}
	free_table(name){const idx=this.tables.findIndex(t=>t.name===name);if(idx>=0){this.tables[idx].status="Cleaning";this.tables[idx].occupied_since=null;this.tables[idx].order_id=null;}if(this.selected_table===name)this.selected_table=null;this.render_grid();this.render_summary();}
	bind_events(){
		this.$component.on("click",".fpos-section-tab",e=>{this.active_section=$(e.currentTarget).data("section");this.$section_tabs.find(".fpos-section-tab").removeClass("active");$(e.currentTarget).addClass("active");this.render_grid();});
		this.$component.on("click",".fpos-tbl-assign,.fpos-tbl-checkin",e=>{e.stopPropagation();this.assign_table($(e.currentTarget).data("table"),$(e.currentTarget).data("table-no"));});
		this.$component.on("click",".fpos-tbl-clear",e=>{e.stopPropagation();const n=$(e.currentTarget).data("table");frappe.confirm(__("Clear this table?"),()=>this.update_status(n,{status:"Cleaning",order_id:null,occupied_since:null}));});
		this.$component.on("click",".fpos-tbl-ready",e=>{e.stopPropagation();this.update_status($(e.currentTarget).data("table"),{status:"Available"});});
		this.$component.on("click",".fpos-tables-refresh-btn",()=>this.load_tables());
	}
	refresh(){this.load_tables();}
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Controller — wires everything together
// ─────────────────────────────────────────────────────────────────────────────
foodpos.FoodPOS.Controller = class {
	constructor(wrapper) {
		this.wrapper = $(wrapper).find(".layout-main-section");
		this.page    = wrapper.page;
		this.pos_profile  = null;
		this.opening_entry = null;
		this.settings = {};
		this.check_opening_entry();
	}

	// ── Opening entry check ─────────────────────────────────────────────────
	async check_opening_entry() {
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.check_opening_entry",
				args: { user: frappe.session.user },
			});

			if (res.message && res.message.length) {
				// Existing open session found
				this.opening_entry = res.message[0];
				this.pos_profile   = res.message[0].pos_profile;
				this.prepare_app();
			} else {
				// No open session — show the opening dialog
				this.show_opening_dialog();
			}
		} catch (_) {
			// POS Opening Entry doctype doesn't exist (Sales Invoice mode)
			// Skip straight to profile selection
			this.show_opening_dialog();
		}
	}

	show_opening_dialog() {
		this.wrapper.html(`
			<div class="fpos-opening-wrapper">
				<div class="fpos-opening-card">
					<div class="fpos-opening-logo">🍽️</div>
					<h2>${__("Welcome to Food POS")}</h2>
					<p>${__("Select your POS Profile to begin")}</p>
					<div class="fpos-opening-fields">
						<div id="fpos-opening-company"></div>
						<div id="fpos-opening-profile" style="margin-top:12px;"></div>
					</div>
					<button class="fpos-btn fpos-btn-primary" id="fpos-open-session-btn" style="width:100%;padding:13px;font-size:15px;">
						🚀 ${__("Open POS Session")}
					</button>
				</div>
			</div>`);

		// Company field
		const company_field = frappe.ui.form.make_control({
			df: { fieldtype:"Link", label:__("Company"), options:"Company", fieldname:"company", default: frappe.defaults.get_default("company"), reqd:1 },
			parent: this.wrapper.find("#fpos-opening-company")[0],
			render_input: true,
		});

		// POS Profile field
		const profile_field = frappe.ui.form.make_control({
			df: { fieldtype:"Link", label:__("POS Profile"), options:"POS Profile", fieldname:"pos_profile", reqd:1 },
			parent: this.wrapper.find("#fpos-opening-profile")[0],
			render_input: true,
		});

		this.wrapper.find("#fpos-open-session-btn").on("click", async () => {
			const company     = company_field.get_value();
			const pos_profile = profile_field.get_value();
			if (!company || !pos_profile) {
				frappe.show_alert({ message: __("Please select Company and POS Profile"), indicator: "orange" });
				return;
			}

			const btn = this.wrapper.find("#fpos-open-session-btn");
			btn.prop("disabled", true).text(__("Opening session..."));

			try {
				// Step 1: fetch payment modes from the selected POS Profile
				// so we can build a valid balance_details array (ERPNext requires
				// at least one row — one per mode_of_payment with opening_amount 0)
				let balance_details = [];
				try {
					const profile_doc = await frappe.db.get_doc("POS Profile", pos_profile);
					if (profile_doc && profile_doc.payments && profile_doc.payments.length) {
						balance_details = profile_doc.payments.map(p => ({
							mode_of_payment: p.mode_of_payment,
							opening_amount:  0,
						}));
					}
				} catch (_) {}

				// Fallback: if profile has no payments configured, use Cash
				if (!balance_details.length) {
					balance_details = [{ mode_of_payment: "Cash", opening_amount: 0 }];
				}

				// Step 2: open the session (create_opening_voucher safely returns
				// a dummy object if POS Opening Entry doctype doesn't exist)
				await frappe.call({
					method: "foodpos.foodpos.api.food_pos.create_opening_voucher",
					args: {
						pos_profile,
						company,
						balance_details: JSON.stringify(balance_details),
					},
				});

				this.pos_profile = pos_profile;
				frappe.show_alert({ message: __("POS Session opened"), indicator: "green" });
				this.prepare_app();

			} catch (e) {
				frappe.show_alert({ message: e.message || __("Failed to open session"), indicator: "red" });
				btn.prop("disabled", false).html(`🚀 ${__("Open POS Session")}`);
			}
		});
	}

	// ── Build the full POS UI ───────────────────────────────────────────────
	prepare_app() {
		this.wrapper.html(`
			<div class="fpos-wrapper">
				<!-- Top navigation bar -->
				<div class="fpos-topbar">
					<div class="fpos-topbar-left">
						<span class="fpos-app-logo">🍽️</span>
						<span class="fpos-app-title">Food POS</span>
						${this.pos_profile ? `<span class="fpos-pos-profile-tag">${this.pos_profile}</span>` : ""}
					</div>
					<div class="fpos-topbar-center">
						<button class="fpos-nav-tab active" data-view="pos">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
							${__("New Order")}
						</button>
						<button class="fpos-nav-tab" data-view="tables">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="8" width="18" height="4" rx="1"/><line x1="7" y1="12" x2="7" y2="20"/><line x1="17" y1="12" x2="17" y2="20"/></svg>
							${__("Tables")}
						</button>
						<button class="fpos-nav-tab" data-view="kitchen">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/></svg>
							${__("Kitchen")}
						</button>
					</div>
					<div class="fpos-topbar-right">
						<div class="fpos-topbar-stat">
							<small>${__("Today's Sales")}</small>
							<strong class="fpos-today-sales">—</strong>
						</div>
						<button class="fpos-btn fpos-btn-secondary fpos-close-btn">✕ ${__("Close")}</button>
					</div>
				</div>

				<!-- Main body with three views -->
				<div class="fpos-body">
					<!-- POS View (item selector + cart) -->
					<div class="fpos-pos-view active" data-view="pos">
						<div class="fpos-left-panel" id="fpos-item-selector-mount"></div>
						<div class="fpos-right-panel" id="fpos-cart-mount"></div>
					</div>

					<!-- Tables View -->
					<div class="fpos-view" data-view="tables" id="fpos-tables-mount" style="width:100%;"></div>

					<!-- Kitchen View -->
					<div class="fpos-view" data-view="kitchen" id="fpos-kitchen-mount" style="width:100%;"></div>
				</div>
			</div>`);

		this.init_components();
		this.bind_nav();
		this.load_today_stats();
	}

	// ── Initialise all sub-components ───────────────────────────────────────
	init_components() {
		const me = this;

		// Events bus
		const events = {
			add_item_to_cart: (item)      => me.cart.add_item(item),
			on_cart_update:   (order)     => {},
			open_payment:     (order)     => me.payment.open({ ...order, pos_profile: me.pos_profile }),
			send_kot:         (order)     => me.kitchen.send_kot({ ...order, pos_profile: me.pos_profile }),
			on_kot_sent:      (kot_name)  => {},
			open_table_selector: ()       => me.table_manager.open_selector((name, no) => { me.cart.set_table(name, no); me.switch_view("pos"); }),
			on_table_selected:(name, no)  => me.cart.set_table(name, no),
			on_payment_success:(data)     => { me.cart.clear_cart(); if (me.cart.table) { me.table_manager.free_table(me.cart.table); me.cart.set_table(null, null); } me.load_today_stats(); },
		};

		// Item Selector
		this.item_selector = new foodpos.FoodPOS.ItemSelector({
			wrapper:     this.wrapper.find("#fpos-item-selector-mount"),
			events:      events,
			pos_profile: this.pos_profile,
			settings:    this.settings,
		});

		// Cart
		this.cart = new foodpos.FoodPOS.Cart({
			wrapper:     this.wrapper.find("#fpos-cart-mount"),
			events:      events,
			pos_profile: this.pos_profile,
			settings:    this.settings,
		});

		// Payment
		this.payment = new foodpos.FoodPOS.Payment({
			wrapper:     this.wrapper,
			events:      events,
			pos_profile: this.pos_profile,
			settings:    this.settings,
		});

		// Kitchen
		this.kitchen = new foodpos.FoodPOS.Kitchen({
			wrapper:     this.wrapper.find("#fpos-kitchen-mount"),
			events:      events,
			pos_profile: this.pos_profile,
		});

		// Tables
		this.table_manager = new foodpos.FoodPOS.TableManager({
			wrapper:     this.wrapper.find("#fpos-tables-mount"),
			events:      events,
			pos_profile: this.pos_profile,
		});
	}

	// ── Navigation ──────────────────────────────────────────────────────────
	bind_nav() {
		const me = this;

		this.wrapper.on("click", ".fpos-nav-tab", function () {
			const view = $(this).data("view");
			me.switch_view(view);
		});

		this.wrapper.on("click", ".fpos-close-btn", () => {
			frappe.confirm(
				__("Close POS session?"),
				() => frappe.set_route(""),
			);
		});
	}

	switch_view(view) {
		this.wrapper.find(".fpos-nav-tab").removeClass("active");
		this.wrapper.find(`.fpos-nav-tab[data-view="${view}"]`).addClass("active");

		this.wrapper.find(".fpos-pos-view, .fpos-view").removeClass("active").hide();
		const $target = this.wrapper.find(`[data-view="${view}"]`);
		$target.addClass("active").show();

		if (view === "kitchen") {
			this.kitchen && this.kitchen.show();
		} else if (view === "tables") {
			this.table_manager && this.table_manager.refresh();
		}
	}

	// ── Refresh (called when page is revisited) ─────────────────────────────
	refresh() {
		if (this.item_selector) this.item_selector.refresh();
		if (this.cart)          this.cart.refresh();
	}

	// ── Today's stats in topbar ─────────────────────────────────────────────
	async load_today_stats() {
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.get_today_summary",
				args: { pos_profile: this.pos_profile },
			});
			if (res.message) {
				const total = format_currency(res.message.total_sales || 0, frappe.defaults.get_default("currency"));
				this.wrapper.find(".fpos-today-sales").text(total);
			}
		} catch (_) {}
	}
};

// ── Desk Home tile navigation ────────────────────────────────────────────────
$(document).on("click", '.desktop-icon[data-id="Food POS"], .desktop-icon[data-id="Restaurant POS"]', function (e) {
	if (e.ctrlKey || e.metaKey || e.shiftKey || (e.button && e.button !== 0)) return;
	e.preventDefault();
	window.location.href = "/desk/foodpos/food-pos";
});

$(document).on("mouseenter", '.desktop-icon[data-id="Food POS"], .desktop-icon[data-id="Restaurant POS"]', function () {
	$(this).removeAttr("target").attr("href", "/desk/foodpos/food-pos");
});

// ── Universal Static Title Guard (Guarantees zero 'undefined' flash) ────────
(function enforce_static_titles() {
	function get_resolved_report_title() {
		const hash = (window.location && window.location.hash) || "";
		const path = (window.location && window.location.pathname) || "";
		if (
			hash.includes("Served%20KOT%20Exception%20List") ||
			hash.includes("Served KOT Exception List") ||
			path.includes("Served%20KOT%20Exception%20List") ||
			path.includes("Served KOT Exception List")
		) {
			return "Served KOT Exception List";
		}
		const route = (window.frappe && frappe.get_route && frappe.get_route()) || [];
		if (route && (route[1] === "Served KOT Exception List" || route[0] === "Served KOT Exception List")) {
			return "Served KOT Exception List";
		}
		if (route && route[0] === "query-report" && route[1]) {
			return route[1];
		}
		return null;
	}

	// 1. Immediately hook Document.prototype.title setter to reject 'undefined'
	try {
		const docProto = Document.prototype;
		const desc = Object.getOwnPropertyDescriptor(docProto, "title");
		if (desc && desc.set && !docProto._fpos_title_guard) {
			const origSet = desc.set;
			const origGet = desc.get;
			Object.defineProperty(document, "title", {
				get() {
					return origGet.call(this);
				},
				set(val) {
					const strVal = String(val);
					if (!val || strVal === "undefined" || strVal === "Frappe") {
						const repTitle = get_resolved_report_title();
						if (repTitle) {
							val = repTitle;
						} else if (!val || strVal === "undefined") {
							return;
						}
					}
					return origSet.call(this, val);
				},
				configurable: true,
			});
			docProto._fpos_title_guard = true;
		}
	} catch (e) {}

	// 2. Hook frappe.utils.set_title
	function patch_frappe_utils() {
		if (window.frappe && frappe.utils && !frappe.utils._fpos_title_guard) {
			const orig = frappe.utils.set_title;
			frappe.utils.set_title = function(title) {
				const strTitle = String(title);
				if (!title || strTitle === "undefined") {
					const rep = get_resolved_report_title();
					if (rep) title = rep;
					else return;
				}
				return orig.call(this, title);
			};
			frappe.utils._fpos_title_guard = true;
		}
	}
	patch_frappe_utils();
	document.addEventListener("DOMContentLoaded", patch_frappe_utils);

	// 3. Hook frappe.router for Desk navigation & aliases
	let routerTimer = setInterval(() => {
		if (window.frappe && frappe.router && !frappe.router._fpos_title_guard) {
			if (!frappe.route_titles) frappe.route_titles = {};
			frappe.route_titles["query-report/Served KOT Exception List"] = "Served KOT Exception List";
			frappe.route_titles["app/query-report/Served KOT Exception List"] = "Served KOT Exception List";
			frappe.route_titles["Served KOT Exception List"] = "Served KOT Exception List";

			if (!frappe.re_route) frappe.re_route = {};
			frappe.re_route["food-pos-hold-order"] = "food-pos-held-order";
			frappe.re_route["Food POS Hold Order"] = "food-pos-held-order";

			frappe.router.on("change", () => {
				const rep = get_resolved_report_title();
				if (rep) {
					document.title = rep;
					if (frappe.utils && frappe.utils.set_title) {
						frappe.utils.set_title(rep);
					}
				}
			});

			if (frappe.set_route && !frappe._held_order_route_patched) {
				const _orig_set_route = frappe.set_route.bind(frappe);
				frappe.set_route = function(...args) {
					if (args.length && Array.isArray(args[0])) {
						if (args[0][1] === "Food POS Hold Order") {
							args[0][1] = "Food POS Held Order";
						}
					} else if (args.length === 1 && typeof args[0] === "string") {
						if (args[0] === "food-pos-hold-order" || args[0] === "/app/food-pos-hold-order") {
							args[0] = "food-pos-held-order";
						}
					}
					return _orig_set_route(...args);
				};
				frappe._held_order_route_patched = true;
			}

			frappe.router._fpos_title_guard = true;
			clearInterval(routerTimer);
		}
	}, 50);

	// Immediate title sync if report URL is loaded directly
	const initRep = get_resolved_report_title();
	if (initRep) {
		document.title = initRep;
	}
})();


