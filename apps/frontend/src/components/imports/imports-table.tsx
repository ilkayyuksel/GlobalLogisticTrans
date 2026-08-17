import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { ImportedEmail, ImportedEmailStatus } from "@/lib/api/types";

/**
 * The mailbox scan's results, one row per email.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A LIMITATION WORTH KNOWING: the backend records THAT an import failed, not
 * WHY. `imported_email` has no error column, and `parser_run` — which does have
 * one — is never written. So a failed row can say "this email did not import"
 * and point at the sender, subject and time, but the reason lives only in the
 * application log.
 *
 * Rather than leave that as a silent gap, each status carries an explanation of
 * what it means and what happens next, which is the most this data supports.
 * ────────────────────────────────────────────────────────────────────────────
 */

const TONE_BY_STATUS: Record<ImportedEmailStatus, BadgeTone> = {
  PROCESSED: "success",
  FAILED: "danger",
  IGNORED: "neutral",
  PROCESSING: "info",
  RECEIVED: "info",
};

/** What each state means for the operator, in their terms. */
const MEANING_BY_STATUS: Record<ImportedEmailStatus, string> = {
  PROCESSED: "Trips were created from this email.",
  FAILED:
    "No trips were created. The email stays unread and the next scan will try again — check the application log for the reason.",
  IGNORED:
    "Set aside on purpose: an untrusted sender, an UPDATE or CANCEL this version does not carry out, or an order whose trips already exist.",
  PROCESSING: "Started, but not finished. A scan may still be running.",
  RECEIVED: "Recorded but not yet processed.",
};

export function ImportsTable({ emails }: { emails: ImportedEmail[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Imported emails</caption>
        <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-5 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-5 py-3 font-medium">
              Received
            </th>
            <th scope="col" className="px-5 py-3 font-medium">
              Sender
            </th>
            <th scope="col" className="px-5 py-3 font-medium">
              Subject
            </th>
            <th scope="col" className="px-5 py-3 font-medium">
              Type
            </th>
            <th scope="col" className="px-5 py-3 font-medium">
              PDF
            </th>
          </tr>
        </thead>
        <tbody>
          {emails.map((email) => (
            <tr
              key={email.id}
              className="border-b border-border last:border-0 align-top"
            >
              <td className="px-5 py-3">
                <Badge tone={TONE_BY_STATUS[email.processingStatus]}>
                  {email.processingStatus}
                </Badge>
                <p className="mt-1 max-w-xs text-xs text-muted">
                  {MEANING_BY_STATUS[email.processingStatus]}
                </p>
              </td>

              <td className="px-5 py-3 tabular-nums text-secondary">
                {formatTimestamp(email.receivedAt)}
                {email.processedAt ? (
                  <p className="text-xs text-muted">
                    handled {formatTimestamp(email.processedAt)}
                  </p>
                ) : null}
              </td>

              <td className="px-5 py-3 text-secondary">{email.senderEmail}</td>

              <td className="px-5 py-3 text-foreground">{email.subject}</td>

              <td className="px-5 py-3">
                <span className="text-secondary">{email.importType}</span>
                {email.importType === "NEW" ? null : (
                  <p className="text-xs text-muted">Not carried out yet</p>
                )}
              </td>

              <td className="px-5 py-3">
                {email.pdfDocumentId ? (
                  <span className="text-secondary">Stored</span>
                ) : (
                  <span className="text-xs text-muted">None</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Locale-independent, so a server and a browser render the same string. */
function formatTimestamp(value: string): string {
  return value.replace("T", " ").slice(0, 16);
}
