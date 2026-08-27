import { credentials, guard, requireCode } from "@/lib/server/http";
import { getLiveGuesses } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:code/watch — the active team's markers, live.
 *
 * For the teams that have to bet on them. Refused for the team currently
 * guessing, whose markers must stay hidden from each other until the reveal,
 * which is why this is a separate authenticated call and not part of the room
 * state everybody receives.
 */
export async function GET(req: Request, { params }: { params: { code: string } }) {
  const { playerId, token } = credentials(req);
  return guard(() => getLiveGuesses(requireCode(params.code), playerId, token));
}
