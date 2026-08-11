import { Injectable } from "@nestjs/common";
import { CustomProperty, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export interface FindCustomPropertiesFilter {
  isActive?: boolean;
  search?: string;
  skip: number;
  take: number;
}

export interface CustomPropertyPage {
  items: CustomProperty[];
  totalItems: number;
}

export type CreateCustomPropertyData = Prisma.CustomPropertyUncheckedCreateInput;
export type UpdateCustomPropertyData = Prisma.CustomPropertyUncheckedUpdateInput;

/**
 * Database access for the CustomProperty domain.
 *
 * Contains no business rules and performs no arithmetic: duplicate-name policy,
 * ordering defaults and error translation belong to CustomPropertyService, and
 * price calculation belongs to the future Pricing Engine. There is no delete
 * method, because properties are never removed.
 */
@Injectable()
export class CustomPropertyRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` against a transaction-scoped clone of this repository.
   *
   * The service never sees a Prisma client: it receives a repository bound to
   * the transaction, so the layering rule holds while a read-then-write stays
   * atomic.
   */
  runInTransaction<TResult>(
    work: (repository: CustomPropertyRepository) => Promise<TResult>,
  ): Promise<TResult> {
    return this.prisma.$transaction((transaction) =>
      work(
        new CustomPropertyRepository(transaction as unknown as PrismaService),
      ),
    );
  }

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a concurrent write lands between the two queries.
   *
   * Ordered by display order, which is the sequence the selection list uses.
   */
  async findPage(
    filter: FindCustomPropertiesFilter,
  ): Promise<CustomPropertyPage> {
    const where = this.buildWhere(filter);

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.customProperty.findMany({
        where,
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.customProperty.count({ where }),
    ]);

    return { items, totalItems };
  }

  findById(id: string): Promise<CustomProperty | null> {
    return this.prisma.customProperty.findUnique({ where: { id } });
  }

  /**
   * `excludeCustomPropertyId` lets an update ignore the row being edited, so
   * saving a property without renaming it never conflicts with itself.
   */
  findActiveByName(
    name: string,
    excludeCustomPropertyId?: string,
  ): Promise<CustomProperty | null> {
    return this.prisma.customProperty.findFirst({
      where: {
        name,
        isActive: true,
        ...(excludeCustomPropertyId
          ? { id: { not: excludeCustomPropertyId } }
          : {}),
      },
    });
  }

  /**
   * Highest display order in use, or null when the table is empty.
   *
   * Inactive properties are included: reusing their position would interleave a
   * new property with the historical ordering.
   */
  async findHighestDisplayOrder(): Promise<number | null> {
    const highest = await this.prisma.customProperty.findFirst({
      orderBy: { displayOrder: "desc" },
      select: { displayOrder: true },
    });

    return highest?.displayOrder ?? null;
  }

  create(data: CreateCustomPropertyData): Promise<CustomProperty> {
    return this.prisma.customProperty.create({ data });
  }

  update(
    id: string,
    data: UpdateCustomPropertyData,
  ): Promise<CustomProperty> {
    return this.prisma.customProperty.update({ where: { id }, data });
  }

  setActive(id: string, isActive: boolean): Promise<CustomProperty> {
    return this.prisma.customProperty.update({
      where: { id },
      data: { isActive },
    });
  }

  private buildWhere(
    filter: FindCustomPropertiesFilter,
  ): Prisma.CustomPropertyWhereInput {
    const where: Prisma.CustomPropertyWhereInput = {};

    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    if (filter.search) {
      const contains = { contains: filter.search, mode: "insensitive" } as const;

      where.OR = [{ name: contains }, { description: contains }];
    }

    return where;
  }
}
