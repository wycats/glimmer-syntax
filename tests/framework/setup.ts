import { GlimmerSyntaxError } from '@glimmer/syntax';
import { expect } from 'vitest';

expect.extend({
  toThrowSyntaxError(received: () => void, error: GlimmerSyntaxError) {
    try {
      received();

      return {
        pass: false,
        message: () =>
          `Expected function to throw a GlimmerSyntaxError, but it didn't throw any error`,
      };
    } catch (e) {
      const actualError = e;

      if (isObject(actualError)) {
        if (actualError instanceof GlimmerSyntaxError) {
          const actual = { span: actualError.location.describe, message: actualError.message };
          const expected = { span: error.location.describe, message: error.message };

          if (this.equals(actual, expected)) {
            return {
              message: () =>
                `expected a syntax error with message "${error.message}" at ${error.location.describe}`,
              pass: true,
            };
          } else {
            return {
              message: () =>
                `expected a syntax error with message "${error.message}" at ${error.location.describe}`,
              pass: false,
              expected,
              actual,
            };
          }
        } else {
          return {
            message: () =>
              `expected a GlimmerSyntaxError, but got ${actualError.constructor.name}${
                typeof actualError['message'] === 'string'
                  ? `with message: ${actualError.message}`
                  : ''
              }`,
            pass: false,
            expected: error,
            actual: actualError,
          };
        }
      } else {
        return {
          message: () =>
            `expected callback to throw an object, but it threw ${String(actualError)}`,
          pass: false,
        };
      }
    }
  },
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
