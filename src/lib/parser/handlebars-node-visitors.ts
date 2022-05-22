import {
  formatHbsConstruct,
  formatParserState,
  HbsConstruct,
  ParserState,
  type HbsErrorOptions
} from '../errors.js';
import { Parser, type ParserNodeBuilder, type Tag } from '../parser';
import { generateSyntaxError, GlimmerSyntaxError, type SymbolicSyntaxError } from '../syntax-error';
import { appendChild, isHBSLiteral, printLiteral } from '../utils';
import type { Optional } from '../utils/exists.js';
import type { Recast } from '../utils/types.js';
import type * as ASTv1 from '../v1/api';
import type * as HBS from '../v1/handlebars-ast';
import { ErrorStatement } from '../v1/handlebars-utils';
import type { Phase1Builder } from '../v1/parser-builders';

export abstract class HandlebarsNodeVisitors extends Parser {
  abstract appendToCommentData(s: string): void;
  abstract beginAttributeValue(quoted: boolean): void;
  abstract finishAttributeValue(): void;

  private get isTopLevel() {
    return this.elementStack.length === 0;
  }

  Program(program: HBS.Program): ASTv1.Block;
  Program(program: HBS.Program): ASTv1.Template;
  Program(program: HBS.Program): ASTv1.Template | ASTv1.Block;
  Program(program: HBS.Program): ASTv1.Block | ASTv1.Template {
    let body: ASTv1.Statement[] = [];
    let node;

    this.pushScope(program.blockParams ?? []);

    if (this.isTopLevel) {
      node = this.builder.template({
        body,
        blockParams: program.blockParams,
        loc: this.source.spanFor(program.loc),
      });
    } else {
      node = this.builder.blockItself({
        body,
        blockParams: program.blockParams,
        chained: program.chained,
        loc: this.source.spanFor(program.loc),
      });
    }

    let i,
      l = program.body.length;

    this.elementStack.push(node);

    if (l === 0) {
      return this.elementStack.pop() as ASTv1.Block | ASTv1.Template;
    }

    for (i = 0; i < l; i++) {
      this.acceptNode(program.body[i]);
    }

    // Ensure that that the element stack is balanced properly.
    let poppedNode = this.elementStack.pop();
    if (poppedNode !== node) {
      let elementNode = poppedNode as ASTv1.ElementNode;

      throw GlimmerSyntaxError.from(
        ['elements.unclosed-element', elementNode.tag],
        elementNode.loc.sliceStartChars({
          skipStart: 1,
          chars: elementNode.tag.length,
        })
      );
    }

    this.popScope();

    return node;
  }

  BlockStatement(block: HBS.BlockStatement): ASTv1.BlockStatement | HBS.ErrorStatement | void {
    if (this.tokenizer.state === 'comment') {
      this.appendToCommentData(this.sourceForNode(block));
      return;
    }

    if (this.tokenizer.state !== 'data' && this.tokenizer.state !== 'beforeData') {
      throw generateSyntaxError(
        'A block may only be used inside an HTML element or another block.',
        this.source.spanFor(block.loc)
      );
    }

    const result = this.#acceptCallNodes(this, block);

    if (result.type === 'err') {
      return ErrorStatement(result.error.message, result.error.location);
    }

    const { path, params, hash } = result.value;

    // These are bugs in Handlebars upstream
    if (!block.program.loc) {
      block.program.loc = this.builder.span('missing');
    }

    if (block.inverse && !block.inverse.loc) {
      block.inverse.loc = this.builder.span('missing');
    }

    let program = this.Program(block.program);
    let inverse = block.inverse ? this.Program(block.inverse) : null;

    let node = this.builder.block({
      path,
      params,
      hash,
      defaultBlock: program,
      elseBlock: inverse,
      loc: this.source.spanFor(block.loc),
      openStrip: block.openStrip,
      inverseStrip: block.inverseStrip,
      closeStrip: block.closeStrip,
    });

    let parentProgram = this.currentElement();

    appendChild(parentProgram, node);
  }

  MustacheStatement(
    rawMustache: HBS.MustacheStatement
  ): ASTv1.MustacheStatement | HBS.ErrorStatement | void {
    let { tokenizer } = this;

    if (tokenizer.state === 'comment') {
      this.appendToCommentData(this.sourceForNode(rawMustache));
      return;
    }

    let mustache: ASTv1.MustacheStatement;
    let { escaped, loc, strip } = rawMustache;

    if (isHBSLiteral(rawMustache.path)) {
      mustache = this.builder.mustache({
        path: this.acceptNode<ASTv1.Literal>(rawMustache.path),
        params: [],
        hash: this.builder.hash([], this.source.spanFor(rawMustache.path.loc).collapse('end')),
        trusting: !escaped,
        loc: this.source.spanFor(loc),
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
        return ErrorStatement(result.error.message, result.error.location);
      }

      const { path, params, hash } = result.value;

      mustache = this.builder.mustache({
        path,
        params,
        hash,
        trusting: !escaped,
        loc: this.source.spanFor(loc),
        strip,
      });
    }

    switch (tokenizer.state) {
      // Tag helpers
      case 'tagOpen':
      case 'tagName':
        return this.#invalidCurly(ParserState.TagName, mustache.loc);

      case 'beforeAttributeName':
        addElementModifier(this.currentStartTag, mustache, this.builder);
        break;
      case 'attributeName':
      case 'afterAttributeName':
        this.beginAttributeValue(false);
        this.finishAttributeValue();
        addElementModifier(this.currentStartTag, mustache, this.builder);
        // @ts-expect-error FIXME
        tokenizer.transitionTo('beforeAttributeName');
        break;
      case 'afterAttributeValueQuoted':
        addElementModifier(this.currentStartTag, mustache, this.builder);
        // @ts-expect-error FIXME
        tokenizer.transitionTo('beforeAttributeName');
        break;

      // Attribute values
      case 'beforeAttributeValue':
        this.beginAttributeValue(false);
        this.appendDynamicAttributeValuePart(mustache);
        // @ts-expect-error FIXME
        tokenizer.transitionTo('attributeValueUnquoted');
        break;
      case 'attributeValueDoubleQuoted':
      case 'attributeValueSingleQuoted':
      case 'attributeValueUnquoted':
        this.appendDynamicAttributeValuePart(mustache);
        break;

      // TODO: Only append child when the tokenizer state makes
      // sense to do so, otherwise throw an error.
      default:
        appendChild(this.currentElement(), mustache);
    }

    console.log({ mustache });
    return mustache;
  }

  appendDynamicAttributeValuePart(part: ASTv1.MustacheStatement): void {
    this.finalizeTextPart();
    let attr = this.currentAttr;
    attr.isDynamic = true;
    attr.parts.push(part);
  }

  finalizeTextPart(): void {
    let attr = this.currentAttr;
    let text = attr.currentPart;
    if (text !== null) {
      this.currentAttr.parts.push(text);
      this.startTextPart();
    }
  }

  startTextPart(): void {
    this.currentAttr.currentPart = null;
  }

  ContentStatement(content: HBS.ContentStatement): void {
    updateTokenizerLocation(this.tokenizer, content);

    this.tokenizer.tokenizePart(content.value);
    this.tokenizer.flushData();
  }

  CommentStatement(rawComment: HBS.CommentStatement): Optional<ASTv1.MustacheCommentStatement> {
    let { tokenizer } = this;

    if (tokenizer.state === 'comment') {
      this.appendToCommentData(this.sourceForNode(rawComment));
      return null;
    }

    let { value, loc } = rawComment;
    let comment = this.builder.mustacheComment(value, this.source.spanFor(loc));

    switch (tokenizer.state) {
      case 'beforeAttributeName':
      case 'afterAttributeName':
        this.currentStartTag.comments.push(comment);
        break;

      case 'beforeData':
      case 'data':
        appendChild(this.currentElement(), comment);
        break;

      case 'attributeName':
        this.reportError(
          GlimmerSyntaxError.from(
            ['html.syntax.invalid-hbs-comment', ParserState.AttrName],
            this.source.spanFor(rawComment.loc)
          )
        );
        break;

      case 'attributeValueDoubleQuoted':
      case 'attributeValueSingleQuoted':
      case 'attributeValueUnquoted':
      case 'beforeAttributeValue':
        return this.#invalidComment(ParserState.AttrValue, rawComment.loc);

      default:
        this.#invalidComment(ParserState.Unknown, rawComment.loc);
    }

    return comment;
  }

  #invalidExpr(
    options: HbsErrorOptions | SymbolicSyntaxError,
    loc: HBS.SourceLocation
  ): HBS.ErrorExpression {
    const span = this.source.spanFor(loc);

    if (typeof options === 'string' || Array.isArray(options)) {
      this.reportError(GlimmerSyntaxError.from(options, this.source.spanFor(loc)));
    } else {
      this.reportError(
        GlimmerSyntaxError.from(['html.syntax.invalid-hbs-expression', options], span)
      );
    }

    return this.builder.errorExpression(`Invalid expression`, span);
  }

  #invalidComment(state: ParserState, loc: HBS.SourceLocation): ASTv1.MustacheCommentStatement {
    this.reportError(
      GlimmerSyntaxError.from(
        ['html.syntax.invalid-hbs-comment', ParserState.AttrValue],
        this.source.spanFor(loc)
      )
    );

    return this.builder.errorStatement(
      `Invalid comment${formatParserState(state)}`,
      this.source.spanFor(loc)
    );
  }

  #invalidCurly(state: ParserState, loc: HBS.SourceLocation): HBS.ErrorStatement {
    this.reportError(
      GlimmerSyntaxError.from(['html.syntax.invalid-hbs-curly', state], this.source.spanFor(loc))
    );

    return this.builder.errorStatement(
      `Invalid mustache${formatParserState(state)}`,
      this.source.spanFor(loc)
    );
  }

  #invalidHbsConstruct(
    construct: HbsConstruct,
    loc: HBS.SourceLocation
  ): HBS.ErrorStatement {
    this.reportError(
      GlimmerSyntaxError.from(
        ['hbs.syntax.unsupported-construct', construct],
        this.source.spanFor(loc)
      )
    );

    return this.builder.errorStatement(
      `invalid ${formatHbsConstruct(construct, 'singular')}`,
      this.source.spanFor(loc)
    );
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

  SubExpression(sexpr: HBS.SubExpression): ASTv1.SubExpression {
    const result = this.#acceptCallNodes(this, sexpr);
    return this.builder.sexpr({
      path,
      params,
      hash,
      loc: this.source.spanFor(sexpr.loc),
    });
  }

  PathExpression(path: HBS.PathExpression): ASTv1.PathExpression | HBS.ErrorExpression {
    let { original } = path;
    let parts: string[];

    if (original.indexOf('/') !== -1) {
      if (original.slice(0, 2) === './') {
        return this.#invalidExpr('hbs.syntax.invalid-dotslash', path.loc);
      }
      if (original.slice(0, 3) === '../') {
        return this.#invalidExpr('hbs.syntax.invalid-dotdot', path.loc);
      }
      if (original.indexOf('.') !== -1) {
        return this.#invalidExpr('hbs.syntax.invalid-slash', path.loc);
      }
      parts = [path.parts.join('/')];
    } else if (original === '.') {
      return this.#invalidExpr('hbs.syntax.invalid-dot', path.loc);
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
        loc: this.source.spanFor({
          start: path.loc.start,
          end: { line: path.loc.start.line, column: path.loc.start.column + 4 },
        }),
      };
    } else if (path.data) {
      let head = parts.shift();

      if (head === undefined) {
        throw generateSyntaxError(
          `Attempted to parse a path expression, but it was not valid. Paths beginning with @ must start with a-z.`,
          this.source.spanFor(path.loc)
        );
      }

      pathHead = {
        type: 'AtHead',
        name: `@${head}`,
        loc: this.source.spanFor({
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
        this.reportError(
          GlimmerSyntaxError.from('hbs.syntax.invalid-variable', this.source.spanFor(path.loc))
        );
        head = '';
      }

      pathHead = this.builder.head(
        head,
        this.source.spanFor({
          start: path.loc.start,
          end: {
            line: path.loc.start.line,
            column: path.loc.start.column + head.length,
          },
        })
      );
    }

    return this.builder.path({
      head: pathHead,
      tail: parts,
      loc: this.source.spanFor(path.loc),
    });
  }

  Hash(hash: HBS.Hash): ASTv1.Hash {
    let pairs: ASTv1.HashPair[] = [];

    for (let i = 0; i < hash.pairs.length; i++) {
      let pair = hash.pairs[i];
      pairs.push(
        this.builder.pair({
          key: pair.key,
          value: this.acceptNode(pair.value),
          loc: this.source.spanFor(pair.loc),
        })
      );
    }

    return this.builder.hash(pairs, this.source.spanFor(hash.loc));
  }

  StringLiteral(string: HBS.StringLiteral): ASTv1.StringLiteral {
    return this.builder.literal({
      type: 'StringLiteral',
      value: string.value,
      loc: string.loc,
    });
  }

  BooleanLiteral(boolean: HBS.BooleanLiteral): ASTv1.BooleanLiteral {
    return this.builder.literal({
      type: 'BooleanLiteral',
      value: boolean.value,
      loc: boolean.loc,
    });
  }

  NumberLiteral(number: HBS.NumberLiteral): ASTv1.NumberLiteral {
    return this.builder.literal({
      type: 'NumberLiteral',
      value: number.value,
      loc: number.loc,
    });
  }

  UndefinedLiteral(undef: HBS.UndefinedLiteral): ASTv1.UndefinedLiteral {
    return this.builder.literal({
      type: 'UndefinedLiteral',
      value: undefined,
      loc: undef.loc,
    });
  }

  NullLiteral(nul: HBS.NullLiteral): ASTv1.NullLiteral {
    return this.builder.literal({
      type: 'NullLiteral',
      value: null,
      loc: nul.loc,
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
      const path = node.path as ASTv1.Literal;
      const error = GlimmerSyntaxError.from(
        ['hbs.syntax.not-callable', path],
        this.source.spanFor(path.loc)
      );

      this.reportError(error);
      return { type: 'err', error };
    }

    const path =
      node.path.type === 'PathExpression'
        ? compiler.PathExpression(node.path)
        : compiler.SubExpression(node.path as unknown as HBS.SubExpression);

    const params = node.params
      ? node.params.map((e) => compiler.acceptNode<ASTv1.Expression>(e))
      : [];

    // if there is no hash, position it as a collapsed node immediately after the last param (or the
    // path, if there are also no params)
    const end = params.length > 0 ? params[params.length - 1].loc : path.loc;

    const hash = node.hash
      ? compiler.Hash(node.hash)
      : ({
          type: 'Hash',
          pairs: [] as ASTv1.HashPair[],
          loc: compiler.source.spanFor(end).collapse('end'),
        } as const);

    return { type: 'ok', value: { path, params, hash } };
  }
}

function calculateRightStrippedOffsets(original: string, value: string) {
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

function isLiteral(expression: HBS.Expression): expression is HBS.Literal {
  return expression.type.endsWith('Literal');
}

function updateTokenizerLocation(tokenizer: Parser['tokenizer'], content: HBS.ContentStatement) {
  let line = content.loc.start.line;
  let column = content.loc.start.column;

  let offsets = calculateRightStrippedOffsets(
    content.original as Recast<HBS.StripFlags, string>,
    content.value
  );

  line = line + offsets.lines;
  if (offsets.lines) {
    column = offsets.columns;
  } else {
    column = column + offsets.columns;
  }

  tokenizer.line = line;
  tokenizer.column = column;
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
