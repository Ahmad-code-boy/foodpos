// Copyright (c) 2026, Nextash and contributors
// For license information, please see license.txt

frappe.ui.form.on("Food POS Held Order", {
	refresh(frm) {
		const colors = {
			Held: "orange",
			Resumed: "green",
			Discarded: "red"
		};
		if (frm.doc.status) {
			frm.page.set_indicator(__(frm.doc.status), colors[frm.doc.status] || "grey");
		}
	}
});
