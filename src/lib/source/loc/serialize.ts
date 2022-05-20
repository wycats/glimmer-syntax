import type { SourceLocation, SourcePosition } from '../../v1/handlebars-ast';
import type { SourceTemplate } from '../source';

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

export function deserializeLocation(
  template: SourceTemplate,
  location: SerializedLocation
): SourceLocation {
  const [start, end] = location.split('-');
  const [startLine, startColumn] = start.split(':');
  const [endLine, endColumn] = end.split(':');

  return {
    source: template.module,
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
