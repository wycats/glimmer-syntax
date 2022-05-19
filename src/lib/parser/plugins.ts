import { EntityParser } from 'simple-html-tokenizer';

import print from '../generation/print';
import type { SourceTemplate } from '../source/source';
import traverse from '../traversal/traverse';
import type { NodeVisitor } from '../traversal/visitor';
import Walker from '../traversal/walker';
import { PublicBuilders } from '../v1/public-builders';
import { NormalizedPreprocessOptions, Preprocess, template } from './preprocess';

/**
  ASTPlugins can make changes to the Glimmer template AST before
  compilation begins.
*/
export interface ASTPluginBuilder<TEnv extends ASTPluginEnvironment = ASTPluginEnvironment> {
  (env: TEnv): ASTPlugin;
}

export interface ASTPlugin {
  name: string;
  visitor: NodeVisitor;
}

export interface ASTPluginEnvironment {
  meta?: object;
  syntax: Syntax;
}

// export interface Syntax {
//   parse: typeof preprocess;
//   builders: typeof publicBuilder;
//   print: typeof print;
//   traverse: typeof traverse;
//   Walker: typeof Walker;
// }

export class Syntax {
  static create(template: SourceTemplate): Syntax {
    return new Syntax(template);
  }

  #template: SourceTemplate;

  constructor(template: SourceTemplate) {
    this.#template = template;
    this.builders = PublicBuilders.top(template);
  }

  readonly parse = Preprocess({
    preprocess: (input, options) => {
      if (options) {
        const source = template.sub(
          this.#template,
          input,
          NormalizedPreprocessOptions.from(options, this.#template.module)
        );
        return source.preprocess();
      } else {
        return template.sub(this.#template, input).preprocess();
      }
    },

    normalized: (input, options) => {
      return template.sub(this.#template, input, options).preprocess();
    },
  });

  readonly builders: PublicBuilders;
  readonly print = print;
  readonly traverse = traverse;
  readonly Walker = Walker;
}

export class CodemodEntityParser extends EntityParser {
  // match upstream types, but never match an entity
  constructor() {
    super({});
  }

  parse(): string | undefined {
    return undefined;
  }
}
