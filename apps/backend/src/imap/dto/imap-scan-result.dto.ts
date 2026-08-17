import { ApiProperty } from "@nestjs/swagger";

/**
 * What one scan did, in counts only.
 *
 * Deliberately free of message content: no subjects, no senders, no filenames,
 * no PDF data. An operator triggering a scan needs to know whether it worked
 * and how much it moved; anything identifying belongs in the log, where access
 * is controlled, not in an HTTP response.
 *
 * Every scanned message lands in exactly one of the four outcome counters, so
 * `imported + ignored + failed + alreadyProcessed` equals `scanned`.
 */
export class ImapScanResultDto {
  @ApiProperty({
    description: "Unread messages the mailbox offered.",
    example: 4,
  })
  scanned!: number;

  @ApiProperty({
    description: "Emails whose PDF produced Trips.",
    example: 2,
  })
  imported!: number;

  @ApiProperty({
    description:
      "Emails deliberately not imported: an untrusted sender, or an UPDATE/CANCEL instruction this version does not carry out.",
    example: 1,
  })
  ignored!: number;

  @ApiProperty({
    description:
      "Emails that could not be imported. They stay unread and the next scan retries them.",
    example: 1,
  })
  failed!: number;

  @ApiProperty({
    description:
      "Emails an earlier scan already handled, or whose Trips already exist. No work was repeated.",
    example: 0,
  })
  alreadyProcessed!: number;

  @ApiProperty({
    description:
      "True when another scan was still running, so this one did nothing. Normal when a scheduled scan overlaps a manual one.",
    example: false,
  })
  scanAlreadyRunning!: boolean;
}
