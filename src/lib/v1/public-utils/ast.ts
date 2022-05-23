import type * as ASTv1 from '../api';

const NONE = Symbol('NONE');
type NONE = typeof NONE;

export class Maybe<T> {
  static none<T>(): Maybe<T> {
    return new Maybe<T>(NONE);
  }

  static some<T>(value: T): Maybe<T> {
    return new Maybe<T>(value);
  }

  static isSome<T>(maybe: Maybe<T>): maybe is Maybe<T> & { value: T } {
    return maybe.value !== NONE;
  }

  static isNone<T>(maybe: Maybe<T>): maybe is Maybe<T> & { value: NONE } {
    return maybe.value === NONE;
  }

  constructor(readonly value: T | NONE) {}

  isSome(): this is Maybe<T> & { value: T } {
    return Maybe.isSome(this);
  }

  isNone(): this is Maybe<T> & { value: NONE } {
    return Maybe.isNone(this);
  }

  map<U>(fn: (value: T) => U): Maybe<U> {
    if (this.value === NONE) {
      return Maybe.none();
    }
    return Maybe.some(fn(this.value));
  }

  chain<U>(fn: (value: T) => Maybe<U>): Maybe<U> {
    if (Maybe.isSome(this)) {
      return fn(this.value);
    } else {
      return Maybe.none();
    }
  }

  or(other: Maybe<T>): Maybe<T> {
    if (Maybe.isNone(this)) {
      return this;
    }
    return other;
  }

  orElse(fn: () => T): T {
    if (this.value !== NONE) {
      return this.value;
    }
    return fn();
  }
}

export abstract class NodeUtils<N extends ASTv1.Node> {
  #node: N;

  constructor(node: N) {
    this.#node = node;
  }

  get node(): N {
    return this.#node;
  }

  asType<K extends keyof ASTv1.Nodes>(type: K): Maybe<UtilTypeFor<K>> {
    if (this.node.type === type) {
      return Maybe.some(Utils(this.node) as UtilTypeFor<K>);
    } else {
      return Maybe.none();
    }
  }

  asPath(): Maybe<PathNodeUtils> {
    return this.asType('PathExpression');
  }

  asVar(named?: string): Maybe<VarNodeUtils> {
    return this.asPath().chain((path) => path.asVar(named));
  }

  isVar(named?: string): boolean {
    return this.asVar(named).isSome();
  }
}

export class NodeUtilsImpl extends NodeUtils<ASTv1.Node> {}

export class ExpressionUtils extends NodeUtils<ASTv1.Expression> {
  asVar(named?: string) {
    return this.asPath().chain((path) => path.asVar(named));
  }

  isVar(named?: string) {
    return this.asVar(named).isSome();
  }
}

type VarNodeUtils = PathNodeUtils & { node: { head: ASTv1.VarHead } };

export class PathNodeUtils extends NodeUtils<ASTv1.PathExpression> {
  asVar(named?: string): Maybe<VarNodeUtils> {
    if (this.isVar(named)) {
      return Maybe.some(this);
    } else {
      return Maybe.none();
    }
  }

  /**
   * Is this path a simple identifier with no members?
   *
   * This excludes:
   *
   * - paths containing dots (`person.name`)
   * - argument references (`@person`)
   * - `this`
   */
  isVar(named?: string): this is VarNodeUtils {
    const { head, tail } = this.node;

    if (tail.length !== 0) {
      return false;
    }

    if (head.type !== 'VarHead') {
      return false;
    }

    if (named) {
      return head.name === named;
    } else {
      return true;
    }
  }
}

interface UtilTypes {
  PathExpression: PathNodeUtils;
  SubExpression: ExpressionUtils;
  StringLiteral: ExpressionUtils;
  BooleanLiteral: ExpressionUtils;
  NumberLiteral: ExpressionUtils;
  UndefinedLiteral: ExpressionUtils;
  NullLiteral: ExpressionUtils;
}

type UtilTypeFor<K extends keyof ASTv1.Nodes> = K extends keyof UtilTypes
  ? UtilTypes[K]
  : NodeUtils<ASTv1.Node>;

export function Utils<N extends ASTv1.Node>(node: N): UtilTypeFor<N['type']>;
export function Utils(node: ASTv1.Node): NodeUtils<ASTv1.Node> {
  if (node.type === 'PathExpression') {
    return new PathNodeUtils(node);
  } else {
    return new NodeUtilsImpl(node);
  }
}

Utils.path = (node: ASTv1.Node): PathNodeUtils | null => {
  if (node.type === 'PathExpression') {
    return new PathNodeUtils(node);
  } else {
    return null;
  }
};
