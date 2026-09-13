import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.107.0";
import { requiredEnv } from "./utils.ts";

function secretKey(): string {
  const currentKeys = Deno.env.get("SUPABASE_SECRET_KEYS")?.trim();
  if (currentKeys) {
    try {
      const parsed = JSON.parse(currentKeys) as Record<string, unknown>;
      const preferred = parsed.default;
      if (typeof preferred === "string" && preferred) return preferred;

      const first = Object.values(parsed).find(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      if (first) return first;
    } catch {
      throw new Error("SUPABASE_SECRET_KEYS is not valid JSON");
    }
  }

  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (legacy) return legacy;
  throw new Error("No Supabase server secret key is available");
}

export function adminClient(): SupabaseClient {
  return createClient(requiredEnv("SUPABASE_URL"), secretKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "x-client-info": "yusuf-ai-news-inbox/1.0" },
    },
  });
}
