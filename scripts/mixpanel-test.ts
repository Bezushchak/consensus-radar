/**
 * npm run mixpanel:test
 *
 * Sends one labelled probe event through exactly the same code path the app
 * uses, then tells you where to look for it. This exists because every failure
 * mode of a Mixpanel integration looks identical from the app — events go out,
 * nothing appears — and the causes are all boring: wrong token, wrong data
 * region, token never deployed.
 *
 * It reads .env.local, so run it from the project root after filling that in.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventRow } from "../src/lib/server/analytics";
import { forward, mixpanelEnabled } from "../src/lib/server/mixpanel";

async function main(): Promise<void> {
  const files = loadEnvFiles();

  if (!mixpanelEnabled()) {
    const looked = files.length > 0 ? files.join(", ") : "none found";
    console.error(
      "MIXPANEL_TOKEN is not set.\n\n" +
        `Add it to .env (or .env.local) in the project root — read: ${looked}\n\n` +
        "  MIXPANEL_TOKEN=your-project-token\n\n" +
        "In Mixpanel: gear icon (bottom left) → Project Settings → Access Keys → Project Token."
    );
    process.exit(1);
  }

  const host = process.env.MIXPANEL_HOST ?? "https://api-eu.mixpanel.com";
  const stamp = new Date().toISOString();

  // A distinct id nobody will confuse with a player, and an event name that is
  // not part of the funnel, so a probe cannot skew a single report.
  const probe: EventRow[] = [
    {
      session_id: `probe-${Date.now()}`,
      player_uid: null,
      room_code: null,
      name: "mixpanel_probe",
      path: "/scripts/mixpanel-test",
      props: { sent_at: stamp, source_check: true },
      lang: "en",
      device: "desktop",
      ts: stamp,
    },
  ];

  console.log(`Sending one "mixpanel_probe" event to ${host} …`);

  const { sent } = await forward(probe);

  if (sent === 1) {
    console.log(
      "\nAccepted by Mixpanel.\n\n" +
        "Now confirm it arrived — ingestion is quick but not instant, so give it a minute:\n" +
        "  1. Open your project at eu.mixpanel.com.\n" +
        "  2. Left sidebar → Data → Events.\n" +
        "  3. Look for `mixpanel_probe` in the list.\n\n" +
        "If it is there, the token and the data region are both right, and the app will\n" +
        "mirror real events as soon as MIXPANEL_TOKEN is set in Vercel too."
    );
    return;
  }

  console.error(
    "\nMixpanel did not accept it. The warning above says why; the usual causes:\n" +
      "  • Wrong token — copy it again from Project Settings → Access Keys.\n" +
      "  • Wrong region — this project is on eu.mixpanel.com, so the host must be\n" +
      "    https://api-eu.mixpanel.com. The US host answers 200 and drops the data.\n" +
      "  • No network route out (a VPN or proxy that blocks Mixpanel)."
  );
  process.exit(1);
}

/**
 * Minimal env-file reader: this script runs outside Next, which would otherwise
 * load these for you.
 *
 * The order matches the one Next itself uses, most specific first, and the same
 * first-writer-wins rule applies — so a value in .env.local beats the same key
 * in .env. Reading all of them matters: which file a project actually keeps its
 * secrets in is a coin flip, and a test that reports "not set" because it only
 * looked in one of them is worse than no test at all.
 *
 * Returns the files it found, so the failure message can say where it looked.
 */
function loadEnvFiles(): string[] {
  const found: string[] = [];

  for (const file of [".env.local", ".env.development.local", ".env.development", ".env"]) {
    let text: string;
    try {
      text = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue; // Already-exported variables are fine too.
    }
    found.push(file);

    for (const line of text.split("\n")) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      if (process.env[key]) continue;
      process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  }

  return found;
}

void main();
