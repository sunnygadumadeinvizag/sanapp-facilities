// LAB facilities: who supervises a booking, and for which department.
//
// A facility marked "LAB facility" may not be booked without naming the faculty
// member who supervises the session and the department the work belongs to.
// Faculty are the SSO users whose primary role is STAFF_TEACHING, and the
// department list comes from the SSO registry too, so both stay in step with the
// institute directory instead of a list duplicated in this app.

export const FACULTY_PRIMARY_ROLE = "STAFF_TEACHING";

/** True when this person may supervise a lab session (a teaching staff member). */
export function isFaculty(primaryRole?: string | null): boolean {
  return (primaryRole ?? "") === FACULTY_PRIMARY_ROLE;
}

/** A value trimmed to the stored string, or null when it is empty. */
export function cleanText(value: unknown, max = 200): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Why a lab booking may not be sent yet, or null when it is complete. Only lab
 * facilities need these two fields — every other facility is untouched.
 */
export function labDetailsError(
  isLab: boolean,
  details: { supervisorUsername?: unknown; supervisorName?: unknown; department?: unknown }
): string | null {
  if (!isLab) return null;
  const supervisor = String(details.supervisorUsername ?? "").trim();
  const name = String(details.supervisorName ?? "").trim();
  const department = String(details.department ?? "").trim();
  if (!supervisor || !name) {
    return "Choose the supervisor — the faculty member supervising this lab session — before confirming.";
  }
  if (!department) {
    return "Choose the department this lab session belongs to before confirming.";
  }
  return null;
}

/** "Supervisor: Dr. X (@x) · Department: Physics" — one line for lists and mail. */
export function labDetailsLine(details: {
  supervisorName?: string | null;
  supervisorUsername?: string | null;
  department?: string | null;
}): string | null {
  const parts: string[] = [];
  if (details.supervisorName) {
    parts.push(
      details.supervisorUsername
        ? `Supervisor: ${details.supervisorName} (@${details.supervisorUsername})`
        : `Supervisor: ${details.supervisorName}`
    );
  }
  if (details.department) parts.push(`Department: ${details.department}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
