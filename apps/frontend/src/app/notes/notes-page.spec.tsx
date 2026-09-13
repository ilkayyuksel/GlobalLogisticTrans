import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NotesPage from "./page";
import { ApiError, request } from "@/lib/api/client";
import type { Note } from "@/lib/api/notes";
import { LanguageProvider } from "@/lib/i18n/language-provider";
import { ThemeProvider } from "@/lib/theme/theme-provider";

jest.mock("@/lib/api/client", () => ({
  ...jest.requireActual("@/lib/api/client"),
  request: jest.fn(),
}));

const requestMock = request as jest.MockedFunction<typeof request>;
const PATH = "/api/v1/notes";

type Init = { method?: string; body?: { content?: string } };

/** The fake backend's store. It outlives a render, as the database outlives a page. */
let stored: Note[];
let refusal: ApiError | null;
let clock: number;

function stamp(): string {
  clock += 60_000;

  return new Date(clock).toISOString();
}

function note(id: string, content: string): Note {
  const at = stamp();

  return { id, content, createdAt: at, updatedAt: at };
}

/** Answers like the backend: most recently changed first. */
function fakeBackend(path: string, init: Init = {}): Promise<unknown> {
  const method = init.method ?? "GET";

  if (method === "GET") {
    return Promise.resolve(
      [...stored].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    );
  }

  if (refusal) {
    return Promise.reject(refusal);
  }

  const content = init.body?.content ?? "";

  if (method === "POST") {
    const created = note(`note-${stored.length + 1}`, content);

    stored.push(created);

    return Promise.resolve(created);
  }

  const index = stored.findIndex((item) => item.id === path.slice(PATH.length + 1));

  if (index === -1) {
    return Promise.reject(new ApiError("NOT_FOUND", "No such note.", 404));
  }

  if (method === "PATCH") {
    stored[index] = { ...stored[index], content, updatedAt: stamp() };

    return Promise.resolve(stored[index]);
  }

  const [removed] = stored.splice(index, 1);

  return Promise.resolve(removed);
}

function writes(method: "POST" | "PATCH" | "DELETE") {
  return requestMock.mock.calls.filter(
    ([, init]) => (init as Init | undefined)?.method === method,
  );
}

function renderNotes() {
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <NotesPage />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

/** The listed texts, top to bottom, exactly as rendered. */
function listed(): string[] {
  return screen
    .queryAllByRole("listitem")
    .map((item) => item.querySelector("p")?.textContent ?? "");
}

async function openNew(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: "+ Nieuwe notitie" }));

  return screen.findByRole("dialog", { name: "Nieuwe notitie" });
}

async function addNote(text: string): Promise<void> {
  const dialog = await openNew();

  await userEvent.type(within(dialog).getByLabelText("Tekst"), text);
  await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

describe("Notities", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockImplementation((...args: unknown[]) =>
      fakeBackend(args[0] as string, args[1] as Init | undefined),
    );
    stored = [];
    refusal = null;
    clock = Date.parse("2026-09-13T08:00:00.000Z");
    window.localStorage.clear();
  });

  it("shows every note, most recently changed first, as the backend answers", async () => {
    stored = [note("a", "Reserve chauffeur bellen"), note("b", "APK documenten nakijken")];
    renderNotes();

    await screen.findByText("APK documenten nakijken");

    expect(listed()).toEqual(["APK documenten nakijken", "Reserve chauffeur bellen"]);
  });

  it("says so when there are no notes", async () => {
    renderNotes();

    expect(await screen.findByText("Nog geen notities.")).toBeInTheDocument();
  });

  /** A note is text: the form asks for nothing else. */
  it("asks only for text", async () => {
    renderNotes();
    const dialog = await openNew();

    expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
    expect(within(dialog).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
  });

  describe("adding a note", () => {
    it("stores the text and shows it in the list", async () => {
      renderNotes();

      await addNote("Reserve chauffeur bellen");

      expect(writes("POST")).toEqual([
        [
          PATH,
          expect.objectContaining({
            method: "POST",
            body: { content: "Reserve chauffeur bellen" },
          }),
        ],
      ]);
      expect(await screen.findByText("Reserve chauffeur bellen")).toBeInTheDocument();
    });

    it("saves the text exactly, line breaks included", async () => {
      renderNotes();

      await addNote("Bellen:{enter}- Jan{enter}- Piet");

      expect(writes("POST")[0][1]).toMatchObject({
        body: { content: "Bellen:\n- Jan\n- Piet" },
      });
      await screen.findByText("Bellen: - Jan - Piet");
      expect(listed()).toEqual(["Bellen:\n- Jan\n- Piet"]);
    });

    it("refuses an empty note", async () => {
      renderNotes();
      const dialog = await openNew();

      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      expect(within(dialog).getByRole("alert")).toHaveTextContent("Vul een tekst in.");
      expect(writes("POST")).toHaveLength(0);
    });

    it("refuses a note of only whitespace", async () => {
      renderNotes();
      const dialog = await openNew();

      await userEvent.type(within(dialog).getByLabelText("Tekst"), "   {enter}  ");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      expect(within(dialog).getByRole("alert")).toHaveTextContent("Vul een tekst in.");
      expect(writes("POST")).toHaveLength(0);
    });

    it("shows the backend's refusal and keeps the text", async () => {
      refusal = new ApiError("BAD_REQUEST", "content must not be empty", 400);
      renderNotes();
      const dialog = await openNew();

      await userEvent.type(within(dialog).getByLabelText("Tekst"), "Bellen");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "content must not be empty",
      );
      expect(within(dialog).getByLabelText("Tekst")).toHaveValue("Bellen");
    });

    it("sends nothing when cancelled", async () => {
      renderNotes();
      const dialog = await openNew();

      await userEvent.type(within(dialog).getByLabelText("Tekst"), "Bellen");
      await userEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(writes("POST")).toHaveLength(0);
      expect(await screen.findByText("Nog geen notities.")).toBeInTheDocument();
    });
  });

  describe("changing a note", () => {
    beforeEach(() => {
      stored = [note("a", "Reserve chauffeur bellen")];
    });

    async function openEdit(): Promise<HTMLElement> {
      renderNotes();
      await userEvent.click(
        await screen.findByRole("button", { name: "Bewerken: Reserve chauffeur bellen" }),
      );

      return screen.findByRole("dialog", { name: "Notitie bewerken" });
    }

    it("offers an edit action per note, with a tooltip", async () => {
      renderNotes();

      expect(
        await screen.findByRole("button", { name: "Bewerken: Reserve chauffeur bellen" }),
      ).toHaveAttribute("title", "Bewerken");
    });

    it("opens the textarea with the current text", async () => {
      const dialog = await openEdit();

      expect(within(dialog).getByLabelText("Tekst")).toHaveValue("Reserve chauffeur bellen");
    });

    it("saves the new text", async () => {
      const dialog = await openEdit();

      await userEvent.clear(within(dialog).getByLabelText("Tekst"));
      await userEvent.type(within(dialog).getByLabelText("Tekst"), "APK documenten nakijken");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
      expect(writes("PATCH")[0]).toEqual([
        `${PATH}/a`,
        expect.objectContaining({
          method: "PATCH",
          body: { content: "APK documenten nakijken" },
        }),
      ]);
      expect(await screen.findByText("APK documenten nakijken")).toBeInTheDocument();
      expect(screen.queryByText("Reserve chauffeur bellen")).not.toBeInTheDocument();
    });

    it("changes nothing when cancelled", async () => {
      const dialog = await openEdit();

      await userEvent.clear(within(dialog).getByLabelText("Tekst"));
      await userEvent.type(within(dialog).getByLabelText("Tekst"), "Iets anders");
      await userEvent.click(within(dialog).getByRole("button", { name: "Annuleren" }));

      expect(writes("PATCH")).toHaveLength(0);
      expect(listed()).toEqual(["Reserve chauffeur bellen"]);
    });

    it("refuses text of only whitespace", async () => {
      const dialog = await openEdit();

      await userEvent.clear(within(dialog).getByLabelText("Tekst"));
      await userEvent.type(within(dialog).getByLabelText("Tekst"), "  ");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));

      expect(within(dialog).getByRole("alert")).toHaveTextContent("Vul een tekst in.");
      expect(writes("PATCH")).toHaveLength(0);
    });
  });

  describe("deleting a note", () => {
    beforeEach(() => {
      stored = [note("a", "Reserve chauffeur bellen"), note("b", "APK documenten nakijken")];
    });

    async function askToDelete(): Promise<HTMLElement> {
      renderNotes();
      await userEvent.click(
        await screen.findByRole("button", { name: "Verwijderen: Reserve chauffeur bellen" }),
      );

      return screen.findByRole("dialog", { name: "Notitie verwijderen" });
    }

    it("offers a delete action per note, with a tooltip", async () => {
      renderNotes();

      expect(
        await screen.findByRole("button", { name: "Verwijderen: Reserve chauffeur bellen" }),
      ).toHaveAttribute("title", "Verwijderen");
    });

    it("asks first, naming the note", async () => {
      const confirmation = await askToDelete();

      expect(within(confirmation).getByText("Reserve chauffeur bellen")).toBeInTheDocument();
      expect(writes("DELETE")).toHaveLength(0);
    });

    it("removes it from the list and leaves the others", async () => {
      const confirmation = await askToDelete();

      await userEvent.click(within(confirmation).getByRole("button", { name: "Verwijderen" }));

      await waitFor(() => expect(writes("DELETE")).toHaveLength(1));
      expect(writes("DELETE")[0][0]).toBe(`${PATH}/a`);
      await waitFor(() => expect(listed()).toEqual(["APK documenten nakijken"]));
    });

    it("keeps it when the confirmation is cancelled", async () => {
      const confirmation = await askToDelete();

      await userEvent.click(within(confirmation).getByRole("button", { name: "Annuleren" }));

      expect(writes("DELETE")).toHaveLength(0);
      expect(listed()).toEqual(["APK documenten nakijken", "Reserve chauffeur bellen"]);
    });
  });

  /** A refresh asks the backend again: what was stored comes back. */
  describe("after a refresh", () => {
    it("shows what was added, changed and deleted", async () => {
      const first = renderNotes();

      await addNote("Reserve chauffeur bellen");
      await addNote("APK documenten nakijken");
      await userEvent.click(
        screen.getByRole("button", { name: "Bewerken: APK documenten nakijken" }),
      );
      const dialog = await screen.findByRole("dialog", { name: "Notitie bewerken" });
      await userEvent.clear(within(dialog).getByLabelText("Tekst"));
      await userEvent.type(within(dialog).getByLabelText("Tekst"), "APK documenten versturen");
      await userEvent.click(within(dialog).getByRole("button", { name: "Opslaan" }));
      await screen.findByText("APK documenten versturen");
      first.unmount();

      const postsBefore = writes("POST").length;
      renderNotes();

      await screen.findByText("APK documenten versturen");
      expect(listed()).toEqual(["APK documenten versturen", "Reserve chauffeur bellen"]);
      // Nothing was written again: the second page read what was stored.
      expect(writes("POST")).toHaveLength(postsBefore);
    });
  });

  describe("several notes", () => {
    it("keeps them apart when adding, changing and deleting", async () => {
      renderNotes();

      await addNote("Reserve chauffeur bellen");
      await addNote("APK documenten nakijken");
      await waitFor(() =>
        expect(listed()).toEqual(["APK documenten nakijken", "Reserve chauffeur bellen"]),
      );

      await userEvent.click(
        screen.getByRole("button", { name: "Verwijderen: APK documenten nakijken" }),
      );
      const confirmation = await screen.findByRole("dialog", { name: "Notitie verwijderen" });
      await userEvent.click(within(confirmation).getByRole("button", { name: "Verwijderen" }));

      await waitFor(() => expect(listed()).toEqual(["Reserve chauffeur bellen"]));
    });
  });
});
