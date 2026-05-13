import { EMBEDDING_CONTRACT } from "@/lib/architecture-contract";
import type { SimilarityReviewRow } from "@/lib/admin/similarity";

export type CropRow = {
  id: string;
  display_name: string;
  family: string | null;
  status: string;
  updated_at: string;
};

export type DiseaseRow = {
  id: string;
  slug: string;
  name: string;
  crops: string[];
  status: string;
  is_healthy: boolean;
};

export type TreatmentRow = {
  id: string;
  disease_id: string;
  crop: string | null;
  severity: string;
  method: string;
  title: string;
  status: string;
};

export type LeafSampleRow = {
  id: string;
  crop: string;
  disease_label: string;
  caption: string | null;
  verified: boolean;
  status: string;
  updated_at: string;
};

export type GuideChunkRow = {
  id: string;
  crop: string | null;
  category: string | null;
  lang: string;
  status: string;
  chunk_text: string;
};

export type GuideDocumentRow = {
  id: string;
  title: string;
  crops: string[];
  lang: string;
  source_type: string | null;
  status: string;
};

export type JobRow = {
  id: string;
  type: string;
  status: string;
  progress: number;
  error: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
};

export type SnapshotRow = {
  id: string;
  version: number;
  storage_path: string;
  size_bytes: number | null;
  created_at: string;
};

export type DetectedDisease = {
  slug: string;
  crop: string;
  name: string;
  isHealthy: boolean;
};

export type DiseaseLookup = { id: string; name: string };

export type AdminDashboardData = {
  counts: {
    crops: number;
    diseases: number;
    leafSamples: number;
    publishedLeafSamples: number;
    pendingJobs: number;
    leafSamplesInReview: number;
    embeddingsQueued: number;
    embeddingsSucceeded: number;
    embeddingsFailed: number;
  };
  cropIds: string[];
  diseases: DiseaseLookup[];
  latestSnapshot: SnapshotRow | null;
  similarityReviews: SimilarityReviewRow[];
  pendingCrops: string[];
  pendingDiseases: DetectedDisease[];
  hasHuggingFaceToken: boolean;
};

export const adminRuntimeStatus = {
  modelId: EMBEDDING_CONTRACT.modelId,
  preprocessId: EMBEDDING_CONTRACT.preprocessId,
  vectorDimension: EMBEDDING_CONTRACT.vectorDimension,
};
