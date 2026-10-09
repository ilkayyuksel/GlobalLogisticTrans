import { Prisma } from "@prisma/client";

import { violatesUniqueConstraint } from "./unique-violation";

/**
 * Recognising ONE unique constraint in a Prisma error, in both shapes Prisma
 * produces: through the `pg` driver adapter (which this project uses, and which
 * never sets `meta.target`) and through the classic engine.
 */

const COMPONENT_LINK = {
  columns: ["pricing_component_id"],
  indexName: "custom_property_pricing_component_active_key",
};

const CONFIRMATION_IDENTITY = {
  columns: ["trip_id", "cc_number"],
  indexName: "cost_confirmation_trip_id_cc_number_key",
};

function p2002(meta: Record<string, unknown> | undefined) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.9.1",
    meta,
  });
}

function adapter(constraint: Record<string, unknown>) {
  return p2002({
    modelName: "Model",
    driverAdapterError: {
      name: "DriverAdapterError",
      cause: { kind: "UniqueConstraintViolation", constraint },
    },
  });
}

describe("violatesUniqueConstraint", () => {
  describe("the pg adapter's shape", () => {
    it("recognises the constraint by its columns", () => {
      expect(
        violatesUniqueConstraint(adapter({ fields: ["pricing_component_id"] }), COMPONENT_LINK),
      ).toBe(true);
    });

    it("compares the columns as a set, whatever their order", () => {
      expect(
        violatesUniqueConstraint(
          adapter({ fields: ["cc_number", "trip_id"] }),
          CONFIRMATION_IDENTITY,
        ),
      ).toBe(true);
    });

    it("accepts a column Postgres chose to quote", () => {
      expect(
        violatesUniqueConstraint(
          adapter({ fields: ['"pricing_component_id"'] }),
          COMPONENT_LINK,
        ),
      ).toBe(true);
    });

    it("recognises the constraint by its index name", () => {
      expect(
        violatesUniqueConstraint(
          adapter({ index: "custom_property_pricing_component_active_key" }),
          COMPONENT_LINK,
        ),
      ).toBe(true);
    });

    it.each([
      ["another column", ["name"]],
      ["a subset of the key", ["trip_id"]],
      ["a superset of the key", ["trip_id", "cc_number", "id"]],
    ])("does not match %s", (_label, fields) => {
      expect(violatesUniqueConstraint(adapter({ fields }), CONFIRMATION_IDENTITY)).toBe(
        false,
      );
    });

    it("does not match another index by name", () => {
      expect(
        violatesUniqueConstraint(
          adapter({ index: "custom_property_name_active_key" }),
          COMPONENT_LINK,
        ),
      ).toBe(false);
    });
  });

  describe("the classic engine's shape (meta.target)", () => {
    it("recognises the index name", () => {
      expect(
        violatesUniqueConstraint(
          p2002({ target: "custom_property_pricing_component_active_key" }),
          COMPONENT_LINK,
        ),
      ).toBe(true);
    });

    it("recognises the columns", () => {
      expect(
        violatesUniqueConstraint(p2002({ target: ["pricing_component_id"] }), COMPONENT_LINK),
      ).toBe(true);
    });

    it("does not match another index", () => {
      expect(
        violatesUniqueConstraint(
          p2002({ target: "custom_property_name_active_key" }),
          COMPONENT_LINK,
        ),
      ).toBe(false);
    });
  });

  describe("everything else", () => {
    it("does not guess when the constraint is not reported", () => {
      expect(violatesUniqueConstraint(p2002(undefined), COMPONENT_LINK)).toBe(false);
      expect(violatesUniqueConstraint(p2002({ modelName: "Model" }), COMPONENT_LINK)).toBe(
        false,
      );
    });

    it("ignores every other Prisma error", () => {
      const foreignKey = new Prisma.PrismaClientKnownRequestError("FK failed", {
        code: "P2003",
        clientVersion: "7.9.1",
        meta: { target: ["pricing_component_id"] },
      });

      expect(violatesUniqueConstraint(foreignKey, COMPONENT_LINK)).toBe(false);
    });

    it("ignores errors that are not Prisma's", () => {
      expect(violatesUniqueConstraint(new Error("boom"), COMPONENT_LINK)).toBe(false);
      expect(violatesUniqueConstraint("P2002", COMPONENT_LINK)).toBe(false);
    });
  });
});
