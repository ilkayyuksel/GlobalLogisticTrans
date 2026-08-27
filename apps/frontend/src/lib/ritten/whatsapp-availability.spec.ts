import type { Trip } from "@/lib/api/types";
import {
  SendUnavailableReason,
  isSendVisible,
  sendUnavailableReason,
} from "./whatsapp-availability";

/**
 * When a row may offer to send its transport order.
 *
 * This mirrors the backend's rule so an operator is told WHY a button is
 * unavailable instead of pressing one that can only fail. The backend re-checks
 * every condition; if the two disagree, the backend wins. These tests pin the
 * mirror, and the backend's own suite pins the rule.
 */
function buildTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    status: "OPEN",
    pdfDocumentId: "pdf-1",
    effectiveDriver: {
      id: "driver-1",
      name: "Piet Janssens",
      isActive: true,
      source: "VEHICLE_ASSIGNMENT",
      hasPhoneNumber: true,
    },
    ...overrides,
  } as Trip;
}

describe("whether a row can send its transport order", () => {
  it("allows a Trip with a driver, a phone number and a document", () => {
    expect(sendUnavailableReason(buildTrip(), "CONNECTED")).toBeNull();
  });

  describe("the statuses that may send", () => {
    /** The transport happened; re-sending the order the driver worked from. */
    it.each(["OPEN", "CLOSED"] as const)("allows a %s Trip", (status) => {
      expect(sendUnavailableReason(buildTrip({ status }), "CONNECTED")).toBeNull();
    });

    /**
     * A cancelled transport was called off, and the only way out of CANCELLED
     * is back to OPEN. Sending its order would say it is happening again.
     */
    it.each(["CANCELLED", "DELETED"] as const)("refuses a %s Trip", (status) => {
      expect(sendUnavailableReason(buildTrip({ status }), "CONNECTED")).toBe(
        SendUnavailableReason.WRONG_STATUS,
      );
    });

    it.each(["OPEN", "CLOSED"] as const)("shows the button for %s", (status) => {
      expect(isSendVisible(buildTrip({ status }))).toBe(true);
    });

    /** Hidden, not merely disabled: it is not waiting for anything to be fixed. */
    it.each(["CANCELLED", "DELETED"] as const)("hides it for %s", (status) => {
      expect(isSendVisible(buildTrip({ status }))).toBe(false);
    });
  });

  describe("the driver", () => {
    it("refuses a Trip with no driver", () => {
      expect(
        sendUnavailableReason(buildTrip({ effectiveDriver: null }), "CONNECTED"),
      ).toBe(SendUnavailableReason.NO_DRIVER);
    });

    /** A distinct reason, because the two are fixed in different places. */
    it("refuses a driver with no phone number", () => {
      const trip = buildTrip({
        effectiveDriver: {
          id: "driver-1",
          name: "Piet Janssens",
          isActive: true,
          source: "VEHICLE_ASSIGNMENT",
          hasPhoneNumber: false,
        },
      });

      expect(sendUnavailableReason(trip, "CONNECTED")).toBe(
        SendUnavailableReason.NO_PHONE_NUMBER,
      );
    });

    /** Deactivating a Driver does not rewrite who drove; sending still works. */
    it("allows a driver who has since been deactivated", () => {
      const trip = buildTrip({
        effectiveDriver: {
          id: "driver-1",
          name: "Piet Janssens",
          isActive: false,
          source: "VEHICLE_ASSIGNMENT",
          hasPhoneNumber: true,
        },
      });

      expect(sendUnavailableReason(trip, "CONNECTED")).toBeNull();
    });
  });

  it("refuses a Trip created by hand, which has no transport order", () => {
    expect(
      sendUnavailableReason(buildTrip({ pdfDocumentId: null }), "CONNECTED"),
    ).toBe(SendUnavailableReason.NO_DOCUMENT);
  });

  describe("WhatsApp itself", () => {
    it.each([
      "CONNECTING",
      "DISCONNECTED",
      "PAIRING_REQUIRED",
      "ERROR",
      "DISABLED",
    ] as const)("refuses while WhatsApp reports %s", (status) => {
      expect(sendUnavailableReason(buildTrip(), status)).toBe(
        SendUnavailableReason.WHATSAPP_UNAVAILABLE,
      );
    });
  });

  /**
   * The order of the checks IS the message. A cancelled Trip with no driver is
   * reported as cancelled, because that is what an operator would fix first —
   * and a row that could never send never blames a connection instead.
   */
  describe("which reason is reported when several apply", () => {
    it("reports the status before the missing driver", () => {
      const trip = buildTrip({ status: "CANCELLED", effectiveDriver: null });

      expect(sendUnavailableReason(trip, "DISCONNECTED")).toBe(
        SendUnavailableReason.WRONG_STATUS,
      );
    });

    it("reports the missing driver before a WhatsApp outage", () => {
      const trip = buildTrip({ effectiveDriver: null });

      expect(sendUnavailableReason(trip, "DISCONNECTED")).toBe(
        SendUnavailableReason.NO_DRIVER,
      );
    });

    it("reports the missing document before a WhatsApp outage", () => {
      const trip = buildTrip({ pdfDocumentId: null });

      expect(sendUnavailableReason(trip, "PAIRING_REQUIRED")).toBe(
        SendUnavailableReason.NO_DOCUMENT,
      );
    });
  });
});
