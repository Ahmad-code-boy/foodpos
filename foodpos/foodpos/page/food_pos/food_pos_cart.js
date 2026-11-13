foodpos.FoodPOS.Cart = class {
	constructor({ wrapper, events, pos_profile, settings }) {
		this.wrapper = wrapper;
		this.events = events;
		this.pos_profile = pos_profile;
		this.settings = settings || {};

		// Cart state
		this.order_items = [];   // [{ item_code, item_name, qty, rate, amount, item_note, uom, item_image }]
		this.customer = null;
		this.order_type = "Dine In"; // Dine In | Takeaway | Delivery
		this.table = null;
		this.discount_amount = 0;
		this.discount_percentage = 0;
		this.tax_rate = this.settings.tax_rate || 0;
		this.order_note = "";

		this.init();
	}

	// ─── Init ────────────────────────────────────────────────────────────────

	init() {
		this.prepare_dom();
		this.bind_events();
	}

	prepare_dom() {
		this.wrapper.append(`
			<section class="fpos-cart">
				<!-- Header -->
				<div class="fpos-cart-header">
					<div class="fpos-cart-title">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
							<line x1="3" y1="6" x2="21" y2="6"/>
							<path d="M16 10a4 4 0 01-8 0"/>
						</svg>
						<span>${__("Current Order")}</span>
					</div>
					<div class="fpos-order-type-tabs">
						<button class="fpos-ot-tab active" data-type="Dine In">🪑 ${__("Dine In")}</button>
						<button class="fpos-ot-tab" data-type="Takeaway">🥡 ${__("Takeaway")}</button>
						<button class="fpos-ot-tab" data-type="Delivery">🛵 ${__("Delivery")}</button>
					</div>
				</div>

				<!-- Customer + Table row -->
				<div class="fpos-cart-meta">
					<div class="fpos-meta-field fpos-customer-field">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
							<circle cx="12" cy="7" r="4"/>
						</svg>
						<span class="fpos-meta-value fpos-customer-label">${__("Add Customer")}</span>
					</div>
					<div class="fpos-meta-field fpos-table-field">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="3" y="8" width="18" height="4" rx="1"/>
							<line x1="7" y1="12" x2="7" y2="20"/>
							<line x1="17" y1="12" x2="17" y2="20"/>
						</svg>
						<span class="fpos-meta-value fpos-table-label">${__("Select Table")}</span>
					</div>
				</div>

				<!-- Items list -->
				<div class="fpos-cart-items-wrapper">
					<div class="fpos-cart-items"></div>
					<div class="fpos-cart-empty">
						<svg viewBox="0 0 80 80" fill="none">
							<circle cx="40" cy="40" r="38" stroke="#e2e8f0" stroke-width="2"/>
							<path d="M28 44c0 0 4-8 12-8s12 8 12 8" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>
							<circle cx="32" cy="34" r="2" fill="#94a3b8"/>
							<circle cx="48" cy="34" r="2" fill="#94a3b8"/>
						</svg>
						<p>${__("Your order is empty")}</p>
						<small>${__("Add items from the menu")}</small>
					</div>
				</div>

				<!-- Order note -->
				<div class="fpos-order-note-row">
					<button class="fpos-add-note-btn">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
							<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
						</svg>
						<span class="fpos-note-label">${__("Add order note")}</span>
					</button>
				</div>

				<!-- Totals -->
				<div class="fpos-cart-totals">
					<div class="fpos-total-row">
						<span>${__("Subtotal")}</span>
						<span class="fpos-subtotal-val">—</span>
					</div>
					<div class="fpos-total-row fpos-discount-row" style="display:none;">
						<span>${__("Discount")}</span>
						<span class="fpos-discount-val fpos-negative">—</span>
					</div>
					<div class="fpos-total-row fpos-tax-row" style="display:none;">
						<span>${__("Tax")} (<span class="fpos-tax-pct">${this.tax_rate}%</span>)</span>
						<span class="fpos-tax-val">—</span>
					</div>
					<div class="fpos-total-row fpos-grand-total-row">
						<span>${__("Total")}</span>
						<span class="fpos-grand-total-val">—</span>
					</div>
				</div>

				<!-- Action buttons -->
				<div class="fpos-cart-actions">
					<button class="fpos-btn fpos-btn-secondary fpos-discount-btn">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="19" y1="5" x2="5" y2="19"/>
							<circle cx="6.5" cy="6.5" r="2.5"/>
							<circle cx="17.5" cy="17.5" r="2.5"/>
						</svg>
						${__("Discount")}
					</button>
					<button class="fpos-btn fpos-btn-secondary fpos-split-btn" title="${__("Split Bill")}">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
						</svg>
						${__("Split")}
					</button>
					<button class="fpos-btn fpos-btn-secondary fpos-kot-btn">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
							<rect x="9" y="3" width="6" height="4" rx="1"/>
							<line x1="9" y1="12" x2="15" y2="12"/>
							<line x1="9" y1="16" x2="12" y2="16"/>
						</svg>
						${__("Send KOT")}
					</button>
					<button class="fpos-btn fpos-btn-danger fpos-clear-btn">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="3 6 5 6 21 6"/>
							<path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
							<path d="M10 11v6M14 11v6"/>
						</svg>
						${__("Clear")}
					</button>
					<button class="fpos-btn fpos-btn-primary fpos-pay-btn" disabled>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="1" y="4" width="22" height="16" rx="2"/>
							<line x1="1" y1="10" x2="23" y2="10"/>
						</svg>
						${__("Pay")}
					</button>
				</div>
			</section>
		`);

		this.$component       = this.wrapper.find(".fpos-cart");
		this.$items_list      = this.$component.find(".fpos-cart-items");
		this.$empty_state     = this.$component.find(".fpos-cart-empty");
		this.$subtotal        = this.$component.find(".fpos-subtotal-val");
		this.$discount_val    = this.$component.find(".fpos-discount-val");
		this.$tax_val         = this.$component.find(".fpos-tax-val");
		this.$grand_total     = this.$component.find(".fpos-grand-total-val");
		this.$pay_btn         = this.$component.find(".fpos-pay-btn");
		this.$customer_label  = this.$component.find(".fpos-customer-label");
		this.$table_label     = this.$component.find(".fpos-table-label");
		this.$note_label      = this.$component.find(".fpos-note-label");
	}

	// ─── Public API ──────────────────────────────────────────────────────────

	/**
	 * Add or increment an item in the cart.
	 *
	 * Modifier support (Feature 1):
	 *   item.modifiers       — array of { modifier_name, price_adjustment }
	 *   item.modifier_group  — group name string (for display only)
	 *   item.price_list_rate — already includes price delta from ItemSelector modal
	 *
	 * Items with modifiers always get their own line (no qty merge) because
	 * the same item with different modifiers is a distinct line.
	 *
	 * @param {Object} item  - item object from ItemSelector (possibly with modifiers)
	 */
	add_item(item) {
		const qty        = item.qty || 1;
		const has_mods   = item.modifiers && item.modifiers.length > 0;

		// Only merge if: same item_code, same item_note, AND no modifiers on either side
		const existing = !has_mods && this.order_items.find(
			(i) =>
				i.item_code === item.item_code &&
				i.item_note === (item.item_note || "") &&
				(!i.modifiers || i.modifiers.length === 0)
		);

		if (existing) {
			existing.qty    += qty;
			existing.amount  = existing.qty * existing.rate;
		} else {
			this.order_items.push({
				item_code:      item.item_code,
				item_name:      item.item_name,
				qty:            qty,
				// price_list_rate already has modifier delta applied by ItemSelector
				rate:           item.price_list_rate || 0,
				amount:         (item.price_list_rate || 0) * qty,
				item_note:      item.item_note || "",
				uom:            item.uom || item.stock_uom || "Nos",
				item_image:     item.item_image || "",
				item_group:     item.item_group || "",
				// Modifier fields — persisted on the cart line for KOT / invoice
				modifiers:      item.modifiers || [],
				modifier_group: item.modifier_group || "",
			});
		}

		this.render();
		this.events.on_cart_update && this.events.on_cart_update(this.get_order());
	}

	get_order() {
		const totals = this.calculate_totals();
		return {
			items:              this.order_items,
			customer:           this.customer,
			table:              this.table,
			order_type:         this.order_type,
			order_note:         this.order_note,
			discount_amount:    totals.discount,
			discount_percentage: this.discount_percentage,
			tax_amount:         totals.tax,
			grand_total:        totals.grand_total,
			subtotal:           totals.subtotal,
		};
	}

	set_customer(customer) {
		this.customer = customer;
		this.$customer_label.text(customer || __("Add Customer"));
	}

	set_table(table) {
		this.table = table;
		this.$table_label.text(table || __("Select Table"));
	}

	clear_cart() {
		this.order_items = [];
		this.discount_amount = 0;
		this.discount_percentage = 0;
		this.order_note = "";
		this.$note_label.text(__("Add order note"));
		this.render();
	}

	// ─── Calculations ────────────────────────────────────────────────────────

	calculate_totals() {
		const subtotal = this.order_items.reduce((acc, i) => acc + i.amount, 0);

		let discount = 0;
		if (this.discount_percentage > 0) {
			discount = (subtotal * this.discount_percentage) / 100;
		} else {
			discount = this.discount_amount;
		}

		const taxable = subtotal - discount;
		const tax     = (taxable * this.tax_rate) / 100;
		const grand_total = taxable + tax;

		return { subtotal, discount, tax, grand_total };
	}

	// ─── Rendering ───────────────────────────────────────────────────────────

	render() {
		this.$items_list.empty();

		if (this.order_items.length === 0) {
			this.$empty_state.show();
			this.$pay_btn.prop("disabled", true);
			this.render_totals({ subtotal: 0, discount: 0, tax: 0, grand_total: 0 });
			return;
		}

		this.$empty_state.hide();
		this.order_items.forEach((item, idx) => this.render_cart_row(item, idx));
		this.$pay_btn.prop("disabled", false);
		this.render_totals(this.calculate_totals());
	}

	render_cart_row(item, idx) {
		const amount = format_currency(item.amount, frappe.defaults.get_default("currency"));
		const rate   = format_currency(item.rate,   frappe.defaults.get_default("currency"));

		// ── Modifier pills (Feature 1) ────────────────────────────────────────
		// Each selected modifier becomes a small pill tag under the item name.
		// If the modifier has a price adjustment, it is shown in the pill.
		const currency = frappe.defaults.get_default("currency") || "";
		const mod_pills_html = (item.modifiers && item.modifiers.length)
			? `<div class="fpos-cart-row-modifiers">
				${item.modifiers.map((m) => {
					const price_suffix = m.price_adjustment !== 0
						? ` <span class="fpos-mod-pill-price">(${m.price_adjustment > 0 ? "+" : ""}${format_currency(m.price_adjustment, currency)})</span>`
						: "";
					return `<span class="fpos-mod-pill">${m.modifier_name}${price_suffix}</span>`;
				}).join("")}
			   </div>`
			: "";

		const row = $(`
			<div class="fpos-cart-row" data-idx="${idx}">
				<div class="fpos-cart-row-left">
					${item.item_image
						? `<img class="fpos-cart-thumb" src="${item.item_image}" alt="" />`
						: `<div class="fpos-cart-thumb fpos-thumb-placeholder">${this.get_emoji(item.item_group)}</div>`}
				</div>
				<div class="fpos-cart-row-body">
					<div class="fpos-cart-row-name">${item.item_name}</div>
					${mod_pills_html}
					${item.item_note
						? `<div class="fpos-cart-row-note">📝 ${item.item_note}</div>`
						: ""}
					<div class="fpos-cart-row-price">${rate} × ${item.qty}</div>
				</div>
				<div class="fpos-cart-row-right">
					<div class="fpos-qty-ctrl">
						<button class="fpos-qty-btn fpos-qty-dec" data-idx="${idx}">−</button>
						<span class="fpos-qty-val">${item.qty}</span>
						<button class="fpos-qty-btn fpos-qty-inc" data-idx="${idx}">+</button>
					</div>
					<div class="fpos-cart-row-amount">${amount}</div>
					<button class="fpos-row-remove" data-idx="${idx}" title="${__("Remove")}">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="18" y1="6" x2="6" y2="18"/>
							<line x1="6" y1="6" x2="18" y2="18"/>
						</svg>
					</button>
				</div>
			</div>
		`);

		this.$items_list.append(row);
	}

	render_totals({ subtotal, discount, tax, grand_total }) {
		const fmt = (v) => format_currency(v, frappe.defaults.get_default("currency"));

		this.$subtotal.text(fmt(subtotal));
		this.$grand_total.text(fmt(grand_total));

		if (discount > 0) {
			this.$component.find(".fpos-discount-row").show();
			this.$discount_val.text(`− ${fmt(discount)}`);
		} else {
			this.$component.find(".fpos-discount-row").hide();
		}

		if (this.tax_rate > 0) {
			this.$component.find(".fpos-tax-row").show();
			this.$tax_val.text(fmt(tax));
		} else {
			this.$component.find(".fpos-tax-row").hide();
		}
	}

	get_emoji(group) {
		const map = {
			Beverages: "🥤", Starters: "🥗", "Main Course": "🍛",
			Desserts: "🍰", Burgers: "🍔", Pizza: "🍕", Pasta: "🍝",
		};
		return map[group] || "🍴";
	}

	// ─── Events ──────────────────────────────────────────────────────────────

	bind_events() {
		const me = this;

		// Order type tabs
		this.$component.on("click", ".fpos-ot-tab", function () {
			me.$component.find(".fpos-ot-tab").removeClass("active");
			$(this).addClass("active");
			me.order_type = $(this).data("type");

			// Show / hide table selector for Dine In only
			me.$component.find(".fpos-table-field").toggle(me.order_type === "Dine In");
		});

		// Qty decrement
		this.$items_list.on("click", ".fpos-qty-dec", function () {
			const idx = parseInt($(this).data("idx"));
			if (me.order_items[idx].qty > 1) {
				me.order_items[idx].qty--;
				me.order_items[idx].amount = me.order_items[idx].qty * me.order_items[idx].rate;
			} else {
				me.order_items.splice(idx, 1);
			}
			me.render();
			me.events.on_cart_update && me.events.on_cart_update(me.get_order());
		});

		// Qty increment
		this.$items_list.on("click", ".fpos-qty-inc", function () {
			const idx = parseInt($(this).data("idx"));
			me.order_items[idx].qty++;
			me.order_items[idx].amount = me.order_items[idx].qty * me.order_items[idx].rate;
			me.render();
			me.events.on_cart_update && me.events.on_cart_update(me.get_order());
		});

		// Remove item
		this.$items_list.on("click", ".fpos-row-remove", function () {
			const idx = parseInt($(this).data("idx"));
			me.order_items.splice(idx, 1);
			me.render();
			me.events.on_cart_update && me.events.on_cart_update(me.get_order());
		});

		// Edit item note (double-click on note)
		this.$items_list.on("dblclick", ".fpos-cart-row-note", function () {
			const idx = parseInt($(this).closest(".fpos-cart-row").data("idx"));
			me.edit_item_note(idx);
		});

		// Customer picker
		this.$component.find(".fpos-customer-field").on("click", () => this.pick_customer());

		// Table picker
		this.$component.find(".fpos-table-field").on("click", () => {
			this.events.open_table_selector && this.events.open_table_selector();
		});

		// Order note
		this.$component.find(".fpos-add-note-btn").on("click", () => this.edit_order_note());

		// Discount
		this.$component.find(".fpos-discount-btn").on("click", () => this.open_discount_dialog());

		// Split Bill (Feature 2) — delegate to Controller → SplitBill class
		this.$component.find(".fpos-split-btn").on("click", () => {
			if (this.order_items.length === 0) {
				frappe.show_alert({ message: __("Add items before splitting the bill"), indicator: "orange" });
				return;
			}
			this.events.open_split_bill && this.events.open_split_bill(this.get_order());
		});

		// Clear cart
		this.$component.find(".fpos-clear-btn").on("click", () => {
			if (this.order_items.length === 0) return;
			frappe.confirm(
				__("Clear the current order?"),
				() => this.clear_cart()
			);
		});

		// Send KOT
		this.$component.find(".fpos-kot-btn").on("click", () => {
			if (this.order_items.length === 0) {
				frappe.show_alert({ message: __("Add items before sending KOT"), indicator: "orange" });
				return;
			}
			this.events.send_kot && this.events.send_kot(this.get_order());
		});

		// Pay
		this.$pay_btn.on("click", () => {
			if (this.order_items.length === 0) return;
			this.events.open_payment && this.events.open_payment(this.get_order());
		});
	}

	// ─── Dialogs ─────────────────────────────────────────────────────────────

	pick_customer() {
		const d = new frappe.ui.Dialog({
			title: __("Select Customer"),
			fields: [
				{
					fieldname: "customer",
					fieldtype: "Link",
					label: __("Customer"),
					options: "Customer",
					reqd: 1,
					get_query: () => ({ filters: { disabled: 0 } }),
				},
			],
			primary_action_label: __("Select"),
			primary_action: ({ customer }) => {
				this.set_customer(customer);
				d.hide();
			},
		});
		d.show();
	}

	edit_item_note(idx) {
		const item = this.order_items[idx];
		if (!item) return;

		const d = new frappe.ui.Dialog({
			title: __("Special Instructions — {0}", [item.item_name]),
			fields: [
				{
					fieldname: "item_note",
					fieldtype: "Small Text",
					label: __("Note"),
					default: item.item_note,
					placeholder: __("e.g. No onions, extra sauce..."),
				},
			],
			primary_action_label: __("Save"),
			primary_action: ({ item_note }) => {
				this.order_items[idx].item_note = item_note || "";
				this.render();
				d.hide();
			},
		});
		d.show();
	}

	edit_order_note() {
		const d = new frappe.ui.Dialog({
			title: __("Order Note"),
			fields: [
				{
					fieldname: "order_note",
					fieldtype: "Small Text",
					label: __("Note for Kitchen"),
					default: this.order_note,
					placeholder: __("e.g. Birthday order, allergy notes..."),
				},
			],
			primary_action_label: __("Save"),
			primary_action: ({ order_note }) => {
				this.order_note = order_note || "";
				this.$note_label.text(
					this.order_note ? `📝 ${this.order_note.substring(0, 30)}...` : __("Add order note")
				);
				d.hide();
			},
		});
		d.show();
	}

	open_discount_dialog() {
		const d = new frappe.ui.Dialog({
			title: __("Apply Discount"),
			fields: [
				{
					fieldname: "discount_type",
					fieldtype: "Select",
					label: __("Discount Type"),
					options: ["Percentage", "Flat Amount"],
					default: "Percentage",
				},
				{
					fieldname: "discount_value",
					fieldtype: "Float",
					label: __("Value"),
					reqd: 1,
				},
			],
			primary_action_label: __("Apply"),
			primary_action: ({ discount_type, discount_value }) => {
				if (discount_type === "Percentage") {
					if (discount_value < 0 || discount_value > 100) {
						frappe.show_alert({ message: __("Percentage must be between 0 and 100"), indicator: "red" });
						return;
					}
					this.discount_percentage = discount_value;
					this.discount_amount     = 0;
				} else {
					this.discount_amount     = discount_value;
					this.discount_percentage = 0;
				}
				this.render();
				d.hide();
				frappe.show_alert({ message: __("Discount applied"), indicator: "green" });
			},
		});
		d.show();
	}

	// ─── Refresh ─────────────────────────────────────────────────────────────

	refresh() {
		this.render();
	}
};
