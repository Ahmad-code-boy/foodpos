foodpos.FoodPOS.Payment = class {
	constructor({ wrapper, events, pos_profile, settings }) {
		this.wrapper = wrapper;
		this.events = events;
		this.pos_profile = pos_profile;
		this.settings = settings || {};

		// Payment state
		this.order = null;
		this.payment_methods = [];
		this.payment_lines = [];   // [{ mode_of_payment, amount }]
		this.active_method = null;
		this.numpad_target = null; // which payment line is being edited

		this.init();
	}

	// ─── Init ────────────────────────────────────────────────────────────────

	init() {
		this.load_payment_methods();
	}

	async load_payment_methods() {
		try {
			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.get_payment_methods",
				args: { pos_profile: this.pos_profile },
			});
			this.payment_methods = res.message || [];
		} catch (_) {
			// Defaults if API fails
			this.payment_methods = [
				{ mode_of_payment: "Cash",        type: "Cash",   icon: "💵" },
				{ mode_of_payment: "Credit Card",  type: "Card",   icon: "💳" },
				{ mode_of_payment: "Debit Card",   type: "Card",   icon: "💳" },
				{ mode_of_payment: "UPI",          type: "UPI",    icon: "📱" },
				{ mode_of_payment: "Wallet",       type: "Wallet", icon: "👛" },
			];
		}
	}

	// ─── Open the payment panel for an order ─────────────────────────────────

	open(order) {
		this.order = order;
		this.payment_lines = [];

		// Pre-fill Cash as default full amount
		const default_method = this.payment_methods.find((m) => m.type === "Cash") || this.payment_methods[0];
		if (default_method) {
			this.payment_lines.push({
				mode_of_payment: default_method.mode_of_payment,
				icon: default_method.icon || "💵",
				amount: order.grand_total,
			});
			this.active_method = default_method.mode_of_payment;
		}

		this.render_dialog();
	}

	// ─── Dialog ──────────────────────────────────────────────────────────────

	render_dialog() {
		if (this.dialog) {
			this.dialog.hide();
			$(this.dialog.wrapper).remove();
		}

		this.dialog = new frappe.ui.Dialog({
			title: __("Payment"),
			size: "large",
			indicator: "green",
		});

		// Remove default footer buttons — we manage our own
		$(this.dialog.wrapper).find(".modal-footer").hide();

		const body = $(this.dialog.wrapper).find(".modal-body");
		body.css({ padding: 0 });
		body.html(this.get_payment_html());

		this.$dlg       = $(this.dialog.wrapper).find(".fpos-payment-panel");
		this.$methods   = this.$dlg.find(".fpos-pay-methods");
		this.$lines     = this.$dlg.find(".fpos-pay-lines");
		this.$numpad    = this.$dlg.find(".fpos-numpad");
		this.$remaining = this.$dlg.find(".fpos-remaining-val");
		this.$change    = this.$dlg.find(".fpos-change-row");

		this.render_payment_methods();
		this.render_payment_lines();
		this.update_remaining();
		this.bind_dialog_events();

		this.dialog.show();
	}

	get_payment_html() {
		const fmt  = (v) => format_currency(v, frappe.defaults.get_default("currency"));
		const order = this.order;

		return `
		<div class="fpos-payment-panel">
			<!-- Left: order summary + payment lines -->
			<div class="fpos-pay-left">
				<!-- Order summary strip -->
				<div class="fpos-pay-summary">
					<div class="fpos-pay-summary-row">
						<span>${__("Order Total")}</span>
						<span class="fpos-pay-order-total">${fmt(order.grand_total)}</span>
					</div>
					${order.discount_amount > 0 ? `
					<div class="fpos-pay-summary-row fpos-negative">
						<span>${__("Discount")}</span>
						<span>− ${fmt(order.discount_amount)}</span>
					</div>` : ""}
					${order.tax_amount > 0 ? `
					<div class="fpos-pay-summary-row">
						<span>${__("Tax")}</span>
						<span>${fmt(order.tax_amount)}</span>
					</div>` : ""}
					<div class="fpos-pay-summary-row fpos-pay-grand">
						<span>${__("Amount Due")}</span>
						<span class="fpos-pay-due">${fmt(order.grand_total)}</span>
					</div>
				</div>

				<!-- Payment method pills -->
				<div class="fpos-pay-methods-label">${__("Payment Method")}</div>
				<div class="fpos-pay-methods"></div>

				<!-- Payment lines (split) -->
				<div class="fpos-pay-lines-label">${__("Payment Details")}</div>
				<div class="fpos-pay-lines"></div>

				<!-- Remaining / change -->
				<div class="fpos-pay-remaining">
					<div class="fpos-remaining-row">
						<span>${__("Remaining")}</span>
						<span class="fpos-remaining-val fpos-negative">—</span>
					</div>
					<div class="fpos-change-row" style="display:none;">
						<span>${__("Change")}</span>
						<span class="fpos-change-val">—</span>
					</div>
				</div>

				<!-- Action buttons -->
				<div class="fpos-pay-actions">
					<button class="fpos-btn fpos-btn-secondary fpos-pay-cancel-btn">
						${__("Cancel")}
					</button>
					<button class="fpos-btn fpos-btn-primary fpos-pay-confirm-btn" disabled>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="20 6 9 17 4 12"/>
						</svg>
						${__("Confirm Payment")}
					</button>
				</div>
			</div>

			<!-- Right: numpad -->
			<div class="fpos-pay-right">
				<div class="fpos-numpad-label">${__("Enter Amount")}</div>
				<div class="fpos-numpad-display">
					<span class="fpos-numpad-currency">${frappe.defaults.get_default("currency") || ""}</span>
					<span class="fpos-numpad-val">0</span>
				</div>
				<div class="fpos-numpad">
					${this.get_numpad_html()}
				</div>
				<div class="fpos-quick-amounts"></div>
			</div>
		</div>`;
	}

	get_numpad_html() {
		const keys = [
			"7","8","9",
			"4","5","6",
			"1","2","3",
			".","0","⌫",
		];
		return keys.map((k) => `
			<button class="fpos-num-key" data-key="${k}">${k === "⌫"
				? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2z"/>
					<line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
				   </svg>`
				: k}
			</button>
		`).join("");
	}

	// ─── Render helpers ──────────────────────────────────────────────────────

	render_payment_methods() {
		this.$methods.empty();

		this.payment_methods.forEach((m) => {
			const active = m.mode_of_payment === this.active_method ? "active" : "";
			this.$methods.append(`
				<button class="fpos-pay-method-pill ${active}" data-method="${m.mode_of_payment}">
					<span class="fpos-method-icon">${m.icon || "💳"}</span>
					<span>${__(m.mode_of_payment)}</span>
				</button>
			`);
		});

		// Quick amounts for cash
		this.render_quick_amounts();
	}

	render_quick_amounts() {
		const $qa = this.$dlg.find(".fpos-quick-amounts");
		$qa.empty();

		const is_cash = this.active_method === "Cash" || (this.payment_methods.find(
			(m) => m.mode_of_payment === this.active_method)?.type === "Cash");

		if (!is_cash) return;

		const due = this.order.grand_total;
		const suggestions = this.get_round_amounts(due);
		suggestions.forEach((amt) => {
			$qa.append(`
				<button class="fpos-quick-amt" data-amt="${amt}">
					${format_currency(amt, frappe.defaults.get_default("currency"))}
				</button>
			`);
		});
	}

	get_round_amounts(amount) {
		const amts = new Set();
		amts.add(amount); // exact

		const bases = [10, 20, 50, 100, 200, 500, 1000];
		for (const base of bases) {
			const rounded = Math.ceil(amount / base) * base;
			if (rounded >= amount) amts.add(rounded);
			if (amts.size >= 5) break;
		}
		return [...amts].sort((a, b) => a - b).slice(0, 5);
	}

	render_payment_lines() {
		this.$lines.empty();

		this.payment_lines.forEach((line, idx) => {
			const fmt = (v) => format_currency(v, frappe.defaults.get_default("currency"));
			const is_active = line.mode_of_payment === this.numpad_target;

			this.$lines.append(`
				<div class="fpos-pay-line ${is_active ? "fpos-pay-line-active" : ""}" data-idx="${idx}">
					<div class="fpos-pay-line-method">
						<span class="fpos-method-icon">${line.icon || "💳"}</span>
						<span>${__(line.mode_of_payment)}</span>
					</div>
					<div class="fpos-pay-line-amount-wrap">
						<span class="fpos-pay-line-amount">${fmt(line.amount)}</span>
						${this.payment_lines.length > 1 ? `
							<button class="fpos-pay-line-remove" data-idx="${idx}" title="${__("Remove")}">✕</button>
						` : ""}
					</div>
				</div>
			`);
		});

		// "Add another payment method" link when split is possible
		if (this.payment_lines.length < this.payment_methods.length) {
			const remaining = this.get_remaining();
			if (remaining > 0) {
				this.$lines.append(`
					<button class="fpos-add-split-btn">
						+ ${__("Split with another method")}
					</button>
				`);
			}
		}
	}

	update_remaining() {
		const paid      = this.payment_lines.reduce((s, l) => s + (l.amount || 0), 0);
		const due       = this.order.grand_total;
		const remaining = due - paid;
		const change    = paid - due;

		const fmt = (v) => format_currency(Math.abs(v), frappe.defaults.get_default("currency"));

		if (remaining > 0.001) {
			this.$remaining.text(`− ${fmt(remaining)}`).removeClass("fpos-positive");
			this.$change.hide();
			this.$dlg.find(".fpos-pay-confirm-btn").prop("disabled", true);
		} else {
			this.$remaining.text(__("Paid")).addClass("fpos-positive");
			if (change > 0.001) {
				this.$change.show().find(".fpos-change-val").text(fmt(change));
			} else {
				this.$change.hide();
			}
			this.$dlg.find(".fpos-pay-confirm-btn").prop("disabled", false);
		}

		// Update numpad display to show current line amount
		const active_line = this.payment_lines.find((l) => l.mode_of_payment === this.numpad_target);
		if (active_line) {
			this.$dlg.find(".fpos-numpad-val").text(active_line.amount || 0);
		}
	}

	get_remaining() {
		const paid = this.payment_lines.reduce((s, l) => s + (l.amount || 0), 0);
		return Math.max(0, this.order.grand_total - paid);
	}

	// ─── Numpad logic ────────────────────────────────────────────────────────

	numpad_input(key) {
		const $display = this.$dlg.find(".fpos-numpad-val");
		let current    = $display.text();

		if (key === "⌫") {
			current = current.length > 1 ? current.slice(0, -1) : "0";
		} else if (key === ".") {
			if (current.includes(".")) return;
			current += ".";
		} else {
			current = current === "0" ? key : current + key;
			// Prevent more than 2 decimal places
			const parts = current.split(".");
			if (parts[1] && parts[1].length > 2) return;
		}

		$display.text(current);

		// Apply to active payment line
		if (this.numpad_target) {
			const line = this.payment_lines.find((l) => l.mode_of_payment === this.numpad_target);
			if (line) {
				line.amount = parseFloat(current) || 0;
				this.render_payment_lines();
				this.update_remaining();
			}
		}
	}

	// ─── Bind events ─────────────────────────────────────────────────────────

	bind_dialog_events() {
		const me = this;

		// Method pill click → set active, add line or switch
		this.$dlg.on("click", ".fpos-pay-method-pill", function () {
			const method = $(this).data("method");
			me.active_method = method;
			me.$methods.find(".fpos-pay-method-pill").removeClass("active");
			$(this).addClass("active");

			// If method already in lines, set as numpad target
			const existing = me.payment_lines.find((l) => l.mode_of_payment === method);
			if (existing) {
				me.numpad_target = method;
			} else {
				// Replace the last line with remaining if only one line, else add new
				if (me.payment_lines.length === 1) {
					const m = me.payment_methods.find((pm) => pm.mode_of_payment === method);
					me.payment_lines[0] = {
						mode_of_payment: method,
						icon: m?.icon || "💳",
						amount: me.order.grand_total,
					};
					me.numpad_target = method;
				}
			}

			me.render_payment_lines();
			me.update_remaining();
			me.render_quick_amounts();

			// Reset numpad display to active line amount
			const line = me.payment_lines.find((l) => l.mode_of_payment === method);
			if (line) {
				me.$dlg.find(".fpos-numpad-val").text(line.amount || 0);
			}
		});

		// Payment line click → set numpad target
		this.$dlg.on("click", ".fpos-pay-line", function () {
			const idx = parseInt($(this).data("idx"));
			me.numpad_target = me.payment_lines[idx]?.mode_of_payment;
			me.$dlg.find(".fpos-numpad-val").text(me.payment_lines[idx]?.amount || 0);
			me.render_payment_lines();
		});

		// Remove a split line
		this.$dlg.on("click", ".fpos-pay-line-remove", function (e) {
			e.stopPropagation();
			const idx = parseInt($(this).data("idx"));
			me.payment_lines.splice(idx, 1);
			// Re-assign remaining to first line
			if (me.payment_lines.length === 1) {
				me.payment_lines[0].amount = me.order.grand_total;
			}
			me.numpad_target = me.payment_lines[0]?.mode_of_payment;
			me.render_payment_lines();
			me.update_remaining();
		});

		// Add split button
		this.$dlg.on("click", ".fpos-add-split-btn", () => {
			const used = this.payment_lines.map((l) => l.mode_of_payment);
			const available = this.payment_methods.filter((m) => !used.includes(m.mode_of_payment));
			if (!available.length) return;

			const remaining = this.get_remaining();
			const next = available[0];
			this.payment_lines.push({
				mode_of_payment: next.mode_of_payment,
				icon: next.icon || "💳",
				amount: remaining,
			});
			this.numpad_target = next.mode_of_payment;
			this.$dlg.find(".fpos-numpad-val").text(remaining);
			this.render_payment_lines();
			this.update_remaining();
		});

		// Numpad keys
		this.$numpad.on("click", ".fpos-num-key", function () {
			me.numpad_input($(this).data("key"));
		});

		// Quick amounts
		this.$dlg.on("click", ".fpos-quick-amt", function () {
			const amt  = parseFloat($(this).data("amt"));
			const line = me.payment_lines.find((l) => l.mode_of_payment === me.numpad_target);
			if (line) {
				line.amount = amt;
				me.$dlg.find(".fpos-numpad-val").text(amt);
				me.render_payment_lines();
				me.update_remaining();
			}
		});

		// Cancel
		this.$dlg.find(".fpos-pay-cancel-btn").on("click", () => {
			this.dialog.hide();
		});

		// Confirm payment
		this.$dlg.find(".fpos-pay-confirm-btn").on("click", () => {
			this.confirm_payment();
		});
	}

	// ─── Confirm and post invoice ─────────────────────────────────────────────

	async confirm_payment() {
		const btn = this.$dlg.find(".fpos-pay-confirm-btn");
		btn.prop("disabled", true).text(__("Processing..."));

		try {
			const paid = this.payment_lines.reduce((s, l) => s + (l.amount || 0), 0);
			const change = Math.max(0, paid - this.order.grand_total);

			// Adjust cash line by subtracting change
			const cash_line = this.payment_lines.find((l) => {
				const m = this.payment_methods.find((pm) => pm.mode_of_payment === l.mode_of_payment);
				return m?.type === "Cash";
			});
			if (cash_line && change > 0) {
				cash_line.amount = Math.max(0, cash_line.amount - change);
			}

			const res = await frappe.call({
				method: "foodpos.foodpos.api.food_pos.create_pos_invoice",
				args: {
					order:    JSON.stringify(this.order),
					payments: JSON.stringify(this.payment_lines),
				},
			});

			if (res.message && res.message.invoice) {
				frappe.show_alert({ message: __("Payment recorded successfully"), indicator: "green" });
				this.dialog.hide();
				this.print_receipt(res.message.invoice, change);
				this.events.on_payment_success && this.events.on_payment_success(res.message);
			} else {
				throw new Error(res.message?.error || __("Unknown error"));
			}
		} catch (err) {
			frappe.show_alert({ message: err.message || __("Payment failed"), indicator: "red" });
			btn.prop("disabled", false).html(`
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<polyline points="20 6 9 17 4 12"/>
				</svg>
				${__("Confirm Payment")}
			`);
		}
	}

	print_receipt(invoice_name, change) {
		const d = new frappe.ui.Dialog({
			title: __("Receipt"),
			size: "small",
			fields: [],
		});

		const fmt = (v) => format_currency(v, frappe.defaults.get_default("currency"));
		const body = $(d.wrapper).find(".modal-body");
		body.html(`
			<div class="fpos-receipt">
				<div class="fpos-receipt-header">
					<div class="fpos-receipt-logo">🍽️</div>
					<h3>${frappe.defaults.get_default("company") || __("Restaurant")}</h3>
					<p>${frappe.datetime.now_datetime()}</p>
					<p><strong>${__("Invoice #")}</strong> ${invoice_name}</p>
				</div>
				<hr/>
				<table class="fpos-receipt-items">
					${this.order.items.map((i) => `
						<tr>
							<td>${i.item_name}</td>
							<td class="right">${i.qty} × ${fmt(i.rate)}</td>
							<td class="right">${fmt(i.amount)}</td>
						</tr>
					`).join("")}
				</table>
				<hr/>
				<div class="fpos-receipt-totals">
					<div class="receipt-row"><span>${__("Subtotal")}</span><span>${fmt(this.order.subtotal)}</span></div>
					${this.order.discount_amount > 0
						? `<div class="receipt-row"><span>${__("Discount")}</span><span>− ${fmt(this.order.discount_amount)}</span></div>`
						: ""}
					${this.order.tax_amount > 0
						? `<div class="receipt-row"><span>${__("Tax")}</span><span>${fmt(this.order.tax_amount)}</span></div>`
						: ""}
					<div class="receipt-row receipt-total">
						<strong>${__("Total")}</strong><strong>${fmt(this.order.grand_total)}</strong>
					</div>
					${change > 0
						? `<div class="receipt-row"><span>${__("Change")}</span><span>${fmt(change)}</span></div>`
						: ""}
				</div>
				<hr/>
				<div class="fpos-receipt-footer">
					<p>${__("Thank you for dining with us!")}</p>
					<p>⭐⭐⭐⭐⭐</p>
				</div>
			</div>
		`);

		$(d.wrapper).find(".modal-footer").html(`
			<button class="btn btn-primary fpos-print-btn">${__("Print")}</button>
			<button class="btn btn-default fpos-close-receipt-btn">${__("Close")}</button>
		`);

		$(d.wrapper).find(".fpos-print-btn").on("click", () => {
			frappe.utils.print("POS Invoice", invoice_name, null, null, null);
		});
		$(d.wrapper).find(".fpos-close-receipt-btn").on("click", () => d.hide());

		d.show();
	}
};
