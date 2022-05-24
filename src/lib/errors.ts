import type { SourceSpan } from './source/loc/source-span';
import { GlimmerSyntaxError } from './syntax-error';
import type * as HBS from './v1/handlebars-ast';

export enum ParserState {
  AttrName,
  AttrValue,
  TagName,
  Unknown,
}

export function formatParserState(state: ParserState): string {
  switch (state) {
    case ParserState.AttrName:
      return ' in an attribute name';
    case ParserState.AttrValue:
      return ' in an attribute value';
    case ParserState.TagName:
      return ' in a tag name';
    case ParserState.Unknown:
      return '';
  }
}

const HBS_CONSTRUCTS = {
  Partial: ['partial', 'partials'],
  PartialBlock: ['partial-block', 'partial blocks'],
  Decorator: ['decorator', 'decorators'],
  DecoratorBlock: ['decorator-block', 'decorator blocks'],

  Block: ['block', 'blocks'],

  Path: ['path', 'paths'],
  StringLiteral: ['string literal', 'string literals'],
  NumberLiteral: ['number literal', 'number literals'],
  True: ['true literal', 'true literals'],
  False: ['false literal', 'false literals'],
  Undefined: ['undefined', 'undefined'],
  Null: ['null', 'null'],
} as const;

export type HbsConstruct = keyof typeof HBS_CONSTRUCTS;

export function formatHbsConstruct(
  construct: HbsConstruct,
  plurality: 'singular' | 'plural'
): string {
  if (plurality === 'plural') {
    return HBS_CONSTRUCTS[construct][1];
  } else {
    return HBS_CONSTRUCTS[construct][0];
  }
}

export interface HbsErrorOptions {
  in: ParserState;
  is: HbsConstruct;
}

type SyntaxErrorFor<K extends keyof SYNTAX_ERRORS> = {
  [P in K]: SYNTAX_ERRORS[P] extends (arg: infer Arg) => string ? [P, Arg] : P;
}[K];

export type SyntaxErrorArgs = SyntaxErrorFor<keyof SYNTAX_ERRORS>;

export class SymbolicSyntaxError {
  static of(error: Extract<SyntaxErrorArgs, string>): SymbolicSyntaxError;
  static of<K extends Extract<SyntaxErrorArgs, unknown[]>[0]>(
    name: K,
    arg: Extract<SyntaxErrorArgs, [K, any]>[1]
  ): SymbolicSyntaxError;
  static of(error: string, args?: unknown): SymbolicSyntaxError {
    if (args === undefined) {
      return new SymbolicSyntaxError(error as SyntaxErrorArgs);
    } else {
      return new SymbolicSyntaxError([error, args] as SyntaxErrorArgs);
    }
  }

  static create(args: SyntaxErrorArgs): SymbolicSyntaxError {
    return new SymbolicSyntaxError(args);
  }

  #error: SyntaxErrorArgs;

  constructor(error: SyntaxErrorArgs) {
    this.#error = error;
  }

  spanned(span: SourceSpan): GlimmerSyntaxError {
    return new GlimmerSyntaxError(this.#message, span);
  }

  get #message() {
    const error = this.#error;

    if (typeof error === 'string') {
      return SYNTAX_ERRORS[error];
    } else {
      const [key, arg] = error;
      return SYNTAX_ERRORS[key](arg as never);
    }
  }
}

export const SYNTAX_ERRORS = {
  'block-params.empty': `Empty block params are not allowed`,
  'block-params.unclosed': `Unclosed block parameters`,
  'block-params.extra-pipes-and-attrs': `Extra pipes and attributes after block parameters. The closing pipe after the last block parameter must be the last thing in a tag with block parameters`,
  'block-params.extra-pipes': `Extra pipes after block parameters. The closing pipe after the last block parameter must be the last thing in a tag with block parameters`,
  'block-params.extra-attrs': `Extra attributes after block parameters. The closing pipe after the last block parameter must be the last thing in a tag with block parameters`,
  'block-params.missing-pipe': 'The `as` keyword must immediately precede a pipe character',
  'block-params.missing-as': 'Block params must be immediately preceded by `as`',
  'block-params.missing-as-before-unclosed-pipe':
    'The `|` character, which begins block parameters, must be preceded by `as`, closed by another `|`, and be the last thing in an opening tag',
  'elements.invalid-attrs-in-end-tag': `Invalid end tag: closing tag must not have attributes`,
  'attrs.invalid-attr-value': `An unquoted attribute value must be a string or a mustache, preceded by whitespace or a '=' character, and followed by whitespace, a '>' character, or '/>`,

  'block-params.invalid-id': (name: string) => `Invalid identifier for block parameters, '${name}'`,
  'elements.unclosed-element': (tag: string) => `Unclosed element ${tag}`,
  'elements.end-without-start-tag': (tag: string) => `Closing tag </${tag}> without an open tag`,
  'elements.unnecessary-end-tag': (tag: string) =>
    `<${tag}> elements do not need end tags. You should remove it`,
  'elements.unbalanced-tags': ({ open, close }: { open: string; close: string }) =>
    `Closing tag </${close}> did not match last open tag <${open}>`,
  'attrs.invalid-char': (char: string) => `${char} is not a valid character within attribute names`,

  'modifier.missing-binding': ({ path, variable }: { path: string; variable: string }) =>
    `You attempted to invoke a path (${path}) as a modifier, but ${variable} was not in scope. Try adding \`this\` to the beginning of the path`,

  'component.missing-binding': (name: string) =>
    `Attempted to invoke a component that was not in scope in a strict mode template, \`<${name}>\`. If you wanted to create an element with that name, convert it to lowercase - \`<${name.toLowerCase()}>\``,

  'hbs.syntax.invalid-dotdot': `Changing context using "../" is not supported in Glimmer`,
  'hbs.syntax.invalid-slash': `Mixing '.' and '/' in paths is not supported in Glimmer; use only '.' to separate property paths`,
  'hbs.syntax.invalid-dot': `'.' is not a supported path in Glimmer; check for a path with a trailing '.'`,
  'hbs.syntax.invalid-dotslash': 'Using "./" is not supported in Glimmer and unnecessary',
  'hbs.syntax.invalid-argument': `Invalid argument: Arguments must start with \`@\` followed by a-z`,
  'hbs.syntax.invalid-variable': `Invalid variable: Variables must start with a-z or A-Z`,
  'hbs.syntax.invalid-block': `A block may only be used inside an HTML element or another block`,
  'hbs.syntax.unsupported-construct': (name: HbsConstruct) =>
    `Handlebars ${formatHbsConstruct(name, 'plural')} are not supported`,
  'hbs.syntax.not-callable': uncallableLiteral,

  'html.syntax.invalid-hbs-comment': (situation: ParserState) =>
    `Invalid Handlebars comment${formatParserState(situation)}`,
  'html.syntax.invalid-hbs-curly': (situation: ParserState) =>
    `Invalid mustache${formatParserState(situation)}`,
  'html.syntax.invalid-hbs-expression': (options: HbsErrorOptions) =>
    `Invalid ${formatHbsConstruct(options.is, 'singular')}${formatParserState(options.in)}`,
  'html.syntax.invalid-named-block': `Invalid named block without a name (\`:\`) detected. You may have created a named block without a name, or you may have began your name with a number. Named blocks must have names that are at least one character long, and begin with a lower case letter`,
  'html.syntax.invalid-construct': (options: HbsErrorOptions) =>
    `Invalid ${formatHbsConstruct(options.is, 'singular')}${formatParserState(options.in)}`,

  'passthrough.tokenizer': (error: string) => `HTML Error: ${error}`,
} as const;
export type SYNTAX_ERRORS = typeof SYNTAX_ERRORS;

type UncallableLiteral =
  | {
      type: 'string' | 'boolean' | 'number';
      original: string | number | boolean;
    }
  | { type: 'undefined' | 'null' };

function uncallableLiteral(literal: HBS.Literal | UncallableLiteral): string {
  if ('value' in literal) {
    switch (literal.type) {
      case 'StringLiteral':
        return uncallableLiteral({ type: 'string', original: literal.original });
      case 'BooleanLiteral':
        return uncallableLiteral({ type: 'boolean', original: literal.original });
      case 'NumberLiteral':
        return uncallableLiteral({ type: 'number', original: literal.original });
      case 'UndefinedLiteral':
        return uncallableLiteral({ type: 'undefined' });
      case 'NullLiteral':
        return uncallableLiteral({ type: 'null' });
    }
  } else if ('original' in literal) {
    return `The ${literal.type} literal ${JSON.stringify(literal.original)} is not callable`;
  } else {
    return `The literal ${literal.type} is not callable`;
  }
}
