"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as React from "react";
import { useCallback, useState } from "react";
import { AdminDataTable } from "@/components/admin/data-table";
import type { PaginatedResource } from "@/lib/admin/list";

function buildKey(
  resource: PaginatedResource,
  page: number,
  pageSize: number,
  filters?: Record<string, string | undefined>,
) {
  return ["admin", "list", resource, page, pageSize, filters ?? {}] as const;
}

type PaginatedResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

async function fetchPage<T>(
  resource: PaginatedResource,
  page: number,
  pageSize: number,
  filters?: Record<string, string | undefined>,
): Promise<PaginatedResult<T>> {
  const params = new URLSearchParams({
    resource,
    page: String(page),
    pageSize: String(pageSize),
  });
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v);
    }
  }
  const response = await fetch(`/api/admin/list?${params.toString()}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Failed to load admin list.");
  }
  return response.json() as Promise<PaginatedResult<T>>;
}

export type PaginatedTableProps<T> = {
  resource: PaginatedResource;
  columns: string[];
  renderRow: (row: T) => React.ReactNode[];
  getRowId: (row: T) => string;
  filters?: Record<string, string | undefined>;
  initialPageSize?: number;
  compact?: boolean;
  enableRowSelection?: boolean;
  selectionFormId?: string;
  selectionInputName?: string;
  emptyLabel?: string;
};

export function PaginatedTable<T>({
  resource,
  columns,
  renderRow,
  getRowId,
  filters,
  initialPageSize = 20,
  compact,
  enableRowSelection,
  selectionFormId,
  selectionInputName,
  emptyLabel,
}: PaginatedTableProps<T>) {
  const filterKey = JSON.stringify(filters ?? {});
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: initialPageSize,
    resource,
    filterKey,
  });
  const pageIndex =
    pagination.resource === resource && pagination.filterKey === filterKey ? pagination.pageIndex : 0;
  const pageSize = pagination.pageSize;

  const query = useQuery<PaginatedResult<T>>({
    queryKey: buildKey(resource, pageIndex, pageSize, filters),
    queryFn: () => fetchPage<T>(resource, pageIndex, pageSize, filters),
    placeholderData: (previous) => previous,
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const onChange = useCallback(
    (next: { pageIndex: number; pageSize: number }) => {
      setPagination({
        pageIndex: next.pageIndex,
        pageSize: next.pageSize,
        resource,
        filterKey,
      });
    },
    [filterKey, resource],
  );

  return (
    <AdminDataTable
      columns={columns}
      compact={compact}
      emptyLabel={query.isError ? query.error.message : emptyLabel}
      enableRowSelection={enableRowSelection}
      rowIds={rows.map((row) => getRowId(row))}
      selectionFormId={selectionFormId}
      selectionInputName={selectionInputName}
      selectionValues={rows.map((row) => getRowId(row))}
      rows={rows.map((row) => renderRow(row))}
      serverPagination={{
        pageIndex,
        pageSize,
        total,
        loading: query.isFetching,
        onChange,
      }}
    />
  );
}

export function useInvalidateAdminLists() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["admin", "list"] });
  }, [queryClient]);
}
