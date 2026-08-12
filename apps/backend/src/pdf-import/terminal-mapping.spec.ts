import {
  TERMINAL_NAME_BY_DOCUMENT_TEXT,
  resolveTerminalName,
} from "./terminal-mapping";

/**
 * The behaviour proved here must survive the mapping being filled in, so no
 * test asserts what the shipped table contains — only how an unknown terminal
 * behaves, and that a configured one is used verbatim.
 */
describe("resolveTerminalName", () => {
  it("returns null for a terminal the mapping does not know", () => {
    expect(resolveTerminalName("Some Unmapped Quay", {})).toBeNull();
  });

  it("never falls back to the printed text", () => {
    expect(resolveTerminalName("Quay 869", {})).not.toBe("Quay 869");
  });

  it("returns the configured name for a mapped terminal", () => {
    const mapping = { "Test Quay 1": "Test Terminal One" };

    expect(resolveTerminalName("Test Quay 1", mapping)).toBe(
      "Test Terminal One",
    );
  });

  it("matches exactly, so a near-miss is unknown rather than guessed", () => {
    const mapping = { "Test Quay 1": "Test Terminal One" };

    expect(resolveTerminalName("Test Quay 10", mapping)).toBeNull();
    expect(resolveTerminalName("test quay 1", mapping)).toBeNull();
    expect(resolveTerminalName("Test Quay", mapping)).toBeNull();
  });

  it("does not resolve inherited object properties as terminals", () => {
    // Without an own-property guard a document printing "constructor" would
    // resolve to a function. Object.create(null) is not used, so this proves
    // the lookup cannot be steered by a value coming from outside.
    expect(resolveTerminalName("constructor", {})).toBeNull();
    expect(resolveTerminalName("toString", {})).toBeNull();
  });

  it("resolves nothing at all while the shipped mapping is empty", () => {
    // Deliberate: the real terminal pairs are not known, and guessing one would
    // price a Trip against the wrong route. An empty mapping refuses loudly.
    expect(Object.keys(TERMINAL_NAME_BY_DOCUMENT_TEXT)).toHaveLength(0);
    expect(resolveTerminalName("PSA Quay 869")).toBeNull();
  });
});
