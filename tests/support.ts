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
      const keys = Object.keys(obj) as (keyof typeof obj)[];
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === 'loc' || key === 'type') continue;
        newObj[key] = normalizeNode(obj[key]);
      }
    }
    return newObj;
  } else {
    return obj;
  }
}

export type ExpectedAST = NodeInput | string;

export function astEqual(
  actual: ExpectedAST | null | undefined,
  expected: ExpectedAST | null | undefined,
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
}

function json(unknown: object): object {
  return JSON.parse(JSON.stringify(unknown)) as object;
}
