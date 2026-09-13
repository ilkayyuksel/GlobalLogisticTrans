import { CreateNoteDto } from "./create-note.dto";

/**
 * Changing a note replaces its text. A note has nothing else to change, so the
 * rules are exactly those of a new note: required, and not only whitespace.
 */
export class UpdateNoteDto extends CreateNoteDto {}
