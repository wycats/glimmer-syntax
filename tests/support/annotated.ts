import type { SourceTemplate } from '@glimmer/syntax';
import {
  type NormalizedPreprocessFields,
  NormalizedPreprocessOptions,
  SourceSpan,
  template,
} from '@glimmer/syntax';

export class AnnotatedSource {
  static from(annotated: string, options?: Partial<NormalizedPreprocessFields>) {
    const open = annotated.indexOf('~#');

    if (open === -1) {
      throw new Error(`Expected to find a ~# in ${annotated}`);
    }

    const secondOpen = annotated.indexOf('~#', open + 1);

    if (secondOpen !== -1) {
      throw Error(`Expected only one ~# in ${annotated}`);
    }

    const close = annotated.indexOf('#~');

    if (close === -1) {
      throw new Error(`Expected to find a #~ in ${annotated}`);
    }

    const secondClose = annotated.indexOf('#~', close + 1);

    if (secondClose !== -1) {
      throw Error(`Expected only one #~ in ${annotated}`);
    }

    const before = annotated.slice(0, open);
    const after = annotated.slice(close + 2);
    const at = annotated.slice(open + 2, close);

    const source = `${before}${at}${after}`;

    const t = options
      ? template.normalized(
          source,
          NormalizedPreprocessOptions.fromFields(
            {
              ...options,
              mode: {
                strictness: options.mode?.strictness ?? 'strict',
                purpose: options.mode?.purpose ?? 'precompile',
                errors: 'report',
              },
            },
            {
              name: 'test-module',
              synthesized: false,
            }
          )
        )
      : template(source, 'test-module', { throwErrors: false });

    const span = SourceSpan.forCharPositions(t, open, open + at.length);

    return new AnnotatedSource(t, source, span);
  }

  #template: SourceTemplate;
  #source: string;
  #span: SourceSpan;

  constructor(template: SourceTemplate, source: string, span: SourceSpan) {
    this.#template = template;
    this.#source = source;
    this.#span = span;
  }

  get template(): SourceTemplate {
    return this.#template;
  }

  get options(): NormalizedPreprocessOptions {
    return this.#template.options;
  }

  get module(): string {
    return this.#template.module;
  }

  get source(): string {
    return this.#source;
  }

  get span(): SourceSpan {
    return this.#span;
  }
}
