// Copyright (c) 2026, Nextash and contributors
// For license information, please see license.txt

frappe.query_reports["Served KOT Exception List"] = {
	"title": __("Served KOT Exception List"),
	"page_title": __("Served KOT Exception List"),
	"report_name": "Served KOT Exception List",
	"filters": [
		{
			"fieldname": "branch",
			"label": __("Branch"),
			"fieldtype": "Link",
			"options": "Branch",
		}
	],
	"onload": function(report) {
		report.page.set_title(__("Served KOT Exception List"), null, true, __("Served KOT Exception List"));
		if (frappe.utils && frappe.utils.set_title) {
			frappe.utils.set_title(__("Served KOT Exception List"));
		}
		document.title = __("Served KOT Exception List");
	},
	"formatter": function(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "status") {
			return `<span style="background:#fee2e2;color:#b91c1c;padding:3px 8px;border-radius:12px;font-weight:700;font-size:11px;">${value}</span>`;
		}
		if (column.fieldname === "estimated_total") {
			return `<b style="color:#ea580c;">${value}</b>`;
		}
		return value;
	}
};
