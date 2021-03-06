export enum OffsetKind {
  /**
   * We have already computed the character position of this offset or span.
   *
   * type: concrete
   */
  CharPosition = 'CharPosition',

  /**
   * This offset or span was instantiated with a Handlebars SourcePosition or SourceLocation. Its
   * character position will be computed on demand.
   *
   * type: concrete
   */
  HbsPosition = 'HbsPosition',

  Multi = 'Multi',

  /**
   * for (rare) situations where a node is created but there was no source location (e.g. the name
   * "default" in default blocks when the word "default" never appeared in source). This is used
   * by the internals when there is a legitimate reason for the internals to synthesize a node
   * with no location.
   *
   * type: absent
   */
  SyntheticSource = 'SyntheticSource',

  /**
   * For situations where a source location was expected, but it didn't correspond to the node in
   * the source. This happens if a plugin creates broken locations.
   *
   * type: broken
   */
  BrokenLocation = 'BrokenLocation',

  /**
   * For situations where a source location was expected, but it didn't exist in the parsed AST.
   *
   * type: broken
   */
  MissingLocation = 'MissingLocation',

  /**
   * For nodes representing a parse error. This allows the parser to recover
   * from errors and produce an AST, but these nodes are not expected to compile
   * or run.
   *
   * type: error
   */
  ParseError = 'ParseError',
}

export const IsAbsent = 'IS_ABSENT';
export type IsAbsent = 'IS_ABSENT';

export const IsBroken = 'IS_BROKEN';
export type IsBroken = 'IS_BROKEN';

export type ConcreteOffset = OffsetKind.HbsPosition | OffsetKind.CharPosition;
export type BrokenOffset = OffsetKind.BrokenLocation | OffsetKind.MissingLocation;
