import type { GlimmerSyntaxError } from '../syntax-error';
import type * as ASTv1 from './api';
import type * as HBS from './handlebars-ast';

export function ErrorStatement(
  error: GlimmerSyntaxError,
  message = error.message
): HBS.ErrorStatement {
  return {
    type: 'MustacheCommentStatement',
    error,
    value: `<<ERROR: ${message}>>`,
    loc: error.location,
  };
}

export function ToErrorStatement(error: HBS.ErrorExpression): HBS.ErrorStatement {
  return {
    type: 'MustacheCommentStatement',
    error: error.error,
    value: error.value,
    loc: error.loc,
  };
}

export function ErrorExpression(error: GlimmerSyntaxError, message = error.message): HBS.ErrorExpression {
  return {
    type: 'StringLiteral',
    error,
    value: `<<ERROR: ${message}>>`,
    original: JSON.stringify(message),
    loc: error.location,
  };
}

export function isErrorNode<N extends ASTv1.Statement | ASTv1.Expression>(
  node: N & Partial<{ error: true }>
): node is N & { error: true } {
  return node.error === true;
}
