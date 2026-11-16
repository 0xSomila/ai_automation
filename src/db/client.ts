import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseServerClient(url: string, key: string): SupabaseClient {
  const legacyPayload = key.match(/^[\w-]+\.([\w-]+)\.[\w-]+$/)?.[1];
  let legacyServiceRole = false;
  if (legacyPayload) {
    try {
      const claims = JSON.parse(Buffer.from(legacyPayload, "base64url").toString("utf8"));
      legacyServiceRole = claims?.role === "service_role";
    } catch {
      // An invalid JWT cannot authenticate as the server role.
    }
  }
  if (!/^sb_secret_[\w-]+$/.test(key) && !legacyServiceRole) {
    throw new Error("SUPABASE_SERVICE_KEY must be a Supabase secret key or legacy service_role key from the project’s API Keys page.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
