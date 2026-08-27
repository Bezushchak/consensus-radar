"use client";

import Link from "next/link";
import { useLang } from "./LangProvider";

export default function AppHeader({
  nav,
}: {
  nav?: "leaderboard" | "home" | "none" | "howto";
}) {
  const { lang, setLang, t } = useLang();

  return (
    <header className="app">
      <div className="brand">
        <Link href="/" className="logo" aria-label="Consensus Radar">
          <svg viewBox="0 0 24 24" fill="none" stroke="#06121f" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12A10 10 0 1 1 12 2" />
            <path d="M12 12l7-4" />
            <circle cx="12" cy="12" r="2" fill="#06121f" />
          </svg>
        </Link>
        <div>
          <h1>Consensus Radar</h1>
          <p>{t("tagline")}</p>
        </div>
      </div>

      <div className="headright">
        {nav === "leaderboard" ? (
          <Link href="/leaderboard" className="pill">
            🏆 {t("leaderboardLink")}
          </Link>
        ) : null}
        {/* The tutorial is offered from the front door and from the join gate,
            but not from inside a live room: there, the link would walk somebody
            out of a round they are in the middle of. */}
        {nav === "leaderboard" || nav === "home" ? (
          <Link href="/how-to-play" className="pill">
            ❓ {t("howToLink")}
          </Link>
        ) : null}
        {nav === "home" || nav === "howto" ? (
          <Link href="/" className="pill">
            ← {t("homeLink")}
          </Link>
        ) : null}
        <div className="lang">
          <button className={lang === "ua" ? "active" : ""} onClick={() => setLang("ua")}>
            UA
          </button>
          <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>
            EN
          </button>
        </div>
      </div>
    </header>
  );
}
