// react-resizable-panels' `useDefaultLayout` hook defaults its `storage`
// option to a bare `localStorage` reference (evaluated as a default
// parameter). That reference does not exist in the Node environment Next.js
// uses to server-render a 'use client' component's initial HTML, so calling
// the hook without an explicit `storage` would crash there — a crash jsdom
// tests can't catch, since jsdom always provides a global `localStorage`.
// This helper is the one place that guard lives.
export function getPanelStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  if (typeof localStorage === 'undefined') {
    return { getItem: () => null, setItem: () => {} };
  }
  return localStorage;
}
