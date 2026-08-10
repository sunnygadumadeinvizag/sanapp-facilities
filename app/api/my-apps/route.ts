import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifyAppSession } from "@/lib/session";
import { MAIN_API_KEY, MAIN_BASE_URL } from "@/lib/sso";

export async function GET() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyAppSession(token) : null;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const res = await fetch(`${MAIN_BASE_URL}/api/my-apps`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-key": MAIN_API_KEY,
      },
      body: JSON.stringify({ userId: user.sub, username: user.username }),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ apps: [] });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ apps: [] });
  }
}
