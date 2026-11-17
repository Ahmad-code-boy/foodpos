# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Automatic kitchen ticket printing for Food POS.

Every Food KOT item row carries ``kitchen_print_state``:

* ``Pending``  - not on paper yet
* ``Printing`` - claimed by a request that is sending it now
* ``Printed``  - the kitchen printer accepted it

A confirmed order claims its Pending rows inside the request transaction
(``SELECT ... FOR UPDATE``), so a double-tap or a retried request cannot claim
the same rows twice. The printer call runs after the transaction commits. If
the printer call fails, the rows go back to Pending and the error is stored on
the KOT, so "Retry" prints only what is still missing.

Printing goes through CUPS (``lp``) to the Network Printer Settings record that
the POS Profile names as its kitchen printer. The receipt is plain text.
"""

import os
import shutil
import subprocess
import tempfile

import frappe
from frappe import _
from frappe.utils import format_datetime, now_datetime

PENDING = "Pending"
PRINTING = "Printing"
PRINTED = "Printed"

LINE_WIDTH = 42
LP_TIMEOUT_SECONDS = 20
ESC_INIT = b"\x1b\x40"
CUT = b"\n\n\n\n\x1d\x56\x42\x00"


class KitchenPrintError(Exception):
	"""The ticket could not be sent to the kitchen printer."""


def claim_pending_items(kot_names):
	"""Claim the unprinted item rows of these KOTs for printing.

	Runs inside the caller's transaction. Returns {kot_name: [row dict, ...]}
	for the rows this request now owns (empty when everything was printed).
	"""
	kot_names = sorted({k for k in kot_names if k})
	if not kot_names:
		return {}

	placeholders = ", ".join(["%s"] * len(kot_names))
	locked = frappe.db.sql(
		f"""
		SELECT name, parent FROM `tabFood KOT Item`
		WHERE parenttype = 'Food KOT' AND parent IN ({placeholders})
		  AND kitchen_print_state = %s
		ORDER BY parent, idx
		FOR UPDATE
		""",
		(*kot_names, PENDING),
	)
	if not locked:
		return {}

	row_names = [r[0] for r in locked]
	frappe.db.sql(
		"UPDATE `tabFood KOT Item` SET kitchen_print_state = %s WHERE name IN ({})".format(
			", ".join(["%s"] * len(row_names))
		),
		(PRINTING, *row_names),
	)

	rows = frappe.get_all(
		"Food KOT Item",
		filters={"name": ["in", row_names]},
		fields=["name", "parent", "item_code", "item_name", "qty", "item_note"],
		order_by="parent asc, idx asc",
	)
	claims = {}
	for row in rows:
		claims.setdefault(row.parent, []).append(row)
	return claims


def _set_item_state(row_names, state):
	if not row_names:
		return
	frappe.db.sql(
		"UPDATE `tabFood KOT Item` SET kitchen_print_state = %s WHERE name IN ({})".format(
			", ".join(["%s"] * len(row_names))
		),
		(state, *row_names),
	)


def _ascii(text):
	"""Thermal printers in raw mode handle plain ASCII reliably."""
	return str(text or "").encode("ascii", "replace").decode("ascii")


def _wrap(text, indent=""):
	words = _ascii(text).split()
	lines, line = [], ""
	for word in words:
		candidate = f"{line} {word}".strip()
		if len(indent) + len(candidate) > LINE_WIDTH:
			if line:
				lines.append(indent + line)
			line = word
		else:
			line = candidate
	if line:
		lines.append(indent + line)
	return lines


def build_ticket(kot_name, rows):
	"""Plain-text kitchen ticket for these item rows (ESC/POS init + cut)."""
	kot = frappe.db.get_value(
		"Food KOT", kot_name,
		["table", "order_type", "order_note", "kitchen_station", "creation", "owner"],
		as_dict=True,
	)
	table_label = ""
	if kot.table:
		table_label = frappe.db.get_value("Restaurant Table", kot.table, "table_no") or kot.table
	station = kot.kitchen_station or ""
	if station and "-" in station:
		station = station.split("-", 1)[1]

	rule = "-" * LINE_WIDTH
	lines = [
		"KITCHEN TICKET".center(LINE_WIDTH),
		rule,
		f"KOT: {kot_name}",
		f"Type: {kot.order_type or ''}" + (f"   Table: {table_label}" if table_label else ""),
		f"Station: {station or 'Kitchen'}",
		f"Time: {format_datetime(kot.creation or now_datetime(), 'dd-MMM-yyyy HH:mm')}",
		rule,
	]
	for row in rows:
		qty = int(row.qty) if float(row.qty or 0).is_integer() else row.qty
		lines.extend(_wrap(f"{qty} x {row.item_name or row.item_code}".upper()))
		if row.item_note:
			lines.extend(_wrap(f"NOTE: {row.item_note}", indent="    "))
	if kot.order_note:
		lines.append(rule)
		lines.extend(_wrap(f"ORDER NOTE: {kot.order_note}"))
	lines.append(rule)

	body = "\n".join(_ascii(line) for line in lines) + "\n"
	return ESC_INIT + body.encode("ascii") + CUT


def _printer_for_profile(pos_profile):
	printer_name = frappe.db.get_value("POS Profile", pos_profile, "custom_fpos_kitchen_printer") if pos_profile else None
	if not printer_name:
		raise KitchenPrintError(_("No kitchen printer is set for this POS profile."))
	settings = frappe.db.get_value(
		"Network Printer Settings", printer_name, ["server_ip", "port", "printer_name"], as_dict=True,
	)
	if not settings or not settings.printer_name:
		raise KitchenPrintError(_("The kitchen printer {0} has no printer name.").format(printer_name))
	return settings


def send_ticket(settings, kot_name, data):
	"""Send raw bytes to the CUPS queue named in the printer settings."""
	lp = shutil.which("lp")
	if not lp:
		raise KitchenPrintError(_("The print client (lp) is not installed on the server."))

	host = settings.server_ip or "127.0.0.1"
	port = int(settings.port or 631)
	fd, path = tempfile.mkstemp(prefix="fpos-kot-", suffix=".txt")
	try:
		with os.fdopen(fd, "wb") as f:
			f.write(data)
		cmd = [lp, "-h", f"{host}:{port}", "-d", settings.printer_name,
			"-o", "raw", "-t", f"KOT {kot_name}", path]
		try:
			result = subprocess.run(cmd, capture_output=True, timeout=LP_TIMEOUT_SECONDS)
		except subprocess.TimeoutExpired:
			raise KitchenPrintError(_("The kitchen printer did not respond in time."))
		if result.returncode != 0:
			detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
			raise KitchenPrintError(_("The kitchen printer rejected the ticket: {0}").format(detail or "unknown error"))
	finally:
		try:
			os.remove(path)
		except OSError:
			pass


def print_claimed(claims):
	"""Print each claimed group. Runs after commit; updates states and notifies the cashier."""
	for kot_name, rows in claims.items():
		row_names = [r.name for r in rows]
		try:
			settings = _printer_for_profile(
				frappe.db.get_value("Food KOT", kot_name, "pos_profile")
			)
			send_ticket(settings, kot_name, build_ticket(kot_name, rows))
		except Exception as exc:
			message = str(exc) if isinstance(exc, KitchenPrintError) else _("Unexpected printer error.")
			_set_item_state(row_names, PENDING)
			frappe.db.set_value("Food KOT", kot_name, "kitchen_print_error", message[:140], update_modified=False)
			if not isinstance(exc, KitchenPrintError):
				frappe.log_error(frappe.get_traceback(), f"Kitchen print failed for {kot_name}")
			_notify(kot_name, "Failed", message)
		else:
			_set_item_state(row_names, PRINTED)
			frappe.db.set_value("Food KOT", kot_name, "kitchen_print_error", None, update_modified=False)
			_notify(kot_name, "Printed", None)


def _print_and_save(claims):
	"""After-commit callback: print, then persist the outcome."""
	print_claimed(claims)
	frappe.db.commit()


def schedule_print(claims):
	"""Print the claimed tickets once the current transaction has committed."""
	if claims:
		frappe.db.after_commit.add(lambda: _print_and_save(claims))


def retry_print(kot_name):
	"""Print whatever is still Pending on this KOT (after a printer failure)."""
	claims = claim_pending_items([kot_name])
	if not claims:
		return {"status": "Printed", "error": None, "printed_rows": 0}
	frappe.db.commit()  # claims must be visible before the printer call
	_print_and_save(claims)
	error = frappe.db.get_value("Food KOT", kot_name, "kitchen_print_error")
	return {"status": "Failed" if error else "Printed", "error": error, "printed_rows": sum(len(v) for v in claims.values())}


def _notify(kot_name, status, error):
	frappe.publish_realtime(
		"fpos_kitchen_print",
		{"kot": kot_name, "status": status, "error": error},
		user=frappe.session.user,
	)
