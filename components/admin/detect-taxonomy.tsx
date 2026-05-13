"use client";

import { ScanSearch, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useRefreshAdminDashboard } from "@/lib/admin/query";
import type { DetectedDisease } from "@/lib/admin/types";

type DetectCropsProps = {
  pendingCrops: string[];
  onAdd: () => Promise<void>;
};

export function DetectCropsPanel({ pendingCrops, onAdd }: DetectCropsProps) {
  const [revealed, setRevealed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const refreshAdminDashboard = useRefreshAdminDashboard();

  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setRevealed(true)} type="button" variant="secondary">
          <ScanSearch className="size-4" />
          Detect crops
        </Button>
        {revealed ? (
          <Button
            disabled={pendingCrops.length === 0 || isPending}
            onClick={() =>
              startTransition(async () => {
                await onAdd();
                await refreshAdminDashboard();
                setRevealed(false);
              })
            }
            type="button"
          >
            <Plus className="size-4" />
            {isPending ? "Adding…" : `Add ${pendingCrops.length} crop${pendingCrops.length === 1 ? "" : "s"}`}
          </Button>
        ) : null}
      </div>
      {revealed ? (
        pendingCrops.length === 0 ? (
          <p className="text-sm text-muted-foreground">No new crops detected from imported samples.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {pendingCrops.map((crop) => (
              <Badge key={crop} variant="secondary">
                {crop}
              </Badge>
            ))}
          </div>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          Scan imported leaf samples for crops missing from the taxonomy.
        </p>
      )}
    </div>
  );
}

type DetectDiseasesProps = {
  pendingDiseases: DetectedDisease[];
  onAdd: () => Promise<void>;
};

export function DetectDiseasesPanel({ pendingDiseases, onAdd }: DetectDiseasesProps) {
  const [revealed, setRevealed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const refreshAdminDashboard = useRefreshAdminDashboard();

  return (
    <div className="grid gap-3 rounded-md border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => setRevealed(true)} type="button" variant="secondary">
          <ScanSearch className="size-4" />
          Detect diseases
        </Button>
        {revealed ? (
          <Button
            disabled={pendingDiseases.length === 0 || isPending}
            onClick={() =>
              startTransition(async () => {
                await onAdd();
                await refreshAdminDashboard();
                setRevealed(false);
              })
            }
            type="button"
          >
            <Plus className="size-4" />
            {isPending ? "Adding…" : `Add ${pendingDiseases.length} disease${pendingDiseases.length === 1 ? "" : "s"}`}
          </Button>
        ) : null}
      </div>
      {revealed ? (
        pendingDiseases.length === 0 ? (
          <p className="text-sm text-muted-foreground">No new diseases detected from imported samples.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {pendingDiseases.map((disease) => (
              <li className="flex items-center gap-2" key={disease.slug}>
                <Badge variant="secondary">{disease.crop || "?"}</Badge>
                <span className="font-mono text-xs">{disease.slug}</span>
                <span className="text-muted-foreground">— {disease.name}</span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          Scan imported leaf samples for disease labels missing from the taxonomy.
        </p>
      )}
    </div>
  );
}
