/**
 * How a page's view state is written into its address and read back from it.
 *
 * A codec owns the query parameters it names and nothing else. It reads a
 * value that is always valid — anything malformed, unknown or absent becomes
 * the default — and writes the default as NO parameter, so an untouched page
 * keeps a clean address and an old link with a stale value still opens.
 */
export interface UrlStateCodec<TValue> {
  read(params: URLSearchParams): TValue;
  write(value: TValue, params: URLSearchParams): void;
}

function setOrDelete(params: URLSearchParams, name: string, raw: string | null) {
  if (raw === null) {
    params.delete(name);
  } else {
    params.set(name, raw);
  }
}

/** Free text: a search term, an id. Empty is the default. */
export function textParam(name: string): UrlStateCodec<string> {
  return {
    read: (params) => params.get(name) ?? "",
    write: (value, params) => setOrDelete(params, name, value === "" ? null : value),
  };
}

/** One of a fixed set of values; anything else reads as the default. */
export function choiceParam<TChoice extends string>(
  name: string,
  choices: readonly TChoice[],
  defaultValue: TChoice,
): UrlStateCodec<TChoice> {
  return {
    read: (params) => {
      const raw = params.get(name);

      return choices.includes(raw as TChoice) ? (raw as TChoice) : defaultValue;
    },
    write: (value, params) =>
      setOrDelete(params, name, value === defaultValue ? null : value),
  };
}

/** A page number: a whole number from 1. Page 1 is the default. */
export function pageParam(name = "page"): UrlStateCodec<number> {
  return {
    read: (params) => {
      const page = Number(params.get(name));

      return Number.isInteger(page) && page >= 1 ? page : 1;
    },
    write: (value, params) => setOrDelete(params, name, value === 1 ? null : String(value)),
  };
}

/** On or off, written only when it differs from the default. */
export function flagParam(name: string, defaultValue: boolean): UrlStateCodec<boolean> {
  return {
    read: (params) => {
      const raw = params.get(name);

      return raw === "1" ? true : raw === "0" ? false : defaultValue;
    },
    write: (value, params) =>
      setOrDelete(params, name, value === defaultValue ? null : value ? "1" : "0"),
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar day as `YYYY-MM-DD`; today is the default and is not written.
 *
 * The default is a function because "today" is not a constant. A day the user
 * chose is written and comes back exactly; a list never moved off today opens
 * on whatever today is when it is opened again, as it always has.
 */
export function dateParam(name: string, defaultValue: () => string): UrlStateCodec<string> {
  return {
    read: (params) => {
      const raw = params.get(name);

      return raw !== null && ISO_DATE.test(raw) ? raw : defaultValue();
    },
    write: (value, params) =>
      setOrDelete(params, name, value === defaultValue() ? null : value),
  };
}

/** Several parameters as one object — a filter bar's values, a sort. */
export function objectParams<TValue extends object>(fields: {
  [TKey in keyof TValue]: UrlStateCodec<TValue[TKey]>;
}): UrlStateCodec<TValue> {
  const entries = Object.entries(fields) as [keyof TValue, UrlStateCodec<unknown>][];

  return {
    read: (params) =>
      Object.fromEntries(entries.map(([key, codec]) => [key, codec.read(params)])) as TValue,
    write: (value, params) => {
      for (const [key, codec] of entries) {
        codec.write(value[key], params);
      }
    },
  };
}
