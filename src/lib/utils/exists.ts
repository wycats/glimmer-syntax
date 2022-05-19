import { exhaustive } from './assert.js';

export type Optional<T> = T | null;
export type Maybe<T> = T | null | undefined | void;

export type ExistsOptions =
  | string
  | {
      var: string;
    }
  | {
      method: [head: string, members: string];
    };

function message(options: ExistsOptions): string {
  if (typeof options === 'string') {
    return options;
  }
  if ('var' in options) {
    return `Variable '${options.var}' is not defined`;
  }

  if ('method' in options) {
    return `The return value of \`${options.method[0]}.${options.method[1]}(...)\` is not defined`;
  }

  exhaustive(options, 'options');
}

export function exists<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function assertExists<T>(
  value: T | null | undefined,
  reason?: ExistsOptions
): asserts value is T {
  if (value === null || value === undefined) {
    throw Error(message(reason ?? 'Expected value to be defined'));
  }
}

export function existing<T>(value: T | null | undefined, reason?: ExistsOptions): T {
  assertExists(value, reason);
  return value;
}
