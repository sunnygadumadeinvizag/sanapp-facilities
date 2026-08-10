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
