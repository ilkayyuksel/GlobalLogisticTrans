import { TripDriverPinningService } from "./trip-driver-pinning.service";

/** For tests not about pinning: no Trip ever has a driver stored for it. */
export function noDriverPinning(): TripDriverPinningService {
  return {
    driverToPin: () => Promise.resolve(undefined),
  } as unknown as TripDriverPinningService;
}
