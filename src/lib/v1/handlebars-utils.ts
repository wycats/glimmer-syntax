import type { SourceSpan } from '../source/loc/source-span';
import type * as ASTv1 from './api';
import type * as HBS from './handlebars-ast';

export function ErrorStatement(message: string, loc: SourceSpan): HBS.ErrorStatement {
  return {
    type: 'MustacheCommentStatement',
    error: true,
    value: `<<ERROR: ${message}>>`,
    loc,
  };
}

export function ErrorExpression(message: string, loc: SourceSpan): HBS.ErrorExpression {
  return {
    type: 'StringLiteral',
    error: true,
    value: `<<ERROR: ${message}>>`,
    original: JSON.stringify(message),
    loc,
  };
}

export function isErrorNode<N extends ASTv1.Statement | ASTv1.Expression>(
  node: N & Partial<{ error: true }>
): node is N & { error: true } {
  return node.error === true;
}
