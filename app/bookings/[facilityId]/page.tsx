import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Breadcrumb } from "sanapp-common-ui";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../../components/AppShell";
import { BookingClient, type SlotItem } from "../../components/BookingClient";
import { Badge } from "@/components/ui/badge";
import { istDateKey, istMinute, SLOT_MAX_MINUTES } from "@/lib/ist";
import { capLabel } from "@/lib/limits";
import { isPocOfFacility } from "@/lib/poc";

export const dynamic = "force-dynamic";

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
        where: { date: istDateKey(), status: "CONFIRMED" },
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
      b.status === "CONFIRMED" &&
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

  const slots: SlotItem[] = facility.bookings.map((b) => ({
    id: b.id,
    startDate: b.date,
    endDate: b.endDate || b.date,
    startMin: b.startMin,
    endMin: b.endMin,
    bookerName: b.user.name,
    bookerUsername: b.user.username,
    bookerPrimaryRole: b.user.primaryRole,
    forName: b.forUser?.name ?? null,
    forUsername: b.forUser?.username ?? null,
    forPrimaryRole: b.forUser?.primaryRole ?? null,
    needAvSupport: b.needAvSupport,
  }));

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
          {(facility.maxMinutes ?? facility.building.maxMinutes) !== null && (facility.maxMinutes ?? facility.building.maxMinutes)! > 0 && (
            <span className="text-xs text-muted-foreground">
              Max {capLabel(facility.maxMinutes ?? facility.building.maxMinutes)} per booking
            </span>
          )}
        </div>
      </div>

      <BookingClient
        facility={{ id: facility.id, name: facility.name, hasAvSupport: facility.hasAvSupport }}
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
          isPocHere:
            isAdmin ||
            (local ? await isPocOfFacility(local.id, facility.id) : false),
        }}
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
