/**
 * Bounds for monetary columns.
 *
 * Every money column in the schema is NUMERIC(12,2): ten integer digits and two
 * decimals. Keeping the limits here means a DTO cannot drift from the column it
 * writes to.
 */
export const MONEY_DECIMAL_PLACES = 2;
export const MONEY_MAX_VALUE = 9_999_999_999.99;
