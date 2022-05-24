import { SourceSpan } from './source/loc/source-span.js';
import { GlimmerSyntaxError } from './syntax-error';
import { existing, type Maybe, type Optional } from './utils/exists.js';
import type * as ASTv1 from './v1/api';
import type * as HBS from './v1/handlebars-ast';

// Regex to validate the identifier for block parameters.
// Based on the ID validation regex in Handlebars.

let ID_INVERSE_PATTERN = /[!"#%-,./;->@[-^`{-~]/;

export function getBlockParams(attributes: ASTv1.AttrNode[]):
  | {
      type: 'ok';
      attrs: ASTv1.AttrNode[];
      blockParams: string[];
    }
  | { type: 'err'; error: GlimmerSyntaxError; attrs: []; blockParams: [] } {
  const parsed = ParsedBlockParams.parse(preparseAttrs(attributes));

  if (parsed === null) {
    return { type: 'ok', attrs: attributes, blockParams: [] };
  }

  const asNames = parsed.names;

  switch (asNames.type) {
    case 'ok': {
      return { type: 'ok', attrs: asNames.attributes, blockParams: asNames.params };
    }
    case 'err': {
      return { type: 'err', error: asNames.error, attrs: [], blockParams: [] };
    }
  }
}

// interface PipeNodes {
class ValidPipeNodes {
  constructor(
    readonly as: ASTv1.AttrNode,
    readonly pair: PipePair,
    readonly before: ASTv1.AttrNode[]
  ) {}

  get params(): string[] | GlimmerSyntaxError {
    return this.pair.params;
  }
}

class ParsedBlockParams {
  static parse(attributes: ASTv1.AttrNode[]): ParsedBlockParams | null {
    const { found: foundAs, rest: afterAs } = findBareAttr(attributes, 'as');

    if (foundAs === null) {
      const { found: foundFirstPipe, rest: afterFirstPipe } = findBareAttr(attributes, '|');

      if (foundFirstPipe === null) {
        return null;
      }

      const { found: foundSecondPipe, rest: afterSecondPipe } = findBareAttr(afterFirstPipe, '|');

      if (foundSecondPipe === null || afterSecondPipe.length > 0) {
        return new ParsedBlockParams(new MissingAs(foundFirstPipe.node, null));
      } else {
        return new ParsedBlockParams(new MissingAs(foundFirstPipe.node, foundSecondPipe.node));
      }
    } else {
      const { node: as, before: attributes } = foundAs;
      const { found: foundFirstPipe, rest: afterFirstPipe } = findBareAttr(afterAs, '|');

      if (foundFirstPipe === null) {
        return new ParsedBlockParams(
          new NoPipes(foundAs.node, NodeGroupWithHead.from(afterFirstPipe))
        );
      }

      const firstPipe = foundFirstPipe.node;
      const { found: foundSecondPipe, rest: afterSecondPipe } = findBareAttr(afterFirstPipe, '|');

      if (foundSecondPipe === null) {
        return new ParsedBlockParams(
          new UnclosedPipe(firstPipe, NodeGroupWithTail.from(afterSecondPipe))
        );
      }

      const { node: secondPipe, before: params } = foundSecondPipe;

      if (afterSecondPipe.length > 0) {
        const { found: foundLastPipe, rest: afterLastPipe } = findLastBareAttr(
          afterSecondPipe,
          '|'
        );

        if (foundLastPipe === null) {
          return new ParsedBlockParams(
            new ExtraAttributes(existing(NodeGroupWithHead.from(afterSecondPipe), 'FIXME'))
          );
        } else {
          const { before: extraPipes, node } = foundLastPipe;
          extraPipes.push(node);
          return new ParsedBlockParams(
            new TooManyPipes(
              existing(NodeGroupWithHead.from(extraPipes), 'FIXME'),
              NodeGroupWithTail.from(afterLastPipe)
            )
          );
        }
      } else if (params.length === 0) {
        return new ParsedBlockParams(new EmptyBlockParams(foundFirstPipe.node, secondPipe));
      } else {
        return new ParsedBlockParams(
          new ValidPipeNodes(as, new PipePair(firstPipe, secondPipe, params), attributes)
        );
      }
    }
  }

  constructor(readonly nodes: ValidPipeNodes | Problem) {}

  get names():
    | { type: 'ok'; params: string[]; attributes: ASTv1.AttrNode[] }
    | { type: 'err'; error: GlimmerSyntaxError } {
    if (this.nodes instanceof ValidPipeNodes) {
      const params = this.nodes.params;

      if (Array.isArray(params)) {
        return { type: 'ok', params, attributes: this.nodes.before };
      } else {
        return { type: 'err', error: params };
      }
    } else {
      return { type: 'err', error: this.nodes.error };
    }
  }
}

class PipePair {
  constructor(
    readonly first: ASTv1.AttrNode,
    readonly second: ASTv1.AttrNode,
    readonly paramNodes: ASTv1.AttrNode[]
  ) {}

  get loc() {
    return this.first.loc.extend(this.second.loc);
  }

  get params(): string[] | GlimmerSyntaxError {
    const params = [];

    for (const node of this.paramNodes) {
      const name = node.name;

      if (ID_INVERSE_PATTERN.exec(name)) {
        return GlimmerSyntaxError.from(['block-params.invalid-id', name], node.loc);
      }

      params.push(name);
    }

    return params;
  }
}

class NodeGroupWithHead {
  static from(attributes: ASTv1.AttrNode[]): NodeGroupWithHead | null {
    if (attributes.length > 0) {
      const head = attributes[0];
      const rest = attributes.slice(1);
      return new NodeGroupWithHead(head, rest);
    } else {
      return null;
    }
  }

  constructor(readonly head: ASTv1.AttrNode, readonly rest: ASTv1.AttrNode[]) {}

  get loc(): SourceSpan {
    if (this.rest.length === 0) {
      return this.head.loc;
    } else {
      return this.head.loc.extend(this.rest[this.rest.length - 1].loc);
    }
  }
}

class NodeGroupWithTail {
  static from(attributes: ASTv1.AttrNode[]): NodeGroupWithTail | null {
    if (attributes.length > 0) {
      const tail = attributes[attributes.length - 1];
      return new NodeGroupWithTail(tail, attributes.slice(0, attributes.length - 1));
    } else {
      return null;
    }
  }

  constructor(readonly tail: ASTv1.AttrNode, readonly rest: ASTv1.AttrNode[]) {}

  get loc(): SourceSpan {
    if (this.rest.length === 0) {
      return this.tail.loc;
    } else {
      return this.rest[0].loc.extend(this.tail.loc);
    }
  }
}

interface Problem {
  readonly error: GlimmerSyntaxError;
}

class MissingAs implements Problem {
  constructor(readonly open: ASTv1.AttrNode, readonly close: ASTv1.AttrNode | null) {}

  get error(): GlimmerSyntaxError {
    if (this.close) {
      return GlimmerSyntaxError.from('block-params.missing-as', span(this.open, this.close));
    } else {
      return GlimmerSyntaxError.from('block-params.missing-as-before-unclosed-pipe', this.open.loc);
    }
  }
}

class EmptyBlockParams implements Problem {
  constructor(readonly open: ASTv1.AttrNode, readonly close: ASTv1.AttrNode) {}

  get error(): GlimmerSyntaxError {
    return GlimmerSyntaxError.from('block-params.empty', span(this.open, this.close));
  }
}

class NoPipes implements Problem {
  constructor(readonly as: ASTv1.Node, readonly rest: Optional<NodeGroupWithHead>) {}

  get error() {
    return GlimmerSyntaxError.from('block-params.missing-pipe', span(this.as, this.rest?.head));
  }
}

class UnclosedPipe implements Problem {
  constructor(
    // the opening pipe
    readonly open: ASTv1.AttrNode,
    readonly rest: NodeGroupWithTail | null
  ) {}

  get error(): GlimmerSyntaxError {
    return GlimmerSyntaxError.from('block-params.unclosed', span(this.open, this.rest));
  }
}

class TooManyPipes implements Problem {
  constructor(
    readonly extraPipes: NodeGroupWithHead,
    // any attributes after the last pipe
    readonly attrs: Optional<NodeGroupWithTail>
  ) {}

  get error(): GlimmerSyntaxError {
    if (this.attrs) {
      return GlimmerSyntaxError.from(
        'block-params.extra-pipes-and-attrs',
        this.extraPipes.loc.extend(this.attrs.loc)
      );
    } else {
      return GlimmerSyntaxError.from('block-params.extra-pipes', this.extraPipes.loc);
    }
  }
}

class ExtraAttributes implements Problem {
  constructor(readonly extra: NodeGroupWithHead) {}

  get error(): GlimmerSyntaxError {
    return GlimmerSyntaxError.from('block-params.extra-attrs', this.extra.loc);
  }
}

export function childrenFor(
  node: ASTv1.Block | ASTv1.Template | ASTv1.ElementNode
): ASTv1.TopLevelStatement[] {
  switch (node.type) {
    case 'Block':
    case 'Template':
      return node.body;
    case 'ElementNode':
      return node.children;
  }
}

export function appendChild(parent: ASTv1.Parent, node: ASTv1.Statement): void {
  childrenFor(parent).push(node);
}

export function isHBSLiteral(path: HBS.Expression): path is HBS.Literal;
export function isHBSLiteral(path: ASTv1.Expression): path is ASTv1.Literal;
export function isHBSLiteral(
  path: HBS.Expression | ASTv1.Expression
): path is HBS.Literal | ASTv1.Literal {
  return (
    path.type === 'StringLiteral' ||
    path.type === 'BooleanLiteral' ||
    path.type === 'NumberLiteral' ||
    path.type === 'NullLiteral' ||
    path.type === 'UndefinedLiteral'
  );
}

export function printLiteral(literal: ASTv1.Literal): string {
  if (literal.type === 'UndefinedLiteral') {
    return 'undefined';
  } else {
    return JSON.stringify(literal.value);
  }
}

export function isUpperCase(tag: string): boolean {
  return tag[0] === tag[0].toUpperCase() && tag[0] !== tag[0].toLowerCase();
}

export function isLowerCase(tag: string): boolean {
  return tag[0] === tag[0].toLowerCase() && tag[0] !== tag[0].toUpperCase();
}

function span(start: { loc: SourceSpan }, end: Maybe<{ loc: SourceSpan }>) {
  if (end) {
    return start.loc.extend(end.loc);
  } else {
    return start.loc;
  }
}

type FoundBareAttr =
  | {
      found: { node: ASTv1.AttrNode; before: ASTv1.AttrNode[] };
      rest: ASTv1.AttrNode[];
    }
  | { found: null; rest: ASTv1.AttrNode[] };

type FoundLastBareAttr =
  | {
      found: { node: ASTv1.AttrNode; before: ASTv1.AttrNode[] };
      rest: ASTv1.AttrNode[];
    }
  | { found: null; rest: ASTv1.AttrNode[] };

function preparseAttrs(attrs: ASTv1.AttrNode[]): ASTv1.AttrNode[] {
  return attrs.flatMap(preparseAttr);
}

function preparseAttr(attr: ASTv1.AttrNode): ASTv1.AttrNode[] {
  if (!isBareAttr(attr)) {
    return [attr];
  }

  const { name } = attr;
  const match = existing(name.match(/^(\|?)(.*?)(\|?)$/), 'the regex matches any input string');

  const openPipe = match[1];
  const body = match[2];
  const closePipe = match[3];

  const attrs = [];
  let loc = attr.loc;

  if (openPipe) {
    attrs.push(bareAttr(openPipe, loc.sliceStartChars({ chars: 1 })));
    loc = loc.slice({ skipStart: 1 });
  }

  if (body) {
    attrs.push(bareAttr(body, closePipe ? loc.slice({ skipEnd: 1 }) : loc));
  }

  if (closePipe) {
    attrs.push(bareAttr(closePipe, loc.sliceEndChars({ chars: 1 })));
  }

  return attrs;
}

function bareAttr(name: string, loc: SourceSpan): ASTv1.AttrNode {
  return {
    type: 'AttrNode',
    name,
    value: {
      type: 'TextNode',
      chars: '',
      loc: SourceSpan.missing(loc.getTemplate()),
    },
    loc,
  };
}

function findLastBareAttr(attributes: ASTv1.AttrNode[], name: string): FoundLastBareAttr {
  for (let i = attributes.length - 1; i >= 0; i--) {
    const attr = attributes[i];
    if (isBareAttrNamed(attr, name)) {
      return {
        found: { node: attr, before: attributes.slice(0, i) },
        rest: attributes.slice(i + 1),
      };
    }
  }

  return { found: null, rest: attributes };
}

function findBareAttr(attributes: ASTv1.AttrNode[], name: string): FoundBareAttr {
  const index = attributes.findIndex((attr) => isBareAttrNamed(attr, name));

  if (index !== -1) {
    const before = attributes.slice(0, index);
    return {
      found: { node: attributes[index], before },
      rest: attributes.slice(index + 1),
    };
  } else {
    return { found: null, rest: attributes };
  }
}

function isBareAttrNamed(attr: ASTv1.AttrNode, name: string): boolean {
  return attr.name === name && isBareAttr(attr);
}

function isBareAttr(attr: ASTv1.AttrNode): boolean {
  return attr.value.type === 'TextNode' && attr.value.chars === '';
}
