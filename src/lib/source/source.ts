// eslint-disable-next-line import/no-extraneous-dependencies
import { DEBUG } from '@glimmer/env';
import { parse, parseWithoutProcessing } from '@handlebars/parser';

import type { ASTv1 } from '../../index';
import { getEmbedderLocals } from '../get-template-locals';
import { type ASTPluginEnvironment, CodemodEntityParser, Syntax } from '../parser/plugins';
import type { NormalizedPreprocessOptions } from '../parser/preprocess';
import { TokenizerEventHandlers } from '../parser/tokenizer-event-handlers';
import traverse from '../traversal/traverse';
import { assert } from '../utils/assert.js';
import type { Optional } from '../utils/exists.js';
import type { SourcePosition } from '../v1/handlebars-ast';
import type * as HBS from '../v1/handlebars-ast';
import { SourceOffset } from './loc/offset';
import { SourceSpan } from './loc/source-span';

export class SourceTemplate {
  constructor(
    readonly source: string | null,
    private ast: HBS.Program | null,
    readonly options: NormalizedPreprocessOptions
  ) {}

  get module(): string {
    return this.options.module.name;
  }

  get purpose(): 'codemod' | 'precompile' {
    return this.options.mode.purpose;
  }

  get lines(): string[] | null {
    return this.source?.split('\n') ?? null;
  }

  withOptions(options: NormalizedPreprocessOptions): SourceTemplate {
    return new SourceTemplate(this.source, this.ast, options);
  }

  embedderHasBinding(name: string): boolean {
    return this.options.embedder.hasBinding(name);
  }

  /**
   *
   * @param throws
   * @returns
   */
  preprocess(): ASTv1.Template {
    const ast = this.parse(this.handlebarsAST);

    if (ast.errors) {
      if (this.options.mode.errors === 'throw') {
        throw ast.errors[0];
      } else {
        return ast;
      }
    } else {
      return this.applyPlugins(this.parse(this.handlebarsAST));
    }
  }

  private applyPlugins(template: ASTv1.Template): ASTv1.Template {
    const plugins = this.options.plugins.ast;
    const env: ASTPluginEnvironment = {
      meta: this.options.meta,
      syntax: new Syntax(this),
    };

    if (plugins) {
      for (const transform of plugins) {
        const result = transform(env);

        traverse(template, result.visitor);
      }
    }

    return template;
  }

  private parse(ast: HBS.Program): ASTv1.Template {
    const entityParser = this.purpose === 'codemod' ? new CodemodEntityParser() : undefined;
    const parser = new TokenizerEventHandlers(this, entityParser);
    const program = parser.acceptTemplate(ast);
    program.blockParams = getEmbedderLocals(program) ?? [];
    return program;
  }

  private get handlebarsAST(): HBS.Program {
    if (this.ast === null) {
      const ast = (this.ast = this.parseHBS());

      const offsets = SourceSpan.forCharPositions(this, 0, this.source?.length ?? 0);
      ast.loc = {
        source: '(program)',
        start: offsets.startPosition,
        end: offsets.endPosition,
      };
    }

    return this.ast;
  }

  private parseHBS() {
    if (this.purpose === 'codemod') {
      return parseWithoutProcessing(this.source ?? '', this.options.handlebars) as HBS.Program;
    } else {
      return parse(this.source ?? '', this.options.handlebars) as HBS.Program;
    }
  }

  /**
   * Validate that the character offset represents a position in the source string.
   */
  check(offset: number): boolean {
    return offset >= 0 && offset <= (this.source?.length ?? 0);
  }

  slice(start: number, end: number): string {
    return (this.source ?? '').slice(start, end);
  }

  offsetFor(line: number, column: number): SourceOffset {
    return SourceOffset.pos(this, { line, column });
  }

  spanFor({ start, end }: { start: SourcePosition; end: SourcePosition }): SourceSpan {
    return SourceSpan.loc(this, {
      source: this.module,
      start: { line: start.line, column: start.column },
      end: { line: end.line, column: end.column },
    });
  }

  hbsPosFor(offset: number): Optional<SourcePosition> {
    let seenLines = 0;
    let seenChars = 0;

    if (offset > (this.source?.length ?? 0)) {
      return null;
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const nextLine = (this.source ?? '').indexOf('\n', seenChars);

      if (offset <= nextLine || nextLine === -1) {
        return {
          line: seenLines + 1,
          column: offset - seenChars,
        };
      } else {
        seenLines += 1;
        seenChars = nextLine + 1;
      }
    }
  }

  charPosFor(position: SourcePosition): number | null {
    const { line, column } = position;
    const sourceString = this.source ?? '';
    const sourceLength = sourceString.length;
    let seenLines = 0;
    let seenChars = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (seenChars >= sourceLength) return sourceLength;

      let nextLine = (this.source ?? '').indexOf('\n', seenChars);
      if (nextLine === -1) nextLine = (this.source ?? '').length;

      if (seenLines === line - 1) {
        if (seenChars + column > nextLine) return nextLine;

        if (DEBUG) {
          const roundTrip = this.hbsPosFor(seenChars + column);
          assert(roundTrip !== null, `the returned offset failed to round-trip`);
          assert(roundTrip.line === line, `the round-tripped line didn't match the original line`);
          assert(
            roundTrip.column === column,
            `the round-tripped column didn't match the original column`
          );
        }

        return seenChars + column;
      } else if (nextLine === -1) {
        return 0;
      } else {
        seenLines += 1;
        seenChars = nextLine + 1;
      }
    }
  }
}
