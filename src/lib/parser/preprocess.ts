import { SourceTemplate } from '../source/source';
import type { Optional } from '../utils/exists.js';
import type * as ASTv1 from '../v1/api';
import type * as HBS from '../v1/handlebars-ast';
import type { ASTPluginBuilder } from './plugins';

interface HandlebarsParseOptions {
  srcName?: string;
  ignoreStandalone?: boolean;
}

export type EmbedderLocals = (name: string) => boolean;

export interface TemplateIdFn {
  (src: string): Optional<string>;
}

export interface PrecompileOptions extends PreprocessOptions {
  id?: TemplateIdFn;
  customizeComponentName?(input: string): string;
}

export function optionsWithDefaultModule<P extends PreprocessOptions>(
  options: P,
  module: string
): P & { meta: { moduleName: string } } {
  if (options?.meta?.moduleName) {
    return options as P & { meta: { moduleName: string } };
  } else {
    return {
      ...options,
      meta: {
        ...options?.meta,
        moduleName: module,
      },
    };
  }
}

export interface PreprocessOptions {
  strictMode?: boolean;
  locals?: EmbedderLocals | string[];
  meta?: {
    moduleName?: string;
  };
  plugins?: {
    ast?: ASTPluginBuilder[];
  };
  parseOptions?: HandlebarsParseOptions;
  throwErrors?: boolean;
  customizeComponentName?: (input: string) => string;

  /**
    Useful for specifying a group of options together.

    When `'codemod'` we disable all whitespace control in handlebars
    (to preserve as much as possible) and we also avoid any
    escaping/unescaping of HTML entity codes.
   */
  mode?: 'codemod' | 'precompile';
}

export function template(
  source: PreprocessInput,
  module: string,
  options: PreprocessOptions = {}
): SourceTemplate {
  return template.normalized(source, options && normalize(module, options));
}

template.normalized = (
  source: PreprocessInput,
  options: NormalizedPreprocessOptions
): SourceTemplate => {
  if (source instanceof SourceTemplate) {
    if (options) {
      // If we got a Source as well as new options, create a new source with
      // the original input string and the new options.
      return new SourceTemplate(source.source, null, options);
    } else {
      // Otherwise, just return the original source.
      return source;
    }
  } else if (typeof source === 'string') {
    return new SourceTemplate(source, null, options);
  } else {
    return new SourceTemplate(null, source, options);
  }
};

template.sub = (
  parent: SourceTemplate,
  input: PreprocessInput,
  options: NormalizedPreprocessOptions = parent.options
): SourceTemplate => {
  return template.normalized(input, options);
};

export function normalize(
  module: string,
  options?: PreprocessOptions
): NormalizedPreprocessOptions {
  return NormalizedPreprocessOptions.from(options, module);
}

export function nonexistent(module: string) {
  return template('', module, {});
}

function normalizeLocals(locals: EmbedderLocals | string[] | undefined): (name: string) => boolean {
  if (typeof locals === 'function') {
    return locals;
  } else if (locals) {
    return (name: string) => locals.includes(name);
  } else {
    return () => false;
  }
}

export interface ModuleName {
  name: string;
  synthesized: boolean;
}

export interface NormalizedPreprocessFields {
  readonly module: ModuleName;
  readonly meta: object;
  readonly mode: {
    readonly strictness: 'strict' | 'loose';
    readonly purpose: 'codemod' | 'precompile';
    readonly errors: 'report' | 'throw';
  };
  readonly embedder: {
    readonly hasBinding: (name: string) => boolean;
  };
  readonly plugins: {
    ast: ASTPluginBuilder[];
  };
  readonly customize: {
    readonly componentName: (input: string) => string;
  };
  readonly handlebars: HandlebarsParseOptions;
}

function defaultOptions(module: ModuleName): NormalizedPreprocessFields {
  return {
    module,
    meta: {},
    mode: {
      strictness: 'loose',
      purpose: 'precompile',
      errors: 'throw',
    },
    embedder: {
      hasBinding: () => false,
    },
    plugins: {
      ast: [],
    },
    customize: {
      componentName: (input: string) => input,
    },
    handlebars: {},
  };
}

export class NormalizedPreprocessOptions implements NormalizedPreprocessFields {
  static from(options: PreprocessOptions | undefined, module: string): NormalizedPreprocessOptions {
    return NormalizedPreprocessOptions.create(
      options,
      options?.meta?.moduleName
        ? ({
            name: options?.meta?.moduleName,
            synthesized: false,
          } as ModuleName)
        : ({ name: module, synthesized: true } as ModuleName)
    );
  }

  static create(
    options: PreprocessOptions | undefined,
    module: ModuleName
  ): NormalizedPreprocessOptions {
    return new NormalizedPreprocessOptions({
      meta: options?.meta ?? {},
      module,
      mode: {
        strictness: options?.strictMode ? 'strict' : 'loose',
        purpose: options?.mode ?? 'precompile',
        errors: options === undefined || options.throwErrors ? 'throw' : 'report',
      },
      embedder: {
        hasBinding: normalizeLocals(options?.locals),
      },
      plugins: {
        ast: options?.plugins?.ast ?? [],
      },
      customize: {
        componentName(name: string) {
          const customize = options?.customizeComponentName;
          return customize ? customize(name) : name;
        },
      },
      handlebars: options?.parseOptions ?? {},
    });
  }

  static fromFields(
    fields: Partial<NormalizedPreprocessFields>,
    module: ModuleName
  ): NormalizedPreprocessOptions {
    return new NormalizedPreprocessOptions({
      ...defaultOptions(module),
      ...fields,
    });
  }

  static default(module: ModuleName): NormalizedPreprocessOptions {
    return NormalizedPreprocessOptions.create(undefined, module);
  }

  readonly module: ModuleName;
  /** The metadata supplied by the user. */
  readonly meta: object;
  readonly mode: NormalizedPreprocessFields['mode'];
  readonly embedder: {
    readonly hasBinding: (name: string) => boolean;
  };
  readonly plugins: {
    readonly ast: ASTPluginBuilder[];
  };
  readonly customize: {
    readonly componentName: (name: string) => string;
  };
  readonly handlebars: HandlebarsParseOptions;

  constructor(fields: NormalizedPreprocessFields) {
    this.module = fields.module;
    this.meta = fields.meta;
    this.mode = fields.mode;
    this.embedder = fields.embedder;
    this.plugins = fields.plugins;
    this.customize = fields.customize;
    this.handlebars = fields.handlebars;
  }

  withModule(name: string): NormalizedPreprocessOptions {
    return new NormalizedPreprocessOptions({
      ...this,
      module: name,
      meta: { ...this.meta, moduleName: name },
    });
  }
}

export type PreprocessInput = string | SourceTemplate | HBS.Program;

type PreprocessFunction = (input: PreprocessInput, options?: PreprocessOptions) => ASTv1.Template;
type NormalizedPreprocessFunction = (
  input: PreprocessInput,
  options: NormalizedPreprocessOptions
) => ASTv1.Template;

export interface Preprocess extends PreprocessFunction {
  normalized: NormalizedPreprocessFunction;
}

export function Preprocess({
  preprocess,
  normalized,
}: {
  preprocess: PreprocessFunction & Partial<Preprocess>;
  normalized: NormalizedPreprocessFunction;
}): Preprocess {
  preprocess.normalized = normalized;
  return preprocess as Preprocess;
}

export const preprocess = Preprocess({
  preprocess: (input: PreprocessInput, options?: PreprocessOptions) => {
    return template(input, options?.meta?.moduleName ?? `an unknown module`, options).preprocess();
  },
  normalized: (
    input: PreprocessInput,
    options: NormalizedPreprocessOptions | NormalizedPreprocessFields
  ) => {
    const normalized =
      options instanceof NormalizedPreprocessOptions
        ? options
        : NormalizedPreprocessOptions.fromFields(options, options.module);
    return template.normalized(input, normalized).preprocess();
  },
});
