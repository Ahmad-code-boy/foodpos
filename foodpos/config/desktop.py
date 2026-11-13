# Copyright (c) 2026, nextash and contributors
# License: MIT

from frappe import _


def get_data():
	return [
		{
			"module_name": "Foodpos",
			"color":       "#f97316",
			"icon":        "octicon octicon-device-camera-video",
			"type":        "module",
			"label":       _("Food POS"),
		}
	]
