import { NextResponse } from "next/server";

const SSO_BASE_URL = process.env.SSO_BASE_URL!;

export const dynamic = "force-dynamic";

/** Platform theme defaults (mode + brand colors), proxied from the SSO. */
export async function GET() {
  const res = await fetch(`${SSO_BASE_URL}/api/theme`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
