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
    global: { headers: { "x-application-name": "consensus-radar" } },
  });
  return cached;
}

export function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
