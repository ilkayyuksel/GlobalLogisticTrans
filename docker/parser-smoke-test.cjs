/**
 * Parses one real transport order inside the image that will run the parser.
 *
 * ── WHY THIS RUNS DURING THE DOCKER BUILD ───────────────────────────────────
 * The parser loads pdfjs-dist through a dynamic import resolved from its own
 * package directory. That resolution depends on the shape of node_modules, and
 * a container's is not a developer machine's: this exact call once broke while
 * every unit test still passed. Running it during the build turns that class of
 * failure into a build error instead of a mailbox that quietly imports nothing.
 *
 * It fails loudly — a non-zero exit stops the build — and it reads a committed
 * fixture, never customer data.
 * ────────────────────────────────────────────────────────────────────────────
 */
const { readFileSync, writeFileSync } = require("node:fs");

const FIXTURE = "docs/06-pdf/NEW/1page.pdf";
const EXPECTED_BOOKING = "ANRDUB2602247";
const REPORT = "/parser-smoke.txt";

async function main() {
  const { parse } = require("./apps/parser/dist/index.js");
  const result = await parse(new Uint8Array(readFileSync(FIXTURE)));

  if (!result.ok) {
    throw new Error(`the parser refused ${FIXTURE}: ${result.reason} — ${result.message}`);
  }

  const [trip] = result.trips;

  if (trip.bookingNumber !== EXPECTED_BOOKING) {
    throw new Error(
      `the parser read booking ${trip.bookingNumber}, expected ${EXPECTED_BOOKING}`,
    );
  }

  const summary = [
    `fixture=${FIXTURE}`,
    `layout=${result.layout}`,
    `documentStatus=${result.documentStatus}`,
    `parserVersion=${result.parserVersion}`,
    `booking=${trip.bookingNumber}`,
    `destination=${trip.destinationCity}`,
  ].join(" ");

  writeFileSync(REPORT, `${summary}\n`);
  console.log(`parser smoke test passed: ${summary}`);
}

main().catch((error) => {
  console.error(`parser smoke test FAILED: ${error.message}`);
  process.exit(1);
});
