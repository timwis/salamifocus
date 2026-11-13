/**
 * Counts failed sign-ins across all clients. There is one owner and one
 * password, so a single shared budget is what limits guessing; once it is
 * spent, sign-in is refused until the oldest failure leaves the window.
 * Each attempt counts as failed until it succeeds, so concurrent guesses
 * cannot all slip in before the first one is checked.
 */
export class FailedSignIns {
  #failures: number[] = [];
  readonly limit: number;
  readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Starts an attempt, or returns the milliseconds to wait if none is allowed now. */
  attempt(now: Date): { retryAfterMs: number } | { succeeded(): void } {
    const since = now.getTime() - this.windowMs;
    this.#failures = this.#failures.filter((at) => at > since);
    if (this.#failures.length >= this.limit) return { retryAfterMs: this.#failures[0]! - since };
    const at = now.getTime();
    this.#failures.push(at);
    return {
      succeeded: () => {
        const index = this.#failures.indexOf(at);
        if (index >= 0) this.#failures.splice(index, 1);
      },
    };
  }
}
