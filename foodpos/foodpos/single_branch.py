# Food POS v2 — single-branch constants (single source of truth).
#
# v1 ran three branches (Branch 1 - Gulberg / Branch 2 - DHA /
# Branch 3 - Mall Road) with a per-branch naming-series map, branch
# User-Permission filtering, a branch selector dialog and branch-scoped
# manager PINs. v2 runs ONE branch only.
#
# The old branch *columns/fields* (``custom_branch`` on POS Profile /
# Sales Invoice / POS Invoice, ``branch`` on Food KOT, Restaurant Table,
# Food POS Held Order, Food POS Audit Log, Food Kitchen Station and
# Food POS Manager PIN) are deliberately KEPT in the DocTypes so existing
# data and migrations keep working. They are no longer used for
# selection, filtering, naming series or PIN scoping: every new document
# is stamped with ``SINGLE_BRANCH`` and every lookup ignores the branch.
"""Single-branch configuration for Food POS v2."""

SINGLE_BRANCH = "Main Branch"

# The one and only invoice naming series in v2. v1 used BR1/BR2/BR3 per
# branch; v2 keeps the BR1 series so invoice numbers continue from the
# existing sequence instead of restarting under a new prefix.
SINGLE_NAMING_SERIES = "BR1-.YYYY.-"

# Canonical order types (single source of truth — the client JS mirrors
# these exact strings; do not rename one side without the other).
ORDER_TYPES = ("Dine In", "Walk In", "Takeaway", "Delivery")
# Backwards-compatible alias used by older carts ("Take Away" in the
# reference screenshots). Normalised to "Takeaway" on the server.
ORDER_TYPE_ALIASES = {"Take Away": "Takeaway", "Dine-In": "Dine In", "Walk-In": "Walk In"}

# Canonical table statuses (Restaurant Table.status).
TABLE_STATUSES = ("Available", "Occupied", "Reserved", "Cleaning")

# Canonical KOT stages.
KOT_STAGES = ("Pending", "In Progress", "Ready", "Served")


def normalise_order_type(order_type):
    """Return the canonical order type for any accepted spelling."""
    value = (order_type or "Dine In").strip()
    if value in ORDER_TYPE_ALIASES:
        return ORDER_TYPE_ALIASES[value]
    return value if value in ORDER_TYPES else "Dine In"


def single_branch_value():
    """Return the fixed branch label stamped on new documents."""
    return SINGLE_BRANCH
