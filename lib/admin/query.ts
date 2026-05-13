"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { AdminDashboardData } from "@/lib/admin/types";

export const adminDashboardQueryKey = ["admin", "dashboard"] as const;

export async function fetchAdminDashboardData(): Promise<AdminDashboardData> {
  const response = await fetch("/api/admin/dashboard", {
    credentials: "same-origin",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Failed to load admin dashboard data.");
  }

  return response.json() as Promise<AdminDashboardData>;
}

export function useRefreshAdminDashboard() {
  const queryClient = useQueryClient();
  const router = useRouter();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminDashboardQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["admin", "list"] }),
    ]);
    router.refresh();
  };
}
