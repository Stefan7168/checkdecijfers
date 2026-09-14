'use client';
// Session 72 design brief (docs/session-briefs/2026-09-03-source-drill-
// through-design.md; #70/#79/#89/#90-deep): "Bewijs dit cijfer" — ONE button
// opens ONE panel with three depths stacked (D4 of the brief: not three
// accordions). Presentation only: every Dutch sentence this renders was
// already fully composed by answer-proof.ts (the deterministic-template
// discipline R1's token-scan test pins) — this component interpolates
// pre-decided strings and adds the few STATIC Dutch prefixes ("Gebruikte
// lezing:", "Niet gekozen:", "Periodebetekenis:") that need no computation.
//
// D7: native <button aria-expanded aria-controls> / <button aria-pressed>
// give Enter/Space for free (chart-download.tsx precedent: aria-controls is
// set on the trigger regardless of open state, the controlled element only
// exists in the DOM once open). Closed by default (D1: inline disclosure,
// not a side panel).
import { ShieldCheck } from 'lucide-react';
import { memo, useId, useState } from 'react';
import { DERIVED_DATA_MARKING } from '../backend/query/types.ts';
import { useT } from '../lib/i18n/lang-provider.tsx';
import type { AnswerProof as AnswerProofData, RequestUrlsByBatch } from '../lib/answer-proof.ts';
import { Button } from './ui/button.tsx';

/** WP30c D7(b) (ADR 048, Amendment 6): the batch ids this proof's own cells
 * reference, in first-seen order — the exact set `requestUrlsByBatch` (when
 * present) may carry an entry for. Deduplicated so a multi-cell answer whose
 * cells share one batch shows that batch's URL(s) once, not per cell. */
function distinctBatchIds(proof: AnswerProofData): number[] {
  return [...new Set(proof.cells.map((cell) => cell.batchId))];
}

/** WP30c D7(b): the "Opgehaalde URL's" block under Technische details — one
 * line per batch this proof's cells reference that has a captured
 * request_urls entry. Renders nothing (not even the heading) when the map is
 * absent, empty, or has no entry for any of this proof's batches — the exact
 * degradation the byte-parity requirement asks for: a replay with no lookup
 * wired (chat.tsx live chat, Amendment B5; a deleted batch row; a batch
 * ingested before migration 032) must leave the rest of the panel unchanged,
 * never throw. */
function RequestUrlsSection({
  proof,
  requestUrlsByBatch,
}: {
  proof: AnswerProofData;
  requestUrlsByBatch: RequestUrlsByBatch | null | undefined;
}) {
  const t = useT();
  if (!requestUrlsByBatch) return null;
  const batchIds = distinctBatchIds(proof).filter((id) => (requestUrlsByBatch[id]?.length ?? 0) > 0);
  if (batchIds.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="mb-1 font-medium text-muted-foreground">{t('answerProof.requestUrlsHeading')}</h4>
      <ul className="space-y-0.5">
        {batchIds.map((batchId) => (
          <li key={batchId}>
            {t('answerProof.requestUrlsBatchLabel', { batchId })}
            <ul className="ml-4 list-disc space-y-0.5 break-all">
              {requestUrlsByBatch[batchId]!.map((url, i) => (
                <li key={i}>{url}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CellTable({ proof, technical }: { proof: AnswerProofData; technical: boolean }) {
  const t = useT();
  const dimKeys = [...new Set(proof.cells.flatMap((cell) => Object.keys(cell.dims)))].sort();
  const date = proof.syncedAt ?? t('answerProof.dateUnknown');
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-xs">
        <caption className="mb-1 text-left text-muted-foreground">
          {t('answerProof.tableCaption', {
            tableId: proof.tableId,
            tableTitle: proof.tableTitle,
            version: proof.tableVersion,
            date,
            license: proof.license,
          })}
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colSubject')}</th>
            <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colRegion')}</th>
            <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colPeriod')}</th>
            {dimKeys.map((key) => (
              <th key={key} scope="col" className="py-1 pr-3 font-medium">{key}</th>
            ))}
            <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colValue')}</th>
            <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colStatus')}</th>
            {technical ? (
              <>
                <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colCellId')}</th>
                <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colMeasureCode')}</th>
                <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colRegionCode')}</th>
                <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colPeriodCode')}</th>
                <th scope="col" className="py-1 pr-3 font-medium">{t('answerProof.colBatch')}</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {proof.cells.map((cell) => (
            <tr key={cell.resultId} className="border-b border-border last:border-0">
              <td className="py-1 pr-3">{cell.measureTitle}</td>
              <td className="py-1 pr-3">{cell.regionLabel ?? ''}</td>
              <td className="py-1 pr-3">{cell.periodLabel}</td>
              {dimKeys.map((key) => (
                <td key={key} className="py-1 pr-3">{cell.dimLabels[key] ?? cell.dims[key] ?? ''}</td>
              ))}
              <td className="py-1 pr-3 tnum">
                {cell.highlightUrl !== null ? (
                  <a
                    href={cell.highlightUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={t('answerProof.highlightLinkTitle')}
                    className="underline-offset-2 hover:underline"
                  >
                    {cell.valueText}
                  </a>
                ) : (
                  cell.valueText
                )}
              </td>
              <td className="py-1 pr-3">{cell.status}</td>
              {technical ? (
                <>
                  <td className="py-1 pr-3">{cell.resultId}</td>
                  <td className="py-1 pr-3">{cell.measure}</td>
                  <td className="py-1 pr-3">{cell.regionCode ?? ''}</td>
                  <td className="py-1 pr-3">{cell.periodCode}</td>
                  <td className="py-1 pr-3 tnum">{cell.batchId}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Review round 2 (session 74): memoized — `Chat` re-renders every message on
// each keystroke in the input, and an OPEN panel rebuilt its cell table each
// time; `message.proof` is a stable reference (built once per message), so
// identity memo is exact.
export const AnswerProof = memo(function AnswerProof({
  proof,
  requestUrlsByBatch,
}: {
  proof: AnswerProofData;
  /** WP30c D7(b) (ADR 048, Amendment 6): a live side-lookup, fetched
   * ALONGSIDE `proof` by the caller — never a field ON `proof` itself, since
   * `ingestion_batches.request_urls` lives outside the R8-reconstructed
   * envelope. Optional/nullable: absent on the live chat.tsx call site
   * (Amendment B5, a named residual) and on any replay where the lookup
   * found nothing — the panel below renders identically either way. */
  requestUrlsByBatch?: RequestUrlsByBatch | null;
}) {
  const [open, setOpen] = useState(false);
  const [technical, setTechnical] = useState(false);
  const panelId = useId();
  const t = useT();
  const triggerLabel = proof.cells.length === 1 ? t('answerProof.triggerSingle') : t('answerProof.triggerPlural');

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <ShieldCheck aria-hidden className="size-3.5" />
        {triggerLabel}
      </Button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label={t('answerProof.regionLabel')}
          className="order-last mt-2 w-full basis-full rounded border border-border bg-muted p-3 text-xs text-muted-foreground"
        >
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mb-3"
            aria-pressed={technical}
            onClick={() => setTechnical((t) => !t)}
          >
            {t('answerProof.technicalToggle')}
          </Button>

          <div className="mb-3">
            <h4 className="mb-1 font-medium text-muted-foreground">{t('answerProof.whyHeading')}</h4>
            <p>{t('answerProof.readingLine', { reading: proof.reading })}</p>
            {proof.periodSemantics !== null ? (
              <p>{t('answerProof.periodSemanticsLine', { value: proof.periodSemantics })}</p>
            ) : null}
            {proof.alternates.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {proof.alternates.map((alternate, i) => (
                  <li key={i}>
                    {t('answerProof.notChosenLine', { label: alternate.label })}
                    {technical && alternate.technical !== null ? alternate.technical : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mb-3">
            <h4 className="mb-1 font-medium text-muted-foreground">{t('answerProof.cellsHeading')}</h4>
            <CellTable proof={proof} technical={technical} />
            {/* WP30c D7(b): shown alongside the cell table's own "Batch"
              * column (same technical-only gate) — the per-batch request
              * URL(s), when the live lookup found any. */}
            {technical ? <RequestUrlsSection proof={proof} requestUrlsByBatch={requestUrlsByBatch} /> : null}
          </div>

          <div>
            <h4 className="mb-1 font-medium text-muted-foreground">{t('answerProof.stepsHeading')}</h4>
            <ol className="list-decimal space-y-0.5 pl-4">
              {proof.steps.map((step, i) => (
                <li key={i}>
                  {step.text}
                  {technical && step.technical !== null ? step.technical : ''}
                </li>
              ))}
            </ol>
            {proof.nullNotice !== null ? <p className="mt-1">{proof.nullNotice}</p> : null}
            {proof.marked ? <p className="mt-1">{DERIVED_DATA_MARKING}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
});
