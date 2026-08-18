import { credentials, guard, requireCode } from "@/lib/server/http";
import { membership } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:code/me — does this device still hold a seat in this room?
 * 200 with the player, or 401. Nothing else uses the answer, which is the
 * point: the client stops having to infer it from the room state.
 */
export async function GET(req: Request, { params }: { params: { code: string } }) {
  const { playerId, token } = credentials(req);
  return guard(async () => membership(requireCode(params.code), playerId, token));
}
