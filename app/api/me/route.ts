import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyAppSession } from "@/lib/session";

export async function GET() {
  const store = await cookies();
  const session = store.get("app4_session")?.value;
  const user = session ? await verifyAppSession(session) : null;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ user });
}
