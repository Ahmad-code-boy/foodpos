foodpos.FoodPOS.Kitchen = class {
	constructor({ wrapper, events, pos_profile }) {
		this.wrapper = wrapper;
		this.events = events;
		this.pos_profile = pos_profile;
		this.kots = [];           // live KOT tickets
		this.poll_interval = null;
		this.POLL_MS = 15000;     // refresh every 15 s

		this.init();
	}

	// ─── Init ────────────────────────────────────────────────────────────────

	init() {
		this.prepare_dom();
		this.bind_events();
		this.load_kots();
		this.start_polling();
	}

	prepare_dom() {
		this.wrapper.append(`
			<section class="fpos-kitchen">
				<!-- Header toolbar -->
				<div class="fpos-kitchen-header">
					<div class="fpos-kitchen-title">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
							<rect x="9" y="3" width="6" height="4" rx="1"/>
							<line x1="9" y1="12" x2="15" y2="12"/>
							<line x1="9" y1="16" x2="12" y2="16"/>
						</svg>
						<span>${__("Kitchen Display")}</span>
						<span class="fpos-kitchen-live-badge">${__("LIVE")}</span>
					</div>
					<div class="fpos-kitchen-filters">
						<button class="fpos-kf-btn active" data-status="all">${__("All")}</button>
						<button class="fpos-kf-btn" data-status="Pending">
							<span class="fpos-status-dot pending"></span>${__("Pending")}
						</button>
						<button class="fpos-kf-btn" data-status="In Progress">
							<span class="fpos-status-dot in-progress"></span>${__("In Progress")}
						</button>
						<button class="fpos-kf-btn" data-status="Ready">
							<span class="fpos-status-dot ready"></span>${__("Ready")}
						</button>
					</div>
					<div class="fpos-kitchen-toolbar">
						<span class="fpos-kitchen-clock"></span>
						<button class="fpos-kitchen-refresh-btn" title="${__("Refresh")}">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="23 4 23 10 17 10"/>
								<path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/>
							</svg>
						</button>
					</div>
				</div>

				<!-- Stats bar -->
				<div class="fpos-kitchen-stats">
					<div class="fpos-stat-card">
						<span class="fpos-stat-num fpos-stat-pending">0</span>
						<span class="fpos-stat-label">${__("Pending")}</span>
					</div>
					<div class="fpos-stat-card">
						<span class="fpos-stat-num fpos-stat-inprogress">0</span>
						<span class="fpos-stat-label">${__("In Progress")}</span>
					</div>
					<div class="fpos-stat-card">
						<span class="fpos-stat-num fpos-stat-ready">0</span>
						<span class="fpos-stat-label">${__("Ready")}</span>
					</div>
					<div class="fpos-stat-card">
						<span class="fpos-stat-num fpos-stat-avg-time">—</span>
						<span class="fpos-stat-label">${__("Avg. Time (min)")}</span>
					</div>
				</div>

				<!-- KOT board -->
				<div class="fpos-kitchen-board">
					<div class="fpos-kitchen-loading" style="display:none;">
						<div class="fpos-spinner"></div>
						<span>${__("Loading kitchen orders...")}</span>
					</div>
					<div class="fpos-kitchen-empty" style="display:none;">
						<svg viewBox="0 0 80 80" fill="none">
							<circle cx="40" cy="40" r="38" stroke="#e2e8f0" stroke-width="2"/>
							<path d="M28 35h24M28 45h16" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>
						</svg>
						<p>${__("No active kitchen orders")}</p>
					</div>
					<div class="fpos-kot-cards"></div>
				</div>
			</section>
		`);

		this.$component  = this.wrapper.find(".fpos-kitchen");
		this.$board      = this.$component.find(".fpos-kot-cards");
		this.$loading    = this.$component.find(".fpos-kitchen-loading");
		this.$empty      = this.$component.find(".fpos-kitchen-empty");
		this.$clock      = this.$component.find(".fpos-kitchen-clock");

		this.active_filter = "all";
		this.tick_clock();
		setInterval(() => this.tick_clock(), 1000);
	}

	// ─── Clock ────────────────────────────────────────────────────────────────

	tick_clock() {
		const now = new Date();
		this.$clock.text(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
	}

	// ─── Load KOTs ───────────────────────────────────────────────────────────

	async load_kots(silent = false) {
		if (!silent) {
			this.$loading.show();
			this.$empty.hide();
			this.$board.empty();
		}

		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.get_kitchen_orders",
				args: { pos_profile: this.pos_profile },
			});

			this.kots = res.message || [];
			this.render_board();
			this.render_stats();
		} catch (_) {
			frappe.show_alert({ message: __("Failed to load kitchen orders"), indicator: "red" });
		} finally {
			this.$loading.hide();
		}
	}

	start_polling() {
		this.poll_interval = setInterval(() => this.load_kots(true), this.POLL_MS);
	}

	stop_polling() {
		if (this.poll_interval) {
			clearInterval(this.poll_interval);
			this.poll_interval = null;
		}
	}

	// ─── Render board ────────────────────────────────────────────────────────

	render_board() {
		this.$board.empty();

		const filtered = this.active_filter === "all"
			? this.kots
			: this.kots.filter((k) => k.status === this.active_filter);

		if (filtered.length === 0) {
			this.$empty.show();
			return;
		}

		this.$empty.hide();
		filtered.forEach((kot) => this.render_kot_card(kot));
	}

	render_kot_card(kot) {
		const age_min  = this.get_age_minutes(kot.creation);
		const urgency  = age_min >= 20 ? "urgent" : age_min >= 10 ? "warning" : "";
		const status_class = {
			"Pending":     "fpos-kot-pending",
			"In Progress": "fpos-kot-inprogress",
			"Ready":       "fpos-kot-ready",
			"Served":      "fpos-kot-served",
		}[kot.status] || "";

		const items_html = (kot.items || []).map((item) => `
			<div class="fpos-kot-item ${item.is_done ? "fpos-kot-item-done" : ""}"
				 data-kot="${kot.name}" data-item="${item.name}">
				<div class="fpos-kot-item-check">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
						<polyline points="20 6 9 17 4 12"/>
					</svg>
				</div>
				<span class="fpos-kot-item-qty">${item.qty}×</span>
				<span class="fpos-kot-item-name">${item.item_name}</span>
				${item.item_note
					? `<span class="fpos-kot-item-note">📝 ${item.item_note}</span>`
					: ""}
			</div>
		`).join("");

		const next_action = this.get_next_action(kot.status);

		const card = $(`
			<div class="fpos-kot-card ${status_class} ${urgency}" data-kot="${kot.name}">
				<!-- Card header -->
				<div class="fpos-kot-card-header">
					<div class="fpos-kot-meta">
						<span class="fpos-kot-number">#${kot.name}</span>
						${kot.table ? `<span class="fpos-kot-table">🪑 ${__("Table")} ${kot.table}</span>` : ""}
						${kot.order_type
							? `<span class="fpos-kot-type">${this.get_order_type_icon(kot.order_type)} ${__(kot.order_type)}</span>`
							: ""}
					</div>
					<div class="fpos-kot-timing">
						<span class="fpos-kot-age ${urgency}" title="${__("Order age")}">${age_min}${__("m")}</span>
						<span class="fpos-kot-status-badge ${status_class}">${__(kot.status)}</span>
					</div>
				</div>

				<!-- Items -->
				<div class="fpos-kot-items">
					${items_html}
				</div>

				${kot.order_note
					? `<div class="fpos-kot-order-note">📋 ${kot.order_note}</div>`
					: ""}

				<!-- Card footer actions -->
				<div class="fpos-kot-card-footer">
					${next_action ? `
						<button class="fpos-btn fpos-btn-primary fpos-kot-action-btn"
								data-kot="${kot.name}"
								data-action="${next_action.action}">
							${next_action.icon} ${__(next_action.label)}
						</button>
					` : ""}
					${kot.status !== "Served" ? `
						<button class="fpos-btn fpos-btn-secondary fpos-kot-print-btn"
								data-kot="${kot.name}"
								title="${__("Print KOT")}">
							🖨️ ${__("Print")}
						</button>
					` : ""}
				</div>
			</div>
		`);

		// Toggle individual item done state
		card.find(".fpos-kot-item").on("click", (e) => {
			const item_name = $(e.currentTarget).data("item");
			const kot_name  = $(e.currentTarget).data("kot");
			this.toggle_item_done(kot_name, item_name, $(e.currentTarget));
		});

		this.$board.append(card);
	}

	get_next_action(status) {
		const map = {
			"Pending":     { action: "start",  label: "Start Cooking", icon: "🔥" },
			"In Progress": { action: "ready",  label: "Mark Ready",    icon: "✅" },
			"Ready":       { action: "served", label: "Mark Served",   icon: "🍽️" },
		};
		return map[status] || null;
	}

	get_order_type_icon(type) {
		return { "Dine In": "🪑", "Takeaway": "🥡", "Delivery": "🛵" }[type] || "";
	}

	get_age_minutes(creation) {
		if (!creation) return 0;
		const diff = Date.now() - new Date(creation).getTime();
		return Math.floor(diff / 60000);
	}

	// ─── Stats ───────────────────────────────────────────────────────────────

	render_stats() {
		const pending     = this.kots.filter((k) => k.status === "Pending").length;
		const in_progress = this.kots.filter((k) => k.status === "In Progress").length;
		const ready       = this.kots.filter((k) => k.status === "Ready").length;

		const completed   = this.kots.filter((k) => k.status === "Served");
		let avg_time = "—";
		if (completed.length) {
			const total = completed.reduce((s, k) => s + this.get_age_minutes(k.creation), 0);
			avg_time = Math.round(total / completed.length);
		}

		this.$component.find(".fpos-stat-pending").text(pending);
		this.$component.find(".fpos-stat-inprogress").text(in_progress);
		this.$component.find(".fpos-stat-ready").text(ready);
		this.$component.find(".fpos-stat-avg-time").text(avg_time);
	}

	// ─── Actions ─────────────────────────────────────────────────────────────

	async update_kot_status(kot_name, action) {
		const status_map = { start: "In Progress", ready: "Ready", served: "Served" };
		const new_status = status_map[action];
		if (!new_status) return;

		try {
			await frappe.call({
				method: "foodpos.foodpos.api.food_pos.update_kot_status",
				args: { kot_name, status: new_status },
			});

			frappe.show_alert({ message: __("Order {0} marked as {1}", [kot_name, new_status]), indicator: "green" });
			await this.load_kots(true);
		} catch (_) {
			frappe.show_alert({ message: __("Failed to update order status"), indicator: "red" });
		}
	}

	async toggle_item_done(kot_name, item_name, $el) {
		$el.toggleClass("fpos-kot-item-done");
		const is_done = $el.hasClass("fpos-kot-item-done");

		try {
			await frappe.call({
				method: "foodpos.foodpos.api.food_pos.toggle_kot_item_done",
				args: { kot_name, item_name, is_done: is_done ? 1 : 0 },
			});
		} catch (_) {
			// Revert on failure
			$el.toggleClass("fpos-kot-item-done");
		}
	}

	print_kot(kot_name) {
		const kot = this.kots.find((k) => k.name === kot_name);
		if (!kot) return;

		const win = window.open("", "_blank", "width=380,height=600");
		win.document.write(`
			<html><head>
			<title>KOT - ${kot_name}</title>
			<style>
				body { font-family: 'Courier New', monospace; padding: 16px; }
				h2 { text-align: center; border-bottom: 2px dashed #000; padding-bottom: 8px; }
				.meta { display: flex; justify-content: space-between; margin: 8px 0; font-size: 13px; }
				.items { margin-top: 12px; }
				.item { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px dotted #ccc; }
				.note { font-style: italic; color: #555; font-size: 12px; }
				.footer { margin-top: 16px; text-align: center; font-size: 11px; border-top: 2px dashed #000; padding-top: 8px; }
			</style>
			</head><body>
			<h2>🍴 KITCHEN ORDER TICKET</h2>
			<div class="meta"><span><b>KOT #:</b> ${kot_name}</span><span>${frappe.datetime.now_datetime()}</span></div>
			${kot.table ? `<div class="meta"><span><b>Table:</b> ${kot.table}</span><span><b>Type:</b> ${kot.order_type || "Dine In"}</span></div>` : ""}
			<div class="items">
				${(kot.items || []).map((i) => `
					<div class="item">
						<span><b>${i.qty}×</b></span>
						<span>${i.item_name}</span>
					</div>
					${i.item_note ? `<div class="note">   └ ${i.item_note}</div>` : ""}
				`).join("")}
			</div>
			${kot.order_note ? `<div class="note" style="margin-top:8px;">📋 ${kot.order_note}</div>` : ""}
			<div class="footer">— ${__("Kitchen Copy")} —</div>
			</body></html>
		`);
		win.document.close();
		win.focus();
		setTimeout(() => { win.print(); win.close(); }, 500);
	}

	// ─── Send a new KOT from cart ─────────────────────────────────────────────

	async send_kot(order) {
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.create_kot",
				args: { order: JSON.stringify(order) },
			});

			if (res.message && res.message.kot_name) {
				frappe.show_alert({
					message: __("KOT #{0} sent to kitchen", [res.message.kot_name]),
					indicator: "green",
				});
				this.events.on_kot_sent && this.events.on_kot_sent(res.message.kot_name);
				await this.load_kots(true);
			} else {
				throw new Error(res.message?.error || __("Failed to create KOT"));
			}
		} catch (err) {
			frappe.show_alert({ message: err.message || __("KOT failed"), indicator: "red" });
		}
	}

	// ─── Events ──────────────────────────────────────────────────────────────

	bind_events() {
		// Filter tabs
		this.$component && this.wrapper.on("click", ".fpos-kf-btn", (e) => {
			this.wrapper.find(".fpos-kf-btn").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.active_filter = $(e.currentTarget).data("status");
			this.render_board();
		});

		// Status action button
		this.wrapper.on("click", ".fpos-kot-action-btn", (e) => {
			e.stopPropagation();
			const kot_name = $(e.currentTarget).data("kot");
			const action   = $(e.currentTarget).data("action");
			this.update_kot_status(kot_name, action);
		});

		// Print KOT
		this.wrapper.on("click", ".fpos-kot-print-btn", (e) => {
			e.stopPropagation();
			const kot_name = $(e.currentTarget).data("kot");
			this.print_kot(kot_name);
		});

		// Manual refresh
		this.wrapper.on("click", ".fpos-kitchen-refresh-btn", () => this.load_kots());
	}

	// ─── Lifecycle ───────────────────────────────────────────────────────────

	show() {
		this.$component.show();
		this.load_kots(true);
	}

	hide() {
		this.$component.hide();
	}

	destroy() {
		this.stop_polling();
	}
};
