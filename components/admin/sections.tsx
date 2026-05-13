"use client";

import {
  Activity,
  Database,
  FileText,
  FlaskConical,
  ImagePlus,
  Import,
  Leaf,
  ListChecks,
  SearchCheck,
  ShieldCheck,
  Sprout,
  CheckCircle2,
  Trash2,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import {
  addDetectedCrops,
  addDetectedDiseases,
  buildSnapshotManifest,
  createDisease,
  createGuideChunk,
  createTreatment,
  deleteAdminRecord,
  deleteLeafSamples,
  importGuideDocument,
  queueDatasetImport,
  queueLeafSample,
  runNextDatasetImportJob,
  runNextEmbeddingBatch,
  verifyAndPublishLeafSample,
} from "@/app/actions";
import { AdminActionForm } from "@/components/admin/action-form";
import { AdminDataTable } from "@/components/admin/data-table";
import { PaginatedTable } from "@/components/admin/paginated-table";
import { DetectCropsPanel, DetectDiseasesPanel } from "@/components/admin/detect-taxonomy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { adminRuntimeStatus, type AdminDashboardData } from "@/lib/admin/types";
import type {
  CropRow,
  DiseaseRow,
  GuideChunkRow,
  GuideDocumentRow,
  JobRow,
  LeafSampleRow,
  SnapshotRow,
  TreatmentRow,
} from "@/lib/admin/types";

type DashboardData = AdminDashboardData;

export function OverviewSection({ data }: { data: DashboardData }) {
  const latestSnapshot = data.latestSnapshot;

  return (
    <>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Sprout} label="Crops" value={data.counts.crops.toString()} detail="Published taxonomy" />
        <Metric icon={Leaf} label="Diseases" value={data.counts.diseases.toString()} detail="Reviewed conditions" />
        <Metric icon={ImagePlus} label="Published Leaves" value={data.counts.publishedLeafSamples.toString()} detail="Reference images" />
        <Metric icon={Activity} label="Queued Jobs" value={data.counts.pendingJobs.toString()} detail="Embedding pipeline" />
      </section>
      <section className="grid gap-6 xl:grid-cols-3">
        <AdminPanel
          description="Recent embedding and import work queued by operators."
          icon={Activity}
          title="Job Queue"
        >
          <PaginatedTable<JobRow>
            resource="jobs"
            columns={["Type", "Status", "Progress"]}
            renderRow={(job) => [job.type, job.status, `${job.progress}%`]}
            getRowId={(job) => job.id}
            initialPageSize={10}
            enableRowSelection={false}
            compact
          />
        </AdminPanel>
        <AdminPanel
          description="Latest generated sync package for the mobile app."
          icon={Database}
          title="Latest Snapshot"
        >
          <KeyValue label="Version" value={latestSnapshot ? `v${latestSnapshot.version}` : "none"} />
          <KeyValue label="Storage path" value={latestSnapshot?.storage_path ?? "kb-snapshots/vN/plant_ai_kb.db"} />
        </AdminPanel>
        <AdminPanel
          description="Model contract used by admin-side reference image embeddings."
          icon={FlaskConical}
          title="Embedding Contract"
        >
          <KeyValue label="Model" value={adminRuntimeStatus.modelId} />
          <KeyValue label="Preprocess" value={adminRuntimeStatus.preprocessId} />
          <KeyValue label="Dimension" value={adminRuntimeStatus.vectorDimension.toString()} />
        </AdminPanel>
      </section>
    </>
  );
}

export function CropsSection({ data }: { data: DashboardData }) {
  return (
    <AdminPanel
      description="Crops are auto-created from dataset imports. Use detect to backfill anything missing."
      icon={Sprout}
      title="Crops Manager"
    >
      <DetectCropsPanel onAdd={addDetectedCrops} pendingCrops={data.pendingCrops} />
      <PaginatedTable<CropRow>
        resource="crops"
        columns={["ID", "Name", "Family", "Status", "Actions"]}
        renderRow={(crop) => [
          crop.id,
          crop.display_name,
          crop.family ?? "none",
          crop.status,
          <DeleteRecordButton id={crop.id} key="delete" label={crop.display_name} table="crops" />,
        ]}
        getRowId={(crop) => crop.id}
        enableRowSelection={false}
      />
    </AdminPanel>
  );
}

export function DiseasesSection({ data }: { data: DashboardData }) {
  return (
    <AdminPanel
      description="Map disease labels, symptoms, and crop relationships."
      icon={Leaf}
      title="Diseases Manager"
    >
      <DetectDiseasesPanel onAdd={addDetectedDiseases} pendingDiseases={data.pendingDiseases} />
      <CreateDiseaseForm crops={data.cropIds} />
      <PaginatedTable<DiseaseRow>
        resource="diseases"
        columns={["Slug", "Name", "Crops", "Status", "Actions"]}
        renderRow={(disease) => [
          disease.slug,
          disease.name,
          disease.crops.join(", "),
          disease.status,
          <DeleteRecordButton id={disease.id} key="delete" label={disease.name} table="diseases" />,
        ]}
        getRowId={(disease) => disease.id}
        enableRowSelection={false}
      />
    </AdminPanel>
  );
}

export function TreatmentsSection({ data }: { data: DashboardData }) {
  return (
    <AdminPanel
      description="Publish treatment steps by disease, crop, severity, and method."
      icon={ShieldCheck}
      title="Treatments Manager"
    >
      <CreateTreatmentForm diseases={data.diseases} crops={data.cropIds} />
      <PaginatedTable<TreatmentRow>
        resource="disease_treatments"
        columns={["Title", "Crop", "Severity", "Method", "Status", "Actions"]}
        renderRow={(treatment) => [
          treatment.title,
          treatment.crop ?? "any",
          treatment.severity,
          treatment.method,
          treatment.status,
          <DeleteRecordButton id={treatment.id} key="delete" label={treatment.title} table="disease_treatments" />,
        ]}
        getRowId={(treatment) => treatment.id}
        enableRowSelection={false}
      />
    </AdminPanel>
  );
}

export function LeavesSection({ data }: { data: DashboardData }) {
  const reviewCount = data.counts.leafSamplesInReview;
  const bulkDeleteFormId = "leaf-sample-bulk-delete";

  return (
    <AdminPanel
      description="Verify reference images before embedding and publishing."
      icon={ImagePlus}
      title="Leaf Sample Review"
    >
      <LeafSampleForm crops={data.cropIds} diseases={data.diseases} />
      <AdminActionForm action={deleteLeafSamples} id={bulkDeleteFormId} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Select imported samples, then archive them in bulk. Archived leaves are removed from review and retrieval.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <AdminActionForm action={verifyAndPublishLeafSample}>
            <input name="all" type="hidden" value="true" />
            <Button disabled={reviewCount === 0} type="submit" variant="secondary">
              <CheckCircle2 className="size-4" />
              Verify & publish all in review ({reviewCount})
            </Button>
          </AdminActionForm>
          <Button disabled={data.counts.leafSamples === 0} form={bulkDeleteFormId} type="submit" variant="destructive">
            <Trash2 className="size-4" />
            Delete selected
          </Button>
        </div>
      </div>
      <LeafSamplesTable bulkDeleteFormId={bulkDeleteFormId} />
    </AdminPanel>
  );
}

function LeafSamplesTable({
  bulkDeleteFormId,
}: {
  bulkDeleteFormId: string;
}) {
  return (
    <PaginatedTable<LeafSampleRow>
      resource="leaf_samples"
      columns={["Crop", "Disease", "Verified", "Status", "Caption", "Actions"]}
      selectionFormId={bulkDeleteFormId}
      renderRow={(sample) => [
        sample.crop,
        sample.disease_label,
        sample.verified ? "yes" : "no",
        sample.status,
        sample.caption ?? "none",
        <div className="flex gap-2" key="actions">
          {sample.status !== "published" || !sample.verified ? (
            <VerifyLeafSampleButton id={sample.id} label={sample.disease_label} />
          ) : null}
          <DeleteLeafSampleButton id={sample.id} label={sample.disease_label} />
        </div>,
      ]}
      getRowId={(sample) => sample.id}
    />
  );
}

function VerifyLeafSampleButton({ id, label }: { id: string; label: string }) {
  return (
    <AdminActionForm action={verifyAndPublishLeafSample}>
      <input name="id" type="hidden" value={id} />
      <Button aria-label={`Verify ${label}`} size="sm" type="submit" variant="secondary">
        <CheckCircle2 className="size-3.5" />
        Verify
      </Button>
    </AdminActionForm>
  );
}

function DeleteLeafSampleButton({ id, label }: { id: string; label: string }) {
  return (
    <AdminActionForm action={deleteLeafSamples}>
      <input name="single_id" type="hidden" value={id} />
      <Button aria-label={`Delete ${label}`} size="sm" type="submit" variant="destructive">
        <Trash2 className="size-3.5" />
        Delete
      </Button>
    </AdminActionForm>
  );
}

export function ImportsSection({ data }: { data: DashboardData }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.65fr)]">
      <AdminPanel
        description="Queue large parquet datasets, auto-detect crop and disease labels, then keep imported samples in review until verified."
        icon={Import}
        title="LeafNet Parquet Import"
      >
        <div className="rounded-lg border bg-muted/35 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Hugging Face token</span>
            <Badge variant={data.hasHuggingFaceToken ? "default" : "destructive"}>
              {data.hasHuggingFaceToken ? "configured" : "missing"}
            </Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            Hugging Face is for smoke tests only. For full imports, download the dataset locally, choose local, and let admin upload accepted images to Supabase Storage.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <DetectCropsPanel onAdd={addDetectedCrops} pendingCrops={data.pendingCrops} />
          <DetectDiseasesPanel onAdd={addDetectedDiseases} pendingDiseases={data.pendingDiseases} />
        </div>
        <AdminActionForm action={queueDatasetImport} className="grid gap-3 md:grid-cols-2">
          <NativeSelect
            label="Source type"
            name="source_type"
            options={["huggingface", "local"]}
          />
          <FieldInput defaultValue="enalis/LeafNet" label="Dataset ID or local image root" name="dataset_id" />
          <FieldInput defaultValue="data/train-*.parquet" label="Parquet glob (Hugging Face only)" name="parquet_glob" />
          <FieldInput defaultValue="train" label="Split (Hugging Face only)" name="split" />
          <FieldInput label="Crop hint" name="crop_hint" placeholder="tea, tomato, rice, optional" />
          <FieldInput label="Start offset" name="row_offset" placeholder="0" />
          <NativeSelect
            label="Rows to load"
            name="row_limit"
            labels={{
              "100": "100 (smoke test)",
              "500": "500",
              "1000": "1,000",
              "5000": "5,000",
              "10000": "10,000 (local recommended)",
              "50000": "50,000 (local recommended)",
              full: "Full dataset (local recommended)",
            }}
            options={["100", "500", "1000", "5000", "10000", "50000", "full"]}
          />
          <FieldInput defaultValue="100" label="Batch size" name="batch_size" placeholder="10-500" />
          <NativeSelect label="Initial status" name="publish_mode" options={["review", "published"]} />
          <CheckboxField label="Force full-dataset mode (local source only)" name="load_full" />
          <div className="md:col-span-2">
            <CheckboxField
              label="Allow Hugging Face large/full import (advanced, can hit rate limits)"
              name="allow_huggingface_large_import"
            />
          </div>
          <div className="md:col-span-2">
            <SubmitButton label="Queue import job" />
          </div>
        </AdminActionForm>
      </AdminPanel>

      <AdminPanel
        description="Run queued or resume in-progress imports. The importer reads rows in batches, persists cursor, inserts leaf samples, and auto-queues embeddings."
        icon={Import}
        title="Import Queue"
      >
        <AdminActionForm action={runNextDatasetImportJob}>
          <Button type="submit">
            <Import className="size-4" />
            Run / resume next import
          </Button>
        </AdminActionForm>
        <PaginatedTable<JobRow>
          resource="jobs"
          filters={{ type: "import_leaf_dataset" }}
          columns={["Status", "Progress", "Cursor", "Imported", "Error"]}
          renderRow={(job) => {
            const payload = (job.payload ?? {}) as Record<string, unknown>;
            return [
              job.status,
              `${job.progress}%`,
              String(payload.cursor_offset ?? payload.row_offset ?? "0"),
              String(payload.imported_rows ?? "0"),
              job.error ?? "none",
            ];
          }}
          getRowId={(job) => job.id}
          enableRowSelection={false}
          compact
        />
        <div className="grid gap-2 rounded-lg border bg-muted/35 p-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Tips</p>
          <ul className="list-disc pl-4">
            <li>Smoke test: 500 rows, status=review.</li>
            <li>Full dataset: use Source type=local by default. Check the Hugging Face override only when you accept rate-limit risk.</li>
            <li>Crashed run? Click run again — it resumes from saved cursor.</li>
            <li>After import, use detect crops and detect diseases to backfill unique labels without duplicates.</li>
            <li>After import, queue embedding jobs from the Embeddings page.</li>
          </ul>
        </div>
      </AdminPanel>
    </section>
  );
}

export function EmbeddingsSection({ data }: { data: DashboardData }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.7fr)]">
      <AdminPanel
        description="Queue or run MobileCLIP embedding jobs with the admin runtime."
        icon={FlaskConical}
        title="Embedding Runtime"
      >
        <div className="grid gap-2 md:grid-cols-3">
          <KeyValue label="Model" value={adminRuntimeStatus.modelId} />
          <KeyValue label="Preprocess" value={adminRuntimeStatus.preprocessId} />
          <KeyValue label="Dimension" value={adminRuntimeStatus.vectorDimension.toString()} />
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <KeyValue label="Queued" value={data.counts.embeddingsQueued.toString()} />
          <KeyValue label="Succeeded" value={data.counts.embeddingsSucceeded.toString()} />
          <KeyValue label="Failed" value={data.counts.embeddingsFailed.toString()} />
        </div>
        <Separator />
        <AdminActionForm action={runNextEmbeddingBatch} className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <FieldInput defaultValue="5" label="Batch size (1-50)" name="batch_size" placeholder="5" />
          <Button type="submit">
            <ListChecks className="size-4" />
            Run next embedding batch
          </Button>
        </AdminActionForm>
        <Separator />
        <PaginatedTable<JobRow>
          resource="jobs"
          filters={{ type: "generate_embedding" }}
          columns={["Type", "Status", "Progress"]}
          renderRow={(job) => [job.type, job.status, `${job.progress}%`]}
          getRowId={(job) => job.id}
          enableRowSelection={false}
          compact
        />
      </AdminPanel>

      <AdminPanel
        description="Review nearest-neighbor collisions before publishing datasets."
        icon={SearchCheck}
        title="Similarity Review"
      >
        <DataTable
          columns={["Sample A", "Sample B", "Crop", "Score", "Review"]}
          rows={data.similarityReviews.map((review) => [
            review.leftSampleId,
            review.rightSampleId,
            review.crop,
            review.score.toFixed(3),
            `${review.recommendation}: ${review.leftDiseaseLabel} / ${review.rightDiseaseLabel}`,
          ])}
          compact
        />
      </AdminPanel>
    </section>
  );
}

export function GuidesSection({ data }: { data: DashboardData }) {
  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.75fr)]">
      <AdminPanel
        description="Import reviewed guide sources and convert them into curated content."
        icon={FileText}
        title="Guide Documents"
      >
        <GuideDocumentForm crops={data.cropIds} />
        <PaginatedTable<GuideDocumentRow>
          resource="guide_documents"
          columns={["Title", "Crops", "Lang", "Source", "Status", "Actions"]}
          renderRow={(document) => [
            document.title,
            document.crops.join(", "),
            document.lang,
            document.source_type ?? "manual",
            document.status,
            <DeleteRecordButton id={document.id} key="delete" label={document.title} table="guide_documents" />,
          ]}
          getRowId={(document) => document.id}
          enableRowSelection={false}
          compact
        />
      </AdminPanel>
      <AdminPanel
        description="Publish chunk-level guide knowledge used by offline retrieval."
        icon={FileText}
        title="Guide Chunks"
      >
        <GuideChunkForm crops={data.cropIds} />
        <PaginatedTable<GuideChunkRow>
          resource="guide_chunks"
          columns={["Crop", "Category", "Lang", "Status", "Actions"]}
          renderRow={(chunk) => [
            chunk.crop ?? "any",
            chunk.category ?? "general",
            chunk.lang,
            chunk.status,
            <DeleteRecordButton id={chunk.id} key="delete" label={chunk.category ?? chunk.id} table="guide_chunks" />,
          ]}
          getRowId={(chunk) => chunk.id}
          enableRowSelection={false}
          compact
        />
      </AdminPanel>
    </section>
  );
}

export function SnapshotsSection({ data }: { data: DashboardData }) {
  const latestSnapshot = data.latestSnapshot;

  return (
    <AdminPanel
      description="Build the manifest used by mobile offline sync."
      icon={UploadCloud}
      title="Dataset Publish"
    >
      <AdminActionForm action={buildSnapshotManifest} className="grid gap-3 md:max-w-2xl">
        <KeyValue label="Latest snapshot" value={latestSnapshot ? `v${latestSnapshot.version}` : "none"} />
        <KeyValue label="Storage path" value={latestSnapshot?.storage_path ?? "kb-snapshots/vN/plant_ai_kb.db"} />
        <Button className="w-fit" type="submit">
          <Database className="size-4" />
          Build manifest
        </Button>
      </AdminActionForm>
      <PaginatedTable<SnapshotRow>
        resource="kb_snapshots"
        columns={["Version", "Storage path", "Size", "Created"]}
        renderRow={(snapshot) => [
          `v${snapshot.version}`,
          snapshot.storage_path,
          snapshot.size_bytes?.toString() ?? "unknown",
          snapshot.created_at ?? "unknown",
        ]}
        getRowId={(snapshot) => snapshot.id}
        enableRowSelection={false}
      />
    </AdminPanel>
  );
}

function Metric({
  detail,
  icon: Icon,
  label,
  value,
}: {
  detail: string;
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between gap-3">
          <CardDescription>{label}</CardDescription>
          <div className="flex size-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Icon className="size-4" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function AdminPanel({
  children,
  description,
  icon: Icon,
  title,
}: {
  children: React.ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-primary" />
              <CardTitle>{title}</CardTitle>
            </div>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function DataTable({
  columns,
  compact = false,
  rows,
}: {
  columns: string[];
  compact?: boolean;
  rows: React.ReactNode[][];
}) {
  return <AdminDataTable columns={columns} compact={compact} rows={rows} />;
}

function DeleteRecordButton({
  id,
  label,
  table,
}: {
  id: string;
  label: string;
  table: "crops" | "diseases" | "disease_treatments" | "guide_documents" | "guide_chunks" | "leaf_samples";
}) {
  return (
    <AdminActionForm action={deleteAdminRecord}>
      <input name="table" type="hidden" value={table} />
      <input name="id" type="hidden" value={id} />
      <Button aria-label={`Delete ${label}`} size="sm" type="submit" variant="destructive">
        <Trash2 className="size-3.5" />
        Delete
      </Button>
    </AdminActionForm>
  );
}

function CreateDiseaseForm({ crops }: { crops: string[] }) {
  return (
    <AdminActionForm action={createDisease} className="grid gap-3 md:grid-cols-2">
      <FieldInput label="Slug" name="slug" placeholder="tomato-early-blight" />
      <FieldInput label="Name" name="name" placeholder="Tomato Early Blight" />
      <NativeSelect label="Crop" name="crop" options={crops} />
      <FieldTextarea label="Symptoms" name="symptoms" placeholder="brown spots, yellowing leaves" />
      <div className="md:col-span-2">
        <SubmitButton label="Publish disease" />
      </div>
    </AdminActionForm>
  );
}

function CreateTreatmentForm({
  crops,
  diseases,
}: {
  crops: string[];
  diseases: Array<{ id: string; name: string }>;
}) {
  return (
    <AdminActionForm action={createTreatment} className="grid gap-3 md:grid-cols-2">
      <NativeSelect
        label="Disease"
        labels={Object.fromEntries(diseases.map((disease) => [disease.id, disease.name]))}
        name="disease_id"
        options={diseases.map((disease) => disease.id)}
      />
      <NativeSelect label="Crop" name="crop" options={crops} />
      <NativeSelect label="Severity" name="severity" options={["any", "mild", "moderate", "severe"]} />
      <NativeSelect label="Method" name="method" options={["cultural", "organic", "chemical", "prevention"]} />
      <FieldInput label="Title" name="title" placeholder="Remove infected lower leaves" />
      <FieldTextarea label="Steps" name="steps_md" placeholder="Step-by-step treatment guidance" />
      <div className="md:col-span-2">
        <SubmitButton label="Publish treatment" />
      </div>
    </AdminActionForm>
  );
}

function LeafSampleForm({
  crops,
  diseases,
}: {
  crops: string[];
  diseases: Array<{ id: string; name: string }>;
}) {
  return (
    <AdminActionForm action={queueLeafSample} className="grid gap-3 md:grid-cols-2">
      <NativeSelect label="Crop" name="crop" options={crops} />
      <FieldInput label="Disease label" name="disease_label" placeholder="tomato-early-blight" />
      <NativeSelect
        label="Disease ID"
        labels={{
          "": "Unmapped",
          ...Object.fromEntries(diseases.map((disease) => [disease.id, disease.name])),
        }}
        name="disease_id"
        options={["", ...diseases.map((disease) => disease.id)]}
      />
      <FieldInput label="Image path" name="image_url" placeholder="leaves/tomato/...jpg" />
      <FieldInput label="Thumb path" name="image_thumb_url" placeholder="leaves/tomato/...webp" />
      <FileInput label="Upload image" name="image_file" />
      <FieldTextarea label="Caption" name="caption" placeholder="LeafNet-style caption or review notes" />
      <div className="md:col-span-2">
        <SubmitButton label="Verify and publish leaf" />
      </div>
    </AdminActionForm>
  );
}

function GuideDocumentForm({ crops }: { crops: string[] }) {
  return (
    <AdminActionForm action={importGuideDocument} className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <FieldInput label="Title" name="title" placeholder="Tomato field guide" />
        <NativeSelect label="Crop" name="crop" options={crops} />
        <FieldInput defaultValue="en" label="Language" name="lang" placeholder="en" />
        <FieldInput defaultValue="manual" label="Source type" name="source_type" placeholder="manual" />
      </div>
      <FieldInput label="Source URL" name="source_url" placeholder="https://..." />
      <FileInput accept="application/pdf,.docx,text/markdown,text/plain" label="Upload document" name="document_file" />
      <FieldTextarea label="Raw text" name="raw_text" placeholder="Paste the source guide text" />
      <SubmitButton label="Import document" />
    </AdminActionForm>
  );
}

function GuideChunkForm({ crops }: { crops: string[] }) {
  return (
    <AdminActionForm action={createGuideChunk} className="grid gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <NativeSelect label="Crop" name="crop" options={crops} />
        <FieldInput label="Category" name="category" placeholder="disease" />
        <FieldInput defaultValue="en" label="Language" name="lang" placeholder="en" />
      </div>
      <FieldTextarea label="Chunk text" name="chunk_text" placeholder="Paste the reviewed guide chunk" />
      <SubmitButton label="Publish guide chunk" />
    </AdminActionForm>
  );
}

function FieldInput({
  defaultValue,
  label,
  name,
  placeholder,
}: {
  defaultValue?: string;
  label: string;
  name: string;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input defaultValue={defaultValue} id={name} name={name} placeholder={placeholder} />
    </div>
  );
}

function FileInput({
  accept = "image/jpeg,image/png,image/webp",
  label,
  name,
}: {
  accept?: string;
  label: string;
  name: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input accept={accept} id={name} name={name} type="file" />
    </div>
  );
}

function CheckboxField({
  defaultChecked = false,
  label,
  name,
}: {
  defaultChecked?: boolean;
  label: string;
  name: string;
}) {
  return (
    <label className="flex items-center gap-2 text-sm" htmlFor={name}>
      <input
        className="size-4 rounded border-input"
        defaultChecked={defaultChecked}
        id={name}
        name={name}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

function FieldTextarea({ label, name, placeholder }: { label: string; name: string; placeholder?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Textarea id={name} name={name} placeholder={placeholder} />
    </div>
  );
}

function NativeSelect({
  label,
  labels = {},
  name,
  options,
}: {
  label: string;
  labels?: Record<string, string>;
  name: string;
  options: string[];
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <select
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 w-full rounded-md border px-2.5 text-sm shadow-xs outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={options.length === 0}
        id={name}
        name={name}
      >
        {options.length === 0 ? (
          <option value="">No options</option>
        ) : (
          options.map((option) => (
            <option key={option || "empty"} value={option}>
              {labels[option] ?? option}
            </option>
          ))
        )}
      </select>
    </div>
  );
}

function SubmitButton({ label }: { label: string }) {
  return (
    <Button className="self-end" type="submit">
      <UploadCloud className="size-4" />
      {label}
    </Button>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded-md border bg-muted/35 px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words font-mono text-xs text-foreground">{value}</dd>
    </div>
  );
}
