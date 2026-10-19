import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  buildPage,
  buildPricing,
  buildTrip,
  listCalls,
  mutationCalls,
  renderRitten,
  respondWith,
} from "./ritten-test-support";
import { ApiError, request } from "@/lib/api/client";
import type { RouteMatch, Trip } from "@/lib/api/types";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

jest.mock("@/lib/calendar/calendar-dates", () => ({
  ...jest.requireActual("@/lib/calendar/calendar-dates"),
  today: () => "2026-08-13",
}));

const requestMock = request as jest.MockedFunction<typeof request>;
const OPEN_LABEL = "Route kiezen";
const CHOICE_PATH = "/api/v1/trip-pricing/trip/trip-1/route-choice";

/** What the backend recorded about the Trip's route — `manualChoice` is ITS decision. */
function routeMatch(overrides: Partial<RouteMatch> = {}): RouteMatch {
  return {
    method: "NOT_FOUND",
    routePricingId: null,
    combinationRouteGroupId: null,
    combinationMatch: null,
    selection: "AUTOMATIC",
    manualChoice: "NORMAL",
    legs: [],
    overSt: null,
    reviewed: null,
    ...overrides,
  };
}

const ORDINARY = [
  { id: "route-lille", departure: "Quay 869", destination: "Lille", tarief: "333.00", toll: "12.00", hasToll: true, tunnel: "0.00", hasTunnel: true, type: "NORMAL", combinationGroupId: null, reviewed: true },
  { id: "route-mons", departure: "Quay 869", destination: "Mons", tarief: "444.00", toll: "0.00", hasToll: true, tunnel: "0.00", hasTunnel: true, type: "NORMAL", combinationGroupId: null, reviewed: true },
];

const COMBINATIONS = [
  {
    id: "combination-1",
    reviewed: true,
    overSt: { tarief: "40.00", toll: null, tunnel: null },
    legs: [
      { ...ORDINARY[0], id: "c1-out", type: "COMBINATION", combinationGroupId: "combination-1" },
      { ...ORDINARY[0], id: "c1-back", departure: "Lille", destination: "Quay 869", type: "COMBINATION", combinationGroupId: "combination-1" },
    ],
  },
];

describe("choosing a route from the Ritten list", () => {
  /** How the backend answers the choice: success unless a test says otherwise. */
  let answerChoice: (body: unknown) => Promise<unknown>;

  beforeEach(() => {
    requestMock.mockReset();
    window.localStorage.clear();
    answerChoice = () => Promise.resolve({ pricedTripIds: ["trip-1"] });
  });

  async function showTrip(match: RouteMatch, overrides: Partial<Trip> = {}) {
    respondWith(requestMock, {
      trips: buildPage([buildTrip({ status: "CLOSED", pricing: { ...buildPricing(), routeMatch: match }, ...overrides })]),
    });

    const support = requestMock.getMockImplementation()!;

    requestMock.mockImplementation((...args: Parameters<typeof request>) => {
      const [path, options] = args;

      if (path === CHOICE_PATH && options?.method === "POST") {
        return answerChoice(options.body) as ReturnType<typeof request>;
      }
      if (path === "/api/v1/route-configuration") {
        return Promise.resolve(ORDINARY) as ReturnType<typeof request>;
      }
      if (path === "/api/v1/route-configuration/combinations") {
        return Promise.resolve(COMBINATIONS) as ReturnType<typeof request>;
      }

      return support(...args);
    });

    renderRitten();
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("checkbox", { name: "Prijzen tonen" }));
  }

  const choiceCalls = () => mutationCalls(requestMock).filter(([path]) => path === CHOICE_PATH);
  const dialog = () => screen.getByRole("dialog");

  it("is offered where the backend allows a choice", async () => {
    await showTrip(routeMatch());

    expect(screen.getByRole("button", { name: OPEN_LABEL })).toBeInTheDocument();
  });

  it("is not offered where the automatic match is usable", async () => {
    await showTrip(routeMatch({ method: "EXACT", routePricingId: "route-1", manualChoice: null }));

    expect(screen.queryByRole("button", { name: OPEN_LABEL })).toBeNull();
  });

  /** 4. The routes, and nothing about what they cost. */
  it("lists the ordinary routes by their roads, without prices", async () => {
    await showTrip(routeMatch());
    await userEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));

    expect(await within(dialog()).findByRole("radio", { name: "Quay 869 → Lille" })).toBeInTheDocument();
    expect(within(dialog()).getByRole("radio", { name: "Quay 869 → Mons" })).toBeInTheDocument();
    expect(dialog()).not.toHaveTextContent("333.00");
    expect(dialog()).not.toHaveTextContent("444.00");
  });

  it("searches as the Routeprijzen page does", async () => {
    await showTrip(routeMatch());
    await userEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));
    await within(dialog()).findByRole("radio", { name: "Quay 869 → Lille" });

    await userEvent.type(within(dialog()).getByLabelText("Zoeken op Van of Naar"), "mons");

    expect(within(dialog()).queryByRole("radio", { name: "Quay 869 → Lille" })).toBeNull();
    expect(within(dialog()).getByRole("radio", { name: "Quay 869 → Mons" })).toBeInTheDocument();

    await userEvent.clear(within(dialog()).getByLabelText("Zoeken op Van of Naar"));
    await userEvent.type(within(dialog()).getByLabelText("Zoeken op Van of Naar"), "zzz");

    expect(within(dialog()).getByText("Geen routes gevonden.")).toBeInTheDocument();
  });

  it("sends the chosen ordinary route, then shows the list as the backend now prices it", async () => {
    await showTrip(routeMatch());
    const readsBefore = listCalls(requestMock).length;
    await userEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));
    await userEvent.click(await within(dialog()).findByRole("radio", { name: "Quay 869 → Lille" }));

    await userEvent.click(within(dialog()).getByRole("button", { name: "Route toepassen" }));

    expect(await screen.findByText(/Route gekozen en prijs berekend/)).toBeInTheDocument();
    expect(choiceCalls().map(([, options]) => options?.body)).toEqual([{ routePricingId: "route-lille" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(listCalls(requestMock).length).toBeGreaterThan(readsBefore));
  });

  it("lists Combinations for a grouped Trip, numbered as Routeprijzen numbers them", async () => {
    await showTrip(routeMatch({ combinationMatch: "PAIR_NOT_CONFIGURED", manualChoice: "COMBINATION" }), {
      tripGroupId: "group-1",
    });
    await userEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));

    const option = await within(dialog()).findByRole("radio", {
      name: "Combinatie #1: Quay 869 → Lille / Lille → Quay 869",
    });
    await userEvent.click(option);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Route toepassen" }));

    await screen.findByText(/Route gekozen en prijs berekend/);
    expect(choiceCalls().map(([, options]) => options?.body)).toEqual([{ combinationRouteGroupId: "combination-1" }]);
  });

  /** The backend could not tell from the roads: only then is the operator asked. */
  it("asks which leg this Trip is when the backend needs it, and sends it", async () => {
    let attempts = 0;
    answerChoice = () =>
      (attempts += 1) === 1
        ? Promise.reject(new ApiError("UNPROCESSABLE_ENTITY", "Kies of deze rit Leg 1 of Leg 2 van de combinatie is.", 422))
        : Promise.resolve({ pricedTripIds: ["trip-1", "trip-2"] });
    await showTrip(routeMatch({ combinationMatch: "PAIR_NOT_CONFIGURED", manualChoice: "COMBINATION" }), {
      tripGroupId: "group-1",
    });
    await userEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));
    await userEvent.click(await within(dialog()).findByRole("radio", { name: /Combinatie #1/ }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Route toepassen" }));

    expect(await within(dialog()).findByText("Welke leg van de combinatie is deze rit?")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Route toepassen" })).toBeDisabled();

    await userEvent.click(within(dialog()).getByRole("radio", { name: "Leg 2" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Route toepassen" }));

    await screen.findByText(/Route gekozen en prijs berekend/);
    expect(choiceCalls().map(([, options]) => options?.body)).toEqual([
      { combinationRouteGroupId: "combination-1" },
      { combinationRouteGroupId: "combination-1", legPosition: 2 },
    ]);
  });

  it("keeps the dialog open with the backend's reason when the choice is refused", async () => {
    answerChoice = () =>
      Promise.reject(new ApiError("CONFLICT", "De gekozen route kon niet op de rit worden toegepast; er is niets gewijzigd.", 409));
    await showTrip(routeMatch());
    await userEvent.click(screen.getByRole("button", { name: OPEN_LABEL }));
    await userEvent.click(await within(dialog()).findByRole("radio", { name: "Quay 869 → Lille" }));

    await userEvent.click(within(dialog()).getByRole("button", { name: "Route toepassen" }));

    expect(await within(dialog()).findByRole("alert")).toHaveTextContent("er is niets gewijzigd");
    expect(screen.queryByText(/Route gekozen en prijs berekend/)).toBeNull();
  });

  /** A price from a chosen route says so; it is never shown as "not found". */
  it("marks a price that came from a chosen route", async () => {
    await showTrip(
      routeMatch({
        selection: "MANUAL",
        routePricingId: "route-lille",
        legs: [{ legPosition: null, isPricedLeg: true, routePricingId: "route-lille", departure: "Quay 869", destination: "Lille", method: "NOT_FOUND" }],
      }),
    );

    const hint = screen.getByRole("img", { name: /^Route-match:/ });

    expect(hint).toHaveAttribute("data-route-match", "manual");
    expect(hint.getAttribute("title")).toContain("Handmatig gekozen route");
    expect(hint.getAttribute("title")).toContain("Quay 869 → Lille");
    expect(hint.getAttribute("title")).not.toContain("Geen");
  });
});
