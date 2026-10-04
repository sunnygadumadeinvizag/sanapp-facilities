import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { dashboardAccess } from "@/lib/dashboard";
import { bookingTypeLabel, bookingStatusLabel } from "@/lib/labels";
import { fmtDuration, fmtIstDateTime, fmtMin, slotDurationMin } from "@/lib/ist";

/**
 * GET /api/dashboard/export?facilityId=a,b&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * The complete booking history of one or more facilities as CSV — every slot,
 * whatever its state (confirmed, waiting for approval, declined, cancelled),
 * with the dates, times, people and decision details.
 *
 * Who may export what is the dashboard rule itself: the app admin and the
 * central super admin export anything; anyone else exports exactly the
 * facilities they were given access to (as a POC, an approval person or a named
 * dashboard viewer). Requesting a facility outside that set is refused rather
 * than silently dropped, so a wrong link is never mistaken for a complete file.
 *
 * The file is plain CSV with a UTF-8 BOM and CRLF line ends so Excel opens it
 * directly, and every field is quoted — descriptions may contain commas or
 * newlines.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** RFC-4180 style CSV field: always quoted, inner quotes doubled. */
function csvField(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(fields: unknown[]): string {
  return fields.map(csvField).join(",");
}

/** The file name, with the range when one was chosen. */
function fileName(from: string, to: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const range = from || to ? `-${from || "start"}_${to || today}` : "";
  return `facilities-bookings${range}-${today}.csv`;
}

export async function GET(request: NextRequest) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const access = await dashboardAccess();
  if (!access.visible) {
    return NextResponse.json(
      { error: "You have not been given access to the bookings dashboard" },
      { status: 403 }
    );
  }

  const params = request.nextUrl.searchParams;
  const requested = (params.get("facilityId") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set(access.facilityIds);
  const isAdmin = me.role === "ADMIN";

  let facilityIds: string[];
  if (requested.length === 0) {
    facilityIds = access.facilityIds;
  } else if (isAdmin) {
    facilityIds = requested;
  } else {
    const outside = requested.filter((id) => !allowed.has(id));
    if (outside.length > 0) {
      return NextResponse.json(
        { error: "You do not have access to the booking history of those facilities" },
        { status: 403 }
      );
    }
    facilityIds = requested;
  }

  if (facilityIds.length === 0) {
    return NextResponse.json(
      { error: "No facilities are available to export for your account" },
      { status: 400 }
    );
  }

  const from = (params.get("from") ?? "").trim();
  const to = (params.get("to") ?? "").trim();
  const dateFilter: Record<string, string> = {};
  if (DATE_RE.test(from)) dateFilter.gte = from;
  if (DATE_RE.test(to)) dateFilter.lte = to;

  const rows = await prisma.booking.findMany({
    where: {
      facilityId: { in: facilityIds },
      ...(Object.keys(dateFilter).length > 0 ? { date: dateFilter } : {}),
    },
    orderBy: [
      { facility: { name: "asc" } },
      { date: "asc" },
      { startMin: "asc" },
    ],
    select: {
      id: true,
      code: true,
      batchId: true,
      type: true,
      status: true,
      date: true,
      endDate: true,
      startMin: true,
      endMin: true,
      purpose: true,
      needAvSupport: true,
      createdAt: true,
      approvalRequestedAt: true,
      decidedAt: true,
      decisionNote: true,
      cancelledAt: true,
      cancelReason: true,
      facility: { select: { name: true, building: { select: { name: true } } } },
      user: { select: { name: true, username: true } },
      forUser: { select: { name: true, username: true } },
      decidedBy: { select: { name: true, username: true } },
      cancelledBy: { select: { name: true, username: true } },
    },
  });

  // A booking's reference lives on the first slot of its submission group, so
  // every row of a multi-slot booking shows the same readable reference.
  const batchIds = [
    ...new Set(rows.map((r) => r.batchId).filter((v): v is string => Boolean(v))),
  ];
  const anchors =
    batchIds.length > 0
      ? await prisma.booking.findMany({
          where: { batchId: { in: batchIds }, code: { not: null } },
          select: { batchId: true, code: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
  const codeByBatch = new Map<string, string>();
  for (const a of anchors) {
    if (a.batchId && a.code && !codeByBatch.has(a.batchId)) codeByBatch.set(a.batchId, a.code);
  }

  const header = [
    "Booking reference",
    "Slot id",
    "Facility",
    "Building",
    "Start date",
    "End date",
    "Start time (IST)",
    "End time (IST)",
    "Duration",
    "Booking type",
    "Status",
    "Booked by",
    "Booked by username",
    "Booked on behalf of",
    "On-behalf username",
    "Description",
    "AV support",
    "Created at (IST)",
    "Approval requested at (IST)",
    "Decided at (IST)",
    "Decided by",
    "Decision note",
    "Cancelled at (IST)",
    "Cancelled by",
    "Cancellation reason",
  ];

  const lines = [csvRow(header)];
  for (const r of rows) {
    const endDay = r.endDate && r.endDate >= r.date ? r.endDate : r.date;
    lines.push(
      csvRow([
        r.code ?? (r.batchId ? codeByBatch.get(r.batchId) : undefined) ?? "",
        r.id,
        r.facility.name,
        r.facility.building.name,
        r.date,
        endDay,
        fmtMin(r.startMin),
        fmtMin(r.endMin),
        fmtDuration(slotDurationMin(r.date, r.startMin, endDay, r.endMin)),
        bookingTypeLabel(r.type),
        bookingStatusLabel(r.status),
        r.forUser?.name ?? r.user?.name ?? "",
        r.forUser?.username ?? r.user?.username ?? "",
        r.forUser?.name ?? "",
        r.forUser?.username ?? "",
        r.purpose ?? "",
        r.needAvSupport ? "Yes — AV technician needed" : "No",
        fmtIstDateTime(r.createdAt.toISOString()).replace(/ IST$/, ""),
        fmtIstDateTime(r.approvalRequestedAt?.toISOString() ?? null).replace(/ IST$/, ""),
        fmtIstDateTime(r.decidedAt?.toISOString() ?? null).replace(/ IST$/, ""),
        r.decidedBy ? `${r.decidedBy.name} (@${r.decidedBy.username})` : "",
        r.decisionNote ?? "",
        fmtIstDateTime(r.cancelledAt?.toISOString() ?? null).replace(/ IST$/, ""),
        r.cancelledBy ? `${r.cancelledBy.name} (@${r.cancelledBy.username})` : "",
        r.cancelReason ?? "",
      ])
    );
  }

  // The BOM and CRLF line ends are what make Excel open a UTF-8 CSV without
  // asking, and every field is quoted because descriptions may contain commas.
  const csv = `\uFEFF${lines.join("\r\n")}\r\n`;

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName(from, to)}"`,
      "cache-control": "no-store",
    },
  });
}
