import type { DeclaredAt } from '../v1/api';
import type { NormalizedPreprocessOptions } from './preprocess';

export class Scope {
  static top(options: NormalizedPreprocessOptions, locals?: string[]): Scope {
    return new Scope(options, new Set(locals ?? []));
  }

  #options: NormalizedPreprocessOptions;
  #locals: Set<string>;

  constructor(options: NormalizedPreprocessOptions, locals: Set<string>) {
    this.#options = options;
    this.#locals = locals;
  }

  get options(): NormalizedPreprocessOptions {
    return this.#options;
  }

  child(locals: string[]): Scope {
    return new Scope(this.#options, merge(this.#locals, locals));
  }

  declaration(name: string): DeclaredAt {
    if (this.#locals.has(name)) {
      return 'internal';
    } else if (this.#options.embedder.hasBinding(name)) {
      return 'embedder';
    } else {
      return 'free';
    }
  }
}

function merge(left: Set<string>, right: string[]) {
  const result = new Set(left);

  right.forEach((item) => result.add(item));

  return result;
}
