import { credentials, guard, readBody, requireCode } from "@/lib/server/http";
import {
  ApiError,
  claimHost,
  endGame,
  expireRound,
  forceReveal,
  leaveRoom,
  nextRound,
  playAgain,
  skipRound,
  startGame,
  submitBet,
  submitClue,
  submitGuess,
  switchTeam,
  updateSettings,
} from "@/lib/server/rooms";

export const dynamic = "force-dynamic";

/**
 * POST /api/rooms/:code/actions/:action
 *
 * Every in-game mutation funnels through here. The client sends its
 * identity in the x-player-id / x-player-token headers; the server decides
 * what that player is allowed to do (see src/lib/server/rooms.ts).
 *
 *   team      { teamId }              lobby: move to another team
 *   settings  { categories, goal, betsEnabled, lang, teamNames,
 *              clueSeconds, guessSeconds }                       host only
 *   start     -                       host only
 *   clue      { clue }                clue-giver only
 *   guess     { value }               active team, non clue-giver
 *   bet       { side: left|right }    other teams
 *   reveal    -                       host or clue-giver (skip stragglers)
 *   next      -                       host or clue-giver
 *   skip      -                       host or clue-giver, abandon the round
 *   expire    -                       anyone, once the phase clock has run out
 *   again     -                       host only, back to lobby
 *   end       -                       host only, finish and record results
 *   host      -                       take over from a host who has gone quiet
 *   leave     -                       drop out of the room
 */
export async function POST(
  req: Request,
  { params }: { params: { code: string; action: string } }
) {
  const body = await readBody(req);
  const { playerId, token } = credentials(req);

  return guard(async () => {
    const code = requireCode(params.code);

    switch (params.action) {
      case "team":
        return switchTeam(code, playerId, token, body.teamId);
      case "settings":
        return updateSettings(code, playerId, token, {
          categories: body.categories,
          goal: body.goal,
          betsEnabled: body.betsEnabled,
          lang: body.lang,
          teamNames: body.teamNames,
          clueSeconds: body.clueSeconds,
          guessSeconds: body.guessSeconds,
        });
      case "start":
        return startGame(code, playerId, token);
      case "clue":
        return submitClue(code, playerId, token, body.clue);
      case "guess":
        return submitGuess(code, playerId, token, body.value);
      case "bet":
        return submitBet(code, playerId, token, body.side);
      case "reveal":
        return forceReveal(code, playerId, token);
      case "next":
        return nextRound(code, playerId, token);
      case "skip":
        return skipRound(code, playerId, token);
      case "expire":
        return expireRound(code, playerId, token);
      case "again":
        return playAgain(code, playerId, token);
      case "end":
        return endGame(code, playerId, token);
      case "host":
        return claimHost(code, playerId, token);
      case "leave":
        return leaveRoom(code, playerId, token);
      default:
        throw new ApiError(404, `Unknown action "${params.action}"`);
    }
  });
}
