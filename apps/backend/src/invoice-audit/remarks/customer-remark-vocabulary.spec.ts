import { WAITING_NOT_WRITTEN_NOTE, toCustomerRemarkParts, type RemarkFacts } from "./customer-remark-vocabulary";

const time = (clock: string) => new Date(`1970-01-01T${clock}:00.000Z`);

function facts(overrides: Partial<RemarkFacts> = {}): RemarkFacts {
  return {
    propertyNames: [],
    tarCharged: false,
    ccNumbers: [],
    waiting: null,
    geenCombi: false,
    ...overrides,
  };
}

const texts = (value: RemarkFacts) => toCustomerRemarkParts(value).parts.map((part) => part.text);

describe("the customer's words", () => {
  it("writes a property in lower case, whatever it costs", () => {
    expect(texts(facts({ propertyNames: ["Flat", "Stop", "Chassis"] }))).toEqual(["flat", "stop", "chassis"]);
  });

  it("invents no translation", () => {
    expect(texts(facts({ propertyNames: ["Aan/Afkoppelen"] }))).toEqual(["aan/afkoppelen"]);
  });

  it("says tar once, whether charged or assigned", () => {
    expect(texts(facts({ tarCharged: true }))).toEqual(["tar"]);
    expect(texts(facts({ propertyNames: ["TAR"], tarCharged: true }))).toEqual(["tar"]);
    expect(texts(facts({ propertyNames: ["TAR"] }))).toEqual(["tar"]);
  });

  it("names every confirmation as EC, each once", () => {
    expect(texts(facts({ ccNumbers: ["4220981", "4220982", "4220981"] }))).toEqual([
      "EC 4220981",
      "EC 4220982",
    ]);
  });

  it("writes a waiting window as the customer does", () => {
    expect(
      texts(facts({ waiting: { start: time("07:30"), end: time("11:30"), endsNextDay: false, minutes: 240 } })),
    ).toEqual(["wachtuur 7:30 tot 11:30"]);
  });

  /** The stored window, as pricing reads it: the flag says the end is the next day. */
  it.each([
    ["ending the next day", time("22:00"), time("01:30"), 210, "wachtuur 22:00 tot 1:30"],
    ["explicitly the next day, at a later time than it began", time("10:00"), time("12:00"), 840, "wachtuur 10:00 tot 12:00"],
  ])("writes a window %s like any other, without a note", (_case, start, end, minutes, text) => {
    const written = toCustomerRemarkParts(facts({ waiting: { start, end, endsNextDay: true, minutes } }));

    expect(written.parts.map((part) => part.text)).toEqual([text]);
    expect(written.unexpressed).toEqual([]);
  });

  it.each([
    ["only a duration", null, null, 90],
    ["a begin without an end", time("10:00"), null, null],
    ["an end without a begin", null, time("12:00"), null],
  ])("does not write %s, and says so", (_case, start, end, minutes) => {
    const notWritten = toCustomerRemarkParts(facts({ waiting: { start, end, endsNextDay: false, minutes } }));

    expect(notWritten.parts).toEqual([]);
    expect(notWritten.unexpressed).toEqual([WAITING_NOT_WRITTEN_NOTE]);
  });

  it("says nothing about a Trip without a waiting time", () => {
    expect(
      toCustomerRemarkParts(facts({ waiting: { start: null, end: null, endsNextDay: false, minutes: null } }))
        .unexpressed,
    ).toEqual([]);
  });

  it("puts everything in one order: properties, tar, EC, wachtuur, GEEN COMBI", () => {
    expect(
      texts(
        facts({
          propertyNames: ["Flat"],
          tarCharged: true,
          ccNumbers: ["4157219"],
          waiting: { start: time("08:45"), end: time("11:00"), endsNextDay: false, minutes: 135 },
          geenCombi: true,
        }),
      ),
    ).toEqual(["flat", "tar", "EC 4157219", "wachtuur 8:45 tot 11:00", "GEEN COMBI"]);
  });
});
