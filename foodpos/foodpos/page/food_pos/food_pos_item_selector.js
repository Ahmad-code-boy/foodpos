foodpos.FoodPOS.ItemSelector = class {
	constructor({ wrapper, events, pos_profile, settings }) {
		this.wrapper = wrapper;
		this.events = events;
		this.pos_profile = pos_profile;
		this.settings = settings || {};
		this.search_term = "";
		this.current_category = "All";
		this.categories = [];
		this.all_items = [];
		this.page = 0;
		this.page_size = 40;
		this.loading = false;

		this.init();
	}

	init() {
		this.prepare_dom();
		this.load_categories();
		this.load_items();
		this.bind_events();
	}

	prepare_dom() {
		this.wrapper.append(`
			<section class="fpos-item-selector">
				<!-- Search bar -->
				<div class="fpos-search-bar">
					<span class="fpos-search-icon">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
						</svg>
					</span>
					<input
						class="fpos-search-input"
						type="text"
						placeholder="${__("Search food items, categories...")}"
						autocomplete="off"
					/>
					<button class="fpos-search-clear" style="display:none;">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
						</svg>
					</button>
				</div>

				<!-- Category tabs -->
				<div class="fpos-category-scroll">
					<div class="fpos-categories"></div>
				</div>

				<!-- Items grid -->
				<div class="fpos-items-grid-wrapper">
					<div class="fpos-items-grid"></div>
					<div class="fpos-items-loading" style="display:none;">
						<div class="fpos-spinner"></div>
						<span>${__("Loading menu...")}</span>
					</div>
					<div class="fpos-items-empty" style="display:none;">
						<svg viewBox="0 0 80 80" fill="none">
							<circle cx="40" cy="40" r="38" stroke="#e2e8f0" stroke-width="2"/>
							<path d="M25 35 Q40 20 55 35 Q55 55 40 62 Q25 55 25 35Z" stroke="#cbd5e1" stroke-width="2" fill="none"/>
						</svg>
						<p>${__("No items found")}</p>
						<small>${__("Try a different category or search term")}</small>
					</div>
				</div>
			</section>
		`);

		this.$component       = this.wrapper.find(".fpos-item-selector");
		this.$search_input    = this.$component.find(".fpos-search-input");
		this.$search_clear    = this.$component.find(".fpos-search-clear");
		this.$categories      = this.$component.find(".fpos-categories");
		this.$items_grid      = this.$component.find(".fpos-items-grid");
		this.$loading         = this.$component.find(".fpos-items-loading");
		this.$empty           = this.$component.find(".fpos-items-empty");
	}

	async load_categories() {
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.get_item_groups",
				args: { pos_profile: this.pos_profile },
			});

			const groups = res.message || [];
			this.categories = ["All", ...groups.map((g) => g.name)];
			this.render_categories();
		} catch (e) {
			// fallback — show just "All"
			this.categories = ["All"];
			this.render_categories();
		}
	}

	render_categories() {
		this.$categories.empty();

		const icons = {
			All:       "🍽️",
			Beverages: "🥤",
			Starters:  "🥗",
			"Main Course": "🍛",
			Desserts:  "🍰",
			Burgers:   "🍔",
			Pizza:     "🍕",
			Pasta:     "🍝",
			Sushi:     "🍣",
			Salads:    "🥙",
			Soups:     "🍲",
			Sandwiches:"🥪",
			Wraps:     "🌯",
			Sides:     "🍟",
			Breakfast: "🍳",
			Brunch:    "🧇",
			Seafood:   "🦐",
			Grill:     "🥩",
			Vegan:     "🌱",
		};

		this.categories.forEach((cat) => {
			const icon = icons[cat] || "🍴";
			const active = cat === this.current_category ? "active" : "";
			this.$categories.append(`
				<button class="fpos-category-tab ${active}" data-category="${cat}">
					<span class="fpos-cat-icon">${icon}</span>
					<span class="fpos-cat-label">${__(cat)}</span>
				</button>
			`);
		});
	}

	async load_items(reset = true) {
		if (this.loading) return;
		this.loading = true;

		if (reset) {
			this.page = 0;
			this.$items_grid.empty();
		}

		this.$loading.show();
		this.$empty.hide();

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.get_food_items",
				args: {
					pos_profile:  this.pos_profile,
					item_group:   this.current_category === "All" ? "" : this.current_category,
					search_term:  this.search_term,
					start:        this.page * this.page_size,
					page_length:  this.page_size,
				},
			});

			const items = (res.message && res.message.items) || [];

			if (reset && items.length === 0) {
				this.$empty.show();
			} else {
				items.forEach((item) => this.render_item_card(item));
				this.page++;
			}
		} catch (e) {
			frappe.show_alert({ message: __("Failed to load items"), indicator: "red" });
		} finally {
			this.$loading.hide();
			this.loading = false;
		}
	}

	render_item_card(item) {
		const price = format_currency(item.price_list_rate || 0, item.currency);
		const img   = item.item_image
			? `<img src="${item.item_image}" alt="${item.item_name}" loading="lazy" />`
			: `<div class="fpos-item-placeholder">${this.get_placeholder_icon(item.item_group)}</div>`;

		const unavailable = (item.actual_qty <= 0 && item.is_stock_item) ? "fpos-item-unavailable" : "";
		const badge_html  = item.is_vegetarian
			? `<span class="fpos-veg-badge">🌱</span>`
			: item.is_vegan
			? `<span class="fpos-vegan-badge">V</span>`
			: "";

		const card = $(`
			<div class="fpos-item-card ${unavailable}" data-item-code="${item.item_code}">
				<div class="fpos-item-image">
					${img}
					${badge_html}
					${unavailable ? `<div class="fpos-unavail-overlay">${__("Unavailable")}</div>` : ""}
				</div>
				<div class="fpos-item-info">
					<div class="fpos-item-name" title="${item.item_name}">${item.item_name}</div>
					<div class="fpos-item-price">${price}</div>
				</div>
				<button class="fpos-add-btn" ${unavailable ? "disabled" : ""}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
					</svg>
				</button>
			</div>
		`);

		card.find(".fpos-add-btn").on("click", (e) => {
			e.stopPropagation();
			if (!unavailable) {
				this.add_item_to_cart(item);
				this.animate_add(card);
			}
		});

		card.on("click", () => {
			if (!unavailable) {
				this.show_item_detail(item);
			}
		});

		this.$items_grid.append(card);
	}

	animate_add(card) {
		card.addClass("fpos-item-added");
		setTimeout(() => card.removeClass("fpos-item-added"), 400);
	}

	add_item_to_cart(item) {
		this.events.add_item_to_cart(item);
	}

	// ── Item detail / modifier dialog ─────────────────────────────────────────
	//
	// Flow:
	//   1. Fetch modifier group for this item_code via get_item_modifiers()
	//   2. If a group exists, render radio buttons (Single) or checkboxes (Multiple)
	//      inside the dialog body before the standard qty / note fields
	//   3. On "Add to Order", accumulate selected modifier price_adjustments into
	//      the item's rate, and append modifier names to item_note for the KOT
	// ─────────────────────────────────────────────────────────────────────────

	async show_item_detail(item) {
		// Fetch modifier group (returns {} when none configured)
		let modifier_group = {};
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.get_item_modifiers",
				args: { item_code: item.item_code },
			});
			modifier_group = res.message || {};
		} catch (_) {
			// Non-fatal — proceed without modifiers
		}

		const has_modifiers = modifier_group.group_name && (modifier_group.modifiers || []).length > 0;

		const d = new frappe.ui.Dialog({
			title: item.item_name,
			// qty + note fields are always present; modifiers are injected into the body below
			fields: [
				{
					fieldname: "qty",
					fieldtype: "Int",
					label: __("Quantity"),
					default: 1,
					reqd: 1,
				},
				{
					fieldname: "item_note",
					fieldtype: "Small Text",
					label: __("Special Instructions"),
					placeholder: __("e.g. No onions, extra sauce..."),
				},
			],
			primary_action_label: __("Add to Order"),
			primary_action: (values) => {
				const selected_modifiers = this._read_modifier_selections(d, modifier_group);
				const price_delta = selected_modifiers.reduce((s, m) => s + (m.price_adjustment || 0), 0);

				// Append selected modifier names to the KOT note so the kitchen sees them
				const modifier_label = selected_modifiers.map((m) => m.modifier_name).join(", ");
				const combined_note  = [modifier_label, values.item_note].filter(Boolean).join(" | ");

				this.events.add_item_to_cart({
					...item,
					qty:               values.qty || 1,
					item_note:         combined_note,
					// Adjust the unit rate — create_pos_invoice will use this rate per line
					price_list_rate:   (item.price_list_rate || 0) + price_delta,
					modifiers:         selected_modifiers,
					modifier_group:    modifier_group.group_name || "",
				});
				d.hide();
			},
		});

		// ── Inject item image ────────────────────────────────────────────────
		if (item.item_image) {
			$(d.wrapper).find(".modal-body").prepend(
				`<img src="${item.item_image}"
				      style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-bottom:12px;" />`
			);
		}

		// ── Inject modifier section above qty/note ───────────────────────────
		if (has_modifiers) {
			const is_single   = modifier_group.selection_type === "Single";
			const input_type  = is_single ? "radio" : "checkbox";
			const group_label = modifier_group.group_name;
			const required    = modifier_group.is_required ? ` <span class="fpos-mod-required">*</span>` : "";
			const currency    = frappe.defaults.get_default("currency") || "";

			let options_html = (modifier_group.modifiers || []).map((mod, idx) => {
				const price_label = mod.price_adjustment > 0
					? `<span class="fpos-mod-price fpos-mod-price-add">
						+${format_currency(mod.price_adjustment, currency)}
					   </span>`
					: mod.price_adjustment < 0
					? `<span class="fpos-mod-price fpos-mod-price-sub">
						${format_currency(mod.price_adjustment, currency)}
					   </span>`
					: `<span class="fpos-mod-price fpos-mod-price-free">${__("Free")}</span>`;

				const checked = mod.is_default ? "checked" : "";

				return `
					<label class="fpos-mod-option">
						<input type="${input_type}"
						       name="fpos_modifier"
						       class="fpos-mod-input"
						       value="${idx}"
						       ${checked}
						       data-name="${mod.modifier_name}"
						       data-price="${mod.price_adjustment}" />
						<span class="fpos-mod-name">${mod.modifier_name}</span>
						${price_label}
					</label>
				`;
			}).join("");

			const modifier_block = $(`
				<div class="fpos-modifier-section">
					<div class="fpos-modifier-group-label">${__(group_label)}${required}</div>
					<div class="fpos-modifier-options">${options_html}</div>
				</div>
			`);

			// Insert before the first form field (qty)
			$(d.wrapper).find(".modal-body .frappe-control").first().before(modifier_block);

			// Live price preview: update dialog title suffix when selection changes
			$(d.wrapper).on("change", ".fpos-mod-input", () => {
				const selected = this._read_modifier_selections(d, modifier_group);
				const delta    = selected.reduce((s, m) => s + m.price_adjustment, 0);
				const new_rate = (item.price_list_rate || 0) + delta;
				$(d.wrapper).find(".modal-title").text(
					`${item.item_name}  —  ${format_currency(new_rate, currency)}`
				);
			});

			// Trigger once to set initial title with default selections
			setTimeout(() => $(d.wrapper).find(".fpos-mod-input:checked").first().trigger("change"), 50);
		}

		d.show();
	}

	/**
	 * Read selected modifier inputs from the dialog and return an array of
	 * { modifier_name, price_adjustment } for each checked option.
	 * @private
	 */
	_read_modifier_selections(dialog, modifier_group) {
		const selected = [];
		$(dialog.wrapper).find(".fpos-mod-input:checked").each(function () {
			selected.push({
				modifier_name:    $(this).data("name"),
				price_adjustment: parseFloat($(this).data("price")) || 0,
			});
		});
		return selected;
	}

	get_placeholder_icon(item_group) {
		const map = {
			Beverages: "🥤", Starters: "🥗", "Main Course": "🍛",
			Desserts: "🍰", Burgers: "🍔", Pizza: "🍕",
			Pasta: "🍝", Sushi: "🍣", Salads: "🥙",
			Soups: "🍲", Seafood: "🦐", Grill: "🥩",
		};
		return map[item_group] || "🍴";
	}

	bind_events() {
		// Search
		let search_timer;
		this.$search_input.on("input", (e) => {
			this.search_term = e.target.value.trim();
			this.$search_clear.toggle(!!this.search_term);
			clearTimeout(search_timer);
			search_timer = setTimeout(() => this.load_items(), 300);
		});

		this.$search_clear.on("click", () => {
			this.search_term = "";
			this.$search_input.val("").focus();
			this.$search_clear.hide();
			this.load_items();
		});

		// Category tab
		this.$categories.on("click", ".fpos-category-tab", (e) => {
			const cat = $(e.currentTarget).data("category");
			if (cat === this.current_category) return;
			this.current_category = cat;
			this.$categories.find(".fpos-category-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.load_items();
		});

		// Infinite scroll
		this.$component.find(".fpos-items-grid-wrapper").on("scroll", (e) => {
			const el = e.target;
			if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
				this.load_items(false);
			}
		});
	}

	// Called externally to reset
	refresh() {
		this.search_term = "";
		this.current_category = "All";
		this.$search_input.val("");
		this.$search_clear.hide();
		this.$categories.find(".fpos-category-tab").removeClass("active").first().addClass("active");
		this.load_items();
	}
};
