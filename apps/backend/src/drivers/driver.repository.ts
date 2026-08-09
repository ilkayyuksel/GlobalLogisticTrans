import { Injectable } from "@nestjs/common";
import { Driver, Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export interface FindDriversFilter {
  isActive?: boolean;
  search?: string;
  skip: number;
  take: number;
}

export interface DriverPage {
  items: Driver[];
  totalItems: number;
}

export type CreateDriverData = Prisma.DriverUncheckedCreateInput;
export type UpdateDriverData = Prisma.DriverUncheckedUpdateInput;

/**
 * Database access for the Driver domain.
 *
 * Contains no business rules: uniqueness checks, activation rules and error
 * translation all belong to DriverService. There is no delete method, because
 * drivers are never physically removed.
 */
@Injectable()
export class DriverRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a concurrent write lands between the two queries.
   */
  async findPage(filter: FindDriversFilter): Promise<DriverPage> {
    const where = this.buildWhere(filter);

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.driver.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.driver.count({ where }),
    ]);

    return { items, totalItems };
  }

  findById(id: string): Promise<Driver | null> {
    return this.prisma.driver.findUnique({ where: { id } });
  }

  /**
   * Finds an active driver holding this licence number.
   *
   * `excludeDriverId` lets an update ignore the row being edited, so saving a
   * driver without changing its licence never conflicts with itself.
   */
  findActiveByLicenceNumber(
    licenceNumber: string,
    excludeDriverId?: string,
  ): Promise<Driver | null> {
    return this.prisma.driver.findFirst({
      where: {
        licenceNumber,
        isActive: true,
        ...(excludeDriverId ? { id: { not: excludeDriverId } } : {}),
      },
    });
  }

  create(data: CreateDriverData): Promise<Driver> {
    return this.prisma.driver.create({ data });
  }

  update(id: string, data: UpdateDriverData): Promise<Driver> {
    return this.prisma.driver.update({ where: { id }, data });
  }

  setActive(id: string, isActive: boolean): Promise<Driver> {
    return this.prisma.driver.update({ where: { id }, data: { isActive } });
  }

  private buildWhere(filter: FindDriversFilter): Prisma.DriverWhereInput {
    const where: Prisma.DriverWhereInput = {};

    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    if (filter.search) {
      where.name = { contains: filter.search, mode: "insensitive" };
    }

    return where;
  }
}
