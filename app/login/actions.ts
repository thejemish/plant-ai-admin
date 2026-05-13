"use server";

import { redirect } from "next/navigation";
import { getAdminRoleForUser, getSupabaseAuthServerClient } from "@/lib/admin/auth";
import { hasSupabaseAdminConfig } from "@/lib/admin/supabase";

export async function signInAdmin(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=missing");
  }

  if (!hasSupabaseAdminConfig) {
    redirect("/login?error=config");
  }

  const supabase = await getSupabaseAuthServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    redirect("/login?error=invalid");
  }

  const role = await getAdminRoleForUser(data.user.id);

  if (!role) {
    await supabase.auth.signOut();
    redirect("/login?error=forbidden");
  }

  redirect("/");
}

export async function signOutAdmin() {
  const supabase = await getSupabaseAuthServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
