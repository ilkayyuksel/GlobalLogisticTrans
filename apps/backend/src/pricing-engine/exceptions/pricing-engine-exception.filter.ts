import {
  ArgumentsHost,
  Catch,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";

import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import {
  PricingEngineErrorCode,
  PricingEngineException,
} from "./pricing-engine.exceptions";

/**
 * Gives the Pricing Engine's domain failures an HTTP meaning.
 *
 * The Engine is a domain service with no REST surface, so its exceptions
 * deliberately do not extend Nest's HTTP exceptions — giving pricing logic a
 * status code would couple it to a transport it does not have. The consequence
 * is that AllExceptionsFilter, which treats anything that is not an
 * HttpException as an unexpected 500, would hide every pricing failure behind
 * "Internal server error".
 *
 * This filter is the mapping the Engine's documentation always said its
 * eventual caller would own. It is a lookup on the stable `code` each exception
 * carries rather than a chain of instanceof checks, which is exactly why those
 * codes exist.
 *
 * It converts and then delegates to AllExceptionsFilter, so the response
 * envelope and the logging stay defined in one place.
 *
 * Only the unknown Trip is a 404. Everything else is a 409: the request is
 * well-formed and the Trip may well exist, but the current state or
 * configuration does not permit pricing — a missing Setting, a route with no
 * configured cost, a property with no price. Each of those is fixed by changing
 * the system, not by changing the request.
 */
const STATUS_BY_CODE: Record<PricingEngineErrorCode, number> = {
  [PricingEngineErrorCode.TRIP_NOT_FOUND]: HttpStatus.NOT_FOUND,
  [PricingEngineErrorCode.TRIP_NOT_CLOSED]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.MISSING_SETTING]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.INVALID_SETTING]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.UNSUPPORTED_STRATEGY]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.MISSING_ROUTE_PRICING]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.MISSING_TRIP_INPUT]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.MISSING_ROUTE_COST]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.MISSING_CUSTOM_PROPERTY_PRICE]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.NEGATIVE_TOTAL]: HttpStatus.CONFLICT,
  // A group that is not one delivery and one collection: the data is wrong,
  // and pricing it would mean choosing a leg on a guess.
  [PricingEngineErrorCode.INVALID_COMBINATION]: HttpStatus.CONFLICT,
  [PricingEngineErrorCode.UNKNOWN_PRICING_COMPONENT]: HttpStatus.CONFLICT,
};

@Catch(PricingEngineException)
export class PricingEngineExceptionFilter extends AllExceptionsFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(
      exception instanceof PricingEngineException
        ? toHttpException(exception)
        : exception,
      host,
    );
  }
}

/**
 * A code with no entry falls through to 409 rather than to 500.
 *
 * A new pricing failure is far more likely to be another unpriceable
 * configuration than a bug, and reporting it as a server error would send an
 * administrator looking in the wrong place. The exhaustive Record above means
 * adding a code without a status is a compile error, so this is a runtime
 * safety net rather than the actual policy.
 */
function toHttpException(exception: PricingEngineException): HttpException {
  const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.CONFLICT;

  return status === HttpStatus.NOT_FOUND
    ? new NotFoundException(exception.message)
    : new ConflictException(exception.message);
}
