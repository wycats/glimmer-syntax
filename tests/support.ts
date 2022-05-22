import type { ASTv1, PreprocessOptions } from '@glimmer/syntax';
import { expect } from 'vitest';
import { parse } from './support/parse.js';

type NodeInput = ASTv1.Node | ASTv1.Node[];

function normalizeNode(obj: NodeInput): NodeInput {
  if (obj && typeof obj === 'object') {
    let newObj: any;
    if (Array.isArray(obj)) {
      newObj = obj.slice();
      for (let i = 0; i < obj.length; i++) {
        newObj[i] = normalizeNode(obj[i]);
      }
    } else {
      newObj = {};
      let keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        let key = keys[i];
        if (key === 'loc') continue;
        newObj[key] = normalizeNode(obj[key]);
      }
    }
    return newObj;
  } else {
    return obj;
  }
}

export function astEqual(
  actual: NodeInput | string | null | undefined,
  expected: NodeInput | string | null | undefined,
  message?: string,
  parseOptions?: PreprocessOptions
) {
  if (actual === null || actual === undefined) {
    throw Error(
      `astEqual requires actual and expected to be defined, actual was ${String(actual)}`
    );
  }

  if (expected === null || expected === undefined) {
    throw Error(
      `astEqual requires actual and expected to be defined, expected was ${String(expected)}`
    );
  }

  if (typeof actual === 'string') {
    actual = parse(actual, { throwErrors: false, ...parseOptions });

    if (actual.errors?.length) {
      throw Error(
        `astEqual requires actual to be valid, actual had ${actual.errors.length} errors\n\n${actual.errors[0].message}`
      );
    }
  }
  if (typeof expected === 'string') {
    expected = parse(expected, { throwErrors: false, ...parseOptions });
  }

  const normalized = {
    actual: normalizeNode(actual),
    expected: normalizeNode(expected),
  };

  expect(json(normalized.actual), message).toMatchObject(json(normalized.expected));

  // QUnit.assert.deepEqual(
  //   JSON.parse(JSON.stringify(actual)),
  //   JSON.parse(JSON.stringify(expected)),
  //   message
  // );
}

function json(unknown: object): object {
  return JSON.parse(JSON.stringify(unknown)) as object;
}
