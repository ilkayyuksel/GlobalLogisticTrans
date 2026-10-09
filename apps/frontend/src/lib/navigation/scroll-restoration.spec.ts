import { beginPageLoad } from "./page-loads";
import {
  NavigationDriver,
  addScrollContainer,
  installViewport,
  nextFrame,
  setContentSize,
  userScrollsContainer,
  userScrollsTo,
} from "@/test/scroll-harness";

/**
 * App-wide scroll restoration, against the real History API.
 *
 * The contract, in the terms the specification states it:
 *
 *   Back / Forward     the position the entry was left at, exactly
 *   a new navigation   the top — the router's behaviour, untouched
 *   a refetch, a state update, a deletion: nothing moves
 *   content still loading: no position is forced onto a placeholder; it is
 *   applied once the rows exist, or as close as a shorter list allows
 */

const LONG_LIST = { height: 12_000 };

let driver: NavigationDriver;

beforeEach(() => {
  installViewport();
  driver = new NavigationDriver().start("/trips");
});

afterEach(() => {
  driver.dispose();
});

describe("Back and Forward return to the exact position", () => {
  it("A. list → detail → Back restores scrollTop exactly", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);

    driver.push("/trips/trip-1");
    await nextFrame();
    expect(window.scrollY).toBe(0);

    await driver.back(LONG_LIST);

    expect(window.scrollY).toBe(3847);
  });

  it("B. restores scrollLeft with scrollTop", async () => {
    setContentSize({ ...LONG_LIST, width: 3000 });
    await userScrollsTo(3847, 125);

    driver.push("/trips/trip-1");
    await nextFrame();
    await driver.back({ ...LONG_LIST, width: 3000 });

    expect(window.scrollY).toBe(3847);
    expect(window.scrollX).toBe(125);
  });

  it("C. Forward restores the forward entry's own position", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);
    driver.push("/trips/trip-1", LONG_LIST);
    await userScrollsTo(612);

    await driver.back(LONG_LIST);
    expect(window.scrollY).toBe(3847);

    await driver.forward(LONG_LIST);
    expect(window.scrollY).toBe(612);
  });

  it("H. a long list of many rows comes back deep down, not near it", async () => {
    // 300 rows of 40px: the position is far past anything a loading page holds.
    setContentSize({ height: 300 * 40 });
    await userScrollsTo(11_037);

    driver.push("/trips/trip-299");
    await nextFrame();
    await driver.back({ height: 300 * 40 });

    expect(window.scrollY).toBe(11_037);
  });

  it("K. two pages keep independent positions", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);
    driver.push("/settings/pricing", LONG_LIST);
    await userScrollsTo(1200);
    driver.push("/maintenance/m-1");
    await nextFrame();

    await driver.back(LONG_LIST);
    expect(window.location.pathname).toBe("/settings/pricing");
    expect(window.scrollY).toBe(1200);

    await driver.back(LONG_LIST);
    expect(window.location.pathname).toBe("/trips");
    expect(window.scrollY).toBe(3847);
  });

  it("L. survives going back and forth several times", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);
    driver.push("/trips/trip-1", LONG_LIST);
    await userScrollsTo(500);

    for (let round = 0; round < 3; round += 1) {
      await driver.back(LONG_LIST);
      expect(window.scrollY).toBe(3847);
      await driver.forward(LONG_LIST);
      expect(window.scrollY).toBe(500);
    }
  });

  it("a new navigation to a page visited before starts at the top", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);
    driver.push("/trips/trip-1");
    await nextFrame();

    // A menu click on "Ritten": a new entry, not a return.
    driver.push("/trips", LONG_LIST);
    await nextFrame();

    expect(window.scrollY).toBe(0);
  });
});

describe("content that is still loading", () => {
  it("I. waits for the rows instead of forcing the position onto a placeholder", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);
    driver.push("/trips/trip-1");
    await nextFrame();

    const loaded = beginPageLoad();
    // The list comes back showing "Laden…": one screen tall.
    await driver.back({ height: 900 });
    await nextFrame();
    expect(window.scrollY).toBeLessThan(3847);

    // The rows are drawn, then the load reports its render committed.
    setContentSize(LONG_LIST);
    expect(window.scrollY).toBe(3847);
    loaded();

    expect(window.scrollY).toBe(3847);
  });

  it("does not overwrite the remembered position while waiting", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);
    driver.push("/trips/trip-1");
    await nextFrame();

    const loaded = beginPageLoad();
    await driver.back({ height: 900 });
    await nextFrame();
    await nextFrame();
    setContentSize(LONG_LIST);
    loaded();

    driver.push("/trips/trip-2");
    await nextFrame();
    await driver.back(LONG_LIST);

    expect(window.scrollY).toBe(3847);
  });

  it("J. a list that got shorter returns to the nearest point, never the top", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);
    driver.push("/trips/trip-1");
    await nextFrame();

    const loaded = beginPageLoad();
    await driver.back({ height: 900 });
    // Rows were deleted meanwhile: the list now ends at 3,000px.
    setContentSize({ height: 3000 });
    loaded();

    expect(window.scrollY).toBe(3000 - window.innerHeight);
  });

  it("stops restoring the moment the user scrolls first", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3847);
    driver.push("/trips/trip-1");
    await nextFrame();

    const loaded = beginPageLoad();
    await driver.back({ height: 900 });
    window.dispatchEvent(new Event("wheel"));
    setContentSize(LONG_LIST);
    loaded();

    expect(window.scrollY).not.toBe(3847);
  });
});

describe("what is not a navigation moves nothing", () => {
  it("E. a refetch on the page leaves the scroll where it is", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3000);
    const scrollTo = jest.spyOn(window, "scrollTo");

    const refetched = beginPageLoad();
    refetched();
    await nextFrame();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(3000);
  });

  it("F. state updates and DOM changes on the page leave the scroll alone", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(3000);
    const scrollTo = jest.spyOn(window, "scrollTo");

    // A checkbox, an inline edit, a deleted row: the DOM changes in place.
    document.body.appendChild(document.createElement("tr"));
    document.body.lastElementChild?.remove();
    await nextFrame();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(3000);
  });
});

describe("M. a page's own scroll container", () => {
  const ID = "ritten-table:2026-10-04";
  const TABLE = { height: 400, width: 3000 };
  const CLIENT = { height: 400, width: 1200 };

  it("returns to its sideways position along with the page", async () => {
    setContentSize(LONG_LIST);
    const table = addScrollContainer(ID, TABLE, CLIENT);
    await userScrollsContainer(table, 0, 900);
    await userScrollsTo(2000);

    driver.push("/trips/trip-1");
    table.remove();
    await nextFrame();

    const loaded = beginPageLoad();
    await driver.back({ height: 900 });
    // The table is drawn once its rows arrive.
    setContentSize(LONG_LIST);
    const redrawn = addScrollContainer(ID, TABLE, CLIENT);
    loaded();

    expect(redrawn.scrollLeft).toBe(900);
    expect(window.scrollY).toBe(2000);
  });

  it("ignores scrollers that did not declare themselves", async () => {
    const dialogBody = document.createElement("div");
    document.body.appendChild(dialogBody);
    setContentSize(LONG_LIST);
    await userScrollsTo(1000);

    dialogBody.dispatchEvent(new Event("scroll"));
    await nextFrame();
    driver.push("/trips/trip-1");
    await nextFrame();
    await driver.back(LONG_LIST);

    expect(window.scrollY).toBe(1000);
  });
});

describe("the entry's identity", () => {
  it("keeps its key when the router rewrites the entry's state", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(2500);

    // The router replaces the state of the same entry, without our key.
    window.history.replaceState({ __NA: true }, "", window.location.href);
    await userScrollsTo(2600);

    driver.push("/trips/trip-1");
    await nextFrame();
    await driver.back(LONG_LIST);

    expect(window.scrollY).toBe(2600);
  });

  it("keeps the router's own field when stamping, so Back never reloads", () => {
    expect((window.history.state as { __NA?: boolean }).__NA).toBe(true);
  });

  it("persists positions for the tab when the page is left", async () => {
    setContentSize(LONG_LIST);
    await userScrollsTo(1234);
    window.dispatchEvent(new Event("pagehide"));

    const stored = window.sessionStorage.getItem("tms.navigation.entries");
    expect(stored).toContain('"top":1234');
  });
});
