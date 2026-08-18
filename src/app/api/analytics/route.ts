import { guard } from "@/lib/server/http";
import { ApiError } from "@/lib/server/rooms";
import { summary, type Period } from "@/lib/server/analytics";

export const dynamic = "force-dynamic";

const PERIODS: Period[] = ["day", "week", "month", "all"];

/**
 * GET /api/analytics?period=week — the numbers behind /analytics.
 *
 * Gated on ANALYTICS_TOKEN when that variable is set: the events table holds no
 * personal data, but who played and how far they got is still the host's
 * business rather than the internet's. With no token set the endpoint is open,
 * which is fine locally and is called out in DEPLOY.md as the thing to change
 * before sharing the URL.
 */
export async function GET(req: Request) {
  return guard(async () => {
    const url = new URL(req.url);
    const expected = process.env.ANALYTICS_TOKEN;
    if (expected) {
      const given = req.headers.get("x-analytics-key") ?? url.searchParams.get("key") ?? "";
      if (given !== expected) throw new ApiError(401, "Analytics key required");
    }

    const raw = url.searchParams.get("period") as Period | null;
    const period: Period = raw && PERIODS.includes(raw) ? raw : "week";
    return summary(period);
  });
}
