"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/components/LangProvider";
import * as api from "@/lib/client/api";
import { lastRoom, loadIdentity, rememberedName, saveIdentity } from "@/lib/client/identity";
import { startTracking, track, trackOnce, trackRoom } from "@/lib/client/track";
import { MAX_TEAMS, PALETTE, normalizeCode } from "@/lib/game/engine";

export default function HomePage() {
  const { lang, t } = useLang();
  const router = useRouter();

  const [name, setName] = useState("");
  const [teamNames, setTeamNames] = useState(["", ""]);
  const [general, setGeneral] = useState(true);
  const [analytics, setAnalytics] = useState(true);
  const [goal, setGoal] = useState(20);
  const [bets, setBets] = useState(true);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resume, setResume] = useState<string | null>(null);

  useEffect(() => {
    setName(rememberedName());
    const last = lastRoom();
    if (last && loadIdentity(last)) setResume(last);

    // Step 1 of the funnel. Everything else is measured against this number.
    startTracking();
    trackRoom(null);
    trackOnce("app_open", { resume: Boolean(last) });
  }, []);

  const defaultTeamName = (i: number) => (lang === "ua" ? `Команда ${i + 1}` : `Team ${i + 1}`);

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const categories = [general ? "general" : null, analytics ? "analytics" : null].filter(
        (c): c is string => c !== null
      );
      const { identity } = await api.createRoom({
        hostName: name,
        teamNames: teamNames.map((n, i) => n.trim() || defaultTeamName(i)),
        categories,
        goal,
        betsEnabled: bets,
        lang,
      });
      saveIdentity(identity);
      trackRoom(identity.roomCode);
      track("room_created", { teams: teamNames.length, goal, bets, cats: categories.join("+") });
      router.push(`/room/${identity.roomCode}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not create the room";
      setError(message);
      track("error_shown", { where: "create", message });
      setBusy(null);
    }
  }

  async function join() {
    const clean = normalizeCode(code);
    if (clean.length < 4) {
      setError(lang === "ua" ? "Введіть код кімнати." : "Enter the room code.");
      return;
    }
    setBusy("join");
    setError(null);
    try {
      const existing = loadIdentity(clean);
      if (existing) {
        trackRoom(clean);
        track("joined", { resumed: true });
        router.push(`/room/${clean}`);
        return;
      }
      const { identity } = await api.joinRoom(clean, name);
      saveIdentity(identity);
      trackRoom(identity.roomCode);
      track("joined", { from: "home" });
      router.push(`/room/${identity.roomCode}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not join the room";
      setError(message);
      track("error_shown", { where: "join-home", message });
      setBusy(null);
    }
  }

  return (
    <div className="wrap">
      <AppHeader nav="leaderboard" />

      <section className="card">
        <h2>{t("homeTitle")}</h2>
        <p className="sub">{t("homeSub")}</p>

        <label className="fl" htmlFor="name">
          {t("yourName")}
        </label>
        <input
          id="name"
          type="text"
          value={name}
          placeholder={t("namePlaceholder")}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
        />

        {resume ? (
          <div className="actions">
            <button
              className="btn ghost wide"
              data-ev="resume-room"
              onClick={() => router.push(`/room/${resume}`)}
            >
              {t("rejoinBtn", { code: resume })}
            </button>
          </div>
        ) : null}

        {error ? <div className="err">{error}</div> : null}
      </section>

      <div className="grid2" style={{ marginTop: 16 }}>
        {/* ---------------- create ---------------- */}
        {/* Touching anything in this card counts as "started setting a game
            up", which is the step that tells a curious visitor apart from
            somebody who meant to host. */}
        <section
          className="card"
          onFocusCapture={() => trackOnce("create_open")}
          onPointerDownCapture={() => trackOnce("create_open")}
        >
          <h2>{t("createTitle")}</h2>
          <p className="sub">{t("shareHint")}</p>

          <label className="fl">{t("teamsLabel")}</label>
          {teamNames.map((tn, i) => (
            <div className="teaminput" key={i}>
              <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
              <input
                type="text"
                value={tn}
                placeholder={defaultTeamName(i)}
                maxLength={24}
                onChange={(e) =>
                  setTeamNames((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                }
              />
              {teamNames.length > 2 ? (
                <button
                  className="btn ghost sm"
                  aria-label="remove team"
                  onClick={() => setTeamNames((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              ) : null}
            </div>
          ))}
          {teamNames.length < MAX_TEAMS ? (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn ghost sm" onClick={() => setTeamNames((p) => [...p, ""])}>
                {t("addTeam")}
              </button>
            </div>
          ) : null}

          <label className="fl">{t("catLabel")}</label>
          <div className="toggleline">
            <label className="chk">
              <input type="checkbox" checked={general} onChange={(e) => setGeneral(e.target.checked)} />
              <span>{t("catGeneral")}</span>
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
              />
              <span>{t("catAnalytics")}</span>
            </label>
          </div>

          <label className="fl" htmlFor="goal">
            {t("targetLabel")}
          </label>
          <select id="goal" value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
            <option value={15}>15</option>
            <option value={20}>20</option>
            <option value={25}>25</option>
            <option value={30}>30</option>
            <option value={0}>{t("endless")}</option>
          </select>

          <div className="toggleline">
            <label className="chk">
              <input type="checkbox" checked={bets} onChange={(e) => setBets(e.target.checked)} />
              <span>{t("betsLabel")}</span>
            </label>
          </div>

          <div className="actions">
            <button className="btn wide" data-ev="create-room" onClick={create} disabled={busy !== null}>
              {busy === "create" ? t("loading") : t("createBtn")}
            </button>
          </div>
        </section>

        {/* ---------------- join ---------------- */}
        <section className="card">
          <h2>{t("joinTitle")}</h2>
          <p className="sub">
            {lang === "ua"
              ? "Попросіть у хоста код із чотирьох символів."
              : "Ask the host for the four-character code."}
          </p>

          <label className="fl" htmlFor="code">
            {t("codeLabel")}
          </label>
          <input
            id="code"
            className="code"
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            value={code}
            maxLength={5}
            placeholder="XXXX"
            onChange={(e) => setCode(normalizeCode(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") void join();
            }}
          />

          <div className="actions">
            <button className="btn wide" data-ev="join-by-code" onClick={join} disabled={busy !== null}>
              {busy === "join" ? t("loading") : t("joinBtn")}
            </button>
          </div>

          <p className="stepnote">
            {lang === "ua"
              ? "Команду можна буде обрати вже в лоббі."
              : "You can pick your team once you're in the lobby."}
          </p>
        </section>
      </div>

      <div className="footer">
        Consensus Radar · {t("footer")} · <Link href="/how-to-play">{t("howToLink")}</Link> ·{" "}
        <Link href="/leaderboard">{t("leaderboardLink")}</Link>
      </div>
    </div>
  );
}
