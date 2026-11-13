foodpos.FoodPOS.TableManager = class {
	constructor({ wrapper, events, pos_profile }) {
		this.wrapper = wrapper;
		this.events = events;
		this.pos_profile = pos_profile;
		this.tables = [];
		this.sections = [];
		this.active_section = "All";
		this.selected_table = null;

		this.init();
	}

	// ─── Init ────────────────────────────────────────────────────────────────

	init() {
		this.prepare_dom();
		this.load_tables();
		this.bind_events();
	}

	prepare_dom() {
		this.wrapper.append(`
			<section class="fpos-tables">
				<!-- Header -->
				<div class="fpos-tables-header">
					<div class="fpos-tables-title">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<rect x="3" y="8" width="18" height="4" rx="1"/>
							<line x1="7" y1="12" x2="7" y2="20"/>
							<line x1="17" y1="12" x2="17" y2="20"/>
							<line x1="7" y1="4" x2="7" y2="8"/>
							<line x1="17" y1="4" x2="17" y2="8"/>
						</svg>
						<span>${__("Table Management")}</span>
					</div>
					<div class="fpos-tables-legend">
						<span class="fpos-legend-item">
							<span class="fpos-legend-dot available"></span>${__("Available")}
						</span>
						<span class="fpos-legend-item">
							<span class="fpos-legend-dot occupied"></span>${__("Occupied")}
						</span>
						<span class="fpos-legend-item">
							<span class="fpos-legend-dot reserved"></span>${__("Reserved")}
						</span>
						<span class="fpos-legend-item">
							<span class="fpos-legend-dot cleaning"></span>${__("Cleaning")}
						</span>
					</div>
					<button class="fpos-tables-refresh-btn" title="${__("Refresh")}">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="23 4 23 10 17 10"/>
							<path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
						</svg>
					</button>
				</div>

				<!-- Section tabs -->
				<div class="fpos-section-tabs"></div>

				<!-- Summary strip -->
				<div class="fpos-tables-summary">
					<div class="fpos-tsummary-card available">
						<span class="fpos-tsummary-num">0</span>
						<span>${__("Available")}</span>
					</div>
					<div class="fpos-tsummary-card occupied">
						<span class="fpos-tsummary-num">0</span>
						<span>${__("Occupied")}</span>
					</div>
					<div class="fpos-tsummary-card reserved">
						<span class="fpos-tsummary-num">0</span>
						<span>${__("Reserved")}</span>
					</div>
					<div class="fpos-tsummary-card cleaning">
						<span class="fpos-tsummary-num">0</span>
						<span>${__("Cleaning")}</span>
					</div>
				</div>

				<!-- Table grid -->
				<div class="fpos-tables-grid-wrapper">
					<div class="fpos-tables-grid"></div>
					<div class="fpos-tables-loading" style="display:none;">
						<div class="fpos-spinner"></div>
						<span>${__("Loading tables...")}</span>
					</div>
					<div class="fpos-tables-empty" style="display:none;">
						<p>${__("No tables configured")}</p>
						<small>${__("Add restaurant tables in the Table master")}</small>
					</div>
				</div>
			</section>
		`);

		this.$component    = this.wrapper.find(".fpos-tables");
		this.$section_tabs = this.$component.find(".fpos-section-tabs");
		this.$grid         = this.$component.find(".fpos-tables-grid");
		this.$loading      = this.$component.find(".fpos-tables-loading");
		this.$empty        = this.$component.find(".fpos-tables-empty");
	}

	// ─── Load tables ─────────────────────────────────────────────────────────

	async load_tables() {
		this.$loading.show();
		this.$grid.empty();
		this.$empty.hide();

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.get_tables",
				args: { pos_profile: this.pos_profile },
			});

			this.tables = res.message || [];
			this.sections = ["All", ...new Set(this.tables.map((t) => t.section || __("Main Floor")))];

			this.render_section_tabs();
			this.render_grid();
			this.render_summary();
		} catch (_) {
			// Fallback to demo tables if API fails
			this.tables = this.get_demo_tables();
			this.sections = ["All", "Main Floor", "Outdoor", "Private"];
			this.render_section_tabs();
			this.render_grid();
			this.render_summary();
		} finally {
			this.$loading.hide();
		}
	}

	get_demo_tables() {
		const statuses = ["Available", "Occupied", "Available", "Reserved", "Available",
						  "Occupied", "Available", "Cleaning", "Available", "Occupied"];
		return Array.from({ length: 10 }, (_, i) => ({
			name:     `T-${String(i + 1).padStart(2, "0")}`,
			table_no: `${i + 1}`,
			capacity: [2, 4, 4, 6, 2, 4, 8, 4, 2, 6][i],
			status:   statuses[i],
			section:  i < 4 ? "Main Floor" : i < 7 ? "Outdoor" : "Private",
			order_id: statuses[i] === "Occupied" ? `ORD-00${i + 1}` : null,
			waiter:   statuses[i] === "Occupied" ? ["Alice", "Bob", "Carol"][i % 3] : null,
		}));
	}

	// ─── Render section tabs ─────────────────────────────────────────────────

	render_section_tabs() {
		this.$section_tabs.empty();
		this.sections.forEach((sec) => {
			const count = sec === "All"
				? this.tables.length
				: this.tables.filter((t) => (t.section || __("Main Floor")) === sec).length;

			this.$section_tabs.append(`
				<button class="fpos-section-tab ${sec === this.active_section ? "active" : ""}"
						data-section="${sec}">
					${__(sec)}
					<span class="fpos-section-count">${count}</span>
				</button>
			`);
		});
	}

	// ─── Render grid ─────────────────────────────────────────────────────────

	render_grid() {
		this.$grid.empty();

		const visible = this.active_section === "All"
			? this.tables
			: this.tables.filter((t) => (t.section || __("Main Floor")) === this.active_section);

		if (visible.length === 0) {
			this.$empty.show();
			return;
		}
		this.$empty.hide();

		visible.forEach((table) => this.render_table_card(table));
	}

	render_table_card(table) {
		const status      = table.status || "Available";
		const status_cls  = status.toLowerCase().replace(" ", "-");
		const is_selected = this.selected_table === table.name;
		const capacity    = table.capacity || 4;

		// Seat icons (filled vs empty)
		const seats_html = Array.from({ length: capacity }, (_, i) => {
			const filled = status === "Occupied" && i < Math.min(capacity, table.guests || capacity);
			return `<span class="fpos-seat ${filled ? "filled" : ""}">👤</span>`;
		}).join("");

		const card = $(`
			<div class="fpos-table-card ${status_cls} ${is_selected ? "selected" : ""}"
				 data-table="${table.name}">
				<!-- Status badge -->
				<div class="fpos-table-status-badge ${status_cls}">${__(status)}</div>

				<!-- Table number -->
				<div class="fpos-table-number">
					<span class="fpos-table-icon">🪑</span>
					<span class="fpos-table-num-text">${__("Table")} ${table.table_no || table.name}</span>
				</div>

				<!-- Seats -->
				<div class="fpos-table-seats">${seats_html}</div>
				<div class="fpos-table-capacity">${capacity} ${__("seats")}</div>

				<!-- Occupied info -->
				${status === "Occupied" ? `
					<div class="fpos-table-occupied-info">
						${table.order_id ? `<div class="fpos-table-order">#${table.order_id}</div>` : ""}
						${table.waiter   ? `<div class="fpos-table-waiter">👤 ${table.waiter}</div>` : ""}
						${table.occupied_since
							? `<div class="fpos-table-time">${this.get_elapsed(table.occupied_since)}</div>`
							: ""}
					</div>
				` : ""}

				<!-- Quick actions -->
				<div class="fpos-table-actions">
					${status === "Available" ? `
						<button class="fpos-tbl-btn fpos-tbl-assign"
								data-table="${table.name}"
								data-table-no="${table.table_no || table.name}">
							${__("Assign")}
						</button>
					` : status === "Occupied" ? `
						<button class="fpos-tbl-btn fpos-tbl-view"
								data-table="${table.name}">
							${__("View Order")}
						</button>
						<button class="fpos-tbl-btn fpos-tbl-clear"
								data-table="${table.name}">
							${__("Clear")}
						</button>
					` : status === "Reserved" ? `
						<button class="fpos-tbl-btn fpos-tbl-checkin"
								data-table="${table.name}"
								data-table-no="${table.table_no || table.name}">
							${__("Check In")}
						</button>
					` : status === "Cleaning" ? `
						<button class="fpos-tbl-btn fpos-tbl-ready"
								data-table="${table.name}">
							${__("Mark Ready")}
						</button>
					` : ""}
				</div>
			</div>
		`);

		this.$grid.append(card);
	}

	get_elapsed(since) {
		if (!since) return "";
		const mins = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
		if (mins < 60) return `${mins}m`;
		return `${Math.floor(mins / 60)}h ${mins % 60}m`;
	}

	// ─── Summary strip ───────────────────────────────────────────────────────

	render_summary() {
		const count = (s) => this.tables.filter((t) => t.status === s).length;
		this.$component.find(".fpos-tsummary-card.available .fpos-tsummary-num").text(count("Available"));
		this.$component.find(".fpos-tsummary-card.occupied  .fpos-tsummary-num").text(count("Occupied"));
		this.$component.find(".fpos-tsummary-card.reserved  .fpos-tsummary-num").text(count("Reserved"));
		this.$component.find(".fpos-tsummary-card.cleaning  .fpos-tsummary-num").text(count("Cleaning"));
	}

	// ─── Table detail dialog ─────────────────────────────────────────────────

	show_table_detail(table_name) {
		const table = this.tables.find((t) => t.name === table_name);
		if (!table) return;

		const d = new frappe.ui.Dialog({
			title: `${__("Table")} ${table.table_no || table.name}`,
			fields: [
				{
					fieldname: "status",
					fieldtype: "Select",
					label: __("Status"),
					options: ["Available", "Occupied", "Reserved", "Cleaning"],
					default: table.status || "Available",
					reqd: 1,
				},
				{
					fieldname: "guests",
					fieldtype: "Int",
					label: __("Number of Guests"),
					default: table.guests || 0,
				},
				{
					fieldname: "waiter",
					fieldtype: "Data",
					label: __("Assigned Waiter"),
					default: table.waiter || "",
				},
				{
					fieldname: "notes",
					fieldtype: "Small Text",
					label: __("Notes"),
					default: table.notes || "",
				},
			],
			primary_action_label: __("Save"),
			primary_action: (values) => {
				this.update_table_status(table_name, values);
				d.hide();
			},
		});
		d.show();
	}

	async update_table_status(table_name, values) {
		try {
			await frappe.call({
				method: "foodpos.foodpos.api.food_pos.update_table_status",
				args: { table_name, ...values },
			});

			// Optimistic update
			const idx = this.tables.findIndex((t) => t.name === table_name);
			if (idx >= 0) Object.assign(this.tables[idx], values);

			this.render_grid();
			this.render_summary();
			frappe.show_alert({ message: __("Table updated"), indicator: "green" });
		} catch (_) {
			frappe.show_alert({ message: __("Failed to update table"), indicator: "red" });
		}
	}

	// ─── Reserve dialog ──────────────────────────────────────────────────────

	show_reserve_dialog(table_name) {
		const table = this.tables.find((t) => t.name === table_name);
		if (!table) return;

		const d = new frappe.ui.Dialog({
			title: __("Reserve Table {0}", [table.table_no || table_name]),
			fields: [
				{
					fieldname: "customer_name",
					fieldtype: "Data",
					label: __("Customer Name"),
					reqd: 1,
				},
				{
					fieldname: "guests",
					fieldtype: "Int",
					label: __("Number of Guests"),
					default: 2,
					reqd: 1,
				},
				{
					fieldname: "reservation_time",
					fieldtype: "Datetime",
					label: __("Reservation Time"),
					default: frappe.datetime.get_datetime_as_string(),
					reqd: 1,
				},
				{
					fieldname: "mobile",
					fieldtype: "Data",
					label: __("Mobile Number"),
				},
				{
					fieldname: "notes",
					fieldtype: "Small Text",
					label: __("Notes"),
				},
			],
			primary_action_label: __("Reserve"),
			primary_action: (values) => {
				this.update_table_status(table_name, { status: "Reserved", ...values });
				d.hide();
			},
		});
		d.show();
	}

	// ─── Assign table to current order ───────────────────────────────────────

	assign_table(table_name, table_no) {
		this.selected_table = table_name;
		this.render_grid();
		this.events.on_table_selected && this.events.on_table_selected(table_name, table_no);

		// Optimistic: mark as Occupied
		const idx = this.tables.findIndex((t) => t.name === table_name);
		if (idx >= 0) {
			this.tables[idx].status         = "Occupied";
			this.tables[idx].occupied_since = new Date().toISOString();
		}
		this.render_grid();
		this.render_summary();
	}

	// ─── Events ──────────────────────────────────────────────────────────────

	bind_events() {
		// Section tabs
		this.$component.on("click", ".fpos-section-tab", (e) => {
			this.active_section = $(e.currentTarget).data("section");
			this.$section_tabs.find(".fpos-section-tab").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.render_grid();
		});

		// Assign / Check In button
		this.$component.on("click", ".fpos-tbl-assign, .fpos-tbl-checkin", (e) => {
			e.stopPropagation();
			const table_name = $(e.currentTarget).data("table");
			const table_no   = $(e.currentTarget).data("table-no");
			this.assign_table(table_name, table_no);
		});

		// View order
		this.$component.on("click", ".fpos-tbl-view", (e) => {
			e.stopPropagation();
			const table_name = $(e.currentTarget).data("table");
			const table = this.tables.find((t) => t.name === table_name);
			if (table?.order_id) {
				frappe.set_route("Form", "POS Invoice", table.order_id);
			}
		});

		// Clear table
		this.$component.on("click", ".fpos-tbl-clear", (e) => {
			e.stopPropagation();
			const table_name = $(e.currentTarget).data("table");
			frappe.confirm(
				__("Mark this table as available?"),
				() => this.update_table_status(table_name, {
					status: "Cleaning", order_id: null, waiter: null, occupied_since: null,
				})
			);
		});

		// Mark ready (cleaning → available)
		this.$component.on("click", ".fpos-tbl-ready", (e) => {
			e.stopPropagation();
			const table_name = $(e.currentTarget).data("table");
			this.update_table_status(table_name, { status: "Available" });
		});

		// Card click → detail dialog
		this.$component.on("click", ".fpos-table-card", (e) => {
			const table_name = $(e.currentTarget).data("table");
			this.show_table_detail(table_name);
		});

		// Refresh
		this.$component.on("click", ".fpos-tables-refresh-btn", () => this.load_tables());
	}

	// ─── Public API ──────────────────────────────────────────────────────────

	/**
	 * Open as a modal dialog (called from cart when "Select Table" is clicked)
	 */
	open_selector(callback) {
		const d = new frappe.ui.Dialog({
			title: __("Select Table"),
			size: "extra-large",
			indicator: "blue",
		});

		$(d.wrapper).find(".modal-footer").hide();
		const body = $(d.wrapper).find(".modal-body");
		body.css({ padding: 0 });

		const available = this.tables.filter((t) => t.status === "Available");

		if (available.length === 0) {
			body.html(`
				<div class="fpos-tables-empty" style="padding:40px;text-align:center;">
					<p>${__("No tables available right now")}</p>
				</div>
			`);
			d.show();
			return;
		}

		// Simple quick-pick grid inside dialog
		const grid = $(`<div class="fpos-table-picker-grid"></div>`);
		available.forEach((table) => {
			grid.append(`
				<button class="fpos-table-pick-btn" data-table="${table.name}" data-table-no="${table.table_no || table.name}">
					<span class="fpos-tp-icon">🪑</span>
					<span class="fpos-tp-no">${__("Table")} ${table.table_no || table.name}</span>
					<span class="fpos-tp-cap">${table.capacity || 4} ${__("seats")}</span>
					<span class="fpos-tp-section">${table.section || __("Main Floor")}</span>
				</button>
			`);
		});

		body.append(grid);

		grid.on("click", ".fpos-table-pick-btn", (e) => {
			const table_name = $(e.currentTarget).data("table");
			const table_no   = $(e.currentTarget).data("table-no");
			this.assign_table(table_name, table_no);
			if (callback) callback(table_name, table_no);
			d.hide();
		});

		d.show();
	}

	free_table(table_name) {
		const idx = this.tables.findIndex((t) => t.name === table_name);
		if (idx >= 0) {
			this.tables[idx].status         = "Cleaning";
			this.tables[idx].occupied_since = null;
			this.tables[idx].order_id       = null;
		}
		if (this.selected_table === table_name) this.selected_table = null;
		this.render_grid();
		this.render_summary();
	}

	refresh() {
		this.load_tables();
	}
};
