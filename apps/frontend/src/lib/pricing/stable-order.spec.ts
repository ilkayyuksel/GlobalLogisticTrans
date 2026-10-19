import { inPreviousOrder } from "./stable-order";

const records = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: readonly { id: string }[]) => list.map((record) => record.id);

describe("inPreviousOrder", () => {
  it("keeps the order the screen showed, whatever order the list arrives in", () => {
    expect(ids(inPreviousOrder(records("b", "c", "a"), ["a", "b", "c"]))).toEqual(["a", "b", "c"]);
  });

  it("drops a record the list no longer holds", () => {
    expect(ids(inPreviousOrder(records("c", "a"), ["a", "b", "c"]))).toEqual(["a", "c"]);
  });

  /** An imported route lands beside its alphabetical neighbour, not at the end. */
  it("places a new record after the one that precedes it in the list", () => {
    expect(ids(inPreviousOrder(records("a", "b", "new", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b", "new"]);
  });

  it("places a new first record first", () => {
    expect(ids(inPreviousOrder(records("new", "a", "b"), ["b", "a"]))).toEqual(["new", "b", "a"]);
  });

  it("keeps several new records in the list's own order", () => {
    expect(ids(inPreviousOrder(records("a", "x", "y", "b"), ["b", "a"]))).toEqual(["b", "a", "x", "y"]);
  });
});
