import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";

import { ImapScanResultDto } from "./dto/imap-scan-result.dto";
import { ImapExceptionFilter } from "./exceptions/imap-exception.filter";
import { ImapScanService } from "./imap-scan.service";

/**
 * The operator's way to run a mailbox scan now.
 *
 * It calls exactly the same service the scheduler does, with no extra
 * behaviour: an on-demand scan and a scheduled one must be the same operation,
 * or the button becomes a second code path that behaves subtly differently from
 * the one that runs unattended.
 *
 * A verb in the path is a deliberate exception to the noun-based convention.
 * "Scan" is an operation, not a resource — there is no scan to GET, PATCH or
 * list — and modelling it as one would invent a collection nobody reads.
 */
@ApiTags("IMAP")
@Controller("imap")
@UseFilters(ImapExceptionFilter)
export class ImapScanController {
  constructor(private readonly imapScanService: ImapScanService) {}

  @Post("scan")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Scan the mailbox for transport orders",
    description:
      "Reads the unread messages in the configured folder, imports those from a trusted sender whose subject announces a NEW transport order, and returns a count of what happened. Emails already handled by an earlier scan are skipped without downloading anything. An email that fails is left unread so the next scan retries it — there is no separate retry mechanism. If a scan is already running, this returns immediately with scanAlreadyRunning set and starts nothing.",
  })
  @ApiOkResponse({
    type: ImapScanResultDto,
    description:
      "Operational counts only. No message content, sender data or PDF contents are returned.",
  })
  @ApiServiceUnavailableResponse({
    description:
      "The mailbox could not be reached, the credentials were refused, or the folder could not be opened (IMAP_001, IMAP_002, IMAP_006). Nothing was marked as processed.",
  })
  @ApiBadRequestResponse({
    description:
      "Mailbox ingestion is disabled. Nothing was contacted; set ENABLE_IMAP=true to scan.",
  })
  scan(): Promise<ImapScanResultDto> {
    return this.imapScanService.scan();
  }
}
