import { guard, requireCode } from "@/lib/server/http";
import { roomSummary } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/**
 * GET /api/rooms/:code/summary — per-player calibration for the game in this
 * room, folded from the reveals it has already shown the table.
 *
 * Unauthenticated, like the state read: it contains nothing that was not on
 * everybody's screen at the moment each round was revealed.
 */
export async function GET(_req: Request, { params }: { params: { code: string } }) {
  return guard(async () => roomSummary(requireCode(params.code)));
}
