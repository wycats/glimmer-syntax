// eslint-disable-next-line import/no-extraneous-dependencies
import { assert } from '../../utils/assert';
import { existing } from '../../utils/exists';
import type { SourcePosition } from '../../v1/api';
import { UNKNOWN_POSITION } from '../location';
import type { SourceTemplate } from '../source';
import { SourceSpan } from './source-span';

interface ConcretePosition {
  readonly template: SourceTemplate;
  readonly offset: number | null;

  toAST(): SourcePosition;
  verify(): boolean;

  move(chars: number): ConcretePosition;
}

export class OffsetPosition implements ConcretePosition {
  #pos: SourcePosition | null;
  readonly #offset: number;

  constructor(
    readonly template: SourceTemplate,
    offset: number,
    pos: SourcePosition | null = null
  ) {
    assert(
      template.check(offset),
      `offset must be in range of template. This shouldn't happen because @glimmer/syntax creates all of the offsets`
    );

    this.#offset = offset;
    this.#pos = pos;
  }

  get offset(): number {
    return this.#offset;
  }

  verify() {
    return this.template.check(this.#offset);
  }

  move(chars: number): ConcretePosition {
    return new OffsetPosition(this.template, this.#offset + chars, null);
  }

  /**
   * Convert the current character offset to an `HbsPosition`, if it was not already computed. Once
   * a `CharPosition` has computed its `HbsPosition`, it will not need to do compute it again, and
   * the same `CharPosition` is retained when used as one of the ends of a `SourceSpan`, so
   * computing the `HbsPosition` should be a one-time operation.
   */
  toAST(): SourcePosition {
    let pos = this.#pos;

    if (pos === null) {
      this.#pos = pos = existing(
        this.template.hbsPosFor(this.#offset),
        `converting a character offset to a source location should always work, since @glimmer/syntax constructs the character offsets`
      );
    }

    return pos;
  }
}

type AnyPosition = OffsetPosition | AstPosition | BrokenPosition;

export class BrokenPosition implements ConcretePosition {
  readonly offset = null;
  #pos: SourcePosition;
  #offset: number;

  constructor(readonly template: SourceTemplate, pos: SourcePosition, offset = 0) {
    this.#pos = pos;
    this.#offset = offset;
  }

  move(chars: number): BrokenPosition {
    return new BrokenPosition(this.template, this.#pos, this.#offset + chars);
  }

  verify(): boolean {
    return false;
  }

  toAST() {
    return this.#pos;
  }
}

export class AstPosition implements ConcretePosition {
  readonly #pos: SourcePosition;
  readonly #offset: number;
  #cache: BrokenPosition | OffsetPosition | null = null;

  constructor(readonly template: SourceTemplate, pos: SourcePosition, offset = 0) {
    this.#pos = pos;
    this.#offset = offset;
  }

  verify(): boolean {
    return this.#compute().verify();
  }

  move(chars: number): ConcretePosition {
    return new AstPosition(this.template, this.#pos, this.#offset + chars);
  }

  toAST(): SourcePosition {
    return this.#pos;
  }

  convert(): BrokenPosition | OffsetPosition {
    return this.#compute();
  }

  #compute(): BrokenPosition | OffsetPosition {
    let cache = this.#cache;

    if (cache === null) {
      let pos = this.template.charPosFor(this.#pos);

      if (pos === null) {
        this.#cache = cache = new BrokenPosition(this.template, this.#pos);
      } else {
        this.#cache = cache = new OffsetPosition(this.template, pos + this.#offset);
      }
    }

    return cache;
  }

  get offset(): number | null {
    return this.#compute().offset;
  }
}

export class SourceOffset {
  static from(template: SourceTemplate, pos: SourceOffset | SourcePosition): SourceOffset {
    if (pos instanceof SourceOffset) {
      return pos;
    } else {
      return SourceOffset.pos(template, pos);
    }
  }

  static broken(template: SourceTemplate, pos: SourcePosition): SourceOffset {
    return new SourceOffset(new BrokenPosition(template, pos));
  }

  static missing(template: SourceTemplate): SourceOffset {
    return new SourceOffset(new BrokenPosition(template, UNKNOWN_POSITION));
  }

  static offset(template: SourceTemplate, offset: number): SourceOffset {
    return new SourceOffset(new OffsetPosition(template, offset));
  }

  static pos(template: SourceTemplate, pos: SourcePosition): SourceOffset {
    return new SourceOffset(new AstPosition(template, pos));
  }

  #data: AnyPosition;

  constructor(data: AnyPosition) {
    this.#data = data;
  }

  get template(): SourceTemplate {
    return this.#data.template;
  }

  toAST(): SourcePosition {
    return this.#data.toAST();
  }

  /**
   * Get the character offset for this `SourceOffset`, if possible.
   */
  get offset(): number | null {
    return this.#data.offset;
  }

  /**
   * Create a span that starts from this source offset and ends with another source offset. Avoid
   * computing character offsets if both `SourceOffset`s are still lazy.
   */
  until(other: SourceOffset): SourceSpan {
    const template = this.template;

    return SourceSpan.from({
      template,
      offsets: {
        start: this,
        end: other,
      },
    });

    // switch (this.data.kind) {
    //   case OffsetKind.CharPosition:
    //     switch (other.data.kind) {
    //       case OffsetKind.CharPosition:
    //         return new SourceSpan(new CharPositionSpan(this.data.template, { start: this.data,  end: other.data }));
    //       case OffsetKind.HbsPosition:
    //         return new SourceSpan(new CharPositionSpan(this.data.template, { start: this.data,  end: other.data.toCharPos() }));
    //     }
    //   }
    // }
  }

  withEnd(other: SourceOffset): SourceSpan {
    return this.until(other);
  }

  /**
   * Create a `SourceOffset` by moving the character position represented by this source offset
   * forward or backward (if `by` is negative), if possible.
   *
   * If this `SourceOffset` can't compute a valid character offset, `move` returns a broken offset.
   *
   * If the resulting character offset is less than 0 or greater than the size of the source, `move`
   * returns a broken offset.
   */
  move(by: number): SourceOffset {
    if (by === 0) {
      return this;
    }

    const template = this.template;
    let offset = this.#data.offset;

    if (offset === null) {
      return SourceOffset.broken(template, this.#data.toAST());
    } else {
      let result = offset + by;

      if (template.check(result)) {
        return SourceOffset.offset(template, result);
      } else {
        return SourceOffset.broken(template, this.#data.toAST());
      }
    }
  }

  /**
   * Create a new `SourceSpan` that represents a collapsed range at this source offset. Avoid
   * computing the character offset if it has not already been computed.
   */
  collapsed(): SourceSpan {
    return SourceSpan.from({
      template: this.template,
      offsets: {
        start: this,
        end: this,
      },
    });
  }

  /**
   * Convert this `SourceOffset` into a Handlebars {@see SourcePosition} for
   * compatibility with existing plugins.
   *
   * This might produce broken source positions if the original AST node had a
   * broken position, so it should only be used informationally or in situations
   * where the original code would have to be tolerant of a broken position.
   */
  toJSON(): SourcePosition {
    return this.toAST();
  }
}
