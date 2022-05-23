import { preprocess as parse, Walker } from '@glimmer/syntax';
import { describe, expect, test } from 'vitest';

function compareWalkedNodes(html: string, expected: string[]) {
  let ast = parse(html);
  let walker = new Walker();
  let nodes: string[] = [];

  walker.visit(ast, function (node) {
    nodes.push(node.type);
  });

  expect(nodes).toEqual(expected);
}

describe('legacy: Traversal - Walker', () => {
  test('walks elements', function () {
    compareWalkedNodes('<div><li></li></div>', ['Template', 'ElementNode', 'ElementNode']);
  });

  test('walks blocks', function () {
    compareWalkedNodes('{{#foo}}<li></li>{{/foo}}', [
      'Template',
      'BlockStatement',
      'Block',
      'ElementNode',
    ]);
  });
});
