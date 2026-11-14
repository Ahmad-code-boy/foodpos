# CHANGELOG — Food POS v4 (CHILI layout)

Built from `v3-premium/`, 2026-11-14. Folder: `v4-chili-layout/` (+ `foodpos-v4-chili-layout.zip`,
kept ready, **not sent, not pushed**). v3, v2 and the source repo are untouched.

## Why v4 exists

v3 was rejected for its layout ("designing layout boht khrab ha"). The problem was
**clutter by stacking**: the v3 POS screen showed, at the same time, a left icon
sidebar AND a left category sidebar AND a category-tile row AND a top order-type
bar AND a top order-tabs strip AND a bottom table-chips bar — three navigations
at once. v4 is exactly the clean 3-column structure of the CHILI POS reference
(image 4): **one navigation per axis** — left icon sidebar, centre tile row,
right order panel, bottom chips strip. Layout/structure only: brand, photos and
text stay Food POS's own ("Food POS", Main Branch, our items e.g. Chicken Tikka
Pizza Rs 550). Nothing from the reference's brand, photos or exact text was copied.

## What changed vs v3 (only `food_pos.js` + `food_pos.css` — no server code)

### POS / order screen (image 4)
| Area | v3 (cluttered) | v4 (CHILI) |
|---|---|---|
| App shell | Full-bleed 100vw/100vh | One rounded-corner white window (20px radius) on a pale green-grey frame (12px ring + soft shadow) |
| Top bar | Brand + branch chip + 4-tab order-type control + Home/Held/status/More | Hamburger + Food POS brand (left); **one** wide search "Search Product here..." (centre); order chip "Table 4 ✎" + icon-only Home/Held/status/⋮ (right). New `menu` + `bell` SVG icons. The order-type control moved out of the top bar. |
| Left sidebar | Icon nav (84px) + separate category sidebar | **Icon nav only (~88px):** Menu (active = solid green pill), Table Services, Reservation, Delivery, Accounting, Settings, Logout pinned at bottom. Hamburger collapses it to icons only. |
| Categories | Left sidebar + tile row + Filters popover list | **ONE tile row only:** All (active, pale green) / Breakfast / Soups / Pasta / Main Course / Burgers — icon + name + count underneath — plus a compact Filters button (diet/sort only). `.fpos-category-sidebar` deleted from the POS view (JS + CSS), `.fpos-filter-bar` removed, search moved to the top bar. |
| Product cards | Grid `auto-fill minmax(155px,1fr)` | Exactly **3 columns**, uniform cards, generous white space: tinted photo placeholder (image when present), name, description, price, Veg/Non-Veg badge, full-width pale-green "Add to Dish" or green qty stepper (− qty +) once in cart. |
| Right order panel | 380px (360px `!important`), customer/table/delivery fields + ⋮ menu | **300px**, white, bordered: header "Table 4" + subtitle "Dine In • 2 items • Ahmed" + edit button; segmented order-type tabs **Walk In / Dine In / Takeaway / Delivery** (Dine In active green); order lines (name, amount, Note/Price + qty stepper); Subtotal, Tax 5%, Total Due; Cash / Card / QR (selected = pale green); **two distinct stacked actions:** "Confirm Order — Kitchen" (outline green) first, then "Pay & Print Bill" (solid green); Hold below. After confirm, the amber Payment Pending banner shows in this panel (v3 behaviour, kept). |
| Bottom strip | Occupied-table chips only | Staff avatars at the left end + **one chip per open order** (T4 Ahmed "2 items → Kitchen", T2 Sara "3 items • Ordering") **plus free tables** (T1/T3 "Available" — tapping one starts a fresh Dine-In order on that table). This is the ONLY bottom bar on the POS screen; the top order-tabs strip was removed. |

### Home screen
Same clean system: top bar hidden on Home (each view has exactly one header —
`set_view()` now toggles a `fpos-view-pos` class on the wrapper), one shift card
(Day Open, elapsed timer, Day Start/End inputs + Save, Open/Close Day), four
order-type tiles in ONE row, ONE bottom nav row (Orders/Dispatch/Cashier/KDS/
Shifts/Staff/Attendance/Reports/Printer/Settings). The bottom nav is anchored
inside the app shell (it was `position:fixed` to the viewport and would have
poked out below the shell's rounded bottom edge).

### Tables screen (image 5)
v3's realistic round wooden tables kept (radial wood gradient + rim + pedestal,
2 chairs, big number, status pill + dot + live timer) in a clean 3-column grid
with legend, Home + Edit Layout actions. No extra side panels.

## Real layout bugs found (and fixed) while verifying the screenshots
1. **Right panel was 360px, not 300px** — a Zone-3 rule sets it to `360px !important`;
   v4 now overrides with `width: 300px !important`.
2. **"Table 4" title was clipped** — the v3 rule `.fpos-cat-tiles { flex: 0 0 auto !important; }`
   stopped the tile row shrinking, so the centre column overflowed into the right
   panel. v4 overrides it (`flex: 1 1 auto !important`) and the tiles share the row
   (`flex: 1 1 0`, measured: every tile label fits, incl. "Main Course").
3. **Item photo placeholder was a narrow band** — a placeholder `<div>` inside the
   flex `.fpos-item-media` shrink-to-fits. v4 CSS adds `.fpos-item-media > div { flex: 1; }`
   so it fills the media area in the real app too.
4. **"Take Away" tab truncated to "Take …"** — four tabs didn't fit in 300px while
   the ⋮ menu sat beside them. The ⋮ menu moved into the title row (tabs get the
   panel's full width) and the label is "Takeaway" (one word, as in v3's own tab
   label) at 12px — all four tabs now fit exactly.
5. **Home bottom nav outside the shell** — see Home section above.

## Unchanged from v3 (function + rules)
- Single branch only: Main Branch, no branch selector/switch (grep-clean).
- Auto-KOT on confirm (idempotent, one KOT per order, Round-23 guards), no dialog,
  no manual "Send to Kitchen" (`send_to_kitchen()` is just a `confirm_order()` alias).
- Payment Pending after confirm; settle frees the table.
- **BILLING RULE (unchanged):** the customer bill is printed ONLY at payment/settle
  (`process_invoice_submission()`, `show_pos_slip(receipt_data, true)`) or explicit
  reprint from Recent Orders. Confirm prints the KOT slip only. Grep proof in
  `TEST-REPORT-v4.md` — call sites are identical to v3 (only line numbers shifted).
- Attendance DocType + daily orders report, thermal 80/58mm bill + KOT slip,
  discount/PIN rules, Held orders, KDS drawer, Recent Orders drawer.

## Files changed (diff vs v3, excluding `__pycache__`)
- `foodpos/foodpos/page/food_pos/food_pos.js` — topbar, removed tabs strip +
  category sidebar + filter bar, cat-row, right-panel header, bottom chips
  (all orders + free tables + `start_table_order()`), `set_view()` class toggle,
  `update_order_type_ui()` drives the new header, new `menu`/`bell` icons.
- `foodpos/foodpos/page/food_pos/food_pos.css` — app shell, topbar, cat-row,
  3-col grid, 300px right panel, chips strip, tables grid, dead-rule cleanup
  (tabs bar / segmented control / cart-meta / sidebar / filter-bar rules removed).
- `scratch/v4_sanity.py` (48 checks), `scratch/v4_previews.py` + `scratch/v4_measure.py`
  (screenshot generator + layout measurement). No `.py` file changed.

## Not verified (needs the user's live bench)
No Frappe bench exists here. Live-bench testing is **not** verified: install +
migrate (Attendance + day-time patch), Day Open/Close end-to-end, real dine-in
flow, real thermal printer (KOT + bill + reprint), free-table chip tap on a real
floor. See `BENCH-TEST-v4.md` (sections A–H). Screenshots in
`~/workspace/foodpos/ui-screenshots/v4/` are static mocks rendered from the v4
code with Playwright — not live bench shots.
