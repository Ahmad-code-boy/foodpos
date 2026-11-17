# Copyright (c) 2026, nextash and contributors
# License: MIT

"""Patch v7.2.0: top up the seed Restaurant Tables once, during migrate.

Table layout is site business data. The table screen used to top this up on
every read; that write now happens here, and only once per site.
"""

from foodpos.patches.v0_4_0.add_seed_data import _ensure_tables


def execute():
	_ensure_tables()
