# TEST REPORT — Food POS v5 (premium vibe)

## v6.0 — Warm restaurant redesign (2026-11-15)

- User brief: premium modern full-screen restaurant POS, warm
  cream/white/orange/dark-brown palette, no Frappe black-and-white look,
  instant search (name/code/barcode), food cards with images, cart panel,
  simple checkout/payment/customer/order flow, all dialogs centered and
  beautiful, payment success/error/loading/confirmation dialogs,
  touchscreen + keyboard friendly. Implemented in the existing project:
  re-themed (107 brand-color sites + vars + hero), barcode search
  (server + client), Enter-to-add, "/" shortcut, centered warm Frappe
  dialogs, Payment Successful banner, bigger touch targets. No logic,
  pricing, tax, stock, cart or invoice behavior changed.
- Sanity **175/175 PASS**, seed stub **9/9 PASS**. NOT verified live: user
  must pull v6.0 + build + clear-cache + restart, then check the warm
  theme, search by barcode, "/" focus, and a full order → pay → receipt.

## v5.12 — Pending Payments sidebar logic (2026-11-15)

- User question: after the kitchen slip prints and the customer waits for
  the food, where does the cashier print that pending-payment bill from?
  Answer built: sidebar Pending item + badge + drawer (Settle & Print
  Bill / Print Bill). Pricing comes from the server (KOT items + total).
- Sanity **166/166 PASS**, seed stub **9/9 PASS**. NOT verified live: user
  must pull v5.12 + build + clear-cache + restart, then check the sidebar
  Pending badge count, open the drawer, and print + settle a pending bill
  (the 3 test KOTs FKOT-2026-00002/00003/00004 are still unbilled).

## v5.11 — single-tab print preview + menu scroll (2026-11-15)

- User feedback: too many separate tabs were opening; everything must stay
  in ONE tab, print must be a centered dialog (nothing separate), preview
  and print nicely designed; the menu grid did not scroll so not all items
  were reachable. Fix: `show_print_preview()` shared dialog for bill/KOT/
  Z-report (3 call sites, 0 `window.open` left); menu scroll root cause was
  the missing `min-height: 0` on `.fpos-menu-main` (flex column never
  shrank below full content height). Preview rendered from the real CSS
  and visually checked (centered card, paper slip, green Print button).
- Sanity **160/160 PASS**, seed stub **9/9 PASS**. NOT verified live: user
  must pull v5.11 + build + clear-cache + restart, then check: no new tab
  opens on any print; the preview dialog is centered with the slip; the
  menu grid scrolls to the last item.

## v5.10 — direct confirm→Pay freeze STILL present in v5.9 (2026-11-15)

- Live bench re-test (agent, as Administrator) of v5.9 after pull + migrate
  + Custom Field is_billing_contact + build + restart: tables T1–T6 FIXED
  (floor shows 6, all Available); sync pill FIXED — manual retry synced both
  queued invoices → BR1-2026-00001 + BR1-2026-00002 (Rs 120 each), Today's
  Sales Rs 240; KDS drawer FIXED — cards render with Settle & Print Bill,
  settling FKOT-2026-00001 produced Invoice BR1-2026-00003 (Rs 120, Cash),
  Today's Sales Rs 360 / 3 orders; the is_billing_contact MySQL error is
  GONE everywhere. Stale "− 1 +" stepper gone.
- BUT direct Confirm → Pay & Print Bill STILL froze the page (KOT
  FKOT-2026-00004 created, Pay never opened, Filters/Tables dead; freeze
  text lingered in DOM). v5.9's in-tab print did NOT fix it — the print
  dialog itself is the blocker. v5.10 removes auto slip/print from Confirm
  entirely; paper slip is one tap away on the KOT card.
- Still unbilled test KOTs: FKOT-2026-00002, FKOT-2026-00003, FKOT-2026-00004
  (1× 7UP, Rs 120 each) — payable via drawer Settle. Minor known lags:
  home KDS count reads "0 active" right after reload until the drawer is
  opened; Today's Sales lags one reload behind a new payment.
- Sanity **154/154 PASS**, seed stub **9/9 PASS**. NOT verified live: user
  must pull v5.10 + build + clear-cache + restart, then re-test the direct
  flow — Confirm → Pay opens immediately → Cash → invoice + receipt.

## v5.9 — post-confirm click death + KDS settle + tables/sync (2026-11-15)

- Live bench diagnostic (agent, as Administrator): Confirm works (KOT
  FKOT-2026-00002 created), but afterwards the WHOLE page stops accepting
  clicks — Pay, Filters, toast ×, Tables, Home all dead; reload restores
  it. Pay button itself is enabled (not `[disabled]`); the freeze text
  "Confirming order…" lingered 25s+. Root cause: opener-side
  `win.print()` in `print_kot_slip` (same in Z-report print). Fixed in-tab.
- Same runs: KDS drawer showed count only (2 active, no cards listed —
  drawer body only fills on open); now each card has Settle & Print Bill.
  Cart was empty after reload with a stale "− 1 +" stepper; backup/draft
  guards + grid resync added. Home sync pill was plain text, not a button;
  now a manual retry that toasts the real failure. Tables still 0 after
  the user's migrate — the seed patch never ran on that site (Patch Log /
  `is_billing_contact` console checks still awaited from the user); tables
  are now also created on demand by `get_available_tables`.
- Sanity **148/148 PASS**, seed stub **9/9 PASS**. NOT verified live: user
  must pull v5.9 + migrate (for the doctype/column/patch side), then re-test
  the full flow — confirm → Pay works immediately → bill prints → tables
  T1–T6 visible → sync pill clears the 2 queued invoices (or shows why not).

## v5.8 — Walk-In order_type fix (2026-11-15)

- Live bench re-test (agent, as Administrator): the v5.7 station error is
  GONE (stations exist now — created on demand by the v5.7 helper), but
  Confirm failed with a NEW error: 'Order Type cannot be "Walk In". It
  should be one of "Dine In", "Takeaway", "Delivery"'. Root cause: both
  order_type Selects missed "Walk In". Fixed in both JSONs. Sanity
  **136/136 PASS**, seed stub **9/9 PASS**.
- Same re-test proved the user's migrate did NOT run/complete: tables
  T1–T6 still absent (seed patch runs only on migrate) AND
  `tabContact.is_billing_contact` still missing (ERPNext schema sync
  runs only on migrate). Payment error therefore unchanged. The 2
  offline-queued test bills ("2 pending sync") did not auto-sync.
- NOT verified live: user must pull + run a COMPLETE `bench migrate`
  (and confirm it finishes without error), then re-test confirm + pay.

## v5.7 — kitchen station link fix (2026-11-15)

- Live bench test (agent, as Administrator on the user's ngrok bench)
  reproduced BOTH errors: Confirm to Kitchen failed with "Could not
  find Branch: Main Branch, Kitchen Station: Main Kitchen" (no KOT
  created), and Pay & Print Bill still failed with ERPNext's
  `Unknown column 'tabContact.is_billing_contact'`. Page itself loads
  fine past the spinner (v5.6 fix works); day was already open; menu
  shows the user's own 35 items; tables floor was empty (0 tables).
- Root cause found by reading the code + original v1 repo: `create_kot`
  stored the bare station name in a Link field whose docnames are
  "Main Branch-<station>" — it could never validate. Fixed to store
  the docname + ensure the station doc on demand; seed patch now also
  creates all 4 stations. `py_compile` OK, sanity **134/134 PASS**,
  seed stub **9/9 PASS** (35 docs on run 1, idempotent on run 2).
- NOT verified live: the user must pull + `bench migrate` first — that
  one command fixes the ERPNext column AND seeds branch/tables/stations.
  Re-test confirm + payment after migrate.

## v5.6 — custom_branch crash fix (2026-11-14)

- Reproduced from the user's traceback: `get_pos_profiles` line 83
  selected `custom_branch`; the column is created only by patch v0.1.0,
  so a site without a completed migrate crashed the page load.
- Fix: `custom_branch` removed from that SELECT (legacy field, unused —
  branch is always `SINGLE_BRANCH`). `py_compile` OK, sanity
  **129/129 PASS** (was 127/127), seed stub still **8/8 PASS**.
- Live bench verification is the user's: pull + migrate per BENCH-TEST-v5.md.

## v5.5 — Seed data on migrate (2026-11-14)

- `python3 -m py_compile` OK on the patch. Stub test
  `scratch/v5_seed_test.py` **8/8 PASS**: run 1 creates exactly 31 docs
  (1 Price List, 6 Item Groups, 8 Items, 8 Item Prices, 1 Branch,
  6 Restaurant Tables, 1 POS Profile); run 2 creates nothing new;
  a pre-existing POS Profile is never duplicated while items are still
  seeded; the seed profile carries all 6 item groups + warehouse + PKR.
  Logic sanity **127/127 PASS** (was 120/120).
- NOT verified on a live bench (no Frappe here): the patch has only been
  proven against the stub — first real `bench migrate` on the user's site
  is the live test (see BENCH-TEST-v5.md, new seed section).

## v5.4 — Home restaurant feel (2026-11-14)

- `node --check food_pos.js` OK. Logic sanity **120/120 PASS** (was 109/109):
  hero present in JS+CSS, time-based greeting, Day Open + sync pills in
  hero, Chef's Pick from today's top item with cached-menu photo or SVG
  fallback, Popular strip = top 3 (hidden when no sales), pick/popular open
  the menu, home uses only the 3 existing endpoints, shift/stats/tiles/
  recent intact, plain brand row gone.
- Screenshots re-rendered from the v5 code and visually checked (1-home at
  1280×1180 so the whole home fits): hero + Chef's Pick photo card, warm
  shift card, tinted tiles, Popular Today with 3 real food photos, Recent
  Orders below. Photo crop tuned to center 35% (burger bun + patty and
  chowmein noodles both read well). POS screenshots unchanged.
- NOT pushed: v5.4 is local only; GitHub main still has v5.3.

## v5.3 — Filters in the top bar, same row as search (2026-11-14)

- `node --check food_pos.js` OK. Logic sanity **109/109 PASS** (was 106/106):
  no filter-bar row in JS/CSS, Filters wrapper sits inside
  `.fpos-header-center` (between search and header-right), not inside the
  cat row, button has the new sliders icon and matches the 44px search height.
- Screenshots re-rendered from the v5 code and visually checked: the Filters
  button (sliders icon + "Filters ▾") is in the top bar in the same row as
  the search field, right beside it; no filter row below the search bar; the
  category-tiles row is tiles-only; no-Tax totals unchanged (Rs 1,000 →
  Rs 900 with Rs 100 discount).

## v5.2 — NO TAX, discount is flat Rs only (2026-11-14)

- `node --check food_pos.js` OK; `python3 -m py_compile` OK on the API and
  page Python files.
- Logic sanity **106/106 PASS** (was 91/91): 15 new checks — no tax row, no
  tax-rate read, no Taxes & Charges line, no tax on receipt/reports, totals
  are flat-Rs discount clamped to subtotal with no tax in the grand total,
  dialog has no % field and Rs-only presets, cap is Rs 100 client + server,
  stale % never restored, server has no % discount path and clears the invoice
  taxes table.
- Billing-rule grep unchanged: `show_pos_slip` exactly 5× (settle call +
  definition + reprint + 2 comment mentions).
- Screenshots re-rendered from the v5 code and visually checked: menu shows
  Subtotal Rs 1,000 → Total Due Rs 1,000 with no Tax row; order panel shows
  Subtotal Rs 1,000 − Discount Rs 100 → Total Due **Rs 900**, no Tax row;
  Payment Pending banner intact.

## v5.1 fix — Filters below the search bar (2026-11-14)

- `node --check food_pos.js` OK after moving the Filters wrapper out of
  `.fpos-cat-row` into the new `.fpos-filter-bar` (delegated click wiring
  untouched, so the popover still works).
- Logic sanity **91/91 PASS** (was 90/90 — one new check: filter-bar present
  in JS + CSS, Filters wrapper not inside the cat row).
- Screenshots re-rendered from the v5 code and visually checked: the Filters
  button is now in its own row directly below the search bar, left-aligned;
  the category-tiles row has no Filters button at its right end; everything
  else (photos, order panel, Payment Pending banner) is unchanged.

> Static verification only. No live Frappe bench exists in this environment,
> so **live-bench testing is NOT verified** — see BENCH-TEST-v5.md for the
> checks the user must run on their bench (install + migrate, Day Open/Close,
> real dine-in flow, thermal printing, and the new home stats / recent strip
> reading live data).

## 1. Syntax checks

| Check | Result |
|---|---|
| `python3 -m py_compile` on every changed `.py` (`food_pos.py`, `foodpos/api/food_pos.py`) | OK — no errors (no `.py` file was changed in v5; compile run to confirm) |
| `node --check` on changed `food_pos.js` | OK |
| `python3 scratch/v5_sanity.py` | **90/90 PASS** (see §3) |
| CSS syntax | Valid — parsed by Playwright/Chromium for all 4 previews with no errors; no unclosed rules (v5 section appended cleanly at end of file) |

## 2. Diff scope (vs v4-chili-layout)

`diff -rq` between `v4-chili-layout/` and `v5-premium-vibe/`:

- **Changed:** `foodpos/foodpos/page/food_pos/food_pos.css`,
  `foodpos/foodpos/page/food_pos/food_pos.js` — and nothing else.
- **Added:** `CHANGELOG-v5.md`, `TEST-REPORT-v5.md`, `BENCH-TEST-v5.md`,
  `scratch/v5_sanity.py`, `scratch/v5_previews.py`.
- `__pycache__/` dirs created by `py_compile` were removed before zipping.
- No server `.py`, no DocType JSON, no patches, no `public/` files touched.
  The stale orange v1 stylesheet `foodpos/public/css/food_pos.css` was left
  untouched (it is not referenced by the page — v4 didn't touch it either).

## 3. Logic sanity — 90/90 PASS

`scratch/v5_sanity.py` re-runs every v4 check plus v5 additions. All pass,
including:

- v4 layout removals still hold (no category sidebar / filter bar / tabs bar /
  segmented control / cart-meta), CHILI structure intact (cat row, 3-col grid,
  300px right panel, bottom chips with free-table chips, hamburger collapse).
- Single branch: `FPOS_SINGLE_BRANCH` present; no `branch_selector` /
  `switch_branch` / `select_branch` / `fpos-branch` strings.
- Auto-KOT: `confirm_order()` + `payment_pending` present; KOT guard comment
  present; `send_to_kitchen()` is still just the confirm alias.
- **Billing rule (grep proof, identical to v4):** `show_pos_slip` occurs
  exactly **5** times in `food_pos.js`:
  - line ~2246 (guard comment: "NO show_pos_slip / print_pos_slip …"),
  - line ~3099 `this.show_pos_slip(receipt_data, true);` — inside
    `process_invoice_submission` (settle only),
  - line ~3172 the `show_pos_slip(receipt_data, is_settlement)` definition,
  - line ~3681 the reprint call from Recent Orders,
  - line ~2245 (comment reference "show_pos_slip, line ~3693").
  No call exists on the confirm/KOT path. Pending-banner text
  ("No bill has been given…") unchanged.
- v5 additions: 10 food SVG icons in `FPOS_ICONS`; **zero food emoji** left
  in `food_pos.js` (was 9 emoji literals in `classify_fast_food_item` + the
  card fallback); `item_media_html()` helper + `.fpos-item-photo` /
  `.fpos-item-photo-fallback` + 10 `.fpos-food-*` gradient classes;
  Plus Jakarta Sans stack; warm bg `#f7f5f0`; gold vars; layered shadow var;
  hairline `#e8e4da`; 18px radii; Total Due gold 20px/800 tabular;
  item title 15px/600 + desc 12.5px warm grey; cat-tile icon circle + active
  glow (gold halo + inset green border); order-type tab transition; pay-method
  selected shadow; Pay-button green gradient; Confirm outline kept; discount
  gold pill; stepper green pill; chip dots; home stats reusing
  `get_daily_report` (no new endpoint) with sales/orders/avg/top fields;
  home recent strip reusing `this.recent_orders`, latest 3, refreshed on
  `load_recent_orders`, with PAID/UNPAID pills; chairs wood-only (status tint
  removed) with slatted backrest + seat + legs; table-top wood grain;
  floor-shadow ellipse; home/tables views scrollable; hover/active states.

## 4. Screenshot verification (Playwright, 1280×860, read back with eyes)

Generated by `scratch/v5_previews.py` from the real v5 CSS/classes into
`~/workspace/foodpos/ui-screenshots/v5/` (HTML + PNG for each screen).
Banner on each: "PREVIEW — Food POS v5 premium vibe (static mock from v5
code, not a live bench screenshot)".

| Screen | What was checked | Result |
|---|---|---|
| 1-home | Stats row (Today's Sales gold Rs 48,250.00 / Orders 32 / Avg Bill Rs 1,507.81 / Top Item Chicken Tikka Pizza ×14) above tiles; Recent Orders strip (3 rows, PAID/UNPAID pills, View all) below tiles; no dead empty space; Day Open card + bottom nav unchanged; warm bg, soft shadows | PASS — everything fits above the bottom nav at 860px after the v5 spacing tightening (first render had the strip cut off by the nav; fixed by 3 rows + tighter spacing, re-rendered and re-checked) |
| 2-menu | All 6 item cards show **real food photos** (pizza, burger, chowmein, margherita, soup, fries — verified genuine JPEGs, see §5); no letters; cat tiles with tinted icon circles, "Main Course" fully visible (first render truncated it; fixed by 22px icon circle + 6px tile padding, re-rendered and re-checked); active "All" tile glow; gold Total Due Rs 1,050; gradient Pay button; chip dots | PASS |
| 3-tables | Chairs are real wooden chairs (slatted backrest + seat + legs, wood tones — no longer mint/pink); wood grain on table tops; floor shadow under tables; status pills + dots + live timers (tabular) unchanged | PASS — bottom row still cut off at 860px, same as v4 (grid scrolls in real use; accepted v4 precedent) |
| 4-order-panel | Pending banner shown; discount gold pill "-Rs 100.00" with reconciled totals (1,000 − 100 + 45 tax = 945); gold Total Due Rs 945; gradient Pay button; Confirm outline; chip dots (gold = in kitchen, green = ordering/available) | PASS |

### Fallback-tile check (separate render, /tmp)

All 6 preview cards use real photos, so the no-photo fallback was verified
separately: a test page with all 10 fallback tiles (pizza/burger/noodle/soup/
fries/sandwich/drink/dessert/combo/plate) rendered from the real v5 CSS and
screenshotted — every tile shows a warm gradient with a proper SVG food icon
in a white circle. **No bare letters, no emoji.** Screenshot kept at
`/tmp/v5_fallback_test.png` (ephemeral; regenerate with the v5 CSS if needed).

## 5. Photos used in previews

All 6 downloaded and verified in `ui-screenshots/v5/assets/` — **none missing**:

| Photo | File | Size | Used for |
|---|---|---|---|
| pizza.jpg | 1440×1081 | 304 KB | Chicken Tikka Pizza |
| burger.jpg | 800×800 | 112 KB | Zinger Burger |
| chowmein.jpg | 1200×1800 | 101 KB | Chicken Chowmein |
| margherita.jpg | 2310×2310 | 1.5 MB | — original kept; preview uses the 900×900 downscaled copy below |
| margherita-preview.jpg | 900×900 | 136 KB | Margherita Pizza (downscaled copy, original untouched) |
| soup.jpg | 1024×764 | 89 KB | Hot & Sour Soup |
| fries.jpg | 1024×1024 | 164 KB | Fries & Cheese |

All are genuine JPEGs (checked with `file`) and were visually confirmed as
real food photos (pizza.jpg and chowmein.jpg read directly; the rest render
correctly in the screenshots).

## 6. Issues found and fixed during verification

1. **"Main Course" tile truncated** in the first menu render — the 26px icon
   circle was too wide. Fixed: 22px circle, 6px gap, 6px tile padding.
   Re-rendered: fits.
2. **Home Recent Orders strip cut off by the bottom nav** in the first home
   render (4 rows + v4 spacing overflowed 860px). Fixed: strip shows latest
   3 rows (within the brief's "3–4") + tightened home spacing (shift card,
   tiles, stats, recent padding/margins). Re-rendered: fits, views still
   scroll on shorter screens.

## 7. Not verified — needs the user's live bench

- Live Frappe bench testing (no bench exists here): install + migrate,
  Day Open/Close end-to-end, real dine-in flow, free-table chip tap,
  real thermal printer (80/58mm KOT + bill + reprint).
- Home stats / recent strip reading **live** data: the code reuses existing
  endpoints (`get_daily_report`, `get_recent_pos_orders`) and fails soft to
  "—" / empty state, but the live values have not been seen on a bench.
- Plus Jakarta Sans on the bench: the app CSS falls back to Inter/system-ui
  if the font is not installed (offline-safe by design); the premium look
  on the bench will use the fallback unless the font is present.
- Item photos on the bench depend on each ERPNext Item having an Image set;
  items without one show the gradient+SVG fallback (verified in the test
  render above).

## v6.1 — Day Open / Close clean VIP UI (2026-11-15 01:45 PKT)

- **What changed:** Day Open dialog → guided centered card (3 steps,
  big Rs cash inputs, one orange Open Day button); home shift card
  plain state + 3-step guide + full-width buttons; closing page
  plain-language pass (steps strip, "Count the Cash", "You Counted",
  "Close Day" button). No server/API change; `create_opening_voucher`
  still called with the same args; all closing bindings unchanged.
- **Static checks:** `node --check` OK, `py_compile` OK,
  `scratch/v5_sanity.py` **181/181 PASS** (6 new v6.1 checks),
  `scratch/v5_seed_test.py` **9/9 PASS**.
- **Visual check:** `../ui-screenshots/v6.1/1-day-open.png` rendered
  from the real `food_pos.css` — centered Open the Day card (steps,
  Cash Rs 5000 / Credit Card Rs 0, orange Open Day), closed-day shift
  card + close-steps strip behind it. Looks clean and premium.
- **NOT verified live:** Day Open/Close on the bench (day is OPEN on
  pos.local right now — the new Open card appears after the next
  Close Day; Close Day still needs Manager PIN, same as before).
