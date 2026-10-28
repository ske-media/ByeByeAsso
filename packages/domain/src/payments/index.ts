/**
 * payments module — public API: the provider port (implemented in @kroov/payments) and the
 * payment-account / webhook services (implemented alongside orders in ticketing).
 */
export const MODULE_NAME = "payments" as const;
export {
  getPaymentAccount,
  type PaymentAccountView,
  paymentStateMachine,
  processProviderEvent,
  reconcilePendingPayments,
  startPaymentOnboarding,
  syncPaymentAccount,
  type WebhookOutcome,
} from "../ticketing";
export * from "./port";
