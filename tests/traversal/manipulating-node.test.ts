import {
  ASTv1,
  Buildersv1,
  cannotRemoveNode,
  cannotReplaceNode,
  preprocess as parse,
  traverse,
  type NodeVisitor,
  type TraversalError,
} from '@glimmer/syntax';
import { describe, expect, test } from 'vitest';
import { astEqual, type ExpectedAST } from '../support';

const b = Buildersv1.forModule('', 'test-module');

interface TestNode<Node extends ASTv1.BaseNode, Out> {
  type: 'TestNode';
  classic: (node: Node) => Out;
  modern: (node: Node) => Out;
}

function simplePathClassic(
  path: ASTv1.Expression
): { name: string; expr: ASTv1.PathExpression } | null {
  if (path.type === 'PathExpression' && path.parts.length === 1) {
    return { name: path.parts[0], expr: path };
  } else {
    return null;
  }
}

function simplePathModern(
  expr: ASTv1.Expression
): { name: string; expr: ASTv1.PathExpression } | null {
  const path = ASTv1.$.path(expr);

  if (path?.isVar()) {
    return { name: path.node.head.name, expr: path.node };
  } else {
    return null;
  }
}

function pathIs<T, V extends { [P in string]: (node: N) => T }, N extends ASTv1.CallNode>(
  value: V
): TestNode<N, T | void> {
  return {
    type: 'TestNode',
    classic(node): T | void {
      const path = simplePathClassic(node.path);

      if (path === null) {
        return;
      }

      if (path.name in value) {
        return value[path.name](node);
      }
    },
    modern(node): T | void {
      const path = simplePathModern(node.path);

      if (path === null) {
        return;
      }

      if (path.name in value) {
        return value[path.name](node);
      }
    },
  };
}

function assert<N extends ASTv1.BaseNode>(
  input: string,
  transform: TestNode<N, ASTv1.Statement | ASTv1.Statement[] | null | void>,
  error: (options: { element: ASTv1.ElementNode; attr: ASTv1.AttrNode }) => TraversalError
) {
  let ast = parse(input);
  let el = ast.body[0] as ASTv1.ElementNode;
  let attr = el.attributes[0];

  for (const style of ['classic', 'modern'] as const) {
    for (const eventName of ['enter', 'exit'] as const) {
      expect(() => {
        traverse(ast, {
          MustacheStatement: {
            [eventName]: (node: N) => {
              return transform[style](node);
            },
          },
        });
      }).toThrowError(error({ element: el, attr }));
    }
  }
}

type TransformStatement<N extends ASTv1.Statement = ASTv1.Statement> = TestNode<
  N,
  ASTv1.Statement | ASTv1.Statement[] | null | void
>;

type TransformMustacheSugar = TransformStatement<ASTv1.MustacheStatement>;

interface TransformStatements {
  MustacheStatement?: TransformMustacheSugar;
  BlockStatement?: TransformStatement<ASTv1.BlockStatement>;
}

type TransformStatementsSugar = TransformMustacheSugar | TransformStatements;

function normalizeSugar(
  sugar: TransformStatementsSugar
): (style: 'classic' | 'modern') => NodeVisitor {
  return (style) => {
    if ('type' in sugar) {
      return {
        MustacheStatement: (node: ASTv1.MustacheStatement) => {
          return sugar[style](node);
        },
      };
    } else {
      const visitor: Record<string, any> = {};

      for (const [key, value] of Object.entries(sugar)) {
        visitor[key as keyof ASTv1.Nodes] = (node: any) => {
          return value[style](node);
        };
      }

      return visitor as NodeVisitor;
    }
  };
}

/**
 * This helper function is used to test the replacement of a mustache statement.
 */
function replace(
  input: string,
  transform: TransformStatementsSugar,
  expected: ExpectedAST,
  options: {
    events: ['enter'] | ['exit'] | ['enter', 'exit'] | [];
  } = { events: ['enter', 'exit'] }
) {
  const transforms = normalizeSugar(transform);

  for (const style of ['classic', 'modern'] as const) {
    for (const eventName of options.events) {
      let ast = parse(input);

      traverse(ast, transforms(style));

      astEqual(ast, expected, `on ${eventName}, using ${style} APIs`);
    }

    let ast = parse(input);
    traverse(ast, transforms(style));
    astEqual(ast, expected, `using simple node transform, ${style} APIs`);
  }
}

function cannotRemoveAttr(options: { attr: ASTv1.AttrNode }) {
  return cannotRemoveNode(options.attr.value, options.attr, 'value');
}

function cannotReplaceAttr(options: { attr: ASTv1.AttrNode }) {
  return cannotReplaceNode(options.attr.value, options.attr, 'value');
}

describe('Traversal - manipulating', () => {
  describe('illegal: removing an attribute', () => {
    test('by replacing its value with null or an empty array', () => {
      assert(`<x y={{z}} />`, pathIs({ z: () => null }), cannotRemoveAttr);

      assert(`<x y={{z}} />`, pathIs({ z: () => [] }), cannotRemoveAttr);
    });
  });

  describe('Replacing an attribute value', () => {
    test(`by returning a new node`, () => {
      replace(
        `<x y={{z}} />`,
        pathIs({
          z: (path) => b.mustache('a', path),
        }),
        `<x y={{a}} />`
      );
    });

    test(`by returning an array with a single node`, () => {
      replace(`<x y={{z}} />`, pathIs({ z: (path) => [b.mustache('a', path)] }), `<x y={{a}} />`);
    });

    test(`illegal: replacing with multiple statements`, () => {
      assert(
        `<x y={{z}} />`,
        pathIs({ z: (path) => [b.mustache('a', path), b.mustache('b', path)] }),
        cannotReplaceAttr
      );
    });
  });

  describe('replacing a node that is in an array of nodes', () => {
    describe('removing the node', () => {
      test(`by replacing the first node with null or an empty array`, () => {
        replace(`{{x}}{{y}}{{z}}`, pathIs({ x: () => null }), `{{y}}{{z}}`);

        replace(`{{x}}{{y}}{{z}}`, pathIs({ x: () => [] }), `{{y}}{{z}}`);
      });

      test(`by replacing a middle node with null or an empty array`, () => {
        replace(`{{x}}{{y}}{{z}}`, pathIs({ y: () => null }), `{{x}}{{z}}`);

        replace(`{{x}}{{y}}{{z}}`, pathIs({ y: () => [] }), `{{x}}{{z}}`);
      });

      test(`by replacing the last node with null or an empty array`, () => {
        replace(`{{x}}{{y}}{{z}}`, pathIs({ z: () => null }), `{{x}}{{y}}`);

        replace(`{{x}}{{y}}{{z}}`, pathIs({ z: () => [] }), `{{x}}{{y}}`);
      });
    });

    describe('replacing the node with a single node', () => {
      test(`by returning a new node`, () => {
        replace(
          `{{x}}{{y}}{{z}}`,
          pathIs({ x: (path) => b.mustache('a', path) }),
          `{{a}}{{y}}{{z}}`
        );
      });

      test(`by returning an array with a single node`, () => {
        replace(
          `{{x}}{{y}}{{z}}`,
          pathIs({ x: (path) => [b.mustache('a', path)] }),
          `{{a}}{{y}}{{z}}`
        );
      });
    });

    describe('replacing the node with multiple nodes', () => {
      test(`by returning an array with multiple nodes`, () => {
        replace(
          `{{x}}{{y}}{{z}}`,
          pathIs({ y: (path) => [b.mustache('a', path), b.mustache('b', path)] }),
          `{{x}}{{a}}{{b}}{{z}}`
        );
      });
    });
  });

  describe('regression', () => {
    test('replacing a node inside of a block', () => {
      replace(
        `{{y}}{{#w}}{{x}}{{y}}{{z}}{{/w}}`,
        pathIs({ y: () => [b.mustache('a'), b.mustache('b'), b.mustache('c')] }),
        `{{a}}{{b}}{{c}}{{#w}}{{x}}{{a}}{{b}}{{c}}{{z}}{{/w}}`
      );
    });

    // TODO: Is the 'except on the exit event' restriction valid?
    test(`recursively walks the transformed node, except on the exit event`, () => {
      replace(
        `{{x}}{{y}}{{z}}`,
        pathIs({
          x: () => b.mustache('y'),
          y: () => b.mustache('z'),
        }),
        `{{z}}{{z}}{{z}}`,
        { events: ['enter'] }
      );
    });

    test(`recursively walks the transformed node's new contents`, () => {
      replace(
        `{{#foo}}{{#bar}}{{baz}}{{/bar}}{{else}}{{#bar}}{{bat}}{{/bar}}{{/foo}}`,
        {
          BlockStatement: pathIs({
            foo: (node) =>
              b.block(
                b.path('x-foo'),
                node.params,
                node.hash,
                node.program,
                node.inverse,
                node.loc
              ),
            bar: (node) =>
              b.block(
                b.path('x-bar'),
                node.params,
                node.hash,
                node.program,
                node.inverse,
                node.loc
              ),
          }),
          MustacheStatement: pathIs({
            baz: () => b.mustache('x-baz'),
            bat: () => b.mustache('x-bat'),
          }),
        },
        `{{#x-foo}}{{#x-bar}}{{x-baz}}{{/x-bar}}{{else}}{{#x-bar}}{{x-bat}}{{/x-bar}}{{/x-foo}}`,
        { events: ['exit'] }
      );
    });

    test(`exit event is not triggered if the node is replaced during the enter event`, () => {
      let ast = parse(`{{x}}`);

      traverse(ast, {
        MustacheStatement: {
          enter() {
            return b.mustache('y');
          },
          exit(node) {
            if (ASTv1.$(node.path).isVar('x')) {
              throw Error(`the exit event should not be called for a node that was replaced`);
            }
          },
        },
      });
    });
  });
});
