/**
 * The version of the extraction rules that produced a result.
 *
 * Stored alongside a parsed order so a Trip can always be attributed to the
 * rules that created it, and so a reprocessed import can be told apart from the
 * original. It is a source constant for the same reason the Pricing Engine's
 * version is: only the code can state truthfully which code ran.
 *
 * Bump it when a change alters what the parser EXTRACTS. A refactor that
 * produces identical output for every fixture does not bump it.
 */
export const PARSER_VERSION = "1.1.0";
