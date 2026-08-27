"use client";

import Link from "next/link";
import { useEffect } from "react";
import AppHeader from "@/components/AppHeader";
import { useLang } from "@/components/LangProvider";
import DemoPlayer from "@/components/demo/DemoPlayer";
import { startTracking, trackOnce } from "@/lib/client/track";

/**
 * How to play: a scripted game that plays itself, and the same rules in prose
 * underneath.
 *
 * Both, not either. The demo answers "what does this look like on my phone",
 * which no amount of text does well; the prose answers "what exactly is the
 * rule", which no animation does well, and is what a reader who cannot watch
 * a moving picture — or who has switched the animation off — is left with.
 */
export default function HowToPlayPage() {
  const { t } = useLang();

  useEffect(() => {
    // One event, once per session: how many people needed the tutorial at all.
    startTracking();
    trackOnce("howto_open");
  }, []);

  return (
    <div className="wrap">
      <AppHeader nav="howto" />

      <section className="card">
        <h2>{t("howToTitle")}</h2>
        <p className="sub">{t("howToSub")}</p>
        <DemoPlayer />
      </section>

      <section className="card">
        <h2>{t("howToRulesTitle")}</h2>
        <p className="sub">{t("howToSetupRules")}</p>
        <p className="sub">{t("howToGoal")}</p>
        <p className="sub">{t("howToClueRules")}</p>
        <p className="sub">{t("howToBetsRules")}</p>
      </section>

      <div className="footer">
        <Link href="/">{t("homeLink")}</Link> · <Link href="/leaderboard">{t("leaderboardLink")}</Link>
      </div>
    </div>
  );
}
