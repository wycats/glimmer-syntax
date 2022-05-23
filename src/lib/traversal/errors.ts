import type { Optional } from '../utils/exists.js';
import type * as ASTv1 from '../v1/api';

export default class TraversalError extends Error {
  constructor(
    message: string,
    readonly node: ASTv1.Node,
    readonly parent: Optional<ASTv1.Node>,
    readonly key: string
  ) {
    super(message);
  }
}

export function cannotRemoveNode(
  node: ASTv1.Node,
  parent: ASTv1.Node,
  key: string
): TraversalError {
  debugger;
  return new TraversalError(
    'Cannot remove a node unless it is part of an array',
    node,
    parent,
    key
  );
}

export function cannotReplaceNode(
  node: ASTv1.Node,
  parent: ASTv1.Node,
  key: string
): TraversalError {
  return new TraversalError(
    'Cannot replace a node with multiple nodes unless it is part of an array',
    node,
    parent,
    key
  );
}

export function cannotReplaceOrRemoveInKeyHandlerYet(
  node: ASTv1.Node,
  key: string
): TraversalError {
  return new TraversalError(
    'Replacing and removing in key handlers is not yet supported.',
    node,
    null,
    key
  );
}
