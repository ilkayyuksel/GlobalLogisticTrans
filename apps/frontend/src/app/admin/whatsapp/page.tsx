"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, LoadingState } from "@/components/ui/states";
import {
  fetchWhatsAppPairing,
  type WhatsAppPairing,
  type WhatsAppStatus,
} from "@/lib/api/whatsapp";
import { useTranslation } from "@/lib/i18n/language-provider";

/**
 * Admin → WhatsApp: linking the account, once.
 *
 * ── WHY THIS PAGE EXISTS ────────────────────────────────────────────────────
 * The WhatsApp delivery service holds the logged-in account, so it publishes no
 * port and lives on an internal Docker network. That is deliberate: the pairing
 * code links a phone to this company's WhatsApp, and a code reachable from the
 * internet would let a stranger link theirs. But it also means nobody can reach
 * the service to pair it.
 *
 * This page is the bridge. The browser asks the TRANO backend, the backend asks
 * the service from inside the network, and the existing authenticated session
 * is what stands between the two. No port is opened and no second login exists.
 *
 * ── THE QR IS NEVER STORED ──────────────────────────────────────────────────
 * Not in the database, not in localStorage, not in a ref that outlives the
 * poll. It is a challenge that expires in seconds and WhatsApp reissues it; the
 * page draws whatever the last poll returned and forgets it.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * How often the status is re-read while the page is open.
 *
 * Three seconds: fast enough that scanning a code feels immediate, slow enough
 * that an admin screen left open all afternoon is not a load. ONE request for
 * the page — never one per row of anything.
 */
const POLL_INTERVAL_MS = 3_000;

/** The colour of each state, as a dot rather than as a word. */
const STATUS_DOT: Record<WhatsAppStatus, string> = {
  CONNECTED: "🟢",
  CONNECTING: "🟡",
  DISCONNECTED: "🟠",
  PAIRING_REQUIRED: "🔴",
  ERROR: "🔴",
  DISABLED: "⚪",
};

export default function Page() {
  const t = useTranslation();
  const pairing = usePairingPoll();

  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader
          title={t("admin.whatsapp.title")}
          description={t("admin.whatsapp.description")}
        />
        <CardBody>
          {pairing.error ? (
            <ErrorState error={pairing.error} onRetry={pairing.reload} />
          ) : !pairing.data ? (
            <LoadingState label={t("admin.whatsapp.loading")} />
          ) : (
            <PairingPanel pairing={pairing.data} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function PairingPanel({ pairing }: { pairing: WhatsAppPairing }) {
  const t = useTranslation();

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted">
          {t("admin.whatsapp.statusLabel")}
        </h3>
        <p
          // Announced, so an admin who is not watching the page still learns
          // that the scan worked.
          aria-live="polite"
          data-testid="whatsapp-status"
          className="mt-1 flex items-center gap-2 text-base font-medium text-foreground"
        >
          <span aria-hidden="true">{STATUS_DOT[pairing.status]}</span>
          {t(`admin.whatsapp.state.${pairing.status}`)}
        </p>
      </section>

      {pairing.status === "CONNECTED" ? (
        <p className="text-sm text-secondary">
          {t("admin.whatsapp.connectedHint")}
        </p>
      ) : null}

      {/*
        The QR appears for exactly one status. A dropped websocket is not a
        pairing problem — telling an operator to fetch their phone for a
        two-second reconnect is the habit this whole area was built to avoid.
      */}
      {pairing.status === "PAIRING_REQUIRED" && pairing.qr ? (
        <PairingInstructions qr={pairing.qr} />
      ) : null}
    </div>
  );
}

function PairingInstructions({ qr }: { qr: string }) {
  const t = useTranslation();

  return (
    <section className="space-y-4 border-t border-border pt-6">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-secondary">
        {(
          [
            "admin.whatsapp.step.openWhatsApp",
            "admin.whatsapp.step.settings",
            "admin.whatsapp.step.linkedDevices",
            "admin.whatsapp.step.linkDevice",
            "admin.whatsapp.step.scan",
          ] as const
        ).map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>

      {/*
        White background and dark modules, always — a QR is read by a camera,
        and inverting it in dark mode makes it unscannable on many phones. This
        is the one element on the page that does not follow the theme, and the
        reason is physical rather than aesthetic.
      */}
      <div className="flex justify-center">
        <div className="rounded-lg bg-white p-4" data-testid="whatsapp-qr">
          <QRCodeSVG
            value={qr}
            size={256}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
            aria-label={t("admin.whatsapp.qrLabel")}
          />
        </div>
      </div>

      <p className="text-center text-xs text-muted">
        {t("admin.whatsapp.qrHint")}
      </p>
    </section>
  );
}

/**
 * The pairing state, re-read while the page is open.
 *
 * ── WHY NOT `useAsync` ──────────────────────────────────────────────────────
 * That hook fetches once per dependency change, which is right for a list and
 * wrong for a screen whose whole purpose is to notice a change made on somebody
 * else's phone. This polls, and it stops the moment the page is unmounted — the
 * interval is cleared AND the in-flight request is aborted, so a slow response
 * cannot call `setState` on a component that is gone.
 *
 * A failed poll does NOT clear what is on screen: a single dropped request
 * should not blank the QR an operator is in the middle of scanning. Only the
 * first failure, when there is nothing to show yet, becomes an error state.
 */
function usePairingPoll() {
  const [data, setData] = useState<WhatsAppPairing | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let stopped = false;

    async function poll(): Promise<void> {
      try {
        const next = await fetchWhatsAppPairing(controller.signal);

        if (!stopped) {
          setData(next);
          setError(null);
        }
      } catch (failure: unknown) {
        // An abort is this component going away, not a problem to report.
        if (!stopped && !controller.signal.aborted) {
          setError((previous: unknown) => (data ? previous : failure));
        }
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    };
    // `data` is deliberately absent: including it would restart the interval on
    // every poll, and the closure only reads it to decide whether to surface a
    // first-load failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadToken]);

  return {
    data,
    error,
    reload: () => {
      setError(null);
      setReloadToken((token) => token + 1);
    },
  };
}
