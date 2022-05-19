export type Dict<T = unknown> = Record<string, T>;

export function dict<T>(): Dict<T> {
  return Object.create(null) as Dict<T>;
}
