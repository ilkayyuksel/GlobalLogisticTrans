"use client";

import { useState } from "react";

import { RittenDialog } from "@/components/ritten/ritten-dialog";
import { userFacingMessage } from "@/lib/api/client";
import {
  checkBulkRouteImport,
  runBulkRouteImport,
  type BulkRouteImportCheck,
} from "@/lib/api/route-configuration";
import { useTranslation } from "@/lib/i18n/language-provider";

/** The shape of a document, shown in the empty editor as a starting point. */
const EXAMPLE_DOCUMENT = `{
  "routes": [
    {
      "type": "NORMAL",
      "departure": "Antwerp",
      "destination": "Kallo",
      "tarief": 100,
      "toll": 25,
      "tunnel": 0
    },
    {
      "type": "COMBINATION",
      "legs": [
        {
          "departure": "Antwerp",
          "destination": "Kallo",
          "tarief": 100,
          "toll": 25,
          "tunnel": 0
        },
        {
          "departure": "Kallo",
          "destination": "Antwerp",
          "tarief": 80,
          "toll": 30,
          "tunnel": 15
        }
      ]
    }
  ]
}`;

/**
 * Bulk import of route prices, pasted as JSON.
 *
 * ── WHAT THIS SCREEN DECIDES: ALMOST NOTHING ────────────────────────────────
 * It reads the text as JSON — a paste that is not JSON at all cannot be sent
 * anywhere, so that one check has to happen here — and then asks the backend
 * everything else: whether each route is valid, how many records it would
 * create, and which of them already exist. The counts and the errors on this
 * screen are the backend's answer rendered, never a second opinion.
 *
 * ── AND WHY IT ASKS TWICE ───────────────────────────────────────────────────
 * `Controleren` shows what would happen and writes nothing; `Importeren` then
 * performs it. An operator pasting eighty routes gets to see the damage before
 * it is done, and the import re-validates on its own so the two cannot disagree.
 *
 * ── JSON IS THE INPUT FORMAT, NOTHING MORE ──────────────────────────────────
 * Nothing about this document is stored as JSON. Each entry becomes exactly the
 * same relational records a route configured in the form becomes — which is why
 * an imported Combination shows up in the list, and behaves, exactly like one
 * configured by hand.
 */
export function BulkRouteImportDialog({
  onImported,
  onClose,
}: {
  /** Called once the backend accepted the import, so the list can reload. */
  onImported: (summary: string) => void;
  onClose: () => void;
}) {
  const t = useTranslation();
  const [json, setJson] = useState("");
  const [check, setCheck] = useState<BulkRouteImportCheck | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  /**
   * The document, or null when the text is not JSON at all.
   *
   * The ONLY judgement this component makes about the content, and it makes it
   * because unparseable text cannot be sent: there is nothing to send. What the
   * document must contain — a routes array, entries of a known type, valid
   * amounts, roads nobody has configured yet — is the backend's to decide, and it
   * reports all of it in one list.
   */
  function readDocument(): unknown | null {
    try {
      return JSON.parse(json) as unknown;
    } catch {
      return null;
    }
  }

  async function run(
    operation: (document: unknown) => Promise<void>,
  ): Promise<void> {
    const document = readDocument();

    if (document === null) {
      setCheck(null);
      setFailure(t("settings.pricing.routes.bulk.invalidJson"));

      return;
    }

    setIsBusy(true);
    setFailure(null);

    try {
      await operation(document);
    } catch (error: unknown) {
      setCheck(null);
      setFailure(userFacingMessage(error));
    } finally {
      setIsBusy(false);
    }
  }

  const summary = check?.summary;

  return (
    <RittenDialog title={t("settings.pricing.routes.bulk.title")} onClose={onClose}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">
          {t("settings.pricing.routes.bulk.description")}
        </p>

        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
            {t("settings.pricing.routes.bulk.documentLabel")}
          </span>
          <textarea
            aria-label={t("settings.pricing.routes.bulk.documentLabel")}
            value={json}
            spellCheck={false}
            rows={14}
            placeholder={EXAMPLE_DOCUMENT}
            onChange={(event) => {
              setJson(event.target.value);
              // The preview belongs to the text it was made from.
              setCheck(null);
              setFailure(null);
            }}
            className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs text-foreground"
          />
        </label>

        {failure ? (
          <p
            role="alert"
            className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-foreground"
          >
            {failure}
          </p>
        ) : null}

        {check && summary ? (
          <section
            aria-label={t("settings.pricing.routes.bulk.previewTitle")}
            className="rounded-md border border-border p-3"
          >
            <h3 className="text-sm font-semibold text-foreground">
              {check.isValid
                ? t("settings.pricing.routes.bulk.previewTitle")
                : t("settings.pricing.routes.bulk.refused")}
            </h3>

            <ul className="mt-2 space-y-0.5 text-sm text-secondary">
              <li>{`${summary.normalRoutes} ${t("settings.pricing.routes.bulk.normalRoutes")}`}</li>
              <li>{`${summary.combinationGroups} ${t("settings.pricing.routes.bulk.combinationGroups")}`}</li>
              <li>{`${summary.combinationLegs} ${t("settings.pricing.routes.bulk.combinationLegs")}`}</li>
              <li className="font-medium text-foreground">
                {`${t("settings.pricing.routes.bulk.total")}: ${summary.totalRoutes}`}
              </li>
            </ul>

            {check.errors.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-danger">
                {check.errors.map((error, index) => (
                  <li key={`${error.routeNumber}-${error.field ?? index}-${index}`}>
                    {/*
                      A problem with the document itself belongs to no entry, so
                      it is labelled as the document rather than as route 0.
                    */}
                    {error.routeNumber === null
                      ? t("settings.pricing.routes.bulk.document")
                      : `${t("settings.pricing.routes.bulk.route")} ${error.routeNumber}`}
                    {error.legNumber === null
                      ? ""
                      : `, ${t("settings.pricing.routes.combinations.leg")} ${error.legNumber}`}
                    {`: ${error.message}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isBusy || json.trim() === ""}
            onClick={() =>
              void run(async (document) =>
                setCheck(await checkBulkRouteImport(document)),
              )
            }
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("settings.pricing.routes.bulk.check")}
          </button>

          {/*
            Enabled only once the backend has said the document is valid. It is
            not a second validation — the import validates again itself — but a
            refused document is not something to invite an operator to send.
          */}
          <button
            type="button"
            disabled={isBusy || check === null || !check.isValid}
            onClick={() =>
              void run(async (document) => {
                const imported = await runBulkRouteImport(document);

                onImported(
                  `${imported.totalRoutes} ${t("settings.pricing.routes.bulk.total").toLowerCase()}`,
                );
              })
            }
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {isBusy
              ? t("settings.pricing.saving")
              : t("settings.pricing.routes.bulk.import")}
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-hover disabled:opacity-50"
          >
            {t("settings.pricing.cancel")}
          </button>
        </div>
      </div>
    </RittenDialog>
  );
}
