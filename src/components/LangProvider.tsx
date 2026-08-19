"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { loadLang, saveLang } from "@/lib/client/identity";
import { track } from "@/lib/client/track";
import { t as translate } from "@/lib/i18n";
import type { Lang } from "@/lib/types";

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextValue>({
  lang: "ua",
  setLang: () => {},
  t: (key) => key,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ua");

  // Read the stored preference after mount so the server and client render
  // the same markup on first paint.
  useEffect(() => {
    setLangState(loadLang());
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
    document.documentElement.lang = next;
    // `lang_switched` has been on the ingest allowlist since analytics went in
    // but nothing ever sent it. A documented event that never fires is worse
    // than no event: a flat line reads as "nobody switches" rather than
    // "nobody measured". `to` is the language chosen, which is the only part
    // worth knowing — the language left behind is whatever the default was.
    track("lang_switched", { to: next });
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang]
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
