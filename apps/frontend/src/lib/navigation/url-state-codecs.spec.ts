import { MAX_REMEMBERED_ENTRIES, readEntry, resetEntryStore, writeEntry } from "./entry-store";
import {
  choiceParam,
  dateParam,
  flagParam,
  objectParams,
  pageParam,
  textParam,
} from "./url-state-codecs";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

function written<T>(codec: { write(value: T, params: URLSearchParams): void }, value: T) {
  const target = new URLSearchParams();
  codec.write(value, target);

  return target.toString();
}

describe("view-state codecs", () => {
  it("reads every malformed value as the default, so an old link still opens", () => {
    expect(choiceParam("view", ["day", "week"], "day").read(params("view=year"))).toBe("day");
    expect(pageParam().read(params("page=-2"))).toBe(1);
    expect(pageParam().read(params("page=2.5"))).toBe(1);
    expect(flagParam("prices", false).read(params("prices=yes"))).toBe(false);
    expect(dateParam("date", () => "2026-10-09").read(params("date=04/10"))).toBe("2026-10-09");
  });

  it("writes a default as no parameter at all", () => {
    expect(written(choiceParam("view", ["day", "week"], "day"), "day")).toBe("");
    expect(written(pageParam(), 1)).toBe("");
    expect(written(textParam("search"), "")).toBe("");
    expect(written(flagParam("routes", true), true)).toBe("");
    expect(written(dateParam("date", () => "2026-10-09"), "2026-10-09")).toBe("");
  });

  it("round-trips a chosen value", () => {
    const codec = objectParams({
      view: choiceParam("view", ["day", "week"] as const, "day"),
      page: pageParam(),
      prices: flagParam("prices", false),
      routes: flagParam("routes", true),
      date: dateParam("date", () => "2026-10-09"),
    });
    const value = { view: "week" as const, page: 4, prices: true, routes: false, date: "2026-10-04" };

    expect(codec.read(params(written(codec, value)))).toEqual(value);
  });
});

describe("the remembered entries", () => {
  afterEach(() => resetEntryStore());

  it("keeps only the most recently used entries", () => {
    for (let index = 0; index <= MAX_REMEMBERED_ENTRIES; index += 1) {
      writeEntry(`entry-${index}`, { url: "/trips", openedFromUrl: null, scroll: null });
    }

    expect(readEntry("entry-0")).toBeNull();
    expect(readEntry(`entry-${MAX_REMEMBERED_ENTRIES}`)).not.toBeNull();
  });

  it("counts a revisited entry as recent again", () => {
    writeEntry("entry-kept", { url: "/trips", openedFromUrl: null, scroll: null });

    for (let index = 0; index < MAX_REMEMBERED_ENTRIES; index += 1) {
      writeEntry("entry-kept", { url: "/trips", openedFromUrl: null, scroll: null });
      writeEntry(`entry-${index}`, { url: "/trips", openedFromUrl: null, scroll: null });
    }

    expect(readEntry("entry-kept")).not.toBeNull();
  });
});
