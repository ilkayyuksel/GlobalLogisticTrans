"use client";

import Link from "next/link";
import { Fragment } from "react";

import { useTranslation } from "@/lib/i18n/language-provider";
import { formatFileSize, type SelectedFile } from "./upload-file";

/**
 * One file and what became of it.
 *
 * A successful import shows the booking numbers it produced, each linking to
 * the Trip: an operator's next question after "did it arrive?" is "where is
 * it?". A failure shows the backend's own message, which is written for an
 * operator; the error code stays out of sight, because it is for matching
 * rather than for reading.
 */
export function UploadFileRow({
  selected,
  onRemove,
}: {
  selected: SelectedFile;
  onRemove: () => void;
}) {
  const t = useTranslation();

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">
          {selected.file.name}
        </span>
        <span className="mt-0.5 block text-xs">
          <span className="text-muted">
            {formatFileSize(selected.file.size)}
          </span>{" "}
          <Status selected={selected} />
        </span>
      </span>

      {selected.state === "uploading" ? null : (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-xs font-medium text-secondary hover:text-danger"
        >
          {t("upload.remove")}
        </button>
      )}
    </li>
  );
}

function Status({ selected }: { selected: SelectedFile }) {
  const t = useTranslation();

  if (!selected.isPdf) {
    return <span className="text-warning">· {t("upload.rejected")}</span>;
  }

  if (selected.state === "uploading") {
    // Text rather than a spinner: `fetch` reports no upload progress, so an
    // animation would suggest a measurement that does not exist.
    return <span className="text-secondary">· {t("upload.uploading")}</span>;
  }

  if (selected.state === "imported" && selected.result) {
    return <Imported result={selected.result} />;
  }

  if (selected.state === "failed") {
    return (
      <span className="text-danger">
        · ✗ {t("upload.failed")}
        {selected.result?.message ? ` — ${selected.result.message}` : ""}
      </span>
    );
  }

  return <span className="text-secondary">· {t("upload.pending")}</span>;
}

function Imported({
  result,
}: {
  result: NonNullable<SelectedFile["result"]>;
}) {
  const t = useTranslation();
  const trips = result.trips ?? [];
  const cancellations = result.cancellations ?? [];

  /*
   * A cancelled order was handled, not imported: it creates no Trip. Saying
   * "imported" here would tell the operator the opposite of what happened.
   */
  if (cancellations.length > 0) {
    const cancelled = cancellations.some(
      (entry) => entry.outcome === "CANCELLED",
    );

    return (
      <span className="text-secondary">
        · {cancelled ? t("upload.cancelled") : t("upload.cancelledNoTrip")}
      </span>
    );
  }

  return (
    <span className="text-success">
      · ✓{" "}
      {result.combination
        ? `${t("upload.combinationImported")} — ${trips.length} ${t("upload.tripsCreated")}`
        : t("upload.imported")}{" "}
      {trips.map((trip, index) => (
        <Fragment key={trip.id}>
          {index > 0 ? ", " : null}
          <Link
            href={`/trips/${trip.id}`}
            className="font-medium text-primary hover:underline"
          >
            {trip.bookingNumber}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}
