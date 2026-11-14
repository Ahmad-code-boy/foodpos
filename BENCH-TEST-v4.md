# Bench Test Checklist — Food POS v4 (CHILI layout)

> Use this file on your own Frappe/ERPNext v16 bench. It is the v4 deploy/test
> guide for the folder you are reading (`v4-chili-layout/`).
> **Note:** there is no `DEPLOY.md` in this folder on purpose — the old one was
> a Round-23 document for a different fix (KOT `order_id` patch on `develop`).
> Do **not** follow it; this checklist supersedes it.
> Nothing here pushes to GitHub. Push only when you explicitly say so.

## A. Before you start (2 minutes)

- [ ] Bench backup: `bench --site <your-site> backup`
- [ ] Confirm this folder is the v4 copy (contains `CHANGELOG-v4.md` and
      `TEST-REPORT-v4.md`, and `foodpos/foodpos/single_branch.py`).
- [ ] Confirm your site is ERPNext v16 (v4 was built from v3, which was built
      from v2, which was built from Ahmad-code-boy/foodpos v0.0.1).

## B. Install / replace and migrate

If the app is **not** installed yet:

```bash
cd ~/frappe-bench
bench get-app /path/to/v4-chili-layout   # or push to GitHub first, then get-app by URL
bench --site <your-site> install-app foodpos
bench --site <your-site> migrate
bench build --app foodpos
bench clear-cache
bench restart
```

If the app is **already** installed (replacing v1/v2/v3 files with v4):

```bash
cd ~/frappe-bench
# copy the whole app directory from v4-chili-layout/ over apps/foodpos/
bench build --app foodpos
bench --site <your-site> migrate        # REQUIRED: creates Food POS Attendance + v0.3.0 day-time patch (same as v2 — v4 adds no new DocType)
bench clear-cache
bench restart
```

Verify migrate landed (bench console):

- [ ] DocType **Food POS Attendance** exists with 9 fields.
- [ ] POS Opening Entry has Custom Fields `custom_fpos_day_start_time` /
      `custom_fpos_day_end_time` (if the patch ran; before migrate the home
      screen falls back to a cache entry, so do not skip migrate).

## C. Smoke test — home screen (Day Open / Close)

Open `/food-pos` in a hard-refreshed browser.

- [ ] First screen is the **home screen** (no branch/register dialog pops up),
      inside the rounded white app shell on the pale green-grey frame.
- [ ] A static **"Main Branch"** label shows; there is **no Switch Branch** item.
- [ ] You can set **Day Start** and **Day End** times with the time inputs and save.
- [ ] **Open Day** works; the elapsed timer ticks every second without reload.
- [ ] Tiles **Walk In / Take Away / Delivery / Dine In** are all present.
- [ ] Bottom nav present: Orders, Dispatch, Cashier, KDS, Shifts, Staff,
      Attendance, Reports, Printer, Settings — all with clean SVG icons
      (no emoji, no blank icons; **Printer icon must show** — it was
      missing in an early v3 build and is fixed) — and it sits **inside**
      the shell, not below it.
- [ ] Premium look: deep green (#15803d) primary, white/green surfaces,
      no orange anywhere.
- [ ] Attendance view opens; Daily Report view opens.

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
   - [ ] **BILLING RULE CHECK (v4 hard rule, unchanged from v3): the cart shows
         the amber "Payment Pending — KOT … is in the kitchen. No bill has been
         given to the customer yet" banner, and the table chip reads
         "2 items → Kitchen". No customer bill is shown or printed at
         this point — only the KOT slip goes to the kitchen.
   - [ ] The order panel shows two distinct actions: "Confirm Order —
         Kitchen" and "Pay & Print Bill".
5. [ ] Now settle / pay (Cash is fine for the test).
   - [ ] Table auto-frees to **Available**; timer cleared.
   - [ ] Invoice lists the KOT number(s).

## E1. CHILI layout checks (new in v4 — check these carefully)

- [ ] **App shell:** one rounded-corner white window on a pale green-grey frame
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
      underneath; every label fully visible (esp. "Main Course" — it was
      clipped in an early v4 build and is fixed). Filters button at the row's
      right end (diet/sort only).
- [ ] **Item cards:** exactly **3 columns**, uniform size, generous white
      space; photo area (image or tinted placeholder, full width — it was a
      narrow band in an early v4 build and is fixed), name, description,
      price, Veg/Non-Veg badge; "Add to Dish" becomes a qty stepper
      (− qty +) once the item is in the cart, and tapping − / + does not
      add the item twice.
- [ ] **Right order panel (~300px):** header "Table 4" + subtitle
      "Dine In • N items • <customer>" fully visible (it was clipped in an
      early v4 build and is fixed); order-type tabs Walk In / Dine In /
      Takeaway / Delivery all fit with no truncation; order lines, Subtotal,
      Tax 5%, Total Due; Cash / Card / QR (selected = pale green);
      "Confirm Order — Kitchen" (outline) stacked above "Pay & Print Bill"
      (solid green).
- [ ] **Bottom chips strip:** staff avatars at the left end; one chip per open
      order ("T4 Ahmed — 2 items → Kitchen"); free tables show as
      "T1 Table 1 — Available" — tapping a free-table chip starts a fresh
      Dine-In order on that table.
- [ ] **Hamburger** (top-left) collapses the left sidebar to icons only.
- [ ] **Tables floor:** realistic round wooden tables in a clean 3-column grid
      with legend (scroll down for rows 3–4 and the legend); status pills +
      live timers; Home + Edit Layout buttons. No POS top bar on this screen.

## E. Walk In / Take Away / Delivery quick check

- [ ] Walk In: order → confirm → KOT auto-created where applicable → pay → done.
- [ ] Take Away: same; receipt shows order type Take Away.
- [ ] Delivery: order with delivery fee → fee appears on bill → pay → done.

## F. Thermal printing (80mm / 58mm)

- [ ] Dine-in confirm prints the **KOT slip** (KOT no., order, type, table, items + notes).
- [ ] Settle prints the **customer bill**: shop name, order type, table (dine-in),
      items with qty/rate/amount, subtotal, discount, tax, delivery fee, total,
      payment mode + paid/change, **PENDING amount line when outstanding > 0**,
      date/time, invoice + KOT numbers.
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
- [ ] Hard refresh the browser (Ctrl+Shift+R) — v4 JS/CSS changes need a fresh bundle.
- [ ] Do not push to GitHub until the dine-in + thermal test above passes.

## What was already verified without a bench (so you don't re-check it)

Static checks only (see `TEST-REPORT-v4.md`): Python `py_compile` OK,
`node --check` OK, branch-removal and auto-KOT grep checks clean (only
explanatory comments remain), billing-rule grep proof (no bill call on the
confirm path — call sites identical to v3), logic sanity 48/48 PASS, diff
scope limited to the 2 intended v4 files (food_pos.css / .js — no server
code). Screenshots were rendered from the v4 code and visually checked —
they are static mocks, not live bench shots. Live-bench behaviour (Day
Open/Close end-to-end, real dine-in, free-table chip tap, real thermal
printer, migrate creating Attendance + day-time fields) is **not** verified
yet — that is exactly what sections C–G above check.
