// import { Buildersv1 } from "@glimmer/syntax";
// import { element } from "./parser-node-test";
// import { astEqual } from "./support";

import { Buildersv1 } from '@glimmer/syntax';
import { describe, it } from 'vitest';

import { astEqual } from './support.js';
import { element } from './support/element.js';

const b = Buildersv1.forModule('', 'test-module');

describe('builders', () => {
  it('element uses comments as loc when comments is not an array', () => {
    let actual = element('div', ['loc', b.loc(1, 1, 1, 1)]);
    let expected = element('div', ['loc', b.loc(1, 1, 1, 1)]);

    astEqual(actual, expected);
  });
});
