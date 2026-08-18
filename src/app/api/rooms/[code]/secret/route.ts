import { credentials, guard, requireCode } from "@/lib/server/http";
import { getSecretTarget } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:code/secret — the hidden target for the current round.
 * Rejected for everyone except the round's clue-giver; the value is never
 * part of the realtime payload or the public room state.
 */
export async function GET(req: Request, { params }: { params: { code: string } }) {
  const { playerId, token } = credentials(req);
  return guard(() => getSecretTarget(requireCode(params.code), playerId, token));
}
