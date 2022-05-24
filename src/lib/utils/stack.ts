import { assert } from 'console';

import type { PresentArray } from './array';
import { existing } from './exists.js';

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

export class PresentStack<T extends object> extends Array<T> {
  static create<T extends object>(initial: T): PresentStack<T> {
    return new PresentStack([initial]);
  }

  readonly #items: PresentArray<T>;

  private constructor(items: PresentArray<T>) {
    super(...items);
    this.#items = items;
  }

  get initial(): T {
    return this.#items[0];
  }

  get current(): T {
    return this.#items[this.#items.length - 1];
  }

  push(item: T): number {
    return this.#items.push(item);
  }

  pop(): T {
    assert(this.#items.length > 1, `Cannot pop the initial entry from a PresentStack`);

    return this.#items.pop() as T;
  }

  toArray(): PresentArray<T> {
    return this.#items;
  }
}
