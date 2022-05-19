// eslint-disable-next-line import/no-extraneous-dependencies
import { DEBUG } from '@glimmer/env';
import { LOCAL_DEBUG } from '@glimmer/local-debug-flags';

import type { SymbolicSyntaxError } from '../../syntax-error';
import { exhaustive } from '../../utils/assert.js';
import type { SourceLocation, SourcePosition } from '../../v1/handlebars-ast';
import { SpecialSourceLocation } from '../location';
import { SourceSlice } from '../slice';
import type { SourceTemplate } from '../source';
import { format, FormatSpan } from './format';
import { IsAbsent, OffsetKind } from './kind.js';
import { type MatchFn, match, MatchAny } from './match';
import type { SourceOffset } from './offset';
import { type AnyPosition, AbsentPosition, BROKEN, CharPosition, HbsPosition } from './offset';

/**
 * All spans have these details in common.
 */
interface SpanData {
  readonly kind: OffsetKind;

  /**
   * Convert this span into a string. If the span is broken, return `''`.
   */
  asString(): string;

  /**
   * The original `Source` containing this span. It may be a `Source.nonexistent()`.
   */
  getTemplate(): SourceTemplate;

  /**
   * Gets the module the span was located in.
   */
  getModule(): string;

  /**
   * Get the starting position for this span. Try to avoid creating new position objects, as they
   * cache computations.
   */
  getStart(): AnyPosition;

  /**
   * Get the ending position for this span. Try to avoid creating new position objects, as they
   * cache computations.
   */
  getEnd(): AnyPosition;

  /**
   * Compute the `SourceLocation` for this span, returned as an instance of `HbsSpan`.
   */
  toHbsSpan(): HbsSpan | null;

  /**
   * For compatibility, whenever the `start` or `end` of a {@see SourceOffset} changes, spans are
   * notified of the change so they can update themselves. This shouldn't happen outside of AST
   * plugins.
   */
  locDidUpdate(changes: { start?: SourcePosition; end?: SourcePosition }): void;

  /**
   * Serialize into a {@see SerializedSourceSpan}, which is compact and designed for readability in
   * context like AST Explorer. If you need a {@see SourceLocation}, use {@see toJSON}.
   */
  serialize(): SerializedSourceSpan;
}

/**
 * A `SourceSpan` object represents a span of characters inside of a template source.
 *
 * There are three kinds of `SourceSpan` objects:
 *
 * - `ConcreteSourceSpan`, which contains byte offsets
 * - `LazySourceSpan`, which contains `SourceLocation`s from the Handlebars AST, which can be
 *   converted to byte offsets on demand.
 * - `InvisibleSourceSpan`, which represent source strings that aren't present in the source,
 *   because:
 *     - they were created synthetically
 *     - their location is nonsensical (the span is broken)
 *     - they represent nothing in the source (this currently happens only when a bug in the
 *       upstream Handlebars parser fails to assign a location to empty blocks)
 *
 * At a high level, all `SourceSpan` objects provide:
 *
 * - byte offsets
 * - source in column and line format
 *
 * And you can do these operations on `SourceSpan`s:
 *
 * - collapse it to a `SourceSpan` representing its starting or ending position
 * - slice out some characters, optionally skipping some characters at the beginning or end
 * - create a new `SourceSpan` with a different starting or ending offset
 *
 * All SourceSpan objects implement `SourceLocation`, for compatibility. All SourceSpan
 * objects have a `toJSON` that emits `SourceLocation`, also for compatibility.
 *
 * For compatibility, subclasses of `AbstractSourceSpan` must implement `locDidUpdate`, which
 * happens when an AST plugin attempts to modify the `start` or `end` of a span directly.
 *
 * The goal is to avoid creating any problems for use-cases like AST Explorer.
 */
export class SourceSpan implements SourceLocation {
  /**
   * See {@link OffsetKind.EmptySource}
   */
  static emptySource(template: SourceTemplate): SourceSpan {
    return new InvisibleSpan(
      OffsetKind.EmptySource,
      SpecialSourceLocation('absent', template),
      template
    ).wrap();
  }

  /**
   * See {@link OffsetKind.BrokenLocation}
   */
  static brokenLoc(template: SourceTemplate, loc: SourceLocation): SourceSpan {
    return new InvisibleSpan(
      OffsetKind.BrokenLocation,
      SpecialSourceLocation('broken', loc),
      template
    ).wrap();
  }

  static missingLoc(template: SourceTemplate): SourceSpan {
    return new InvisibleSpan(
      OffsetKind.MissingLocation,
      SpecialSourceLocation('missing', template),
      template
    ).wrap();
  }

  static synthetic(template: SourceTemplate, chars: string): SourceSpan {
    return new InvisibleSpan(
      OffsetKind.SyntheticSource,
      SpecialSourceLocation('internal-synthetic', template),
      template,
      chars
    ).wrap();
  }

  static load(template: SourceTemplate, serialized: SerializedSourceSpan): SourceSpan {
    if (typeof serialized === 'number') {
      return SourceSpan.forCharPositions(template, serialized, serialized);
    } else if (typeof serialized === 'string') {
      return SourceSpan.synthetic(template, serialized);
    } else if (Array.isArray(serialized)) {
      if (serialized[0] === 'broken') {
        return SourceSpan.brokenLoc(template, deserializeLocation(template, serialized[1]));
      } else {
        return SourceSpan.forCharPositions(template, serialized[0], serialized[1]);
      }
    } else if (serialized === OffsetKind.EmptySource) {
      return SourceSpan.emptySource(template);
    } else if (serialized === OffsetKind.BrokenLocation) {
      return SourceSpan.brokenLoc(template, BROKEN_LOCATION);
    }

    exhaustive(serialized);
  }

  static forHbsLoc(source: SourceTemplate, loc: SourceLocation): SourceSpan {
    let start = new HbsPosition(source, loc.start);
    let end = new HbsPosition(source, loc.end);
    return new HbsSpan(source, { start, end }, loc).wrap();
  }

  static forCharPositions(source: SourceTemplate, startPos: number, endPos: number): SourceSpan {
    let start = new CharPosition(source, startPos);
    let end = new CharPosition(source, endPos);

    return new CharPositionSpan(source, { start, end }).wrap();
  }

  readonly isInvisible: boolean;

  constructor(private data: SpanData & AnySpan) {
    this.isInvisible =
      data.kind !== OffsetKind.CharPosition && data.kind !== OffsetKind.HbsPosition;
  }

  getStart(): SourceOffset {
    return this.data.getStart().wrap();
  }

  getEnd(): SourceOffset {
    return this.data.getEnd().wrap();
  }

  getTemplate(): SourceTemplate {
    return this.data.getTemplate();
  }

  get loc(): SourceLocation {
    let span = this.data.toHbsSpan();
    return span === null ? BROKEN_LOCATION : span.toHbsLoc();
  }

  get module(): string {
    return this.data.getModule();
  }

  /**
   * Get the starting `SourcePosition` for this `SourceSpan`, lazily computing it if needed.
   */
  get startPosition(): SourcePosition {
    return this.loc.start;
  }

  /**
   * Get the ending `SourcePosition` for this `SourceSpan`, lazily computing it if needed.
   */
  get endPosition(): SourcePosition {
    return this.loc.end;
  }

  get describe() {
    const loc = this.loc;
    return `${this.module}@${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`;
  }

  /**
   * Support converting ASTv1 nodes into a serialized format using JSON.stringify.
   */
  toJSON(): SourceLocation {
    return this.loc;
  }

  /**
   * Create a new span with the current span's end and a new beginning.
   */
  withStart(other: SourceOffset): SourceSpan {
    return span(other.data, this.data.getEnd());
  }

  /**
   * Create a new span with the current span's beginning and a new ending.
   */
  withEnd(this: SourceSpan, other: SourceOffset): SourceSpan {
    return span(this.data.getStart(), other.data);
  }

  asString(): string {
    return this.data.asString();
  }

  asAnnotatedString(): string {
    const source = this.data.getTemplate();

    if (source === null) {
      return format(this.asString());
    }

    const loc = this.loc;
    const lines = source.lines;

    if (loc === BROKEN_LOCATION || lines === null) {
      return format(this.asString());
    }

    return new FormatSpan(lines, this, loc).format();
  }

  /**
   * Convert this `SourceSpan` into a `SourceSlice`. In debug mode, this method optionally checks
   * that the byte offsets represented by this `SourceSpan` actually correspond to the expected
   * string.
   */
  toSlice(expected?: string): SourceSlice {
    let chars = this.data.asString();

    if (DEBUG) {
      if (expected !== undefined && chars !== expected) {
        // eslint-disable-next-line no-console
        console.warn(
          `unexpectedly found ${JSON.stringify(
            chars
          )} when slicing source, but expected ${JSON.stringify(expected)}`
        );
      }
    }

    return new SourceSlice({
      loc: this,
      chars: expected || chars,
    });
  }

  /**
   * For compatibility with SourceLocation in AST plugins
   *
   * @deprecated use startPosition instead
   */
  get start(): SourcePosition {
    return this.loc.start;
  }

  /**
   * For compatibility with SourceLocation in AST plugins
   *
   * @deprecated use withStart instead
   */
  set start(position: SourcePosition) {
    this.data.locDidUpdate({ start: position });
  }

  /**
   * For compatibility with SourceLocation in AST plugins
   *
   * @deprecated use endPosition instead
   */
  get end(): SourcePosition {
    return this.loc.end;
  }

  /**
   * For compatibility with SourceLocation in AST plugins
   *
   * @deprecated use withEnd instead
   */
  set end(position: SourcePosition) {
    this.data.locDidUpdate({ end: position });
  }

  /**
   * For compatibility with SourceLocation in AST plugins
   *
   * @deprecated use module instead
   */
  get source(): string {
    return this.module;
  }

  collapse(where: 'start' | 'end'): SourceSpan {
    switch (where) {
      case 'start':
        return this.getStart().collapsed();
      case 'end':
        return this.getEnd().collapsed();
    }
  }

  extend(other: SourceSpan): SourceSpan {
    return span(this.data.getStart(), other.data.getEnd());
  }

  serialize(): SerializedSourceSpan {
    return this.data.serialize();
  }

  slice({ skipStart = 0, skipEnd = 0 }: { skipStart?: number; skipEnd?: number }): SourceSpan {
    return span(this.getStart().move(skipStart).data, this.getEnd().move(-skipEnd).data);
  }

  splitAt(
    options: { fromStart: number } | { fromEnd: number }
  ): [first: SourceSpan, second: SourceSpan] {
    if ('fromStart' in options) {
      return [
        this.sliceStartChars({ chars: options.fromStart }),
        this.slice({ skipStart: options.fromStart }),
      ];
    } else {
      return [
        this.slice({ skipEnd: options.fromEnd }),
        this.sliceEndChars({ chars: options.fromEnd }),
      ];
    }
  }

  sliceStartChars({ skipStart = 0, chars }: { skipStart?: number; chars: number }): SourceSpan {
    return span(this.getStart().move(skipStart).data, this.getStart().move(skipStart + chars).data);
  }

  sliceEndChars({ skipEnd = 0, chars }: { skipEnd?: number; chars: number }): SourceSpan {
    return span(this.getEnd().move(skipEnd - chars).data, this.getEnd().move(-skipEnd).data);
  }
}

type AnySpan = HbsSpan | CharPositionSpan | InvisibleSpan;

class CharPositionSpan implements SpanData {
  readonly kind = OffsetKind.CharPosition;

  _locPosSpan: HbsSpan | BROKEN | null = null;

  constructor(
    readonly source: SourceTemplate,
    readonly charPositions: { start: CharPosition; end: CharPosition }
  ) {}

  wrap(): SourceSpan {
    return new SourceSpan(this);
  }

  getTemplate(): SourceTemplate {
    return this.source;
  }

  asString(): string {
    return this.source.slice(this.charPositions.start.charPos, this.charPositions.end.charPos);
  }

  getModule(): string {
    return this.source.module;
  }

  getStart(): AnyPosition {
    return this.charPositions.start;
  }

  getEnd(): AnyPosition {
    return this.charPositions.end;
  }

  locDidUpdate() {
    if (LOCAL_DEBUG) {
      // eslint-disable-next-line no-console
      console.warn(
        `updating a location that came from a CharPosition span doesn't work reliably. Don't try to update locations after the plugin phase`
      );
    }
  }

  toHbsSpan(): HbsSpan | null {
    let locPosSpan = this._locPosSpan;

    if (locPosSpan === null) {
      let start = this.charPositions.start.toHbsPos();
      let end = this.charPositions.end.toHbsPos();

      if (start === null || end === null) {
        locPosSpan = this._locPosSpan = BROKEN;
      } else {
        locPosSpan = this._locPosSpan = new HbsSpan(this.source, {
          start,
          end,
        });
      }
    }

    return locPosSpan === BROKEN ? null : locPosSpan;
  }

  serialize(): SerializedSourceSpan {
    let {
      start: { charPos: start },
      end: { charPos: end },
    } = this.charPositions;

    if (start === end) {
      return start;
    } else {
      return [start, end];
    }
  }

  toCharPosSpan(): CharPositionSpan {
    return this;
  }
}

export class HbsSpan implements SpanData {
  readonly kind = OffsetKind.HbsPosition;

  _charPosSpan: CharPositionSpan | BROKEN | null = null;

  // the source location from Handlebars + AST Plugins -- could be wrong
  _providedHbsLoc: SourceLocation | null;

  constructor(
    readonly template: SourceTemplate,
    readonly hbsPositions: { start: HbsPosition; end: HbsPosition },
    readonly error: SymbolicSyntaxError | null = null,
    providedHbsLoc: SourceLocation | null = null
  ) {
    this._providedHbsLoc = providedHbsLoc;
  }

  getTemplate(): SourceTemplate {
    return this.template;
  }

  serialize(): SerializedConcreteSourceSpan {
    let charPos = this.toCharPosSpan();
    return charPos === null ? OffsetKind.BrokenLocation : charPos.wrap().serialize();
  }

  wrap(): SourceSpan {
    return new SourceSpan(this);
  }

  private updateProvided(pos: SourcePosition, edge: 'start' | 'end') {
    if (this._providedHbsLoc) {
      this._providedHbsLoc[edge] = pos;
    }

    // invalidate computed character offsets
    this._charPosSpan = null;
    this._providedHbsLoc = {
      source: this.template.module,
      start: pos,
      end: pos,
    };
  }

  locDidUpdate({ start, end }: { start?: SourcePosition; end?: SourcePosition }): void {
    if (start !== undefined) {
      this.updateProvided(start, 'start');
      this.hbsPositions.start = new HbsPosition(this.template, start, null);
    }

    if (end !== undefined) {
      this.updateProvided(end, 'end');
      this.hbsPositions.end = new HbsPosition(this.template, end, null);
    }
  }

  asString(): string {
    let span = this.toCharPosSpan();
    return span === null ? '' : span.asString();
  }

  getModule(): string {
    return this.template.module;
  }

  getStart(): AnyPosition {
    return this.hbsPositions.start;
  }

  getEnd(): AnyPosition {
    return this.hbsPositions.end;
  }

  toHbsLoc(): SourceLocation {
    return {
      source: this.template.module,
      start: this.hbsPositions.start.hbsPos,
      end: this.hbsPositions.end.hbsPos,
    };
  }

  toHbsSpan(): HbsSpan {
    return this;
  }

  toCharPosSpan(): CharPositionSpan | null {
    let charPosSpan = this._charPosSpan;

    if (charPosSpan === null) {
      let start = this.hbsPositions.start.toCharPos();
      let end = this.hbsPositions.end.toCharPos();

      if (start && end) {
        charPosSpan = this._charPosSpan = new CharPositionSpan(this.template, {
          start,
          end,
        });
      } else {
        charPosSpan = this._charPosSpan = BROKEN;
        return null;
      }
    }

    return charPosSpan === BROKEN ? null : charPosSpan;
  }
}

class InvisibleSpan implements SpanData {
  constructor(
    readonly kind:
      | OffsetKind.BrokenLocation
      | OffsetKind.SyntheticSource
      | OffsetKind.EmptySource
      | OffsetKind.MissingLocation,
    // whatever was provided, possibly broken
    readonly loc: SpecialSourceLocation,
    readonly template: SourceTemplate,
    // if the span represents a synthetic string
    readonly string: string | null = null
  ) {}

  serialize(): SerializedConcreteSourceSpan {
    switch (this.kind) {
      case OffsetKind.BrokenLocation:
      case OffsetKind.EmptySource:
      case OffsetKind.MissingLocation:
        return this.kind;
      case OffsetKind.SyntheticSource:
        return this.string || '';
    }
  }

  getTemplate(): SourceTemplate {
    return this.template;
  }

  wrap(): SourceSpan {
    return new SourceSpan(this);
  }

  asString(): string {
    return this.string || '';
  }

  locDidUpdate({ start, end }: { start?: SourcePosition; end?: SourcePosition }) {
    if (start !== undefined) {
      this.loc.start = start;
    }

    if (end !== undefined) {
      this.loc.end = end;
    }
  }

  getModule(): string {
    return this.template.module;
  }

  getStart(): AnyPosition {
    return new AbsentPosition(this.kind, this.loc.start, this.template);
  }

  getEnd(): AnyPosition {
    return new AbsentPosition(this.kind, this.loc.end, this.template);
  }

  toCharPosSpan(): InvisibleSpan {
    return this;
  }

  toHbsSpan(): null {
    return null;
  }

  toHbsLoc(): SourceLocation {
    return BROKEN_LOCATION;
  }
}

export const span: MatchFn<SourceSpan> = match((m) =>
  m
    .when(OffsetKind.HbsPosition, OffsetKind.HbsPosition, (left, right) =>
      new HbsSpan(left.template, {
        start: left,
        end: right,
      }).wrap()
    )
    .when(OffsetKind.CharPosition, OffsetKind.CharPosition, (left, right) =>
      new CharPositionSpan(left.template, {
        start: left,
        end: right,
      }).wrap()
    )
    .when(OffsetKind.CharPosition, OffsetKind.HbsPosition, (left, right) => {
      let rightCharPos = right.toCharPos();

      if (rightCharPos === null) {
        return SourceSpan.missingLoc(left.template);
      } else {
        return span(left, rightCharPos);
      }
    })
    .when(OffsetKind.HbsPosition, OffsetKind.CharPosition, (left, right) => {
      let leftCharPos = left.toCharPos();

      if (leftCharPos === null) {
        return SourceSpan.missingLoc(left.template);
      } else {
        return span(leftCharPos, right);
      }
    })
    .when(IsAbsent, MatchAny, (left) =>
      new InvisibleSpan(left.kind, BROKEN_LOCATION, left.template).wrap()
    )
    .when(MatchAny, IsAbsent, (_, right) =>
      new InvisibleSpan(right.kind, BROKEN_LOCATION, right.template).wrap()
    )
);

export type SerializedConcreteSourceSpan =
  | /** collapsed */ number
  | /** normal */ [start: number, size: number]
  | /** synthetic */ string;

export type SerializedSourceSpan =
  | SerializedConcreteSourceSpan
  | OffsetKind.EmptySource
  | ['broken', SerializedLocation];

export type SerializedLocation<L extends SourceLocation = SourceLocation> =
  `${L['start']['line']}:${L['start']['column']}-${L['end']['line']}:${L['end']['column']}`;

function deserializeLocation(
  template: SourceTemplate,
  location: SerializedLocation
): SourceLocation {
  const [start, end] = location.split('-');
  const [startLine, startColumn] = start.split(':');
  const [endLine, endColumn] = end.split(':');

  return {
    source: template.module,
    start: {
      line: Number(startLine),
      column: Number(startColumn),
    },
    end: {
      line: Number(endLine),
      column: Number(endColumn),
    },
  };
}
