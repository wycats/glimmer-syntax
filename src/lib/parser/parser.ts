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
import { appendChild } from '../utils';
import { isPresent } from '../utils/array.js';
import { assert } from '../utils/assert.js';
import { type Optional, existing } from '../utils/exists.js';
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

type AttrPart = ASTv1.TextNode | ASTv1.MustacheStatement;

export class ConstructingAttribute {
  static create(
    parser: Parser,
    tag: ParserNodeBuilder<Tag<'StartTag'>> | ParserNodeBuilder<Tag<'EndTag'>>
  ): ConstructingAttribute {
    return new ConstructingAttribute(
      parser,
      tag,
      '',
      { quoted: false, dynamic: false },
      parser.offset()
    );
  }

  readonly type = 'Attribute';

  #parser: Parser;
  #tag: ParserNodeBuilder<Tag<'StartTag'>> | ParserNodeBuilder<Tag<'EndTag'>>;
  #name: string;
  #properties: {
    quoted: boolean;
    dynamic: boolean;
  };
  #start: SourceOffset;

  constructor(
    parser: Parser,
    tag: ParserNodeBuilder<Tag<'StartTag'>> | ParserNodeBuilder<Tag<'EndTag'>>,
    name: string,
    properties: {
      quoted: boolean;
      dynamic: boolean;
    },
    start: SourceOffset
  ) {
    this.#parser = parser;
    this.#tag = tag;
    this.#name = name;
    this.#properties = properties;
    this.#start = start;
  }

  mark(property: 'quoted' | 'dynamic', as = true) {
    this.#properties[property] = as;
  }

  appendToName(char: string): void {
    this.#name += char;
  }

  finish(
    value: ASTv1.AttrValue
  ): ParserNodeBuilder<Tag<'StartTag'>> | ParserNodeBuilder<Tag<'EndTag'>> {
    const attr = this.#parser.builder.attr({
      name: this.#name,
      value,
      loc: this.#start.withEnd(value.loc.getEnd()),
    });

    this.#tag.attributes.push(attr);

    return this.#tag;
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

  continueText(char: string) {
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

  finish(): ParserNodeBuilder<Tag<'StartTag'>> | ParserNodeBuilder<Tag<'EndTag'>> {
    if (this.#currentPart) {
      this.finishText();
    }

    const span = this.#span.withEnd(this.#parser.offset());

    const tag = this.#attribute.finish(this.#assemble(span));

    if (tag.type === 'EndTag') {
      this.#parser.error('elements.invalid-attrs-in-end-tag', span);
    }

    return tag;
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

export interface Attribute {
  type: 'Attribute';
  name: string;
  currentPart: ASTv1.TextNode | null;
  parts: (ASTv1.MustacheStatement | ASTv1.TextNode)[];
  isQuoted: boolean;
  isDynamic: boolean;
  start: SourceOffset;
  valueSpan: SourceSpan | null;
}

export type Constructing =
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
      null
    );
  }

  #template: SourceTemplate;
  #tokenizer: EventedTokenizer;
  #tracer: Tracer;
  #handlebars: HandlebarsNodeVisitors;
  #errors: GlimmerSyntaxError[];
  #parentStack: Stack<ASTv1.Parent>;
  #builderStack: Stack<Phase1Builder>;
  #constructing: Optional<Readonly<Constructing>>;

  constructor(
    template: SourceTemplate,
    tokenizer: EventedTokenizer,
    tracer: Tracer,
    handlebars: HandlebarsNodeVisitors,
    errors: GlimmerSyntaxError[],
    stack: Stack<ASTv1.Parent>,
    builderStack: Stack<Phase1Builder>,
    constructing: Optional<Readonly<Constructing>>
  ) {
    this.#template = template;
    this.#tokenizer = tokenizer;
    this.#tracer = tracer;
    this.#handlebars = handlebars;
    this.#errors = errors;
    this.#parentStack = stack;
    this.#builderStack = builderStack;
    this.#constructing = constructing;
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
    const template = this.accept(node) as ASTv1.Template;

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
    if (this.#constructing?.type === 'Attribute') {
      return;
    } else {
      this.error('passthrough.tokenizer', message, this.offset().collapsed());
    }
  }

  offset(): SourceOffset {
    let { line, column } = this.#tokenizer;
    return this.#template.offsetFor(line, column);
  }

  constructing(constructing: Constructing) {
    this.#constructing = constructing;
  }

  startAttr() {
    if (this.#constructing?.type === 'EndTag') {
      this.error('elements.invalid-attrs-in-end-tag', this.offset().collapsed());
    }

    const tag = this.#verifyConstructing('StartTag', 'EndTag');
    this.#constructing = ConstructingAttribute.create(this, tag);
  }

  startAttrValue(isQuoted: boolean) {
    const value = ConstructingAttributeValue.create(this, this.#verifyConstructing('Attribute'), {
      quoted: isQuoted,
    });

    this.#constructing = value;
  }

  finishAttr() {
    if (this.#constructing?.type === 'Attribute') {
      this.startAttrValue(false);
    }
    this.#constructing = this.#verifyConstructing('AttributeValue').finish();
    this.transitionTo('afterAttributeName');
  }

  #verifyConstructing<C extends Constructing['type']>(
    ...types: C[]
  ): Extract<Constructing, { type: C }> {
    const constructing = existing(
      this.#constructing,
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

    return constructing as Extract<Constructing, { type: C }>;
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

  modify<C extends Constructing['type']>(
    type: C | C[],
    append: (node: Extract<Constructing, { type: C }>) => void
  ): void {
    const constructing = this.#verifyConstructing(...(Array.isArray(type) ? type : [type]));

    append(constructing as Extract<Constructing, { type: C }>);
  }

  finishTag(): Tag<'StartTag'> | Tag<'EndTag'> {
    const constructing = existing(
      this.#constructing,
      `BUG: expected the parser to be constructing a tag, but it wasn't`
    );

    this.assert(
      constructing.type === 'StartTag' || constructing.type === 'EndTag',
      `BUG: expected a tag, but got ${constructing.type}`
    );

    this.#constructing = null;

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
