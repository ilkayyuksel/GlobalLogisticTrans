import type { Trip } from "@/lib/api/types";
import { buildSections } from "./sections";

/**
 * Arranging Trips into the date sections a Ritten view shows.
 *
 * The case these tests exist for is the Trip with NO planning date, which a
 * manually created Trip may have. It belongs to no day, and the one thing the
 * grouping must not do is invent one for it: placing it on today, or on the
 * anchor, would be a scheduling decision nobody made — and it would then look
 * planned.
 */
function tripOn(planningDate: string | null, id = planningDate ?? "none"): Trip {
  return { id, planningDate } as Trip;
}

describe("buildSections", () => {
  describe("a Trip with no planning date", () => {
    it("gets its own section rather than a day", () => {
      const sections = buildSections("day", "2026-08-13", [tripOn(null)]);
      const unscheduled = sections.find((section) => section.date === null);

      expect(unscheduled).toBeDefined();
      expect(unscheduled?.trips).toHaveLength(1);
    });

    it("is never placed on the anchor day", () => {
      const sections = buildSections("day", "2026-08-13", [tripOn(null)]);
      const anchorDay = sections.find(
        (section) => section.date === "2026-08-13",
      );

      expect(anchorDay?.trips ?? []).toHaveLength(0);
    });

    /** The days are the plan; what is not in it yet reads after it. */
    it("comes last, after every dated section", () => {
      const sections = buildSections("week", "2026-08-13", [
        tripOn(null),
        tripOn("2026-08-13"),
      ]);

      expect(sections.at(-1)?.date).toBeNull();
    });

    it("collects several of them together", () => {
      const sections = buildSections("day", "2026-08-13", [
        tripOn(null, "a"),
        tripOn(null, "b"),
        tripOn("2026-08-13", "c"),
      ]);

      const unscheduled = sections.find((section) => section.date === null);

      expect(unscheduled?.trips.map((trip) => trip.id)).toEqual(["a", "b"]);
    });

    it("adds no section when every Trip has a date", () => {
      const sections = buildSections("day", "2026-08-13", [
        tripOn("2026-08-13"),
      ]);

      expect(sections.every((section) => section.date !== null)).toBe(true);
    });
  });

  describe("the dated sections", () => {
    it("keeps all seven days of a week, empty ones included", () => {
      const sections = buildSections("week", "2026-08-13", []);

      expect(sections).toHaveLength(7);
    });

    it("still keeps the seven days when an undated Trip is present", () => {
      const sections = buildSections("week", "2026-08-13", [tripOn(null)]);

      expect(sections.filter((section) => section.date !== null)).toHaveLength(7);
    });

    it("orders the days chronologically", () => {
      const sections = buildSections("month", "2026-08-13", [
        tripOn("2026-08-20"),
        tripOn("2026-08-05"),
      ]);

      const dates = sections
        .map((section) => section.date)
        .filter((date): date is string => date !== null);

      expect(dates).toEqual([...dates].sort());
    });
  });
});
