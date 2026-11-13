/**
 * A business-rule refusal. It is recorded against the operation and
 * acknowledged to the client, never surfaced as a transport error, because an
 * error would leave the client's ordered upload queue stuck behind it.
 */
export class Rejection extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
