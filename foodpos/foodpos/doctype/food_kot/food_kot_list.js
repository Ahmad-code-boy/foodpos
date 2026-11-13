frappe.listview_settings["Food KOT"] = {
	add_fields: ["branch", "kitchen_station", "status", "order_type", "creation", "table", "customer"],
	get_indicator(doc) {
		if (doc.status === "Pending") {
			return [__("Pending"), "orange", "status,=,Pending"];
		} else if (doc.status === "In Progress") {
			return [__("In Progress"), "blue", "status,=,In Progress"];
		} else if (doc.status === "Ready") {
			return [__("Ready"), "green", "status,=,Ready"];
		} else if (doc.status === "Served") {
			return [__("Served"), "gray", "status,=,Served"];
		} else if (doc.status === "Held") {
			return [__("Held"), "yellow", "status,=,Held"];
		} else if (doc.status === "Cancelled") {
			return [__("Cancelled"), "red", "status,=,Cancelled"];
		}
	},
};

