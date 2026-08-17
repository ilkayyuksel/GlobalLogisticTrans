import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import { ImapErrorCode, ImapException } from "./imap.exceptions";

/**
 * Gives mailbox failures an HTTP meaning.
 *
 * Like the Pricing Engine's, these exceptions carry no status of their own,
 * because a scan is driven by a scheduler as often as by a request. Without
 * this filter AllExceptionsFilter would report every one of them as an
 * unexpected 500, hiding an unreachable mailbox behind "Internal server error".
 *
 * Two meanings only. A mailbox that cannot be reached, authenticated against or
 * opened is 503: the request was fine, the dependency is not, and retrying
 * later is the right response. A scan asked for while the feature is switched
 * off is 400: nothing is broken, the caller asked for something this
 * configuration does not do.
 *
 * The per-email codes — a missing attachment, a failed download — never reach
 * here. They are handled inside the scan, which records them and moves on to
 * the next email rather than failing the request.
 */
const CLIENT_ERROR_CODES: readonly ImapErrorCode[] = [ImapErrorCode.DISABLED];

@Catch(ImapException)
export class ImapExceptionFilter extends AllExceptionsFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    super.catch(
      exception instanceof ImapException
        ? toHttpException(exception)
        : exception,
      host,
    );
  }
}

function toHttpException(exception: ImapException): HttpException {
  return CLIENT_ERROR_CODES.includes(exception.code)
    ? new BadRequestException(exception.message)
    : new ServiceUnavailableException(exception.message);
}
