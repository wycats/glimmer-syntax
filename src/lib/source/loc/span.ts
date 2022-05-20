// eslint-disable-next-line import/no-extraneous-dependencies
import { DEBUG } from '@glimmer/env';
import { LOCAL_DEBUG } from '@glimmer/local-debug-flags';

import type { SymbolicSyntaxError } from '../../syntax-error';
import type { PresentArray } from '../../utils/array';
import { assert, assertTypes, exhaustive } from '../../utils/assert.js';
import {
  type MutableSourceLocation,
  type SourcePosition,
  SourceLocation,
} from '../../v1/handlebars-ast';
import { UNKNOWN_POSITION } from '../index';
import { type SpecialPurpose, SpecialSourceLocation } from '../location';
import { SourceSlice } from '../slice';
import type { SourceTemplate } from '../source';
import { format, FormatSpan } from './format';
import { OffsetKind } from './kind.js';
import {
  type BrokenPosition,
  type MissingPosition,
  type SourceOffset0,
  SyntheticPosition,
} from './offset';
import { type AnyPosition, BROKEN, CharPosition, OffsetPosition } from './offset';

/**
 * All spans have these details in common.
 */
interface SpanData {
  readonly kind: OffsetKind;

  /**
   * Convert this span into a string. If the span is broken, return `''`.
   */
  asString(): string;

  flat(): PresentArray<FlatSpan>;

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
   * - "concrete" means that the span represents a concrete area of the source
   *   code and is not broken
   * - "synthetic" means that the span represents text that is not part of the
   *   source code and was added by the parser
   * - "broken" means that the span represents a source location from the parser
   *   that is malformed or does not correspond to a part of the source code
   */
  classify(): 'concrete' | 'synthetic' | 'broken';

  /**
   * Compute the `SourceLocation` for this span.
   */
  toAST(): SourceLocation;

  /**
   * For compatibility, whenever the `start` or `end` of a {@see SourceOffset} changes, spans are
   * notified of the change so they can update themselves. This shouldn't happen outside of AST
   * plugins.
   */
  locDidUpdate(changes: { start?: SourcePosition; end?: SourcePosition }): void;

  /**
   * Serialize into a {@link SerializedSourceSpan}, which is compact and designed for readability in
   * context like AST Explorer. If you need a {@link SourceLocation}, use {@link toJSON}.
   */
  serialize(): SerializedSourceSpan[];
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
   * See {@link OffsetKind.BrokenLocation}
   */
  static brokenLoc(template: SourceTemplate, loc: SourceLocation): SourceSpan {
    return new HbsSpan(
      OffsetKind.BrokenLocation,
      SpecialSourceLocation('broken', loc),
      template
    ).wrap();
  }

  static missingLoc(template: SourceTemplate): SourceSpan {
    return new SyntheticSpan(
      OffsetKind.MissingLocation,
      SpecialSourceLocation('missing', template),
      template
    ).wrap();
  }

  static synthetic(template: SourceTemplate, chars: string): SourceSpan {
    return new SyntheticSpan(
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
      return SourceSpan.collapsed(template);
    } else if (serialized === OffsetKind.BrokenLocation) {
      return SourceSpan.brokenLoc(template, BROKEN_LOCATION);
    }

    exhaustive(serialized);
  }

  static forHbsLoc(source: SourceTemplate, loc: SourceLocation): SourceSpan {
    let start = new OffsetPosition(source, loc.start);
    let end = new OffsetPosition(source, loc.end);
    return new HbsSpan(source, { start, end }, loc).wrap();
  }

  static forCharPositions(source: SourceTemplate, startPos: number, endPos: number): SourceSpan {
    let start = new CharPosition(source, startPos);
    let end = new CharPosition(source, endPos);

    return new CharPositionSpan(source, { start, end }).wrap();
  }

  readonly isInvisible: boolean;

  constructor(readonly data: SpanData & AnySpan) {
    this.isInvisible =
      data.kind !== OffsetKind.CharPosition && data.kind !== OffsetKind.HbsPosition;
  }

  join(other: SourceSpan): SourceSpan {
    return new SourceSpan(MultiSpan.join(this.getTemplate(), this.data, other.data));
  }

  getStart(): SourceOffset0 {
    return this.data.getStart().wrap();
  }

  getEnd(): SourceOffset0 {
    return this.data.getEnd().wrap();
  }

  getTemplate(): SourceTemplate {
    return this.data.getTemplate();
  }

  get loc(): SourceLocation {
    return this.data.toAST();
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
  withStart(other: SourceOffset0): SourceSpan {
    return span(other.data, this.data.getEnd());
  }

  /**
   * Create a new span with the current span's beginning and a new ending.
   */
  withEnd(this: SourceSpan, other: SourceOffset0): SourceSpan {
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

type ConcreteSpan = HbsSpan | CharPositionSpan;
type FlatSpan = ConcreteSpan | SyntheticSpan;
type AnySpan = FlatSpan | MultiSpan;

export function isConcreteSpan(span: AnySpan): span is ConcreteSpan {
  return span.kind === OffsetKind.CharPosition || span.kind === OffsetKind.HbsPosition;
}

class ConcreteSpan {
  #start: ConcretePosition;
  #end: ConcretePosition;

  constructor(start: ConcretePosition, end: ConcretePosition) {
    this.#start = start;
    this.#end = end;
  }
}

export class MultiSpan implements SpanData {
  static join(template: SourceTemplate, left: AnySpan, right: AnySpan) {
    return new MultiSpan(template, [...left.flat(), ...right.flat()]);
  }

  readonly kind = OffsetKind.Multi;

  #template: SourceTemplate;
  #spans: PresentArray<FlatSpan>;
  #concrete: ConcreteSpan[];
  #override: {
    start: AnyPosition | null;
    end: AnyPosition | null;
  } = {
    start: null,
    end: null,
  };

  constructor(template: SourceTemplate, spans: PresentArray<FlatSpan>) {
    this.#template = template;
    this.#spans = spans;
    this.#concrete = spans.filter(isConcreteSpan);
  }

  classify(): 'concrete' | 'synthetic' | 'broken' {
    const first = this.#startPos();
    const last = this.#endPos();

    if (this.#concrete.length === 0) {
      return 'synthetic';
    }

    if (first === null || last === null) {
      return 'broken';
    }

    return 'concrete';
  }

  flat(): PresentArray<FlatSpan> {
    return this.#spans;
  }

  #startPos(): AnyPosition | null {
    if (this.#override.start) {
      return this.#override.start;
    }

    if (this.#concrete.length === 0) {
      return null;
    } else {
      return this.#concrete[0].getStart();
    }
  }

  #endPos(): AnyPosition | null {
    if (this.#override.end) {
      return this.#override.end;
    }

    if (this.#concrete.length === 0) {
      return null;
    } else {
      return this.#concrete[this.#concrete.length - 1].getEnd();
    }
  }

  toAST(): SourceLocation {
    if (this.#concrete.length === 0) {
      return SpecialSourceLocation('internal-synthetic', this.#template);
    }

    const start = this.#startPos();
    const end = this.#endPos();

    if (start === null || end === null) {
      return SpecialSourceLocation('broken', {
        source: this.#template.module,
        start: start?.toAST() ?? UNKNOWN_POSITION,
        end: end?.toAST() ?? UNKNOWN_POSITION,
      });
    }

    return SourceLocation(start.toAST(), end.toAST(), { source: this.#template.module });
  }

  asString(): string {
    return this.#spans.map((span) => span.asString()).join('');
  }

  getTemplate(): SourceTemplate {
    return this.#template;
  }

  getModule(): string {
    return this.#template.module;
  }

  getStart(): AnyPosition {
    return this.#spans[0].getStart();
  }

  getEnd(): AnyPosition {
    return this.#spans[this.#spans.length - 1].getEnd();
  }

  locDidUpdate(changes: {
    start?: SourcePosition | undefined;
    end?: SourcePosition | undefined;
  }): void {
    if (changes.start) {
      this.#override.start = new OffsetPosition(this.#template, changes.start);
    }

    if (changes.end) {
      this.#override.end = new OffsetPosition(this.#template, changes.end);
    }
  }

  serialize(): SerializedSourceSpan[] {
    return this.#spans.flatMap((span) => span.serialize());
  }
}

export class CharPositionSpan implements SpanData {
  readonly kind = OffsetKind.CharPosition;

  #cache: HbsSpan | null = null;

  constructor(
    readonly source: SourceTemplate,
    readonly charPositions: { start: CharPosition; end: CharPosition }
  ) {}
  classify(): 'concrete' | 'synthetic' | 'broken' {
    return 'concrete';
  }

  flat(): PresentArray<FlatSpan> {
    return [this];
  }

  toAST(): SourceLocation {
    return this.toHbsSpan().toAST();
  }

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

  toHbsSpan(): HbsSpan {
    let cache = this.#cache;

    if (cache === null) {
      let start = this.charPositions.start.toHbsPos();
      let end = this.charPositions.end.toHbsPos();

      cache = this.#cache = new HbsSpan(this.source, {
        start,
        end,
      });
    }

    return cache;
  }

  serialize(): SerializedSourceSpan[] {
    let {
      start: { charPos: start },
      end: { charPos: end },
    } = this.charPositions;

    if (start === end) {
      return [start];
    } else {
      return [[start, end]];
    }
  }

  toCharPosSpan(): CharPositionSpan {
    return this;
  }
}

interface HbsSpanPositions {
  start: OffsetPosition | MissingPosition | BrokenPosition;
  end: OffsetPosition | MissingPosition | BrokenPosition;
}

export class HbsSpan implements SpanData {
  readonly kind = OffsetKind.HbsPosition;

  #charPosSpan: CharPositionSpan | BROKEN | null = null;

  // the source location from Handlebars + AST Plugins -- could be wrong
  #providedHbsLoc: MutableSourceLocation | null;

  constructor(
    readonly template: SourceTemplate,
    readonly positions: HbsSpanPositions,
    readonly error: SymbolicSyntaxError | null = null,
    providedHbsLoc: MutableSourceLocation | null = null
  ) {
    this.#providedHbsLoc = providedHbsLoc;
  }

  classify(): 'concrete' | 'broken' {
    const computed = this.#compute();

    return computed === BROKEN ? 'broken' : 'concrete';
  }

  flat(): PresentArray<FlatSpan> {
    return [this];
  }

  toAST(): SourceLocation {
    return this.toHbsLoc();
  }

  getTemplate(): SourceTemplate {
    return this.template;
  }

  serialize(): SerializedSourceSpan {
    let charPos = this.#compute();

    if (charPos === BROKEN) {
      return OffsetKind.BrokenLocation;
    } else {
      return charPos.serialize();
    }
  }

  wrap(): SourceSpan {
    return new SourceSpan(this);
  }

  private updateProvided(pos: SourcePosition, edge: 'start' | 'end') {
    if (this.#providedHbsLoc) {
      this.#providedHbsLoc[edge] = pos;
    }

    // invalidate computed character offsets
    this.#charPosSpan = null;
    this.#providedHbsLoc = {
      source: this.template.module,
      start: pos,
      end: pos,
    };
  }

  locDidUpdate({ start, end }: { start?: SourcePosition; end?: SourcePosition }): void {
    if (start !== undefined) {
      this.updateProvided(start, 'start');
      this.positions.start = new OffsetPosition(this.template, start, null);
    }

    if (end !== undefined) {
      this.updateProvided(end, 'end');
      this.positions.end = new OffsetPosition(this.template, end, null);
    }
  }

  asString(): string {
    let span = this.#compute();
    return span === BROKEN ? '' : span.asString();
  }

  getModule(): string {
    return this.template.module;
  }

  getStart(): AnyPosition {
    return this.positions.start;
  }

  getEnd(): AnyPosition {
    return this.positions.end;
  }

  toHbsLoc(): SourceLocation {
    return SourceLocation(this.positions.start.toAST(), this.positions.end.toAST(), {
      source: this.template.module,
    });
  }

  toHbsSpan(): HbsSpan {
    return this;
  }

  #compute(): CharPositionSpan | BROKEN {
    let charPosSpan = this.#charPosSpan;

    if (charPosSpan === null) {
      let start = this.positions.start.toCharPos();
      let end = this.positions.end.toCharPos();

      if (start === BROKEN || end === BROKEN || start.charPos > end.charPos) {
        this.#charPosSpan = charPosSpan = BROKEN;
      } else {
        this.#charPosSpan = charPosSpan = new CharPositionSpan(this.template, {
          start,
          end,
        });
      }
    }

    return charPosSpan;
  }
}

class SyntheticSpan implements SpanData {
  readonly #override: {
    start: SourcePosition | null;
    end: SourcePosition | null;
  } = {
    start: null,
    end: null,
  };

  constructor(readonly string: string, readonly template: SourceTemplate) {
    assert(string.length > 0, `a synthetic string must have characters in it`);
  }

  classify(): 'concrete' | 'synthetic' | 'broken' {
    throw new Error('Method not implemented.');
  }

  getPurpose(): SpecialPurpose | null {
    return 'internal-synthetic';
  }

  flat(): PresentArray<FlatSpan> {
    return [this];
  }

  toAST(): SourceLocation {
    return SpecialSourceLocation('internal-synthetic', this.template);
  }

  get kind() {
    return OffsetKind.SyntheticSource;
  }

  get #string() {
    return this.string;
  }

  serialize(): SerializedConcreteSourceSpan {
    return this.#string;
  }

  getTemplate(): SourceTemplate {
    return this.template;
  }

  wrap(): SourceSpan {
    return new SourceSpan(this);
  }

  asString(): string {
    return this.#string;
  }

  locDidUpdate({ start, end }: { start?: SourcePosition; end?: SourcePosition }) {
    if (start !== undefined) {
      this.#override.start = start;
    }

    if (end !== undefined) {
      this.#override.end = end;
    }
  }

  getModule(): string {
    return this.template.module;
  }

  getStart(): AnyPosition {
    if (this.#override.start) {
      return new OffsetPosition(this.template, this.#override.start);
    } else {
      return new SyntheticPosition(this.string, 0, this.template);
    }
  }

  getEnd(): AnyPosition {
    if (this.#override.end) {
      return new OffsetPosition(this.template, this.#override.end);
    } else {
      return new SyntheticPosition(this.string, this.string.length - 1, this.template);
    }
  }

  toCharPosSpan(): SyntheticSpan {
    return this;
  }
}

type ConcretePosition = OffsetPosition | CharPosition;

function isConcretePosition(position: AnyPosition): position is ConcretePosition {
  return position.kind === OffsetKind.HbsPosition || position.kind === OffsetKind.CharPosition;
}

function joinConcrete(start: ConcretePosition, end: ConcretePosition): SourceSpan {
  switch (start.kind) {
    case OffsetKind.CharPosition: {
      switch (end.kind) {
        case OffsetKind.CharPosition: {
          return new CharPositionSpan(start.template, {
            start,
            end,
          }).wrap();
        }
        case OffsetKind.HbsPosition: {
          let rightCharPos = end.toCharPos();

          if (rightCharPos === BROKEN) {
            return SourceSpan.brokenLoc(
              start.template,
              SpecialSourceLocation('broken', {
                source: start.template.module,
                start: start.toHbsPos().hbsPos,
                end: end.toHbsPos().hbsPos,
              })
            );
          } else {
            return new CharPositionSpan(start.template, {
              start,
              end: rightCharPos,
            }).wrap();
          }
        }
      }
    }
    case OffsetKind.HbsPosition: {
      switch (end.kind) {
        case OffsetKind.CharPosition: {
          let leftCharPos = start.toCharPos();

          if (leftCharPos === BROKEN) {
            return SourceSpan.brokenLoc(
              start.template,
              SpecialSourceLocation('broken', {
                source: start.template.module,
                start: start.toHbsPos().hbsPos,
                end: end.toHbsPos().hbsPos,
              })
            );
          } else {
            return new CharPositionSpan(start.template, {
              start: leftCharPos,
              end,
            }).wrap();
          }
        }
        case OffsetKind.HbsPosition: {
          return new HbsSpan(start.template, {
            start: start.toHbsPos(),
            end: end.toHbsPos(),
          }).wrap();
        }
      }
    }
  }
}

function mergePurpose(
  left: SpecialPurpose | undefined,
  right: SpecialPurpose | undefined
): SpecialPurpose | undefined {
  if (left === undefined) {
    return right;
  }

  if (right === undefined) {
    return left;
  }

  if (left === 'broken' || right === 'broken') {
    return 'broken';
  } else if (left === 'missing' || right === 'missing') {
    return 'missing';
  } else {
    assertTypes<['internal-synthetic', 'internal-synthetic']>(left, right);

    return 'internal-synthetic';
  }
}
