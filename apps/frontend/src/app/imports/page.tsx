"use client";

import { useCallback, useState } from "react";

import { ImportsTable } from "@/components/imports/imports-table";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAsync } from "@/hooks/use-async";
import { listImportedEmails } from "@/lib/api/imports";
import type { ImportedEmailStatus, ImportType } from "@/lib/api/types";

const PAGE_SIZE = 25;

const STATUS_OPTIONS: readonly {
  value: ImportedEmailStatus | "";
  label: string;
}[] = [
  { value: "", label: "All" },
  { value: "PROCESSED", label: "Processed" },
  { value: "FAILED", label: "Failed" },
  { value: "IGNORED", label: "Ignored" },
  { value: "PROCESSING", label: "Processing" },
  { value: "RECEIVED", label: "Received" },
];

const TYPE_OPTIONS: readonly { value: ImportType | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "NEW", label: "New" },
  { value: "UPDATE", label: "Update" },
  { value: "CANCEL", label: "Cancel" },
];

/**
 * What the mailbox did.
 *
 * Read-only, deliberately. These rows are the record of what arrived and what
 * became of it; a failed import is retried by the next scan, not by a button
 * here. The page answers four questions and no more: did it arrive, was it
 * handled, what did it ask for, and did it produce a document.
 */
export default function ImportsPage() {
  const [status, setStatus] = useState<ImportedEmailStatus | "">("");
  const [importType, setImportType] = useState<ImportType | "">("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error, reload } = useAsync(
    useCallback(
      (signal: AbortSignal) =>
        listImportedEmails(
          {
            page,
            pageSize: PAGE_SIZE,
            processingStatus: status === "" ? undefined : status,
            importType: importType === "" ? undefined : importType,
          },
          signal,
        ),
      [page, status, importType],
    ),
    [page, status, importType],
  );

  const isFiltered = status !== "" || importType !== "";

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-xl font-semibold text-foreground">Imports</h1>

      <Card>
        <CardHeader
          title="Incoming transport orders"
          description={
            data
              ? `${data.meta.totalItems} ${
                  data.meta.totalItems === 1 ? "email" : "emails"
                } seen by the mailbox scan`
              : "Loading imported emails"
          }
        />

        <div className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-4">
          <Filter
            id="import-status"
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(value) => {
              setStatus(value as ImportedEmailStatus | "");
              setPage(1);
            }}
          />
          <Filter
            id="import-type"
            label="Type"
            value={importType}
            options={TYPE_OPTIONS}
            onChange={(value) => {
              setImportType(value as ImportType | "");
              setPage(1);
            }}
          />
        </div>

        {isLoading ? <LoadingState label="Loading imports" /> : null}

        {!isLoading && error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : null}

        {!isLoading && !error && data && data.items.length === 0 ? (
          <EmptyState
            title={isFiltered ? "No imports match these filters" : "No imports yet"}
            description={
              isFiltered
                ? "Try another status or type."
                : "Transport orders appear here once the mailbox scan has run."
            }
          />
        ) : null}

        {!isLoading && !error && data && data.items.length > 0 ? (
          <>
            <ImportsTable emails={data.items} />
            <Pagination
              page={data.meta.page}
              totalPages={data.meta.totalPages}
              onChange={setPage}
            />
          </>
        ) : null}
      </Card>
    </div>
  );
}

function Filter({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between border-t border-border px-5 py-3 text-sm"
    >
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        Previous
      </button>

      <span className="text-secondary">
        Page {page} of {totalPages}
      </span>

      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        Next
      </button>
    </nav>
  );
}
