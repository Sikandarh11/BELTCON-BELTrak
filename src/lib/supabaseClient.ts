import { createClient } from "@supabase/supabase-js";

// import.meta.env.VITE_* is statically replaced at build time and works in
// both the browser bundle and SSR. process.env.* only exists server-side
// (Node), so it's kept as a fallback for any server-only usage.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

// Server + client usage. For server-only admin calls we still use REST with service role key.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
