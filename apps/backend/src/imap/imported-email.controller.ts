import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import { PaginatedImportedEmailsDto } from "./dto/imported-email-response.dto";
import { ListImportedEmailsQueryDto } from "./dto/list-imported-emails-query.dto";
import { ImportedEmailService } from "./imported-email.service";

/**
 * What the mailbox did, for an operator to read.
 *
 * READ-ONLY, and it will stay that way. These rows are the record of what
 * arrived and what was done with it; letting a request edit or delete one would
 * mean the record could be made to disagree with what actually happened. A
 * failed email is retried by the next scan, not by a button here.
 *
 * The email body is never returned. It is stored only for diagnosing a specific
 * failure, and a transport order's body may carry correspondence that does not
 * belong on an operations screen.
 */
@ApiTags("Imports")
@Controller("imported-emails")
export class ImportedEmailController {
  constructor(private readonly importedEmailService: ImportedEmailService) {}

  @Get()
  @ApiOperation({
    summary: "List imported emails",
    description:
      "The mail the scan has seen, newest first. Answers whether an order arrived, whether it was processed, what kind of instruction it was, and whether it produced a stored PDF. Filterable by processing status and import type. Never returns the message body.",
  })
  @ApiOkResponse({ type: PaginatedImportedEmailsDto })
  findAll(
    @Query() query: ListImportedEmailsQueryDto,
  ): Promise<PaginatedImportedEmailsDto> {
    return this.importedEmailService.findAll(query);
  }
}
