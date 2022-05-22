import type { Scope } from '../parser/scope';
import type { SourceSpan } from '../source/loc/source-span.js';
import type { PathExpression, PathHead } from './nodes-v1';
import { Phase1Builder } from './parser-builders';

export class PathExpressionImplV1 implements PathExpression {
  type: 'PathExpression' = 'PathExpression';
  public parts: string[];
  public this = false;
  public data = false;
  private scope: Scope;
  private builder: Phase1Builder;

  constructor(
    public original: string,
    head: PathHead,
    tail: string[],
    public loc: SourceSpan,
    scope: Scope
  ) {
    let parts = tail.slice();

    if (head.type === 'ThisHead') {
      this.this = true;
    } else if (head.type === 'AtHead') {
      this.data = true;
      parts.unshift(head.name.slice(1));
    } else {
      parts.unshift(head.name);
    }

    this.parts = parts;
    this.scope = scope;
    this.builder = Phase1Builder.withScope(loc.getTemplate(), this.scope);
  }

  // Cache for the head value.
  #head?: PathHead = undefined;

  get head(): PathHead {
    if (this.#head) {
      return this.#head;
    }

    let firstPart: string;

    if (this.this) {
      firstPart = 'this';
    } else if (this.data) {
      firstPart = `@${this.parts[0]}`;
    } else {
      firstPart = this.parts[0];
    }

    let firstPartLoc = this.loc.collapse('start').sliceStartChars({
      chars: firstPart.length,
    });

    return (this.#head = this.builder.head(firstPart, firstPartLoc));
  }

  get tail(): string[] {
    return this.this ? this.parts : this.parts.slice(1);
  }

  toJSON(): PathExpression {
    return {
      type: 'PathExpression',
      original: this.original,
      head: this.head,
      tail: this.tail,

      this: this.this,
      parts: this.parts,
      data: this.data,
      loc: this.loc,
    };
  }
}
