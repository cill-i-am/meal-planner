import { always, never } from "apps/operations/approval";

const shoppingPreparation = new Set([
  "set_basket_items",
  "reserve_delivery_slot",
  "release_delivery_slot",
  "prepare_checkout",
]);
const reads = new Set([
  "search_products",
  "list_category_products",
  "suggest_products",
  "connection_status",
  "get_product_details",
  "list_favourites",
  "list_previous_orders",
  "get_order_details",
  "get_basket",
  "list_delivery_slots",
]);

/** Remote metadata cannot downgrade checkout or unknown operations to unapproved calls. */
export const tescoApproval = (
  name: string,
  readOnlyHint: boolean | undefined
) => {
  if (name === "approve_checkout_handoff") {
    return always();
  }
  if (shoppingPreparation.has(name)) {
    return never();
  }
  if (reads.has(name) && readOnlyHint === true) {
    return never();
  }
  return always();
};
