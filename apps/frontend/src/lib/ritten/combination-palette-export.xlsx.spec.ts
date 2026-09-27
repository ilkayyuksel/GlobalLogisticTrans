import ExcelJS from "exceljs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  COMBINATION_RGB,
  combinationColorIndex,
  combinationPalette,
  type GroupOccurrence,
} from "./combination";
import { perceptualDistance } from "./combination-spread";
import type { BasicExportRow } from "./export-rows";
import { buildBasicWorkbook } from "./export-workbooks";

/**
 * The spreadsheet's group colours are the list's group colours.
 *
 * ── WHY THIS NEEDS ITS OWN SUITE ────────────────────────────────────────────
 * The colour a group gets now depends on which groups are seen together, and the
 * export is a second place that shows those same groups. If the two worked it out
 * separately they would disagree the moment the rules differed by a hair, and a
 * Combination would be blue on screen and green on paper — which is worse than the
 * near-identical greens this change set out to fix, because it breaks the one
 * thing a group colour promises.
 *
 * So the export takes the palette the list built, and these tests read a real
 * `.xlsx` back to prove the fills came from it.
 * ────────────────────────────────────────────────────────────────────────────
 */

const MONDAY = "2026-09-14";
const TUESDAY = "2026-09-15";

const GROUP_A = "group-a";
const GROUP_B = "group-b";
const GROUP_C = "group-c";

/** The five columns of a dispatch row that matter here, plus its group. */
function row(
  tripGroupId: string | null,
  bookingNumber: string,
): BasicExportRow {
  return {
    tripGroupId,
    licensePlate: "1-ABC-123",
    startTime: "08:00",
    endTime: "12:30",
    bookingNumber,
    containerType: "40HC",
    containerNumber: "EUCU1451295",
    trip: "Quay 869 → Kallo",
    costs: "",
    info: "",
  };
}

function on(planningDate: string, tripGroupId: string): GroupOccurrence {
  return { planningDate, tripGroupId };
}

/** The fill of each body row of a written-and-reopened workbook. */
async function fillsOf(
  rows: readonly BasicExportRow[],
  palette?: ReturnType<typeof combinationPalette>,
): Promise<(string | null)[]> {
  const buffer = await buildBasicWorkbook(
    rows,
    "nl",
    { start: MONDAY, end: TUESDAY },
    palette,
  );

  const directory = await mkdtemp(join(tmpdir(), "trano-group-colour-"));
  const file = join(directory, "basis.xlsx");

  await writeFile(file, Buffer.from(buffer));

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(
    (await readFile(file)) as unknown as Parameters<
      typeof reopened.xlsx.load
    >[0],
  );
  const sheet = reopened.worksheets[0];

  // Row 1 is the date, row 2 the headers, the Trips follow.
  return rows.map((_row, index) => {
    const fill = sheet.getRow(3 + index).getCell(1).fill as
      | { fgColor?: { argb?: string } }
      | undefined;

    return fill?.fgColor?.argb ?? null;
  });
}

describe("the sheet paints the palette it was given", () => {
  const PERIOD = [on(MONDAY, GROUP_A), on(MONDAY, GROUP_B), on(TUESDAY, GROUP_C)];

  it("fills each grouped row with that group's colour", async () => {
    const palette = combinationPalette(PERIOD);

    const fills = await fillsOf(
      [row(GROUP_A, "A1"), row(GROUP_B, "B1"), row(GROUP_C, "C1")],
      palette,
    );

    expect(fills).toEqual([
      palette.fillArgb(GROUP_A),
      palette.fillArgb(GROUP_B),
      palette.fillArgb(GROUP_C),
    ]);
  });

  it("gives two groups of one day plainly different fills", async () => {
    const palette = combinationPalette(PERIOD);

    const [first, second] = await fillsOf(
      [row(GROUP_A, "A1"), row(GROUP_B, "B1")],
      palette,
    );

    expect(first).not.toBe(second);
    expect(
      perceptualDistance(
        COMBINATION_RGB[palette.indexOf(GROUP_A) - 1],
        COMBINATION_RGB[palette.indexOf(GROUP_B) - 1],
      ),
    ).toBeGreaterThan(0.15);
  });

  /** Every Trip of one group, wherever it sits in the file. */
  it("keeps one fill for every row of a group", async () => {
    const palette = combinationPalette(PERIOD);

    const fills = await fillsOf(
      [
        row(GROUP_A, "A1"),
        row(GROUP_B, "B1"),
        row(GROUP_A, "A2"),
        row(GROUP_C, "C1"),
        row(GROUP_A, "A3"),
      ],
      palette,
    );

    expect(fills[0]).toBe(fills[2]);
    expect(fills[0]).toBe(fills[4]);
    expect(fills[0]).not.toBe(fills[1]);
  });

  /*
   * ── THE EXPORT ORDER DECIDES NOTHING ──────────────────────────────────────
   * The palette is keyed by group and ordered by day, so writing the rows the
   * other way round paints each group the same colour it had before. A colour
   * that depended on row order would change every time a sort changed.
   */
  it("paints the same colours whatever order the rows are written in", async () => {
    const palette = combinationPalette(PERIOD);
    const rows = [row(GROUP_A, "A1"), row(GROUP_B, "B1"), row(GROUP_C, "C1")];

    const forwards = await fillsOf(rows, palette);
    const backwards = await fillsOf([...rows].reverse(), palette);

    expect(backwards).toEqual([...forwards].reverse());
  });

  it("leaves a Trip in no group unpainted", async () => {
    const palette = combinationPalette(PERIOD);

    const [grouped, standalone] = await fillsOf(
      [row(GROUP_A, "A1"), row(null, "S1")],
      palette,
    );

    expect(grouped).not.toBeNull();
    expect(standalone).toBeNull();
  });
});

describe("an export with no palette given", () => {
  /**
   * The BASIS export run from the Ritten screen always passes the period's
   * palette. A caller that does not — a script, a test, anything without a
   * period — still gets one colour per group, from the group's own id.
   */
  it("falls back to the group-id colour", async () => {
    const [fill] = await fillsOf([row(GROUP_A, "A1")]);
    const withFallback = combinationPalette([]);

    expect(fill).toBe(withFallback.fillArgb(GROUP_A));
    expect(withFallback.indexOf(GROUP_A)).toBe(combinationColorIndex(GROUP_A));
  });

  it("still keeps one colour per group", async () => {
    const fills = await fillsOf([
      row(GROUP_A, "A1"),
      row(GROUP_B, "B1"),
      row(GROUP_A, "A2"),
    ]);

    expect(fills[0]).toBe(fills[2]);
  });
});
