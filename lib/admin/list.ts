import "server-only";
import { getSupabaseAdminClient } from "@/lib/admin/supabase";

export const PAGINATED_RESOURCES = [
  "crops",
  "diseases",
  "disease_treatments",
  "leaf_samples",
  "guide_documents",
  "guide_chunks",
  "jobs",
  "kb_snapshots",
] as const;

export type PaginatedResource = (typeof PAGINATED_RESOURCES)[number];

type ResourceConfig = {
  columns: string;
  orderBy: { column: string; ascending: boolean };
  softDelete: boolean;
};

const RESOURCES: Record<PaginatedResource, ResourceConfig> = {
  crops: {
    columns: "id, display_name, family, status, updated_at",
    orderBy: { column: "updated_at", ascending: false },
    softDelete: true,
  },
  diseases: {
    columns: "id, slug, name, crops, status, is_healthy",
    orderBy: { column: "updated_at", ascending: false },
    softDelete: true,
  },
  disease_treatments: {
    columns: "id, disease_id, crop, severity, method, title, status",
    orderBy: { column: "updated_at", ascending: false },
    softDelete: true,
  },
  leaf_samples: {
    columns: "id, crop, disease_label, caption, verified, status, updated_at",
    orderBy: { column: "updated_at", ascending: false },
    softDelete: true,
  },
  guide_documents: {
    columns: "id, title, crops, lang, source_type, status",
    orderBy: { column: "updated_at", ascending: false },
    softDelete: true,
  },
  guide_chunks: {
    columns: "id, crop, category, lang, status, chunk_text",
    orderBy: { column: "updated_at", ascending: false },
    softDelete: true,
  },
  jobs: {
    columns: "id, type, status, progress, error, payload, created_at",
    orderBy: { column: "created_at", ascending: false },
    softDelete: false,
  },
  kb_snapshots: {
    columns: "id, version, storage_path, size_bytes, created_at",
    orderBy: { column: "version", ascending: false },
    softDelete: false,
  },
};

export type ListFilters = {
  type?: string;
  status?: string;
};

export type ListResult<T = unknown> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

export function isPaginatedResource(value: string): value is PaginatedResource {
  return (PAGINATED_RESOURCES as readonly string[]).includes(value);
}

export async function fetchPaginatedResource<T = unknown>(
  resource: PaginatedResource,
  options: { page?: number; pageSize?: number; filters?: ListFilters } = {},
): Promise<ListResult<T>> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { rows: [], total: 0, page: 0, pageSize: DEFAULT_PAGE_SIZE };
  }

  const config = RESOURCES[resource];
  const page = Math.max(0, Math.floor(options.page ?? 0));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(options.pageSize ?? DEFAULT_PAGE_SIZE)));
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from(resource)
    .select(config.columns, { count: "exact" })
    .order(config.orderBy.column, { ascending: config.orderBy.ascending })
    .range(from, to);

  if (config.softDelete) {
    query = query.is("deleted_at", null);
  }
  if (options.filters?.type) {
    query = query.eq("type", options.filters.type);
  }
  if (options.filters?.status) {
    query = query.eq("status", options.filters.status);
  }

  const { data, error, count } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return {
    rows: (data ?? []) as T[],
    total: count ?? 0,
    page,
    pageSize,
  };
}
