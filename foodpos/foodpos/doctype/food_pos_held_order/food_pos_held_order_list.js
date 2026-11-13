frappe.listview_settings["Food POS Held Order"] = {
	add_fields: ["status", "branch", "table", "cashier", "grand_total", "hold_reason", "order_type", "creation"],
	get_indicator(doc) {
		const colors = {
			Held: "orange",
			Resumed: "green",
			Discarded: "red"
		};
		return [__(doc.status), colors[doc.status] || "grey", "status,=," + doc.status];
	}
};
