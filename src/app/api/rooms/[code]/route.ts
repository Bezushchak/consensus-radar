import { guard, requireCode } from "@/lib/server/http";
import { getState } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/** GET /api/rooms/:code — the full authoritative room state. */
export async function GET(_req: Request, { params }: { params: { code: string } }) {
  return guard(async () => getState(requireCode(params.code)));
}
