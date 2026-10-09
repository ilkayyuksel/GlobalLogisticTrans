import { act, render, screen } from "@testing-library/react";

import { useAsync } from "./use-async";
import { isPageIdle, onPageIdle } from "@/lib/navigation/page-loads";

/**
 * I. "The page has drawn what it loaded" — the signal restoration waits for.
 *
 * `useAsync` reports a load from its first render until the render that SHOWS
 * its outcome has been committed. So when the page turns idle, the rows are in
 * the DOM already, and the position can be measured against them.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, resolve, reject };
}

function Rows({ load }: { load: () => Promise<string[]> }) {
  const rows = useAsync(load, []);

  if (rows.isLoading) {
    return <p>Laden…</p>;
  }

  return (
    <ul>
      {(rows.data ?? []).map((row) => (
        <li key={row}>{row}</li>
      ))}
    </ul>
  );
}

describe("useAsync and the page-load signal", () => {
  it("is pending while the page shows its loading placeholder", () => {
    render(<Rows load={() => new Promise(() => undefined)} />);

    expect(screen.getByText("Laden…")).toBeInTheDocument();
    expect(isPageIdle()).toBe(false);
  });

  it("turns idle only once the rows are in the DOM", async () => {
    const response = deferred<string[]>();
    let rowsWhenIdle = -1;
    const stop = onPageIdle(() => {
      rowsWhenIdle = document.querySelectorAll("li").length;
    });
    render(<Rows load={() => response.promise} />);

    await act(async () => response.resolve(["a", "b", "c"]));

    expect(rowsWhenIdle).toBe(3);
    expect(isPageIdle()).toBe(true);
    stop();
  });

  it("turns idle after a failed load too, so a restore never waits forever", async () => {
    const response = deferred<string[]>();
    render(<Rows load={() => response.promise} />);

    await act(async () => response.reject(new Error("unreachable")));

    expect(isPageIdle()).toBe(true);
  });

  it("releases a load whose page was left before it answered", () => {
    const { unmount } = render(<Rows load={() => new Promise(() => undefined)} />);

    unmount();

    expect(isPageIdle()).toBe(true);
  });
});
