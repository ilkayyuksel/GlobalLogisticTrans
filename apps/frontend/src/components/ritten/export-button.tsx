"use client";

import { useState } from "react";

import { userFacingMessage } from "@/lib/api/client";
import { listCustomProperties } from "@/lib/api/custom-properties";
import { fetchPricingSnapshots } from "@/lib/api/pricing";
import {
  findAutomaticPropertyId,
  findFuelPercentage,
  listSettings,
} from "@/lib/api/settings";
import { ExportTooLargeError, fetchTripsForExport } from "@/lib/api/trip-export";
import { MAX_PAGE_SIZE, type ListTripsParams } from "@/lib/api/trips";
import { useLanguage, useTranslation } from "@/lib/i18n/language-provider";
import {
  toBasicRow,
  toManualPropertyIds,
  toPricingRow,
} from "@/lib/ritten/export-rows";
import {
  basicFileName,
  buildBasicWorkbook,
  buildPricingWorkbook,
  pricingFileName,
} from "@/lib/ritten/export-workbooks";
import { downloadWorkbook } from "@/lib/ritten/export-workbook";

/**
 * The two Excel exports, over the CURRENT filtered selection.
 *
 * ── WHAT "CURRENT" MEANS ────────────────────────────────────────────────────
 * Everything the list is showing except the page: the Day/Week/Month period,
 * the search, and the status, vehicle, terminal and custom-property filters.
 * An operator exporting "this month, open, this truck" means every matching
 * Trip, and a file holding the first fifty would be wrong in a way only
 * discovered downstream.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── PRIJSOVERZICHT vs BASIS ─────────────────────────────────────────────────
 * The pricing export presents the STORED pricing of each Trip, line by line.
 * The basic export is the daily operational sheet: what to do, on which truck,
 * and what it costs in custom properties and waiting time.
 *
 * Neither calculates money. Both read what the Pricing Engine already stored,
 * and neither can cause a Trip to be priced.
 * ────────────────────────────────────────────────────────────────────────────
 */
type ExportKind = "pricing" | "basic";

export function ExportButton({
  query,
  periodStart,
  periodEnd,
}: {
  /** The active filters and period, without pagination. */
  query: ListTripsParams;
  periodStart: string;
  periodEnd: string;
}) {
  const t = useTranslation();
  const { language } = useLanguage();
  const [running, setRunning] = useState<ExportKind | null>(null);
  const [message, setMessage] = useState<{
    text: string;
    isError: boolean;
  } | null>(null);

  async function run(kind: ExportKind): Promise<void> {
    setRunning(kind);
    setMessage(null);

    try {
      const trips = await fetchTripsForExport(query);

      /*
       * The stored pricing of every exported Trip, in batches. Fetched even for
       * the basic export, because its Kosten column is made of stored pricing
       * lines rather than of anything this browser could work out.
       */
      const snapshots = await fetchPricingSnapshots(
        trips.map((trip) => trip.id),
      );

      if (kind === "pricing") {
        const fuelPercentage = findFuelPercentage(await listSettings());
        const rows = trips.map((trip) =>
          toPricingRow(trip, snapshots.get(trip.id) ?? null, fuelPercentage),
        );

        downloadWorkbook(
          await buildPricingWorkbook(rows, language),
          pricingFileName(periodStart, periodEnd),
        );
      } else {
        /*
         * The catalog, read at EXPORT time like everything else here, so a
         * property added or deactivated since the Trips were closed is
         * reflected. It decides which names belong in Info: fixed-price and
         * chosen by an operator — see `toManualPropertyIds`.
         */
        const properties = await listCustomProperties({
          pageSize: MAX_PAGE_SIZE,
        });
        const manualPropertyIds = toManualPropertyIds(properties.items);
        const waitingWord = t("ritten.export.waitingWord");
        /*
         * Which property is TAR, so its line can be RECOGNISED in a stored
         * snapshot. Whether TAR applied is never decided here — the Engine
         * already decided it, same-day rule included, and the snapshot says so.
         */
        const automaticPropertyId = findAutomaticPropertyId(
          await listSettings(),
        );

        const rows = trips.map((trip) =>
          toBasicRow(
            trip,
            snapshots.get(trip.id) ?? null,
            manualPropertyIds,
            waitingWord,
            automaticPropertyId,
          ),
        );

        downloadWorkbook(
          // The period prints above the table, exactly as the office sheet has
          // it, so a page picked off a printer says which day it covers.
          await buildBasicWorkbook(rows, language, {
            start: periodStart,
            end: periodEnd,
          }),
          basicFileName(periodStart, periodEnd),
        );
      }

      setMessage({ text: t("ritten.export.done"), isError: false });
    } catch (error: unknown) {
      setMessage({
        text:
          error instanceof ExportTooLargeError
            ? t("ritten.export.tooLarge")
            : `${t("ritten.export.failed")} — ${userFacingMessage(error)}`,
        isError: true,
      });
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ExportAction
        label={t("ritten.export.pricing")}
        title={t("ritten.export.scope")}
        isRunning={running === "pricing"}
        isDisabled={running !== null}
        runningLabel={t("ritten.export.running")}
        onRun={() => void run("pricing")}
      />

      <ExportAction
        label={t("ritten.export.basic")}
        title={t("ritten.export.scope")}
        isRunning={running === "basic"}
        isDisabled={running !== null}
        runningLabel={t("ritten.export.running")}
        onRun={() => void run("basic")}
      />

      {message ? (
        <span
          role="status"
          className={message.isError ? "text-sm text-danger" : "text-sm text-success"}
        >
          {message.text}
        </span>
      ) : null}
    </div>
  );
}

function ExportAction({
  label,
  title,
  isRunning,
  isDisabled,
  runningLabel,
  onRun,
}: {
  label: string;
  title: string;
  isRunning: boolean;
  isDisabled: boolean;
  runningLabel: string;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={isDisabled}
      title={title}
      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
    >
      {isRunning ? runningLabel : label}
    </button>
  );
}
