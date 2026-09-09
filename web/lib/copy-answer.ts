// Task 2 (chat polish batch, owner ask): the "Kopieer" button used to copy
// only the R4 citation string. The owner wants the WHOLE answer — body, the
// structural disclosure lines, the attribution sentence, and (when
// available) the source deep link, hyperlinked in the rich-text flavor so a
// paste into a doc/email keeps a clickable "Bekijk bij CBS StatLine" link.
//
// Pure leaf (no React, no clipboard access) so it is unit-testable in
// isolation and shared byte-identically between the two answer-card render
// paths in chat.tsx.
import type { AnswerView } from './chat-message.ts';

/** Exported so CopyAnswerButton can escape the citation's own flags line —
 * appended after this module's own output, kept out of `buildAnswerCopy`'s
 * signature since it is not part of the AnswerView. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The lines an answer copies, in the pinned order — each optional
 * structural line included only when the envelope actually carries it
 * (A1: absent/null on older or unqualified answers). */
function structuralLines(view: AnswerView): string[] {
  return [
    view.body,
    view.assumptionLine,
    view.stalenessWarning,
    view.definitionLine,
    view.alternatesLine,
    view.markingLine,
  ].filter((line): line is string => line !== null && line !== '');
}

/** Builds the plain-text and HTML clipboard payloads for "copy the whole
 * answer": the structural lines, then the attribution sentence, then (text
 * only, as its own line) the source URL when one exists — in HTML the
 * attribution itself becomes the `<a href>` instead, so a paste keeps one
 * clickable line rather than a bare URL after it. */
export function buildAnswerCopy(
  view: AnswerView,
  sourceUrl: string | null,
): { text: string; html: string } {
  const lines = structuralLines(view);

  const textParts = [...lines, view.attribution];
  if (sourceUrl !== null) textParts.push(sourceUrl);
  const text = textParts.join('\n\n');

  const htmlParts = lines.map((line) => `<p>${escapeHtml(line)}</p>`);
  const attributionHtml =
    sourceUrl !== null
      ? `<p><a href="${escapeHtml(sourceUrl)}">${escapeHtml(view.attribution)}</a></p>`
      : `<p>${escapeHtml(view.attribution)}</p>`;
  htmlParts.push(attributionHtml);
  const html = htmlParts.join('');

  return { text, html };
}
