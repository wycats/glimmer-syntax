export function assert(condition: any, message: string): asserts condition {
  if (!condition) {
    debugger;
    throw Error(message);
  }
}

/**
 * This is for situations where the local control flow makes it obvious that a
 * condition is true, even when TypeScript or ESLint doesn't notice.
 */
export function invariant(condition: any): asserts condition {
  if (!condition) {
    throw new Error('Assertion failed');
  }
}

export function deprecate(message: string) {
  console.warn(message);
}

export function exhaustive(_value: never, reason?: string): never {
  throw new Error(
    `Expected exhaustive case to be handled${
      reason ? `(${reason})` : ''
    }. This error should never occur if there are no TypeScript errors.`
  );
}

export type Assert<T, U> = U extends T ? void : never;

export function assertType<U>(_value: U): void {}
export function assertTypes<T extends unknown[]>(..._values: T): void {}
