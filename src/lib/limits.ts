import { SLOT_MAX_MINUTES } from "./ist";

export type RoleLimitInput = { role: string; maxMinutes: number };

export function effectiveMaxMinutes(
  facility: { maxMinutes: number | null },
  roleLimits: RoleLimitInput[],
  primaryRole: string | null | undefined,
  buildingMaxMinutes?: number | null
): number | null {
  if (primaryRole) {
    const roleCap = roleLimits.find((r) => r.role === primaryRole);
    if (roleCap && Number.isInteger(roleCap.maxMinutes) && roleCap.maxMinutes > 0) {
      return roleCap.maxMinutes;
    }
  }
  if (facility.maxMinutes && Number.isInteger(facility.maxMinutes) && facility.maxMinutes > 0) {
    return facility.maxMinutes;
  }
  if (buildingMaxMinutes && Number.isInteger(buildingMaxMinutes) && buildingMaxMinutes > 0) {
    return buildingMaxMinutes;
  }
  return null;
}

export function capLabel(minutes: number | null): string {
  if (minutes === null) return "No limit";
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  if (minutes < 60) return `${minutes} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

export function capHint(minutes: number | null): string {
  if (minutes === null) return "No limit";
  return `Up to ${capLabel(minutes)}`;
}
