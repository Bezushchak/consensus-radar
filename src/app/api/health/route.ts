import { NextResponse } from "next/server";
import { admin, isConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** GET /api/health — quick check that the deployment can reach Supabase. */
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, supabase: "missing-env" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const { error } = await admin().from("rooms").select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, supabase: "reachable" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, supabase: "unreachable", detail: e instanceof Error ? e.message : String(e) },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
