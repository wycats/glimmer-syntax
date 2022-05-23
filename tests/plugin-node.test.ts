import {
  existing,
  preprocess,
  Syntax,
  Walker,
  type AST,
  type ASTPluginBuilder,
  type ASTPluginEnvironment,
} from '@glimmer/syntax';
import { describe, expect, test } from 'vitest';
// import { existing } from '@glimmer/util';

describe('AST plugins', () => {
  test('function based AST plugins can be provided to the compiler', () => {
    expect.assertions(1);

    preprocess('<div></div>', {
      plugins: {
        ast: [
          () => ({
            name: 'plugin-a',
            visitor: {
              Program() {
                expect(true).toBe(true);
              },
            },
          }),
        ],
      },
    });
  });

  test('plugins are provided the syntax package', (assert) => {
    expect.assertions(1);

    preprocess('<div></div>', {
      plugins: {
        ast: [
          ({ syntax }) => {
            expect(syntax.Walker).toBe(Walker);

            return { name: 'plugin-a', visitor: {} };
          },
        ],
      },
    });
  });

  test('can support the legacy AST transform API via ASTPlugin', (assert) => {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    function ensurePlugin(FunctionOrPlugin: any): ASTPluginBuilder {
      if (FunctionOrPlugin.prototype && FunctionOrPlugin.prototype.transform) {
        return (env: ASTPluginEnvironment) => {
          return {
            name: 'plugin-a',

            visitor: {
              Program(node: AST.Program) {
                let plugin = new FunctionOrPlugin(env);

                plugin.syntax = env.syntax;

                return plugin.transform(node);
              },
            },
          };
        };
      } else {
        return FunctionOrPlugin;
      }
    }

    class Plugin {
      syntax!: Syntax;

      transform(program: AST.Program): AST.Program {
        expect(true).toBe(true);
        return program;
      }
    }

    preprocess('<div></div>', {
      plugins: {
        ast: [ensurePlugin(Plugin)],
      },
    });
  });

  const FIRST_PLUGIN = new WeakMap<AST.Program | AST.Block | AST.Template, boolean>();
  const SECOND_PLUGIN = new WeakMap<AST.Program | AST.Block | AST.Template, boolean>();
  const THIRD_PLUGIN = new WeakMap<AST.Program | AST.Block | AST.Template, boolean>();

  test('AST plugins can be chained', (assert) => {
    expect.assertions(3);

    let first = () => {
      return {
        name: 'first',
        visitor: {
          Program(program: AST.Program | AST.Template | AST.Block) {
            FIRST_PLUGIN.set(program, true);
          },
        },
      };
    };

    let second = () => {
      return {
        name: 'second',
        visitor: {
          Program(node: AST.Program | AST.Block | AST.Template) {
            expect(FIRST_PLUGIN.get(node), 'AST from first plugin is passed to second').toBe(true);

            SECOND_PLUGIN.set(node, true);
          },
        },
      };
    };

    let third = () => {
      return {
        name: 'third',
        visitor: {
          Program(node: AST.Program | AST.Block | AST.Template) {
            expect(SECOND_PLUGIN.get(node), 'AST from second plugin is passed to third').toBe(true);

            THIRD_PLUGIN.set(node, true);
          },
        },
      };
    };

    let ast = preprocess('<div></div>', {
      plugins: {
        ast: [first, second, third],
      },
    });

    expect(THIRD_PLUGIN.get(ast), 'return value from last AST transform is used').toBe(true);
  });

  test('AST plugins can access meta from environment', (assert) => {
    assert.expect(1);

    let hasExposedEnvMeta = (env: ASTPluginEnvironment) => {
      return {
        name: 'exposedMetaTemplateData',
        visitor: {
          Program() {
            const { meta } = env;
            const { moduleName } = existing(
              meta as { moduleName: 'string' },
              'expected meta to not be null'
            );
            expect(moduleName, 'module was passed in the meta enviornment property').toBe(
              'template/module/name'
            );
          },
        },
      };
    };

    preprocess('<div></div>', {
      meta: {
        moduleName: 'template/module/name',
      },
      plugins: {
        ast: [hasExposedEnvMeta],
      },
    });
  });
});
