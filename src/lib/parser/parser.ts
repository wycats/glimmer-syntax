import { LOCAL_DEBUG } from '@glimmer/local-debug-flags';
import type { EventedTokenizer } from 'simple-html-tokenizer';
import type { TokenizerState as UpstreamTokenizerState } from 'simple-html-tokenizer';

import type { SyntaxErrorArgs } from '../errors';
import { SymbolicSyntaxError } from '../errors';
import { voidMap } from '../generation/printer';
import type { SourceOffset } from '../source/loc/offset';
import type { SourceSpan } from '../source/loc/source-span';
import type { SourceTemplate } from '../source/source';
import type { GlimmerSyntaxError } from '../syntax-error.js';
import { appendChild, getBlockParams } from '../utils';
import { isPresent } from '../utils/array.js';
import { assert } from '../utils/assert.js';
import { existing } from '../utils/exists.js';
import { PresentStack } from '../utils/stack.js';
import { Stack } from '../utils/stack.js';
import type * as ASTv1 from '../v1/api';
import type * as HBS from '../v1/handlebars-ast';
import { type ToBuilderSpan, Phase1Builder } from '../v1/parser-builders';
import type { HandlebarsNodeVisitors } from './handlebars-node-visitors';
import { Scope } from './scope';
import {
  type EventName,
  type SimplifiedTokenizerState,
  type TokenizerState,
  asSimpleState,
  validate,
} from './tokenizer-types';
import { type TraceArgs, Tracer } from './trace';

export type ParserNodeBuilder<N extends { loc: SourceSpan }> = Omit<N, 'loc'> & {
  loc: SourceOffset;
};

export interface Tag<T extends 'StartTag' | 'EndTag'> {
  readonly type: T;
  name: string;
  readonly attributes: ASTv1.AttrNode[];
  readonly modifiers: ASTv1.ElementModifierStatement[];
  readonly comments: ASTv1.MustacheCommentStatement[];
  selfClosing: boolean;
  readonly loc: SourceSpan;
}

export type AnyConstructing =
  | ParserNodeBuilder<ASTv1.CommentStatement>
  | ParserNodeBuilder<Tag<'StartTag'>>
  | ParserNodeBuilder<Tag<'EndTag'>>
  | ConstructingAttribute
  | ConstructingAttributeValue
  | ASTv1.TextNode;

export class Parser {
  static create(
    template: SourceTemplate,
    tokenizer: EventedTokenizer,
    handlebars: HandlebarsNodeVisitors
  ): Parser {
    return new Parser(
      template,
      tokenizer,
      Tracer.create(),
      handlebars,
      [],
      Stack.empty(),
      Stack.from([Phase1Builder.withScope(template, Scope.top(template.options))]),
      PresentStack.create(ConstructingTopLevel.start(this))
    );
  }

  #template: SourceTemplate;
  #tokenizer: EventedTokenizer;
  #tracer: Tracer;
  #handlebars: HandlebarsNodeVisitors;
  #errors: GlimmerSyntaxError[];
  #parentStack: Stack<ASTv1.Parent>;
  #builderStack: Stack<Phase1Builder>;
  #constructingStack: PresentStack<Constructing>;

  constructor(
    template: SourceTemplate,
    tokenizer: EventedTokenizer,
    tracer: Tracer,
    handlebars: HandlebarsNodeVisitors,
    errors: GlimmerSyntaxError[],
    stack: Stack<ASTv1.Parent>,
    builderStack: Stack<Phase1Builder>,
    constructing: PresentStack<Constructing>
  ) {
    this.#template = template;
    this.#tokenizer = tokenizer;
    this.#tracer = tracer;
    this.#handlebars = handlebars;
    this.#errors = errors;
    this.#parentStack = stack;
    this.#builderStack = builderStack;
    this.#constructingStack = constructing;
  }

  traced(name: `${string}:end`): void;
  traced(name: `${string}:begin`, value?: TraceArgs): void;
  traced(name: `${EventName}:trace`, value?: TraceArgs): void;
  traced(name: string, value?: TraceArgs): void {
    if (LOCAL_DEBUG) {
      const match = existing(name.match(/^(?<title>.*?)(?::(?<child>begin|end|trace))?$/));
      const groups = existing(match.groups) as
        | { title: EventName; child: 'trace' }
        | { title: string; child: 'begin' | 'end' };

      switch (groups.child) {
        case 'begin':
          this.#tracer.begin(groups.title, this.#tokenizer.state, value);
          return;
        case 'end':
          this.#tracer.end(groups.title);
          return;
        case 'trace': {
          this.#tracer.trace(this.state(groups.title), this.#tokenizer.state, value);
        }
      }
    }
  }

  get parent(): ASTv1.Parent | null {
    return this.#parentStack.current;
  }

  state(event?: EventName): SimplifiedTokenizerState {
    if (event) {
      validate(event, this.#tokenizer.state);
    }

    return asSimpleState(this.#tokenizer.state, event);
  }

  get builder(): Phase1Builder {
    // @ts-expect-error FIXME
    return this.#builderStack.current;
  }

  tokenize(content: HBS.ContentStatement) {
    let line = content.loc.start.line;
    let column = content.loc.start.column;

    let offsets = calculateRightStrippedOffsets(content.original, content.value);

    line = line + offsets.lines;
    if (offsets.lines) {
      column = offsets.columns;
    } else {
      column = column + offsets.columns;
    }

    this.#tokenizer.line = line;
    this.#tokenizer.column = column;

    this.#tokenizer.tokenizePart(content.value);
    this.#tokenizer.flushData();
  }

  transitionTo(state: TokenizerState) {
    this.#tokenizer.transitionTo(state as UpstreamTokenizerState);
  }

  slice(positions: { start: HBS.SourcePosition; end: HBS.SourcePosition }): string {
    return this.#template.sliceAST(positions);
  }

  acceptTemplate(node: HBS.Program): ASTv1.Template {
    const template = this.#handlebars.Template(node);

    if (isPresent(this.#errors)) {
      template.errors = this.#errors;
    }

    return template;
  }

  accept<N extends HBS.Node & { type: keyof HBS.NodeMap }>(
    node: N
  ): HBS.NodeMap[N['type']]['output'] {
    return this.#handlebars.accept(node);
  }

  reportError(error: GlimmerSyntaxError): void {
    this.#errors.push(error);
  }

  error(error: Extract<SyntaxErrorArgs, string>, span: ToBuilderSpan): GlimmerSyntaxError;
  error<K extends Extract<SyntaxErrorArgs, unknown[]>[0]>(
    name: K,
    arg: Extract<SyntaxErrorArgs, [K, any]>[1],
    span: ToBuilderSpan
  ): GlimmerSyntaxError;
  error(error: string, args: unknown | ToBuilderSpan, span?: ToBuilderSpan): GlimmerSyntaxError {
    if (span === undefined) {
      const err = new SymbolicSyntaxError(error as SyntaxErrorArgs).spanned(
        this.builder.span(args as HBS.SourceLocation | SourceSpan)
      );
      this.reportError(err);
      return err;
    } else {
      const err = new SymbolicSyntaxError([error, args] as SyntaxErrorArgs).spanned(
        this.builder.span(span)
      );
      this.reportError(err);
      return err;
    }
  }

  /**
   * For now, pass through most tokenizer errors. Ultimately, we should convert
   * these errors into `GlimmerSyntaxError`s. At the moment, we ignore errors in
   * the attribute name state, because we can recover from them (by looking for
   * invalid attribute names later on in the processing pipeline).
   */
  tokenizerError(message: string) {
    if (this.#constructingStack?.type === 'Attribute') {
      return;
    } else {
      this.error('passthrough.tokenizer', message, this.offset().collapsed());
    }
  }

  offset(): SourceOffset {
    let { line, column } = this.#tokenizer;
    return this.#template.offsetFor(line, column);
  }

  readonly comment = {
    start: () => {
      this.#constructingStack.push(ConstructingComment.start(this));
    },
    finish: () => {
      const comment = this.#popConstructing(ConstructingComment).finish();
      this.#constructing(ConstructingParent).append(comment);
    },
  };

  readonly text = {
    start: () => {
      this.#constructingStack.push(ConstructingText.start(this));
    },
    finish: () => {
      const text = this.#popConstructing(ConstructingText).finish();
      this.#constructing(ConstructingParent).append(text);
    },
  };

  readonly element = {
    start: () => {
      this.#constructingStack.push(ConstructingStartTag.start(this));
    },
  };

  #constructing<C extends Constructing>(type: abstract new (...args: any[]) => C): C {
    const current = this.#constructingStack.current;

    assert(
      current instanceof type,
      `Expected the parser to be constructing a ${type.name}, but it was constructing a ${current.constructor.name}`
    );

    return current;
  }

  #popConstructing<C extends Constructing>(type: abstract new (...args: any[]) => C): C {
    const current = this.#constructingStack.pop();

    assert(
      current instanceof type,
      `Expected the parser to be constructing a ${type.name}, but it was constructing a ${current.constructor.name}`
    );

    return current;
  }

  addChar(char: string) {
    this.#constructingStack.current.addChar(char);
  }

  startAttr() {
    if (this.#constructingStack?.type === 'EndTag') {
      this.error('elements.invalid-attrs-in-end-tag', this.offset().collapsed());
    }

    const tag = this.#verifyConstructing('StartTag', 'EndTag');
    this.#constructingStack = ConstructingAttribute.create(this, tag);
  }

  startAttrValue(isQuoted: boolean) {
    const value = ConstructingAttributeValue.create(this, this.#verifyConstructing('Attribute'), {
      quoted: isQuoted,
    });

    this.#constructingStack = value;
  }

  finishAttr() {
    if (this.#constructingStack?.type === 'Attribute') {
      this.startAttrValue(false);
    }
    this.#constructingStack = this.#verifyConstructing('AttributeValue').finish();
    this.transitionTo('afterAttributeName');
  }

  #verifyConstructing<C extends AnyConstructing['type']>(
    ...types: C[]
  ): Extract<AnyConstructing, { type: C }> {
    const constructing = existing(
      this.#constructingStack,
      `BUG: expected the parser to be constructing ${types.join(
        ' | '
      )}, but it wasn't constructing anything`
    );

    this.assert(
      types.includes(constructing.type as C),
      `BUG: expected the parser to be constructing ${types.join(' | ')}, but it was constructing ${
        constructing.type
      }`
    );

    return constructing as Extract<AnyConstructing, { type: C }>;
  }

  appendLeaf(type: 'TextNode' | 'CommentStatement') {
    const constructing = this.#finish(this.#verifyConstructing(type)) as ASTv1.Statement;
    const parent = existing(
      this.#parentStack.current,
      `BUG: When appending a ${type}, a parent must exist`
    );

    appendChild(parent, constructing);
  }

  appendNode(
    node: ASTv1.BlockStatement | ASTv1.MustacheCommentStatement | ASTv1.MustacheStatement
  ) {
    const parent = existing(
      this.#parentStack.current,
      `BUG: When appending a block, a parent must exist`
    );

    appendChild(parent, node);
  }

  pushParent(parent: ASTv1.Parent) {
    this.#parentStack.push(parent);
  }

  popParent(): ASTv1.Parent {
    return this.#parentStack.pop();
  }

  modify<C extends AnyConstructing['type']>(
    type: C | C[],
    append: (node: Extract<AnyConstructing, { type: C }>) => void
  ): void {
    const constructing = this.#verifyConstructing(...(Array.isArray(type) ? type : [type]));

    append(constructing as Extract<AnyConstructing, { type: C }>);
  }

  finishTag(): Tag<'StartTag'> | Tag<'EndTag'> {
    const constructing = existing(
      this.#constructingStack,
      `BUG: expected the parser to be constructing a tag, but it wasn't`
    );

    this.assert(
      constructing.type === 'StartTag' || constructing.type === 'EndTag',
      `BUG: expected a tag, but got ${constructing.type}`
    );

    this.#constructingStack = null;

    return this.#finish(constructing) as Tag<'StartTag'> | Tag<'EndTag'>;
  }

  startElement(element: ASTv1.ElementNode): 'appended' | 'opened' {
    if (this.isSelfClosing({ name: element.tag, selfClosing: element.selfClosing })) {
      this.#appendElement(element);
      return 'appended';
    } else {
      this.pushScope(element.blockParams);
      this.#parentStack.push(element);
      return 'opened';
    }
  }

  endElement(tag: Tag<'EndTag'>): void {
    const element = this.#parentStack.pop();

    if (this.#validateEndTag(tag, element)) {
      this.#finish(element);
      this.popScope();
      this.#appendElement(element);
    }
  }

  #appendElement(element: ASTv1.ElementNode) {
    element.loc = element.loc.withEnd(this.offset());

    const parent = existing(
      this.#parentStack.current,
      `BUG: When appending an ${element.tag}, a parent must exist`
    );

    appendChild(parent, element);
  }

  isSelfClosing(tag: { name: string; selfClosing: boolean }): boolean {
    return voidMap[tag.name] || tag.selfClosing;
  }

  pushScope(locals: string[]): void {
    const current = this.builder;
    this.#builderStack.push(current.child(locals));
  }

  popScope(): void {
    if (this.#builderStack.isEmpty()) {
      throw new Error('unbalanced scopes');
    }

    this.#builderStack.pop();
  }

  #finish<T extends { loc: SourceSpan | SourceOffset }>(
    node: T
  ): Omit<T, 'loc'> & { loc: SourceSpan } {
    return {
      ...node,
      loc: node.loc.withEnd(this.offset()),
    } as Omit<T, 'loc'> & { loc: SourceSpan };
  }

  #validateEndTag(tag: Tag<'EndTag'>, element: ASTv1.Parent): element is ASTv1.ElementNode {
    if (voidMap[tag.name]) {
      // EngTag is also called by StartTag for void and self-closing tags (i.e.
      // <input> or <br />, so we need to check for that here. Otherwise, we would
      // throw an error for those cases.
      this.error('elements.unnecessary-end-tag', tag.name, tag.loc);
      return false;
    } else if (element.type !== 'ElementNode' || element.tag === undefined) {
      this.error('elements.end-without-start-tag', tag.name, tag.loc);
      return false;
    } else if (element.tag !== tag.name) {
      this.error('elements.unbalanced-tags', { open: element.tag, close: tag.name }, tag.loc);
      return false;
    } else {
      return true;
    }
  }

  assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      printTrace(this.#tracer);
    }

    assert(condition, message);
  }
}

type AttrPart = ASTv1.TextNode | ASTv1.MustacheStatement;

export abstract class Constructing<Parent = null> {
  static start<T extends Constructing<null>>(
    this: new (parser: Parser, parent: null) => T,
    parser: Parser
  ): T;
  static start<This extends new (parser: Parser, parent: any) => any>(
    this: This,
    parser: Parser,
    parent: This extends new (parser: Parser, parent: infer Parent) => any ? Parent : never
  ): This extends new (parser: Parser, parent: infer Parent) => infer T ? T : never;
  static start<T extends Constructing>(
    this: new (parser: Parser, parent: unknown) => T,
    parser: Parser,
    parent?: unknown
  ): T {
    return new this(parser, parent ?? null);
  }

  #parser: Parser;
  #parent: Parent;
  #start: SourceOffset;

  constructor(parser: Parser, parent: Parent) {
    this.#parser = parser;
    this.#start = parser.offset();
    this.#parent = parent;
  }

  get parser() {
    return this.#parser;
  }

  get b() {
    return this.#parser.builder;
  }

  abstract addChar(char: string): void;

  get parent(): Parent {
    return this.#parent;
  }

  span(): SourceSpan {
    return this.#start.withEnd(this.#parser.offset());
  }
}

abstract class ConstructingParent<T extends ASTv1.Parent> extends Constructing {
  #statements: ASTv1.Statement[] = [];

  append(node: ASTv1.Statement): void {
    this.#statements.push(node);
  }

  abstract finish(): T;
}

class ConstructingTopLevel extends ConstructingParent<ASTv1.Template> {
  addChar() {
    assert(false, `BUG: unexpected addChar in top-level`);
  }

  finish(): ASTv1.Template {
    throw new Error('Method not implemented.');
  }
}

class ConstructingComment extends Constructing {
  #chars = '';

  addChar(char: string) {
    this.#chars = char;
  }

  finish(): ASTv1.CommentStatement {
    return this.b.comment(this.#chars, this.span());
  }
}

class ConstructingText extends Constructing {
  #chars = '';

  addChar(char: string) {
    this.#chars = char;
  }

  finish(): ASTv1.TextNode {
    return this.b.text({ chars: this.#chars, loc: this.span() });
  }
}

class ConstructingTagName extends Constructing<ConstructingStartTag | ConstructingEndTag> {
  #name = '';
  #span: SourceSpan = super.span();

  addChar(char: string) {
    this.#name += char;
  }

  finish() {
    this.#span = this.#span.extend(super.span());
  }

  get name(): string {
    return this.#name;
  }

  span(): SourceSpan {
    return this.#span;
  }
}

export class ConstructingStartTag extends Constructing {
  #name = ConstructingTagName.start(this.parser, this);
  readonly #attributes: ASTv1.AttrNode[] = [];
  readonly #modifiers: ASTv1.ElementModifierStatement[] = [];
  readonly #comments: ASTv1.MustacheCommentStatement[] = [];
  readonly #statements: ASTv1.Statement[] = [];

  addChar(char: string): void {
    assert(false, `BUG: unexpected addChar in start tag`);
  }

  beginAttribute() {
    return ConstructingAttribute.start(this.parser, this);
  }

  appendAttribute(attr: ASTv1.AttrNode) {
    this.#attributes.push(attr);
  }

  append(statement: ASTv1.Statement) {
    this.#statements.push(statement);
  }

  selfClosing(): ASTv1.ElementNode {
    return this.#finish(true);
  }

  finish(end: ConstructingEndTag): ASTv1.ElementNode {
    end.verify(this.#name.name);
    return this.#finish(false);
  }

  #finish(selfClosing: boolean) {
    const { attrs, blockParams } = this.#blockParams;

    return this.b.element({
      tag: this.#name.name,
      selfClosing,
      attrs,
      modifiers: this.#modifiers,
      comments: this.#comments,
      children: this.#statements,
      blockParams,
      loc: this.span(),
    });
  }

  get #blockParams(): { attrs: ASTv1.AttrNode[]; blockParams: string[] } {
    const parsedBlockParams = getBlockParams(this.#attributes);

    if (parsedBlockParams.type === 'err') {
      this.parser.reportError(parsedBlockParams.error);
    }

    return parsedBlockParams;
  }
}

export class ConstructingEndTag extends Constructing<ConstructingStartTag> {
  #name = '';

  addChar(char: string) {
    this.#name += char;
  }

  appendAttribute(attribute: ASTv1.AttrNode) {
    this.parser.error('elements.invalid-attrs-in-end-tag', attribute.loc);
  }

  verify(openTagName: string): boolean {
    if (this.#name !== openTagName) {
      this.parser.error(
        'elements.unbalanced-tags',
        { open: openTagName, close: this.#name },
        this.span()
      );
      return false;
    }

    return true;
  }
}

export class ConstructingAttribute extends Constructing<ConstructingStartTag | ConstructingEndTag> {
  #name = '';
  readonly #properties: {
    quoted: boolean;
    dynamic: boolean;
  } = {
    quoted: false,
    dynamic: false,
  };

  mark(property: 'quoted' | 'dynamic', as = true) {
    this.#properties[property] = as;
  }

  addChar(char: string): void {
    this.#name += char;
  }

  startValue(isQuoted: boolean): ConstructingAttributeValue {
    return ConstructingAttributeValue.create(this.parser, this, { quoted: isQuoted });
  }

  finish(value: ASTv1.AttrValue): ASTv1.AttrNode {
    return this.b.attr({
      name: this.#name,
      value,
      loc: this.span(),
    });
  }
}

class ConstructingAttributeValue {
  static create(parser: Parser, attribute: ConstructingAttribute, options: { quoted: boolean }) {
    return new ConstructingAttributeValue(
      parser.offset().collapsed(),
      parser,
      attribute,
      null,
      [],
      {
        ...options,
        dynamic: false,
      }
    );
  }

  readonly type = 'AttributeValue';

  #span: SourceSpan;
  #parser: Parser;
  #attribute: ConstructingAttribute;
  #currentPart: ASTv1.TextNode | null;
  #parts: AttrPart[];
  #properties: {
    quoted: boolean;
    dynamic: boolean;
  };

  constructor(
    span: SourceSpan,
    parser: Parser,
    attribute: ConstructingAttribute,
    currentPart: ASTv1.TextNode | null,
    parts: AttrPart[],
    properties: {
      quoted: boolean;
      dynamic: boolean;
    }
  ) {
    this.#span = span;
    this.#parser = parser;
    this.#attribute = attribute;
    this.#currentPart = currentPart;
    this.#parts = parts;
    this.#properties = properties;
  }

  dynamic(value: ASTv1.MustacheStatement) {
    if (this.#currentPart) {
      this.finishText();
    }

    this.#properties.dynamic = true;
    this.#parts.push(value);
  }

  startText() {
    this.#currentPart = null;
  }

  addChar(char: string) {
    const current = this.#currentPart;

    if (current) {
      current.chars += char;
      current.loc = current.loc.withEnd(this.#parser.offset());
    } else {
      this.#currentPart = this.#parser.builder.text({
        chars: char,
        loc: this.#prevChar(char).collapsed(),
      });
    }
  }

  finishText() {
    this.#parts.push(existing(this.#currentPart));
    this.#currentPart = null;
  }

  finish(): ConstructingStartTag | ConstructingEndTag {
    if (this.#currentPart) {
      this.finishText();
    }

    const span = this.#span.withEnd(this.#parser.offset());

    return this.#attribute.finish(this.#assemble(span));
  }

  get #lastPart(): AttrPart | null {
    return this.#parts.length === 0 ? null : this.#parts[this.#parts.length - 1];
  }

  #prevChar(char: string): SourceOffset {
    const last = this.#lastPart;

    if (char === '\n') {
      return last ? last.loc.getEnd() : this.#span.getStart();
    } else {
      return this.#parser.offset().move(-1);
    }
  }

  #assemble(span: SourceSpan): ASTv1.AttrValue {
    const { quoted, dynamic } = this.#properties;
    const parts = this.#parts;

    if (dynamic) {
      if (quoted) {
        this.#parser.assert(
          isPresent(parts),
          `the concatenation parts of an element should not be empty`
        );
        return this.#parser.builder.concat(parts, span);
      } else {
        this.#parser.assert(
          parts.length === 1,
          `an attribute value cannot have more than one dynamic part if it's not concatentated`
        );
        return parts[0];
      }
    } else if (parts.length === 0) {
      return this.#parser.builder.text({ chars: '', loc: span });
    } else {
      return {
        ...parts[0],
        loc: span,
      };
    }
  }
}

export function calculateRightStrippedOffsets(original: string, value: string) {
  if (value === '') {
    // if it is empty, just return the count of newlines
    // in original
    return {
      lines: original.split('\n').length - 1,
      columns: 0,
    };
  }

  // otherwise, return the number of newlines prior to
  // `value`
  let difference = original.split(value)[0];
  let lines = difference.split(/\n/);
  let lineCount = lines.length - 1;

  return {
    lines: lineCount,
    columns: lines[lineCount].length,
  };
}

function printTrace(tracer: Tracer) {
  if (LOCAL_DEBUG) {
    console.group('EVENT TRACE');
    console.log(tracer.print());
    console.groupEnd();
  }
}
