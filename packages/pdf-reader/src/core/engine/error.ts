export type PdfLoadFailure =
  | "unreadable"
  | "invalid"
  | "password-required"
  | "password-incorrect"
  | "aborted"
  | "engine-disposed";

export class PdfLoadError extends Error {
  override readonly name = "PdfLoadError";
  readonly reason: PdfLoadFailure;

  constructor(reason: PdfLoadFailure, options?: ErrorOptions) {
    super(`The PDF could not be loaded: ${reason}`, options);
    this.reason = reason;
  }
}
