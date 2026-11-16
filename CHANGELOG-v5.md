# CHANGELOG — Food POS v5 (premium vibe)

## v6.0 — Warm restaurant redesign (2026-11-15, user brief)

- **New palette, same system:** warm cream page (#faf6f0), warm white
  cards (#fffdf9), restaurant orange primary (#ea580c, deep #c2410c),
  elegant dark brown text (#292524), warm beige hairlines, rounder
  cards (14px). The deep-green brand is gone; green now means only
  success/ready/paid (Ready, PAID, Balanced, VEG badges). Home hero is a
  dark-brown → orange gradient. CHILI layout, all flows and all business
  logic untouched (single branch, auto-KOT, no-tax Rs discount, thermal
  bills, Pending drawer, seed data).
- **Search:** instant filter now matches item name, item code, category
  AND barcode (server `get_items` returns the first Item Barcode and
  matches it too). Placeholder shows the shortcut hint.
- **Dialogs, all centered:** Frappe's own dialogs (discount, customer,
  PIN, confirm, msgprint) get warm rounded centered styling; the receipt
  modal now opens with a green ✓ **Payment Successful** banner at
  settle; loading (freeze) overlay is warm-dimmed. The POS's own receipt
  / print-preview dialogs were already centered.
- **Touch + keyboard:** Add-to-Dish min 44px, Pay/Confirm min 52px;
  `/` or Ctrl+K focuses search from anywhere; Enter in search adds the
  single match (barcode-scanner flow); Esc now also closes the Pending
  drawer. Rendered from the real CSS and visually checked
  (`ui-screenshots/v6/1-pos-warm.png`). Sanity **175/175 PASS**.

## v5.12 — Pending Payments on the sidebar (2026-11-15, user feedback)

- **The flow the user asked about:** order goes to kitchen → customer
  waits while food is made → then pays. The bill for that order now lives
  in the left sidebar: a **Pending** nav item with a live amber count
  badge (same 5s poll as the kitchen badge), opening a **Pending
  Payments** drawer. Each card shows KOT, status, order type, table,
  customer, waiting time, items and the TOTAL DUE, with a summary bar
  ("N pending bill(s) • Total Due Rs X"). Two actions per bill:
  **Settle & Print Bill** (loads the order into the cart → payment screen
  → final receipt prints after payment) and **Print Bill** (prints the
  unpaid check — items, rates, TOTAL DUE, "PENDING PAYMENT", no paid
  amount — via the centered print-preview dialog, so the customer can see
  the bill before paying). Server `get_active_kitchen_kots` now prices
  each KOT's items + total from the profile price list. Drawer design
  verified by screenshot (`ui-screenshots/v5.12/1-pending-drawer.png`).
  Sanity **166/166 PASS**.

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

## v6.1 — Day Open / Close, clean VIP + stranger-friendly (2026-11-15 01:45 PKT)

User: "pos open aur closing ka acha sa clean ui kro vip ker taka ksi unjan
bnda b easyly samj la user friendly ho" — the Day Open / Day Close flow
must be so plain that even a new person understands it in seconds.

**Day Open — old ERPNext dialog replaced by a guided card:**
- `show_opening_shift_dialog()` no longer opens a Frappe dialog
  ("Create POS Opening Entry" + Company link + POS Profile select +
  "Opening Balance Details (Float Cash)" table). It now shows a
  centered warm card `.fpos-day-open-overlay` / `.fpos-day-open-card`
  (same pattern as the v5.11 print preview): big cash icon, title
  "Open the Day", subtitle "Count the cash in the drawer, then start
  taking orders.", branch • profile • date as plain text (not editable
  fields), 3 numbered steps (1 Count the cash / 2 Type it below /
  3 Tap Open Day), one big Rs input row per payment mode from the
  profile ("Cash in the drawer" first, autofocus + select-all on
  focus), one big orange "Open Day" button (56px) + "Not now" below.
  Enter submits, Esc/backdrop closes back to Home.
- Same API + same success path: `create_opening_voucher` with
  `{pos_profile, company, balance_details}` built from the inputs,
  then the identical post-open sequence (render_layout, load_data,
  init_tabs, realtime listener, offline sync, kitchen polling,
  show_home). No server change. Profile switching via the old dialog
  is gone — profile is fixed to the current one (switch via Settings).

**Home shift card — plain state + guide:**
- Label "Shift Management" → "Your Day"; state "● Day Open" /
  "○ Day Closed" → "● Day is Open" / "○ Day is Closed"; when closed
  a 3-step guide (Count the cash → Tap Open Day → Start taking
  orders); "Day Start" / "Day End / Close" → "Day starts at" /
  "Day ends at", Save Times → "Save"; "Close Day — Z Report" →
  "Close Day" + subtext "See today's sales & print the Z-Report".
  Open/Close buttons now full-width, 56px (CSS). All bindings
  (.fpos-day-open-btn / .fpos-day-close-btn / .fpos-day-start /
  .fpos-day-end / .fpos-day-times-save) unchanged.

**Day Close page — plain language pass (data/logic untouched):**
- Header "POS Shift Complete & Shift-Closing" → "Close the Day" +
  "Check the money, then close the day. Nothing is final until you
  tap “Close Day” below."; amber 3-step strip on top (1 Count the
  cash / 2 Type it in the “You Counted” column — green means it
  matches / 3 Tap “Close Day” below).
- KPIs: "Total Net Sales" → "Today's Sales", "Orders Completed" →
  "Orders", "Expected Cash in Drawer" → "Cash in Drawer",
  "Settled Volume" → "Money In".
- Reconciliation: "Payment Reconciliation & Cash Drawer Count" →
  "Count the Cash" + "Type what you counted in the drawer. Green
  means it matches the expected amount."; columns "Opening Float" →
  "Started With", "Invoices" → "Sold Today", "Expected" → "Should
  Be", "Physically Counted" → "You Counted", "Variance" → "Match?";
  footer "Total Reconciliation" → "Total".
- Sections: "Order Channels (Dine-In, Takeaway, Delivery)" →
  "Where Orders Came From", "Shift Information" → "About This Day",
  "Top Selling Fast Food Items in this Shift" → "Best Sellers Today",
  "Shift Invoice Transactions" → "Today's Bills"; notes label →
  "Notes (optional):" + "Anything to tell the next shift? (optional)".
- Buttons: "Submit POS Closing Entry & Exit" → "Close Day" (both
  places), "Return to POS Register" / "Back to Register" → "Back to
  POS". Close confirm: "Close the day? Today's sales will be counted
  and the day will end." PIN details: "Only a manager can close the
  day. Please enter the manager PIN." Loading text also plain.
  All closing bindings (.fpos-exit-desk-btn, .fpos-print-closing-btn,
  .fpos-back-to-pos-btn, .fpos-recon-counted-input, .fpos-closing-notes)
  unchanged.

**Verify:** sanity 181/181 PASS (6 new v6.1 checks), seed stub 9/9,
`node --check` + `py_compile` OK. Design rendered from the real CSS
and visually checked: `../ui-screenshots/v6.1/1-day-open.png`
(Open the Day card + closed-day shift card + close-steps strip).
NOT verified live: the user must open/close the day on the bench
(the day is currently OPEN on pos.local, so the Open card shows
after the next close).

## v6.2 — Closing page: Close Day button reachable + order-type labels agree (2026-11-16 21:35 PKT)

Two findings from the live v6.1 loop test (2026-11-16 21:15-21:32 PKT),
both fixed here. No new feature, no logic change to totals or the
close flow itself.

**1. "Close Day" button was covered by the fixed bottom nav (real bug):**
- Root cause: `show_closing_page()` hid only `.fpos-body`. The Home
  view (`.fpos-home-view`) is a top-level sibling, so its fixed bottom
  nav (`.fpos-home-nav`, `position: fixed; bottom: 0; z-index: 50`)
  stayed on screen over the closing page and covered the bottom
  action bar — the "Close Day" button could not be clicked with a
  mouse (the live test had to Tab-navigate 35+8 times to reach it).
- Fix: `show_closing_page()` now hides EVERY top-level view
  (`.fpos-body, .fpos-home-view, .fpos-tables-view,
  .fpos-attendance-view, .fpos-daily-report-view`).
  `hide_closing_page()` is unchanged — it restores only the POS view,
  which matches its `current_view = "pos"`.
- Safety net: `.fpos-closing-page` bottom padding 60px -> 96px, so the
  action bar clears any fixed element at the viewport bottom.

**2. Order-type labels disagreed (Dine In vs Takeaway):**
- Root cause: two different fallbacks for a missing order type.
  `get_shift_closing_details` hard-coded `or "Dine In"`, while
  `get_recent_pos_orders` (Home) and three other places use
  `"Dine In" if table else "Takeaway"`. The 4 test invoices have an
  empty `custom_order_type` (created before the unconditional-persist
  fix) and no table, so Home said "Takeaway" and the closing page
  said "Dine In" for the same bills.
- Fix: `get_shift_closing_details` now selects the table columns
  (`custom_table`, `custom_restaurant_table`, NULL when the column
  does not exist) on both the Sales Invoice and POS Invoice branches
  and uses the shared rule in the order-types breakdown:
  `custom_order_type or ("Dine In" if table else "Takeaway")`.
  The closing page's "Today's Bills" rows use the same rule in the
  client (`render_closing_page`), for both the icon and the label.
  New orders store their real type ("Walk In" etc.) via the persist
  fix, so the fallback only matters for old/empty rows; the 4 old
  test bills now read "Takeaway" everywhere, consistently.

**Verify:** sanity 185/185 PASS (4 new v6.2 checks), seed stub 9/9,
`node --check` + `py_compile` OK. Closing page bottom rendered from
the real CSS and visually checked: `../ui-screenshots/v6.2/1-closing-bottom.png`
(action bar fully visible with clear space below). NOT verified live:
the user must pull + build + clear-cache + restart, then open the
closing page and tap "Close Day" with the mouse (no PIN change — the
Manager PIN is still 1234 from the v6.1 test).

## v6.3 — Home: POS top bar removed + hero Chef's Pick never empty (2026-11-16 21:50 PKT)

User's screenshot (2026-11-16 21:47 PKT): the POS top bar (search,
Filters, Takeaway chip, home/pause/menu buttons) sat on top of the
Home page, and the hero's right side was empty on a fresh day.

**1. Top bar removed from Home (real bug, v4 intent broken):**
- Root cause: the v4 hide rule
  `.fpos-wrapper:not(.fpos-view-pos) .fpos-topbar { display: none; }`
  was defeated by the later "Zone 1" block
  `.fpos-topbar { display: flex !important; }` — `!important` beats
  a higher-specificity non-important rule, so the top bar could never
  hide on any non-POS view.
- Fix: the hide rule is now
  `.fpos-wrapper:not(.fpos-view-pos) .fpos-topbar { display: none !important; }`
  — with both rules `!important`, specificity decides and the hide
  rule (0,3,0) wins over the base rule (0,1,0). The top bar shows on
  the POS screen only; Home, Tables, Attendance and Report each keep
  their own header + bottom nav. Nothing on Home depended on the
  top bar (sidebar toggle, order chip and held orders are POS-only;
  Settings lives in the bottom nav).
- No layout change to the POS screen itself.

**2. Hero Chef's Pick on a fresh day (small UX):**
- Root cause: the pick rendered only when `stat_top` existed (sales
  today), so on a day with no sales yet the hero's right side was
  empty except the cloche watermark.
- Fix: `pick_item = stat_top || first menu item from the cached menu`
  (`home_cached_items()` — same source the pick photo uses), with the
  sub-line "Try it today" when there are no sales yet, else
  "× N sold today". Tap still opens the menu.

**Verify:** sanity 188/188 PASS (3 new v6.3 checks), seed stub 9/9,
`node --check` + `py_compile` OK. Home rendered from the real CSS
and visually checked: `../ui-screenshots/v6.3/1-home-no-topbar.png`
(no top bar, hero starts the page, Chef's Pick card visible on the
right). NOT verified live: the user must pull + build + clear-cache +
restart, then open Home — the top bar must be gone and the hero must
show a pick card.

## v7.0 — UI/UX overhaul + functional fixes (2026-11-16)

Layout mapping (the brief swaps left/right vs the CHILI layout — sides
were NOT swapped): the brief's "left sidebar (cart panel)" is our RIGHT
order/cart panel (widened 300px → 360px); the brief's "right sidebar
(navigation)" is our LEFT icon nav rail (redesigned). All v6.x behaviour
is kept: v6.1 guided Day Open/Close, v6.2 closing-page fixes, v6.3
top-bar hide, single branch, auto-KOT, bill only at settle, no tax,
flat-Rs discount with the Rs 100 Manager-PIN cap, one-tab printing.

**1. Opening flow + true full-viewport:**
- (a) Verified, no change needed: the v6.1 guided "Open the Day" card
  already prompts opening balances — one Rs input per profile payment
  mode (Cash in the drawer first, autofocus), with 3 numbered steps,
  before the day opens.
- (b) The boxed frame is gone: `.fpos-wrapper` was `calc(100vw - 24px)`
  × `calc(100vh - 24px)` with `margin: 12px`, `border-radius: 20px`
  and a frame ring shadow — now `100vw` × `100vh`, `margin: 0`,
  `radius: 0`, no shadow. The home bottom nav (`.fpos-home-nav`) was
  absolute-anchored to the shell — the override is deleted and the
  base `position: fixed; bottom: 0` rule governs again. Closing page,
  drawers, print preview and top bar are unaffected (they are fixed
  overlays / views inside the wrapper).

**2. Premium icon library (real Lucide):**
- All 40 UI keys in `FPOS_ICONS` (`food_pos.js:19`) now use the REAL
  inner SVG markup copied from `lucide-static` v1.73.0 (installed via
  npm into `/tmp/lucide`; 2,359 icons available) — 24×24 viewBox,
  `stroke: currentColor`, `stroke-width: 2`, `fill: none`, round
  caps/joins via the existing `.fpos-ic` CSS (stroke-width raised
  1.8 → 2). No paths were hand-invented. Same keys, so every call
  site keeps working; one new key added: `arrowLeft` (back buttons).
  The food-photo fallbacks (`fpos-food-*` gradients + food SVGs on
  item cards) are separate and untouched.

**3. POS screen:**
- Cart panel widened 300px → 360px on desktop only
  (`@media (min-width: 901px)`), so the ≤900px/≤700px responsive
  rules still win on small screens.
- Item grid is EXACTLY 5 cards per row on desktop (≥1280px), 4 at
  ≤1279px, 3 at ≤900px, 2 at ≤640px. Fix found during screenshot
  verification: an old "Zone 3" rule set the grid with `!important`
  (`repeat(auto-fill, minmax(180px, 1fr)) !important`), which beat
  the new plain rule and rendered 4 columns — the v7 grid rules now
  carry `!important` too and come later in the file, so they win.
- 5-col card sizing (1280–1599px): media/photo 110px → 88px,
  details padding 8px 10px, title 13px wrapping to 2 lines instead
  of truncating (a second screenshot pass caught "Chicken Tikka
  Piz…" being cut off — titles now wrap, `line-clamp: 2`), footer
  stacks (rate on top, Add/stepper full-width below), Add button
  32px/12px, stepper centred.
- Left nav rail redesigned: 88px wide, 14px/10px padding, 6px gap,
  60px items, 14px radius, smooth transitions, active = orange fill
  + a 4px orange bar on the left edge (`::before`), hairline divider
  above Logout, badge moved to top 6px / right 8px.

**4. Tables:**
- Seed 8 tables: `SEED_TABLES` in `foodpos/patches/v0_4_0/add_seed_data.py`
  now T1–T8 (T7/T8 added, Family Hall, 6 seats). The on-demand path
  in `get_available_tables` (`food_pos.py`) calls the same
  `_ensure_tables()`, so it creates 8 too. Seed stub updated:
  35 → 37 docs on run 1.
- The cart panel's table/order chip now opens the FULL-PAGE tables
  view (`set_view("tables")`) instead of the "Select Table for
  Dine-In" dialog. Picking a table while a Dine-In cart is waiting
  assigns that table to the cart (no new tab); tapping an occupied
  table switches to its existing tab; otherwise a fresh Dine-In tab
  is created as before.
- Live occupied timer verified: it renders on table cards
  (`.fpos-table-time` with `data-since` + `format_elapsed`, ticked
  every 1s by `start_home_timers()`). One real bug fixed: the tick
  rewrote the element's text with `"⏱ " + elapsed`, wiping the
  timer icon on the first tick — it now updates only the
  `.fpos-table-time-val` span (timer markups in the tables view,
  the table selector and the report rows wrap the elapsed text in
  that span).
- Auto-KOT print on table booking: after a successful Confirm for a
  dine-in/table order, the KOT slip auto-opens in the EXISTING
  centered print-preview dialog (`open_kot_slip` — no new tab, no
  print call from the opener; the cashier taps Print once). Live
  KDS remains the kitchen ticket. Non-table orders keep the v5.10
  behaviour (no auto slip). The customer bill is still printed ONLY
  at settle, never at confirm.
- Bonus fix found by the v7 screenshot: the tables floor rendered
  narrow (~430px, centred) because `.fpos-tables-view` had
  `max-width: 1100px; margin: 0 auto` with no width — as a flex item
  in the column flex wrapper it shrink-wrapped to its content.
  The shared rule for the tables/attendance/report views now has
  `width: 100%`, and the floor grid is `repeat(auto-fill,
  minmax(300px, 1fr))` so it stays 3 large cards per row on desktop
  (the v3/v4 look), 2/1 on smaller screens.

**5. Pending Invoices as a full page (not a drawer):**
- The v5.12 Pending drawer is gone: `show_pending_drawer` /
  `hide_pending_drawer` / `render_pending_kots` and the
  `.fpos-pending-drawer` markup are removed (verified: 0 references
  left). `set_view` now has a `pending` view
  (`.fpos-pending-view` — header with Back, title, count pill and
  search bar; body max-width 1100px, scrollable, 96px bottom
  padding).
- Sidebar Pending nav opens the page and stays highlighted (the
  v5.12 re-activate-menu hack is gone); the live count badge is
  kept (still driven by `update_kitchen_badge`).
- The page lists all active/pending bills from the existing
  `get_active_kitchen_kots` source (server pricing unchanged):
  search filters by KOT/invoice number, table, or customer
  (KOT name, order_id, table_no, customer); per-bill Preview
  (existing `print_pending_bill` → centered preview, unpaid bill)
  and Settle & Print Bill (existing `resume_kot_for_payment`) +
  Print Bill actions; summary bar (N pending bills • Total Due);
  empty state and "No bills match your search" state.

**6. Back navigation + refresh persistence:**
- Lightweight view history: `set_view` calls `_record_view(name)`
  (`history.pushState({ fpos_view: name })` + `sessionStorage`
  `fpos_current_view`), skipping when restoring or when the view is
  unchanged; `_bind_view_history` adds a guarded `popstate`
  listener that restores the exact previous view without pushing.
  `show_closing_page` records "closing"; `hide_closing_page` was
  rewritten to hide the closing page and call `set_view("pos")` —
  this also fixes a latent bug where it showed `.fpos-body`
  directly without restoring the `fpos-view-pos` class (so the top
  bar would stay hidden after closing the page).
- `go_back(fallback)`: `history.back()` when our stack has an
  entry, else `show_home()` / `show_pos()`. Back buttons now use
  it: tables/attendance/report "Home" buttons → "Back" with the
  Lucide arrow-left icon → `go_back("home")`; closing-page
  "Back to POS" → `go_back("pos")`; pending page Back →
  `go_back("pos")`.
- Refresh persistence: on init, after the day status loads, the
  saved view is restored when the day is open (pos/tables/pending/
  attendance/report/closing as applicable), otherwise Home is
  always the first screen. Drawers/dialogs are not persisted.
- Escape: closes popovers/drawers first, then on pending/closing
  goes back to POS, on tables/attendance/report goes back to Home,
  on pos/home does nothing. The old drawer-close call is gone.

**Verify:** `node --check` OK, `py_compile` OK,
`scratch/v5_sanity.py` **207/207 PASS** (18 new v7 checks),
`scratch/v5_seed_test.py` **9/9 PASS** (37 docs run 1, 0 run 2).
Screenshots rendered from the real `food_pos.css` with headless
Chromium and visually checked in `../ui-screenshots/v7/`:
`1-home-fullscreen.png` (no frame, no top bar, hero + Your Day +
bottom nav pinned), `2-pos-5col.png` (probe-measured at 1280px:
exactly 5 columns, card width 143px, media 88px, cart panel 361px),
`3-tables-8.png` (8 tables, 3 large per row, timers 24:16 / 08:42),
`4-pending-page.png` (search + 3 bill cards + Print/Settle).
NOT verified live: needs pull + build + clear-cache + restart,
then a full bench pass (open day → table order → Confirm shows the
KOT preview → Pay → receipt; Pending page search/settle; refresh
on the Pending page restores it; Back button on tables/closing).

## v7.1 — Fix all 16 issues from the v7.0 live bench test (2026-11-16 23:27 PKT)

Live test of v7.0 (2026-11-16 23:12-23:22 PKT, Administrator, ~1247px
viewport; test order Table T6, 1x 7UP, KOT FKOT-2026-00008, invoice
BR1-2026-00007 Rs 120 Cash) found 16 issues. All fixed here; user said
"Han, sab 16 issues fix kar do". No push, no zip sent — kept ready locally.

- **#1 Home day times empty on first load:** two causes. (a) Server
  `_day_times_from_opening` read `frappe.db.get_value(..., fields)` with a
  1-field list, which returns a scalar — the old `vals[0]`/`vals[1]`
  indexing read characters of the time string; now maps by field name and
  normalises Time values ("11:43:00") to HH:MM via `_format_time_hh_mm`;
  cache fallback is now per-field (was only when BOTH were empty). (b) The
  v0.3.0 custom fields never landed on sites whose migrate never ran, so
  times only ever lived in cache, which `bench clear-cache` wipes — new
  shared `_ensure_custom_fields` / `_ensure_day_time_fields` creates them
  on demand (same definitions as the patches). Client keeps a localStorage
  copy per opening entry as a third layer, so a fresh load never shows
  "--:--" for times already set.
- **#2 Bottom table-chips strip:** (a) avatar read "TT6" — `table_no` is
  already "T6" and the code prefixed another "T"; now strips one leading
  T before prefixing. (b) T6 appeared twice — `open_table_order` created
  a second tab when the table's tab was already active, and the strip had
  no dedupe; now any existing tab is reused, and `render_table_chips`
  dedupes by table (confirmed/with-items tab wins). (c) Strip clipped and
  floated mid-page — view containers now `flex: 1` inside the new
  `.fpos-main-row`, chips bar `flex-shrink: 0` (it already scrolled
  horizontally).
- **#3 CRITICAL — closing page never unmounted:** `set_view` never hid the
  closing page element, and Back went through history/popstate, so the POS
  grid rendered ON TOP of the closing page (only a reload cleared it).
  Now `set_view` hides+empties `.fpos-closing-page` for every non-closing
  view; `show_closing_page` goes through `set_view("closing")` and records
  the origin view (`_closing_return_view`); the Back button calls
  `hide_closing_page()`, which restores the recorded origin (POS from
  Accounts, Home from Close Day) and the button label says so ("Back to
  Home" / "Back to POS").
- **#4 Only 6 tables:** `get_available_tables` only created tables when
  the count was 0; now it tops up whenever fewer than the 8 seed tables
  exist (`_ensure_tables()` is idempotent — creates only the missing T7/T8,
  never deletes or renumbers).
- **#5 Home boxed column:** removed the 1100px `max-width` + `margin: auto`
  caps on `.fpos-home`, the tables/attendance/report views, and the pending
  head/body — all stretch full-viewport width like the POS screen.
- **#6 POS top bar missing + 4-col grid + clipped categories:** root cause
  of the missing top bar — `set_view` toggled `fpos-view-pos` on the outer
  `.page-content` wrapper, but the CSS hide rule checks `.fpos-wrapper`
  itself, so after v6.3 added `!important` the hide rule always won; the
  class is now toggled on `.fpos-wrapper` (same fix for the hamburger
  collapse class). 5-col breakpoint lowered: 5 columns now stay down to
  1024px (was 1280px), so a ~1247px laptop shows 5. Category tiles are
  `flex: 0 0 auto` with full labels — the row scrolls instead of
  ellipsising ("Sandwi…", "Drinks &…" gone).
- **#7 Rail missing off the POS screen:** the nav rail lived inside
  `.fpos-body`, hidden on every other view. `render_layout` now puts the
  rail in a shared `.fpos-main-row` (flex row) with the nav + all views +
  closing page, so the rail stays visible on Home, Tables, Pending,
  closing, Attendance and Report.
- **#8 Active highlight lagged one step:** only the click handler set it.
  New central `_sync_nav(name)` runs from `set_view` on every navigation
  (clicks, home tiles, browser Back/popstate, programmatic `show_*`).
- **#9 Back from Tables blank-screened:** after a reload the home view had
  never rendered and `show_home` awaited two server calls before painting
  anything. It now paints a loading skeleton synchronously first.
- **#10 7UP shows a Fanta photo — NOT a code bug, no code change:**
  verified in code: `item_media_html` renders exactly the Item's own
  `item.image` field (`item.image AS item_image` in `get_items`) and
  `home_dish_photo_html` uses the matched item's own image — no cross-item
  mapping anywhere. The 7UP Item in the user's ERPNext has a Fanta image
  set; fix the image on the 7UP Item in Desk.
- **#11 Dine-in recorded as Takeaway:** root cause — the v0.1.0 custom
  fields never existed on pos.local, so the `has_field()` guards silently
  skipped storing `custom_order_type`/`custom_table` and the display
  fallback had no table to derive from (the receipt was right because it
  is built from in-memory order data). Fixed at the source: new
  `_ensure_invoice_custom_fields` creates the fields on demand (options
  now include "Walk In", which v5.8 never added to the invoice field) and
  runs at the start of `submit_pos_invoice` (page module) and
  `create_pos_invoice` (api module, split-bill path); when an invoice
  settles a KOT, the KOT's `order_type` + `table` are copied in when the
  client did not send them.
- **#12 FKOT-2026-00002 missing from Pending — REAL BUG, fixed:** Food KOT
  status "Served" (food delivered, payment still pending) was excluded by
  `get_active_kitchen_kots` (filter was Pending/In Progress/Ready only),
  so a Served KOT vanished from both the KDS drawer and the Pending page
  even though unsettled. "Served" is now in the filter (same function
  feeds both views) with its own teal pill colour on both.
- **#13 Table kept "Guests: 1" after freeing:** the settle path freed the
  table but never cleared `guests` (force_free_table already did). Now
  sets `guests: 0` on settle.
- **#14 Two stacked dialogs at settle:** the receipt modal (already with
  the green Payment Successful banner) auto-opened the print-preview
  dialog on top of itself. Auto-open removed; the "Auto Print Slip"
  checkbox, its handler and its reset code removed too. Settle shows ONE
  dialog; printing stays one tap away via the receipt's "Print Slip".
- **#15 Minor:** (a) print preview fades in fast now — `backdrop-filter:
  blur(2px)` removed from the overlay, explicit 120ms `fpos-fade-in`
  animation added. (b) "Count the Cash" intro clipped on first render —
  `.fpos-closing-page` gets `overflow-x: hidden` plus `min-width: 0` on
  the header's left block and `flex-shrink: 0` on the pill. (c) Closing
  action buttons were duplicated top + bottom — top row removed, single
  bottom row (Back / Print Z-Report / Close Day).
- **#16 Pending search lost on refresh:** the search term now persists in
  `sessionStorage` (`fpos_pending_search`) and is restored + re-applied
  when the page rebuilds.

**Verify:** `node --check` OK, `py_compile` OK on both changed .py files,
`scratch/v5_sanity.py` **227/227 PASS** (20 new v7.1 checks),
`scratch/v5_seed_test.py` **9/9 PASS**, `window.open` count 0 in page JS.
Screenshots rendered from the real `food_pos.css` with headless Chromium
and visually checked in `../ui-screenshots/v7.1/`: `1-home.png` (full-width
hero, rail visible, day times 11:43 AM / 09:44 PM loaded),
`2-pos-5col.png` (at 1247px: top bar with search + Filters visible,
exactly 5 cards/row, "Sandwiches" / "Sides & Extras" / "Drinks &
Beverages" / "Combo Deals" in full), `3-tables-8.png` (8 tables, rail
with Tables active), `4-pending-page.png` (rail with Pending active,
search "FKOT-2026-00003" kept, FKOT-2026-00002 listed),
`5-closing-page.png` (rail with Accounts active, "Count the Cash" intro
in full, ONE bottom action row). NOT verified live: needs pull + build +
clear-cache + restart, then a full bench pass (the 16 issues above, esp.
closing-page Back on both routes, T7/T8 appearing, day times surviving a
fresh load, FKOT-2026-00002 reappearing in Pending, settle showing one
dialog). Manager PIN untouched (still 1234). Nothing settled/deleted.
