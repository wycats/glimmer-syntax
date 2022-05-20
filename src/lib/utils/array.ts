export function isPresent<T>(value: T[]): value is [T, ...T[]] {
  return value.length > 0;
}

export function assertPresent<T>(value: T[]): [T, ...T[]] {
  if (!isPresent(value)) {
    throw new Error('Expected value to be present');
  }

  return value;
}

export type PresentArray<T = unknown> = [T, ...T[]];
