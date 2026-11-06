import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Mirrors `supabase/migrations`. Regenerate with `supabase gen types` if it grows. */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { user_id: string; data: unknown; updated_at: string };
        Insert: { user_id: string; data: unknown; updated_at?: string };
        Update: { user_id?: string; data?: unknown; updated_at?: string };
        Relationships: [];
      };
      matches: {
        Row: { user_id: string; id: string; data: unknown; updated_at: string };
        Insert: { user_id?: string; id: string; data: unknown; updated_at?: string };
        Update: { user_id?: string; id?: string; data?: unknown; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      delete_account: { Args: Record<string, never>; Returns: undefined };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// Next.js inlines these at build time, so they must be read by their literal names.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && key);

let client: SupabaseClient<Database> | null = null;
let configError: string | null = null;

/**
 * The browser's Supabase client, or null when accounts aren't set up. A bad
 * URL or key must never break the app, so failures fall back to guest mode.
 */
export function getSupabase() {
  if (!supabaseConfigured || typeof window === "undefined" || configError) return null;
  if (!client) {
    try {
      client = createClient<Database>(url!, key!, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
    } catch (error) {
      configError = error instanceof Error ? error.message : "Invalid Supabase settings";
      console.error(`Supabase is misconfigured, staying in guest mode: ${configError}`);
      return null;
    }
  }
  return client;
}

export function supabaseConfigError() {
  return configError;
}
