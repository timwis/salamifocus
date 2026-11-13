export function titleFromCapture(text: string): string {
  return text.trim();
}

export function normaliseTitle(title: string): string {
  return title.trim();
}

/** Returns a user-facing reason the title is unacceptable, or null if it is fine. */
export function titleProblem(title: string): string | null {
  if (normaliseTitle(title) === '') return 'A task needs a title.';
  return null;
}

/** A note that is only whitespace is no note. */
export function normaliseNote(note: string): string {
  return note.trim() === '' ? '' : note;
}

export function captureProblem(text: string): string | null {
  if (text.trim() === '') return 'There is nothing to capture.';
  return null;
}
