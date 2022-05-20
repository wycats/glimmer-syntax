export type { VoidSyntaxErrorName } from './lib/errors';
export { SYNTAX_ERRORS } from './lib/errors';
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
export { SourceSlice } from './lib/source/slice';
export { SourceTemplate } from './lib/source/source';
export { SourceSpan } from './lib/source/loc/source-span';
export type { HasSourceSpan, MaybeHasSourceSpan } from './lib/source/span-list';
export { hasSpan, loc, maybeLoc, SpanList } from './lib/source/span-list';
export { BlockSymbolTable, ProgramSymbolTable, SymbolTable } from './lib/symbol-table';
export type { SymbolicSyntaxError } from './lib/syntax-error';
export { generateSyntaxError, GlimmerSyntaxError, symbolicMessage } from './lib/syntax-error';
export { cannotRemoveNode, cannotReplaceNode } from './lib/traversal/errors';
export { default as WalkerPath } from './lib/traversal/path';
export { default as traverse } from './lib/traversal/traverse';
export type { NodeVisitor } from './lib/traversal/visitor';
export { default as Path, default as Walker } from './lib/traversal/walker';
export type { Dict } from './lib/utils/object';
export * as ASTv1 from './lib/v1/api';
export * as AST from './lib/v1/api';
export type { Position, SourceLocation, SourcePosition } from './lib/v1/handlebars-ast';
export { PublicBuilders as Buildersv1 } from './lib/v1/public-builders';
export * as ASTv2 from './lib/v2-a/api';
export { normalize } from './lib/v2-a/normalize';
export { node } from './lib/v2-a/objects/node';
