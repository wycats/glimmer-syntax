import { assert } from '../utils/assert';
import { PresentStack } from '../utils/stack';

export class Tracer {
  static create() {
    return new Tracer(PresentStack.create(TraceNode.create('Parser', 'root')));
  }

  #stack: PresentStack<TraceNode>;

  constructor(stack: PresentStack<TraceNode>) {
    this.#stack = stack;
  }

  trace(name: string, state: string, args?: TraceArgs) {
    this.#stack.current.add(name, state, args);
  }

  begin(name: string, state: string, args?: TraceArgs) {
    this.#stack.push(this.#stack.current.child(name, state, args));
  }

  end(name: string) {
    const node = this.#stack.pop();

    assert(
      node.name === name,
      `Unbalanced begin and end in Trace. Expected node name to be ${name}, but it was ${node.name}`
    );
  }

  print(): string {
    let output = this.#stack.initial.print();

    if (this.#stack.length > 1) {
      const depth = '  '.repeat(this.#stack.length);
      output += `\n${depth}{execution paused here}`;
    }

    return output;
  }
}

export class TraceNode {
  static create(name: string, state: string, args?: TraceArgs): TraceNode {
    return new TraceNode(name, args, state, []);
  }

  #name: string;
  #args: TraceArgs | undefined;
  /** the current tokenizer state */
  #state: string;
  #children: TraceNode[];

  constructor(name: string, args: TraceArgs | undefined, state: string, children: TraceNode[]) {
    this.#name = name;
    this.#args = args;
    this.#state = state;
    this.#children = children;
  }

  get name() {
    return this.#name;
  }

  add(name: string, state: string, args: TraceArgs | undefined) {
    this.#children.push(TraceNode.create(name, state, args));
  }

  child(name: string, state: string, args: TraceArgs | undefined) {
    const child = TraceNode.create(name, state, args);
    this.#children.push(child);
    return child;
  }

  print(): string {
    return this.#print().join('\n');
  }

  #print(depth = 0): string[] {
    const indent = '  '.repeat(depth);
    const lines = [];

    lines.push(`${indent}${this.#title}`);

    for (const child of this.#children) {
      lines.push(...child.#print(depth + 1));
    }

    return lines;
  }

  get #title() {
    if (this.#args) {
      return `${this.#name}(${formatArgs(this.#args)}) @ ${this.#state}`;
    } else {
      return `${this.#name} @ ${this.#state}`;
    }
  }
}

type Primitive = string | number | boolean | null;
type NamedArgs = { [key: string]: Primitive };
type TupleArgs = Primitive[];
export type TraceArgs = Primitive | NamedArgs | TupleArgs;

function formatArgs(args: TraceArgs) {
  if (Array.isArray(args)) {
    return formatTupleArgs(args);
  } else if (typeof args === 'object' && args !== null) {
    return formatNamedArgs(args);
  } else {
    return formatPrimitive(args);
  }
}

function formatPrimitive(primitive: Primitive) {
  return String(primitive);
}

function formatNamedArgs(namedArgs: NamedArgs) {
  return Object.entries(namedArgs)
    .map(([key, value]) => `${key}: ${formatPrimitive(value)}`)
    .join(', ');
}

function formatTupleArgs(tupleArgs: TupleArgs) {
  return tupleArgs.map(formatPrimitive).join(', ');
}
