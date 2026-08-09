import { Injectable } from "@nestjs/common";
import { Prisma, Setting } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export interface FindSettingsFilter {
  category?: string;
  includeInactive: boolean;
}

/**
 * Database access for the Settings domain. No business rules live here — value
 * validation and error translation belong to SettingsService.
 *
 * There is deliberately no create or delete: settings are introduced by seed or
 * migration and are never physically removed (database_schema.md §7.2).
 */
@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ordered by category then key so the API, the grouped view and the Settings
   * UI all present the same stable sequence.
   */
  findMany(filter: FindSettingsFilter): Promise<Setting[]> {
    const where: Prisma.SettingWhereInput = {};

    if (filter.category) {
      where.category = filter.category;
    }

    if (!filter.includeInactive) {
      where.isActive = true;
    }

    return this.prisma.setting.findMany({
      where,
      orderBy: [{ category: "asc" }, { key: "asc" }],
    });
  }

  /** Uses the UNIQUE (category, key) index — the only unambiguous lookup. */
  findByCategoryAndKey(category: string, key: string): Promise<Setting | null> {
    return this.prisma.setting.findUnique({
      where: { category_key: { category, key } },
    });
  }

  /**
   * Updates by primary key rather than by (category, key): the caller has
   * already loaded the row, and this keeps identity fields out of the update
   * path entirely, so a key can never be reassigned by accident.
   */
  updateValue(id: string, value: string): Promise<Setting> {
    return this.prisma.setting.update({
      where: { id },
      data: { value },
    });
  }
}
