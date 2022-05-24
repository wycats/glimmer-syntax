import { type SyntaxErrorArgs, SymbolicSyntaxError } from './errors';
import type { SourceSpan } from './source/loc/source-span.js';
import type { ToBuilderSpan } from './v1/parser-builders';

export class GlimmerSyntaxError extends SyntaxError {
  static from(error: Extract<SyntaxErrorArgs, string>, span: ToBuilderSpan): GlimmerSyntaxError;
  static from<K extends Extract<SyntaxErrorArgs, unknown[]>[0]>(
    name: K,
    arg: Extract<SyntaxErrorArgs, [K, any]>[1],
    span: SourceSpan
  ): GlimmerSyntaxError;
  static from(error: string, args: unknown | ToBuilderSpan, span?: SourceSpan): GlimmerSyntaxError {
    if (span === undefined) {
      return SymbolicSyntaxError.create(error as SyntaxErrorArgs).spanned(args as SourceSpan);
    } else {
      return SymbolicSyntaxError.create([error, args] as SyntaxErrorArgs).spanned(span);
    }
  }

  static create(args: SyntaxErrorArgs, span: SourceSpan): GlimmerSyntaxError {
    return SymbolicSyntaxError.create(args).spanned(span);
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
