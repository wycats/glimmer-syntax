// eslint-disable-next-line import/no-extraneous-dependencies
import type { SourcePosition } from '../../v1/api';
import { UNKNOWN_POSITION } from '../location';
import type { SourceTemplate } from '../source';
import { type AbsentOffset, type BrokenOffset, IsAbsent, OffsetKind } from './kind.js';
import { type Pattern, match, MatchAny } from './match';
import type { SourceSpan } from './span';
import { span } from './span';

export function patternFor(kind: OffsetKind): Pattern {
  switch (kind) {
    case OffsetKind.BrokenLocation:
    case OffsetKind.SyntheticSource:
    case OffsetKind.EmptySource:
      return IsAbsent;
    default:
      return kind;
  }
}

/**
 * All positions have these details in common. Most notably, all three kinds of positions can
 * must be able to attempt to convert themselves into {@see CharPosition}.
 */
export interface PositionData {
  readonly kind: OffsetKind;
  toCharPos(): CharPosition | null;
  toJSON(): SourcePosition;
}

/**
 * Used to indicate that an attempt to convert a `SourcePosition` to a character offset failed. It
 * is separate from `null` so that `null` can be used to indicate that the computation wasn't yet
 * attempted (and therefore to cache the failure)
 */
export const BROKEN = 'BROKEN';
export type BROKEN = 'BROKEN';

export type AnyPosition = HbsPosition | CharPosition | AbsentPosition;

/**
 * A `SourceOffset` represents a single position in the source.
 *
 * There are three kinds of backing data for `SourceOffset` objects:
 *
 * - `CharPosition`, which contains a character offset into the raw source string
 * - `HbsPosition`, which contains a `SourcePosition` from the Handlebars AST, which can be
 *   converted to a `CharPosition` on demand.
 * - `InvisiblePosition`, which represents a position not in source (@see {InvisiblePosition})
 */
export class SourceOffset {
  /**
   * Create a `SourceOffset` from a Handlebars `SourcePosition`. It's stored as-is, and converted
   * into a character offset on demand, which avoids unnecessarily computing the offset of every
   * `SourceLocation`, but also means that broken `SourcePosition`s are not always detected.
   */
  static forHbsPos(template: SourceTemplate, pos: SourcePosition): SourceOffset {
    return new HbsPosition(template, pos, null).wrap();
  }

  /**
   * Create a `SourceOffset` that corresponds to a broken `SourcePosition`. This means that the
   * calling code determined (or knows) that the `SourceLocation` doesn't correspond correctly to
   * any part of the source.
   */
  static broken(template: SourceTemplate, pos: SourcePosition = UNKNOWN_POSITION): SourceOffset {
    return new AbsentPosition(OffsetKind.BrokenLocation, pos, template).wrap();
  }

  constructor(readonly data: PositionData & AnyPosition) {}

  /**
   * Get the character offset for this `SourceOffset`, if possible.
   */
  get offset(): number | null {
    let charPos = this.data.toCharPos();
    return charPos === null ? null : charPos.offset;
  }

  /**
   * Compare this offset with another one.
   *
   * If both offsets are `HbsPosition`s, they're equivalent as long as their lines and columns are
   * the same. This avoids computing offsets unnecessarily.
   *
   * Otherwise, two `SourceOffset`s are equivalent if their successfully computed character offsets
   * are the same.
   */
  eql(right: SourceOffset): boolean {
    return eql(this.data, right.data);
  }

  /**
   * Create a span that starts from this source offset and ends with another source offset. Avoid
   * computing character offsets if both `SourceOffset`s are still lazy.
   */
  until(other: SourceOffset): SourceSpan {
    return span(this.data, other.data);
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
    let charPos = this.data.toCharPos();

    if (charPos === null) {
      return SourceOffset.broken(this.data.template);
    } else {
      let result = charPos.offset + by;

      if (charPos.template.check(result)) {
        return new CharPosition(charPos.template, result).wrap();
      } else {
        return SourceOffset.broken(this.data.template);
      }
    }
  }

  /**
   * Create a new `SourceSpan` that represents a collapsed range at this source offset. Avoid
   * computing the character offset if it has not already been computed.
   */
  collapsed(): SourceSpan {
    return span(this.data, this.data);
  }

  /**
   * Convert this `SourceOffset` into a Handlebars {@see SourcePosition} for compatibility with
   * existing plugins.
   */
  toJSON(): SourcePosition {
    return this.data.toJSON();
  }
}

export class CharPosition implements PositionData {
  readonly kind = OffsetKind.CharPosition;

  /** Computed from char offset */
  _locPos: HbsPosition | BROKEN | null = null;

  constructor(readonly template: SourceTemplate, readonly charPos: number) {}

  /**
   * This is already a `CharPosition`.
   *
   * {@see HbsPosition} for the alternative.
   *
   * @implements {PositionData}
   */
  toCharPos(): CharPosition {
    return this;
  }

  /**
   * Produce a Handlebars {@see SourcePosition} for this `CharPosition`. If this `CharPosition` was
   * computed using {@see SourceOffset#move}, this will compute the `SourcePosition` for the offset.
   *
   * @implements {PositionData}
   */
  toJSON(): SourcePosition {
    let hbs = this.toHbsPos();
    return hbs === null ? UNKNOWN_POSITION : hbs.toJSON();
  }

  wrap(): SourceOffset {
    return new SourceOffset(this);
  }

  /**
   * A `CharPosition` always has an offset it can produce without any additional computation.
   */
  get offset(): number {
    return this.charPos;
  }

  /**
   * Convert the current character offset to an `HbsPosition`, if it was not already computed. Once
   * a `CharPosition` has computed its `HbsPosition`, it will not need to do compute it again, and
   * the same `CharPosition` is retained when used as one of the ends of a `SourceSpan`, so
   * computing the `HbsPosition` should be a one-time operation.
   */
  toHbsPos(): HbsPosition | null {
    let locPos = this._locPos;

    if (locPos === null) {
      let hbsPos = this.template.hbsPosFor(this.charPos);

      if (hbsPos === null) {
        this._locPos = locPos = BROKEN;
      } else {
        this._locPos = locPos = new HbsPosition(this.template, hbsPos, this.charPos);
      }
    }

    return locPos === BROKEN ? null : locPos;
  }
}

export class HbsPosition implements PositionData {
  readonly kind = OffsetKind.HbsPosition;

  _charPos: CharPosition | BROKEN | null;

  constructor(
    readonly template: SourceTemplate,
    readonly hbsPos: SourcePosition,
    charPos: number | null = null
  ) {
    this._charPos = charPos === null ? null : new CharPosition(template, charPos);
  }

  /**
   * Lazily compute the character offset from the {@see SourcePosition}. Once an `HbsPosition` has
   * computed its `CharPosition`, it will not need to do compute it again, and the same
   * `HbsPosition` is retained when used as one of the ends of a `SourceSpan`, so computing the
   * `CharPosition` should be a one-time operation.
   *
   * @implements {PositionData}
   */
  toCharPos(): CharPosition | null {
    let charPos = this._charPos;

    if (charPos === null) {
      let charPosNumber = this.template.charPosFor(this.hbsPos);

      if (charPosNumber === null) {
        this._charPos = charPos = BROKEN;
      } else {
        this._charPos = charPos = new CharPosition(this.template, charPosNumber);
      }
    }

    return charPos === BROKEN ? null : charPos;
  }

  /**
   * Return the {@see SourcePosition} that this `HbsPosition` was instantiated with. This operation
   * does not need to compute anything.
   *
   * @implements {PositionData}
   */
  toJSON(): SourcePosition {
    return this.hbsPos;
  }

  wrap(): SourceOffset {
    return new SourceOffset(this);
  }

  /**
   * This is already an `HbsPosition`.
   *
   * {@see CharPosition} for the alternative.
   */
  toHbsPos(): HbsPosition {
    return this;
  }
}

export class BrokenPosition implements PositionData {
  constructor(
    readonly kind: BrokenOffset,
    readonly loc: SourcePosition | null,
    readonly template: SourceTemplate
  ) {}

  toCharPos(): null {
    return null;
  }
  toJSON(): SourcePosition {
    throw new Error('Method not implemented.');
  }
}

export class AbsentPosition implements PositionData {
  constructor(
    readonly kind: AbsentOffset,
    readonly pos: HbsPosition | null,
    readonly template: SourceTemplate
  ) {}

  /**
   * An absent position cannot be turned into a {@link CharPosition}.
   */
  toCharPos(): CharPosition | null {
    return this.pos?.toCharPos() ?? null;
  }

  /**
   * The serialization of an `InvisiblePosition is whatever Handlebars {@see SourcePosition} was
   * originally identified as broken, non-existent or synthetic.
   *
   * If an `InvisiblePosition` never had an source offset at all, this method returns
   * {@see UNKNOWN_POSITION} for compatibility.
   */
  toJSON(): SourcePosition {
    return this.pos?.toJSON() ?? UNKNOWN_POSITION;
  }

  wrap(): SourceOffset {
    return new SourceOffset(this);
  }
}

/**
 * Compare two {@see AnyPosition} and determine whether they are equal.
 *
 * @see {SourceOffset#eql}
 */
const eql = match<boolean>((m) =>
  m
    .when(
      OffsetKind.HbsPosition,
      OffsetKind.HbsPosition,
      ({ hbsPos: left }, { hbsPos: right }) =>
        left.column === right.column && left.line === right.line
    )
    .when(
      OffsetKind.CharPosition,
      OffsetKind.CharPosition,
      ({ charPos: left }, { charPos: right }) => left === right
    )
    .when(
      OffsetKind.CharPosition,
      OffsetKind.HbsPosition,
      ({ offset: left }, right) => left === right.toCharPos()?.offset
    )
    .when(
      OffsetKind.HbsPosition,
      OffsetKind.CharPosition,
      (left, { offset: right }) => left.toCharPos()?.offset === right
    )
    .when(MatchAny, MatchAny, () => false)
);
