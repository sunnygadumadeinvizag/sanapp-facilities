import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin, listSsoUsers } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") ?? "local";
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  if (kind === "sso") {
    // For ON_BEHALF booking: any signed-in user (approver or admin) may look
    // up the SSO registry to pick who a blocked slot is for.
    if (!user.isApprover && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Approval access is required" }, { status: 403 });
    }
    const users = await listSsoUsers();
    const filtered = q
      ? users.filter(
          (u) =>
            u.username.toLowerCase().includes(q) ||
            u.name.toLowerCase().includes(q)
        )
      : users;
    return NextResponse.json({ users: filtered.slice(0, 25) });
  }

  // kind === "local" — app users, for designation management.
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can view users" }, { status: 403 });
  }
  const users = await prisma.appUser.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      username: true,
      name: true,
      email: true,
      primaryRole: true,
      role: true,
      isApprover: true,
      isPoc: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ users });
}

export async function PATCH(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage users" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.role === "ADMIN" || body.role === "USER") data.role = body.role;
  if (typeof body.isApprover === "boolean") data.isApprover = body.isApprover;
  if (typeof body.isPoc === "boolean") data.isPoc = body.isPoc;

  // Never demote the last ADMIN — the app must keep at least one.
  if (data.role === "USER") {
    const target = await prisma.appUser.findUnique({ where: { id } });
    if (target?.role === "ADMIN") {
      const adminCount = await prisma.appUser.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot demote the last app administrator" },
          { status: 409 }
        );
      }
    }
  }

  const updated = await prisma.appUser.update({ where: { id }, data });
  return NextResponse.json({ user: updated });
}
