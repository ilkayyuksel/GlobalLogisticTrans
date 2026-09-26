import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { AppLoggerService } from "../logger/app-logger.service";
import { CreateRoutePricingDto } from "./dto/create-route-pricing.dto";
import {
  CombinationRoutePricingDto,
  toRoutePricingResponse,
} from "./dto/route-pricing-response.dto";
import {
  CombinationRouteGroupNotFoundException,
  DuplicateActiveRouteException,
  InvalidCombinationLegCountException,
  LEGS_PER_COMBINATION_ROUTE,
} from "./exceptions/route-pricing.exceptions";
import {
  CombinationRouteGroupWithLegs,
  RouteConfigurationKind,
  RoutePricingRepository,
} from "./route-pricing.repository";

/** Prisma's unique-constraint violation code. */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/** 1 is the outbound leg, 2 the return. */
const LEG_POSITIONS = [1, 2] as const;

/**
 * Stores Combination route configurations: a route group that is always exactly
 * two legs, each with its own price, distance and tunnel.
 *
 * ── WHAT A COMBINATION CONFIGURATION IS ─────────────────────────────────────
 * Antwerp to Kallo at 100 and Kallo back to Antwerp at 80 is ONE thing an
 * operator configures, not two routes that happen to be related. The two legs
 * legitimately cost different amounts and run different distances, so each is
 * its own record — and the group they belong to is a row of its own, which is
 * what makes "both or neither" expressible at all.
 *
 * ── NOT A TRIP GROUP ────────────────────────────────────────────────────────
 * Nothing here has anything to do with the TripGroup an operator makes in the
 * Rittenlijst. That group decides which Trips carry the €50 Backload; this
 * decides what the two legs of a Combination COST. Neither reads the other, and
 * no Trip, snapshot or pricing line is touched by anything in this service.
 *
 * ── WHY IT IS A SERVICE OF ITS OWN ──────────────────────────────────────────
 * RoutePricingService stores ONE route and enforces one route's rules. A
 * Combination's rules are about the PAIR — exactly two legs, two distinct
 * roads, written and removed together — and mixing the two responsibilities
 * into one class would have left neither stated clearly.
 *
 * Every write runs in a transaction, so a Combination with one leg cannot be
 * stored even if a second insert fails. Prices are never logged: they are
 * commercial configuration.
 * ────────────────────────────────────────────────────────────────────────────
 */
@Injectable()
export class CombinationRoutePricingService {
  constructor(
    private readonly repository: RoutePricingRepository,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(CombinationRoutePricingService.name);
  }

  /** Every Combination configuration, each with both of its legs. */
  async findAll(): Promise<CombinationRoutePricingDto[]> {
    const groups = await this.repository.findGroups();

    return groups.map((group) => this.toResponse(group));
  }

  async findById(combinationGroupId: string): Promise<CombinationRoutePricingDto> {
    return this.toResponse(await this.requireGroup(combinationGroupId));
  }

  /**
   * Configures a Combination: the group row and BOTH legs, in one transaction.
   *
   * Either the whole configuration exists or none of it does. That is the
   * reason for the transaction rather than three sequential writes: a failure
   * after the first leg would otherwise leave a Combination that prices the
   * outbound and charges nothing for the return.
   */
  async create(
    legs: readonly CreateRoutePricingDto[],
  ): Promise<CombinationRoutePricingDto> {
    this.assertExactlyTwoLegs(legs);
    this.assertDistinctRoutes(legs);

    for (const leg of legs) {
      await this.assertRouteAvailable(leg.departure, leg.destination);
    }

    const created = await this.guardingUniqueness(legs, () =>
      this.repository.runInTransaction(async (repository) => {
        const group = await repository.createGroup();

        for (const [index, leg] of legs.entries()) {
          await repository.create(this.toLegData(leg, group.id, index));
        }

        return {
          ...group,
          legs: await repository.findLegsOfGroup(group.id),
        };
      }),
    );

    this.logger.log("Combination route configuration created", {
      combinationGroupId: created.id,
      legCount: created.legs.length,
    });

    return this.toResponse(created);
  }

  /**
   * Replaces both legs of an existing Combination.
   *
   * ── WHY THE ROWS ARE UPDATED RATHER THAN REPLACED ─────────────────────────
   * Deleting the legs and writing new ones would take the configuration through
   * a state with no legs at all, and would discard each leg's own tunnel cost
   * along with its identity. The two existing rows are updated in place
   * instead, by position, so the Combination never has fewer than two legs at
   * any moment — inside the transaction or outside it.
   */
  async replaceLegs(
    combinationGroupId: string,
    legs: readonly CreateRoutePricingDto[],
  ): Promise<CombinationRoutePricingDto> {
    this.assertExactlyTwoLegs(legs);
    this.assertDistinctRoutes(legs);

    const existing = await this.requireGroup(combinationGroupId);

    // A group that does not already hold two legs cannot be edited leg by leg.
    // It is not a state this service can produce, so it is reported rather than
    // repaired: repairing it would mean inventing a leg.
    this.assertExactlyTwoLegs(existing.legs);

    for (const [index, leg] of legs.entries()) {
      await this.assertRouteAvailable(
        leg.departure,
        leg.destination,
        existing.legs[index].id,
      );
    }

    const updated = await this.guardingUniqueness(legs, () =>
      this.repository.runInTransaction(async (repository) => {
        for (const [index, leg] of legs.entries()) {
          await repository.update(
            existing.legs[index].id,
            this.toLegData(leg, combinationGroupId, index),
          );
        }

        return {
          ...existing,
          legs: await repository.findLegsOfGroup(combinationGroupId),
        };
      }),
    );

    this.logger.log("Combination route configuration updated", {
      combinationGroupId,
    });

    return this.toResponse(updated);
  }

  /**
   * Removes a Combination configuration and both of its legs.
   *
   * One statement: the legs reference the group with ON DELETE CASCADE, so the
   * database removes them and there is no moment at which one leg survives.
   * Historical pricing is untouched — a TripPricing snapshot holds the amounts
   * it was priced with and reads no configuration ever again.
   */
  async remove(combinationGroupId: string): Promise<void> {
    await this.requireGroup(combinationGroupId);
    await this.repository.deleteGroup(combinationGroupId);

    this.logger.log("Combination route configuration deleted", {
      combinationGroupId,
    });
  }

  private async requireGroup(
    combinationGroupId: string,
  ): Promise<CombinationRouteGroupWithLegs> {
    const group = await this.repository.findGroupById(combinationGroupId);

    if (!group) {
      throw new CombinationRouteGroupNotFoundException(combinationGroupId);
    }

    return {
      ...group,
      legs: await this.repository.findLegsOfGroup(combinationGroupId),
    };
  }

  /**
   * Refuses any number of legs but two.
   *
   * The database refuses a THIRD leg on its own — only two positions exist and
   * each is unique within its group — but no constraint can require a row to
   * have a sibling, so the lower bound is checked here and written inside a
   * transaction.
   */
  private assertExactlyTwoLegs(legs: readonly unknown[]): void {
    if (legs.length !== LEGS_PER_COMBINATION_ROUTE) {
      this.logger.warn("Rejected a Combination that is not two legs", {
        legCount: legs.length,
      });

      throw new InvalidCombinationLegCountException(legs.length);
    }
  }

  /**
   * Refuses a Combination whose two legs are the same road.
   *
   * Pricing selects a Combination leg by its road, so two legs on one road
   * would make the choice between them arbitrary. The partial unique index says
   * the same thing; this says it before the write, with a message that names the
   * route.
   */
  private assertDistinctRoutes(
    legs: readonly CreateRoutePricingDto[],
  ): void {
    const [first, second] = legs;

    if (
      first.departure === second.departure &&
      first.destination === second.destination
    ) {
      throw new DuplicateActiveRouteException(
        first.departure,
        first.destination,
      );
    }
  }

  /** No second Combination leg may describe the same road. */
  private async assertRouteAvailable(
    departure: string,
    destination: string,
    excludeRoutePricingId?: string,
  ): Promise<void> {
    const holder = await this.repository.findByRoute(departure, destination, {
      kind: RouteConfigurationKind.COMBINATION,
      excludeRoutePricingId,
    });

    if (holder) {
      this.logger.warn("Rejected duplicate Combination leg", {
        conflictingRoutePricingId: holder.id,
      });

      throw new DuplicateActiveRouteException(departure, destination);
    }
  }

  /**
   * The checks above produce good error messages; they cannot be atomic. The
   * partial unique indexes are the real guard, so a violation is translated here
   * rather than escaping as a raw Prisma error.
   */
  private async guardingUniqueness<TResult>(
    legs: readonly CreateRoutePricingDto[],
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_VIOLATION
      ) {
        throw new DuplicateActiveRouteException(
          legs[0].departure,
          legs[0].destination,
        );
      }

      throw error;
    }
  }

  /** One leg, as the row that stores it. */
  private toLegData(
    leg: CreateRoutePricingDto,
    combinationGroupId: string,
    index: number,
  ) {
    return {
      routeName: leg.routeName,
      departure: leg.departure,
      destination: leg.destination,
      basePrice: leg.basePrice,
      kilometres: leg.kilometres ?? null,
      notes: leg.notes ?? null,
      combinationGroupId,
      combinationLegPosition: LEG_POSITIONS[index],
    };
  }

  private toResponse(
    group: CombinationRouteGroupWithLegs,
  ): CombinationRoutePricingDto {
    return {
      id: group.id,
      legs: group.legs.map(toRoutePricingResponse),
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }
}
