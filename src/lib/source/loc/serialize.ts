import type { SourceLocation, SourcePosition } from '../../v1/handlebars-ast';
import type { SourceSpan } from './source-span';

export type SerializedConcreteSourceSpan =
  | /** collapsed */ number
  | /** normal */ [start: number, size: number]
  | /** synthetic */ string;

export type SerializedSourceSpan = SerializedConcreteSourceSpan | ['broken', SerializedLocation];

export type SerializedLocation<L extends SourceLocation = SourceLocation> =
  `${L['start']['line']}:${L['start']['column']}-${L['end']['line']}:${L['end']['column']}`;

export function serializeBroken({
  start,
  end,
}: {
  start: SourcePosition;
  end: SourcePosition;
}): SerializedSourceSpan {
  return ['broken', `${start.line}:${start.column}-${end.line}:${end.column}`];
}

export function serializeOffsets(
  offsets: { start: number; end: number } | string
): SerializedSourceSpan {
  if (typeof offsets === 'string') {
    return offsets;
  } else if (offsets.start === offsets.end) {
    return offsets.start;
  } else {
    return [offsets.start, offsets.end];
  }
}

export function parse(
  serialized: SerializedSourceSpan,
  create: (
    offsets:
      | { type: 'synthetic'; chars: string }
      | { type: 'valid'; start: number; end: number }
      | { type: 'broken'; start: SourcePosition; end: SourcePosition }
  ) => SourceSpan
): SourceSpan {
  if (typeof serialized === 'number') {
    return create({ type: 'valid', start: serialized, end: serialized });
  } else if (typeof serialized === 'string') {
    return create({ type: 'synthetic', chars: serialized });
  } else if (serialized[0] === 'broken') {
    return create({ type: 'broken', ...parsePositions(serialized[1]) });
  } else {
    let [start, size] = serialized;
    return create({
      type: 'valid',
      start,
      end: start + size,
    });
  }
}

export function parsePositions(location: SerializedLocation): {
  start: SourcePosition;
  end: SourcePosition;
} {
  const [start, end] = location.split('-');
  const [startLine, startColumn] = start.split(':');
  const [endLine, endColumn] = end.split(':');

  return {
    start: {
      line: Number(startLine),
      column: Number(startColumn),
    },
    end: {
      line: Number(endLine),
      column: Number(endColumn),
    },
  };
}
