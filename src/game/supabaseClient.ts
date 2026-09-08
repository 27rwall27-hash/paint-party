import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/** Lazily constructed so a missing Supabase config can't break local (offline) play, which never
 * calls this — only online mode (creating/joining a room) actually needs it. */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Online play needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to be set.");
  }
  client = createClient(url, anonKey);
  return client;
}
