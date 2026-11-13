import frappe
import json
from frappe.utils import now_datetime, flt

def test_item5():
    frappe.set_user("Administrator")
    print("=== Testing Item 5: Polish & Resiliency ===")

    pos_profile = "Branch 1 - Gulberg POS Profile"
    branch = "Branch 1 - Gulberg"

    # 1. Test KOT Item Done & Remaining Counter Integrity
    print("\n[1] Testing KOT Item Done status & Remaining items calculation...")
    kots = frappe.get_all("Food KOT", filters={"docstatus": 0}, fields=["name", "status"], order_by="creation desc", limit=1)
    if not kots:
        from foodpos.foodpos.page.food_pos.food_pos import create_kot
        res = create_kot({
            "order_type": "Takeaway",
            "pos_profile": pos_profile,
            "branch": branch,
            "items": [
                {"item_code": "Club Sandwich", "item_name": "Club Sandwich", "qty": 1, "rate": 250.0},
                {"item_code": "Zinger Burger", "item_name": "Zinger Burger", "qty": 1, "rate": 450.0}
            ]
        })
        kot_name = res["kot_name"]
    else:
        kot_name = kots[0].name

    kot_doc = frappe.get_doc("Food KOT", kot_name)
    items = kot_doc.items
    first_row = items[0]
    print(f"Testing KOT: {kot_name}, Item: {first_row.item_name} (Row ID: {first_row.name})")

    from foodpos.foodpos.page.food_pos.food_pos import update_kot_item_done_status, get_active_kitchen_kots

    # Mark first item done
    ret = update_kot_item_done_status(kot_name, item_name=first_row.item_name, is_done=1, row_id=first_row.name)
    print("update_kot_item_done_status(1) response:", ret)
    assert ret["success"] is True

    # Verify directly from DB
    row_is_done = frappe.db.get_value("Food KOT Item", first_row.name, "is_done")
    assert row_is_done == 1, f"Expected is_done=1 in DB, got {row_is_done}"
    print(f"Verified DB Food KOT Item row {first_row.name} has is_done = 1")

    # Check get_active_kitchen_kots
    active_kots = get_active_kitchen_kots(pos_profile=pos_profile)
    matching_kot = next((k for k in active_kots if k["name"] == kot_name), None)
    if matching_kot:
        print(f"KOT in drawer: status={matching_kot['status']}, done_items={matching_kot['done_items']}, remaining_items={matching_kot['remaining_items']}")
        assert matching_kot["done_items"] >= 1

    # 2. Test Hold & Resume Audit Log
    print("\n[2] Testing Hold, Resume, Discard Audit Logging...")
    from foodpos.foodpos.page.food_pos.food_pos import hold_order, resume_held_order

    hold_payload = {
        "order_type": "Takeaway",
        "pos_profile": pos_profile,
        "branch": branch,
        "items": [{"item_code": "Club Sandwich", "item_name": "Club Sandwich", "qty": 1, "rate": 250.0, "amount": 250.0}],
        "totals": {"grand_total": 250.0}
    }
    hold_res = hold_order(hold_payload, reason="Auditor test hold")
    held_id = hold_res["held_order_id"]
    print("Created held order:", held_id)

    # Check audit log for hold
    hold_audit = frappe.get_all("Food POS Audit Log", filters={"action_type": "Order Held", "order_id": held_id}, fields=["name", "action_type", "details", "cashier"])
    assert len(hold_audit) > 0, "No audit log created for Order Held!"
    print(f"PASSED: Found Audit Log for Order Held: {hold_audit[0]['name']} - {hold_audit[0]['details']}")

    # Resume order
    res_res = resume_held_order(held_id)
    assert res_res["success"] is True
    resume_audit = frappe.get_all("Food POS Audit Log", filters={"action_type": "Order Resumed", "order_id": held_id}, fields=["name", "action_type", "details"])
    assert len(resume_audit) > 0, "No audit log created for Order Resumed!"
    print(f"PASSED: Found Audit Log for Order Resumed: {resume_audit[0]['name']} - {resume_audit[0]['details']}")

    # 3. Test Settlement with Change Due & Audit Log
    print("\n[3] Testing Settlement with Tendered > Total (Change Due) & Settle Audit...")
    from foodpos.foodpos.page.food_pos.food_pos import submit_pos_invoice

    # Settle: cart Rs 250, Cash 1,050 -> Change Due Rs 800
    settle_payload = {
        "order_type": "Takeaway",
        "pos_profile": pos_profile,
        "branch": branch,
        "customer": "Walk-in Customer",
        "items": [{"item_code": "Club Sandwich", "item_name": "Club Sandwich", "qty": 1, "rate": 250.0, "amount": 250.0}],
        "totals": {"net_total": 250.0, "grand_total": 250.0, "discount_amount": 0.0, "delivery_charges": 0.0}
    }
    payments = [
        {"mode_of_payment": "Cash", "amount": 1050.0}  # 1050 tendered on 250 -> 800 change
    ]
    settle_res = submit_pos_invoice(settle_payload, payments)
    inv_name = settle_res["invoice_name"]
    change_amount = settle_res["change_amount"]
    print(f"Settled invoice {inv_name}: Grand Total: {settle_res['grand_total']}, Paid: {settle_res['paid_amount']}, Change Amount: {change_amount}")
    assert change_amount == 800.0, f"Expected change_amount == 800.0, got {change_amount}"

    # Check Settle Audit Log
    settle_audit = frappe.get_all("Food POS Audit Log", filters={"action_type": "Order Settled", "order_id": inv_name}, fields=["name", "action_type", "details", "cashier"])
    assert len(settle_audit) > 0, "No audit log created for Order Settled!"
    print(f"PASSED: Found Audit Log for Order Settled: {settle_audit[0]['name']} - {settle_audit[0]['details']}")

    print("\nALL ITEM 5 UNIT & INTEGRATION CHECKS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_item5()
