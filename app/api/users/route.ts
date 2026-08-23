import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser, isAdmin, listSsoUsers } from "@/lib/auth";
import { isPocAnywhere, resolveUserByUsername } from "@/lib/poc";

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") ?? "sso";
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();

  if (kind === "sso") {
    // For ON_BEHALF bookings and POC lookup: any POC (or admin) may search
    // the SSO registry by username/name — the full user list is never shown.
    const poc = user.role === "ADMIN" || (await isPocAnywhere(user.id));
    if (!poc) {
      return NextResponse.json({ error: "POC access is required" }, { status: 403 });
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

  // kind === "admins" — the app administrators (a small, bounded list).
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can view admins" }, { status: 403 });
  }
  const admins = await prisma.appUser.findMany({
    where: { role: "ADMIN" },
    orderBy: { name: "asc" },
    select: { id: true, username: true, name: true, email: true, primaryRole: true, role: true },
  });
  return NextResponse.json({ users: admins });
}

/** POST /api/users  { username } — promote a user (resolved by username from
 *  the local users or the SSO registry) to app ADMIN. */
export async function POST(request: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only the app administrator can manage admins" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const username = String(body.username ?? "").trim();
  if (!username) return NextResponse.json({ error: "username is required" }, { status: 400 });

  const user = await resolveUserByUsername(username);
  if (!user) {
    return NextResponse.json(
      { error: `No user found for “${username}” — check the username in the SSO registry` },
      { status: 404 }
    );
  }
  await prisma.appUser.update({ where: { id: user.id }, data: { role: "ADMIN" } });

  const admins = await prisma.appUser.findMany({
    where: { role: "ADMIN" },
    orderBy: { name: "asc" },
    select: { id: true, username: true, name: true, email: true, primaryRole: true, role: true },
  });
  return NextResponse.json({ ok: true, users: admins });
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
