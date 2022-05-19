import { LOCAL_DEBUG } from '@glimmer/local-debug-flags';

import { type ModuleName, NormalizedPreprocessOptions, template } from '../parser/preprocess';
import { Scope } from '../parser/scope';
import type { SourceTemplate } from '../source/source';
import { SourceSpan } from '../source/span';
import { isPresent } from '../utils/array.js';
import { assert, deprecate } from '../utils/assert.js';
import { type Optional, existing } from '../utils/exists.js';
import type { Dict } from '../utils/object.js';
import type { SourceLocation, SourcePosition } from './api';
import type * as ASTv1 from './api';
import { PathExpressionImplV1 } from './legacy-interop';

// Statements

export type BuilderHead = string | ASTv1.Expression;
export type TagDescriptor = string | { name: string; selfClosing: boolean };

// Nodes

export type ElementParts =
  | ['attrs', ...AttrSexp[]]
  | ['modifiers', ...ModifierSexp[]]
  | ['body', ...ASTv1.Statement[]]
  | ['comments', ...ElementComment[]]
  | ['as', ...string[]]
  | ['loc', SourceLocation];

export type PathSexp = string | ['path', string, LocSexp?];

export type ModifierSexp =
  | string
  | [PathSexp, LocSexp?]
  | [PathSexp, ASTv1.Expression[], LocSexp?]
  | [PathSexp, ASTv1.Expression[], Dict<ASTv1.Expression>, LocSexp?];

export type AttrSexp = [string, ASTv1.AttrNode['value'] | string, LocSexp?];

export type LocSexp = ['loc', SourceLocation];

export type ElementComment = ASTv1.MustacheCommentStatement | SourceLocation | string;

export type SexpValue =
  | string
  | ASTv1.Expression[]
  | Dict<ASTv1.Expression>
  | LocSexp
  | PathSexp
  | undefined;

export interface BuildElementOptions {
  attrs?: ASTv1.AttrNode[];
  modifiers?: ASTv1.ElementModifierStatement[];
  children?: ASTv1.Statement[];
  comments?: ElementComment[];
  blockParams?: string[];
  loc?: ToSourceSpan;
}

export type ToSourceSpan =
  | {
      span: SourceSpan;
    }
  | {
      hbs: SourceLocation;
      template: SourceTemplate;
    }
  | SourceLocation
  | SourceSpan
  | undefined;

function toSourceSpan(from: ToSourceSpan, template: SourceTemplate): SourceSpan {
  if (from === undefined) {
    return SourceSpan.emptySource(template);
  } else if (from instanceof SourceSpan) {
    return from;
  } else if ('span' in from) {
    return from.span;
  } else if ('template' in from) {
    return SourceSpan.forHbsLoc(from.template, from.hbs);
  } else {
    return SourceSpan.forHbsLoc(template, from);
  }
}

export interface CallOptions {
  loc: ToSourceSpan;
  params?: ASTv1.Expression[];
  hash?: ASTv1.Hash;
}

export interface MustacheOptions extends CallOptions {
  raw?: boolean;
  strip?: ASTv1.StripFlags;
}

export interface BlockStripFlagsOptions {
  open?: ASTv1.StripFlags;
  else?: ASTv1.StripFlags;
  close?: ASTv1.StripFlags;
}

export interface BlockOptions extends CallOptions {
  blocks: {
    default: ASTv1.PossiblyDeprecatedBlock;
    else?: ASTv1.PossiblyDeprecatedBlock;
  };
  strip?: BlockStripFlagsOptions;
}

export interface BlockItselfOptions {
  body?: ASTv1.Statement[];
  blockParams?: string[];
  chained?: boolean;
  loc: ToSourceSpan;
}

function callOptions(
  path: string | ASTv1.Expression,
  scope: Scope,
  options: CallOptions,
  template: SourceTemplate
): ASTv1.CallParts & { loc: SourceSpan } {
  const span = toSourceSpan(options.loc, template);

  const builtPath = typeof path === 'string' ? buildPath(path, { span }, scope, template) : path;

  return {
    loc: span,
    path: builtPath,
    params: options?.params ?? [],
    hash: options?.hash ?? {
      type: 'Hash',
      pairs: [],
      loc: SourceSpan.emptySource(span.getTemplate()),
    },
  };
}

function mustacheOptions(
  path: string | ASTv1.Expression,
  scope: Scope,
  options: MustacheOptions,
  template: SourceTemplate
): ASTv1.MustacheStatementParts {
  const call = callOptions(path, scope, options, template);

  return {
    ...call,
    escaped: !options.raw,
    trusting: !!options.raw,
    strip: toStripFlags(options.strip),
  };
}

function toAllStripFlags(
  options?: BlockStripFlagsOptions
): Pick<ASTv1.BlockStatementParts, 'inverseStrip' | 'closeStrip' | 'openStrip'> {
  return {
    inverseStrip: toStripFlags(options?.else),
    closeStrip: toStripFlags(options?.close),
    openStrip: toStripFlags(options?.open),
  };
}

function blockOptions(
  path: string | ASTv1.Expression,
  scope: Scope,
  options: BlockOptions,
  template: SourceTemplate
): ASTv1.BlockStatementParts {
  const parts = {
    ...callOptions(path, scope, options, template),
    program: toBlock(options.blocks.default),
    ...toAllStripFlags(options?.strip),
  };

  if (options.blocks.else) {
    (parts as Partial<ASTv1.BlockStatementParts>).inverse = toBlock(options.blocks.else);
  }

  return parts;
}

function toBlock(block: ASTv1.PossiblyDeprecatedBlock): ASTv1.Block {
  if (block.type === 'Template') {
    if (LOCAL_DEBUG) {
      deprecate(`b.program is deprecated. Use b.blockItself instead.`);
    }

    return { ...block, type: 'Block' };
  } else {
    return block;
  }
}

function toStripFlags(flags: ASTv1.StripFlags | undefined) {
  if (flags === undefined) {
    return { open: false, close: false };
  } else {
    return flags;
  }
}

// function buildPath(head: ASTv1.Expression): ASTv1.Expression;
// function buildPath(head: string, template: SourceTemplate): ASTv1.Expression;
// function buildPath(head: string | ASTv1.Expression, template?: SourceTemplate): ASTv1.Expression {
//   if (typeof head === 'string') {
//     return buildPath(head, template);
//   } else {
//     return head;
//   }
// }

// Miscellaneous

export class PublicBuilders {
  static top(template: SourceTemplate): PublicBuilders {
    return new PublicBuilders(Scope.top(template.options), template);
  }

  static forSynthesizedModule(input: string, module: string | ModuleName): PublicBuilders {
    return PublicBuilders.forModule(
      input,
      typeof module === 'string' ? { name: module, synthesized: true } : module
    );
  }

  static forModule(input: string, module: string | ModuleName): PublicBuilders {
    const options = NormalizedPreprocessOptions.default(
      typeof module === 'string' ? { name: module, synthesized: false } : module
    );
    return PublicBuilders.top(template.normalized(input, options));
  }

  readonly #scope: Scope;
  readonly #template: SourceTemplate;

  constructor(scope: Scope, template: SourceTemplate) {
    this.#scope = scope;
    this.#template = template;
  }

  mustache(
    path: string | ASTv1.Expression,
    params?: ASTv1.Expression[],
    hash?: ASTv1.Hash,
    raw?: boolean,
    loc?: SourceLocation,
    strip?: ASTv1.StripFlags
  ): ASTv1.MustacheStatement;
  mustache(path: string | ASTv1.Expression, options?: MustacheOptions): ASTv1.MustacheStatement;
  mustache(
    path: string | ASTv1.Expression,
    params?: MustacheOptions | ASTv1.Expression[],
    hash?: ASTv1.Hash,
    raw?: boolean,
    loc?: ToSourceSpan,
    strip?: ASTv1.StripFlags
  ): ASTv1.MustacheStatement {
    const normalize = (): MustacheOptions => {
      if (params === undefined) {
        return {
          loc: undefined,
        };
      } else if (Array.isArray(params)) {
        return {
          params,
          hash,
          raw,
          strip,
          loc,
        };
      } else {
        return params;
      }
    };

    return {
      type: 'MustacheStatement',
      ...mustacheOptions(path, this.#scope, normalize(), this.#template),
    };
  }

  block(
    path: string | ASTv1.Expression,
    params: Optional<ASTv1.Expression[]>,
    hash: Optional<ASTv1.Hash>,
    defaultBlock: ASTv1.PossiblyDeprecatedBlock,
    elseBlock?: Optional<ASTv1.PossiblyDeprecatedBlock>,
    loc?: SourceLocation,
    openStrip?: ASTv1.StripFlags,
    inverseStrip?: ASTv1.StripFlags,
    closeStrip?: ASTv1.StripFlags
  ): ASTv1.BlockStatement;
  block(path: string | ASTv1.Expression, options: BlockOptions): ASTv1.BlockStatement;
  block(
    path: string | ASTv1.Expression,
    params: Optional<ASTv1.Expression[]> | BlockOptions,
    hash?: Optional<ASTv1.Hash>,
    defaultBlock?: ASTv1.PossiblyDeprecatedBlock,
    elseBlock?: Optional<ASTv1.PossiblyDeprecatedBlock>,
    loc?: SourceLocation,
    openStrip?: ASTv1.StripFlags,
    inverseStrip?: ASTv1.StripFlags,
    closeStrip?: ASTv1.StripFlags
  ): ASTv1.BlockStatement {
    const normalize = (): BlockOptions => {
      if (params === null || Array.isArray(params)) {
        return {
          params: params ?? undefined,
          hash: hash ?? undefined,
          blocks: {
            default: existing(defaultBlock, { var: 'defaultBlock' }),
            else: elseBlock ?? undefined,
          },
          strip: {
            open: openStrip ?? undefined,
            close: closeStrip ?? undefined,
            else: inverseStrip ?? undefined,
          },
          loc,
        };
      } else {
        return params;
      }
    };

    return {
      type: 'BlockStatement',
      ...blockOptions(path, this.#scope, normalize(), this.#template),
    };
  }

  elementModifier(
    path: string | ASTv1.Expression,
    params?: ASTv1.Expression[],
    hash?: ASTv1.Hash,
    loc?: Optional<ToSourceSpan>
  ): ASTv1.ElementModifierStatement;
  elementModifier(
    path: string | ASTv1.Expression,
    options: CallOptions
  ): ASTv1.ElementModifierStatement;
  elementModifier(
    path: string | ASTv1.Expression,
    params?: CallOptions | ASTv1.Expression[],
    hash?: ASTv1.Hash,
    loc?: Optional<ToSourceSpan>
  ): ASTv1.ElementModifierStatement {
    const normalize = (): CallOptions => {
      if (params === undefined || Array.isArray(params)) {
        return {
          params: params ?? undefined,
          hash: hash ?? undefined,
          loc: loc ?? undefined,
        };
      } else {
        return params;
      }
    };

    return {
      type: 'ElementModifierStatement',
      ...callOptions(path, this.#scope, normalize(), this.#template),
    };
  }

  partial(
    name: ASTv1.PathExpression,
    params?: ASTv1.Expression[],
    hash?: ASTv1.Hash,
    indent?: string,
    loc?: SourceLocation
  ): ASTv1.PartialStatement {
    return {
      type: 'PartialStatement',
      name: name,
      params: params || [],
      hash: hash || this.hash([]),
      indent: indent || '',
      strip: { open: false, close: false },
      loc: this.loc(loc || null),
    };
  }

  comment(value: string, loc?: ToSourceSpan): ASTv1.CommentStatement {
    return {
      type: 'CommentStatement',
      value: value,
      loc: toSourceSpan(loc, this.#template),
    };
  }

  mustacheComment(value: string, loc?: ToSourceSpan): ASTv1.MustacheCommentStatement {
    return {
      type: 'MustacheCommentStatement',
      value: value,
      loc: toSourceSpan(loc, this.#template),
    };
  }

  concat(
    parts: (ASTv1.TextNode | ASTv1.MustacheStatement)[],
    loc?: ToSourceSpan
  ): ASTv1.ConcatStatement {
    if (!isPresent(parts)) {
      throw new Error(`b.concat requires at least one part`);
    }

    return {
      type: 'ConcatStatement',
      parts: parts || [],
      loc: toSourceSpan(loc, this.#template),
    };
  }

  element(tag: TagDescriptor, options: BuildElementOptions = {}): ASTv1.ElementNode {
    let { attrs, blockParams, modifiers, comments, children, loc } = options;

    let tagName: string;

    // this is used for backwards compat, prior to `selfClosing` being part of the ElementNode AST
    let selfClosing = false;
    if (typeof tag === 'object') {
      selfClosing = tag.selfClosing;
      tagName = tag.name;
    } else if (tag.slice(-1) === '/') {
      tagName = tag.slice(0, -1);
      selfClosing = true;
    } else {
      tagName = tag;
    }

    return {
      type: 'ElementNode',
      tag: tagName,
      selfClosing: selfClosing,
      attributes: attrs || [],
      blockParams: blockParams || [],
      modifiers: modifiers || [],
      comments: (comments as ASTv1.MustacheCommentStatement[]) || [],
      children: children || [],
      loc: toSourceSpan(loc, this.#template),
    };
  }

  attr(name: string, value: ASTv1.AttrNode['value'], loc?: ToSourceSpan): ASTv1.AttrNode {
    return {
      type: 'AttrNode',
      name: name,
      value: value,
      loc: toSourceSpan(loc, this.#template),
    };
  }

  text(chars: string, loc?: ToSourceSpan): ASTv1.TextNode {
    return {
      type: 'TextNode',
      chars: chars || '',
      loc: toSourceSpan(loc, this.#template),
    };
  }

  // Expressions

  sexpr(
    path: string | ASTv1.Expression,
    params?: ASTv1.Expression[],
    hash?: ASTv1.Hash,
    loc?: ToSourceSpan
  ): ASTv1.SubExpression;
  sexpr(path: string | ASTv1.Expression, options: CallOptions): ASTv1.SubExpression;
  sexpr(
    path: string | ASTv1.Expression,
    params?: ASTv1.Expression[] | CallOptions,
    hash?: ASTv1.Hash,
    loc?: ToSourceSpan
  ): ASTv1.SubExpression {
    const normalize = (): CallOptions => {
      if (params === undefined || Array.isArray(params)) {
        return {
          params: params,
          hash: hash,
          loc: toSourceSpan(loc, this.#template),
        };
      } else {
        return params;
      }
    };

    return {
      type: 'SubExpression',
      ...callOptions(path, this.#scope, normalize(), this.#template),
    };
  }

  fullPath(head: ASTv1.PathHead, tail: string[], loc: ToSourceSpan): ASTv1.PathExpression {
    let { original: originalHead, parts: headParts } = headToString(head);
    let parts = [...headParts, ...tail];
    let original = [...originalHead, ...parts].join('.');

    return new PathExpressionImplV1(
      original,
      head,
      tail,
      toSourceSpan(loc, this.#template),
      this.#scope
    );
  }

  path(path: string | ASTv1.Expression, loc?: ToSourceSpan): ASTv1.Expression {
    if (typeof path !== 'string') {
      if ('type' in path) {
        return path;
      } else {
        let { head, tail, span } = processHead(path, this.#scope, loc, this.#template);

        assert(
          tail.length === 0,
          `builder.path({ head, tail }) should not be called with a head with dots in it`
        );

        let { original: originalHead } = headToString(head);

        return new PathExpressionImplV1(
          [originalHead, ...tail].join('.'),
          head,
          tail,
          span,
          this.#scope
        );
      }
    }

    let { head, tail, span } = processHead(path, this.#scope, loc, this.#template);

    return new PathExpressionImplV1(path, head, tail, span, this.#scope);
  }

  this(loc?: ToSourceSpan): ASTv1.PathHead {
    return {
      type: 'ThisHead',
      loc: toSourceSpan(loc, this.#template),
    };
  }

  atName(name: string, loc?: ToSourceSpan): ASTv1.PathHead {
    // the `@` should be included so we have a complete source range
    assert(name[0] === '@', `call builders.at() with a string that starts with '@'`);

    return {
      type: 'AtHead',
      name,
      loc: toSourceSpan(loc, this.#template),
    };
  }

  var(name: string, loc?: ToSourceSpan): ASTv1.PathHead {
    assert(name !== 'this', `You called builders.var() with 'this'. Call builders.this instead`);
    assert(
      name[0] !== '@',
      `You called builders.var() with '${name}'. Call builders.at('${name}') instead`
    );

    return {
      type: 'VarHead',
      name,
      declared: this.#scope.declaration(name),
      loc: toSourceSpan(loc, this.#template),
    };
  }

  head(head: string, loc: ToSourceSpan): ASTv1.PathHead {
    if (head[0] === '@') {
      return this.atName(head, loc);
    } else if (head === 'this') {
      return this.this(loc);
    } else {
      return this.var(head, loc);
    }
  }

  buildNamedBlockName(name: string, loc?: ToSourceSpan): ASTv1.NamedBlockName {
    return {
      type: 'NamedBlockName',
      name,
      loc: toSourceSpan(loc, this.#template),
    };
  }

  literal<T extends ASTv1.Literal>(type: T['type'], value: T['value'], loc?: ToSourceSpan): T {
    return {
      type,
      value,
      original: value,
      loc: toSourceSpan(loc, this.#template),
    } as T;
  }

  readonly string = literal('StringLiteral');
  readonly boolean = literal('BooleanLiteral');
  readonly number = literal('NumberLiteral');
  readonly undefined = literal('UndefinedLiteral', { value: undefined });
  readonly null = literal('NullLiteral', { value: null });

  // Syntax Fragments

  hash(pairs?: ASTv1.HashPair[], loc?: ToSourceSpan): ASTv1.Hash {
    return {
      type: 'Hash',
      pairs: pairs ?? [],
      loc: toSourceSpan(loc, this.#template),
    };
  }

  pair(key: string, value: ASTv1.Expression, loc?: ToSourceSpan): ASTv1.HashPair {
    return {
      type: 'HashPair',
      key: key,
      value,
      loc: toSourceSpan(loc, this.#template),
    };
  }

  program(body?: ASTv1.Statement[], blockParams?: string[], loc?: SourceLocation): ASTv1.Template {
    return {
      type: 'Template',
      body: body ?? [],
      blockParams: blockParams ?? [],
      loc: toSourceSpan(loc, this.#template),
    };
  }

  blockItself(
    body?: ASTv1.Statement[],
    blockParams?: string[],
    chained?: boolean,
    loc?: SourceLocation
  ): ASTv1.Block;
  blockItself(options: BlockItselfOptions): ASTv1.Block;
  blockItself(
    body?: ASTv1.Statement[] | BlockItselfOptions,
    blockParams?: string[],
    chained = false,
    loc?: ToSourceSpan
  ): ASTv1.Block {
    const normalize = (): BlockItselfOptions => {
      if (body === undefined || Array.isArray(body)) {
        return {
          body,
          blockParams,
          chained,
          loc,
        };
      } else {
        return body;
      }
    };

    const normalized = normalize();

    return {
      type: 'Block',
      body: normalized.body ?? [],
      blockParams: normalized.blockParams ?? [],
      chained: normalized.chained,
      loc: toSourceSpan(normalized.loc, this.#template),
    };
  }

  buildTemplate({
    body,
    blockParams,
    loc,
  }: {
    body?: ASTv1.Statement[];
    blockParams?: string[];
    loc: ToSourceSpan;
  }): ASTv1.Template {
    return {
      type: 'Template',
      body: body ?? [],
      blockParams: blockParams ?? [],
      loc: toSourceSpan(loc, this.#template),
    };
  }

  loc(
    startLine: number,
    startColumn: number,
    endLine?: number,
    endColumn?: number,
    source?: string
  ): SourceSpan;
  loc(loc: ToSourceSpan | null): SourceSpan;
  loc(
    startLine: ToSourceSpan | null | number,
    startColumn?: number,
    endLine?: number,
    endColumn?: number,
    source?: string
  ): ToSourceSpan {
    const normalize = (): ToSourceSpan => {
      if (typeof startLine === 'number') {
        return {
          start: {
            line: startLine,
            column: startColumn ?? 0,
          },
          end: {
            line: endLine ?? startLine,
            column: endColumn ?? startColumn ?? 0,
          },
          source: source ?? this.#template.module,
        };
      } else {
        return startLine ?? undefined;
      }
    };

    return toSourceSpan(normalize(), this.#template);
  }

  pos(line: number, column: number): SourcePosition {
    return {
      line,
      column,
    };
  }
}

function headToString(head: ASTv1.PathHead): {
  original: string;
  parts: string[];
} {
  switch (head.type) {
    case 'AtHead':
      return { original: head.name, parts: [head.name] };
    case 'ThisHead':
      return { original: `this`, parts: [] };
    case 'VarHead':
      return { original: head.name, parts: [head.name] };
  }
}

function buildPath(
  path: string,
  loc: ToSourceSpan,
  scope: Scope,
  template: SourceTemplate
): ASTv1.PathExpression {
  let { head, tail, span } = processHead(path, scope, loc, template);

  assert(
    tail.length === 0,
    `builder.path({ head, tail }) should not be called with a head with dots in it`
  );

  let { original: originalHead } = headToString(head);

  return new PathExpressionImplV1([originalHead, ...tail].join('.'), head, tail, span, scope);
}

function processHead(
  original: string,
  scope: Scope,
  loc: ToSourceSpan,
  template: SourceTemplate
): { head: ASTv1.PathHead; tail: string[]; span: SourceSpan } {
  const [head, ...tail] = original.split('.');
  const span = toSourceSpan(loc, template);
  let headNode: ASTv1.PathHead;

  if (head === 'this') {
    headNode = {
      type: 'ThisHead',
      loc: span.sliceStartChars({ chars: 'this'.length }),
    };
  } else if (head[0] === '@') {
    headNode = {
      type: 'AtHead',
      name: head,
      loc: span.sliceStartChars({ chars: head.length }),
    };
  } else {
    headNode = {
      type: 'VarHead',
      name: head,
      declared: scope.declaration(head),
      loc: span.sliceStartChars({ chars: head.length }),
    };
  }

  return {
    head: headNode,
    tail,
    span,
  };
}

type LiteralNode<T extends ASTv1.Literal['type']> = Extract<
  ASTv1.Literal,
  { type: T }
> extends infer L
  ? L extends ASTv1.Literal
    ? L
    : never
  : never;

type BuildLiteral<T extends ASTv1.Literal['type']> = Extract<
  ASTv1.Literal,
  { type: T }
> extends infer L
  ? L extends ASTv1.Literal
    ? L['value'] extends null | undefined
      ? (loc?: SourceLocation) => L
      : (value: L['value'], loc?: SourceLocation) => L
    : never
  : never;

function literal<T extends ASTv1.Literal['type']>(
  type: T,
  options?: { value: LiteralNode<T>['value'] }
): BuildLiteral<T> {
  return function (this: PublicBuilders, value: T, loc?: SourceLocation) {
    if (options) {
      return this.literal(type as LiteralNode<T>['type'], options.value, loc);
    } else {
      return this.literal(type, value, loc);
    }
  } as BuildLiteral<T>;
}
