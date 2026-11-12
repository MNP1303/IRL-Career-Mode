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
      gps_calibrations: {
        Row: { id: string; user_id: string; name: string; data: unknown; created_at: string; updated_at: string };
        Insert: { id?: string; user_id?: string; name: string; data: unknown };
        Update: { name?: string; data?: unknown };
        Relationships: [];
      };
      gps_imports: {
        Row: {
          id: string;
          user_id: string;
          fingerprint: string;
          format: string;
          file_name: string | null;
          byte_size: number;
          storage_path: string;
          started_at: string;
          ended_at: string;
          point_count: number;
          metadata: unknown;
          created_at: string;
        };
        Insert: {
          id: string;
          user_id?: string;
          fingerprint: string;
          format: string;
          file_name?: string | null;
          byte_size: number;
          storage_path: string;
          started_at: string;
          ended_at: string;
          point_count: number;
          metadata?: unknown;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      match_gps_tracks: {
        Row: {
          id: string;
          user_id: string;
          match_id: string;
          import_id: string;
          calibration_id: string | null;
          is_active: boolean;
          heatmap_source: string;
          algorithm_version: number;
          quality: string;
          summary: unknown;
          heatmap: unknown;
          created_at: string;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: { heatmap_source?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      delete_account: { Args: Record<string, never>; Returns: undefined };
      attach_gps_track: {
        Args: {
          p_match_id: string;
          p_import_id: string;
          p_calibration_id: string | null;
          p_algorithm_version: number;
          p_quality: string;
          p_summary: unknown;
          p_heatmap: unknown;
        };
        Returns: { track_id: string; replaced_import_id: string | null }[];
      };
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
