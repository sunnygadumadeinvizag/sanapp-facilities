import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { Breadcrumb } from "iipe-common-ui";
import { prisma } from "@/lib/prisma";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "../../components/AppShell";
import { BookingClient, type SlotItem } from "../../components/BookingClient";
import { Badge } from "@/components/ui/badge";
import { istDateKey, istMinute, SLOT_MAX_MINUTES } from "@/lib/ist";
import { capLabel } from "@/lib/limits";

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
          user: { select: { id: true, username: true, name: true } },
          forUser: { select: { id: true, username: true, name: true } },
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
    type: "SELF" | "ON_BEHALF" | "LONG";
    forUserId: string | null;
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
        type: true,
        forUserId: true,
        userId: true,
        status: true,
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
        type: b.type,
        forUserId: b.forUserId,
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
    forName: b.forUser?.name ?? null,
  }));

  // ADMINs can book any facility (the server bypasses restrictions).
  const eligible =
    me.role === "ADMIN" ||
    facility.allowedRoles.length === 0 ||
    (me.primaryRole ? facility.allowedRoles.includes(me.primaryRole) : false);

  return (
    <AppShell
      me={me}
      active="home"
      sidebarItems={[
        { label: "Facilities Home", href: "/", active: false },
        { label: "My Bookings", href: "/my-bookings", active: false },
        { label: "My Account", href: `${process.env.SSO_BASE_URL}/account`, active: false },
        { label: "SSO (identity)", href: process.env.SSO_BASE_URL!, active: false },
        { label: "Main (access)", href: process.env.MAIN_BASE_URL!, active: false },
      ]}
    >
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
          <span className="text-xs text-muted-foreground">
            Max {capLabel(facility.maxMinutes ?? facility.building.maxMinutes ?? SLOT_MAX_MINUTES)} per booking
          </span>
        </div>
      </div>

      <BookingClient
        facility={{ id: facility.id, name: facility.name }}
        editBooking={editBooking}
        onEdited={() => undefined}
        buildingName={facility.building.name}
        today={today}
        todaySlots={slots}
        me={{
          name: me.name,
          primaryRole: me.primaryRole ?? "",
          role: local?.role ?? "USER",
          isApprover: local?.isApprover ?? false,
          isPoc: local?.isPoc ?? false,
        }}
        eligible={eligible}
        nowMin={nowMin}
        maxMinutes={facility.maxMinutes}
        buildingMaxMinutes={facility.building.maxMinutes}
        roleLimits={facility.roleLimits}
      />

      <p className="mt-4 text-xs text-muted-foreground">
        All times are Indian Standard Time (server time). Drag on the calendar to select a range —
        release to add it, then drag again to add more. Ranges stay selected until you remove them or
        confirm the booking. Current IST time:{" "}
        {`${String(Math.floor(nowMin / 60)).padStart(2, "0")}:${String(nowMin % 60).padStart(2, "0")}`}.
      </p>
    </AppShell>
  );
}
