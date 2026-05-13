"use client";

import { usePathname } from "next/navigation";

const titles: Record<string, { description: string; title: string }> = {
  "/": {
    title: "Knowledge Base Console",
    description: "Curate crop intelligence, embeddings, guide chunks, and mobile snapshots.",
  },
  "/crops": {
    title: "Crops",
    description: "Manage crop taxonomy entries used by mobile sync and disease mapping.",
  },
  "/diseases": {
    title: "Diseases",
    description: "Review crop disease labels, symptoms, and publish status.",
  },
  "/treatments": {
    title: "Treatments",
    description: "Publish treatment steps by disease, crop, severity, and method.",
  },
  "/leaves": {
    title: "Reference Leaves",
    description: "Verify leaf samples before embedding and mobile release.",
  },
  "/imports": {
    title: "Dataset Imports",
    description: "Queue Hugging Face or local parquet datasets for review-first ingestion.",
  },
  "/embeddings": {
    title: "Embeddings",
    description: "Queue MobileCLIP jobs and review nearest-neighbor collisions.",
  },
  "/guides": {
    title: "Guides",
    description: "Import guide documents and publish reviewed knowledge chunks.",
  },
  "/snapshots": {
    title: "Snapshots",
    description: "Build snapshot manifests for offline mobile synchronization.",
  },
};

export function PageTitle() {
  const pathname = usePathname();
  const title = titles[pathname] ?? titles["/"];

  return (
    <div className="min-w-0">
      <h1 className="hidden text-xl font-semibold tracking-tight lg:block">{title.title}</h1>
      <p className="hidden text-sm text-muted-foreground md:block">{title.description}</p>
    </div>
  );
}
