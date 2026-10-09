import { Prisma } from "@prisma/client";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * One unique constraint, as an error may identify it.
 *
 * Both are given because an error names one OR the other, depending on how
 * Postgres reported it: the columns of the key, or the index by name.
 */
export interface UniqueConstraint {
  /** The database column names, in any order. */
  readonly columns: readonly string[];
  /** The database index name. */
  readonly indexName: string;
}

/**
 * Whether `error` is a unique violation of exactly this constraint.
 *
 * ── WHY THE CONSTRAINT IS READ, NOT JUST THE CODE ───────────────────────────
 * P2002 means "some unique constraint". A table with two of them — or a key
 * no caller expects — would otherwise be reported as whichever one the caller
 * had in mind, which tells an administrator the wrong thing is taken, or turns
 * a real failure into a quiet "already recorded".
 *
 * ── THE TWO SHAPES ──────────────────────────────────────────────────────────
 * Through the `pg` driver adapter this project uses, Prisma leaves
 * `meta.target` unset and reports the constraint as
 * `meta.driverAdapterError.cause.constraint` — `{ fields }`, parsed from
 * Postgres' `Key (column, …)=…` detail, or `{ index }`. The classic query
 * engine reports `meta.target` instead: an array of columns, or the index
 * name. Both are read; anything that names neither is not recognised, so the
 * caller rethrows it rather than guessing.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function violatesUniqueConstraint(
  error: unknown,
  constraint: UniqueConstraint,
): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== PRISMA_UNIQUE_VIOLATION
  ) {
    return false;
  }

  const reported = reportedConstraint(error.meta);

  if (typeof reported === "string") {
    return reported === constraint.indexName;
  }

  return (
    reported !== null &&
    reported.length === constraint.columns.length &&
    constraint.columns.every((column) => reported.includes(column))
  );
}

/** The violated columns, the violated index's name, or null when neither. */
function reportedConstraint(
  meta: Record<string, unknown> | undefined,
): string[] | string | null {
  const adapter = (
    meta?.driverAdapterError as
      | { cause?: { constraint?: { fields?: unknown; index?: unknown } } }
      | undefined
  )?.cause?.constraint;
  const named = adapter?.fields ?? adapter?.index ?? meta?.target;

  if (typeof named === "string") {
    return named;
  }

  if (!Array.isArray(named)) {
    return null;
  }

  // Postgres quotes an identifier in its detail only when it must; the
  // comparison is on the bare name either way.
  return named.map((column) => String(column).replace(/"/g, ""));
}
