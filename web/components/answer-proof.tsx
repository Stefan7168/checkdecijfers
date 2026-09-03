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
import { memo, useId, useState } from 'react';
import { DERIVED_DATA_MARKING } from '../backend/query/types.ts';
import type { AnswerProof as AnswerProofData } from '../lib/answer-proof.ts';

const LABEL_CLASS = 'text-xs text-ink-muted underline';

function CellTable({ proof, technical }: { proof: AnswerProofData; technical: boolean }) {
  const dimKeys = [...new Set(proof.cells.flatMap((cell) => Object.keys(cell.dims)))].sort();
  const date = proof.syncedAt ?? 'onbekend';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-xs">
        <caption className="mb-1 text-left text-ink-muted">
          {`Tabel ${proof.tableId} — ${proof.tableTitle} · versie ${proof.tableVersion} · gesynchroniseerd ${date} · licentie ${proof.license}`}
        </caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-1 pr-3 font-medium">Onderwerp</th>
            <th scope="col" className="py-1 pr-3 font-medium">Regio</th>
            <th scope="col" className="py-1 pr-3 font-medium">Periode</th>
            {dimKeys.map((key) => (
              <th key={key} scope="col" className="py-1 pr-3 font-medium">{key}</th>
            ))}
            <th scope="col" className="py-1 pr-3 font-medium">Waarde</th>
            <th scope="col" className="py-1 pr-3 font-medium">Status</th>
            {technical ? (
              <>
                <th scope="col" className="py-1 pr-3 font-medium">Cel-id</th>
                <th scope="col" className="py-1 pr-3 font-medium">Meetcode</th>
                <th scope="col" className="py-1 pr-3 font-medium">Regiocode</th>
                <th scope="col" className="py-1 pr-3 font-medium">Periodecode</th>
                <th scope="col" className="py-1 pr-3 font-medium">Batch</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {proof.cells.map((cell) => (
            <tr key={cell.resultId} className="border-b border-line last:border-0">
              <td className="py-1 pr-3">{cell.measureTitle}</td>
              <td className="py-1 pr-3">{cell.regionLabel ?? ''}</td>
              <td className="py-1 pr-3">{cell.periodLabel}</td>
              {dimKeys.map((key) => (
                <td key={key} className="py-1 pr-3">{cell.dimLabels[key] ?? cell.dims[key] ?? ''}</td>
              ))}
              <td className="py-1 pr-3 tnum">{cell.valueText}</td>
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
export const AnswerProof = memo(function AnswerProof({ proof }: { proof: AnswerProofData }) {
  const [open, setOpen] = useState(false);
  const [technical, setTechnical] = useState(false);
  const panelId = useId();
  const triggerLabel = proof.cells.length === 1 ? 'Bewijs dit cijfer' : 'Bewijs deze cijfers';

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className={LABEL_CLASS}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div
          id={panelId}
          role="region"
          aria-label="Onderbouwing van dit antwoord"
          className="order-last mt-2 w-full basis-full rounded border border-line bg-paper-sunken p-3 text-xs text-ink-soft"
        >
          <button
            type="button"
            aria-pressed={technical}
            onClick={() => setTechnical((t) => !t)}
            className={`${LABEL_CLASS} mb-3`}
          >
            Technische details
          </button>

          <div className="mb-3">
            <h4 className="mb-1 font-medium text-ink-muted">Waarom dit antwoord</h4>
            <p>{`Gebruikte lezing: ${proof.reading}.`}</p>
            {proof.periodSemantics !== null ? <p>{`Periodebetekenis: ${proof.periodSemantics}`}</p> : null}
            {proof.alternates.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {proof.alternates.map((alternate, i) => (
                  <li key={i}>
                    {`Niet gekozen: ${alternate.label}`}
                    {technical && alternate.technical !== null ? alternate.technical : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="mb-3">
            <h4 className="mb-1 font-medium text-ink-muted">De gebruikte cellen</h4>
            <CellTable proof={proof} technical={technical} />
          </div>

          <div>
            <h4 className="mb-1 font-medium text-ink-muted">Stap voor stap</h4>
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
