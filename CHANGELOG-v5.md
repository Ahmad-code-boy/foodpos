# CHANGELOG — Food POS v5 (premium vibe)

## v5.11 — Single-tab print preview + menu scroll fix (2026-11-15, user feedback)

- **One tab only:** `window.open` is gone from the page JS entirely. Bill,
  KOT slip and Z-report now open as ONE centered print-preview dialog in
  the same tab (dimmed backdrop, paper slip, green Print + Close, Esc or
  backdrop click closes). Print runs `window.print()` only when the user
  taps Print; `@media print` shows ONLY the slip (`.fpos-print-area`),
  so the POS UI never prints. Preview design verified by screenshot
  (`ui-screenshots/v5.11/1-print-preview.png`).
- **Menu scroll fixed:** the item grid never scrolled because
  `.fpos-menu-main` (and its parents) missed `min-height: 0` — the flex
  column refused to shrink below the full height of all items, so the
  grid wrapper never got a constrained height. Added `min-height: 0` to
  `.fpos-body`, `.fpos-left-panel`, `.fpos-menu-main` (now also
  `overflow: hidden`) and `.fpos-items-grid-wrapper`, plus a thin visible
  scrollbar on the grid. Sanity **160/160 PASS**.

## v5.10 — Fix: no auto KOT slip/print on Confirm (2026-11-15, live bench re-test by agent)

- **Root cause (corrected):** v5.9 moved `print()` into the new tab, but the
  print DIALOG still opens on Confirm — and that dialog is what blocks the
  whole POS tab (Pay, Filters, sidebar dead until it is dismissed). Proof:
  every run where Confirm opened a slip tab froze the page; the run where
  Confirm failed (no tab) paid fine, and the KDS Settle path (no slip)
  paid fine. **Fix:** Confirm opens NO tab and prints nothing — the live
  KDS screen IS the kitchen ticket. Paper slip: a Print button on each KOT
  card in the Live Kitchen Orders drawer opens the slip tab with a manual
  Print button inside it (same pattern as the customer bill). `open_kot_slip`
  replaces `print_kot_slip` (alias kept).
- Background offline sync can no longer pop an "Internal Server Error"
  dialog over the POS (it now fails silently to console, with a toast only
  on a manual retry). Sanity **154/154 PASS**.

## v5.9 — Fix: page dead after Confirm (print-block), KDS Settle, tables on demand, sync pill (2026-11-15, live bench diagnostic by agent)

- **Root cause of the dead page:** `print_kot_slip` called `win.print()`
  from the POS page. That blocks the POS tab's JS thread until the print
  dialog closes — after Confirm, NO click worked (Pay, Filters, sidebar,
  Home; button enabled, page looked normal) until reload. The same pattern
  existed in the Z-report print. **Fix:** `window.print()` now runs inside
  the new tab's own script; the opener never calls `win.print()` /
  `win.focus()` again. `confirm_order` also force-unfreezes in `finally`
  so a stuck freeze overlay can never swallow clicks again.
- **KDS Settle:** every Live Kitchen Orders card now has a "Settle &
  Print Bill" button (new `get_kot_for_payment` API prices the KOT's items
  from the profile's price list) — a confirmed-but-unpaid ticket can always
  be billed, even after a reload wiped the cart.
- **Cart restore:** a confirmed (KOT-linked) order's backup is never
  dropped; `init_tabs` prefers the backup over an empty draft; clear/switch
  re-render the item grid so steppers never go stale ("− 1 +" on an empty cart).
- **Tables:** `get_available_tables` creates the demo T1–T6 on demand when
  the site has zero Restaurant Tables (same seed data as the v0.4.0 patch,
  like the v5.7 station ensure) — the floor works even if migrate never ran.
- **Sync:** the home sync pill is now a real button (manual retry) and a
  failed sync toasts the actual server error instead of sitting silently at
  "2 pending sync". Sanity **148/148 PASS**.

## v5.8 — Fix: Walk-In Confirm fails 'Order Type cannot be "Walk In"' (2026-11-15, live bench re-test by agent)

- **Root cause:** the POS sends 4 order types (Walk In, Dine In, Takeaway,
  Delivery), but the `order_type` Select on Food KOT **and** Food POS Held
  Order only allowed 3 ("Dine In", "Takeaway", "Delivery"). Every Walk-In
  confirm failed Frappe's Select validation on save — this only surfaced
  in the re-test because the v5.7 station fix had unblocked the earlier
  failure. **Fix:** "Walk In" added to both doctypes' `order_type`
  options (default stays "Dine In"). Takes effect on `bench migrate`
  (doctype sync) — same migrate that fixes the ERPNext column and seeds
  the tables. Sanity **136/136 PASS**.

## v5.7 — Fix: "Could not find Branch: Main Branch, Kitchen Station: Main Kitchen" on Confirm (2026-11-15, live bench test by agent)

- **Root cause (a v1 bug, not a v5 regression):** `create_kot` stored the
  BARE station name ("Main Kitchen") in `Food KOT.kitchen_station`, but
  that field is a Link to Food Kitchen Station, whose documents are named
  "Main Branch-Main Kitchen". The bare name can never validate — and on
  the user's site neither the Branch doc nor any station doc existed, so
  both links failed at once and Confirm to Kitchen threw. The tables
  floor was empty for the same reason (no Restaurant Table docs — the
  seed patch had never run, because migrate had never run).
- **Fix 1 — code:** new `_ensure_kitchen_station()` helper ensures the
  Branch + station doc exist (same on-demand pattern as the walk-in
  customer) and `create_kot` now stores the full docname
  ("Main Branch-Main Kitchen") — also in the Round-23 reuse lookup, so
  double-confirm still reuses the same KOT. KDS station filter uses
  LIKE, so it still matches docnames.
- **Fix 2 — seed:** the v0.4.0 patch now also creates the 4 kitchen
  stations (Main Kitchen, Pizza, Grill, Beverages) on migrate.
- **Not fixed by code — needs the user's migrate:** the payment error
  `Unknown column 'tabContact.is_billing_contact'` is ERPNext's own
  schema drift (its `party.py` queries a column the DB lacks) and only
  `bench migrate` adds that column. After migrate, confirm + payment
  should both work. Sanity **134/134 PASS**, seed stub **9/9 PASS**
  (run 1 now creates 35 docs).

## v5.6 — Fix: page stuck on "Loading Food POS environment..." (2026-11-14, live bench error from user)

- **Root cause:** `get_pos_profiles` selected the `custom_branch` column
  of POS Profile unconditionally. That column only exists after the
  v0.1.0 patch runs (`bench migrate`); on the user's site migrate had not
  run, so the SELECT failed with `Unknown column 'custom_branch'` and the
  page never loaded. **Fix:** the field is not selected at all — it is
  legacy (v2 always stamps `SINGLE_BRANCH` instead). Verified it was the
  only unguarded custom-field SELECT in the page code; every other
  custom-field read already uses `meta.has_field` / column checks.
- Migrate is still required for Attendance, day-time fields and seed data
  — but the page no longer bricks before it. Sanity now **129/129 PASS**.

## v5.5 — Seed / demo data on migrate (2026-11-14, user: "migrate kro to kuch seed data site ma add ho jae taka ma test ker sako")

- New patch `foodpos/patches/v0_4_0/add_seed_data.py`, registered in
  `patches.txt` under `[post_model_sync]` — it runs automatically on
  `bench migrate` (which `bench install-app` also runs). Creates ONLY what
  is missing (every create guarded by `frappe.db.exists`), so a second
  migrate or a site with real data is untouched:
  - 6 Item Groups: Pizza, Burgers, Noodles, Soup, Fast Food, Beverages.
  - 8 non-stock Items with Standard Selling prices (same names + rates as
    the v5 preview menu): Chicken Tikka Pizza 550, Margherita Pizza 520,
    Zinger Burger 450, Chicken Chowmein 480, Hot & Sour Soup 280,
    Fries & Cheese 220, Chicken Sandwich 350, Soft Drink 120. Non-stock
    means no warehouse stock / Bin is needed to sell them.
  - Branch "Main Branch" + Restaurant Tables T1–T4 (Main Hall, 4 seats)
    and T5–T6 (Family Hall, 6 seats), all Available.
  - POS Profile "Food POS" — ONLY if the site has no enabled POS Profile:
    company = site default, warehouse = first warehouse of that company,
    price list Standard Selling, item groups = the 6 seed groups, payments
    Cash (default) + Credit Card when those Modes of Payment exist.
    Skipped with a message when there is no company/warehouse.
  - Walk-in customer is NOT seeded — the POS creates it on demand.
  - No Item images are seeded (photos need real files); cards fall back
    to the gradient + SVG food icon until the user adds images to Items.
  - Stub-tested without a bench (`scratch/v5_seed_test.py`, fake frappe):
    run 1 creates exactly 31 docs, run 2 creates nothing (idempotent),
    existing profile is never duplicated. Sanity now **127/127 PASS**.

## v5.4 — Home page restaurant feel (2026-11-14, user: "home page ki UI aur enhance kro, restaurant ki feel ae")

- **Hero banner** (replaces the plain brand row): warm deep-green gradient
  with a cloche watermark, time-based serif greeting ("Good morning /
  afternoon / evening, Chef"), "The kitchen is open…" line, sync pill +
  gold Day Open pill. **Chef's Pick** card on the right shows today's top
  item with its real photo (from the cached menu items — same localStorage
  the POS menu writes; gradient + big food SVG when no image), tap opens
  the menu. New `cloche` SVG icon.
- **Popular today** strip (tiles → Recent Orders): top 3 selling items with
  real photos + "× N sold", tap / "Open Menu →" opens the POS menu; hidden
  when there are no sales yet.
- Warmer details: order tiles get tinted icon circles (green/amber/gold),
  shift card is the warm "service counter" card (cream + gold left border).
- No new server endpoint: home still calls only `get_day_status`,
  `get_daily_report`, `set_day_times`. Shift card, stats, tiles, Recent
  Orders, bottom nav — all unchanged in function. POS view untouched.
  Sanity now **120/120 PASS**.

## v5.3 — Filters in the TOP BAR, same row as the search bar (2026-11-14, user: "search bar ka samna 1 hi row ma add kerna tha")

- **Correction of v5.1 (my misread).** v5.1 moved Filters into its own row
  BELOW the search bar; the user actually wanted it in the SAME single row as
  the search bar, beside it. Undone: the `.fpos-filter-bar` row is deleted.
  The Filters button now sits in the top bar, immediately right of the search
  field, same 44px height, with a new sliders SVG icon (same button, same
  diet/sort popover — it opens below the button — same delegated wiring).
  Category-tiles row is tiles-only again. Files: `food_pos.js` (wrapper moved
  into `.fpos-header-center`, `filter` icon added to `FPOS_ICONS`),
  `food_pos.css` (topbar rules, filter-bar rules removed),
  `scratch/v5_sanity.py` (+3 checks) + `scratch/v5_previews.py`. Sanity now
  **109/109 PASS** (was 106/106).

## v5.2 — NO TAX, discount is flat Rs only (2026-11-14, user: "is ma tax ni chiya, tax ko discount wali logic add kro rs ma")

- **Tax removed everywhere.** Order panel has no Tax row; totals are now
  Subtotal − Discount (Rs) + Delivery Fee only. Payment summary, both receipt
  formats (screen + thermal), and the daily/Z-report no longer show any tax
  line. Server-side the invoice never gets the POS Profile's Sales Taxes and
  Charges template: `_build_doc` clears `taxes_and_charges` and the taxes
  table after `set_missing_values()` and before `calculate_taxes_and_totals()`,
  so the invoice total has zero tax even if a template is configured on the
  profile. (The profile helper still returns a `tax_rate` value, but nothing
  reads it anymore; the legacy unused `food_pos_cart.js` still contains its
  own old tax calc — it is not loaded by the POS page.)
- **Discount is now flat Rs only — no % anywhere.** The Discount dialog lost
  its Percentage field; it has one "Discount Amount (Rs)" input plus Rs
  presets (Rs 50 / Rs 100 / Rs 200 (PIN) / Rs 500 (PIN) / Clear). Totals use
  `discount = min(subtotal, discount_amount)` so Total Due can never go below
  0. Cashier cap is now **Rs 100** (was "10% or Rs 100"): above Rs 100 needs a
  fresh Manager PIN on every settle, client and server. Old saved tabs/drafts
  can no longer restore a stale % discount (restores force it to 0), and the
  server no longer accepts `discount_percentage` / `additional_discount_percentage`.
- Files: `food_pos.js` (totals, order panel, payment summary, receipt, reports,
  discount dialog), `foodpos/api/food_pos.py` (discount cap + invoice tax
  clearing), `scratch/v5_sanity.py` (+15 checks) + `scratch/v5_previews.py`
  (totals without tax). Sanity now **106/106 PASS** (was 91/91). Billing rule
  unchanged: `show_pos_slip` still only at settle + reprint (5 occurrences).

## v5.1 fix (2026-11-14, user feedback on the v5 screenshots)

- **Filters moved below the search bar.** The Filters button used to sit at the
  right end of the category-tiles row, i.e. beside the search bar. It now has
  its own slim row directly **below** the search bar, left-aligned under the
  search field, above the category tiles. Same button, same diet/sort popover
  (now opens below the button, to the left), same delegated click wiring —
  only the position moved. Files: `food_pos.js` (wrapper moved out of
  `.fpos-cat-row` into new `.fpos-filter-bar`), `food_pos.css`
  (`.fpos-filter-bar` rules, cat-row top padding 14px → 8px, old cat-row
  filter stretch rules removed). Sanity now 91/91 PASS (was 90/90).

> v5 is a **visual polish release only**, built on v4-chili-layout.
> The v4 CHILI layout is **FROZEN**: no panel, sidebar, tile row, button or
> screen position moved, added or removed. Only the visual system changed.
> Files changed: `foodpos/foodpos/page/food_pos/food_pos.css` (v5 section
> appended) and `food_pos.js` (icons, item media, category tiles, home stats
> + recent strip, discount badge class, chip dots). No server code, no new
> DocType, no new endpoint. Diff vs v4 is limited to those two files
> (plus this changelog, TEST-REPORT-v5.md, BENCH-TEST-v5.md and
> scratch/v5_sanity.py + scratch/v5_previews.py).

## 1. Colour + depth

- Page background is now soft warm off-white `#f7f5f0` (was cool `#f8fafc`);
  the app-shell frame ring is warm `#ede9df` to match.
- Deep green primary kept (`#14532d`/`#15803d`); warm gold accent
  `#b45309`/`#d97706` added and used **sparingly**: discount badge, Total Due
  figure, Today's Sales figure, active-tile glow halo, primary-button sheen.
  Never an orange background anywhere.
- Cards/panels are white, 18px radius, soft layered shadows
  `0 1px 2px rgba(20,60,30,.06), 0 8px 24px rgba(20,60,30,.08)` and 1px
  hairline borders `#e8e4da`. No more flat pure-white-on-pure-white.
- New CSS variables: `--fpos-gold`, `--fpos-gold-bright`, `--fpos-gold-tint`,
  `--fpos-warm-grey`, `--fpos-shadow`, `--fpos-shadow-lg` (all in the v5
  section at the end of `food_pos.css`, so v4 rules stay intact underneath).

## 2. Typography

- Font stack is now `"Plus Jakarta Sans", Inter, system-ui, sans-serif`
  (app CSS keeps the stack so the offline bench renders fine with the
  Inter/system-ui fallback; the preview HTML loads Plus Jakarta Sans from
  Google Fonts).
- Display numbers (Total Due, prices, stat values, timers, stepper qty) are
  700–800 weight with `font-variant-numeric: tabular-nums`.
- Headings get `letter-spacing: -.02em`; section labels
  (Shift Management, Main Hall, stat labels, Recent Orders) are small-caps
  grey with `.08em` letter-spacing.
- Item names 15px/600, descriptions 12.5px warm grey (`#78716c`).

## 3. Item card photos (the big one)

- New `item_media_html(item)` helper in `food_pos.js`: when an item has an
  image (ERPNext Item image field) it renders as a `background-image` div
  with `background-size: cover`, filling the 110px photo area (same card
  geometry as v4 — no size change). A failed image URL degrades to the warm
  base colour, never a broken-image icon.
- When an item has **no** image, the old bare-letter placeholder is gone:
  a rich warm gradient tile + a large proper SVG food icon in a white
  circle, per category (pizza / burger / noodle / soup / fries / sandwich /
  drink / dessert / combo / plate). Ten new SVG icons added to `FPOS_ICONS`.
- `classify_fast_food_item()` now returns an SVG icon **name** instead of an
  emoji (`_ff_icon` is `"pizza"`, `"burger"` … — never 🍔/🍕 again; zero food
  emoji remain in `food_pos.js`).
- Preview photos (not shipped in the app): real food JPEGs in
  `ui-screenshots/v5/assets/` — pizza, burger, chowmein, margherita
  (900px downscaled copy `margherita-preview.jpg`, original 1.5MB untouched),
  soup, fries. All 6 were present and used; none missing.

## 4. Home — dead space filled (no layout move)

- New **"Today at a glance"** row of 4 stat cards **above** the order-type
  tiles: Today's Sales (gold figure), Orders, Avg Bill, Top Item. It reuses
  the existing `get_daily_report` endpoint (the same one the Reports nav
  already calls) — **no new server endpoint**. Avg Bill = sales ÷ orders;
  Top Item = first entry of the report's `top_items`. If the call fails,
  cards render "—" instead of blocking the home screen.
- New **"Recent Orders"** strip **below** the tiles: latest 3 orders (invoice
  no., customer, type/table/time, amount, PAID/UNPAID pill), reusing
  `this.recent_orders` already fetched by `load_recent_orders()` — refreshed
  automatically whenever that data lands. "View all" and row tap open the
  existing Recent Orders drawer. Empty state: "No orders yet today".
- Day Open card and bottom nav are exactly as in v4. Home spacing was
  tightened slightly (not re-laid-out) so stats + tiles + recent strip fit
  above the fixed bottom nav at 1280×860; the views still scroll on shorter
  screens (`.fpos-home-view` / `.fpos-tables-view` now `overflow-y: auto`).

## 5. Tables — chairs redrawn

- Chairs are now real wooden chairs: rounded backrest with vertical slat
  lines + seat + two legs, in wood tones matching the table. The v2
  status-tinted chairs (mint/pink blocks that read as popsicles) are removed
  — status still lives in the dot, pill and card border, as before.
- Table tops get subtle wood grain (`repeating-linear-gradient` grain over
  the radial wood gradient) and a soft elliptical floor shadow under each
  table (`.fpos-table-scene::after`).
- Status pill + dot + live timer (tabular numerals) unchanged. Table grid
  geometry unchanged; chair positions (left/right) unchanged.

## 6. Polish details

- Category tiles: tinted green icon circle + name + count; active tile gets
  a soft green glow with a gold halo + 2px green border (inset, so tile size
  does not change). Category icons are now real food icons (burger/pizza/
  soup/noodle/drink/…) instead of generic box/chef.
- Order-type segmented tabs: sliding-pill feel — active tab is solid green
  with white text and a soft shadow, with a `.2s` transition.
- Payment buttons: SVG icons + selected state (green border + pale green
  tint + soft shadow).
- Primary **"Pay & Print Bill"**: subtle vertical green gradient
  (`#16a34a → #15803d → #166534`) + soft shadow + top sheen.
  **"Confirm Order — Kitchen"** stays the green outline button.
- Discount badge: gold pill (`#fef3c7` bg, `#92400e` text, gold border) —
  new `fpos-discount-badge` class on the existing discount value.
- Qty stepper: solid green pill (`border-radius: 999px`) with white tabular
  numerals.
- Bottom table chips: soft shadow + status dot (green = ordering/available,
  gold = in the kitchen).
- Visible hover/active states everywhere (buttons, tiles, chips, cards —
  hover lift/shadow, `:active` scale `.97–.98`).

## Deliberately NOT changed (layout frozen)

- v4 CHILI structure: ~88px left icon sidebar, top bar with search, one
  category tile row, 3-column item cards, 300px right order panel, bottom
  table-chips strip, home shift card + 4 tiles + bottom nav. Nothing moved,
  added or removed.
- Single branch only (Main Branch) — no branch selector/switch strings.
- Auto-KOT: confirm creates exactly one KOT (idempotent), no dialog, no
  manual Send to Kitchen. Payment Pending banner unchanged.
- **BILL RULE (unchanged since v3): customer bill ONLY at settle or explicit
  reprint — never on KOT confirm.** Grep proof in TEST-REPORT-v5.md:
  `show_pos_slip` appears exactly 5 times (settle call + definition +
  reprint + 2 comment mentions), identical to v4.
- Attendance DocType, daily orders report, thermal 80/58mm bill + KOT slip,
  all server APIs and the dine-in lifecycle (reserve → timer → KOT →
  pending → pay → table frees).

## Files

- `foodpos/foodpos/page/food_pos/food_pos.css` — v5 section appended (~150 lines).
- `foodpos/foodpos/page/food_pos/food_pos.js` — icons, `item_media_html()`,
  category-tile icons, home stats + recent strip, discount-badge class,
  chip dots.
- `scratch/v5_sanity.py` — 90 checks (all v4 checks + v5 additions).
- `scratch/v5_previews.py` — generates `ui-screenshots/v5/` previews.
- `CHANGELOG-v5.md`, `TEST-REPORT-v5.md`, `BENCH-TEST-v5.md` (this folder).
- `../foodpos-v5-premium-vibe.zip` — zip of this folder, kept ready, NOT sent,
  NOT pushed to GitHub.
