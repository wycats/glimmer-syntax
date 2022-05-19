interface CustomMatchers<R = unknown> {
  toThrowSyntaxError(error: GlimmerSyntaxError): R;
}

declare global {
  namespace Vi {
    type Assertion = CustomMatchers;
    type AssymmetricMatcher = CustomMatchers;
  }
}

export {};
