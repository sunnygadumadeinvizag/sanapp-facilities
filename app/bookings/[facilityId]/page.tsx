import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Breadcrumb } from "sanapp-common-ui";
import { prisma } from "@/lib/prisma";
import type { BookingStatus } from "@/generated/prisma/client";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../../components/AppShell";
import { BookingClient, type SlotItem } from "../../components/BookingClient";
import { Badge } from "@/components/ui/badge";
import { istDateKey, istMinute, SLOT_MAX_MINUTES } from "@/lib/ist";
import { capLabel } from "@/lib/limits";
import { facilityAccess } from "@/lib/approval";
import { availabilityLines, isFullDay } from "@/lib/availability";

export const dynamic = "force-dynamic";

/** Slots that occupy the calendar: confirmed bookings and held requests. */
const OCCUPYING_STATUSES: BookingStatus[] = ["CONFIRMED", "PENDING_APPROVAL"];

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { facilityId } = await params;
  const sp = await searchParams;
  const editId = sp.edit ?? "";
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);
  if (!me) {
    // The proxy normally handles this; guard here too for direct hits.
    return <p className="iipe-container">Session not found.</p>;
  }

  // Designations (approver / POC) live on the local user, not the session.
  const local = await prisma.appUser.findUnique({ where: { username: me.username } });

  const facility = await prisma.facility.findUnique({
    where: { id: facilityId, active: true },
    include: {
      building: true,
      roleLimits: { select: { role: true, maxMinutes: true } },
      bookings: {
        // Today's held requests are shown too — they occupy the slot.
        where: { date: istDateKey(), status: { in: OCCUPYING_STATUSES } },
        orderBy: { startMin: "asc" },
        include: {
          user: { select: { id: true, username: true, name: true, primaryRole: true } },
          forUser: { select: { id: true, username: true, name: true, primaryRole: true } },
        },
      },
    },
  });

  if (!facility) {
    notFound();
  }

  // Edit mode: ?edit=<bookingId> pre-fills the range/details on the calendar.
  let editBooking: {
    id: string;
    date: string;
    endDate: string;
    startMin: number;
    endMin: number;
    purpose: string | null;
    isPublicPurpose: boolean;
    type: "SELF" | "ON_BEHALF" | "LONG";
    forUserId: string | null;
    pdfName: string | null;
    isPublicAttachment: boolean;
    needAvSupport: boolean;
  } | null = null;
  if (editId) {
    const b = await prisma.booking.findUnique({
      where: { id: editId },
      select: {
        id: true,
        facilityId: true,
        date: true,
        endDate: true,
        startMin: true,
        endMin: true,
        purpose: true,
        isPublicPurpose: true,
        type: true,
        forUserId: true,
        userId: true,
        status: true,
        pdfName: true,
        isPublicAttachment: true,
        needAvSupport: true,
      },
    });
    if (
      b &&
      b.facilityId === facility.id &&
      (b.status === "CONFIRMED" || b.status === "PENDING_APPROVAL") &&
      (b.userId === local?.id || local?.role === "ADMIN" || b.forUserId === local?.id)
    ) {
      editBooking = {
        id: b.id,
        date: b.date,
        endDate: b.endDate || b.date,
        startMin: b.startMin,
        endMin: b.endMin,
        purpose: b.purpose,
        isPublicPurpose: b.isPublicPurpose,
        type: b.type,
        forUserId: b.forUserId,
        pdfName: b.pdfName,
        isPublicAttachment: b.isPublicAttachment,
        needAvSupport: b.needAvSupport,
      };
    }
  }

  const today = istDateKey();
  const nowMin = istMinute();

  // What this user may do on this facility, in one place: decide requests, book
  // without asking (app admin / approval person), and manage its availability.
  const access = await facilityAccess(facility.id, local?.id ?? "", local?.role ?? "USER");

  // The facility's bookable hours and closed days, shown on the calendar.
  const availability = {
    openMin: facility.openMin,
    closeMin: facility.closeMin,
    closedWeekdays: facility.closedWeekdays,
    closedDates: facility.closedDates,
  };

  // Today's slots carry their details only to the people who may see them (the
  // booker, the facility's approval people and POCs, app admins). Everyone else
  // gets the time, who booked it and its state — nothing more.
  const detailedFor = (b: (typeof facility.bookings)[number]): boolean =>
    access.isAdmin ||
    access.isApprover ||
    access.isPoc ||
    (local ? b.userId === local.id || b.forUserId === local.id : false);

  const slots: SlotItem[] = facility.bookings.map((b) => {
    const detailed = detailedFor(b);
    return {
      id: b.id,
      startDate: b.date,
      endDate: b.endDate || b.date,
      startMin: b.startMin,
      endMin: b.endMin,
      bookerName: b.user.name,
      bookerUsername: b.user.username,
      bookerPrimaryRole: detailed ? b.user.primaryRole : null,
      forName: detailed ? (b.forUser?.name ?? null) : null,
      forUsername: detailed ? (b.forUser?.username ?? null) : null,
      forPrimaryRole: detailed ? (b.forUser?.primaryRole ?? null) : null,
      needAvSupport: detailed ? b.needAvSupport : false,
      status: b.status,
    };
  });

  // ADMINs can book any facility (the server bypasses restrictions).
  const effectivePrimaryRole = local?.primaryRole || me.primaryRole || "";
  const isAdmin = me.role === "ADMIN" || local?.role === "ADMIN" || me.ssoRole === "SUPER_ADMIN";
  const eligible =
    isAdmin ||
    facility.allowedRoles.length === 0 ||
    (effectivePrimaryRole ? facility.allowedRoles.includes(effectivePrimaryRole) : false);

  return (
    <AppShell me={me} active="home">
      <div className="mb-3">
        <Breadcrumb
          items={[
            { label: "Facilities", href: "/" },
            { label: facility.building.name, href: `/buildings/${facility.building.id}` },
            { label: facility.name },
            { label: "Book" },
          ]}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="iipe-page-title">{editBooking ? `Edit booking — ${facility.name}` : `Book ${facility.name}`}</h1>
          <p className="iipe-page-sub">
            {facility.building.name}
            {facility.building.location ? ` · ${facility.building.location}` : ""}
            {facility.description ? ` · ${facility.description}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={eligible ? "default" : "secondary"}>
            {eligible ? "You can book this facility" : "Restricted to specific roles"}
          </Badge>
          {facility.requiresApproval &&
            (access.booksDirectly ? (
              <Badge variant="outline" className="border-sky-400 bg-sky-50 text-sky-900">
                Your own bookings are confirmed immediately — you approve this facility
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900">
                Approval required before a slot is confirmed
              </Badge>
            ))}
          {(facility.maxMinutes ?? facility.building.maxMinutes) !== null && (facility.maxMinutes ?? facility.building.maxMinutes)! > 0 && (
            <span className="text-xs text-muted-foreground">
              Max {capLabel(facility.maxMinutes ?? facility.building.maxMinutes)} per booking
            </span>
          )}
          {facility.isLab && (
            <Badge variant="outline" className="border-sky-400 bg-sky-50 text-sky-900">
              LAB facility
            </Badge>
          )}
          {!isFullDay(availability) && (
            <span className="text-right text-xs text-muted-foreground">
              {availabilityLines(availability).join(" · ")}
            </span>
          )}
        </div>
      </div>

      <BookingClient
        facility={{
          id: facility.id,
          name: facility.name,
          hasAvSupport: facility.hasAvSupport,
          requiresApproval: facility.requiresApproval,
        }}
        editBooking={editBooking}
        buildingName={facility.building.name}
        today={today}
        todaySlots={slots}
        me={{
          name: me.name,
          primaryRole: effectivePrimaryRole,
          role: local?.role ?? "USER",
          // POC of THIS facility or its building (or an app ADMIN) — the
          // per-building / per-facility POC model.
          isPocHere: isAdmin || access.isPoc,
          // Books a slot directly, with no approval request: an app admin or one
          // of this facility's approval people. Everyone else submits a request.
          booksDirectly: access.booksDirectly,
          // May block a slot for SOMEBODY ELSE — a POC, an app admin, and now
          // the facility's approval people (their direct block).
          mayBlockForOthers: access.isAdmin || access.isPoc || access.isApprover,
        }}
        availability={availability}
        avSupportRequired={facility.avSupportRequired}
        canManage={access.manages}
        eligible={eligible}
        nowMin={nowMin}
        maxMinutes={facility.maxMinutes}
        buildingMaxMinutes={facility.building.maxMinutes}
        roleLimits={facility.roleLimits}
      />

      <p className="mt-4 text-xs text-muted-foreground">
        All times are Indian Standard Time (server time). Drag on the calendar to select a slot —
        release to add it, then drag again to add more. Slots stay selected until you remove them or
        confirm the booking. Current IST time:{" "}
        {`${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`}.
      </p>
    </AppShell>
  );
}
