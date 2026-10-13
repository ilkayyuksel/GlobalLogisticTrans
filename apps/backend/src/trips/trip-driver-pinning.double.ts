import { TripDriverPinningService } from "./trip-driver-pinning.service";

/** For tests not about pinning: no Trip ever has a driver stored for it. */
export function noDriverPinning(): TripDriverPinningService {
  return {
    driverToPin: () => Promise.resolve(undefined),
    // Nobody is assigned to any truck: a change of truck leaves no driver.
    driverOn: () => Promise.resolve(null),
  } as unknown as TripDriverPinningService;
}
