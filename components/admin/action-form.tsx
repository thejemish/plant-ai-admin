"use client";

import { useTransition } from "react";
import { useRefreshAdminDashboard } from "@/lib/admin/query";

type AdminActionFormProps = {
  action: (formData: FormData) => Promise<unknown>;
  children?: React.ReactNode;
  className?: string;
  id?: string;
};

export function AdminActionForm({ action, children, className, id }: AdminActionFormProps) {
  const refreshAdminDashboard = useRefreshAdminDashboard();
  const [, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        startTransition(async () => {
          await action(formData);
          await refreshAdminDashboard();
        });
      }}
      className={className}
      id={id}
    >
      {children}
    </form>
  );
}
