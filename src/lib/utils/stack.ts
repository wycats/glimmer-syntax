import { existing } from "./exists.js";

export class Stack<T extends object> {
  static empty<T extends object>(): Stack<T> {
    return new Stack([]);
  }

  static from<T extends object>(items: T[]): Stack<T> {
    return new Stack(items);
  }

  readonly #items: T[];

  private constructor(items: T[]) {
    this.#items = items;
  }

  get current(): T | null {
    if (this.#items.length === 0) {
      return null;
    } else {
      return this.#items[this.#items.length - 1];
    }
  }

  isEmpty() {
    return this.#items.length === 0;
  }

  push(item: T): void {
    this.#items.push(item);
  }

  pop(): T {
    const last = this.#items.pop();
    return existing(
      last,
      `When popping a stack: expected the stack to have items, but it was empty`
    );
  }

  toArray(): T[] {
    return this.#items;
  }
}
