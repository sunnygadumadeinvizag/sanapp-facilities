// App roles (App4 owns its own role model).
export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "App Admin",
  USER: "User",
};

// SSO primary roles — used for facility eligibility.
export const PRIMARY_ROLE_LABELS: Record<string, string> = {
  STAFF_TEACHING: "Staff – Teaching",
  STAFF_NON_TEACHING: "Staff – Non-Teaching",
  STUDENT: "Student",
  SCHOLAR: "Scholar",
  GUEST: "Guest",
};

export function primaryRoleLabel(role: string | null | undefined): string {
  if (!role) return "Not set";
  return PRIMARY_ROLE_LABELS[role] ?? role;
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/* -------------------------------------------------------------------------- */
/* Booking states                                                             */
/* -------------------------------------------------------------------------- */

// How a booking slot's life-cycle state reads to a person. PENDING_APPROVAL is
// the state of a requested slot on a facility that needs an approval: the slot
// is held, but the requester has not been given it yet.
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  CONFIRMED: "Confirmed",
  PENDING_APPROVAL: "Approval requested",
  REJECTED: "Declined",
  CANCELLED: "Cancelled",
};

export function bookingStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return BOOKING_STATUS_LABELS[status] ?? status;
}

/** Booking audit-trail event kinds, as shown in a history list. */
export const EVENT_LABELS: Record<string, string> = {
  CREATED: "Created",
  EDITED: "Edited",
  CANCELLED: "Cancelled",
  APPROVED: "Approved",
  REJECTED: "Declined",
};

export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind;
}

/** How a booking's type reads to a person. */
export const BOOKING_TYPE_LABELS: Record<string, string> = {
  SELF: "Self",
  ON_BEHALF: "Blocked for someone",
  LONG: "Long block (POC)",
};

export function bookingTypeLabel(type: string | null | undefined): string {
  if (!type) return "Unknown";
  return BOOKING_TYPE_LABELS[type] ?? type;
}
