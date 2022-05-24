import type { TokenizerState } from 'simple-html-tokenizer';

import { type HbsConstruct, ParserState, SymbolicSyntaxError } from '../errors.js';
import { GlimmerSyntaxError } from '../syntax-error';
import { isHBSLiteral, printLiteral } from '../utils';
import { assert, exhaustive } from '../utils/assert';
import type { Optional } from '../utils/exists.js';
import type * as ASTv1 from '../v1/api';
import type * as HBS from '../v1/handlebars-ast';
import { ErrorExpression, ErrorStatement, ToErrorStatement } from '../v1/handlebars-utils';
import type { Phase1Builder } from '../v1/parser-builders';
import type { Parser, ParserNodeBuilder, Tag } from './parser';

type HandlebarsCallbacks = {
  [P in keyof HBS.NodeMap]: (node: HBS.NodeMap[P]['input']) => HBS.NodeMap[P]['output'];
};

export class HandlebarsNodeVisitors implements HandlebarsCallbacks {
  static create(parser: () => Parser): HandlebarsNodeVisitors {
    return new HandlebarsNodeVisitors(parser);
  }

  #parserThunk: () => Parser;

  constructor(parser: () => Parser) {
    this.#parserThunk = parser;
  }

  get #parser() {
    return this.#parserThunk();
  }

  get #b() {
    return this.#parser.builder;
  }

  accept<K extends keyof HBS.NodeMap>(node: HBS.NodeMap[K]['input']): HBS.NodeMap[K]['output'] {
    this.#parser.traced(`${node.type}:begin`);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access,,@typescript-eslint/no-unsafe-call,@typescript-eslint/no-explicit-any
    const result = (this as any)[node.type as K](node);

    this.#parser.traced(`${node.type}:end`);

    return result as HBS.NodeMap[K]['output'];
  }

  Program(program: HBS.Program): ASTv1.Block;
  Program(program: HBS.Program): ASTv1.Template;
  Program(program: HBS.Program): ASTv1.Template | ASTv1.Block;
  Program(program: HBS.Program): ASTv1.Block | ASTv1.Template {
    let body: ASTv1.Statement[] = [];
    let node;

    this.#parser.pushScope(program.blockParams ?? []);

    if (this.#parser.parent === null) {
      node = this.#b.template({
        body,
        blockParams: program.blockParams,
        loc: this.#b.span(program.loc),
      });
    } else {
      node = this.#b.blockItself({
        body,
        blockParams: program.blockParams,
        chained: program.chained,
        loc: this.#b.span(program.loc),
      });
    }

    const children = program.body;

    this.#parser.pushParent(node);

    if (children.length === 0) {
      return this.#parser.popParent() as ASTv1.Block | ASTv1.Template;
    }

    for (const child of children) {
      this.#parser.accept(child);
    }

    // Ensure that that the element stack is balanced properly.
    const parent = this.#parser.popParent();

    if (parent !== node) {
      assert(
        parent.type === 'ElementNode',
        `The only possible kind of unclosed parent is ElementNode, but somehow got ${parent.type}`
      );
      this.#parser.reportError(
        SymbolicSyntaxError.of('elements.unclosed-element', parent.tag).spanned(
          parent.loc.sliceStartChars({
            skipStart: 1,
            chars: parent.tag.length,
          })
        )
      );
    }

    this.#parser.popScope();

    return node;
  }

  BlockStatement(block: HBS.BlockStatement): ASTv1.BlockStatement | HBS.ErrorStatement | void {
    switch (this.#parser.state()) {
      case 'comment':
        this.#parser.modify(
          'CommentStatement',
          (comment) => (comment.value += this.#parser.slice(block.loc))
        );
        return;
      case 'top-level':
        break;
      default:
        this.#parser.error('hbs.syntax.invalid-block', block.loc);
    }

    const result = this.#acceptCallNodes(this, block);

    if (result.type === 'err') {
      return this.#forwardStatementError(result.error);
    }

    const { path, params, hash } = result.value;

    // These are bugs in Handlebars upstream
    if (!block.program.loc) {
      block.program.loc = this.#b.span('missing');
    }

    if (block.inverse && !block.inverse.loc) {
      block.inverse.loc = this.#b.span('missing');
    }

    let program = this.Program(block.program);
    let inverse = block.inverse ? this.Program(block.inverse) : null;

    let node = this.#b.block({
      path,
      params,
      hash,
      defaultBlock: program,
      elseBlock: inverse,
      loc: this.#b.span(block.loc),
      openStrip: block.openStrip,
      inverseStrip: block.inverseStrip,
      closeStrip: block.closeStrip,
    });

    this.#parser.appendNode(node);
  }

  MustacheStatement(
    rawMustache: HBS.MustacheStatement
  ): ASTv1.MustacheStatement | HBS.ErrorStatement | void {
    const build = (): ASTv1.MustacheStatement | HBS.ErrorStatement => {
      let { escaped, loc, strip } = rawMustache;

      if (isHBSLiteral(rawMustache.path)) {
        return this.#b.mustache({
          path: this.#parser.accept(rawMustache.path),
          params: [],
          hash: this.#b.hash([], this.#b.span(rawMustache.path.loc).collapse('end')),
          trusting: !escaped,
          loc: this.#b.span(loc),
          strip,
        });
      } else {
        let result = this.#acceptCallNodes(
          this,
          rawMustache as HBS.MustacheStatement & {
            path: HBS.PathExpression | HBS.SubExpression;
          }
        );

        if (result.type === 'err') {
          return this.#forwardStatementError(result.error);
        }

        const { path, params, hash } = result.value;

        return this.#b.mustache({
          path,
          params,
          hash,
          trusting: !escaped,
          loc: this.#b.span(loc),
          strip,
        });
      }
    };

    const state = this.#parser.state();
    const mustache = build();

    switch (state) {
      case 'comment': {
        this.#parser.modify(
          'CommentStatement',
          (comment) => (comment.value += this.#parser.slice(rawMustache.loc))
        );
        return;
      }

      case 'tag-name:start:before':
      case 'tag-name:start:in':
      case 'tag-name:end:in':
        return this.#invalidCurly(ParserState.TagName, mustache.loc);

      case 'tag:top-level':
        this.#ifOk(mustache, (m) =>
          this.#parser.modify('StartTag', (tag) => addElementModifier(tag, m, this.#b))
        );
        this.#parser.transitionTo('beforeAttributeName');
        return mustache;

      case 'attribute:name:in':
      case 'attribute:name:after': {
        this.#parser.finishAttr();
        this.#ifOk(mustache, (m) =>
          this.#parser.modify('StartTag', (tag) => addElementModifier(tag, m, this.#b))
        );
        this.#parser.transitionTo('beforeAttributeName');
        return mustache;
      }

      case 'attribute:value:before': {
        this.#parser.startAttrValue(false);
        this.#ifOk(mustache, (m) => this.#dynamicAttrPart(m));
        this.#parser.transitionTo('attributeValueUnquoted' as TokenizerState);
        return mustache;
      }

      case 'attribute:value:double-quoted':
      case 'attribute:value:single-quoted':
      case 'attribute:value:unquoted': {
        this.#ifOk(mustache, (m) => this.#dynamicAttrPart(m));
        return mustache;
      }

      // TODO: Only append child when the tokenizer state makes
      // sense to do so, otherwise throw an error.
      default: {
        this.#parser.appendNode(mustache);
        return mustache;
      }
    }
  }

  #dynamicAttrPart(part: ASTv1.MustacheStatement): void {
    this.#parser.modify('AttributeValue', (value) => {
      value.dynamic(part);
    });
  }

  #ifOk<T>(
    value: T | HBS.ErrorExpression | HBS.ErrorStatement,
    callback: (value: T) => void
  ): void {
    if ('error' in value) {
      this.#parser.reportError(value.error);
    } else {
      callback(value);
    }
  }

  ContentStatement(content: HBS.ContentStatement): void {
    this.#parser.tokenize(content);
  }

  CommentStatement(rawComment: HBS.CommentStatement): Optional<ASTv1.MustacheCommentStatement> {
    const state = this.#parser.state();
    const comment = this.#b.mustacheComment(rawComment.value, this.#b.span(rawComment.loc));

    switch (state) {
      case 'comment': {
        this.#parser.modify(
          'CommentStatement',
          (comment) => (comment.value += this.#parser.slice(rawComment.loc))
        );
        return null;
      }

      case 'tag:top-level': {
        this.#parser.modify('StartTag', (tag) => tag.comments.push(comment));
        return comment;
      }

      case 'top-level': {
        this.#parser.appendNode(
          this.#b.mustacheComment(rawComment.value, this.#b.span(rawComment.loc))
        );
        return comment;
      }

      case 'attribute:name:after': {
        this.#parser.finishAttr();
        this.#parser.modify('StartTag', (tag) => tag.comments.push(comment));
        this.#parser.transitionTo('beforeAttributeName');
        return comment;
      }

      case 'attribute:name:in': {
        this.#parser.error('html.syntax.invalid-hbs-comment', ParserState.AttrName, rawComment.loc);
        return comment;
      }

      case 'attribute:value:single-quoted':
      case 'attribute:value:double-quoted':
      case 'attribute:value:unquoted':
      case 'attribute:value:before': {
        return ErrorStatement(
          this.#parser.error(
            'html.syntax.invalid-hbs-comment',
            ParserState.AttrValue,
            rawComment.loc
          )
        );
      }

      default: {
        return ErrorStatement(
          this.#parser.error(
            'html.syntax.invalid-hbs-comment',
            ParserState.AttrValue,
            rawComment.loc
          )
        );
      }
    }
  }

  // #forwardExpressionError(error: GlimmerSyntaxError | HBS.ErrorExpression): HBS.ErrorExpression {
  //   if (error instanceof GlimmerSyntaxError) {
  //     return this.builder.errorExpression(error.message, error.location);
  //   } else {
  //     return error;
  //   }
  // }

  #forwardStatementError(
    error: GlimmerSyntaxError | HBS.ErrorStatement | HBS.ErrorExpression
  ): HBS.ErrorStatement {
    if (error instanceof GlimmerSyntaxError) {
      return ErrorStatement(error);
    } else if (error.type === 'StringLiteral') {
      return ToErrorStatement(error);
    } else if (error.type === 'MustacheCommentStatement') {
      return error;
    }

    exhaustive(error);
  }

  #invalidCurly(state: ParserState, loc: HBS.SourceLocation): HBS.ErrorStatement {
    return ErrorStatement(this.#parser.error('html.syntax.invalid-hbs-curly', state, loc));
  }

  #invalidHbsConstruct(construct: HbsConstruct, loc: HBS.SourceLocation): HBS.ErrorStatement {
    return ErrorStatement(this.#parser.error('hbs.syntax.unsupported-construct', construct, loc));
  }

  PartialStatement(partial: HBS.PartialStatement): HBS.ErrorStatement {
    return this.#invalidHbsConstruct('Partial', partial.loc);
  }

  PartialBlockStatement(partialBlock: HBS.PartialBlockStatement): HBS.ErrorStatement {
    return this.#invalidHbsConstruct('PartialBlock', partialBlock.loc);
  }

  Decorator(decorator: HBS.Decorator): HBS.ErrorStatement {
    return this.#invalidHbsConstruct('Decorator', decorator.loc);
  }

  DecoratorBlock(decoratorBlock: HBS.DecoratorBlock): HBS.ErrorStatement {
    return this.#invalidHbsConstruct('DecoratorBlock', decoratorBlock.loc);
  }

  SubExpression(sexpr: HBS.SubExpression): ASTv1.SubExpression | HBS.ErrorExpression {
    const result = this.#acceptCallNodes(this, sexpr);

    if (result.type === 'err') {
      return ErrorExpression(result.error);
    }

    const { path, params, hash } = result.value;

    return this.#b.sexpr({
      path,
      params,
      hash,
      loc: this.#b.span(sexpr.loc),
    });
  }

  PathExpression(path: HBS.PathExpression): ASTv1.PathExpression | HBS.ErrorExpression {
    let { original } = path;
    let parts: string[];

    if (original.indexOf('/') !== -1) {
      if (original.slice(0, 2) === './') {
        return ErrorExpression(this.#parser.error('hbs.syntax.invalid-dotslash', path.loc));
      }
      if (original.slice(0, 3) === '../') {
        return ErrorExpression(this.#parser.error('hbs.syntax.invalid-dotdot', path.loc));
      }
      if (original.indexOf('.') !== -1) {
        return ErrorExpression(this.#parser.error('hbs.syntax.invalid-slash', path.loc));
      }
      parts = [path.parts.join('/')];
    } else if (original === '.') {
      return ErrorExpression(this.#parser.error('hbs.syntax.invalid-dot', path.loc));
    } else {
      parts = path.parts;
    }

    let thisHead = false;

    // This is to fix a bug in the Handlebars AST where the path expressions in
    // `{{this.foo}}` (and similarly `{{foo-bar this.foo named=this.foo}}` etc)
    // are simply turned into `{{foo}}`. The fix is to push it back onto the
    // parts array and let the runtime see the difference. However, we cannot
    // simply use the string `this` as it means literally the property called
    // "this" in the current context (it can be expressed in the syntax as
    // `{{[this]}}`, where the square bracket are generally for this kind of
    // escaping – such as `{{foo.["bar.baz"]}}` would mean lookup a property
    // named literally "bar.baz" on `this.foo`). By convention, we use `null`
    // for this purpose.
    if (original.match(/^this(\..+)?$/)) {
      thisHead = true;
    }

    let pathHead: ASTv1.PathHead;
    if (thisHead) {
      pathHead = {
        type: 'ThisHead',
        loc: this.#b.span({
          start: path.loc.start,
          end: { line: path.loc.start.line, column: path.loc.start.column + 4 },
        }),
      };
    } else if (path.data) {
      let head = parts.shift();

      if (head === undefined) {
        throw generateSyntaxError(
          `Attempted to parse a path expression, but it was not valid. Paths beginning with @ must start with a-z.`,
          this.#b.span(path.loc)
        );
      }

      pathHead = {
        type: 'AtHead',
        name: `@${head}`,
        loc: this.#b.span({
          start: path.loc.start,
          end: {
            line: path.loc.start.line,
            column: path.loc.start.column + head.length + 1,
          },
        }),
      };
    } else {
      let head = parts.shift();

      if (head === undefined) {
        this.#parser.error('hbs.syntax.invalid-variable', path.loc);
        head = '';
      }

      pathHead = this.#b.head(
        head,
        this.#b.span({
          start: path.loc.start,
          end: {
            line: path.loc.start.line,
            column: path.loc.start.column + head.length,
          },
        })
      );
    }

    return this.#b.path({
      head: pathHead,
      tail: parts,
      loc: this.#b.span(path.loc),
    });
  }

  Hash(hash: HBS.Hash): ASTv1.Hash {
    let pairs: ASTv1.HashPair[] = [];

    for (let i = 0; i < hash.pairs.length; i++) {
      let pair = hash.pairs[i];
      pairs.push(
        this.#b.pair({
          key: pair.key,
          value: this.#parser.accept(pair.value),
          loc: this.#b.span(pair.loc),
        })
      );
    }

    return this.#b.hash(pairs, this.#b.span(hash.loc));
  }

  StringLiteral(string: HBS.StringLiteral): ASTv1.StringLiteral {
    return this.#b.literal({
      type: 'StringLiteral',
      value: string.value,
      loc: this.#b.span(string.loc),
    });
  }

  BooleanLiteral(boolean: HBS.BooleanLiteral): ASTv1.BooleanLiteral {
    return this.#b.literal({
      type: 'BooleanLiteral',
      value: boolean.value,
      loc: this.#b.span(boolean.loc),
    });
  }

  NumberLiteral(number: HBS.NumberLiteral): ASTv1.NumberLiteral {
    return this.#b.literal({
      type: 'NumberLiteral',
      value: number.value,
      loc: this.#b.span(number.loc),
    });
  }

  UndefinedLiteral(undef: HBS.UndefinedLiteral): ASTv1.UndefinedLiteral {
    return this.#b.literal({
      type: 'UndefinedLiteral',
      value: undefined,
      loc: this.#b.span(undef.loc),
    });
  }

  NullLiteral(nul: HBS.NullLiteral): ASTv1.NullLiteral {
    return this.#b.literal({
      type: 'NullLiteral',
      value: null,
      loc: this.#b.span(nul.loc),
    });
  }

  #acceptCallNodes(
    compiler: HandlebarsNodeVisitors,
    node: {
      path: HBS.Expression;
      params: HBS.Expression[];
      hash: HBS.Hash;
    }
  ):
    | {
        type: 'ok';
        value: {
          path: ASTv1.PathExpression | ASTv1.SubExpression;
          params: ASTv1.Expression[];
          hash: ASTv1.Hash;
        };
      }
    | { type: 'err'; error: GlimmerSyntaxError } {
    if (isLiteral(node.path)) {
      node.path;
      return {
        type: 'err',
        error: this.#parser.error('hbs.syntax.not-callable', node.path, node.path.loc),
      };
    }

    const path =
      node.path.type === 'PathExpression'
        ? compiler.PathExpression(node.path)
        : compiler.SubExpression(node.path as unknown as HBS.SubExpression);

    if (path.type === 'StringLiteral') {
      return { type: 'err', error: path.error };
    }

    const params = node.params ? node.params.map((e) => this.#parser.accept(e)) : [];

    // if there is no hash, position it as a collapsed node immediately after the last param (or the
    // path, if there are also no params)
    const end = params.length > 0 ? params[params.length - 1].loc : path.loc;

    const hash = node.hash
      ? compiler.Hash(node.hash)
      : ({
          type: 'Hash',
          pairs: [] as ASTv1.HashPair[],
          loc: this.#b.span(end).collapse('end'),
        } as const);

    return { type: 'ok', value: { path, params, hash } };
  }
}

function isLiteral(expression: HBS.Expression): expression is HBS.Literal {
  return expression.type.endsWith('Literal');
}

function addElementModifier(
  element: ParserNodeBuilder<Tag<'StartTag'>>,
  mustache: ASTv1.MustacheStatement,
  builder: Phase1Builder
) {
  let { path, params, hash, loc } = mustache;

  if (isHBSLiteral(path)) {
    let modifier = `{{${printLiteral(path)}}}`;
    let tag = `<${element.name} ... ${modifier} ...`;

    throw generateSyntaxError(`In ${tag}, ${modifier} is not a valid modifier`, mustache.loc);
  }

  let modifier = builder.elementModifier({ path, params, hash, loc });
  element.modifiers.push(modifier);
}
