# Food POS 🍔 — Restaurant & Fast Food Point of Sale

[![Frappe Framework](https://img.shields.io/badge/Frappe-v16.x-blue.svg)](https://frappeframework.com/)
[![ERPNext](https://img.shields.io/badge/ERPNext-v16.x-blue.svg)](https://erpnext.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Food POS** (`foodpos`) is a touch-friendly Restaurant and Fast-Food Point of Sale app built natively for **Frappe & ERPNext v16**. It delivers high-speed ordering, table floor management, live kitchen ticket tracking (KOT), slide-in checkout, and offline sync.

---

## ⚡ Key Features

- **🍔 Fast-Food & Restaurant UI (`/food-pos`)**:
  - Auto-categorization for Burgers, Pizzas, Sandwiches, Sides, Drinks, Deals, and Desserts.
  - Dietary filters (🌱 Veg, 🍗 Non-Veg, 🌶️ Spicy) with live item counts and omni-search.
  - Line-item cooking notes (e.g., *"Extra Spicy"*, *"No Onions"*) and inline price edits.
  - Order type selector: **Dine-In**, **Takeaway**, and **Delivery**.

- **💳 Full-Page Slide-In Payment Screen**:
  - Transitions smoothly from left to right on **Pay & Settle** click.
  - Multi-mode tender: Cash, Card, UPI / Mobile Wallet, and Bank Transfer.
  - On-screen touch numeric keypad (0–9, `.`, `CLR`) + Quick Cash pills (`Exact`, `+$10`, `+$50`, `+$100`).
  - Real-time change return and shortage calculation.

- **🧾 Monospace Customer POS Slip & Thermal Print**:
  - 80mm / 58mm ESC/POS thermal receipt formatting with item notes, tax, discount, and change details.
  - Auto-print on checkout or on-demand reprint.

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
  - Backend support for Table Merging, Unmerging, and Order Transfers.

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

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app foodpos
bench --site <your-site> install-app foodpos
bench --site <your-site> migrate
bench --site <your-site> clear-cache
```

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
- **`Food Item Modifier Group` & `Food Item Modifier`**: Add-on modifiers and extra toppings.
- **`Food Table Merge`**: Primary and secondary table combinations.

### Custom Fields Added
- **`Sales Invoice` & `POS Invoice`**: `custom_order_type`, `custom_table`, `custom_order_note`
- **`Item`**: `custom_is_vegetarian`, `custom_is_vegan`, `custom_modifier_group`

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
