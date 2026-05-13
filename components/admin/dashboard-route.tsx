"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CropsSection,
  DiseasesSection,
  EmbeddingsSection,
  GuidesSection,
  ImportsSection,
  LeavesSection,
  OverviewSection,
  SnapshotsSection,
  TreatmentsSection,
} from "@/components/admin/sections";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { adminDashboardQueryKey, fetchAdminDashboardData } from "@/lib/admin/query";

type AdminDashboardRouteProps = {
  section:
    | "overview"
    | "crops"
    | "diseases"
    | "treatments"
    | "leaves"
    | "imports"
    | "embeddings"
    | "guides"
    | "snapshots";
};

export function AdminDashboardRoute({ section }: AdminDashboardRouteProps) {
  const query = useQuery({
    queryKey: adminDashboardQueryKey,
    queryFn: fetchAdminDashboardData,
    refetchInterval: 5_000,
  });

  if (query.isPending) {
    return (
      <div className="rounded-lg border bg-muted/35 p-4 text-sm text-muted-foreground">
        Loading admin data…
      </div>
    );
  }

  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{query.error.message}</span>
          <Button onClick={() => query.refetch()} size="sm" type="button" variant="outline">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const data = query.data;

  switch (section) {
    case "crops":
      return <CropsSection data={data} />;
    case "diseases":
      return <DiseasesSection data={data} />;
    case "treatments":
      return <TreatmentsSection data={data} />;
    case "leaves":
      return <LeavesSection data={data} />;
    case "imports":
      return <ImportsSection data={data} />;
    case "embeddings":
      return <EmbeddingsSection data={data} />;
    case "guides":
      return <GuidesSection data={data} />;
    case "snapshots":
      return <SnapshotsSection data={data} />;
    case "overview":
    default:
      return <OverviewSection data={data} />;
  }
}
