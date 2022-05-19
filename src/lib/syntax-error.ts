import { type VoidSyntaxErrorName, SYNTAX_ERRORS } from './errors';
import type { SourceSpan } from './source/span';

export type SymbolicSyntaxError =
  | VoidSyntaxErrorName
  | {
      [P in keyof SYNTAX_ERRORS]: SYNTAX_ERRORS[P] extends (arg: infer Arg) => string
        ? [P, Arg]
        : never;
    }[keyof SYNTAX_ERRORS];

export class GlimmerSyntaxError extends SyntaxError {
  static from(error: SymbolicSyntaxError, span: SourceSpan): GlimmerSyntaxError {
    return new GlimmerSyntaxError(symbolicMessage(error), span);
  }

  readonly code: string;
  readonly location: SourceSpan;

  constructor(message: string, span: SourceSpan) {
    super(`${message}: ${span.asAnnotatedString()}`);
    this.code = span.asString();
    this.location = span;
  }
}

export function generateSyntaxError(message: string, location: SourceSpan): GlimmerSyntaxError {
  return new GlimmerSyntaxError(message, location);
}

export function symbolicMessage(error: SymbolicSyntaxError | string): string {
  if (Array.isArray(error)) {
    // @ts-expect-error FIXME
    return SYNTAX_ERRORS[error[0]](error[1]);
  } else if (error in SYNTAX_ERRORS) {
    return SYNTAX_ERRORS[error as VoidSyntaxErrorName];
  } else {
    return error;
  }
}
