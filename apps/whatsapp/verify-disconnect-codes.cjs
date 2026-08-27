/**
 * Pins this service's disconnect codes to the ones Baileys actually ships.
 *
 * ── WHY THIS IS A BUILD STEP AND NOT A TEST ─────────────────────────────────
 * `reconnect-policy.ts` deliberately does NOT import Baileys: it must stay
 * loadable in a CommonJS test runner, and Baileys 7 is ESM-only. So the numeric
 * codes are duplicated there, and a duplicate is only safe if something checks
 * it. The unit tests cannot — they are the very place that cannot load the
 * library — so the check runs here, against the real package, inside the image
 * that will run it.
 *
 * If a future Baileys renumbers a reason, the BUILD fails. The alternative is a
 * service that silently reads "logged out" as "temporary" or, far worse, the
 * reverse: deleting a perfectly good session and demanding a QR code.
 */
const { DisconnectReason } = require("@whiskeysockets/baileys");

/** Must match `DisconnectCode` in src/reconnect-policy.ts, name for name. */
const EXPECTED = {
  loggedOut: 401,
  forbidden: 403,
  timedOut: 408,
  multideviceMismatch: 411,
  connectionClosed: 428,
  connectionReplaced: 440,
  badSession: 500,
  unavailableService: 503,
  restartRequired: 515,
};

const drifted = Object.entries(EXPECTED).filter(
  ([name, code]) => DisconnectReason[name] !== code,
);

if (drifted.length > 0) {
  for (const [name, code] of drifted) {
    process.stderr.write(
      `disconnect code drift: ${name} expected ${code}, Baileys reports ${DisconnectReason[name]}\n`,
    );
  }

  process.stderr.write(
    "Update DisconnectCode in apps/whatsapp/src/reconnect-policy.ts to match.\n",
  );
  process.exit(1);
}

process.stdout.write(
  `disconnect codes verified against Baileys (${drifted.length === 0 ? Object.keys(EXPECTED).length : 0} codes)\n`,
);
