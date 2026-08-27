import { createBaileysConnection } from "./baileys-connection";
import { ConfigurationError, readConfig } from "./config";
import { createWhatsAppServer } from "./server";

/**
 * The WhatsApp delivery service.
 *
 * Starts the HTTP interface FIRST and the WhatsApp connection second. The order
 * matters: pairing is done by reading `/pairing` over HTTP, so the interface has
 * to be answering before there is anything to pair — a service that waited for
 * WhatsApp before listening could never be paired at all.
 */
async function main(): Promise<void> {
  const config = readConfig();

  const connection = await createBaileysConnection(config.sessionDirectory, {
    onStatusChange: (status, detail) => {
      // The status and a sentence, never a credential, a QR or a phone number.
      log(`connection ${status}${detail ? ` — ${detail}` : ""}`);
    },
  });

  const server = createWhatsAppServer(connection, config.serviceToken);

  server.listen(config.port, () => {
    log(`listening on port ${config.port}`);
    log(`session directory ${config.sessionDirectory}`);
  });

  /*
   * ── SHUTTING DOWN WITHOUT LOSING THE SESSION ──────────────────────────────
   * Compose sends SIGTERM and waits before killing the process, so there is
   * time to finish properly — and finishing properly decides whether the next
   * container has to be paired again.
   *
   * `connection.close()` stops the reconnect timers, prevents any new attempt,
   * closes the socket WITHOUT logging out, and then waits for the last
   * credential write to reach the volume. Exiting before that write lands is
   * one of the two ways a session dies overnight; the other is two sockets
   * fighting, which the generation guard prevents.
   */
  let stopping = false;

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      // A second signal during shutdown must not start a second one, which
      // would race the first and could exit mid-write.
      if (stopping) {
        return;
      }

      stopping = true;
      log(`${signal} received, shutting down`);

      server.close();

      void connection
        .close()
        .then(() => {
          log("session preserved, exiting");
          process.exit(0);
        })
        .catch((error: unknown) => {
          process.stderr.write(
            `whatsapp: shutdown failed: ${error instanceof Error ? error.name : "UnknownError"}` + "\n",
          );
          process.exit(1);
        });
    });
  }
}

function log(message: string): void {
  process.stdout.write(`whatsapp: ${message}\n`);
}

main().catch((error: unknown) => {
  /*
   * A misconfigured service must not start. Reporting the reason and exiting is
   * what makes compose show a failing container instead of a running one that
   * silently refuses every send.
   */
  if (error instanceof ConfigurationError) {
    process.stderr.write(`whatsapp: ${error.message}\n`);
    process.exit(1);
  }

  process.stderr.write(
    `whatsapp: failed to start: ${error instanceof Error ? error.name : "UnknownError"}\n`,
  );
  process.exit(1);
});
