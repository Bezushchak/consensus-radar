import { guard } from "@/lib/server/http";
import { loadBoard, type Board, type Period } from "@/lib/server/leaderboard";

export const dynamic = "force-dynamic";

const BOARDS: Board[] = ["teams", "rounds", "players", "scales"];
const PERIODS: Period[] = ["all", "week", "month"];

/** GET /api/leaderboard?board=teams&period=all&limit=25 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const board = (url.searchParams.get("board") ?? "teams") as Board;
  const period = (url.searchParams.get("period") ?? "all") as Period;
  const limitRaw = Number(url.searchParams.get("limit") ?? 25);

  const safeBoard = BOARDS.includes(board) ? board : "teams";
  const safePeriod = PERIODS.includes(period) ? period : "all";
  const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(5, Math.round(limitRaw))) : 25;

  return guard(() => loadBoard(safeBoard, safePeriod, limit));
}
