export class EventLog<A> extends Array<A> {
  readonly #waiters = new Map<number, Set<() => void>>();

  override push(...events: A[]) {
    const count = super.push(...events);
    for (const [minimum, listeners] of this.#waiters) {
      if (count >= minimum) {
        this.#waiters.delete(minimum);
        for (const listener of listeners) {
          listener();
        }
      }
    }
    return count;
  }

  waitForCount(minimum: number) {
    if (this.length >= minimum) {
      return Promise.resolve();
    }
    const completion = Promise.withResolvers<void>();
    const listeners = this.#waiters.get(minimum) ?? new Set();
    listeners.add(completion.resolve);
    this.#waiters.set(minimum, listeners);
    return completion.promise;
  }
}
