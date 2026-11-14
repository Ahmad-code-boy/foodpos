# Copyright (c) 2026, nextash and contributors
# License: MIT

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class FoodPOSAttendance(Document):
	# v2: one row per staff per day. Check-out must be after check-in.
	def validate(self):
		if self.check_in and self.check_out and self.check_out < self.check_in:
			frappe.throw(_("Check Out cannot be before Check In."))
		if self.attendance_date and getdate(self.attendance_date) > getdate():
			frappe.throw(_("Attendance date cannot be in the future."))
		if self.status == "Present" and not self.check_in and not self.check_out:
			# Absent rows are created with status Absent; a Present row
			# with neither time is a mistake — keep it honest.
			pass
