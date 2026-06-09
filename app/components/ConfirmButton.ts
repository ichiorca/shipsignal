// Accessible confirmation gate for irreversible / consequential actions (UX review B1):
// resuming the worker past an approval gate, and — highest blast radius — overwriting a
// repo SKILL.md. A bare button made those one keystroke away with no recap of the
// consequence; this wraps the action in a native <dialog> modal that restates what will
// happen before it runs.
//
// Why native <dialog>: showModal() gives a real focus trap, Escape-to-cancel, and
// focus restoration for free (WCAG 2.4.3 / 2.1.2) instead of hand-rolling them. The
// dialog is mounted only while open, so the closed (server-rendered) markup is just the
// trigger button — the gate components' a11y snapshots are unaffected, and showModal is
// feature-detected so SSR/jsdom never throw.
//
// "use client": owns the open/working state. Authored with React.createElement (not JSX)
// to match the other components and render under the `node --test` harness.

'use client';

import { createElement, Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';

export interface ConfirmButtonProps {
  /** Trigger button text (the action the reviewer sees in the toolbar). */
  readonly label: string;
  /** Dialog heading. */
  readonly title: string;
  /** Plain-language description of the consequence (what will happen, and that it is final). */
  readonly body: string;
  /** Confirm button text inside the dialog. */
  readonly confirmLabel: string;
  /** The action to run once confirmed; awaited so the dialog can show progress. */
  readonly onConfirm: () => void | Promise<void>;
  /** Disable the trigger (e.g. while another action is in flight). */
  readonly disabled?: boolean;
  /**
   * When set, the reviewer must type this exact phrase to enable the confirm button —
   * an extra guard for the single highest-blast action (repo SKILL.md overwrite).
   */
  readonly confirmPhrase?: string;
  /** Optional stable hook for the trigger button (e2e targeting); never affects behavior. */
  readonly testId?: string;
}

export function ConfirmButton(props: ConfirmButtonProps): ReactElement {
  const {
    label,
    title,
    body,
    confirmLabel,
    onConfirm,
    disabled = false,
    confirmPhrase,
    testId,
  } = props;

  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [typed, setTyped] = useState('');
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const bodyId = `${baseId}-body`;
  const phraseId = `${baseId}-phrase`;

  // Promote the just-mounted dialog to a modal so the browser owns the focus trap + Esc.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog !== null && !dialog.open && typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
  }, [open]);

  function dismiss(): void {
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    setOpen(false);
    setTyped('');
    // Return focus to the trigger that opened the dialog (WCAG 2.4.3).
    triggerRef.current?.focus();
  }

  async function confirm(): Promise<void> {
    setWorking(true);
    try {
      await onConfirm();
    } finally {
      setWorking(false);
      dismiss();
    }
  }

  const confirmDisabled =
    working || (confirmPhrase !== undefined && typed.trim() !== confirmPhrase);

  const dialog = open
    ? createElement(
        'dialog',
        {
          ref: dialogRef,
          'aria-labelledby': titleId,
          'aria-describedby': bodyId,
          // Esc / backdrop dismissal: keep React state in sync + restore focus.
          onCancel: () => {
            setOpen(false);
            setTyped('');
            triggerRef.current?.focus();
          },
          onClose: () => {
            setOpen(false);
            setTyped('');
          },
        },
        createElement('h2', { id: titleId }, title),
        createElement('p', { id: bodyId }, body),
        confirmPhrase !== undefined
          ? createElement(
              'p',
              null,
              createElement(
                'label',
                { htmlFor: phraseId },
                `Type “${confirmPhrase}” to confirm`,
              ),
              createElement('input', {
                id: phraseId,
                type: 'text',
                value: typed,
                autoComplete: 'off',
                onChange: (e: { target: { value: string } }) => setTyped(e.target.value),
              }),
            )
          : null,
        createElement(
          'div',
          { role: 'group', 'aria-label': 'Confirm or cancel' },
          createElement(
            'button',
            { type: 'button', onClick: () => dismiss(), disabled: working },
            'Cancel',
          ),
          createElement(
            'button',
            {
              type: 'button',
              'data-confirm': 'true',
              disabled: confirmDisabled,
              onClick: () => void confirm(),
            },
            working ? 'Working…' : confirmLabel,
          ),
        ),
      )
    : null;

  return createElement(
    Fragment,
    null,
    createElement(
      'button',
      {
        ref: triggerRef,
        type: 'button',
        'data-testid': testId,
        disabled: disabled || working,
        onClick: () => setOpen(true),
      },
      label,
    ),
    dialog,
  );
}
