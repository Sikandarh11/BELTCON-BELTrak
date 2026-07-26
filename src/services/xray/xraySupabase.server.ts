import "@tanstack/react-start/server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { XrayPersistenceError } from "./xrayErrors";

let cachedClient:
  | {
      url: string;
      serviceRoleKey: string;
      client: SupabaseClient;
    }
  | undefined;

export function getXrayAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  if (!url || !serviceRoleKey) {
    throw new XrayPersistenceError("X-ray database access is not configured");
  }

  if (cachedClient?.url === url && cachedClient.serviceRoleKey === serviceRoleKey) {
    return cachedClient.client;
  }

  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  cachedClient = { url, serviceRoleKey, client };
  return client;
}
