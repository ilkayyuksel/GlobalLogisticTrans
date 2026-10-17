import { toCustomerRemarkParts, type RemarkFacts } from "./customer-remark-vocabulary";

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

  it("does not write a waiting time the customer has no spelling for, and says so", () => {
    const overnight = toCustomerRemarkParts(
      facts({ waiting: { start: time("22:00"), end: time("01:30"), endsNextDay: true, minutes: 210 } }),
    );
    const durationOnly = toCustomerRemarkParts(
      facts({ waiting: { start: null, end: null, endsNextDay: false, minutes: 90 } }),
    );

    expect(overnight.parts).toEqual([]);
    expect(overnight.unexpressed).toHaveLength(1);
    expect(durationOnly.parts).toEqual([]);
    expect(durationOnly.unexpressed).toHaveLength(1);
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
