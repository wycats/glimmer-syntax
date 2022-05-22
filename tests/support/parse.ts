import type { ASTv1 } from '@glimmer/syntax';
import { preprocess, type PreprocessOptions } from '@glimmer/syntax';

export function parse(source: string, options?: PreprocessOptions): ASTv1.Template {
  // these tests were originally written with two indents, but they are now
  // nested inside of four. This is a hack to make the tests pass.
  //
  // TODO: Fix test locations to use four indents.
  const outdented =
    source.includes('\n') && source.startsWith('\n')
      ? source
          .split('\n')
          .map((line) => line.slice(2))
          .join('\n')
      : source;

  return preprocess(outdented, { meta: { moduleName: 'test-module' }, ...options });
}
