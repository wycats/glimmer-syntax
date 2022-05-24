/* eslint-disable no-console */
import type { TokenizerDelegate } from 'simple-html-tokenizer';

import { GlimmerSyntaxError } from '../syntax-error';
import { getBlockParams } from '../utils';
import type { Parser, Tag } from './parser';

export class TokenizerEventHandlers implements TokenizerDelegate {
  static create(parser: () => Parser): TokenizerEventHandlers {
    return new TokenizerEventHandlers(parser);
  }

  #parserThunk: () => Parser;

  constructor(parserThunk: () => Parser) {
    this.#parserThunk = parserThunk;
  }

  get #parser(): Parser {
    return this.#parserThunk();
  }

  reportSyntaxError(message: string): void {
    this.#parser.tokenizerError(message);
  }

  get #b() {
    return this.#parser.builder;
  }

  reset(): void {
    // do nothing, because we always construct a new Tokenizer when we want to tokenize input
  }

  // Comment

  beginComment(): void {
    this.#parser.traced('beginComment:trace');
    this.#parser.constructing(this.#b.comment('', this.#parser.offset().move(-4)));
  }

  appendToCommentData(char: string): void {
    this.#parser.traced('appendToCommentData:trace', char);
    this.#parser.modify('CommentStatement', (comment) => (comment.value += char));
  }

  finishComment(): void {
    this.#parser.traced('finishComment:trace');
    this.#parser.appendLeaf('CommentStatement');
  }

  // Data

  beginData(): void {
    this.#parser.traced('beginData:trace');
    this.#parser.constructing(this.#b.text({ chars: '', loc: this.#parser.offset().collapsed() }));
  }

  appendToData(char: string): void {
    this.#parser.traced('appendToData:trace', char);
    this.#parser.modify('TextNode', (text) => (text.chars += char));
  }

  finishData(): void {
    this.#parser.traced('finishData:trace');
    this.#parser.appendLeaf('TextNode');
  }

  // Tags - basic

  tagOpen(): void {
    this.#parser.traced('tagOpen:trace');
  }

  #tagStart(type: 'StartTag' | 'EndTag'): void {
    this.#parser.constructing({
      type,
      name: '',
      attributes: [],
      modifiers: [],
      comments: [],
      selfClosing: false,
      loc: this.#parser.offset().move(-2),
    });
  }

  beginStartTag(): void {
    this.#parser.traced('beginStartTag:trace');
    this.#tagStart('StartTag');
  }

  beginEndTag(): void {
    this.#parser.traced('beginEndTag:trace');
    this.#tagStart('EndTag');
  }

  finishTag(): void {
    this.#parser.traced('finishTag:trace');
    const tag = this.#parser.finishTag();

    if (tag.type === 'StartTag') {
      if (tag.name === ':') {
        const offset = this.#parser.offset();
        this.#parser.reportError(
          GlimmerSyntaxError.from(
            'html.syntax.invalid-named-block',
            this.#b.span({ start: offset.move(-1), end: offset })
          )
        );
      } else {
        this.#finishStartTag(tag);
      }
    } else if (tag.type === 'EndTag') {
      this.#parser.endElement(tag);
    }
  }

  #finishStartTag(tag: Tag<'StartTag'>): void {
    const { name, attributes, modifiers, comments, selfClosing, loc } = tag;

    const parsedBlockParams = getBlockParams(attributes);

    if (parsedBlockParams.type === 'err') {
      this.#parser.reportError(parsedBlockParams.error);
    }

    const { attrs, blockParams } = parsedBlockParams;

    this.#parser.startElement(
      this.#b.element({
        tag: name,
        selfClosing,
        attrs,
        modifiers,
        comments,
        children: [],
        blockParams,
        loc,
      })
    );
  }

  markTagAsSelfClosing(): void {
    this.#parser.traced('markTagAsSelfClosing:trace');
    this.#parser.modify('StartTag', (tag) => (tag.selfClosing = true));
  }

  // Tags - name

  appendToTagName(char: string): void {
    this.#parser.traced('appendToTagName:trace', char);
    this.#parser.modify(['StartTag', 'EndTag'], (tag) => (tag.name += char));
  }

  // Tags - attributes

  beginAttribute(): void {
    this.#parser.traced('beginAttribute:trace');
    this.#parser.startAttr();
  }

  appendToAttributeName(char: string): void {
    this.#parser.traced(`appendToAttributeName:trace`, char);
    this.#parser.modify('Attribute', (attr) => attr.appendToName(char));
  }

  beginAttributeValue(isQuoted: boolean): void {
    this.#parser.traced(`beginAttributeValue:trace`, { quoted: isQuoted });
    this.#parser.startAttrValue(isQuoted);
  }

  appendToAttributeValue(char: string): void {
    this.#parser.traced(`appendToAttributeValue:trace`, char);
    this.#parser.modify('AttributeValue', (value) => {
      value.continueText(char);
    });
  }

  finishAttributeValue(): void {
    this.#parser.traced('finishAttributeValue:trace');
    this.#parser.finishAttr();
  }
}
