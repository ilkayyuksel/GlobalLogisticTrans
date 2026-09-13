import {
  hourBlocks,
  hourLabel,
  layOutAgendaDay,
  toAgendaWindow,
  widestCluster,
  windowAround,
  type AgendaBlock,
} from "./agenda-layout";

const DAY = { startMinute: 6 * 60, endMinute: 23 * 60 };

function item(id: string, startTime: string, endTime: string) {
  return { id, startTime: `${startTime}:00`, endTime: `${endTime}:00` };
}

type Item = ReturnType<typeof item>;

/** Column, span and column count of every block, by id — what the eye sees. */
function columns(blocks: AgendaBlock<Item>[]) {
  return Object.fromEntries(
    blocks.map((block) => [
      block.item.id,
      [block.column, block.columnSpan, block.columnCount],
    ]),
  );
}

describe("the Agenda's day window", () => {
  it("comes from the backend's range", () => {
    expect(toAgendaWindow("06:00", "23:00")).toEqual(DAY);
    expect(toAgendaWindow("23:00", "06:00")).toBeNull();
    expect(toAgendaWindow("", "23:00")).toBeNull();
  });

  it("has hour blocks from 06:00 to 22:00, the last ending at 23:00", () => {
    const hours = hourBlocks(DAY);

    expect(hours[0]).toBe(6);
    expect(hours[hours.length - 1]).toBe(22);
    expect(hours).toHaveLength(17);
    expect(hourLabel(6)).toBe("06:00");
    expect(hourLabel(23)).toBe("23:00");
  });
});

describe("placing items in time", () => {
  it("draws 10:00–11:00 one hour tall, at ten o'clock", () => {
    const [block] = layOutAgendaDay([item("a", "10:00", "11:00")], DAY);

    expect(block.topPercent).toBeCloseTo((4 * 60 * 100) / (17 * 60), 5);
    expect(block.heightPercent).toBeCloseTo(100 / 17, 5);
  });

  it("makes a longer item proportionally taller", () => {
    const [short, long] = layOutAgendaDay(
      [item("a", "09:00", "09:30"), item("b", "12:00", "15:00")],
      DAY,
    );

    expect(long.heightPercent).toBeCloseTo(short.heightPercent * 6, 5);
  });

  it("clamps an item reaching outside the window", () => {
    const [block] = layOutAgendaDay([item("a", "05:00", "07:00")], DAY);

    expect(block.topPercent).toBe(0);
    expect(block.heightPercent).toBeCloseTo(100 / 17, 5);
  });

  it("leaves out an item whose times cannot be read", () => {
    expect(
      layOutAgendaDay([{ id: "x", startTime: "", endTime: "11:00:00" }], DAY),
    ).toEqual([]);
  });
});

/**
 * ── OVERLAP ─────────────────────────────────────────────────────────────────
 * [column, span, columnCount] per item. Every overlapping item must have a
 * column of its own; nothing may sit on top of anything else.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe("overlapping items", () => {
  it("gives one item the whole width", () => {
    expect(columns(layOutAgendaDay([item("a", "10:00", "11:00")], DAY))).toEqual({
      a: [0, 1, 1],
    });
  });

  it("puts two overlapping items side by side", () => {
    const blocks = layOutAgendaDay(
      [item("a", "10:00", "11:00"), item("b", "10:30", "12:00")],
      DAY,
    );

    expect(columns(blocks)).toEqual({ a: [0, 1, 2], b: [1, 1, 2] });
  });

  it("puts two items at exactly the same time side by side", () => {
    const blocks = layOutAgendaDay(
      [item("meeting", "09:00", "10:00"), item("phone", "09:00", "10:00")],
      DAY,
    );

    expect(columns(blocks)).toEqual({ meeting: [0, 1, 2], phone: [1, 1, 2] });
  });

  it("divides the width in three for three overlapping items", () => {
    const blocks = layOutAgendaDay(
      [
        item("a", "09:00", "10:00"),
        item("b", "09:15", "10:00"),
        item("c", "09:30", "11:00"),
      ],
      DAY,
    );

    expect(columns(blocks)).toEqual({
      a: [0, 1, 3],
      b: [1, 1, 3],
      c: [2, 1, 3],
    });
  });

  /** A overlaps B, B overlaps C, A and C do not: C reuses A's column. */
  it("reuses a column once its item has ended (partial overlap)", () => {
    const blocks = layOutAgendaDay(
      [
        item("a", "09:00", "10:00"),
        item("b", "09:30", "10:30"),
        item("c", "10:00", "11:00"),
      ],
      DAY,
    );

    expect(columns(blocks)).toEqual({
      a: [0, 1, 2],
      b: [1, 1, 2],
      c: [0, 1, 2],
    });
  });

  it("keeps an item inside a longer one beside it (full overlap)", () => {
    const blocks = layOutAgendaDay(
      [item("a", "09:00", "11:30"), item("b", "10:00", "11:00")],
      DAY,
    );

    expect(columns(blocks)).toEqual({ a: [0, 1, 2], b: [1, 1, 2] });
  });

  /** Half-open: 10:00–11:00 and 11:00–12:00 touch but do not overlap. */
  it("gives items that meet exactly the whole width each", () => {
    const blocks = layOutAgendaDay(
      [item("a", "10:00", "11:00"), item("b", "11:00", "12:00")],
      DAY,
    );

    expect(columns(blocks)).toEqual({ a: [0, 1, 1], b: [0, 1, 1] });
  });

  /** Different lengths: the late short item widens into the column the early one left. */
  it("widens an item into a free column to its right", () => {
    const blocks = layOutAgendaDay(
      [
        item("long", "09:00", "12:00"),
        item("early1", "09:00", "10:00"),
        item("early2", "09:00", "10:00"),
        item("late", "11:00", "12:00"),
      ],
      DAY,
    );

    expect(columns(blocks)).toEqual({
      long: [0, 1, 3],
      early1: [1, 1, 3],
      early2: [2, 1, 3],
      late: [1, 2, 3],
    });
  });

  it("never lets two overlapping items share a column", () => {
    const blocks = layOutAgendaDay(
      [
        item("a", "08:00", "12:00"),
        item("b", "08:30", "09:30"),
        item("c", "09:00", "10:00"),
        item("d", "09:45", "11:15"),
        item("e", "10:30", "11:00"),
      ],
      DAY,
    );

    for (const left of blocks) {
      for (const right of blocks) {
        const sameTime =
          left.range.startMinute < right.range.endMinute &&
          right.range.startMinute < left.range.endMinute;
        const leftColumns = [left.column, left.column + left.columnSpan - 1];
        const rightColumns = [right.column, right.column + right.columnSpan - 1];
        const shareColumn =
          leftColumns[0] <= rightColumns[1] && rightColumns[0] <= leftColumns[1];

        if (left !== right && sameTime) {
          expect(shareColumn).toBe(false);
        }
      }
    }
  });

  it("does not depend on the order the items arrive in", () => {
    const forwards = layOutAgendaDay(
      [item("a", "09:00", "10:00"), item("b", "09:30", "11:00")],
      DAY,
    );
    const backwards = layOutAgendaDay(
      [item("b", "09:30", "11:00"), item("a", "09:00", "10:00")],
      DAY,
    );

    expect(columns(forwards)).toEqual(columns(backwards));
  });

  it("reports the widest cluster, for the minimum width of the day", () => {
    const blocks = layOutAgendaDay(
      [
        item("a", "09:00", "10:00"),
        item("b", "09:00", "10:00"),
        item("c", "09:00", "10:00"),
        item("d", "14:00", "15:00"),
      ],
      DAY,
    );

    expect(widestCluster(blocks)).toBe(3);
    expect(widestCluster([])).toBe(1);
  });
});

describe("a compact window", () => {
  it("runs from the first item's hour to the last item's end, rounded out", () => {
    expect(
      windowAround([item("a", "09:30", "10:00"), item("b", "13:00", "14:15")], DAY),
    ).toEqual({ startMinute: 9 * 60, endMinute: 15 * 60 });
  });

  it("stays inside the day", () => {
    expect(windowAround([item("a", "22:00", "23:00")], DAY)).toEqual({
      startMinute: 22 * 60,
      endMinute: 23 * 60,
    });
  });

  it("is nothing when there is nothing to show", () => {
    expect(windowAround([], DAY)).toBeNull();
  });
});
