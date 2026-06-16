// Shared form-control helpers for the /settings (brand & customer brain) editors. Pure factory
// functions (no hooks) returning labelled, accessible controls so the three editors stay
// consistent and DRY. Authored with React.createElement so the editors render under the
// dependency-free `node --test` a11y harness.

import { createElement } from 'react';
import type { ReactElement } from 'react';

/** Split a textarea value into trimmed, non-empty lines (one list item per line). */
export function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Join a string list back into a one-per-line textarea value. */
export function joinLines(items: readonly string[]): string {
  return items.join('\n');
}

interface FieldOpts {
  readonly placeholder?: string;
  readonly required?: boolean;
}

/** A labelled single-line text input (label associated via htmlFor/id). */
export function labeledInput(
  id: string,
  label: string,
  value: string,
  onChange: (value: string) => void,
  opts: FieldOpts = {},
): ReactElement {
  return createElement(
    'p',
    null,
    createElement('label', { htmlFor: id }, label),
    createElement('input', {
      id,
      name: id,
      type: 'text',
      value,
      placeholder: opts.placeholder,
      required: opts.required,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    }),
  );
}

/** A labelled multi-line textarea. */
export function labeledTextarea(
  id: string,
  label: string,
  value: string,
  onChange: (value: string) => void,
  opts: FieldOpts & { readonly rows?: number } = {},
): ReactElement {
  return createElement(
    'p',
    null,
    createElement('label', { htmlFor: id }, label),
    createElement('textarea', {
      id,
      name: id,
      value,
      rows: opts.rows ?? 3,
      placeholder: opts.placeholder,
      required: opts.required,
      onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    }),
  );
}

/** A labelled select over `options` (value/label pairs). */
export function labeledSelect(
  id: string,
  label: string,
  value: string,
  onChange: (value: string) => void,
  options: ReadonlyArray<{ readonly value: string; readonly label: string }>,
): ReactElement {
  return createElement(
    'p',
    null,
    createElement('label', { htmlFor: id }, label),
    createElement(
      'select',
      {
        id,
        name: id,
        value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      },
      ...options.map((opt) =>
        createElement('option', { key: opt.value, value: opt.value }, opt.label),
      ),
    ),
  );
}
