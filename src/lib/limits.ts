import { SLOT_MAX_MINUTES } from "./ist";

export type RoleLimitInput = { role: string; maxMinutes: number };

/**
 * Effective maximum booking duration (minutes) for a user on a facility.
 *
 * Precedence:
 *   1. Per-facility, per-primary-role limit (if the user's role has one)
 *   2. Facility maxMinutes (if set)
 *   3. Building maxMinutes (if set)
 *   4. Platform default (SLOT_MAX_MINUTES = 3 hours)
 *
 * Long (POC) bookings may only exceed the platform 3-hour default — they are
 * still capped by any configured facility/building/role limit above it.
 */
export function effectiveMaxMinutes(
  facility: { maxMinutes: number | null },
  building: { maxMinutes: number | null },
  roleLimits: RoleLimitInput[],
  primaryRole: string | null | undefined
): number {
  if (primaryRole) {
    const roleCap = roleLimits.find((r) => r.role === primaryRole);
    if (roleCap && Number.isInteger(roleCap.maxMinutes) && roleCap.maxMinutes > 0) {
      return roleCap.maxMinutes;
    }
  }
  if (facility.maxMinutes && Number.isInteger(facility.maxMinutes) && facility.maxMinutes > 0) {
    return facility.maxMinutes;
  }
  if (building.maxMinutes && Number.isInteger(building.maxMinutes) && building.maxMinutes > 0) {
    return building.maxMinutes;
  }
  return SLOT_MAX_MINUTES;
}

/** Human label for a cap: "2 h", "3 h", "Unlimited (POC)". */
export function capLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  if (minutes < 60) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

/** "Up to 2 h" style hint used on facility cards. */
export function capHint(minutes: number): string {
  return `Up to ${capLabel(minutes)}`;
}
