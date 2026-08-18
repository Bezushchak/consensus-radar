import { guard, readBody } from "@/lib/server/http";
import { createRoom } from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/** POST /api/rooms — create a room and become its host. */
export async function POST(req: Request) {
  const body = await readBody(req);
  return guard(() =>
    createRoom({
      hostName: body.hostName,
      teamNames: body.teamNames,
      categories: body.categories,
      goal: body.goal,
      betsEnabled: body.betsEnabled,
      lang: body.lang,
      uid: body.uid,
    })
  );
}
