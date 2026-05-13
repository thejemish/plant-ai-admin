"use client";

/* eslint-disable react-hooks/incompatible-library */
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { ChevronFirst, ChevronLast, ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type AdminTableRow = {
  id: string;
  cells: React.ReactNode[];
  selectionValue: string;
};

export type ServerPaginationProps = {
  pageIndex: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onChange: (next: { pageIndex: number; pageSize: number }) => void;
};

type AdminDataTableProps = {
  columns: string[];
  compact?: boolean;
  emptyLabel?: string;
  enableRowSelection?: boolean;
  pageSizeOptions?: number[];
  rowIds?: string[];
  rows: React.ReactNode[][];
  selectionFormId?: string;
  selectionInputName?: string;
  selectionLabel?: string;
  selectionValues?: string[];
  serverPagination?: ServerPaginationProps;
};

export function AdminDataTable({
  columns,
  compact = false,
  emptyLabel = "No rows",
  enableRowSelection = true,
  pageSizeOptions = [10, 20, 50, 100],
  rowIds,
  rows,
  selectionFormId,
  selectionInputName = "ids",
  selectionLabel = "Select",
  selectionValues,
  serverPagination,
}: AdminDataTableProps) {
  const initialPageSize = serverPagination?.pageSize ?? pageSizeOptions[0] ?? 10;
  const [localPagination, setLocalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const pagination: PaginationState = serverPagination
    ? { pageIndex: serverPagination.pageIndex, pageSize: serverPagination.pageSize }
    : localPagination;
  const setPagination: React.Dispatch<React.SetStateAction<PaginationState>> = serverPagination
    ? (updater) => {
        const next =
          typeof updater === "function"
            ? (updater as (prev: PaginationState) => PaginationState)(pagination)
            : updater;
        serverPagination.onChange({ pageIndex: next.pageIndex, pageSize: next.pageSize });
      }
    : setLocalPagination;
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const data = useMemo<AdminTableRow[]>(
    () =>
      rows.map((cells, index) => ({
        id: rowIds?.[index] ?? index.toString(),
        cells,
        selectionValue: selectionValues?.[index] ?? rowIds?.[index] ?? index.toString(),
      })),
    [rows, rowIds, selectionValues],
  );

  const tableColumns = useMemo<ColumnDef<AdminTableRow>[]>(() => {
    const dataColumns: ColumnDef<AdminTableRow>[] = columns.map((column, index) => ({
      id: `${index}-${column}`,
      header: column,
      cell: ({ row }) => renderCell(column, row.original.cells[index]),
    }));
    if (!enableRowSelection) return dataColumns;
    const selectionColumn: ColumnDef<AdminTableRow> = {
      id: "__select",
      header: ({ table }) => (
        <IndeterminateCheckbox
          ariaLabel={`${selectionLabel} all rows`}
          checked={table.getIsAllRowsSelected()}
          disabled={table.getPrePaginationRowModel().rows.length === 0}
          indeterminate={table.getIsSomeRowsSelected()}
          onChange={(event) => table.toggleAllRowsSelected(event.currentTarget.checked)}
        />
      ),
      cell: ({ row }) => (
        <IndeterminateCheckbox
          ariaLabel={`Select row ${row.index + 1}`}
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={(event) => row.toggleSelected(event.currentTarget.checked)}
        />
      ),
    };
    return [selectionColumn, ...dataColumns];
  }, [columns, enableRowSelection, selectionLabel]);

  const manualPagination = Boolean(serverPagination);
  const pageCount = manualPagination
    ? Math.max(1, Math.ceil(serverPagination!.total / Math.max(1, pagination.pageSize)))
    : undefined;
  const table = useReactTable({
    columns: tableColumns,
    data,
    enableRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: manualPagination ? undefined : getPaginationRowModel(),
    manualPagination,
    pageCount,
    getRowId: (row) => row.id,
    autoResetPageIndex: false,
    autoResetAll: false,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    state: {
      pagination,
      rowSelection,
    },
  });

  const totalPages = manualPagination ? pageCount ?? 1 : Math.max(table.getPageCount(), 1);
  useEffect(() => {
    if (manualPagination) return;
    if (pagination.pageIndex > 0 && pagination.pageIndex >= totalPages) {
      setPagination((prev) => ({ ...prev, pageIndex: Math.max(totalPages - 1, 0) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.pageIndex, totalPages, manualPagination]);
  useEffect(() => {
    if (Object.keys(rowSelection).length === 0) return;
    const validIds = new Set(data.map((row) => row.id));
    let changed = false;
    const next: RowSelectionState = {};
    for (const key of Object.keys(rowSelection)) {
      if (validIds.has(key)) next[key] = rowSelection[key];
      else changed = true;
    }
    if (changed) setRowSelection(next);
  }, [data, rowSelection]);
  const allSelectedRows = data.filter((row) => rowSelection[row.id]);
  const selectedCount = allSelectedRows.length;
  const totalRows = serverPagination?.total ?? data.length;

  return (
    <div className="rounded-lg border">
      {selectionFormId
        ? allSelectedRows.map((row) => (
            <input
              form={selectionFormId}
              key={row.id}
              name={selectionInputName}
              type="hidden"
              value={row.selectionValue}
            />
          ))
        : null}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell className="h-16 text-muted-foreground" colSpan={table.getAllLeafColumns().length}>
                {emptyLabel}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    className={compact ? "max-w-40 truncate py-2" : "max-w-64 truncate"}
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>
            {enableRowSelection
              ? `${selectedCount} of ${totalRows} row${totalRows === 1 ? "" : "s"} selected`
              : `${totalRows} row${totalRows === 1 ? "" : "s"}`}
          </span>
          <label className="flex items-center gap-2">
            <span>Rows per page</span>
            <select
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:ring-3"
              onChange={(event) => table.setPageSize(Number(event.target.value))}
              value={table.getState().pagination.pageSize}
            >
              {pageSizeOptions.map((pageSize) => (
                <option key={pageSize} value={pageSize}>
                  {pageSize}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
          </span>
          <Button
            aria-label="First page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.firstPage()}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronFirst className="size-4" />
          </Button>
          <Button
            aria-label="Previous page"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            aria-label="Next page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            aria-label="Last page"
            disabled={!table.getCanNextPage()}
            onClick={() => table.lastPage()}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <ChevronLast className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function IndeterminateCheckbox({
  ariaLabel,
  checked,
  disabled,
  indeterminate,
  onChange,
}: {
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate) && !checked;
    }
  }, [checked, indeterminate]);

  return (
    <input
      aria-label={ariaLabel}
      checked={checked}
      className="size-4 rounded border-input"
      disabled={disabled}
      onChange={onChange}
      ref={ref}
      type="checkbox"
    />
  );
}

function renderCell(column: string, value: React.ReactNode) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.toLowerCase();

  if (["status", "verified", "severity", "method"].includes(column.toLowerCase())) {
    return (
      <Badge variant={["published", "yes", "succeeded"].includes(normalized) ? "default" : "secondary"}>
        {value}
      </Badge>
    );
  }

  if (column.toLowerCase() === "progress" || column.toLowerCase() === "score") {
    return <span className="font-mono text-xs">{value}</span>;
  }

  return value;
}
