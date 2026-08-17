import { ImapScanController } from "./imap-scan.controller";
import { ImapScanService } from "./imap-scan.service";

const RESULT = {
  scanned: 3,
  imported: 1,
  ignored: 1,
  failed: 1,
  alreadyProcessed: 0,
  scanAlreadyRunning: false,
};

describe("ImapScanController", () => {
  let imapScanService: { scan: jest.Mock };
  let controller: ImapScanController;

  beforeEach(() => {
    imapScanService = { scan: jest.fn().mockResolvedValue(RESULT) };
    controller = new ImapScanController(
      imapScanService as unknown as ImapScanService,
    );
  });

  /**
   * The button and the timer must be one operation. A controller that added a
   * check, a filter or a different default would be a second code path
   * behaving subtly differently from the one that runs unattended.
   */
  it("delegates to the same service the scheduler uses", async () => {
    await controller.scan();

    expect(imapScanService.scan).toHaveBeenCalledTimes(1);
    expect(imapScanService.scan).toHaveBeenCalledWith();
  });

  it("returns the scan summary unchanged", async () => {
    await expect(controller.scan()).resolves.toEqual(RESULT);
  });

  it("reports a rejected overlapping scan rather than failing", async () => {
    imapScanService.scan.mockResolvedValue({
      ...RESULT,
      scanned: 0,
      imported: 0,
      ignored: 0,
      failed: 0,
      scanAlreadyRunning: true,
    });

    await expect(controller.scan()).resolves.toMatchObject({
      scanAlreadyRunning: true,
    });
  });

  it("exposes counts only, never message content", async () => {
    const response = await controller.scan();

    expect(Object.keys(response).sort()).toEqual([
      "alreadyProcessed",
      "failed",
      "ignored",
      "imported",
      "scanAlreadyRunning",
      "scanned",
    ]);
  });

  /** Controllers hold no business rules; every decision is in the service. */
  it("performs no validation or filtering of its own", () => {
    const source = ImapScanController.prototype.scan.toString();

    expect(source).not.toContain("if");
    expect(source).not.toContain("ENABLE_IMAP");
  });
});
