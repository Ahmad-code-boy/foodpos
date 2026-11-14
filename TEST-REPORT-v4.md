# TEST REPORT — Food POS v4 (CHILI layout)

Date: 2026-11-14. Built from `v3-premium/`. No live Frappe bench exists here —
everything below is static verification; live-bench checks are the user's job
(`BENCH-TEST-v4.md`).

## 1. Syntax checks

| Check | Result |
|---|---|
| `python3 -m py_compile` on every `.py` in the v4 app | **OK** (all files, incl. `food_pos.py`) |
| `node --check` on every `.js` in the v4 app | **OK** (incl. `food_pos.js`, 6349 lines) |

One syntax error was caught and fixed during the work: an edit left a duplicated
`}` + `// v2: Confirm Order` comment after `render_table_chips()`; `node --check`
failed at `async confirm_order()`, the duplicate was removed, re-check passed.

## 2. Diff scope (v4 vs v3)

`diff -rq --exclude=__pycache__` — only two files differ:
`foodpos/foodpos/page/food_pos/food_pos.js` and `.../food_pos.css`.
**No `.py` file changed** (no server API, DocType, or dine-in lifecycle change).
Stale docs removed from the v4 copy: `CHANGELOG-v2.md`, `TEST-REPORT-v2.md`,
`BENCH-TEST-v2.md`, `DEPLOY.md` (Round-23, must not be followed). `README.md` kept.

## 3. Grep proof

| Claim | Proof |
|---|---|
| No category sidebar in the POS view | `grep -c fpos-category-sidebar food_pos.js food_pos.css` → **0** (also 0 for `fpos-sidebar-categories`, `fpos-filter-bar`, `fpos-search-box`, `fpos-page-tabs-bar`, `fpos-segmented-control`, `fpos-cart-meta`, `fpos-table-field`, `fpos-customer-field`) |
| No branch selector/switch | `grep -rn "branch_selector\|switch_branch\|select_branch\|fpos-branch"` → **no matches** |
| No manual Send to Kitchen | Only explanatory comments + `async send_to_kitchen() { return this.confirm_order(); }` (alias, as in v3) |
| **Billing rule unchanged from v3** | `show_pos_slip` occurrences in v4: guard comment (2×), settle call `this.show_pos_slip(receipt_data, true);` inside `process_invoice_submission()`, definition `show_pos_slip(receipt_data, is_settlement = false)`, reprint call from Recent Orders. Identical call sites to v3 (v3: settle line 3113, def 3186, reprint 3695; v4: settle 3043, def 3116, reprint 3625 — only line numbers shifted by the removed markup). `print_pos_slip` is called only from inside `show_pos_slip`. **No bill call exists on the confirm/KOT path.** |
| Single branch kept | `FPOS_SINGLE_BRANCH = "Main Branch"` in JS; `SINGLE_BRANCH` in `food_pos.py` |

## 4. Logic sanity — 48/48 PASS

`scratch/v4_sanity.py` (46 checks in the first run, +2 for the free-table chips
and the media fix = **48/48 PASS**, exit 0). Covered: all layout removals,
CHILI structure present (cat row, topbar search, menu/bell icons, 4 order-type
tabs, 3-col grid, 300px panel, chips strip incl. free tables + `start_table_order`,
`fpos-view-pos` toggle, shell, tables grid, left nav, home nav, hamburger,
order header), and all unchanged v3 rules (single branch, auto-KOT, KOT guard
comment, billing-rule call sites, pending banner, discount, thermal 80/58mm,
realistic tables, Attendance DocType, daily report).

## 5. Screenshot verification (Playwright headless Chromium, 1280×860)

Previews rendered from the **actual v4 CSS + real v4 markup/classes** by
`scratch/v4_previews.py` into `~/workspace/foodpos/ui-screenshots/v4/`
(`1-home`, `2-menu`, `3-tables`, `4-order-panel`, `.html` + `.png`). Each PNG
was read and visually inspected; defects found were fixed in the app CSS/JS
and the shots re-rendered. Final state:

| Shot | Verified |
|---|---|
| `1-home.png` | Home inside the rounded shell, no POS topbar, shift card (Day Open, elapsed, Day Start/End + Save, Close Day — Z Report), 4 order-type tiles in one row, bottom nav (Orders/Dispatch/Cashier/KDS/Shifts/Staff/Attendance/Reports/Printer/Settings) anchored **inside** the shell with rounded bottom corners. Clean, no double navigation. |
| `2-menu.png` | Exact 3-column CHILI structure: hamburger + brand + wide "Search Product here..." + Table 4 chip + icon buttons; left icon sidebar only (Menu active green pill, Logout pinned bottom); ONE category tile row (All active pale green / Breakfast / Soups / Pasta / Main Course / Burgers — every label fully visible, measured: name scrollWidth == clientWidth for all six tiles); 3-col uniform cards with full-width tinted placeholders, Veg/Non-Veg badges, steppers on in-cart items, "Add to Dish" on the rest; right panel 300px (measured exactly 300px) with "Table 4" + "Dine In • 2 items • Ahmed", all four order-type tabs fitting (Walk In / Dine In / Takeaway / Delivery), cart lines, Subtotal/Tax/Total Due, Cash/Card/QR, Confirm (outline) + Pay & Print Bill (solid) + Hold; bottom strip with staff avatars + T4/T2 order chips + T1/T3 "Available" chips. No double sidebar, no clutter. |
| `3-tables.png` | Realistic round wooden tables (radial wood gradient + rim + pedestal, 2 chairs, big number, status pill + dot + live timer) in a clean 3-column grid; header "Dine-In — Tables, 12 tables • 3 occupied • Main Branch", Home + Edit Layout buttons. The floor has 12 tables = 4 rows, so rows 3–4 sit below the fold and scroll (same as the real app); the legend (Available/Occupied/Reserved/Cleaning) renders below the grid, reachable by scrolling. |
| `4-order-panel.png` | Same POS screen post-confirm: amber "Payment Pending — KOT KOT-0042 is in the kitchen. No bill has been given to the customer yet — the bill is printed only when the customer pays." banner in the right panel; T4 chip reads "2 items → Kitchen". No customer bill is shown. |

### Defects found by the screenshot check (all fixed in the app, not just the mock)
1. Right panel measured **360px** (Zone-3 rule `360px !important`) → v4 override
   `width: 300px !important`; re-measured exactly 300px.
2. **"Table 4" title clipped** by the overflowing centre column (v3
   `.fpos-cat-tiles { flex: 0 0 auto !important; }`) → v4 `!important` override
   + tiles share the row; re-measured, all labels fit.
3. **Item placeholder a narrow band** (flex-item shrink-to-fit) → `.fpos-item-media > div { flex: 1; }`.
4. **"Take Away" tab truncated to "Take …"** → ⋮ menu moved into the title row
   (tabs get full panel width) + label "Takeaway" (as in v3); all four tabs fit.
5. **Home bottom nav outside the shell** (`position:fixed`) → anchored to the
   wrapper (`position:absolute`, matching bottom radius).

## 6. What is NOT verified (needs the user's bench)

- Install/replace + `migrate` on an ERPNext v16 bench (Attendance DocType +
  day-time patch), `bench build`, `clear-cache`, `restart`.
- Day Open/Close end-to-end, elapsed timer, Close Day PIN + Z-report.
- Real dine-in flow: table Occupied + live timer, auto-KOT in KDS, exactly one
  KOT on double-confirm, payment Pending, settle frees the table.
- Free-table chip tap starting a Dine-In order on a real floor.
- Real thermal printing (80mm/58mm): KOT slip on confirm, customer bill only
  at settle, reprint from Recent Orders.
- Hamburger collapse, search, Filters popover, Reservation/Delivery/Accounting/
  Settings nav targets, Held orders, KDS drawer on the live page.

See `BENCH-TEST-v4.md` for the per-item checklist.
