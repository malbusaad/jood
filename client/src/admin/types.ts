export type Role = "OWNER" | "STAFF";
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type BookingStatus =
  | "NEW"
  | "AWAITING_PAYMENT"
  | "AWAITING_VERIFICATION"
  | "CONFIRMED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED"
  | "COMPLETED";
export type Channel = "WEBSITE" | "GATHERN" | "MANUAL";
export type PaymentMethod = "BANK_TRANSFER" | "GATHERN" | "CASH";
export type PaymentPurpose = "BOOKING" | "SECURITY_DEPOSIT";

export interface ResourceRef {
  id: string;
  name: string;
  kind: "FULL" | "PART";
}

export interface BookingSummary {
  id: string;
  reference: string;
  status: BookingStatus;
  channel: Channel;
  startDate: string;
  endDate: string;
  totalAmount: string;
  depositAmount: string;
  createdAt: string;
  expiresAt: string | null;
  guest: { id: string; name: string; phone: string };
  resources: ResourceRef[];
  paid: string;
  pendingPayments: number;
}

export interface Payment {
  id: string;
  method: PaymentMethod;
  purpose?: PaymentPurpose;
  kind?: "PAYMENT" | "REFUND";
  amount: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED";
  reportedAt: string | null;
  externalRef: string | null;
  note: string | null;
  verifiedAt: string | null;
  verifiedBy: { name: string } | null;
  createdAt: string;
}

export interface BookingDetail {
  id: string;
  reference: string;
  status: BookingStatus;
  statusLabel: string;
  channel: Channel;
  startDate: string;
  endDate: string;
  totalAmount: string;
  depositAmount: string;
  discountAmount?: string;
  payment?: PaymentSummary;
  discountCode?: string | null;
  priceBreakdown: { date: string; resourceId: string; resourceName: string; price: string }[];
  guestCount: number | null;
  guestNotes: string | null;
  adminNotes: string | null;
  expiresAt: string | null;
  confirmedAt: string | null;
  confirmedBy: { name: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  contractSentAt: string | null;
  contractAcceptedAt: string | null;
  createdAt: string;
  guest: { id: string; name: string; phone: string; email: string | null; notes: string | null; nationalId: string | null; nationalIdMasked: string | null };
  items: { id: string; date: string; price: string; resource: ResourceRef }[];
  payments: Payment[];
  paid: string;
  allowedTransitions: BookingStatus[];
  accessTokens: { id: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null }[];
  doorCodes: { id: string; status: "ACTIVE" | "DELETED" | "FAILED"; startsAt: string; endsAt: string; error: string | null; createdAt: string; deletedAt: string | null }[];
  /** Clear-text current door code (owner only). */
  doorCode: string | null;
  lockConfigured: boolean;
  history: { id: string; action: string; details: Record<string, unknown> | null; createdAt: string; user: { name: string } | null }[];
}

export interface Dashboard {
  upcoming: number;
  confirmedUpcoming: number;
  newRequests: number;
  awaitingVerification: number;
  pendingPayments: number;
  revenueMonth: string;
  revenueAll: string;
  cancelledMonth: number;
  unavailableAmenities: { id: string; name: string }[];
  unreadNotifications: number;
  next: BookingSummary[];
}

export interface Notification {
  id: string;
  type: "NEW_BOOKING" | "PAYMENT_REPORTED" | "PAYMENT_DUE" | "BOOKING_CANCELLED" | "SYSTEM";
  title: string;
  body: string;
  bookingId: string | null;
  readAt: string | null;
  whatsappStatus: "NOT_CONFIGURED" | "PENDING" | "SENT" | "FAILED";
  whatsappError: string | null;
  createdAt: string;
}

export type ContractBlock =
  | { type: "title"; text: string }
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ordered"; start: number; items: string[] }
  | { type: "bullets"; items: string[] }
  | { type: "table"; rows: [string, string][] }
  | { type: "prices"; rows: { date: string; item: string; price: string }[]; total: string };

export interface Contract {
  reference: string;
  guestName: string;
  guestPhone: string;
  blocks: ContractBlock[];
  warnings: string[];
}

export interface CalendarBooking {
  id: string;
  reference: string;
  status: BookingStatus;
  channel: Channel;
  startDate: string;
  endDate: string;
  guest: { name: string; phone: string };
  kind: "FULL" | "PART";
  resources: ResourceRef[];
}

export interface Guest {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
  nationalIdMasked: string | null;
  createdAt: string;
  bookingCount: number;
  lastStay: string | null;
}

/** Server-computed money summary of a booking (booking amount and security deposit kept apart). */
export interface PaymentSummary {
  plan: "FULL" | "DEPOSIT";
  depositTiming: "WITH_FIRST_PAYMENT" | "BEFORE_CHECKIN";
  legacy: boolean;
  bookingTotal: string;
  upfrontAmount: string;
  bookingPaid: string;
  bookingRefunded: string;
  bookingRemaining: string;
  upfrontRemaining: string;
  securityDeposit: string;
  depositPaid: string;
  depositRefunded: string;
  depositRemaining: string;
  depositStatus: "NONE" | "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED";
  dueToConfirm: string;
  canConfirm: boolean;
  fullySettled: boolean;
  balanceDueAt: string | null;
}
