import { isKeyword } from './keywords';
import { template } from './parser/preprocess.js';
import traverse from './traversal/traverse';
import type * as ASTv1 from './v1/api';

interface GetTemplateLocalsOptions {
  includeKeywords?: boolean;
  includeHtmlElements?: boolean;
}

/**
 * Gets the correct Token from the Node based on it's type
 */
function tokensFromType(
  node: ASTv1.Node,
  scopedTokens: string[],
  options: GetTemplateLocalsOptions
): string | void {
  if (node.type === 'PathExpression') {
    if (node.head.type === 'AtHead' || node.head.type === 'ThisHead') {
      return;
    }

    const possbleToken = node.head.name;

    if (scopedTokens.indexOf(possbleToken) === -1) {
      return possbleToken;
    }
  } else if (node.type === 'ElementNode') {
    const { tag } = node;

    const char = tag.charAt(0);

    if (char === ':' || char === '@') {
      return;
    }

    if (!options.includeHtmlElements && tag.indexOf('.') === -1 && tag.toLowerCase() === tag) {
      return;
    }

    if (tag.substr(0, 5) === 'this.') {
      return;
    }

    if (scopedTokens.indexOf(tag) !== -1) {
      return;
    }

    return tag;
  }
}

/**
 * Adds tokens to the tokensSet based on their node.type
 */
function addTokens(
  tokensSet: Set<string>,
  node: ASTv1.Node,
  scopedTokens: string[],
  options: GetTemplateLocalsOptions
) {
  const maybeTokens = tokensFromType(node, scopedTokens, options);

  (Array.isArray(maybeTokens) ? maybeTokens : [maybeTokens]).forEach((maybeToken) => {
    if (maybeToken !== undefined && maybeToken[0] !== '@') {
      tokensSet.add(maybeToken.split('.')[0]);
    }
  });
}

export function getEmbedderLocals(ast: ASTv1.Template): string[] {
  const upvars: string[] = [];

  traverse(ast, {
    PathExpression(node) {
      if (node.head.type === 'VarHead' && node.head.declared === 'embedder') {
        if (!upvars.includes(node.head.name)) {
          upvars.push(node.head.name);
        }
      }
    },
  });

  return upvars;
}

/**
 * Parses and traverses a given handlebars html template to extract all template locals
 * referenced that could possible come from the praent scope. Can exclude known keywords
 * optionally.
 */
export function getTemplateLocals(
  html: string,
  options: GetTemplateLocalsOptions = {
    includeHtmlElements: false,
    includeKeywords: false,
  }
): string[] {
  // this API doesn't expose any AST nodes, so the name of the module doesn't matter
  const ast = template(html, 'getTemplateLocals').preprocess();
  const tokensSet = new Set<string>();
  const scopedTokens: string[] = [];

  traverse(ast, {
    Block: {
      enter({ blockParams }) {
        blockParams.forEach((param) => {
          scopedTokens.push(param);
        });
      },

      exit({ blockParams }) {
        blockParams.forEach(() => {
          scopedTokens.pop();
        });
      },
    },

    ElementNode: {
      enter(node) {
        node.blockParams.forEach((param) => {
          scopedTokens.push(param);
        });
        addTokens(tokensSet, node, scopedTokens, options);
      },

      exit({ blockParams }) {
        blockParams.forEach(() => {
          scopedTokens.pop();
        });
      },
    },

    PathExpression(node) {
      addTokens(tokensSet, node, scopedTokens, options);
    },
  });

  let tokens: string[] = [];

  tokensSet.forEach((s) => tokens.push(s));

  if (!options?.includeKeywords) {
    tokens = tokens.filter((token) => !isKeyword(token));
  }

  return tokens;
}
