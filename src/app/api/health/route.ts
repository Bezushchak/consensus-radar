import { NextResponse } from "next/server";
import { mixpanelEnabled } from "@/lib/server/mixpanel";
import { scaleSource } from "@/lib/server/scales";
import { schemaReport } from "@/lib/server/schema-check";
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

    // `scales: "builtin"` means the seed has not been run (or the table is
    // empty): the game still works, it just deals from the shorter code list.
    const [{ source, count }, schema] = await Promise.all([scaleSource(), schemaReport()]);

    // A database missing columns this build writes to is not "healthy" even
    // though every connection works, so it answers 503 and names the gap.
    return NextResponse.json(
      {
        ok: schema.ok,
        supabase: "reachable",
        scales: source,
        scaleCount: count,
        schema,
        // "off" is a valid state, not a fault: the app's own analytics work
        // without it. It is here so a token that never got deployed is visible.
        mixpanel: mixpanelEnabled() ? "on" : "off",
      },
      { status: schema.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, supabase: "unreachable", detail: e instanceof Error ? e.message : String(e) },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
