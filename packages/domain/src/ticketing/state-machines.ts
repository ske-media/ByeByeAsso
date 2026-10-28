import { StateMachine } from "../kernel";

export type OrderStatus =
  | "draft"
  | "reserved"
  | "awaiting_payment"
  | "paid"
  | "failed"
  | "expired"
  | "partially_refunded"
  | "refunded";

/**
 * ORDER
 * draft → reserved (hold placed) → awaiting_payment (checkout session) → paid (webhook / free)
 * reserved | awaiting_payment | failed → expired (hold deadline passed)
 * awaiting_payment → failed (provider refused) → awaiting_payment (retry before expiry)
 * paid → partially_refunded → refunded ; paid → refunded
 * Free orders: reserved → paid directly.
 */
export const orderStateMachine = new StateMachine<OrderStatus>({
  entity: "order",
  initial: "draft",
  transitions: {
    draft: ["reserved"],
    reserved: ["awaiting_payment", "paid", "expired"],
    awaiting_payment: ["paid", "failed", "expired"],
    failed: ["awaiting_payment", "paid", "expired"],
    paid: ["partially_refunded", "refunded"],
    partially_refunded: ["refunded", "partially_refunded"],
    expired: ["paid"], // late payment reconciled (inventory re-checked first)
    refunded: [],
  },
  terminal: ["refunded"],
});

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Brouillon",
  reserved: "Réservée",
  awaiting_payment: "En attente",
  paid: "Payée",
  failed: "Refusée",
  expired: "Expirée",
  partially_refunded: "Remb. partiel",
  refunded: "Remboursée",
};

export type PaymentStatus =
  | "created"
  | "pending"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded";

export const paymentStateMachine = new StateMachine<PaymentStatus>({
  entity: "payment",
  initial: "created",
  transitions: {
    created: ["pending", "succeeded", "failed", "cancelled"],
    pending: ["succeeded", "failed", "cancelled"],
    // A late `succeeded` after `failed` wins (money was taken); a `failed` after `succeeded` is ignored.
    failed: ["succeeded"],
    cancelled: ["succeeded"],
    succeeded: ["partially_refunded", "refunded"],
    partially_refunded: ["partially_refunded", "refunded"],
    refunded: [],
  },
  terminal: ["refunded"],
});

export type TicketStatus = "pending" | "valid" | "used" | "revoked" | "refunded";

export const ticketStateMachine = new StateMachine<TicketStatus>({
  entity: "ticket",
  initial: "pending",
  transitions: {
    pending: ["valid", "revoked"],
    valid: ["used", "revoked", "refunded"],
    used: ["refunded"],
    revoked: [],
    refunded: [],
  },
  terminal: ["revoked", "refunded"],
});

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending: "En attente",
  valid: "Valide",
  used: "Utilisé",
  revoked: "Révoqué",
  refunded: "Remboursé",
};
