"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Anon client used in the browser for one thing only: the Realtime
 * subscription that tells the UI "something changed, refetch state".
 * All reads of authoritative state go through /api, all writes too.
 */

let cached: SupabaseClient | null | undefined;

export function browserSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  cached = url && key
    ? createClient(url, key, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 10 } },
      })
    : null;

  return cached;
}
