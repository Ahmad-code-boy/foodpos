# Food POS 🍔 — Restaurant & Fast Food Point of Sale

[![Frappe Framework](https://img.shields.io/badge/Frappe-v16.x-blue.svg)](https://frappeframework.com/)
[![ERPNext](https://img.shields.io/badge/ERPNext-v16.x-blue.svg)](https://erpnext.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Food POS** (`foodpos`) is a touch-friendly Restaurant and Fast-Food Point of Sale app built natively for **Frappe & ERPNext v16**. It delivers high-speed ordering, table floor management, live kitchen ticket tracking (KOT), slide-in checkout, and offline sync.

> **v2 — Single Branch (local working copy, NOT pushed to GitHub).**
> This copy removes all multi-branch code: one fixed branch, **Main Branch**,
> one naming series, no branch selector. It adds a Home / Day Open–Close
> screen, automatic KOT on order confirm, a redesigned floor plan, staff
> attendance and a daily orders report. Full details: [`CHANGELOG-v2.md`](CHANGELOG-v2.md).
> Install it from the GitHub repo only after the v2 code is pushed there
> (see [Install](#-quick-installation)); until then, install from this folder.

---

## ⚡ Key Features

- **🏠 Home / Day Open–Close screen (v2, the first screen of `/food-pos`)**:
  - Sync/Connected status, Shift Management with Day Open state, Day Open time + running elapsed timer.
  - User-settable **Day Start** and **Day End / Close** times (saved on the open POS Opening Entry).
  - Four big order-type tiles: **Walk In, Take Away, Delivery, Dine In**.
  - Bottom nav: Orders, Dispatch, Cashier, KDS, Shifts, Staff, Attendance, Reports, Printer, Settings.
  - **Day Close** runs the existing PIN-gated shift-closing / Z-report flow — it never deletes data.

- **🍔 Fast-Food & Restaurant UI (`/food-pos`)**:
  - Left **category sidebar** (v2): clean vertical list with active-category highlight, item counts and search.
  - Item cards (v2): consistent size, name, price in Rs, short description, Veg / Non-Veg / Spicy badges, clear **+** add button.
  - Auto-categorization for Burgers, Pizzas, Sandwiches, Sides, Drinks, Deals, and Desserts.
  - Dietary filters (🌱 Veg, 🍗 Non-Veg, 🌶️ Spicy) with live item counts and omni-search.
  - Line-item cooking notes (e.g., *"Extra Spicy"*, *"No Onions"*) and inline price edits.
  - Order type selector: **Walk In**, **Dine-In**, **Takeaway**, and **Delivery**.

- **✅ Confirm Order — KOT auto-sent (v2)**:
  - Confirming an order **automatically** creates the KOT server-side and prints the kitchen slip (KOT parchi) — there is no manual "Send to Kitchen" button any more.
  - Idempotent per order: a double-click / double-confirm creates exactly **one** KOT per order.
  - Dine-in: the table becomes Occupied immediately, a live timer starts, and payment stays **Pending** until the customer pays; settling the invoice frees the table automatically.

- **💳 Full-Page Slide-In Payment Screen**:
  - Transitions smoothly from left to right on **Pay & Settle** click.
  - Multi-mode tender: Cash, Card, UPI / Mobile Wallet, and Bank Transfer.
  - On-screen touch numeric keypad (0–9, `.`, `CLR`) + Quick Cash pills (`Exact`, `+$10`, `+$50`, `+$100`).
  - Real-time change return and shortage calculation.

- **🧾 Monospace Customer POS Slip & Thermal Print**:
  - 80mm / 58mm ESC/POS thermal receipt formatting with item notes, tax, discount, and change details.
  - Shows shop name, order type, table (dine-in), items with qty/rate/amount + notes, subtotal, discount, tax, delivery fee, total, payment mode + paid/change, **pending amount (clearly, for dine-in before payment)**, date/time, order & KOT numbers, and a thank-you line.
  - Auto-print on checkout or on-demand reprint. Dine-in prints the **KOT slip to the kitchen on confirm** and the **customer bill on the thermal printer at settle time**; reprint works from Recent Orders.

- **📋 Recent Orders & Cart Recall (Last 10 Customers)**:
  - Slide-out order history drawer showing today's recent orders.
  - **✏️ Edit / Reload Cart**: Re-populates customer, table, and items into the active cart for add-ons or changes.
  - **🖨️ POS Slip**: Instant receipt reprint from drawer.

- **🧑‍🍳 Live Kitchen Order Tracking (KOT)**:
  - Dispatches KOT tickets without requiring upfront payment.
  - Topbar live badge with 15-second background auto-polling.
  - Slide-out kitchen drawer with **remaining items counter** (`🍳 X of Y items remaining`).
  - **Item-Level Checklist**: Checkboxes to mark individual items cooked (`is_done`); auto-marks ticket **Ready** when complete.
  - Stage advance controls: `Pending` &rarr; `In Progress` &rarr; `Ready` &rarr; `Served`.

- **🪑 Interactive Table Management**:
  - Floor visualizer with seating capacity and live occupancy (`Available`, `Occupied`, `Reserved`, `Cleaning`).
  - v2 redesign: table shapes with chairs, capacity, section, live status colours, **live timer on occupied tables** (ticking without reload), guest count, order number — tap a table to open its order. Edit Layout opens the Restaurant Table list.
  - Backend support for Table Merging, Unmerging, and Order Transfers.

- **👥 Staff Attendance & 📊 Daily Orders Report (v2)**:
  - Attendance: check-in / check-out / absent per staff per day, tied to the Day Open/Close day, marked with inline controls inside the POS page (no dialog). New DocType `Food POS Attendance`.
  - Daily report: today's orders by type, items sold, sales, payment modes, pending dine-in payments, tables served, attendance summary — reachable from the home bottom nav (Reports). Data from new API `get_daily_report` (reuses the closing-details queries where possible).

- **📶 Offline Mode & Sync**:
  - LocalStorage caching for POS profile, item catalog, and tables.
  - Offline invoice queue (`fpos_offline_invoices`) with auto and manual server sync.

- **📊 Shift Closing & Daily Z-Report**:
  - KPI summary (Net Sales, Orders, Expected Cash, Settled Volume).
  - Cash drawer balancing tool with real-time discrepancy calculator.
  - Breakdown tables for payment modes, order channels, and top-selling items.
  - Monospace printable Z-Report with cashier/manager sign-off.

---

## 🚀 Quick Installation

> **v2 is a local working copy and has NOT been pushed to GitHub yet.**
> To install v2 on a bench, copy this folder into the bench's `apps/` directory
> (or push it to GitHub first and use the `bench get-app` URL below), then:

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/Ahmad-code-boy/foodpos.git
bench --site <your-site> install-app foodpos
bench --site <your-site> migrate
bench --site <your-site> clear-cache
```

> `bench migrate` also runs the v2 patch `foodpos.patches.v0_3_0.add_day_time_fields`
> (adds Day Start / Day End time fields on POS Opening Entry) and creates the
> new `Food POS Attendance` DocType. Until migrate runs, the home screen still
> works — day times fall back to a 24h cache entry, and attendance shows a
> "run bench migrate first" note.

Access the POS directly at: `https://<your-site>/food-pos`

---

## ⚙️ Initial Setup

1. **POS Profile**: In ERPNext Desk, create a **POS Profile** with default Warehouse, Currency, Customer (*Walk-in*), and Payment Methods (*Cash, Card, etc.*).
2. **Tables**: Go to **Restaurant Table List** and add tables with seating capacity and section (e.g. `Table 1`, `4 seats`, `Main Hall`).
3. **Item Master**: Assign items to fast-food categories and check `custom_is_vegetarian` on vegetarian dishes.

---

## 🗄️ DocTypes & Schema

### Custom DocTypes
- **`Restaurant Table`**: Table number, capacity, section, and live occupancy status.
- **`Food KOT` & `Food KOT Item`**: Kitchen order tickets and line items with `is_done` preparation flag.
- **`Food POS Attendance`** (v2): Staff name, date, check-in / check-out, status (Present / Absent / On Leave), POS Profile. One row per staff per day.
- **`Food Item Modifier Group` & `Food Item Modifier`**: Add-on modifiers and extra toppings.
- **`Food Table Merge`**: Primary and secondary table combinations.

### Custom Fields Added
- **`Sales Invoice` & `POS Invoice`**: `custom_order_type`, `custom_table`, `custom_order_note`
- **`Item`**: `custom_is_vegetarian`, `custom_is_vegan`, `custom_modifier_group`
- **`POS Opening Entry`** (v2, patch v0.3.0): `custom_fpos_day_start_time`, `custom_fpos_day_end_time` — user-set Day Start / Day End times shown on the home screen.

---

## 🔌 Core Whitelisted APIs

All endpoints live in `foodpos.foodpos.page.food_pos.food_pos`:

| Endpoint | Parameters | Purpose |
| :--- | :--- | :--- |
| `get_pos_profiles` | *None* | Get active POS profiles for current user |
| `get_items` | `pos_profile`, `page_length` | Fetch item master with prices and diet flags |
| `get_available_tables` | `section` | Get restaurant tables with occupancy statuses |
| `create_kot` | `order_data` | Create kitchen ticket and occupy table |
| `submit_pos_invoice` | `order_data`, `payments` | Submit invoice, reconcile payment & return receipt |
| `get_recent_pos_orders`| `pos_profile`, `limit=10` | Retrieve last 10 customer orders for cart reload |
| `get_invoice_slip_data`| `invoice_name`, `doctype` | Fetch thermal receipt payload for printing |
| `get_active_kitchen_kots`| `pos_profile` | Live KOTs with remaining cooking item counts |
| `update_kot_item_done_status` | `kot_name`, `item_name`, `is_done` | Check off cooked items in real time |
| `update_kot_stage` | `kot_name`, `status` | Advance ticket stage (`Pending` &rarr; `Ready` &rarr; `Served`) |
| `get_today_closing_details` | `pos_profile` | Shift sales totals, cash balancing & analytics |
| `sync_offline_invoices`| `invoices` | Batch sync offline queued invoices |
| `confirm_order` | `order_data` | **v2:** Confirm an order without settling it — auto-creates the KOT (idempotent), reserves the table, starts the timer, payment stays Pending |
| `get_day_status` | `pos_profile` | **v2:** Is the day open, open shift, saved Day Start/End times |
| `set_day_times` | `pos_profile`, `day_start_time`, `day_end_time` | **v2:** Save user-set Day Start / Day End times (HH:MM) |
| `get_staff_attendance` | `attendance_date`, `pos_profile` | **v2:** Attendance rows for one day |
| `mark_staff_attendance` | `staff_name`, `action` (`check_in` / `check_out` / `absent`) | **v2:** Mark attendance inline |
| `get_daily_report` | `report_date`, `pos_profile` | **v2:** Today's orders by type, sales, payment modes, top items, pending dine-in tables, attendance |

---

## 🛠️ Development

```bash
cd apps/foodpos
pre-commit install

# Lint & syntax check
ruff check .
node --check foodpos/foodpos/page/food_pos/food_pos.js
```

---

## 📄 License

MIT License. Developed by **nextash**.
# foodpos
