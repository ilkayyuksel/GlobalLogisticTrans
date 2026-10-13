import { TripDriverPinningService } from "./trip-driver-pinning.service";

/** For tests not about it: no finished Trip ever has a driver kept for it. */
export function noDriverPinning(): TripDriverPinningService {
  return {
    driverToKeep: () => Promise.resolve(undefined),
  } as unknown as TripDriverPinningService;
}
