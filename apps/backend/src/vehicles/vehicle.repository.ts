import { Injectable } from "@nestjs/common";
import { Prisma, Vehicle } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";

export interface FindVehiclesFilter {
  isActive?: boolean;
  search?: string;
  skip: number;
  take: number;
}

export interface VehiclePage {
  items: Vehicle[];
  totalItems: number;
}

export type CreateVehicleData = Prisma.VehicleUncheckedCreateInput;
export type UpdateVehicleData = Prisma.VehicleUncheckedUpdateInput;

/**
 * Database access for the Vehicle domain.
 *
 * Contains no business rules: uniqueness checks, activation rules and error
 * translation all belong to VehicleService. There is no delete method, because
 * vehicles are never physically removed.
 *
 * VehicleAssignment and Maintenance are separate modules and are never queried
 * here.
 */
@Injectable()
export class VehicleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Page and count in one transaction so the total cannot drift from the rows
   * when a concurrent write lands between the two queries.
   */
  async findPage(filter: FindVehiclesFilter): Promise<VehiclePage> {
    const where = this.buildWhere(filter);

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.vehicle.findMany({
        where,
        orderBy: [{ licensePlate: "asc" }, { id: "asc" }],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return { items, totalItems };
  }

  findById(id: string): Promise<Vehicle | null> {
    return this.prisma.vehicle.findUnique({ where: { id } });
  }

  /**
   * Several Vehicles in one query, for callers resolving a page of records.
   *
   * Returns only the ids that exist; a caller decides what a missing one means.
   * Exists so a list never issues one lookup per row.
   */
  findManyByIds(ids: readonly string[]): Promise<Vehicle[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }

    return this.prisma.vehicle.findMany({ where: { id: { in: [...ids] } } });
  }

  /**
   * `excludeVehicleId` lets an update ignore the row being edited, so saving a
   * vehicle without changing its plate never conflicts with itself.
   */
  findActiveByLicensePlate(
    licensePlate: string,
    excludeVehicleId?: string,
  ): Promise<Vehicle | null> {
    return this.prisma.vehicle.findFirst({
      where: {
        licensePlate,
        isActive: true,
        ...(excludeVehicleId ? { id: { not: excludeVehicleId } } : {}),
      },
    });
  }

  findActiveByDisplayColor(
    displayColor: string,
    excludeVehicleId?: string,
  ): Promise<Vehicle | null> {
    return this.prisma.vehicle.findFirst({
      where: {
        displayColor,
        isActive: true,
        ...(excludeVehicleId ? { id: { not: excludeVehicleId } } : {}),
      },
    });
  }

  create(data: CreateVehicleData): Promise<Vehicle> {
    return this.prisma.vehicle.create({ data });
  }

  update(id: string, data: UpdateVehicleData): Promise<Vehicle> {
    return this.prisma.vehicle.update({ where: { id }, data });
  }

  setActive(id: string, isActive: boolean): Promise<Vehicle> {
    return this.prisma.vehicle.update({ where: { id }, data: { isActive } });
  }

  private buildWhere(filter: FindVehiclesFilter): Prisma.VehicleWhereInput {
    const where: Prisma.VehicleWhereInput = {};

    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    if (filter.search) {
      const contains = { contains: filter.search, mode: "insensitive" } as const;

      where.OR = [
        { licensePlate: contains },
        { brand: contains },
        { model: contains },
      ];
    }

    return where;
  }
}
