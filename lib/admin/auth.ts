import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseAdminClient } from "@/lib/admin/supabase";
import {
  getSupabaseAnonKey,
  getSupabaseUrl,
  hasSupabaseAdminConfig,
  hasSupabaseAuthConfig,
} from "@/lib/admin/supabase";

export type AdminRole = "superadmin" | "agronomist" | "curator" | "translator" | "viewer";

export type AdminSession =
  | { status: "unconfigured"; reason: string }
  | { status: "signed-out" }
  | { status: "forbidden"; email: string | null }
  | { status: "signed-in"; userId: string; email: string | null; role: AdminRole };

export async function getAdminSession(): Promise<AdminSession> {
  if (!hasSupabaseAuthConfig) {
    return {
      status: "unconfigured",
      reason: "Set NEXT_PUBLIC_SUPABASE_ANON_KEY to enable Supabase Auth for the admin console.",
    };
  }

  if (!hasSupabaseAdminConfig) {
    return {
      status: "unconfigured",
      reason: "Set SUPABASE_SERVICE_ROLE_KEY so the server can verify admin_users safely.",
    };
  }

  const authClient = await getSupabaseAuthServerClient();
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    return { status: "signed-out" };
  }

  const role = await getAdminRoleForUser(user.id);

  if (!role) {
    return { status: "forbidden", email: user.email ?? null };
  }

  return {
    status: "signed-in",
    userId: user.id,
    email: user.email ?? null,
    role,
  };
}

export async function getAdminRoleForUser(userId: string): Promise<AdminRole | null> {
  const adminClient = getSupabaseAdminClient();

  if (!adminClient) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to verify admin roles.");
  }

  const { data, error: roleError } = await adminClient
    .from("admin_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (roleError) {
    throw new Error(roleError.message);
  }

  if (!data?.role || !isAdminRole(data.role)) {
    return null;
  }

  return data.role;
}

export async function assertAdminRole(allowedRoles: AdminRole[]) {
  const session = await getAdminSession();

  if (session.status !== "signed-in" || !allowedRoles.includes(session.role)) {
    throw new Error("You do not have permission to perform this admin action.");
  }

  return session;
}

export async function getSupabaseAuthServerClient() {
  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase Auth is not configured.");
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set(name, value, options);
          } catch {
            // Server Components cannot always mutate cookies. The request proxy
            // handles token refreshes before rendering.
          }
        }
      },
    },
  });
}

function isAdminRole(value: string): value is AdminRole {
  return ["superadmin", "agronomist", "curator", "translator", "viewer"].includes(value);
}
