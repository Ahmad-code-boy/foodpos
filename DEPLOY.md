# DEPLOY — Food POS v7.2 audit fixes (branch `fix/audit-round-2`)

Not yet committed to `main`. Changes are in the working tree of branch
`fix/audit-round-2`, based on `46212a7`.

## What changed

- **Table status works again.** The POS endpoint `update_table_status` took
  `(table, status)` while the screens send named fields, so every table update
  failed and was reported as success. One endpoint now serves the UI payload
  (`services/tables.py`); the duplicate proxy is gone.
- **Every whitelisted POS endpoint requires a POS role.** The roles are the
  ones on the Food POS page (`services/access.py`). Voiding an invoice and
  settling unpaid invoices also require a manager role (Food POS Manager,
  Branch Manager, Accounts Manager, System Manager). This is a policy change.
- **Unpaid invoices are no longer auto-settled.** The old code ran on every
  POS load and marked invoices Paid with a fabricated Cash row and no ledger
  entry. The background call is removed. `get_unpaid_pos_invoices` is read-only;
  `settle_unpaid_pos_invoices` (manager only) creates ERPNext Payment Entries,
  one savepoint per invoice.
- **Shift handling never closes silently.** A previous-day shift is closed
  through the POS Closing Entry flow in a savepoint, or the operation raises.
  Opening a shift is one implementation (`services/opening.py`) for both the
  page and the API.
- **Transactions.** Removed the mid-request `frappe.db.commit()` calls; Frappe
  commits once per successful request. Savepoints are used where a failed step
  must not leave partial writes. The scheduled KOT job still commits (Frappe
  commits after each scheduled job).
- **KOT ledger lock.** The KOT-to-invoice link used to set `docstatus=1` with
  raw SQL, skipping `on_submit`. It now saves and submits through the
  controller. The KOT status rule is one function (`check_status_change`).
- **Schema at migrate, not per request.** Custom Fields and seed tables are
  created by patches `v7_2_0/ensure_pos_custom_fields` and
  `v7_2_0/ensure_seed_tables`. The request path no longer runs DDL.
- **Restaurant Table is no longer a fixture.** Table layout and live status
  are site data. `seed_demo_tables` and the seed patch create tables.
- **Realtime events fire after commit** (`after_commit=True`).
- **Lint and tests.** Unused imports and variables removed. The foodpos test
  suite passes (66/66) on `foodpos-test.local`. New tests are in
  `services/test_pos_services.py`.

## Ownership

- **Git (repository):** Python and JS under `foodpos/`, `patches.txt`,
  `hooks.py`. No DocType JSON changed.
- **Database (site):** `migrate` adds missing Custom Fields and tops up seed
  tables to 8. Existing Restaurant Table and KOT rows are not changed.
- **Not changed:** POS Closing Entry, POS Opening Entry and Sales Invoice
  records; no KOT or invoice is deleted or re-linked.

## Deploy steps

1. Backup: `bench --site pos.local backup --with-files`
   (taken on 2026-11-17 for this work: `20261117_172004`).
2. Check out branch `fix/audit-round-2` in `apps/foodpos`, then commit.
3. `bench --site pos.local migrate` (runs the two v7.2 patches).
4. `bench restart` and `bench --site pos.local clear-cache`.
5. Verify: sign in as a POS user, open Food POS, set a table to Reserved and
   back, Confirm an order, and check the Error Log for new entries.

Rollback: `git checkout 46212a7` in `apps/foodpos`, then restore the backup
(`bench --site pos.local restore <database.sql.gz> --with-public-files
<files.tar> --with-private-files <private.tar>`). Migrations are additive,
so a rollback without a restore also works for the code.

Test site: `foodpos-test.local` (own MariaDB on `127.0.0.1:3307`, data in
`sites/.foodpos-validation`). Test runs use `allow_tests=1`.

## Residual risks (not closed here)

- Read endpoints (`get_kitchen_orders`, `get_held_orders`, etc.) still return
  an empty list on error after logging. The kitchen screen polls them.
- Some writes still bypass permissions: audit logs, walk-in customer, kitchen
  station master, Food Table Merge, staff attendance, and the KOT link step.
  POS roles have no create right on those DocTypes. Adding those rights is a
  DocType permission decision.
- The browser UI was not click-tested. The smoke flow (tables, KOT, transfer,
  hold, kitchen status, role refusal) passed on the test site through the same
  endpoints. Invoice settlement and shift closing need an ERPNext company and
  chart of accounts, which the test site does not have, so they are covered
  only by code review.
- Many older test stubs in `api/test_food_pos.py` still contain `pass`.

---

# DEPLOY — Food POS Round 23 fix (KOT mis-linking + PIN/pricing holes)

Source: this working copy, based on branch `develop` HEAD `4a7c7eb`
( foodpos.zip shared by the owner, 12 Nov 2026 ).
Full analysis: `~/workspace/your_files/food-pos-code-analysis-round23.md`
Full code report of this fix: ask the assistant for the Round 24 report
(the fix is also summarised at the end of this file).

> **Do NOT deploy by copying only one file.** The fix spans the DocType
> JSON, two Python modules, one JS file and a patch. Copy the whole app
> directory, then run the steps below in order. Nothing here touches the
> database records (no KOT / invoice is deleted or re-linked).

## 0. Before you start

- Make a bench backup first: `bench --site <site> backup`
  (bench-16's site is the local site behind the ngrok tunnel).
- Make sure you are on branch `develop` and the working tree is clean
  (`git status`). Commit this fix as its own commit after copying, e.g.
  `git add -A && git commit -m "fix(kot): order_id identity, order-only settle linking, PIN/pricing hardening (Round 23)"`
- Keep the ngrok tunnel URL unchanged so the audit can re-test on the
  same URL.

## 1. Copy the fixed app onto bench-16

```bash
# on the bench-16 machine, from the bench's apps folder:
cp -a /path/to/foodpos-fixed/foodpos/*  ~/frappe-bench/apps/foodpos/foodpos/
cp -a /path/to/foodpos-fixed/foodpos/patches.txt ~/frappe-bench/apps/foodpos/foodpos/patches.txt
cp -a /path/to/foodpos-fixed/foodpos/patches/v0_2_0/add_order_id_index_to_food_kot.py \
      ~/frappe-bench/apps/foodpos/foodpos/patches/v0_2_0/
# (the app root files README.md / pyproject.toml / license.txt are unchanged)
```

Files changed (8 total):
- `foodpos/doctype/food_kot/food_kot.json` — new `order_id` field
- `foodpos/doctype/food_kot/food_kot.py` — validate() now also enforces
  order→invoice consistency; the 1:1 guard now allows several KOTs of
  the SAME order to share one invoice, but never KOTs of another order
- `foodpos/page/food_pos/food_pos.py` — order_id helpers, create_kot
  reuse, order-only settle linking, item-match check, exception
  mismatch rule, server re-pricing, fresh-PIN discount, PIN lockout,
  no any-branch PIN fallback, void_served_kot fix
- `foodpos/api/food_pos.py` — same re-price/discount rules, api
  create_kot reuse, api settle now links this order's KOTs
- `foodpos/api/food_pos_hooks.py` — auto_clear_served_kots no longer
  deletes Served/Cancelled KOTs (archive/keep); orphans cancelled via
  document save, not db.set_value
- `foodpos/page/food_pos/food_pos.js` — `pos_order_id` threaded through
  send-to-kitchen, settle, hold/resume, tabs and localStorage backup
- `foodpos/patches/v0_2_0/add_order_id_index_to_food_kot.py` — NEW patch
- `foodpos/patches.txt` — patch registered under [post_model_sync]

## 2. Build + migrate (migrate IS required this time)

```bash
cd ~/frappe-bench
bench build --app foodpos
bench --site <site> migrate        # <-- REQUIRED: adds tabFood KOT.order_id
                                   #     and runs the index patch. Without
                                   #     migrate the code still works (it
                                   #     checks has_field("order_id") and
                                   #     skips order linking), but the P0
                                   #     is NOT fixed until migrate runs.
bench clear-cache
bench restart
```

Verify the field landed (bench console / MariaDB):
```sql
SHOW COLUMNS FROM `tabFood KOT` LIKE 'order_id';
SHOW INDEX FROM `tabFood KOT` WHERE Key_name LIKE '%order_id%';
```

## 3. Proof the developer must show (before asking for a re-test)

For each item, in one message — files changed + commit hash + fresh-session
proof (screenshot or record IDs). No proof = not attempted.

1. `bench --site <site> console` (or Desk): `Food KOT` has `order_id`.
2. Duplicate Send to Kitchen: same cart, Send twice → exactly ONE KOT
   (record its name).
3. Unrelated settle: create KOT A for cart A, leave it open, settle
   unrelated cart B → invoice B lists NO KOT, KOT A stays open/unlinked.
4. Mis-link detection: link a KOT to a wrong invoice on purpose in Desk
   (or use the old FKOT-00038/00039 records) → it appears in the Served
   KOT Exception List with status "Served (Invoice Mismatch)".
5. Discount replay: approve an over-cap discount once, then settle a
   second over-cap order sending only `discount_approved_by` (no PIN)
   via API → must be refused.
6. Price tamper: settle via API with `rate=1` for a Rs 600 item and
   with `rate=0, is_free_item=1` and no PIN approval → both refused.

## 4. How the Round 24 audit will verify live (the probe)

Same tunnel, hard refresh first, deployment trace vs Round 23 end
(invoices 97, KOTs 30, Audit 130, exceptions 4, Live Kitchen 2 active):

1. Fresh Dine-In: 1x Club Sandwich → Send to Kitchen → Send to Kitchen
   again → **1 KOT only**. Settle it → invoice lists exactly that KOT.
2. Fresh Takeaway: 1x Club Sandwich → Send to Kitchen → clear cart
   WITHOUT settling → settle an unrelated Takeaway Beef Burger →
   **invoice lists no KOT**, the Club Sandwich KOT stays open.
3. Desk: Served KOT Exception List → FKOT-00038/00039 (or any
   item-mismatched link) now appear as "Served (Invoice Mismatch)".
4. Report title: open the exception report → no "undefined" flash
   (note: this cosmetic item was deliberately NOT fixed in this pass).
5. Full regression guards from Round 23 (receipt with/without print,
   drawer, Recent, quick-cash 850, branch switch, prices, discount PIN,
   hold/resume Rs 280, UI ≤ 22, closing 00014 Rs 1,250 Diff 0).

## 5. What is deliberately NOT in this fix

- **Report title "undefined" flash** — left as-is (cosmetic, load-order
  fragile in the bundle; fixing it properly means setting the report's
  page_title, not another bundle patch).
- **Branch isolation refactor** — not done; too big/risky for one pass.
  Branch is still taken from the client-supplied profile in settle.
  Noted as a follow-up, not a blocker for the KOT P0.
- **Silent payment inflation** (`total_paid < total` → first payment
  topped up) — left untouched; changing it could break split-payment
  flows. Noted as a follow-up.
- **Historic records** — BR1-2026-00025 + its 8 KOTs, and
  FKOT-00038/00039 + BR1-2026-00041/00042 are NOT deleted or re-linked.
  They are the evidence; the owner decides (settle/void/leave).
  The new mismatch rule will surface them in the exception report.
- **Legacy KOTs (no order_id)** — they keep working through the explicit
  `linked_kot_id` path + item-match check; they are not backfilled.
