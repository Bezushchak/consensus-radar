import { guard, readBody, requireCode } from "@/lib/server/http";
import { joinRoom } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/** POST /api/rooms/:code/join — { name, teamId? } -> { state, identity } */
export async function POST(req: Request, { params }: { params: { code: string } }) {
  const body = await readBody(req);
  return guard(() => joinRoom(requireCode(params.code), body.name, body.teamId));
}
