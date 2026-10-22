import { ApiProperty } from "@nestjs/swagger";

import { AdviceSeverity } from "../advice/row-advice";

/** The day a line stated, and the Trip's own planning date it is corrected to. */
export class InvoiceDateCorrectionDto {
  @ApiProperty({ format: "date", example: "2026-10-06", description: "As the sheet stated it." })
  invoicePlanningDate!: string;

  @ApiProperty({ format: "date", example: "2026-10-07", description: "The Trip's own planningDate." })
  tripPlanningDate!: string;
}

/**
 * One piece of advice about a line: what is wrong, what became of the line,
 * and what to do — as three separate sentences. Generated from the line's
 * actual outcome (`advice/row-advice.ts`), never a fixed text.
 */
export class InvoiceRowAdviceDto {
  @ApiProperty({ enum: AdviceSeverity, description: "INFO: nothing to do. WARNING: look. ERROR: act." })
  severity!: AdviceSeverity;

  @ApiProperty({ example: "Datum komt niet overeen" })
  problem!: string;

  @ApiProperty({ example: "Boekingsnummer en containernummer komen overeen met één unieke rit in Trano." })
  explanation!: string;

  @ApiProperty({ example: "Corrigeer de datum in Excel van 06/10/2026 naar 07/10/2026." })
  action!: string;
}
