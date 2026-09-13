import { request } from "./client";

/**
 * The Notes endpoints. A note is its text: no title, category, tag, priority,
 * deadline or status.
 */

const NOTES_PATH = "/api/v1/notes";

export interface Note {
  id: string;
  /** Plain text, line breaks kept. */
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** Exactly `CreateNoteDto` and `UpdateNoteDto`. */
export interface NotePayload {
  content: string;
}

/** Every note, ordered by the backend: the most recently changed first. */
export function listNotes(signal?: AbortSignal): Promise<Note[]> {
  return request<Note[]>(NOTES_PATH, { signal });
}

export function createNote(payload: NotePayload, signal?: AbortSignal): Promise<Note> {
  return request<Note>(NOTES_PATH, { method: "POST", body: payload, signal });
}

export function updateNote(
  noteId: string,
  payload: NotePayload,
  signal?: AbortSignal,
): Promise<Note> {
  return request<Note>(`${NOTES_PATH}/${noteId}`, {
    method: "PATCH",
    body: payload,
    signal,
  });
}

/** Answers with the note that was removed. */
export function deleteNote(noteId: string, signal?: AbortSignal): Promise<Note> {
  return request<Note>(`${NOTES_PATH}/${noteId}`, { method: "DELETE", signal });
}
