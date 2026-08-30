import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { isPocOfFacility } from "@/lib/poc";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking || !booking.pdf) {
    return NextResponse.json({ error: "PDF not found" }, { status: 404 });
  }

  // Permission check: if attachment is private, only Admin, POC, or Booker can download it.
  const isPublic = booking.isPublicAttachment;
  const isBooker = booking.userId === user.id || booking.forUserId === user.id;
  const isAdmin = user.role === "ADMIN";
  const isPoc = !isPublic && !isBooker && !isAdmin ? await isPocOfFacility(user.id, booking.facilityId) : false;

  if (!isPublic && !isBooker && !isAdmin && !isPoc) {
    return NextResponse.json({ error: "This attachment is private to the booker and administrators." }, { status: 403 });
  }

  const filename = booking.pdfName ?? `booking-${booking.id}.pdf`;
  // Buffer -> Uint8Array<ArrayBuffer> (TS-safe copy of the underlying bytes).
  const bytes = new Uint8Array(booking.pdf.byteLength);
  bytes.set(booking.pdf);
  return new NextResponse(bytes, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "content-length": String(booking.pdf.length),
      "cache-control": "private, max-age=300",
    },
  });
}

