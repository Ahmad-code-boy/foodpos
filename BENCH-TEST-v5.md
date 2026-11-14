# Bench Test Checklist — Food POS v5 (premium vibe)

> Use this file on your own Frappe/ERPNext v16 bench. It is the v5 deploy/test
> guide for the folder you are reading (`v5-premium-vibe/`).
> **v5 is a visual polish release only — the v4 CHILI layout is frozen.**
> No panel, sidebar, tile row, button or screen position moved. Only colour,
> depth, type, photos, chairs and polish changed. No new DocType, no new
> server endpoint, no layout change.
> v5.5 adds ONE thing: a seed-data patch (`foodpos/patches/v0_4_0/
> add_seed_data.py`) that runs on `bench migrate` and creates demo data
> ONLY where the site has none (see section B1). Nothing here pushes to
> GitHub. Push only when you explicitly say so.

## A. Before you start (2 minutes)

- [ ] Bench backup: `bench --site <your-site> backup`
- [ ] Confirm this folder is the v5 copy (contains `CHANGELOG-v5.md` and
      `TEST-REPORT-v5.md`, and `foodpos/foodpos/single_branch.py`).
- [ ] Confirm your site is ERPNext v16 (v5 was built from v4, which was built
      from v3 → v2 → Ahmad-code-boy/foodpos v0.0.1).
- [ ] If you already run v4, v5 is a drop-in file replacement (same migrate
      as v4 — see B). If you run v2/v3, follow the v4 checklist first for the
      layout, then this one for the visuals.

## B. Install / replace and migrate

If the app is **not** installed yet:

```bash
cd ~/frappe-bench
bench get-app /path/to/v5-premium-vibe   # or push to GitHub first, then get-app by URL
bench --site <your-site> install-app foodpos
bench --site <your-site> migrate
bench build --app foodpos
bench clear-cache
bench restart
```

If the app is **already** installed (replacing v1/v2/v3/v4 files with v5):

```bash
cd ~/frappe-bench
# copy the whole app directory from v5-premium-vibe/ over apps/foodpos/
bench build --app foodpos
bench --site <your-site> migrate        # REQUIRED: creates Food POS Attendance + v0.3.0 day-time patch (same as v2 — v5 adds no new DocType)
bench clear-cache
bench restart
```

Verify migrate landed (bench console):

- [ ] DocType **Food POS Attendance** exists with 9 fields.
- [ ] POS Opening Entry has Custom Fields `custom_fpos_day_start_time` /
      `custom_fpos_day_end_time` (if the patch ran; before migrate the home
      screen falls back to a cache entry, so do not skip migrate).

### B1. v5.5 seed data — check what migrate created (only where missing)

The migrate log should print `foodpos seed:` lines. Then verify:

- [ ] **Item Groups**: Pizza, Burgers, Noodles, Soup, Fast Food, Beverages.
- [ ] **Items** (8, non-stock): Chicken Tikka Pizza 550, Margherita Pizza 520,
      Zinger Burger 450, Chicken Chowmein 480, Hot & Sour Soup 280,
      Fries & Cheese 220, Chicken Sandwich 350, Soft Drink 120 — each with an
      Item Price on **Standard Selling**.
- [ ] **Branch** "Main Branch" exists; **Restaurant Tables** T1–T4 (Main Hall,
      4 seats) + T5–T6 (Family Hall, 6 seats), all Available.
- [ ] **POS Profile "Food POS"** exists — ONLY if the site had no enabled POS
      Profile before. If you already had a profile, no second one is created
      (check: still exactly one profile / your old one untouched).
- [ ] Open `/food-pos` → the menu shows the 8 seed items in their categories
      and the tables floor shows T1–T6. If the menu is empty, check the POS
      Profile's Item Groups and the Standard Selling prices first.
- [ ] Seed items have **no photos** (by design) — cards show the gradient +
      SVG food icon until you add an Image to an Item. That is expected.
- [ ] Run `bench --site <your-site> migrate` a second time: the seed patch
      creates nothing new (check the log — no new `foodpos seed: created`
      lines).

## C. Smoke test — home screen (Day Open / Close)

Open `/food-pos` in a hard-refreshed browser.

- [ ] First screen is the **home screen** (no branch/register dialog pops up),
      inside the rounded white app shell on the pale warm frame.
- [ ] A static **"Main Branch"** label shows; there is **no Switch Branch** item.
- [ ] You can set **Day Start** and **Day End** times with the time inputs and save.
- [ ] **Open Day** works; the elapsed timer ticks every second without reload.
- [ ] Tiles **Walk In / Take Away / Delivery / Dine In** are all present.
- [ ] Bottom nav present: Orders, Dispatch, Cashier, KDS, Shifts, Staff,
      Attendance, Reports, Printer, Settings — all with clean SVG icons
      (no emoji, no blank icons) — and it sits **inside** the shell, not below it.
- [ ] Attendance view opens; Daily Report view opens.

### C2. v5 home visuals (new — check these carefully)

- [ ] **"Today at a glance"** row sits between the Day Open card and the
      order-type tiles: Today's Sales (gold figure), Orders, Avg Bill,
      Top Item — all four cards filled with real values from today's sales
      (same numbers as the Daily Report view). If the day has no sales yet,
      the cards show 0 / "—" / "no sales yet" — never blank or broken.
- [ ] **"Recent Orders"** strip sits below the tiles: latest 3 orders with
      invoice no., customer, type/table/time, amount and a PAID (green) or
      UNPAID (red) pill. "View all" opens the Recent Orders drawer. If no
      orders yet today, it shows "No orders yet today" — never blank.
- [ ] Home has **no dead empty space** at 1280×860: stats + tiles + recent
      strip fill the screen above the bottom nav (the view still scrolls on
      shorter screens — that is intended).
- [ ] Warm off-white page (#f7f5f0), white cards with soft layered shadows
      and 18px corners; deep green (#15803d) primary; gold used only
      sparingly (Today's Sales figure, active-tile glow).

## D. Dine-in end-to-end (the core v2 flow) — do this once, carefully

1. [ ] Home → **Dine In** → pick a free table (or tap a table on the floor view).
2. [ ] Add 1–2 items, press **Confirm Order**.
   - [ ] Table turns **Occupied** immediately.
   - [ ] A **live timer** starts on the table card and ticks.
   - [ ] **No dialog** appears and there is **no "Send to Kitchen" button**.
   - [ ] A **KOT appears in KDS automatically** (KOT number shown on the order).
3. [ ] Press Confirm Order **again** (double-click test).
   - [ ] Still exactly **ONE KOT** for this order (idempotent — no duplicate).
   - [ ] Timer did **not** restart.
4. [ ] Payment status shows **Pending** while "customer eats".
   - [ ] Table stays Occupied; invoice is not settled yet.
   - [ ] **BILLING RULE CHECK (v5 hard rule, unchanged from v3/v4): the cart shows
         the amber "Payment Pending — KOT … is in the kitchen. No bill has been
         given to the customer yet" banner, and the table chip reads
         "2 items → Kitchen". No customer bill is shown or printed at
         this point — only the KOT slip goes to the kitchen.
   - [ ] The order panel shows two distinct actions: "Confirm Order —
         Kitchen" (outline) stacked above "Pay & Print Bill" (solid green
         gradient).
5. [ ] Now settle / pay (Cash is fine for the test).
   - [ ] Table auto-frees to **Available**; timer cleared.
   - [ ] Invoice lists the KOT number(s).

## E1. CHILI layout checks (unchanged from v4 — layout is frozen in v5)

- [ ] **App shell:** one rounded-corner white window on a pale warm frame
      (not full-bleed).
- [ ] **Top bar:** hamburger + Food POS brand (left); ONE wide search
      "Search Product here..." (centre); order chip "Table 4 ✎" + icon-only
      Home / Held / status dot / ⋮ (right). No branch chip, no order-type
      tabs in the top bar.
- [ ] **Left sidebar ONLY:** Menu (active = solid green pill) / Table Services /
      Reservation / Delivery / Accounting / Settings / Logout pinned at bottom.
      **There is NO second (category) sidebar on the POS screen.**
- [ ] **Category row:** ONE row only — All (active, pale green) / Breakfast /
      Soups / Pasta / Main Course / Burgers, each with icon + name + count
      underneath; every label fully visible (esp. "Main Course").
      Filters button at the row's right end (diet/sort only).
- [ ] **Item cards:** exactly **3 columns**, uniform size, generous white
      space; photo area (image or gradient tile, full width), name,
      description, price, Veg/Non-Veg badge; "Add to Dish" becomes a qty
      stepper (− qty +) once the item is in the cart, and tapping − / + does
      not add the item twice.
- [ ] **Right order panel (~300px):** header "Table 4" + subtitle
      "Dine In • N items • <customer>" fully visible; order-type tabs
      Walk In / Dine In / Takeaway / Delivery all fit with no truncation;
      order lines, Subtotal, Total Due (v5.2: NO Tax row anywhere); Cash /
      Card / QR (selected = pale green); "Confirm Order — Kitchen" (outline)
      stacked above "Pay & Print Bill" (solid green).
- [ ] **Bottom chips strip:** staff avatars at the left end; one chip per open
      order ("T4 Ahmed — 2 items → Kitchen"); free tables show as
      "T1 Table 1 — Available" — tapping a free-table chip starts a fresh
      Dine-In order on that table.
- [ ] **Hamburger** (top-left) collapses the left sidebar to icons only.
- [ ] **Tables floor:** realistic round wooden tables in a clean 3-column grid
      with legend (scroll down for rows 3–4 and the legend); status pills +
      live timers; Home + Edit Layout buttons. No POS top bar on this screen.

### E2. v5 premium-vibe checks (new — check these carefully)

- [ ] **Item photos:** items that have an image in ERPNext (Item → Image)
      show the real photo filling the card's photo area (cover crop, no
      distortion). Items with **no** image show a warm gradient tile with a
      large proper SVG food icon (pizza / burger / noodle / soup / fries…)
      in a white circle — **never a bare letter, never an emoji**.
- [ ] **Category tiles:** each tile has a tinted green icon circle + name +
      count; the active tile has a soft green glow with a gold halo and a
      2px green border. "Main Course" is fully visible (not clipped).
- [ ] **Order-type tabs:** the active tab is solid green with white text and
      a soft shadow (sliding-pill feel); inactive tabs are plain grey.
- [ ] **Payment buttons:** Cash / Card / QR have SVG icons; the selected one
      has a green border + pale green tint + soft shadow.
- [ ] **Pay & Print Bill:** subtle vertical green gradient + soft shadow
      (not flat green). **Confirm Order — Kitchen** stays an outline button.
- [ ] **Total Due** figure is gold (#b45309), bold, tabular numerals.
- [ ] **Discount (v5.2 — Rs only, NO TAX):** open Discount & Presets (⋮ menu)
      — the dialog has ONE "Discount Amount (Rs)" field plus Rs presets
      (Rs 50 / 100 / 200 / 500), **no % field, no % presets**. Apply Rs 100:
      the discount shows as a **gold pill** and Total Due = Subtotal − Rs 100
      (e.g. Rs 1,000 → Rs 900), with **no Tax line anywhere** in the panel,
      payment summary, receipt or Z-report. Try a discount above Rs 100 —
      Manager PIN must be asked; without PIN it must refuse. Try a discount
      bigger than the subtotal — Total Due must stop at Rs 0, never negative.
      Settle and open the Sales Invoice in ERPNext — its taxes table must be
      empty and total_taxes_and_charges = 0 even if the POS Profile has a
      Sales Taxes and Charges Template set.
- [ ] **Qty stepper** on item cards is a solid green pill with white numerals.
- [ ] **Bottom chips** have a soft shadow and a status dot (green = ordering /
      available, gold = in the kitchen).
- [ ] **Tables floor:** chairs look like real wooden chairs (rounded backrest
      with slats + seat + legs) in wood tones — **not** mint/pink blocks;
      table tops show subtle wood grain; a soft floor shadow sits under each
      table. Status pill + dot + live timer (tabular numerals) unchanged.
- [ ] **Typography:** item names 15px semibold, descriptions small warm grey;
      headings tight letter-spacing; section labels small-caps grey.
- [ ] **Hover/active states:** buttons and tiles visibly respond on hover and
      press (no dead-feeling controls).

## E. Walk In / Take Away / Delivery quick check

- [ ] Walk In: order → confirm → KOT auto-created where applicable → pay → done.
- [ ] Take Away: same; receipt shows order type Take Away.
- [ ] Delivery: order with delivery fee → fee appears on bill → pay → done.

## F. Thermal printing (80mm / 58mm)

- [ ] Dine-in confirm prints the **KOT slip** (KOT no., order, type, table, items + notes).
- [ ] Settle prints the **customer bill**: shop name, order type, table (dine-in),
      items with qty/rate/amount, subtotal, discount (Rs), delivery fee, total,
      payment mode + paid/change, **PENDING amount line when outstanding > 0**,
      date/time, invoice + KOT numbers — **no Tax line on the bill**.
- [ ] **Reprint** from Recent Orders works and matches the original bill.
- [ ] Check 58mm and 80mm widths if you have both printers (layout is a browser
      print window — ESC/POS behaviour depends on your printer driver).

## G. Day close / Z-report

- [ ] Close Day asks for the manager PIN (existing PIN-gated flow).
- [ ] Closing page / **Z-report** shows the day's totals; nothing is deleted.
- [ ] Trying to close twice is blocked.
- [ ] Reopen next test day with Open Day again.

## H. If something fails

- [ ] Note the exact screen and the error text (screenshot is best).
- [ ] Check `bench --site <your-site> migrate` output for the Attendance DocType
      and the `v0_3_0` patch.
- [ ] Hard refresh the browser (Ctrl+Shift+R) — v5 JS/CSS changes need a fresh bundle.
- [ ] Do not push to GitHub until the dine-in + thermal test above passes.

## What was already verified without a bench (so you don't re-check it)

Static checks only (see `TEST-REPORT-v5.md`): Python `py_compile` OK,
`node --check` OK, branch-removal and auto-KOT grep checks clean (only
explanatory comments remain), billing-rule grep proof (no bill call on the
confirm path — call sites identical to v4), logic sanity 90/90 PASS, diff
scope limited to the 2 intended app files (food_pos.css / food_pos.js — no
server code, no new endpoint). Screenshots were rendered from the v5 code
and visually checked (real food photos, gradient+SVG fallback tiles,
home stats + recent strip, redrawn chairs, gold accents) — they are static
mocks, not live bench shots. Live-bench behaviour (Day Open/Close
end-to-end, real dine-in, free-table chip tap, real thermal printer, migrate
creating Attendance + day-time fields, and the home stats/recent strip
reading live data) is **not** verified yet — that is exactly what sections
C–G above check.
