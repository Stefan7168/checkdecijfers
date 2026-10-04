// Owner decision 2026-10-04 (the Eurostat chip): ONE helper decides which registry sources the live chat
// offers as chips. The chat page (server component) hands the result to the chat as a prop, and the
// server action's validateSelection filters the reader's untrusted selection through the SAME function,
// so what the screen offers and what the server accepts can never drift apart.
//
// A source is live in chat when BOTH hold:
//   1. the registry says it may ever be selected (SourceInfo.chatSelectable), and
//   2. its runtime switch is on — for Eurostat that is EUROSTAT_FINDER_ENABLED (eurostatFinderEnabled(),
//      the same flag that lets Eurostat rows into the table search at all). CBS has no runtime switch.
// Flag off ⇒ the result is exactly ['cbs'], i.e. the chip row and the validation behave as before the
// Eurostat chip existed. The client never reads env; it only receives this list.
import { EUROSTAT_SOURCE_KEY, SOURCES } from '../sources/registry.ts';
import { eurostatFinderEnabled } from './recall.ts';

export function liveChatSourceKeys(): string[] {
  return Object.keys(SOURCES).filter(
    (key) => SOURCES[key]!.chatSelectable && (key !== EUROSTAT_SOURCE_KEY || eurostatFinderEnabled()),
  );
}
