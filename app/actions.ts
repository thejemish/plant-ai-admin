"use server";

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { z } from "zod";
import { EMBEDDING_CONTRACT } from "@/lib/architecture-contract";
import { assertAdminRole } from "@/lib/admin/auth";
import { runJobInBackground, runJobsInBackground } from "@/lib/admin/jobs";
import { getHuggingFaceAuthHeaders, hasHuggingFaceToken } from "@/lib/admin/huggingface";
import { buildKnowledgeBaseSnapshot } from "@/lib/admin/snapshot";
import { fetchAllSupabaseRows } from "@/lib/admin/fetch-all";
import { uploadLeafObject } from "@/lib/admin/object-storage";
import { createAdminImageEmbedder } from "@/lib/embedding/admin-image-encoder";
import { float32ArrayToBase64 } from "@/lib/embedding/vector";
import { getSupabaseAdminClient } from "@/lib/admin/supabase";

const cropSchema = z.object({
  id: z.string().trim().min(2).regex(/^[a-z0-9-]+$/),
  display_name: z.string().trim().min(2),
  family: z.string().trim().optional(),
});

const diseaseSchema = z.object({
  slug: z.string().trim().min(2).regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2),
  crop: z.string().trim().min(2),
  symptoms: z.string().trim().optional(),
});

const treatmentSchema = z.object({
  disease_id: z.string().trim().min(1),
  crop: z.string().trim().min(2),
  severity: z.enum(["any", "mild", "moderate", "severe"]),
  method: z.enum(["organic", "chemical", "cultural", "prevention"]),
  title: z.string().trim().min(2),
  steps_md: z.string().trim().min(2),
});

const leafSampleSchema = z.object({
  crop: z.string().trim().min(2),
  disease_label: z.string().trim().min(2),
  disease_id: z.string().trim().optional(),
  image_url: z.string().trim().optional(),
  image_thumb_url: z.string().trim().optional(),
  caption: z.string().trim().optional(),
});

const guideChunkSchema = z.object({
  crop: z.string().trim().min(2),
  category: z.string().trim().min(2),
  lang: z.string().trim().min(2).default("en"),
  chunk_text: z.string().trim().min(10),
});

const guideDocumentSchema = z.object({
  title: z.string().trim().min(2),
  crop: z.string().trim().min(2),
  lang: z.string().trim().min(2).default("en"),
  source_type: z.string().trim().min(2).default("manual"),
  source_url: z.string().trim().optional(),
  raw_text: z.string().trim().optional(),
});

const datasetImportSchema = z.object({
  source_type: z.enum(["huggingface", "local"]),
  dataset_id: z.string().trim().min(2),
  parquet_glob: z.string().trim().min(2),
  split: z.string().trim().min(1).default("train"),
  crop_hint: z.string().trim().optional(),
  row_limit: z.preprocess(
    (value) => (value === "" || value === null || value === "full" ? undefined : value),
    z.coerce.number().int().positive().max(1_000_000).optional(),
  ),
  row_offset: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(0).max(10_000_000).optional(),
  ),
  batch_size: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(10).max(500).optional(),
  ),
  load_full: z.preprocess(
    (value) => value === "on" || value === "true" || value === true,
    z.boolean().optional(),
  ),
  allow_huggingface_large_import: z.preprocess(
    (value) => value === "on" || value === "true" || value === true,
    z.boolean().optional(),
  ),
  publish_mode: z.enum(["review", "published"]).default("review"),
});

const deletableTables = [
  "crops",
  "diseases",
  "disease_treatments",
  "guide_documents",
  "guide_chunks",
  "leaf_samples",
] as const;

const deleteRecordSchema = z.object({
  table: z.enum(deletableTables),
  id: z.string().trim().min(1),
});

const deleteLeafSamplesSchema = z.object({
  ids: z.array(z.string().trim().uuid()).optional().default([]),
  single_id: z.string().trim().uuid().optional(),
});

const HUGGING_FACE_ROWS_MAX_ATTEMPTS = 6;
const HUGGING_FACE_MAX_IMPORT_ROWS = 5_000;
const HUGGING_FACE_FULL_IMPORT_DELAY_MS = 1_200;
const HUGGING_FACE_PARTIAL_IMPORT_DELAY_MS = 300;

export async function createCrop(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = cropSchema.parse(Object.fromEntries(formData));
  await insertRow("crops", {
    ...input,
    family: input.family || null,
    aliases: {},
    status: "published",
  });
}

export async function createDisease(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = diseaseSchema.parse(Object.fromEntries(formData));
  await insertRow("diseases", {
    slug: input.slug,
    name: input.name,
    crops: [input.crop],
    symptoms: splitLines(input.symptoms),
    status: "published",
  });
}

export async function createTreatment(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = treatmentSchema.parse(Object.fromEntries(formData));
  await insertRow("disease_treatments", {
    ...input,
    status: "published",
  });
}

export async function queueLeafSample(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = leafSampleSchema.parse(Object.fromEntries(formData));
  const imageFile = formData.get("image_file");
  const uploadedAsset =
    imageFile instanceof File && imageFile.size > 0 ? await uploadLeafAsset(input, imageFile) : null;
  const imageUrl = uploadedAsset?.imageUrl ?? input.image_url;
  const imageThumbUrl = uploadedAsset?.imageThumbUrl ?? input.image_thumb_url ?? input.image_url;

  if (!imageUrl) {
    throw new Error("Upload an image file or provide an existing image path.");
  }

  await insertRow("leaf_samples", {
    crop: input.crop,
    disease_label: input.disease_label,
    disease_id: input.disease_id || null,
    caption: input.caption || null,
    symptoms_text: input.caption || null,
    image_url: imageUrl,
    image_thumb_url: imageThumbUrl ?? imageUrl,
    source_file_name: uploadedAsset?.fileName ?? null,
    verified: true,
    status: "published",
  });
}

export async function createGuideChunk(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = guideChunkSchema.parse(Object.fromEntries(formData));
  await insertRow("guide_chunks", {
    ...input,
    chunk_idx: 1,
    status: "published",
  });
}

export async function importGuideDocument(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = guideDocumentSchema.parse(Object.fromEntries(formData));
  const documentFile = formData.get("document_file");
  const documentId = randomUUID();
  const uploadedPath =
    documentFile instanceof File && documentFile.size > 0
      ? await uploadGuideDocumentAsset(documentId, input.source_type, documentFile)
      : null;

  if (!uploadedPath && !input.raw_text) {
    throw new Error("Upload a guide document or paste raw text.");
  }

  await insertRow("guide_documents", {
    id: documentId,
    title: input.title,
    source: uploadedPath,
    source_url: input.source_url || null,
    source_type: input.source_type,
    crops: [input.crop],
    lang: input.lang,
    raw_text: input.raw_text || null,
    status: "review",
  });
}

export async function deleteAdminRecord(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = deleteRecordSchema.parse(Object.fromEntries(formData));
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    revalidatePath("/");
    return;
  }

  const { error } = await supabase
    .from(input.table)
    .update({
      deleted_at: new Date().toISOString(),
      status: "archived",
    })
    .eq(input.table === "crops" ? "id" : "id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
  revalidatePath("/crops");
  revalidatePath("/diseases");
  revalidatePath("/treatments");
  revalidatePath("/leaves");
  revalidatePath("/guides");
}

export async function deleteLeafSamples(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = deleteLeafSamplesSchema.parse({
    ids: formData.getAll("ids"),
    single_id: formData.get("single_id") || undefined,
  });
  const ids = input.single_id ? [input.single_id] : [...new Set(input.ids)];
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    revalidatePath("/leaves");
    return;
  }

  if (ids.length === 0) {
    revalidatePath("/leaves");
    return;
  }

  const deletedAt = new Date().toISOString();
  const { error } = await supabase
    .from("leaf_samples")
    .update({
      deleted_at: deletedAt,
      status: "archived",
    })
    .in("id", ids);

  if (error) {
    throw new Error(error.message);
  }

  const { error: embeddingsError } = await supabase
    .from("leaf_sample_embeddings")
    .update({ deleted_at: deletedAt })
    .in("sample_id", ids);

  if (embeddingsError) {
    throw new Error(embeddingsError.message);
  }

  revalidatePath("/");
  revalidatePath("/leaves");
  revalidatePath("/embeddings");
  revalidatePath("/snapshots");
}

export async function addDetectedCrops() {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const [samplesResult, cropsResult] = await Promise.all([
    fetchAllSupabaseRows<{ crop: string | null }>(() =>
      supabase.from("leaf_samples").select("crop").is("deleted_at", null),
    ),
    fetchAllSupabaseRows<{ id: string }>(() => supabase.from("crops").select("id").is("deleted_at", null)),
  ]);

  const existing = new Set(cropsResult.map((row) => row.id));
  const missing = [
    ...new Set(
      samplesResult
        .map((row) => String(row.crop ?? "").trim())
        .filter((crop) => crop && !existing.has(crop)),
    ),
  ];

  if (missing.length > 0) {
    await ensureCrops(missing);
  }

  revalidatePath("/crops");
  revalidatePath("/diseases");
  revalidatePath("/");
}

export async function addDetectedDiseases() {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const [samplesResult, diseasesResult] = await Promise.all([
    fetchAllSupabaseRows<{ crop: string | null; disease_label: string | null }>(() =>
      supabase.from("leaf_samples").select("crop, disease_label").is("deleted_at", null),
    ),
    fetchAllSupabaseRows<{ slug: string }>(() => supabase.from("diseases").select("slug").is("deleted_at", null)),
  ]);

  const existing = new Set(diseasesResult.map((row) => row.slug));
  const seen = new Set<string>();
  const detected: ImportedDisease[] = [];

  for (const row of samplesResult) {
    const slug = String(row.disease_label ?? "").trim();
    const crop = String(row.crop ?? "").trim();

    if (!slug || !crop || existing.has(slug) || seen.has(slug)) {
      continue;
    }

    seen.add(slug);
    const isHealthy = /(^|-)healthy($|-)/i.test(slug);
    const cropTitle = titleizeSlug(crop);
    const diseaseCore = slug.replace(new RegExp(`^${crop}-`, "i"), "");
    detected.push({
      slug,
      crop,
      name: isHealthy ? `Healthy ${cropTitle}` : `${cropTitle} ${titleizeSlug(diseaseCore)}`.trim(),
      symptoms: [],
      isHealthy,
    });
  }

  if (detected.length > 0) {
    await ensureCrops(detected.map((d) => d.crop));
    await ensureDiseases(detected);
  }

  revalidatePath("/diseases");
  revalidatePath("/crops");
  revalidatePath("/");
}

export async function verifyAndPublishLeafSample(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const id = formData.get("id");
  const all = formData.get("all") === "true";
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    revalidatePath("/leaves");
    return;
  }

  const update = { verified: true, status: "published" as const };
  const query = supabase.from("leaf_samples").update(update);
  const { error } = all
    ? await query.eq("status", "review")
    : await query.eq("id", z.string().trim().min(1).parse(id));

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/leaves");
  revalidatePath("/");
}

export async function queueEmbeddingJob(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const sampleId = z.string().trim().min(1).parse(formData.get("sample_id"));
  const job = await insertRow("jobs", {
    type: "generate_embedding",
    status: "queued",
    progress: 0,
    payload: {
      sample_id: sampleId,
      model_id: EMBEDDING_CONTRACT.modelId,
      preprocess_id: EMBEDDING_CONTRACT.preprocessId,
    },
  });
  runJobInBackground("embedding", String(job.id), processEmbeddingJob);
}

export async function queueDatasetImport(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const input = datasetImportSchema.parse(Object.fromEntries(formData));
  const loadFull = input.load_full === true || formData.get("row_limit") === "full";
  const allowHuggingFaceLargeImport = input.allow_huggingface_large_import === true;
  const requestedRowLimit = input.row_limit ?? 500;

  if (input.source_type === "huggingface" && !hasHuggingFaceToken) {
    throw new Error("Set HUGGINGFACE_TOKEN, HF_TOKEN, or HUGGINGFACE_HUB_TOKEN before importing a gated Hugging Face dataset.");
  }

  if (input.source_type === "huggingface" && loadFull && !allowHuggingFaceLargeImport) {
    throw new Error("Full Hugging Face imports are disabled unless you check the advanced Hugging Face large-import override. Recommended: download locally and choose Source type = local.");
  }

  if (
    input.source_type === "huggingface" &&
    requestedRowLimit > HUGGING_FACE_MAX_IMPORT_ROWS &&
    !allowHuggingFaceLargeImport
  ) {
    throw new Error(`Hugging Face API imports are capped at ${HUGGING_FACE_MAX_IMPORT_ROWS.toLocaleString()} rows unless you check the advanced Hugging Face large-import override. Recommended: download locally and choose Source type = local.`);
  }

  const startOffset = input.row_offset ?? 0;
  const job = await insertRow("jobs", {
    type: "import_leaf_dataset",
    status: "queued",
    progress: 0,
    payload: {
      source_type: input.source_type,
      dataset_id: input.dataset_id,
      parquet_glob: input.parquet_glob,
      split: input.split,
      crop_hint: input.crop_hint || null,
      row_limit: loadFull ? null : requestedRowLimit,
      row_offset: startOffset,
      cursor_offset: startOffset,
      batch_size: input.batch_size ?? (input.source_type === "huggingface" ? 100 : 25),
      load_full: loadFull,
      allow_huggingface_large_import: allowHuggingFaceLargeImport,
      publish_mode: input.publish_mode,
      imported_rows: 0,
      skipped_rows: 0,
      source_license: input.dataset_id === "enalis/LeafNet" ? "cc-by-4.0" : null,
      requires_huggingface_token: input.source_type === "huggingface",
      target_table: "leaf_samples",
      default_verified: false,
      default_status: input.publish_mode,
    },
  });
  runJobInBackground("dataset-import", String(job.id), processDatasetImportJob);
}

export async function runNextDatasetImportJob() {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const job = await findNextDatasetImportJob();

  if (job) {
    runJobInBackground("dataset-import", job.id, processDatasetImportJob);
  }

  revalidatePath("/imports");
}

async function findNextDatasetImportJob() {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return null;
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id")
    .eq("type", "import_leaf_dataset")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (jobError) {
    throw new Error(jobError.message);
  }

  return job ? { id: String(job.id) } : null;
}

export async function processDatasetImportJob(dbJobId: string) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, payload, status")
    .eq("id", dbJobId)
    .eq("type", "import_leaf_dataset")
    .in("status", ["queued", "running"])
    .maybeSingle();

  if (jobError) {
    throw new Error(jobError.message);
  }

  if (!job) {
    return;
  }

  await updateJob(job.id, {
    status: "running",
    progress: 2,
    started_at: new Date().toISOString(),
    error: null,
  });

  try {
    const result = await importHuggingFaceLeafRows(job.id, job.payload);

    await updateJob(job.id, {
      status: "succeeded",
      progress: 100,
      finished_at: new Date().toISOString(),
      payload: {
        ...(isRecord(job.payload) ? job.payload : {}),
        imported_rows: result.importedRows,
        skipped_rows: result.skippedRows,
        detected_diseases: result.detectedDiseases,
      },
    });
  } catch (error) {
    if (error instanceof RetryableDatasetImportError) {
      await updateJob(job.id, {
        status: "queued",
        error: error.message,
      });
      return;
    }

    await updateJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown dataset import error.",
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

export async function generateAndStoreEmbedding(formData: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const sampleId = z.string().trim().uuid().parse(formData.get("sample_id"));
  const imagePath = z.string().trim().min(2).parse(formData.get("image_path"));
  const modelPath = resolveProjectPath(
    z
      .string()
      .trim()
      .optional()
      .parse(formData.get("model_path") || undefined) ?? "models/mobileclip-s0/vision_model.onnx",
  );
  const resolvedImagePath = resolveProjectPath(imagePath);

  if (!existsSync(modelPath)) {
    throw new Error(`Embedding model not found at ${modelPath}.`);
  }

  if (!existsSync(resolvedImagePath)) {
    throw new Error(`Image file not found at ${resolvedImagePath}.`);
  }

  const embedder = await getAdminEmbedder(modelPath);
  const embedding = await embedder.embed(resolvedImagePath);
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    revalidatePath("/");
    return;
  }

  const { error } = await supabase.from("leaf_sample_embeddings").upsert({
    sample_id: sampleId,
    model_id: EMBEDDING_CONTRACT.modelId,
    preprocess_id: EMBEDDING_CONTRACT.preprocessId,
    dim: EMBEDDING_CONTRACT.vectorDimension,
    normalized: true,
    embedding_base64: float32ArrayToBase64(embedding),
  });

  if (error) {
    throw new Error(error.message);
  }

  await insertRow("jobs", {
    type: "generate_embedding",
    status: "succeeded",
    progress: 100,
    payload: {
      sample_id: sampleId,
      model_id: EMBEDDING_CONTRACT.modelId,
      preprocess_id: EMBEDDING_CONTRACT.preprocessId,
    },
  });

  revalidatePath("/");
}

export async function runNextEmbeddingBatch(formData?: FormData) {
  await assertAdminRole(["superadmin", "agronomist", "curator"]);
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    revalidatePath("/embeddings");
    return;
  }

  const requested = formData ? Number(formData.get("batch_size") ?? 0) : 0;
  const batchSize = Math.max(1, Math.min(Number.isFinite(requested) && requested > 0 ? requested : 5, 50));

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("id")
    .eq("type", "generate_embedding")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(batchSize);

  if (jobsError) {
    throw new Error(jobsError.message);
  }

  if (!jobs || jobs.length === 0) {
    revalidatePath("/embeddings");
    return;
  }

  runJobsInBackground("embedding", jobs.map((job) => String(job.id)), processEmbeddingJob);

  revalidatePath("/embeddings");
}

let adminEmbedderPromise: ReturnType<typeof createAdminImageEmbedder> | null = null;
let adminEmbedderModelPath: string | null = null;

async function getAdminEmbedder(modelPath = resolveProjectPath(process.env.EMBEDDING_MODEL_PATH ?? "models/mobileclip-s0/vision_model.onnx")) {
  if (!existsSync(modelPath)) {
    throw new Error(`Embedding model not found at ${modelPath}. Set EMBEDDING_MODEL_PATH or place the file there.`);
  }

  if (!adminEmbedderPromise || adminEmbedderModelPath !== modelPath) {
    adminEmbedderModelPath = modelPath;
    adminEmbedderPromise = createAdminImageEmbedder({ modelPath });
  }

  return adminEmbedderPromise;
}

export async function processEmbeddingJob(dbJobId: string) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, payload, status")
    .eq("id", dbJobId)
    .eq("type", "generate_embedding")
    .in("status", ["queued", "running"])
    .maybeSingle();

  if (jobError) {
    throw new Error(jobError.message);
  }

  if (!job) {
    return;
  }

  const payload = isRecord(job.payload) ? job.payload : {};
  const sampleId = String(payload.sample_id ?? "");

  if (!sampleId) {
    await updateJob(job.id, {
      status: "failed",
      error: "Embedding job missing sample_id.",
      finished_at: new Date().toISOString(),
    });
    throw new Error("Embedding job missing sample_id.");
  }

  await updateJob(job.id, {
    status: "running",
    progress: 10,
    started_at: new Date().toISOString(),
    error: null,
  });

  try {
    const { data: sample, error: sampleError } = await supabase
      .from("leaf_samples")
      .select("id, image_url")
      .eq("id", sampleId)
      .maybeSingle();

    if (sampleError) {
      throw new Error(sampleError.message);
    }

    if (!sample?.image_url) {
      throw new Error(`Leaf sample ${sampleId} has no image_url.`);
    }

    const buffer = await fetchImageBuffer(String(sample.image_url));
    const embedder = await getAdminEmbedder();
    const embedding = await embedder.embedSource(buffer);

    const { error: upsertError } = await supabase.from("leaf_sample_embeddings").upsert({
      sample_id: sampleId,
      model_id: EMBEDDING_CONTRACT.modelId,
      preprocess_id: EMBEDDING_CONTRACT.preprocessId,
      dim: EMBEDDING_CONTRACT.vectorDimension,
      normalized: true,
      embedding_base64: float32ArrayToBase64(embedding),
    });

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    await updateJob(job.id, {
      status: "succeeded",
      progress: 100,
      finished_at: new Date().toISOString(),
    });
  } catch (error) {
    await updateJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown embedding error.",
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

async function fetchImageBuffer(urlOrPath: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(urlOrPath)) {
    const response = await fetch(urlOrPath);
    if (!response.ok) {
      throw new Error(`Image download failed (${response.status}) for ${urlOrPath}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  const resolved = resolveProjectPath(urlOrPath);
  if (!existsSync(resolved)) {
    throw new Error(`Image file not found at ${resolved}.`);
  }
  return readFile(resolved);
}

class RetryableDatasetImportError extends Error {}

async function importHuggingFaceLeafRows(jobId: string, payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error("Dataset import job is missing payload metadata.");
  }

  if (payload.source_type === "local") {
    return importLocalLeafImageRows(jobId, payload);
  }

  if (payload.source_type !== "huggingface") {
    throw new Error("Only Hugging Face and local folder dataset imports can be run from the admin panel right now.");
  }

  if (!hasHuggingFaceToken) {
    throw new Error("Set HUGGINGFACE_TOKEN, HF_TOKEN, or HUGGINGFACE_HUB_TOKEN before importing this dataset.");
  }

  const dataset = String(payload.dataset_id ?? "");
  const split = String(payload.split ?? "train");
  const loadFull = payload.load_full === true;
  const allowHuggingFaceLargeImport = payload.allow_huggingface_large_import === true;
  const rowLimitRaw = payload.row_limit;
  const rowLimit = loadFull
    ? Number.POSITIVE_INFINITY
    : Math.min(Number(rowLimitRaw ?? 500), 1_000_000);
  const rowOffset = Math.max(Number(payload.row_offset ?? 0), 0);
  const cursorStart = Math.max(Number(payload.cursor_offset ?? rowOffset), rowOffset);
  const publishMode = payload.publish_mode === "published" ? "published" : "review";
  const cropHint = typeof payload.crop_hint === "string" ? payload.crop_hint : "";
  const batchSize = Math.max(10, Math.min(Number(payload.batch_size ?? 100), 500));
  const importDelayMs = loadFull ? HUGGING_FACE_FULL_IMPORT_DELAY_MS : HUGGING_FACE_PARTIAL_IMPORT_DELAY_MS;
  let importedRows = Number(payload.imported_rows ?? 0);
  let skippedRows = Number(payload.skipped_rows ?? 0);
  const detectedDiseaseSlugs = new Set<string>(
    Array.isArray(payload.detected_disease_slugs) ? (payload.detected_disease_slugs as string[]) : [],
  );

  if (!dataset) {
    throw new Error("Dataset import job is missing dataset_id.");
  }

  if (loadFull && !allowHuggingFaceLargeImport) {
    throw new Error("Full Hugging Face imports are disabled unless you check the advanced Hugging Face large-import override. Recommended: download locally and choose Source type = local.");
  }

  if (rowLimit > HUGGING_FACE_MAX_IMPORT_ROWS && !allowHuggingFaceLargeImport) {
    throw new Error(`Hugging Face API imports are capped at ${HUGGING_FACE_MAX_IMPORT_ROWS.toLocaleString()} rows unless you check the advanced Hugging Face large-import override. Recommended: download locally and choose Source type = local.`);
  }

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const endTarget = loadFull ? Number.POSITIVE_INFINITY : rowOffset + rowLimit;
  let offset = cursorStart;

  while (offset < endTarget) {
    const length = loadFull ? batchSize : Math.min(batchSize, endTarget - offset);
    const rows = await fetchHuggingFaceRows({ dataset, split, offset, length });

    if (rows.length === 0) {
      break;
    }

    const mappedSamples = rows.flatMap((row) => {
      const mapped = mapLeafNetRow(row, {
        cropHint,
        publishMode,
        sourceDataset: dataset,
      });

      if (!mapped) {
        skippedRows += 1;
        return [];
      }

      return [mapped];
    });

    await ensureCrops(mappedSamples.map(({ sample }) => String(sample.crop)));
    const diseaseIds = await ensureDiseases(mappedSamples.map(({ disease }) => disease));
    const samples = await Promise.all(
      mappedSamples.map(async ({ disease, sample }) => {
        const asset = await uploadRemoteLeafAsset(sample, String(sample.image_url));

        return {
          ...sample,
          disease_id: diseaseIds.get(disease.slug) ?? null,
          image_url: asset.imageUrl,
          image_thumb_url: asset.imageThumbUrl,
        };
      }),
    );
    mappedSamples.forEach(({ disease }) => detectedDiseaseSlugs.add(disease.slug));

    if (samples.length > 0) {
      const { data: inserted, error } = await supabase
        .from("leaf_samples")
        .insert(samples)
        .select("id");

      if (error) {
        throw new Error(error.message);
      }

      importedRows += inserted?.length ?? samples.length;
    }

    offset += rows.length;

    const progress = loadFull
      ? Math.min(95, 5 + Math.round((importedRows / Math.max(importedRows + 1, 1)) * 5))
      : Math.min(95, 5 + Math.round(((offset - rowOffset) / Math.max(rowLimit, 1)) * 90));

    await updateJob(jobId, {
      progress,
      payload: {
        ...payload,
        cursor_offset: offset,
        imported_rows: importedRows,
        skipped_rows: skippedRows,
        detected_disease_slugs: [...detectedDiseaseSlugs],
      },
    });

    if (rows.length < length) {
      break;
    }

    await sleep(importDelayMs);
  }

  return { importedRows, skippedRows, detectedDiseases: detectedDiseaseSlugs.size };
}

type ImportedDisease = {
  slug: string;
  name: string;
  crop: string;
  symptoms: string[];
  isHealthy: boolean;
};

async function importLocalLeafImageRows(jobId: string, payload: Record<string, unknown>) {
  const datasetRoot = String(payload.dataset_id ?? "");
  const loadFull = payload.load_full === true;
  const rowLimit = loadFull
    ? Number.POSITIVE_INFINITY
    : Math.min(Number(payload.row_limit ?? 500), 1_000_000);
  const rowOffset = Math.max(Number(payload.row_offset ?? 0), 0);
  const cursorStart = Math.max(Number(payload.cursor_offset ?? rowOffset), rowOffset);
  const publishMode = payload.publish_mode === "published" ? "published" : "review";
  const cropHint = typeof payload.crop_hint === "string" ? payload.crop_hint : "";
  const rootPath = resolveProjectPath(datasetRoot);

  if (!datasetRoot) {
    throw new Error("Local dataset import job is missing a dataset root.");
  }

  if (!existsSync(rootPath)) {
    throw new Error(`Local dataset root not found at ${rootPath}. Download and unzip the Kaggle dataset first.`);
  }

  const scanLimit = loadFull ? Number.MAX_SAFE_INTEGER : rowOffset + rowLimit;
  const allPaths = await listImageFiles(rootPath, scanLimit);
  const endIndex = loadFull ? allPaths.length : Math.min(allPaths.length, rowOffset + rowLimit);
  const imagePaths = allPaths.slice(cursorStart, endIndex);
  const batchSize = Math.max(5, Math.min(Number(payload.batch_size ?? 25), 200));
  let importedRows = Number(payload.imported_rows ?? 0);
  let skippedRows = Number(payload.skipped_rows ?? 0);
  const detectedDiseaseSlugs = new Set<string>(
    Array.isArray(payload.detected_disease_slugs) ? (payload.detected_disease_slugs as string[]) : [],
  );

  for (let offset = 0; offset < imagePaths.length; offset += batchSize) {
    const batchPaths = imagePaths.slice(offset, offset + batchSize);
    const mappedSamples = batchPaths.map((imagePath) => {
      const taxonomy = extractLocalFolderTaxonomy(rootPath, imagePath, cropHint);
      const relativePath = path.relative(rootPath, imagePath);

      return {
        imagePath,
        disease: taxonomy.disease,
        sample: {
          crop: taxonomy.crop,
          disease_label: taxonomy.disease.slug,
          disease_id: null,
          source: String(payload.dataset_id ?? "local"),
          source_file_name: relativePath,
          caption: taxonomy.disease.name,
          symptoms_text: null,
          image_url: "",
          image_thumb_url: "",
          verified: false,
          status: publishMode,
        },
      };
    });

    await ensureCrops(mappedSamples.map(({ sample }) => String(sample.crop)));
    const diseaseIds = await ensureDiseases(mappedSamples.map(({ disease }) => disease));
    const samples = await Promise.all(
      mappedSamples.map(async ({ disease, imagePath, sample }) => {
        const asset = await uploadLocalLeafAsset(sample, imagePath);
        detectedDiseaseSlugs.add(disease.slug);

        return {
          ...sample,
          disease_id: diseaseIds.get(disease.slug) ?? null,
          image_url: asset.imageUrl,
          image_thumb_url: asset.imageThumbUrl,
        };
      }),
    );

    if (samples.length > 0) {
      const supabase = getSupabaseAdminClient();

      if (!supabase) {
        throw new Error("Supabase service role client is not configured.");
      }

      const { data: inserted, error } = await supabase
        .from("leaf_samples")
        .insert(samples)
        .select("id");

      if (error) {
        throw new Error(error.message);
      }

      importedRows += inserted?.length ?? samples.length;
    } else {
      skippedRows += batchPaths.length;
    }

    const progress = Math.min(95, 5 + Math.round(((offset + batchPaths.length) / Math.max(imagePaths.length, 1)) * 90));
    await updateJob(jobId, {
      progress,
      payload: {
        ...payload,
        cursor_offset: cursorStart + offset + batchPaths.length,
        imported_rows: importedRows,
        skipped_rows: skippedRows,
        detected_disease_slugs: [...detectedDiseaseSlugs],
      },
    });
  }

  return { importedRows, skippedRows, detectedDiseases: detectedDiseaseSlugs.size };
}

async function fetchHuggingFaceRows({
  dataset,
  length,
  offset,
  split,
}: {
  dataset: string;
  length: number;
  offset: number;
  split: string;
}) {
  const params = new URLSearchParams({
    dataset,
    config: "default",
    split,
    offset: offset.toString(),
    length: length.toString(),
  });

  for (let attempt = 0; attempt < HUGGING_FACE_ROWS_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(`https://datasets-server.huggingface.co/rows?${params.toString()}`, {
      headers: getHuggingFaceAuthHeaders(),
    });

    if (response.ok) {
      const data = (await response.json()) as {
        rows?: Array<{
          row?: Record<string, unknown>;
          row_idx?: number;
        }>;
      };

      return data.rows ?? [];
    }

    const body = await response.text();
    const message = `Hugging Face rows API failed (${response.status}) at offset ${offset}: ${body.slice(0, 300)}`;
    const retryable = isRetryableHuggingFaceStatus(response.status);

    if (!retryable) {
      throw new Error(message);
    }

    if (attempt === HUGGING_FACE_ROWS_MAX_ATTEMPTS - 1) {
      throw new RetryableDatasetImportError(
        `${message}. Rate limited after ${HUGGING_FACE_ROWS_MAX_ATTEMPTS} attempts; click Run / resume next import after a short wait.`,
      );
    }

    await sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
  }

  throw new RetryableDatasetImportError("Hugging Face rows API retry loop exited unexpectedly.");
}

function isRetryableHuggingFaceStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(retryAfter: string | null, attempt: number) {
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 60_000);
  }

  const exponentialBackoff = 2 ** attempt * 1000;
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(exponentialBackoff + jitter, 30_000);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapLeafNetRow(
  input: { row?: Record<string, unknown>; row_idx?: number },
  options: { cropHint: string; publishMode: "review" | "published"; sourceDataset: string },
) {
  const row = input.row ?? {};
  const fileName = String(row.file_name ?? row.filename ?? `row-${input.row_idx ?? randomUUID()}`);
  const caption = typeof row.caption === "string" ? row.caption : null;
  const imageUrl = extractImageUrl(row.image);

  if (!imageUrl) {
    return null;
  }

  const taxonomy = extractLeafTaxonomy(fileName, caption, options.cropHint);

  return {
    sample: {
      crop: taxonomy.crop,
      disease_label: taxonomy.disease.slug,
      disease_id: null,
      source: options.sourceDataset,
      source_file_name: fileName,
      caption,
      symptoms_text: taxonomy.disease.symptoms.join(", ") || caption,
      image_url: imageUrl,
      image_thumb_url: imageUrl,
      verified: false,
      status: options.publishMode,
    },
    disease: taxonomy.disease,
  };
}

function extractImageUrl(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && typeof value.src === "string") {
    return value.src;
  }

  return null;
}

function inferCrop(fileName: string, caption: string | null) {
  const captionMatch =
    caption?.match(/(?:image|photo|picture)\s+of\s+([a-z][a-z -]+?)\s+leaves?\s+diseased\s+by/i) ??
    caption?.match(/(?:image|photo|picture)\s+of\s+([a-z][a-z -]+?)\s+(?:healthy|leaf|leaves|with|showing)/i);

  if (captionMatch?.[1]) {
    return captionMatch[1];
  }

  const pathParts = fileName.split(/[\\/]/).map((part) => part.trim()).filter(Boolean);
  return pathParts.find((part) => /[a-z]/i.test(part) && !part.match(/^\d+[_-]/));
}

function inferDiseaseLabel(fileName: string, caption: string | null) {
  const diseasedByMatch = caption?.match(/\bleaves?\s+diseased\s+by\s+(.+?)(?:\s+with\s+symptoms\s+of\b|[.。]|$)/i);

  if (diseasedByMatch?.[1]) {
    return cleanLabelText(diseasedByMatch[1]);
  }

  if (caption && /\bhealthy\b/i.test(caption)) {
    return "healthy";
  }

  const baseName = path.basename(fileName).replace(/\.[^.]+$/, "");
  const labelFromFile = baseName
    .split(/[_-]+/)
    .filter((part) => !/^\d+$/.test(part) && !/^image$/i.test(part))
    .join("-");

  if (labelFromFile) {
    return labelFromFile;
  }

  const captionMatch = caption?.match(/\b(healthy|blight|rust|spot|mildew|rot|scab|blast|curl|mosaic)\b/i);
  return captionMatch?.[1] ?? null;
}

function extractLeafTaxonomy(fileName: string, caption: string | null, cropHint: string) {
  const diseasedCaption = caption?.match(
    /(?:image|photo|picture)\s+of\s+([a-z][a-z -]+?)\s+leaves?\s+diseased\s+by\s+(.+?)(?:\s+with\s+symptoms\s+of\s+(.+?))?[.。]?$/i,
  );
  const healthyCaption =
    caption?.match(/(?:image|photo|picture)\s+of\s+([a-z][a-z -]+?)\s+healthy\s+leaves?/i) ??
    caption?.match(/(?:image|photo|picture)\s+of\s+([a-z][a-z -]+?)\s+leaves?.*\b(?:normal|healthy)\b/i);

  const crop = normalizeSlug(cropHint || diseasedCaption?.[1] || healthyCaption?.[1] || inferCrop(fileName, caption) || "unknown");
  const rawDisease = cleanLabelText(diseasedCaption?.[2] || inferDiseaseLabel(fileName, caption) || "unknown");
  const isHealthy = /\bhealthy\b/i.test(rawDisease) || (!diseasedCaption && Boolean(healthyCaption));
  const diseaseCore = normalizeSlug(isHealthy ? "healthy" : rawDisease);
  const diseaseSlug = `${crop}-${diseaseCore}`;
  const diseaseName = isHealthy ? `Healthy ${titleizeSlug(crop)}` : `${titleizeSlug(crop)} ${titleizeSlug(diseaseCore)}`;
  const symptoms = splitSymptoms(diseasedCaption?.[3] ?? "");

  return {
    crop,
    disease: {
      slug: diseaseSlug,
      name: diseaseName,
      crop,
      symptoms,
      isHealthy,
    },
  };
}

function cleanLabelText(value: string) {
  return value
    .replace(/\bwith\s+symptoms\s+of\b.*$/i, "")
    .replace(/[.。]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSymptoms(value: string) {
  return cleanLabelText(value)
    .split(/\s*,\s*|\s+and\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2)
    .slice(0, 12);
}

async function listImageFiles(rootPath: string, limit: number) {
  const results: string[] = [];
  const pending = [rootPath];

  while (pending.length > 0 && results.length < limit) {
    const currentPath = pending.shift();

    if (!currentPath) {
      break;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }

      if (entry.isFile() && isSupportedImagePath(entry.name)) {
        results.push(entryPath);

        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  return results;
}

function extractLocalFolderTaxonomy(rootPath: string, imagePath: string, cropHint: string) {
  const relativeParts = path.relative(rootPath, imagePath).split(path.sep);
  const folders = relativeParts.slice(0, -1);
  const classFolder = [...folders].reverse().find((folder) => /_{2,}/.test(folder));
  const fallbackDisease = folders.at(-1) ?? path.basename(imagePath, path.extname(imagePath));
  const fallbackCrop = folders.at(-2) ?? cropHint;
  const [rawCrop, rawDisease] = classFolder
    ? splitClassFolderLabel(classFolder)
    : [cropHint || fallbackCrop || "unknown", fallbackDisease || "unknown"];
  const crop = normalizeSlug(cropHint || rawCrop || "unknown");
  const diseaseCore = normalizeSlug(rawDisease || "unknown");
  const isHealthy = diseaseCore === "healthy";
  const diseaseSlug = `${crop}-${isHealthy ? "healthy" : diseaseCore}`;

  return {
    crop,
    disease: {
      slug: diseaseSlug,
      name: isHealthy ? `Healthy ${titleizeSlug(crop)}` : `${titleizeSlug(crop)} ${titleizeSlug(diseaseCore)}`,
      crop,
      symptoms: [],
      isHealthy,
    },
  };
}

function splitClassFolderLabel(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const separatorMatch = normalized.match(/_{2,}/);

  if (!separatorMatch || separatorMatch.index === undefined) {
    return ["unknown", normalized.replace(/_/g, " ")] as const;
  }

  const crop = normalized.slice(0, separatorMatch.index).replace(/_/g, " ");
  const disease = normalized.slice(separatorMatch.index + separatorMatch[0].length).replace(/_/g, " ");
  return [crop, disease] as const;
}

function isSupportedImagePath(value: string) {
  return /\.(jpe?g|png|webp)$/i.test(value);
}

async function ensureCrops(crops: string[]) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const uniqueCrops = [...new Set(crops)].filter(Boolean);

  if (uniqueCrops.length === 0) {
    return;
  }

  const { data: existingRows, error: existingError } = await supabase
    .from("crops")
    .select("id, deleted_at")
    .in("id", uniqueCrops);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existing = new Set((existingRows ?? []).map((row) => String(row.id)));
  const archivedCrops = (existingRows ?? [])
    .filter((row) => row.deleted_at)
    .map((row) => String(row.id));
  const missingCrops = uniqueCrops.filter((crop) => !existing.has(crop));

  if (archivedCrops.length > 0) {
    const { error } = await supabase
      .from("crops")
      .update({
        deleted_at: null,
        status: "review",
      })
      .in("id", archivedCrops);

    if (error) {
      throw new Error(error.message);
    }
  }

  if (missingCrops.length > 0) {
    const { error } = await supabase.from("crops").upsert(
      missingCrops.map((crop) => ({
        id: crop,
        display_name: titleizeSlug(crop),
        status: "review",
        aliases: {},
      })),
      { ignoreDuplicates: true, onConflict: "id" },
    );

    if (error) {
      throw new Error(error.message);
    }
  }
}

async function ensureDiseases(diseases: ImportedDisease[]) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const uniqueDiseases = new Map<string, ImportedDisease>();

  for (const disease of diseases) {
    if (!uniqueDiseases.has(disease.slug)) {
      uniqueDiseases.set(disease.slug, disease);
      continue;
    }

    const existing = uniqueDiseases.get(disease.slug);

    if (existing) {
      uniqueDiseases.set(disease.slug, {
        ...existing,
        symptoms: [...new Set([...existing.symptoms, ...disease.symptoms])],
      });
    }
  }

  if (uniqueDiseases.size === 0) {
    return new Map<string, string>();
  }

  const slugs = [...uniqueDiseases.keys()];
  const { data: existingRows, error: existingError } = await supabase
    .from("diseases")
    .select("id, slug, deleted_at")
    .in("slug", slugs);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const diseaseIds = new Map((existingRows ?? []).map((disease) => [String(disease.slug), String(disease.id)]));
  const archivedSlugs = (existingRows ?? [])
    .filter((disease) => disease.deleted_at)
    .map((disease) => String(disease.slug));
  const missingDiseases = [...uniqueDiseases.values()].filter((disease) => !diseaseIds.has(disease.slug));

  if (archivedSlugs.length > 0) {
    const { error } = await supabase
      .from("diseases")
      .update({
        deleted_at: null,
        status: "review",
      })
      .in("slug", archivedSlugs);

    if (error) {
      throw new Error(error.message);
    }
  }

  if (missingDiseases.length > 0) {
    const { error } = await supabase.from("diseases").upsert(
      missingDiseases.map((disease) => ({
        slug: disease.slug,
        name: disease.name,
        crops: [disease.crop],
        symptoms: disease.symptoms,
        is_healthy: disease.isHealthy,
        status: "review",
      })),
      { ignoreDuplicates: true, onConflict: "slug" },
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  const { data, error } = await supabase
    .from("diseases")
    .select("id, slug")
    .in("slug", slugs);

  if (error) {
    throw new Error(error.message);
  }

  for (const disease of data ?? []) {
    diseaseIds.set(String(disease.slug), String(disease.id));
  }

  return diseaseIds;
}

async function updateJob(jobId: string, values: Record<string, unknown>) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.from("jobs").update(values).eq("id", jobId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function buildSnapshotManifest() {
  await assertAdminRole(["superadmin", "curator"]);
  const version = Date.now();
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const snapshot = await buildKnowledgeBaseSnapshot(supabase);
  const objectPath = `v${version}/plant_ai_kb.db`;
  const { error: uploadError } = await supabase.storage.from("kb-snapshots").upload(objectPath, snapshot.dbBytes, {
    contentType: "application/x-sqlite3",
    upsert: false,
  });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { error } = await supabase.from("kb_snapshots").insert({
    version,
    size_bytes: snapshot.sizeBytes,
    storage_path: `kb-snapshots/${objectPath}`,
    manifest: {
      ...snapshot.manifest,
      created_by: "admin-console",
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

async function uploadLeafAsset(input: z.infer<typeof leafSampleSchema>, file: File) {
  const extension = extensionForFile(file);
  const sourceBytes = Buffer.from(await file.arrayBuffer());
  const asset = await uploadLeafAssetBytes({
    contentType: file.type || contentTypeForExtension(extension),
    crop: input.crop,
    diseaseLabel: input.disease_label,
    extension,
    sourceBytes,
  });

  return {
    ...asset,
    fileName: file.name,
  };
}

async function uploadRemoteLeafAsset(input: { crop: unknown; disease_label: unknown }, imageUrl: string) {
  const response = await fetch(imageUrl, {
    headers: getHuggingFaceAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Remote leaf image download failed (${response.status}) for ${imageUrl}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const extension = extensionForContentType(contentType);
  const sourceBytes = Buffer.from(await response.arrayBuffer());

  return uploadLeafAssetBytes({
    contentType: contentType || contentTypeForExtension(extension),
    crop: input.crop,
    diseaseLabel: input.disease_label,
    extension,
    sourceBytes,
  });
}

async function uploadLocalLeafAsset(input: { crop: unknown; disease_label: unknown }, filePath: string) {
  const extension = extensionForPath(filePath);
  const sourceBytes = await readFile(filePath);

  return uploadLeafAssetBytes({
    contentType: contentTypeForExtension(extension),
    crop: input.crop,
    diseaseLabel: input.disease_label,
    extension,
    sourceBytes,
  });
}

async function uploadLeafAssetBytes({
  contentType,
  crop,
  diseaseLabel,
  extension,
  sourceBytes,
}: {
  contentType: string;
  crop: unknown;
  diseaseLabel: unknown;
  extension: string;
  sourceBytes: Buffer;
}) {
  const objectId = randomUUID();
  const folder = `${safePathSegment(String(crop))}/${safePathSegment(String(diseaseLabel))}`;
  const originalPath = `${folder}/original/${objectId}.${extension}`;
  const thumbPath = `${folder}/thumb/${objectId}.webp`;
  const thumbBytes = await sharp(sourceBytes)
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const [original, thumb] = await Promise.all([
    uploadLeafObject({
      body: sourceBytes,
      contentType,
      key: originalPath,
    }),
    uploadLeafObject({
      body: thumbBytes,
      contentType: "image/webp",
      key: thumbPath,
    }),
  ]);

  return {
    imageUrl: original.publicUrl,
    imageThumbUrl: thumb.publicUrl,
  };
}

async function uploadGuideDocumentAsset(documentId: string, sourceType: string, file: File) {
  const supabase = getSupabaseAdminClient();
  const objectPath = `${safePathSegment(sourceType)}/${documentId}/${safeFileName(file.name)}`;
  const sourceBytes = Buffer.from(await file.arrayBuffer());

  if (!supabase) {
    return `guides-raw/${objectPath}`;
  }

  const { error } = await supabase.storage.from("guides-raw").upload(objectPath, sourceBytes, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  return `guides-raw/${objectPath}`;
}

async function insertRow(table: string, values: Record<string, unknown>) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Supabase service role client is not configured.");
  }

  const { data, error } = await supabase.from(table).insert(values).select("id").maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
  return {
    id: data?.id ?? values.id ?? randomUUID(),
  };
}

function splitLines(value?: string) {
  return (value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extensionForFile(file: File) {
  const fileNameExtension = file.name.split(".").pop()?.toLowerCase();

  if (fileNameExtension && ["jpg", "jpeg", "png", "webp"].includes(fileNameExtension)) {
    return fileNameExtension === "jpeg" ? "jpg" : fileNameExtension;
  }

  if (file.type === "image/png") {
    return "png";
  }

  if (file.type === "image/webp") {
    return "webp";
  }

  return "jpg";
}

function extensionForPath(filePath: string) {
  const extension = path.extname(filePath).replace(".", "").toLowerCase();

  if (["jpg", "jpeg", "png", "webp"].includes(extension)) {
    return extension === "jpeg" ? "jpg" : extension;
  }

  return "jpg";
}

function contentTypeForExtension(extension: string) {
  if (extension === "png") {
    return "image/png";
  }

  if (extension === "webp") {
    return "image/webp";
  }

  return "image/jpeg";
}

function extensionForContentType(contentType: string) {
  if (contentType.includes("image/png")) {
    return "png";
  }

  if (contentType.includes("image/webp")) {
    return "webp";
  }

  return "jpg";
}

function safePathSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSlug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

function titleizeSlug(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeFileName(value: string) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || `${randomUUID()}.txt`;
}

function resolveProjectPath(value: string) {
  return path.isAbsolute(value) ? value : path.join(/*turbopackIgnore: true*/ process.cwd(), value);
}
