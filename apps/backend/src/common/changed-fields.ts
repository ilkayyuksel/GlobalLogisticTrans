/**
 * Field names a partial-update payload actually carries.
 *
 * Used for audit logging: the names say what changed while the values stay out
 * of the logs, because they may be personal or otherwise sensitive.
 *
 * `undefined` means "not supplied" in a PATCH body, so only defined keys count.
 * An explicit null does count — clearing a field is a change.
 */
export function changedFieldNames(payload: object): string[] {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);
}
