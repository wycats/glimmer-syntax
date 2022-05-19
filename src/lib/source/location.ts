import { type PresentArray, isPresent } from '../utils/array';
import type { SourceLocation, SourcePosition } from '../v1/handlebars-ast';
import type { SourceTemplate } from './source';
import type { SourceSpan } from './span';

export type LocatedWithSpan = { offsets: SourceSpan };
export type LocatedWithOptionalSpan = { offsets: SourceSpan | null };

export type LocatedWithPositions = { loc: SourceLocation };
export type LocatedWithOptionalPositions = { loc?: SourceLocation };

export function isLocatedWithPositionsArray(
  location: LocatedWithOptionalPositions[]
): location is PresentArray<LocatedWithPositions> {
  return isPresent(location) && location.every(isLocatedWithPositions);
}

export type Purpose = 'broken' | 'absent' | 'missing' | 'internal-synthetic';

export interface SpecialSourceLocation<P extends Purpose = Purpose> extends SourceLocation {
  purpose: P;
}

export const UNKNOWN_POSITION: SourcePosition = Object.freeze({
  line: 1,
  column: 0,
});

export function SpecialSourceLocation(
  ...args:
    | [purpose: 'broken', loc: SourceLocation]
    | [purpose: 'absent', loc: SourceLocation | SourceTemplate]
    | [purpose: 'missing', loc: SourceTemplate]
    | [purpose: 'internal-synthetic', template: SourceTemplate]
): SpecialSourceLocation<typeof args[0]> {
  switch (args[0]) {
    case 'broken':
      return Object.freeze({ ...args[1], purpose: 'broken' }) as SpecialSourceLocation<'broken'>;
    case 'missing':
    case 'absent':
      return Object.freeze({
        ...createLoc(args[1]),
        purpose: args[0],
      }) as SpecialSourceLocation<'missing' | 'absent'>;
    case 'internal-synthetic':
      return Object.freeze({
        start: UNKNOWN_POSITION,
        end: UNKNOWN_POSITION,
        source: args[1].module,
        purpose: 'internal-synthetic',
      }) as SpecialSourceLocation<'internal-synthetic'>;
  }
}

function createLoc(loc: SourceTemplate | SourceLocation) {
  if ('start' in loc && 'end' in loc) {
    return Object.freeze({
      ...loc,
    });
  } else {
    return Object.freeze({
      source: loc.module,
      start: UNKNOWN_POSITION,
      end: UNKNOWN_POSITION,
    });
  }
}

export function isLocatedWithPositions(
  location: LocatedWithOptionalPositions
): location is LocatedWithPositions {
  return location.loc !== undefined;
}

export type HasSourceLocation =
  | SourceLocation
  | LocatedWithPositions
  | PresentArray<LocatedWithPositions>;

export type MaybeHasSourceLocation =
  | null
  | LocatedWithOptionalPositions
  | LocatedWithOptionalPositions[];
