import { createClient } from "@supabase/supabase-js";

export function getSupabaseUrl() {
  return process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
}

export function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function getSupabaseAdminClient() {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export const hasSupabaseAdminConfig = Boolean(
  getSupabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export const hasSupabaseAuthConfig = Boolean(getSupabaseUrl() && getSupabaseAnonKey());
