import type { Trip } from "@/lib/api/types";
import {
  COMBINATION_LABEL,
  QUAY_CODE,
  RELEASE_LABEL,
  VOYAGE_LABEL,
  isCombinationLeg,
  toRouteLabels,
} from "./export-route-labels";

/**
 * Startpoint and Endpoint.
 *
 * Two facts decide them and nothing else: the persisted `direction`, as the
 * document stated it, and whether the Trip belongs to a group. These tests
 * exist mostly to pin down what must NEVER happen — a direction inferred from a
 * terminal, a date or a row order, and a manual Trip acquiring a vocabulary
 * nobody claimed for it.
 */
function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    tripGroupId: null,
    direction: null,
    terminal: "Quay 869",
    destinationCity: "Gent",
    planningDate: "2026-06-29",
    bookingNumber: "ANRDUB2602247",
    ...overrides,
  } as Trip;
}

describe("the export vocabulary", () => {
  /**
   * `BEQ869` is an export label. It is not a terminal name, is not stored, and
   * must never become a second name for one — the string a transport order
   * printed IS the terminal.
   */
  it("builds the labels from one quay code", () => {
    expect(VOYAGE_LABEL).toBe(`VOYAGE ${QUAY_CODE}`);
    expect(RELEASE_LABEL).toBe(`RELEASE ${QUAY_CODE}`);
    expect(QUAY_CODE).toBe("BEQ869");
  });

  it("never derives the code from a terminal name", () => {
    const psa = toRouteLabels(
      buildTrip({ direction: "DELIVERY", terminal: "PSA Quay 869" }),
    );
    const plain = toRouteLabels(
      buildTrip({ direction: "DELIVERY", terminal: "Quay 869" }),
    );

    // Two different terminals, the same label: it comes from the rule, not the
    // data.
    expect(psa.startPoint).toBe(plain.startPoint);
    expect(psa.startPoint).toBe(VOYAGE_LABEL);
  });
});

describe("a normal Trip", () => {
  it("sends a DELIVERY out of the quay to its destination", () => {
    expect(toRouteLabels(buildTrip({ direction: "DELIVERY" }))).toEqual({
      startPoint: VOYAGE_LABEL,
      endPoint: "Gent",
    });
  });

  /**
   * An export container is released at the quay and handed over there for its
   * voyage, so both ends name the quay and neither names the customer.
   */
  it("releases a COLLECTION at the quay and hands it over there", () => {
    expect(toRouteLabels(buildTrip({ direction: "COLLECTION" }))).toEqual({
      startPoint: RELEASE_LABEL,
      endPoint: VOYAGE_LABEL,
    });
  });

  it("keeps the destination out of a COLLECTION's two ends", () => {
    const labels = toRouteLabels(
      buildTrip({ direction: "COLLECTION", destinationCity: "Bousbecque" }),
    );

    expect(Object.values(labels)).not.toContain("Bousbecque");
  });

  it("uses neither Combination label", () => {
    for (const direction of ["DELIVERY", "COLLECTION"] as const) {
      const labels = toRouteLabels(buildTrip({ direction }));

      expect(Object.values(labels)).not.toContain(COMBINATION_LABEL);
    }
  });
});

describe("a genuine Combination", () => {
  const GROUP = "97777777-7777-4777-8777-777777777777";

  /**
   * The two legs are one truck movement: out of the quay with an import
   * container, and back to the quay with an export one. They meet in the
   * middle, which is what COMBINATION names.
   */
  it("ends the DELIVERY leg at the join", () => {
    expect(
      toRouteLabels(buildTrip({ direction: "DELIVERY", tripGroupId: GROUP })),
    ).toEqual({ startPoint: VOYAGE_LABEL, endPoint: COMBINATION_LABEL });
  });

  it("starts the COLLECTION leg at the join", () => {
    expect(
      toRouteLabels(buildTrip({ direction: "COLLECTION", tripGroupId: GROUP })),
    ).toEqual({ startPoint: COMBINATION_LABEL, endPoint: VOYAGE_LABEL });
  });

  /**
   * The join replaces only the OUTER end each leg would otherwise have. A
   * Combination collection still ends at the voyage, exactly as a normal one
   * does — being paired changes where a leg begins, not where it delivers.
   */
  it("changes only the leg's outer end, never its quay end", () => {
    const paired = toRouteLabels(
      buildTrip({ direction: "COLLECTION", tripGroupId: GROUP }),
    );
    const alone = toRouteLabels(buildTrip({ direction: "COLLECTION" }));

    expect(paired.endPoint).toBe(alone.endPoint);
    expect(paired.startPoint).not.toBe(alone.startPoint);
  });

  it("chains: the delivery ends where the collection starts", () => {
    const delivery = toRouteLabels(
      buildTrip({ direction: "DELIVERY", tripGroupId: GROUP }),
    );
    const collection = toRouteLabels(
      buildTrip({ direction: "COLLECTION", tripGroupId: GROUP }),
    );

    expect(delivery.endPoint).toBe(collection.startPoint);
  });

  it("keeps the quay at the outer ends", () => {
    const delivery = toRouteLabels(
      buildTrip({ direction: "DELIVERY", tripGroupId: GROUP }),
    );
    const collection = toRouteLabels(
      buildTrip({ direction: "COLLECTION", tripGroupId: GROUP }),
    );

    expect(delivery.startPoint).toBe(VOYAGE_LABEL);
    expect(collection.endPoint).toBe(VOYAGE_LABEL);
  });
});

/**
 * The rows the operator's own sheet shows, reproduced here so the rules stay
 * pinned to the sheet they came from rather than to a paraphrase of it.
 */
describe("the rows on the operator's sheet", () => {
  it.each([
    ["ZEEBRUGGE", "LOCATION BEQ869"],
    ["LESSINES", "LOCATION BEBAXLES"],
  ])("ends a delivery to %s at %s", (city, endPoint) => {
    expect(
      toRouteLabels(buildTrip({ direction: "DELIVERY", destinationCity: city })),
    ).toEqual({ startPoint: VOYAGE_LABEL, endPoint });
  });

  /**
   * Zeebrugge's code happens to equal the quay's own. That is a coincidence of
   * the operator's list, not a derivation — so a delivery there must still
   * start at the voyage and end at a LOCATION, never collapse into one label.
   */
  it("keeps a delivery's two ends distinct even when the codes collide", () => {
    const labels = toRouteLabels(
      buildTrip({ direction: "DELIVERY", destinationCity: "ZEEBRUGGE" }),
    );

    expect(labels.startPoint).toBe("VOYAGE BEQ869");
    expect(labels.endPoint).toBe("LOCATION BEQ869");
  });

  it("shows the stored city for a destination with no configured code", () => {
    expect(
      toRouteLabels(
        buildTrip({ direction: "DELIVERY", destinationCity: "Grobbendonk" }),
      ),
    ).toEqual({ startPoint: VOYAGE_LABEL, endPoint: "Grobbendonk" });
  });

  /**
   * The code belongs to the DESTINATION of a delivery and to nothing else. A
   * collection to the same city keeps the quay vocabulary at both ends.
   */
  it("never gives a collection a location code", () => {
    const labels = toRouteLabels(
      buildTrip({ direction: "COLLECTION", destinationCity: "LESSINES" }),
    );

    expect(labels).toEqual({
      startPoint: RELEASE_LABEL,
      endPoint: VOYAGE_LABEL,
    });
  });

  it("never gives a Combination leg a location code", () => {
    const labels = toRouteLabels(
      buildTrip({
        direction: "DELIVERY",
        destinationCity: "LESSINES",
        tripGroupId: "97777777-7777-4777-8777-777777777777",
      }),
    );

    expect(labels.endPoint).toBe(COMBINATION_LABEL);
  });

  it("never gives a directionless Trip a location code", () => {
    const labels = toRouteLabels(
      buildTrip({ direction: null, destinationCity: "LESSINES" }),
    );

    expect(labels).toEqual({ startPoint: "Quay 869", endPoint: "LESSINES" });
  });
});

describe("a manual group", () => {
  const GROUP = "88888888-8888-4888-8888-888888888888";

  /**
   * An operator can put any Trips into a group as a convenience, and that
   * group claims nothing about pairing or direction. Only a document's own
   * structure produces Combination labels.
   */
  it("does not turn a directionless Trip into a Combination leg", () => {
    const trip = buildTrip({ tripGroupId: GROUP, direction: null });

    expect(isCombinationLeg(trip)).toBe(false);
    expect(Object.values(toRouteLabels(trip))).not.toContain(COMBINATION_LABEL);
  });
});

describe("a Trip whose direction nobody stated", () => {
  /**
   * A manual Trip, or one imported before the direction was recorded. It gets
   * the plain stored route — inventing VOYAGE, RELEASE or COMBINATION would
   * state something no document said.
   */
  it("shows the stored terminal and destination", () => {
    expect(toRouteLabels(buildTrip({ direction: null }))).toEqual({
      startPoint: "Quay 869",
      endPoint: "Gent",
    });
  });

  it("invents no vocabulary", () => {
    const labels = toRouteLabels(buildTrip({ direction: null }));

    for (const value of Object.values(labels)) {
      expect(value).not.toMatch(/VOYAGE|RELEASE|COMBINATION|BEQ/);
    }
  });

  it("is empty where the Trip itself is empty", () => {
    expect(
      toRouteLabels(
        buildTrip({ direction: null, terminal: null, destinationCity: null }),
      ),
    ).toEqual({ startPoint: "", endPoint: "" });
  });
});

describe("what must never decide a direction", () => {
  const GROUP = "97777777-7777-4777-8777-777777777777";

  it.each([
    ["a terminal", { terminal: "PSA Quay 869" }],
    ["a destination", { destinationCity: "Warneton" }],
    ["a planning date", { planningDate: "2026-01-01" }],
    ["a booking number", { bookingNumber: "ZZZ-9999" }],
  ])("ignores %s", (_what, overrides) => {
    const delivery = toRouteLabels(
      buildTrip({ direction: "DELIVERY", tripGroupId: GROUP, ...overrides }),
    );

    // Whatever else changes, the labels follow the stored direction.
    expect(delivery.startPoint).toBe(VOYAGE_LABEL);
    expect(delivery.endPoint).toBe(COMBINATION_LABEL);
  });

  it("gives two Trips in the same group different labels by direction alone", () => {
    const first = buildTrip({ direction: "DELIVERY", tripGroupId: GROUP });
    const second = buildTrip({ direction: "COLLECTION", tripGroupId: GROUP });

    expect(toRouteLabels(first)).not.toEqual(toRouteLabels(second));
  });
});
