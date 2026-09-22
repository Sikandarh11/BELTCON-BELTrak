import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// import.meta.env.VITE_* is statically replaced at build time and works in
// both the browser bundle and SSR. process.env.* only exists server-side
// (Node), so it's kept as a fallback for any server-only usage.
let cachedClient:
  | {
      url: string;
      anonKey: string;
      client: SupabaseClient;
    }
  | undefined;

function getSupabaseConfig() {
  const url = (import.meta.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "").trim();
  return { url, anonKey };
}

export function getSupabaseClient(): SupabaseClient {
  const { url, anonKey } = getSupabaseConfig();

  if (!url || !anonKey) {
    throw new Error("Supabase client is not configured");
  }

  const existingClient = cachedClient;
  if (existingClient && existingClient.url === url && existingClient.anonKey === anonKey) {
    return existingClient.client;
  }

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  cachedClient = { url, anonKey, client };
  return client;
}

// Server + client usage. For server-only admin calls we still use REST with service role key.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const client = getSupabaseClient();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
