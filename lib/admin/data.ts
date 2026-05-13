import { getSupabaseAdminClient } from "@/lib/admin/supabase";
import type { AdminDashboardData, DetectedDisease } from "@/lib/admin/types";
import { buildSimilarityReviews, type EmbeddingCandidate } from "@/lib/admin/similarity";
import { hasHuggingFaceToken } from "@/lib/admin/huggingface";
import { fetchAllSupabaseRows } from "@/lib/admin/fetch-all";

export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const headOnly = { count: "exact" as const, head: true };

  const [
    cropsCountResult,
    diseasesCountResult,
    leafSamplesCountResult,
    publishedLeafSamplesCountResult,
    pendingJobsCountResult,
    leafSamplesInReviewCountResult,
    embeddingsQueuedCountResult,
    embeddingsSucceededCountResult,
    embeddingsFailedCountResult,
    cropIdRows,
    diseaseLookupRows,
    latestSnapshotResult,
    embeddingRows,
    sampleTaxonomyRows,
    allCropIdRows,
    allDiseaseSlugRows,
  ] = await Promise.all([
    supabase.from("crops").select("*", headOnly).is("deleted_at", null),
    supabase.from("diseases").select("*", headOnly).is("deleted_at", null),
    supabase.from("leaf_samples").select("*", headOnly).is("deleted_at", null),
    supabase
      .from("leaf_samples")
      .select("*", headOnly)
      .is("deleted_at", null)
      .eq("status", "published"),
    supabase.from("jobs").select("*", headOnly).in("status", ["queued", "running"]),
    supabase
      .from("leaf_samples")
      .select("*", headOnly)
      .is("deleted_at", null)
      .eq("status", "review"),
    supabase
      .from("jobs")
      .select("*", headOnly)
      .eq("type", "generate_embedding")
      .eq("status", "queued"),
    supabase
      .from("jobs")
      .select("*", headOnly)
      .eq("type", "generate_embedding")
      .eq("status", "succeeded"),
    supabase
      .from("jobs")
      .select("*", headOnly)
      .eq("type", "generate_embedding")
      .eq("status", "failed"),
    fetchAllSupabaseRows<{ id: string }>(() =>
      supabase
        .from("crops")
        .select("id")
        .is("deleted_at", null)
        .order("display_name", { ascending: true }),
    ),
    fetchAllSupabaseRows<{ id: string; name: string }>(() =>
      supabase
        .from("diseases")
        .select("id, name")
        .is("deleted_at", null)
        .order("name", { ascending: true }),
    ),
    supabase
      .from("kb_snapshots")
      .select("id, version, storage_path, size_bytes, created_at")
      .order("version", { ascending: false })
      .limit(1),
    fetchAllSupabaseRows<unknown>(() =>
      supabase
        .from("leaf_sample_embeddings")
        .select(
          "sample_id, embedding_base64, leaf_samples!inner(id, crop, disease_label, status, verified)",
        )
        .eq("leaf_samples.status", "published")
        .eq("leaf_samples.verified", true)
        .is("leaf_samples.deleted_at", null),
    ),
    fetchAllSupabaseRows<{ crop: string | null; disease_label: string | null }>(() =>
      supabase.from("leaf_samples").select("crop, disease_label").is("deleted_at", null),
    ),
    fetchAllSupabaseRows<{ id: string }>(() => supabase.from("crops").select("id").is("deleted_at", null)),
    fetchAllSupabaseRows<{ slug: string }>(() => supabase.from("diseases").select("slug").is("deleted_at", null)),
  ]);

  const firstError = [
    cropsCountResult.error,
    diseasesCountResult.error,
    leafSamplesCountResult.error,
    publishedLeafSamplesCountResult.error,
    pendingJobsCountResult.error,
    leafSamplesInReviewCountResult.error,
    embeddingsQueuedCountResult.error,
    embeddingsSucceededCountResult.error,
    embeddingsFailedCountResult.error,
    latestSnapshotResult.error,
  ].find(Boolean);

  if (firstError) {
    throw new Error(firstError.message);
  }

  const existingCropIds = new Set(allCropIdRows.map((row) => row.id));
  const existingDiseaseSlugs = new Set(allDiseaseSlugRows.map((row) => row.slug));
  const { pendingCrops, pendingDiseases } = derivePendingTaxonomy(
    sampleTaxonomyRows,
    existingCropIds,
    existingDiseaseSlugs,
  );

  return {
    counts: {
      crops: cropsCountResult.count ?? 0,
      diseases: diseasesCountResult.count ?? 0,
      leafSamples: leafSamplesCountResult.count ?? 0,
      publishedLeafSamples: publishedLeafSamplesCountResult.count ?? 0,
      pendingJobs: pendingJobsCountResult.count ?? 0,
      leafSamplesInReview: leafSamplesInReviewCountResult.count ?? 0,
      embeddingsQueued: embeddingsQueuedCountResult.count ?? 0,
      embeddingsSucceeded: embeddingsSucceededCountResult.count ?? 0,
      embeddingsFailed: embeddingsFailedCountResult.count ?? 0,
    },
    cropIds: cropIdRows.map((row) => row.id),
    diseases: diseaseLookupRows.map((row) => ({ id: row.id, name: row.name })),
    latestSnapshot: latestSnapshotResult.data?.[0] ?? null,
    similarityReviews: buildSimilarityReviews(toEmbeddingCandidates(embeddingRows)),
    pendingCrops,
    pendingDiseases,
    hasHuggingFaceToken,
  };
}

function derivePendingTaxonomy(
  rows: Array<{ crop: string | null; disease_label: string | null }>,
  existingCropIds: Set<string>,
  existingDiseaseSlugs: Set<string>,
): { pendingCrops: string[]; pendingDiseases: DetectedDisease[] } {
  const pendingCropSet = new Set<string>();
  const pendingDiseaseMap = new Map<string, DetectedDisease>();

  for (const row of rows) {
    const crop = row.crop?.trim();
    const slug = row.disease_label?.trim();

    if (crop && !existingCropIds.has(crop)) {
      pendingCropSet.add(crop);
    }

    if (slug && !existingDiseaseSlugs.has(slug) && !pendingDiseaseMap.has(slug)) {
      pendingDiseaseMap.set(slug, buildDetectedDisease(slug, crop ?? ""));
    }
  }

  return {
    pendingCrops: [...pendingCropSet].sort(),
    pendingDiseases: [...pendingDiseaseMap.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

function buildDetectedDisease(slug: string, crop: string): DetectedDisease {
  const isHealthy = /(^|-)healthy($|-)/i.test(slug);
  const cropTitle = titleize(crop);
  const diseaseCore = slug.replace(new RegExp(`^${crop}-`, "i"), "");
  const name = isHealthy
    ? `Healthy ${cropTitle || titleize(slug)}`
    : `${cropTitle} ${titleize(diseaseCore)}`.trim();

  return { slug, crop, name, isHealthy };
}

function titleize(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toEmbeddingCandidates(rows: unknown[]): EmbeddingCandidate[] {
  return rows.flatMap((row) => {
    const record = row as {
      sample_id?: string;
      embedding_base64?: string;
      leaf_samples?: {
        crop?: string;
        disease_label?: string;
        status?: string;
        verified?: boolean;
      };
    };

    if (!record.sample_id || !record.embedding_base64 || !record.leaf_samples?.crop) {
      return [];
    }

    return [
      {
        sampleId: record.sample_id,
        crop: record.leaf_samples.crop,
        diseaseLabel: record.leaf_samples.disease_label ?? "unknown",
        status: record.leaf_samples.status ?? "unknown",
        verified: Boolean(record.leaf_samples.verified),
        embeddingBase64: record.embedding_base64,
      },
    ];
  });
}
