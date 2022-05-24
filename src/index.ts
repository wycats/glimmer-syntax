export { type HbsConstruct, type SyntaxErrorArgs, ParserState, SYNTAX_ERRORS } from './lib/errors';
export { default as print } from './lib/generation/print';
export { sortByLoc } from './lib/generation/util';
export { getTemplateLocals } from './lib/get-template-locals';
export type { KeywordType } from './lib/keywords';
export { isKeyword, KEYWORDS_TYPES } from './lib/keywords';
export type { ASTPlugin, ASTPluginBuilder, ASTPluginEnvironment } from './lib/parser/plugins';
export { Syntax } from './lib/parser/plugins';
export type {
  EmbedderLocals,
  NormalizedPreprocessFields,
  PrecompileOptions,
  PreprocessOptions,
  TemplateIdFn,
} from './lib/parser/preprocess';
export {
  NormalizedPreprocessOptions,
  normalize as normalizePreprocessOptions,
  optionsWithDefaultModule,
  preprocess,
} from './lib/parser/preprocess';
export { template } from './lib/parser/preprocess.js';
export { SourceSpan } from './lib/source/loc/source-span';
export { SourceSlice } from './lib/source/slice';
export { SourceTemplate } from './lib/source/source';
export type { HasSourceSpan, MaybeHasSourceSpan } from './lib/source/span-list';
export { hasSpan, loc, maybeLoc, SpanList } from './lib/source/span-list';
export { BlockSymbolTable, ProgramSymbolTable, SymbolTable } from './lib/symbol-table';
export { generateSyntaxError, GlimmerSyntaxError } from './lib/syntax-error';
export {
  type default as TraversalError,
  cannotRemoveNode,
  cannotReplaceNode,
} from './lib/traversal/errors';
export { default as WalkerPath } from './lib/traversal/path';
export { default as traverse } from './lib/traversal/traverse';
export type { NodeVisitor } from './lib/traversal/visitor';
export { default as Path, default as Walker } from './lib/traversal/walker';
export { existing } from './lib/utils/exists';
export type { Dict } from './lib/utils/object';
export * as ASTv1 from './lib/v1/api';
export type { Position, SourceLocation, SourcePosition } from './lib/v1/handlebars-ast';
export type { ToBuilderSpan } from './lib/v1/parser-builders';
export { PublicBuilders as Buildersv1 } from './lib/v1/public-builders';
export * as ASTv2 from './lib/v2-a/api';
export { normalize } from './lib/v2-a/normalize';
export { node } from './lib/v2-a/objects/node';
import * as ASTv1 from './lib/v1/api';

// eslint-disable-next-line
export import AST = ASTv1;
