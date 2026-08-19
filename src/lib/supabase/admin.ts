import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. SERVER ONLY — it bypasses RLS.
 * Importing this file from a client component will (intentionally) fail.
 */

let cached: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY (see .env.example)."
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { "x-application-name": "consensus-radar" },
      // Every database read goes through this, and it must never be cached.
      //
      // supabase-js talks to PostgREST with plain `fetch`, and in the App
      // Router `fetch` is not the platform's — Next.js replaces it with its
      // own, which memoises GET responses in the Data Cache keyed on the URL.
      // Reading the room state always produces the same upstream URL
      // (`/players?select=*&room_id=eq.<id>&order=joined_at.asc`), so the first
      // answer it ever gets is the one it keeps returning. If that first answer
      // was taken while the room had one player in it, the room has one player
      // in it forever, on every device, no matter who joins.
      //
      // That was the bug: a lobby frozen on its creation snapshot, while a
      // mutation — which is a POST and therefore not a cache candidate —
      // answered with the true state for exactly as long as it took the next
      // poll to overwrite it. `export const dynamic = "force-dynamic"` on the
      // route is not enough, because the cache in question belongs to the
      // fetch, not to the route.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return cached;
}

export function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
