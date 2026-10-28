/**
 * orders module — public API. Orders live with the ticketing module (same aggregate:
 * reservation → payment → tickets); this entry point re-exports the order-facing services
 * so the module boundary declared in phase 0 stays meaningful for importers.
 */
export const MODULE_NAME = "orders" as const;
export {
  type BuyerOrderView,
  createPublicOrder,
  getMyOrder,
  getOrder,
  getOrderForBuyer,
  listMyOrders,
  listOrders,
  ORDER_STATUS_LABELS,
  type OrderListItem,
  type OrderView,
  orderStateMachine,
  resendOrderEmail,
  ticketingStats,
} from "../ticketing";
