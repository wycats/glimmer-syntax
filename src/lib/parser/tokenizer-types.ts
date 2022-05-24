import { assert } from 'console';
import type { TokenizerDelegate } from 'simple-html-tokenizer';

import { existing } from '../utils/exists';

export type TokenizerState =
  | 'beforeData'
  | 'data'
  | 'rcdata'
  | 'rawtext'
  | 'scriptData'
  | 'plaintext'
  | 'tagOpen'
  | 'endTagOpen'
  | 'tagName'
  | 'endTagName'
  | 'rcdataLessThanSign'
  | 'rcdataEndTagOpen'
  | 'rcdataEndTagName'
  | 'rawtextLessThanSign'
  | 'rawtextEndTagOpen'
  | 'rawtextEndTagName'
  | 'scriptDataLessThanSign'
  | 'scriptDataEndTagOpen'
  | 'scriptDataEndTagName'
  | 'scriptDataEscapeStart'
  | 'scriptDataEscapseStartDash'
  | 'scriptDataEscaped'
  | 'scriptDataEscapedDash'
  | 'scriptDataEscapedDashDash'
  | 'scriptDataEscapedLessThanSign'
  | 'scriptDataEscapedEndTagOpen'
  | 'scriptDataEscapedEndTagName'
  | 'scriptDataDoubleEscapeStart'
  | 'scriptDataDoubleEscaped'
  | 'scriptDataDoubleEscapedDash'
  | 'scriptDataDoubleEscapedDashDash'
  | 'scriptDataDoubleEscapedLessThanSign'
  | 'scriptDataDoubleEscapeEnd'
  | 'beforeAttributeName'
  | 'attributeName'
  | 'afterAttributeName'
  | 'beforeAttributeValue'
  | 'attributeValueDoubleQuoted'
  | 'attributeValueSingleQuoted'
  | 'attributeValueUnquoted'
  | 'afterAttributeValueQuoted'
  | 'selfClosingStartTag'
  | 'bogusComment'
  | 'markupDeclarationOpen'
  | 'commentStart'
  | 'commentStartDash'
  | 'comment'
  | 'commentLessThanSign'
  | 'commentLessThanSignBang'
  | 'commentLessThanSignBangDash'
  | 'commentLessThanSignBangDashDash'
  | 'commentEndDash'
  | 'commentEnd'
  | 'commentEndBang'
  | 'doctype'
  | 'beforeDoctypeName'
  | 'doctypeName'
  | 'afterDoctypeName'
  | 'afterDoctypePublicKeyword'
  | 'beforeDoctypePublicIdentifier'
  | 'doctypePublicIdentifierDoubleQuoted'
  | 'doctypePublicIdentifierSingleQuoted'
  | 'afterDoctypePublicIdentifier'
  | 'betweenDoctypePublicAndSystemIdentifiers'
  | 'afterDoctypeSystemKeyword'
  | 'beforeDoctypeSystemIdentifier'
  | 'doctypeSystemIdentifierDoubleQuoted'
  | 'doctypeSystemIdentifierSingleQuoted'
  | 'afterDoctypeSystemIdentifier'
  | 'bogusDoctype'
  | 'cdataSection'
  | 'cdataSectionBracket'
  | 'cdataSectionEnd'
  | 'characterReference'
  | 'numericCharacterReference'
  | 'hexadecimalCharacterReferenceStart'
  | 'decimalCharacterReferenceStart'
  | 'hexadecimalCharacterReference'
  | 'decimalCharacterReference'
  | 'numericCharacterReferenceEnd'
  | 'characterReferenceEnd';

const SIMPLIFY_TOKENIZER_STATE = {
  beforeData: 'top-level',
  data: 'text',
  tagOpen: 'tag-name:start:before',
  endTagOpen: 'tag-name:end:before',
  tagName: 'tag-name:start:in',
  endTagName: 'tag-name:end:in',
  comment: 'comment',
  commentStart: 'comment',
  commentStartDash: 'comment',
  commentEndDash: 'comment',
  commentEnd: 'comment',
  beforeAttributeName: 'tag:top-level',
  afterAttributeValueQuoted: 'tag:top-level',
  attributeName: 'attribute:name:in',
  afterAttributeName: 'attribute:name:after',
  beforeAttributeValue: 'attribute:value:before',
  attributeValueDoubleQuoted: 'attribute:value:double-quoted',
  attributeValueSingleQuoted: 'attribute:value:single-quoted',
  attributeValueUnquoted: 'attribute:value:unquoted',
  selfClosingStartTag: 'tag:start:self-closing',
  doctype: 'doctype',
  doctypeName: 'doctype:name',
  afterDoctypeName: 'doctype:top-level',
  doctypePublicIdentifierDoubleQuoted: 'doctype:public-id',
  doctypePublicIdentifierSingleQuoted: 'doctype:public-id',
  afterDoctypePublicIdentifier: 'doctype:top-level',
  doctypeSystemIdentifierDoubleQuoted: 'doctype:system-id',
  doctypeSystemIdentifierSingleQuoted: 'doctype:system-id',
  afterDocTypeSystemIdentifier: 'doctype:top-level',
  betweenDoctypePublicAndSystemIdentifiers: 'doctype:top-level',
} as const;

export type SimplifiedTokenizerState =
  typeof SIMPLIFY_TOKENIZER_STATE[keyof typeof SIMPLIFY_TOKENIZER_STATE];

export function asSimpleState(state: TokenizerState, event?: EventName): SimplifiedTokenizerState {
  return existing(
    (SIMPLIFY_TOKENIZER_STATE as { [P in TokenizerState]?: string })[state],
    `Unexpected tokenizer state: ${state}${event ? `(in ${event})` : ''}`
  ) as SimplifiedTokenizerState;
}

const ATTR_VALUE = [
  'attribute:value:double-quoted',
  'attribute:value:single-quoted',
  'attribute:value:unquoted',
] as const;

export function validate(event: EventName, state: TokenizerState) {
  assert(state in SIMPLIFY_TOKENIZER_STATE, `Unexpected Simple HTML Tokenizer state: ${state}`);
  const simplified = asSimpleState(state, event);
  const valid = VALID_STATES_FOR_EVENTS[event];

  assert(
    valid.includes(simplified),
    `Unexpected Simple HTML Tokenizer state: ${state} (for event: ${event})`
  );
}

export type EventName = keyof TokenizerDelegate;
type ValidEventStates = { [P in EventName]: SimplifiedTokenizerState[] };

export const VALID_STATES_FOR_EVENTS: ValidEventStates = {
  reset: [],
  finishData: ['text'],
  tagOpen: ['tag-name:start:before'],
  beginData: ['text'],
  appendToData: ['text'],
  beginStartTag: ['tag-name:start:in'],
  appendToTagName: ['tag-name:start:in', 'tag-name:end:in'],
  beginAttribute: ['attribute:name:in'],
  appendToAttributeName: ['attribute:name:in'],
  beginAttributeValue: [
    'attribute:name:in',
    'attribute:name:after',
    'attribute:value:before',
    ...ATTR_VALUE,
  ],
  finishAttributeValue: [
    'attribute:name:in',
    'attribute:name:after',
    'attribute:value:before',
    ...ATTR_VALUE,
  ],
  appendToAttributeValue: [...ATTR_VALUE],
  markTagAsSelfClosing: ['tag:start:self-closing'],
  beginEndTag: ['tag-name:end:in'],
  finishTag: [
    'tag-name:start:in',
    'tag-name:end:in',
    'tag:top-level',
    'attribute:name:in',
    'attribute:name:after',
    'attribute:value:before',
    'attribute:value:unquoted',
    'tag:start:self-closing',
  ],
  beginComment: ['comment'],
  appendToCommentData: ['comment'],
  finishComment: ['comment'],
  reportSyntaxError: [],

  beginDoctype: ['doctype'],
  appendToDoctypeName: ['doctype:name'],
  appendToDoctypePublicIdentifier: ['doctype:public-id'],
  appendToDoctypeSystemIdentifier: ['doctype:system-id'],
  endDoctype: ['doctype:name', 'doctype:top-level', 'doctype:public-id', 'doctype:system-id'],
};
