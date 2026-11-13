__version__ = "0.0.1"


def _patch_pos_closing_entry():
	try:
		from erpnext.accounts.doctype.pos_closing_entry.pos_closing_entry import POSClosingEntry
		_orig_get = POSClosingEntry.get

		def _custom_get(self, key, *args, **kwargs):
			if key == "pos_transactions":
				return self.__dict__.get("pos_transactions") or self.__dict__.get("sales_invoices") or self.__dict__.get("pos_invoices") or []
			return _orig_get(self, key, *args, **kwargs)

		POSClosingEntry.get = _custom_get
		POSClosingEntry.pos_transactions = property(lambda self: self.get("pos_transactions"))
	except Exception:
		pass


_patch_pos_closing_entry()
