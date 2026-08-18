import { NO_STORE } from "@/lib/server/http";
import { record } from "@/lib/server/analytics";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/events — batched analytics ingest.
 *
 * Always answers 204, even for a malformed body: this endpoint is called from
 * `sendBeacon` during page unload, where nobody is listening for a reply, and
 * an error here must never turn into a broken game. Everything the server
 * refuses is dropped quietly (see src/lib/server/analytics.ts for the rules).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    await record(body);
  } catch (e) {
    console.warn("[analytics] bad batch:", e instanceof Error ? e.message : e);
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
