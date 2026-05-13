import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMBEDDING_CONTRACT } from "@/lib/architecture-contract";

type SnapshotBuildResult = {
  dbBytes: Buffer;
  manifest: Record<string, unknown>;
  sizeBytes: number;
};

type SnapshotRow = Record<string, unknown>;

export async function buildKnowledgeBaseSnapshot(supabase: SupabaseClient): Promise<SnapshotBuildResult> {
  const [crops, diseases, treatments, guideChunks, leafSamples, embeddings] = await Promise.all([
    selectPublished(supabase, "crops", "id, display_name, aliases, family, icon_url, updated_at"),
    selectPublished(
      supabase,
      "diseases",
      "id, slug, name, scientific_name, crops, aliases, cause, symptoms, symptoms_md, prevention_md, severity_levels, is_healthy, updated_at",
    ),
    selectPublished(
      supabase,
      "disease_treatments",
      "id, disease_id, crop, severity, method, title, steps_md, dosage, safety_notes_md, days_to_recover, updated_at",
    ),
    selectPublished(
      supabase,
      "guide_chunks",
      "id, document_id, chunk_idx, chunk_text, heading_path, page_number, crop, disease_id, category, stage, symptoms, lang, updated_at",
    ),
    supabase
      .from("leaf_samples")
      .select(
        "id, disease_id, crop, disease_label, caption, symptoms_text, image_url, image_thumb_url, region, crop_stage, updated_at",
      )
      .eq("status", "published")
      .eq("verified", true)
      .is("deleted_at", null),
    supabase
      .from("leaf_sample_embeddings")
      .select("sample_id, model_id, preprocess_id, dim, normalized, embedding_base64")
      .eq("model_id", EMBEDDING_CONTRACT.modelId)
      .eq("preprocess_id", EMBEDDING_CONTRACT.preprocessId)
      .is("deleted_at", null),
  ]);

  const firstError = [crops.error, diseases.error, treatments.error, guideChunks.error, leafSamples.error, embeddings.error].find(Boolean);

  if (firstError) {
    throw new Error(firstError.message);
  }

  const manifest = {
    model_id: EMBEDDING_CONTRACT.modelId,
    preprocess_id: EMBEDDING_CONTRACT.preprocessId,
    vector_dimension: EMBEDDING_CONTRACT.vectorDimension,
    generated_at: new Date().toISOString(),
    counts: {
      crops: asRows(crops.data).length,
      diseases: asRows(diseases.data).length,
      treatments: asRows(treatments.data).length,
      guide_chunks: asRows(guideChunks.data).length,
      leaf_samples: asRows(leafSamples.data).length,
      leaf_embeddings: asRows(embeddings.data).length,
    },
  };

  const sql = [
    "PRAGMA foreign_keys = OFF;",
    "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE TABLE crops (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, aliases_json TEXT, family TEXT, icon_url TEXT, updated_at TEXT);",
    "CREATE TABLE diseases (id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, scientific_name TEXT, crops_json TEXT NOT NULL, aliases_json TEXT, cause TEXT, symptoms_json TEXT, symptoms_md TEXT, prevention_md TEXT, severity_levels_json TEXT, is_healthy INTEGER NOT NULL, updated_at TEXT);",
    "CREATE TABLE disease_treatments (id TEXT PRIMARY KEY, disease_id TEXT, crop TEXT, severity TEXT NOT NULL, method TEXT NOT NULL, title TEXT NOT NULL, steps_md TEXT NOT NULL, dosage_json TEXT, safety_notes_md TEXT, days_to_recover INTEGER, updated_at TEXT);",
    "CREATE TABLE guide_chunks (id TEXT PRIMARY KEY, document_id TEXT, chunk_idx INTEGER NOT NULL, chunk_text TEXT NOT NULL, heading_path_json TEXT, page_number INTEGER, crop TEXT, disease_id TEXT, category TEXT, stage TEXT, symptoms_json TEXT, lang TEXT NOT NULL, updated_at TEXT);",
    "CREATE VIRTUAL TABLE guide_chunks_fts USING fts5(chunk_text, content='guide_chunks', content_rowid='rowid');",
    "CREATE TABLE leaf_samples (id TEXT PRIMARY KEY, disease_id TEXT, crop TEXT NOT NULL, disease_label TEXT NOT NULL, caption TEXT, symptoms_text TEXT, image_url TEXT NOT NULL, image_thumb_url TEXT, region TEXT, crop_stage TEXT, updated_at TEXT);",
    "CREATE TABLE leaf_sample_embeddings (sample_id TEXT PRIMARY KEY, model_id TEXT NOT NULL, preprocess_id TEXT NOT NULL, dim INTEGER NOT NULL, normalized INTEGER NOT NULL, embedding_base64 TEXT NOT NULL, embedding_blob BLOB NOT NULL);",
    insertSql("metadata", { key: "manifest", value: JSON.stringify(manifest) }),
    ...asRows(crops.data).map((row) =>
      insertSql("crops", {
        id: row.id,
        display_name: row.display_name,
        aliases_json: JSON.stringify(row.aliases ?? {}),
        family: row.family,
        icon_url: row.icon_url,
        updated_at: row.updated_at,
      }),
    ),
    ...asRows(diseases.data).map((row) =>
      insertSql("diseases", {
        id: row.id,
        slug: row.slug,
        name: row.name,
        scientific_name: row.scientific_name,
        crops_json: JSON.stringify(row.crops ?? []),
        aliases_json: JSON.stringify(row.aliases ?? {}),
        cause: row.cause,
        symptoms_json: JSON.stringify(row.symptoms ?? []),
        symptoms_md: row.symptoms_md,
        prevention_md: row.prevention_md,
        severity_levels_json: JSON.stringify(row.severity_levels ?? []),
        is_healthy: row.is_healthy,
        updated_at: row.updated_at,
      }),
    ),
    ...asRows(treatments.data).map((row) =>
      insertSql("disease_treatments", {
        id: row.id,
        disease_id: row.disease_id,
        crop: row.crop,
        severity: row.severity,
        method: row.method,
        title: row.title,
        steps_md: row.steps_md,
        dosage_json: JSON.stringify(row.dosage ?? null),
        safety_notes_md: row.safety_notes_md,
        days_to_recover: row.days_to_recover,
        updated_at: row.updated_at,
      }),
    ),
    ...asRows(guideChunks.data).map((row) =>
      insertSql("guide_chunks", {
        id: row.id,
        document_id: row.document_id,
        chunk_idx: row.chunk_idx,
        chunk_text: row.chunk_text,
        heading_path_json: JSON.stringify(row.heading_path ?? []),
        page_number: row.page_number,
        crop: row.crop,
        disease_id: row.disease_id,
        category: row.category,
        stage: row.stage,
        symptoms_json: JSON.stringify(row.symptoms ?? []),
        lang: row.lang,
        updated_at: row.updated_at,
      }),
    ),
    "INSERT INTO guide_chunks_fts(rowid, chunk_text) SELECT rowid, chunk_text FROM guide_chunks;",
    ...asRows(leafSamples.data).map((row) =>
      insertSql("leaf_samples", {
        id: row.id,
        disease_id: row.disease_id,
        crop: row.crop,
        disease_label: row.disease_label,
        caption: row.caption,
        symptoms_text: row.symptoms_text,
        image_url: row.image_url,
        image_thumb_url: row.image_thumb_url,
        region: row.region,
        crop_stage: row.crop_stage,
        updated_at: row.updated_at,
      }),
    ),
    ...asRows(embeddings.data).map((row) =>
      insertSql("leaf_sample_embeddings", {
        sample_id: row.sample_id,
        model_id: row.model_id,
        preprocess_id: row.preprocess_id,
        dim: row.dim,
        normalized: row.normalized,
        embedding_base64: row.embedding_base64,
        embedding_blob: Buffer.from(String(row.embedding_base64 ?? ""), "base64"),
      }),
    ),
    "CREATE INDEX leaf_samples_crop_idx ON leaf_samples(crop, disease_label);",
    "CREATE INDEX disease_treatments_lookup_idx ON disease_treatments(disease_id, crop, severity, method);",
  ].join("\n");

  const directory = await mkdtemp(path.join(tmpdir(), "plant-ai-kb-"));
  const dbPath = path.join(directory, "plant_ai_kb.db");
  const sqlPath = path.join(directory, "snapshot.sql");

  try {
    await writeFile(sqlPath, sql);
    await runSqlite(dbPath, sqlPath);
    const dbStat = await stat(dbPath);

    return {
      dbBytes: await readFile(dbPath),
      manifest,
      sizeBytes: dbStat.size,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function selectPublished(supabase: SupabaseClient, table: string, columns: string) {
  return supabase.from(table).select(columns).eq("status", "published").is("deleted_at", null);
}

function asRows(value: unknown): SnapshotRow[] {
  return Array.isArray(value) ? (value as SnapshotRow[]) : [];
}

function insertSql(table: string, values: Record<string, unknown>) {
  const columns = Object.keys(values).map((column) => `"${column}"`).join(", ");
  const sqlValues = Object.values(values).map(sqlLiteral).join(", ");

  return `INSERT INTO "${table}" (${columns}) VALUES (${sqlValues});`;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (Buffer.isBuffer(value)) {
    return `X'${value.toString("hex")}'`;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

async function runSqlite(dbPath: string, sqlPath: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("sqlite3", [dbPath, `.read ${sqlPath}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const errorOutput: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(Buffer.concat(errorOutput).toString("utf8") || `sqlite3 exited with ${code}`));
    });
  });
}
