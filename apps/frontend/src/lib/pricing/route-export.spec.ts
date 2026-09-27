import type {
  CombinationRouteConfiguration,
  RouteConfiguration,
} from "@/lib/api/route-configuration";

import {
  routeConfigurationFileName,
  toRouteConfigurationBlob,
  toRouteConfigurationDocument,
  toRouteConfigurationJson,
} from "./route-export";

/**
 * The route price configuration, as a file.
 *
 * ── WHAT THE FILE IS FOR ────────────────────────────────────────────────────
 * A backup you can hand straight back to Bulk toevoegen. That is the whole
 * measure of it: not that it is valid JSON, but that the importer reads it and
 * the same routes come back. These tests therefore check the field names against
 * the import's own DTO shape, and check that nothing internal rides along.
 * ────────────────────────────────────────────────────────────────────────────
 */

function route(overrides: Partial<RouteConfiguration> = {}): RouteConfiguration {
  return {
    id: "route-1",
    departure: "Quay 869",
    destination: "Dourges",
    tarief: "520.50",
    kilometres: "310.25",
    tunnel: "0.00",
    hasTunnel: true,
    type: "NORMAL",
    combinationGroupId: null,
    // Administrative progress, deliberately NOT part of the export.
    reviewed: true,
    ...overrides,
  };
}

function combination(
  id: string,
  legs: [Partial<RouteConfiguration>, Partial<RouteConfiguration>],
): CombinationRouteConfiguration {
  return {
    id,
    reviewed: true,
    legs: legs.map((leg, index) =>
      route({
        id: `${id}-leg-${index + 1}`,
        type: "COMBINATION",
        combinationGroupId: id,
        ...leg,
      }),
    ),
  };
}

const ANTWERP_KALLO = combination("group-1", [
  {
    departure: "Antwerp",
    destination: "Kallo",
    tarief: "100.00",
    kilometres: "25.00",
    tunnel: "0.00",
  },
  {
    departure: "Kallo",
    destination: "Antwerp",
    tarief: "80.00",
    kilometres: "30.00",
    tunnel: "15.00",
  },
]);

describe("the exported document", () => {
  it("carries an ordinary route with the importer's own field names", () => {
    const document = toRouteConfigurationDocument([route()], []);

    expect(document.routes[0]).toEqual({
      type: "NORMAL",
      departure: "Quay 869",
      destination: "Dourges",
      tarief: 520.5,
      kilometres: 310.25,
      tunnel: 0,
    });
  });

  it("carries a Combination as one entry with two legs", () => {
    const document = toRouteConfigurationDocument([], [ANTWERP_KALLO]);

    expect(document.routes[0]).toEqual({
      type: "COMBINATION",
      legs: [
        {
          departure: "Antwerp",
          destination: "Kallo",
          tarief: 100,
          kilometres: 25,
          tunnel: 0,
        },
        {
          departure: "Kallo",
          destination: "Antwerp",
          tarief: 80,
          kilometres: 30,
          tunnel: 15,
        },
      ],
    });
  });

  it("keeps each leg's own amounts", () => {
    const [entry] = toRouteConfigurationDocument([], [ANTWERP_KALLO]).routes;
    const legs = (entry as unknown as { legs: { tarief: number }[] }).legs;

    expect(legs.map((leg) => leg.tarief)).toEqual([100, 80]);
  });

  it("keeps the outbound leg first", () => {
    const [entry] = toRouteConfigurationDocument([], [ANTWERP_KALLO]).routes;
    const legs = (entry as unknown as { legs: { departure: string }[] }).legs;

    expect(legs[0].departure).toBe("Antwerp");
  });

  /*
   * ── AMOUNTS GO OUT AS NUMBERS ─────────────────────────────────────────────
   * The API carries money as exact decimal text so nothing rounds in transit;
   * the importer takes numbers, as every amount does on the way in. `"100.00"`
   * is therefore `100`, and a file full of quoted amounts would be refused by
   * the very importer this file exists for.
   */
  it("writes amounts as numbers rather than as text", () => {
    const [entry] = toRouteConfigurationDocument([route()], []).routes;

    expect(typeof (entry as { tarief: unknown }).tarief).toBe("number");
    expect(typeof (entry as { kilometres: unknown }).kilometres).toBe("number");
    expect(typeof (entry as { tunnel: unknown }).tunnel).toBe("number");
  });

  /** A road nobody has measured is charged no toll, and the file says so. */
  it("writes an unmeasured road as null rather than as zero", () => {
    const [entry] = toRouteConfigurationDocument(
      [route({ kilometres: null })],
      [],
    ).routes;

    expect((entry as { kilometres: unknown }).kilometres).toBeNull();
  });

  describe("what it leaves out", () => {
    /*
     * A backup carrying database ids only fits the database it came from. None
     * of this is needed to recreate a route, so none of it is written.
     */
    it("writes no identifiers or timestamps", () => {
      const json = JSON.stringify(
        toRouteConfigurationDocument([route()], [ANTWERP_KALLO]),
      );

      for (const forbidden of [
        "reviewed",
        '"id"',
        "route-1",
        "group-1",
        "createdAt",
        "updatedAt",
        "combinationGroupId",
        "hasTunnel",
      ]) {
        expect(json).not.toContain(forbidden);
      }
    });

    /** A route carries its distance; the Toll is the Engine's to work out. */
    it("writes no toll amount", () => {
      expect(
        JSON.stringify(toRouteConfigurationDocument([route()], [])),
      ).not.toContain("toll");
    });

    it("writes nothing but the routes", () => {
      expect(
        Object.keys(toRouteConfigurationDocument([route()], [])),
      ).toEqual(["routes"]);
    });

    it("writes only the five fields of a route, plus its type", () => {
      const [entry] = toRouteConfigurationDocument([route()], []).routes;

      expect(Object.keys(entry).sort()).toEqual([
        "departure",
        "destination",
        "kilometres",
        "tarief",
        "tunnel",
        "type",
      ]);
    });

    it("writes only a type and its legs for a Combination", () => {
      const [entry] = toRouteConfigurationDocument([], [ANTWERP_KALLO]).routes;

      expect(Object.keys(entry).sort()).toEqual(["legs", "type"]);
    });
  });

  describe("the order", () => {
    const GENT = route({ id: "r2", departure: "Gent", destination: "Lille" });
    const AALST = route({ id: "r3", departure: "Aalst", destination: "Ninove" });

    it("writes ordinary routes before Combinations", () => {
      const document = toRouteConfigurationDocument(
        [route()],
        [ANTWERP_KALLO],
      );

      expect(document.routes.map((entry) => entry.type)).toEqual([
        "NORMAL",
        "COMBINATION",
      ]);
    });

    it("sorts ordinary routes by departure and destination", () => {
      const document = toRouteConfigurationDocument([route(), GENT, AALST], []);

      expect(
        document.routes.map((entry) => (entry as { departure: string }).departure),
      ).toEqual(["Aalst", "Gent", "Quay 869"]);
    });

    it("sorts Combinations by their outbound leg", () => {
      const zeebrugge = combination("group-2", [
        { departure: "Zeebrugge", destination: "Gent" },
        { departure: "Gent", destination: "Zeebrugge" },
      ]);

      const document = toRouteConfigurationDocument(
        [],
        [zeebrugge, ANTWERP_KALLO],
      );

      expect(
        document.routes.map(
          (entry) => (entry as unknown as { legs: { departure: string }[] }).legs[0].departure,
        ),
      ).toEqual(["Antwerp", "Zeebrugge"]);
    });

    /** Two exports of one configuration are the same file, byte for byte. */
    it("is the same whatever order the lists arrive in", () => {
      const forwards = toRouteConfigurationDocument([route(), GENT], []);
      const backwards = toRouteConfigurationDocument([GENT, route()], []);

      expect(JSON.stringify(forwards)).toBe(JSON.stringify(backwards));
    });
  });

  it("writes an empty configuration as an empty list", () => {
    expect(toRouteConfigurationDocument([], [])).toEqual({ routes: [] });
  });

  it("writes several Combinations, each with its own two legs", () => {
    const second = combination("group-2", [
      { departure: "Zeebrugge", destination: "Gent" },
      { departure: "Gent", destination: "Zeebrugge" },
    ]);

    const document = toRouteConfigurationDocument(
      [],
      [ANTWERP_KALLO, second],
    );

    expect(document.routes).toHaveLength(2);
    for (const entry of document.routes) {
      expect((entry as unknown as { legs: unknown[] }).legs).toHaveLength(2);
    }
  });
});

describe("the file", () => {
  it("is named for the day it was exported", () => {
    expect(routeConfigurationFileName(new Date(2026, 8, 27))).toBe(
      "route-pricing-2026-09-27.json",
    );
  });

  it("pads a single-digit month and day", () => {
    expect(routeConfigurationFileName(new Date(2026, 0, 5))).toBe(
      "route-pricing-2026-01-05.json",
    );
  });

  it("is JSON, as UTF-8", () => {
    const blob = toRouteConfigurationBlob(
      toRouteConfigurationDocument([route()], []),
    );

    expect(blob.type).toBe("application/json;charset=utf-8");
  });

  /** Readable, because a configuration backup is opened and edited by people. */
  it("is pretty-printed", () => {
    const text = toRouteConfigurationJson(
      toRouteConfigurationDocument([route()], []),
    );

    expect(text).toContain("\n  ");
    expect(JSON.parse(text)).toEqual(
      toRouteConfigurationDocument([route()], []),
    );
  });

  it("ends with a newline", () => {
    expect(
      toRouteConfigurationJson(toRouteConfigurationDocument([], [])).endsWith(
        "\n",
      ),
    ).toBe(true);
  });

  /** Valid JSON, whatever it holds. */
  it("is parseable with every kind of entry in it", () => {
    const text = toRouteConfigurationJson(
      toRouteConfigurationDocument(
        [route(), route({ id: "r2", kilometres: null })],
        [ANTWERP_KALLO],
      ),
    );

    expect(() => JSON.parse(text) as unknown).not.toThrow();
    expect((JSON.parse(text) as { routes: unknown[] }).routes).toHaveLength(3);
  });
});
