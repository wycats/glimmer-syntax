export function isPresent<T>(value: T[]): value is [T, ...T[]] {
  return value.length > 0;
}

export type PresentArray<T = unknown> = [T, ...T[]];
