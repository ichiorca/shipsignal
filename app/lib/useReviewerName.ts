// Shared reviewer-name state for the three approval gates. Persists the name to
// sessionStorage so a reviewer doesn't retype it on every gate screen (UX review L3),
// while keeping the initial render deterministic (starts empty, hydrates from storage in
// an effect) to avoid a server/client hydration mismatch. No 'server-only' — this is a
// client hook used by the gate components; window access is guarded for SSR.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'shipsignal.reviewerName';

export function useReviewerName(): readonly [string, (value: string) => void] {
  const [reviewer, setReviewer] = useState('');

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(STORAGE_KEY);
      if (saved !== null && saved !== '') setReviewer(saved);
    } catch {
      // sessionStorage can be unavailable (private mode / SSR) — degrade to in-memory.
    }
  }, []);

  function update(value: string): void {
    setReviewer(value);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Ignore storage failures; the in-memory value still drives the form.
    }
  }

  return [reviewer, update] as const;
}
