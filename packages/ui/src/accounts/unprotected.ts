// Saving a password where nothing would protect it (docs/plans/desktop.md#D74):
// the shell asks before it writes anything, and the UI asks the user.
// Outside React, as `SignIn` is, so the shell's secret store can wait on it.

/** How to keep a password no keyring protects: until the app quits, or saved as it is. */
export type UnprotectedChoice = "until-quit" | "unprotected";

/**
 * The question, between a shell's secret store and the UI's dialog: the
 * store `ask`s and waits, the dialog shows while something is `asking` and
 * `answer`s. Questions asked together are answered one after another.
 */
export class UnprotectedPrompt {
  readonly #waiting: ((choice: UnprotectedChoice) => void)[] = [];
  readonly #listeners = new Set<() => void>();

  /** Asks the user; resolves with their choice. */
  ask(): Promise<UnprotectedChoice> {
    return new Promise((resolve) => {
      this.#waiting.push(resolve);
      if (this.#waiting.length === 1) this.#changed();
    });
  }

  get asking(): boolean {
    return this.#waiting.length > 0;
  }

  /** Answers the question shown; nothing when none is. */
  answer(choice: UnprotectedChoice): void {
    const resolve = this.#waiting.shift();
    if (!resolve) return;
    resolve(choice);
    this.#changed();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}
