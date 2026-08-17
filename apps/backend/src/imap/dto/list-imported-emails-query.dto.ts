import { ApiPropertyOptional } from "@nestjs/swagger";
import { EmailProcessingStatus, ImportType } from "@prisma/client";
import { IsEnum, IsOptional } from "class-validator";

import { PaginationQueryDto } from "../../common/dto/pagination-query.dto";

/**
 * Filters for the imported-email list.
 *
 * Two, both of which the model answers directly with an indexed column. There
 * is deliberately no sender filter, no subject search and no date range: this
 * screen exists so an operator can see what happened to today's mail, not to
 * become a mail client.
 */
export class ListImportedEmailsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: EmailProcessingStatus,
    description: "Only emails in this state. Omit to return all of them.",
  })
  @IsOptional()
  @IsEnum(EmailProcessingStatus)
  processingStatus?: EmailProcessingStatus;

  @ApiPropertyOptional({
    enum: ImportType,
    description: "Only emails whose subject asked for this kind of import.",
  })
  @IsOptional()
  @IsEnum(ImportType)
  importType?: ImportType;
}
