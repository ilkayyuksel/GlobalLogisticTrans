/**
 * A phone number as WhatsApp addresses it.
 *
 * ── WHY THIS IS ITS OWN FILE ────────────────────────────────────────────────
 * It is the one piece of addressing logic worth testing, and it must be
 * testable WITHOUT loading Baileys. Baileys 7 ships as ESM, which the CommonJS
 * test runner cannot require, so anything importing it is untestable here — and
 * that is fine, because everything except the socket itself lives behind the
 * `WhatsAppConnection` interface. Keeping this out of `baileys-connection.ts`
 * is what keeps that true.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Digits and the individual-chat suffix, nothing else. The number arrives
 * already validated — see the backend's phone-number normalisation — so this
 * only puts it in the shape the protocol wants.
 */
export function toJid(phoneNumber: string): string {
  return `${phoneNumber}@s.whatsapp.net`;
}
