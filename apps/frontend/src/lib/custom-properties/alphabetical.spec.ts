import { sortAlphabetically } from "./alphabetical";

interface Named {
  id: string;
  name: string;
}

function namesIn(language: "nl" | "tr", names: readonly string[]): string[] {
  const items: Named[] = names.map((name, index) => ({ id: `id-${index}`, name }));

  return sortAlphabetically(items, (item) => item.name, (item) => item.id, language).map(
    (item) => item.name,
  );
}

describe("Custom Values in alphabetical order", () => {
  it("C. ignores letter case", () => {
    expect(namesIn("nl", ["zone", "Apart", "extra", "Brug"])).toEqual([
      "Apart",
      "Brug",
      "extra",
      "zone",
    ]);
  });

  it("D. files an accented letter with its letter in Dutch", () => {
    expect(namesIn("nl", ["Extra", "Éénmalig", "Echo", "Ëxport"])).toEqual([
      "Echo",
      "Éénmalig",
      // "export" before "extra": the accent does not move the word.
      "Ëxport",
      "Extra",
    ]);
  });

  it("D. follows the Turkish alphabet in Turkish", () => {
    expect(namesIn("tr", ["Şarj", "Sabit", "Çift", "Cadde", "inek", "ılık"])).toEqual([
      "Cadde",
      "Çift",
      "ılık",
      "inek",
      "Sabit",
      "Şarj",
    ]);
  });

  it("counts numbers as numbers", () => {
    expect(namesIn("nl", ["Wacht 10", "Wacht 2", "Wacht 1"])).toEqual([
      "Wacht 1",
      "Wacht 2",
      "Wacht 10",
    ]);
  });

  it("orders names that differ only in case the same way every time", () => {
    const once = namesIn("nl", ["tar", "TAR", "Tar"]);

    expect(namesIn("nl", ["Tar", "TAR", "tar"])).toEqual(once);
  });

  it("H. returns a sorted copy and leaves the values as they were", () => {
    const items: Named[] = [
      { id: "b", name: "Zone" },
      { id: "a", name: "Apart" },
    ];

    const sorted = sortAlphabetically(items, (item) => item.name, (item) => item.id, "nl");

    expect(sorted.map((item) => item.id)).toEqual(["a", "b"]);
    expect(items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(sorted[0]).toBe(items[1]);
  });
});
