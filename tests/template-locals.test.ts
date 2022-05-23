import { getTemplateLocals } from '@glimmer/syntax';
import { describe, expect, test } from 'vitest';

describe('getTemplateLocals', () => {
  test('it works', function () {
    let locals = getTemplateLocals(`
      <Component/>
  
      <ComponentWithYield>
        <:main></:main>
      </ComponentWithYield>
  
      {{#if globalValue}}
        {{globalHelper 123}}
      {{/if}}
  
      {{#if this.localValue}}
        {{this.localHelper 123}}
      {{/if}}
  
      {{global-value}}
  
      {{component this.myComponent}}
  
      {{some.value.with.path}}
      <someOther.value.with.path />
  
      {{@arg}}
      <@argComponent />
  
      {{#this.dynamicBlockComponent}}
      {{/this.dynamicBlockComponent}}
  
      <button></button>
  
      <this.dynamicAngleComponent>
      </this.dynamicAngleComponent>
    `);

    expect(locals).toEqual([
      'Component',
      'ComponentWithYield',
      'globalValue',
      'globalHelper',
      'global-value',
      'some',
      'someOther',
    ]);
  });

  test('it does not include locals', function () {
    let locals = getTemplateLocals(
      `
        <SomeComponent as |button|>
          <button></button>
          {{button}}
        </SomeComponent>
      `,
      {
        includeHtmlElements: true,
      }
    );

    expect(locals).toEqual(['SomeComponent']);
  });

  test('it can include keywords', function () {
    let locals = getTemplateLocals(
      `
        <Component/>
  
        <ComponentWithYield>
          <:main></:main>
        </ComponentWithYield>
  
        {{#if globalValue}}
          {{globalHelper 123}}
        {{/if}}
  
        {{#if this.localValue}}
          {{this.localHelper 123}}
        {{/if}}
  
        {{global-value}}
  
        {{component this.myComponent}}
  
        {{some.value.with.path}}
        <someOther.value.with.path />
  
        {{@arg}}
        <@argComponent />
  
        {{#this.dynamicBlockComponent}}
        {{/this.dynamicBlockComponent}}
  
        <this.dynamicAngleComponent>
        </this.dynamicAngleComponent>
      `,
      {
        includeKeywords: true,
      }
    );

    expect(locals).toEqual([
      'Component',
      'ComponentWithYield',
      'if',
      'globalValue',
      'globalHelper',
      'global-value',
      'component',
      'some',
      'someOther',
    ]);
  });

  test('it can include html elements', function () {
    let locals = getTemplateLocals(
      `
        <button></button>
      `,
      {
        includeHtmlElements: true,
      }
    );

    expect(locals).toEqual(['button']);
  });
});
