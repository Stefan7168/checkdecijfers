'use client';
// Co-pilot phase 2 (session 113, Task 6) — DOORWAY A for a data command: the
// own-data card's Data panel. Deterministic end to end (no LLM, no server
// call of its own: the card's render effect makes the one free round trip),
// and every control here is a `setInstruction` doorway that SAYS so, which is
// what the §6 "no chat-only capability" contract test scans for.
//
// The panel never decides what is drawable: a change goes through `withPatch`
// and then the SERVER's own allowlist (validateClientInstruction). A refused
// combination shows the validator's own reason, translated into the
// reader's language (#282: translateValidationReason, never the schema's
// raw English `.message`), and dispatches nothing — the chart on screen is
// never changed by a control the schema would reject.
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Database } from 'lucide-react';
import {
  AGGREGATE_KEYS,
  DERIVED_KEYS,
  summarizeInstruction,
  translateValidationReason,
  validateClientInstruction,
  withPatch,
  type ClientInstructionProblem,
} from '../lib/chart-data-instruction.ts';
import { t, type Lang } from '../lib/i18n/messages.ts';
import { Button } from './ui/button.tsx';
import {
  AGGREGATE_FNS,
  DERIVED_OPS,
  DERIVED_OPS_WITH_B,
  type ClientChartInstruction,
  type ColumnId,
  type ColumnProfile,
  type DatasetProfile,
  type FilterClause,
} from '../backend/attachments/types.ts';
import { MAX_LIMIT, MAX_SERIES, MAX_Y_COLUMNS } from '../backend/attachments/limits.ts';

/** Which control group a refusal belongs under — the reason is shown where
 * the reader just clicked, not in one far-away line. */
type Group = 'kind' | 'x' | 'y' | 'seriesBy' | 'filters' | 'sort' | 'limit' | 'aggregate' | 'derived';

export interface ChartDataPanelProps {
  instruction: ClientChartInstruction;
  profile: DatasetProfile;
  lang: Lang;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerId: string;
  idPrefix: string;
  /** Called ONLY with an instruction the server's allowlist accepted, plus
   * its digit-free summary. */
  onChange: (next: ClientChartInstruction, summary: string) => void;
}

const CONTROL = 'rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground';
const LABEL = 'w-full shrink-0 text-muted-foreground sm:w-28';
const ROW = 'mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2';
/** Every control is a doorway for the same command kind (§6's contract). */
const KIND_ATTR = { 'data-command-kind': 'setInstruction' } as const;

function isNumeric(column: ColumnProfile): boolean {
  return column.type === 'number' || column.type === 'year';
}

export function ChartDataPanel({
  instruction,
  profile,
  lang,
  open,
  onOpenChange,
  triggerId,
  idPrefix,
  onChange,
}: ChartDataPanelProps): ReactNode {
  const [problem, setProblem] = useState<{ group: Group; reason: ClientInstructionProblem } | null>(null);

  if (!open) return null;

  const regionId = `${idPrefix}-data`;
  const columns = profile.columns;
  const yCandidates = columns.filter(isNumeric);
  const seriesCandidates = columns.filter((c) => c.distinct !== undefined && c.distinct.length <= MAX_SERIES);
  const valueFilterColumns = columns.filter((c) => c.distinct !== undefined);
  const rangeFilterColumns = columns.filter((c) => c.min !== undefined && c.max !== undefined);

  function emit(patch: Partial<ClientChartInstruction>, group: Group): void {
    const next = withPatch(instruction, patch);
    const reason = validateClientInstruction(next, profile);
    if (reason !== null) {
      setProblem({ group, reason });
      return;
    }
    setProblem(null);
    onChange(next, summarizeInstruction(next, profile, lang));
  }

  /** The clauses with `column`'s own clause replaced (or removed), in the
   * order the reader already had them. */
  function withFilter(column: ColumnId, clause: FilterClause | null): FilterClause[] {
    const existing = instruction.filters.some((f) => f.column === column);
    if (!existing) return clause === null ? instruction.filters : [...instruction.filters, clause];
    return instruction.filters.flatMap((f) => (f.column === column ? (clause === null ? [] : [clause]) : [f]));
  }

  function problemLine(group: Group): ReactNode {
    if (problem === null || problem.group !== group) return null;
    return (
      <p role="status" data-testid="chart-data-problem" className="mt-1 text-muted-foreground">
        {t(lang, 'chart.data.problem', { message: translateValidationReason(lang, problem.reason) })}
      </p>
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape') return;
    onOpenChange(false);
    document.getElementById(triggerId)?.focus();
  }

  const sortValue = instruction.sort === null ? 'none' : instruction.sort.by;
  const derivedOp = instruction.derived?.op ?? null;

  return (
    <div
      id={regionId}
      role="region"
      aria-label={t(lang, 'chart.data.regionLabel')}
      data-slot="chart-data-panel"
      onKeyDown={onKeyDown}
      className="mt-2 rounded-lg border border-border bg-card p-3 text-xs"
    >
      {/* Chart kind — the DATA orientation (line vs bar as the instruction
        * asks for it). The card's form tabs remain the VIEW. */}
      <div className={ROW}>
        <span className={LABEL}>{t(lang, 'chart.data.kind')}</span>
        <div role="radiogroup" aria-label={t(lang, 'chart.data.kind')} className="flex flex-wrap gap-3">
          {(['line', 'bar'] as const).map((kind) => (
            <label key={kind} className="inline-flex items-center gap-1">
              <input
                type="radio"
                name={`${idPrefix}-data-kind`}
                value={kind}
                checked={instruction.kind === kind}
                onChange={() => emit({ kind }, 'kind')}
                {...KIND_ATTR}
              />
              {t(lang, kind === 'line' ? 'chart.data.kindLine' : 'chart.data.kindBar')}
            </label>
          ))}
        </div>
      </div>
      {problemLine('kind')}

      <div className={ROW}>
        <label className={LABEL} htmlFor={`${regionId}-x`}>
          {t(lang, 'chart.data.x')}
        </label>
        <select
          id={`${regionId}-x`}
          className={CONTROL}
          value={instruction.x}
          onChange={(e) => emit({ x: e.target.value }, 'x')}
          {...KIND_ATTR}
        >
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.header}
            </option>
          ))}
        </select>
      </div>
      {problemLine('x')}

      {/* 1..MAX_Y_COLUMNS value columns; the schema's own count check is what
        * refuses an empty or over-full selection, with its own wording. */}
      <div className={ROW}>
        <span className={LABEL}>{t(lang, 'chart.data.y')}</span>
        <div role="group" aria-label={t(lang, 'chart.data.y')} className="flex flex-wrap gap-3">
          {yCandidates.map((column) => {
            const checked = instruction.y.includes(column.id);
            return (
              <label key={column.id} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && instruction.y.length >= MAX_Y_COLUMNS}
                  onChange={() =>
                    emit(
                      {
                        y: yCandidates
                          .filter((c) => (c.id === column.id ? !checked : instruction.y.includes(c.id)))
                          .map((c) => c.id),
                      },
                      'y',
                    )
                  }
                  {...KIND_ATTR}
                />
                {column.header}
              </label>
            );
          })}
        </div>
      </div>
      {problemLine('y')}

      <div className={ROW}>
        <label className={LABEL} htmlFor={`${regionId}-series`}>
          {t(lang, 'chart.data.seriesBy')}
        </label>
        <select
          id={`${regionId}-series`}
          className={CONTROL}
          value={instruction.seriesBy ?? ''}
          onChange={(e) => emit({ seriesBy: e.target.value === '' ? null : e.target.value }, 'seriesBy')}
          {...KIND_ATTR}
        >
          <option value="">{t(lang, 'chart.data.none')}</option>
          {seriesCandidates.map((column) => (
            <option key={column.id} value={column.id}>
              {column.header}
            </option>
          ))}
        </select>
      </div>
      {problemLine('seriesBy')}

      {/* Filters: the `distinct` list is the ONLY legal source of an `in`
        * clause's values (schema.ts), and a numeric column's own min/max the
        * only legal bounds of a `between` one — so the controls offer exactly
        * those and nothing else. */}
      {valueFilterColumns.length > 0 || rangeFilterColumns.length > 0 ? (
        <>
          <div className="mt-3 text-muted-foreground">{t(lang, 'chart.data.filters')}</div>
          {valueFilterColumns.map((column) => {
            const clause = instruction.filters.find((f) => f.column === column.id);
            const values = clause !== undefined && clause.op === 'in' ? clause.values : [];
            return (
              <div key={column.id} className={ROW}>
                <span className={LABEL}>{column.header}</span>
                <select
                  multiple
                  aria-label={t(lang, 'chart.data.filterValues', { col: column.header })}
                  className={CONTROL}
                  value={values}
                  onChange={(e) => {
                    const picked = [...e.target.selectedOptions].map((option) => option.value);
                    emit({ filters: withFilter(column.id, picked.length === 0 ? null : { column: column.id, op: 'in', values: picked }) }, 'filters');
                  }}
                  {...KIND_ATTR}
                >
                  {(column.distinct ?? []).map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={t(lang, 'chart.data.filterClear', { col: column.header })}
                  disabled={clause === undefined}
                  onClick={() => emit({ filters: withFilter(column.id, null) }, 'filters')}
                  {...KIND_ATTR}
                >
                  {t(lang, 'chart.data.filterClear', { col: column.header })}
                </Button>
              </div>
            );
          })}
          {rangeFilterColumns.map((column) => {
            const clause = instruction.filters.find((f) => f.column === column.id);
            const between = clause !== undefined && clause.op === 'between' ? clause : null;
            const from = between?.from ?? column.min!;
            const to = between?.to ?? column.max!;
            const change = (next: { from: number; to: number } | null): void =>
              emit({ filters: withFilter(column.id, next === null ? null : { column: column.id, op: 'between', ...next }) }, 'filters');
            return (
              <div key={column.id} className={ROW}>
                <span className={LABEL}>{column.header}</span>
                <input
                  type="number"
                  aria-label={t(lang, 'chart.data.filterFrom', { col: column.header })}
                  className={`${CONTROL} w-24`}
                  min={column.min}
                  max={column.max}
                  value={String(from)}
                  onChange={(e) => (e.target.value === '' ? change(null) : change({ from: Number(e.target.value), to }))}
                  {...KIND_ATTR}
                />
                <input
                  type="number"
                  aria-label={t(lang, 'chart.data.filterTo', { col: column.header })}
                  className={`${CONTROL} w-24`}
                  min={column.min}
                  max={column.max}
                  value={String(to)}
                  onChange={(e) => (e.target.value === '' ? change(null) : change({ from, to: Number(e.target.value) }))}
                  {...KIND_ATTR}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-label={t(lang, 'chart.data.filterClear', { col: column.header })}
                  disabled={clause === undefined}
                  onClick={() => change(null)}
                  {...KIND_ATTR}
                >
                  {t(lang, 'chart.data.filterClear', { col: column.header })}
                </Button>
              </div>
            );
          })}
          {problemLine('filters')}
        </>
      ) : null}

      <div className={ROW}>
        <label className={LABEL} htmlFor={`${regionId}-sort`}>
          {t(lang, 'chart.data.sort')}
        </label>
        <select
          id={`${regionId}-sort`}
          className={CONTROL}
          value={sortValue}
          onChange={(e) =>
            emit(
              e.target.value === 'none'
                ? { sort: null }
                : { sort: { by: e.target.value, direction: instruction.sort?.direction ?? 'desc' } },
              'sort',
            )
          }
          {...KIND_ATTR}
        >
          <option value="none">{t(lang, 'chart.data.sortNone')}</option>
          <option value="x">{t(lang, 'chart.data.sortX')}</option>
          <option value="value">{t(lang, 'chart.data.sortValue')}</option>
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.header}
            </option>
          ))}
        </select>
        <select
          aria-label={t(lang, 'chart.data.direction')}
          className={CONTROL}
          disabled={instruction.sort === null}
          value={instruction.sort?.direction ?? 'desc'}
          onChange={(e) =>
            instruction.sort === null
              ? undefined
              : emit({ sort: { by: instruction.sort.by, direction: e.target.value as 'asc' | 'desc' } }, 'sort')
          }
          {...KIND_ATTR}
        >
          <option value="asc">{t(lang, 'chart.data.directionAsc')}</option>
          <option value="desc">{t(lang, 'chart.data.directionDesc')}</option>
        </select>
      </div>
      {problemLine('sort')}

      <div className={ROW}>
        <label className={LABEL} htmlFor={`${regionId}-limit`}>
          {t(lang, 'chart.data.limit')}
        </label>
        <input
          id={`${regionId}-limit`}
          type="number"
          className={`${CONTROL} w-24`}
          min={1}
          max={MAX_LIMIT}
          value={instruction.limit === null ? '' : String(instruction.limit)}
          onChange={(e) => emit({ limit: e.target.value === '' ? null : Number(e.target.value) }, 'limit')}
          {...KIND_ATTR}
        />
      </div>
      {problemLine('limit')}

      <div className={ROW}>
        <label className={LABEL} htmlFor={`${regionId}-aggregate`}>
          {t(lang, 'chart.data.aggregate')}
        </label>
        <select
          id={`${regionId}-aggregate`}
          className={CONTROL}
          value={instruction.aggregate?.fn ?? 'none'}
          onChange={(e) => emit(e.target.value === 'none' ? { aggregate: null } : { aggregate: { fn: e.target.value as 'sum' } }, 'aggregate')}
          {...KIND_ATTR}
        >
          <option value="none">{t(lang, 'chart.data.none')}</option>
          {AGGREGATE_FNS.map((fn) => (
            <option key={fn} value={fn}>
              {t(lang, AGGREGATE_KEYS[fn])}
            </option>
          ))}
        </select>
      </div>
      {problemLine('aggregate')}

      <div className={ROW}>
        <label className={LABEL} htmlFor={`${regionId}-derived`}>
          {t(lang, 'chart.data.derived')}
        </label>
        <select
          id={`${regionId}-derived`}
          className={CONTROL}
          value={derivedOp ?? 'none'}
          onChange={(e) =>
            emit(
              e.target.value === 'none'
                ? { derived: null }
                : { derived: { op: e.target.value as 'difference', b: instruction.derived?.b ?? null } },
              'derived',
            )
          }
          {...KIND_ATTR}
        >
          <option value="none">{t(lang, 'chart.data.none')}</option>
          {DERIVED_OPS.map((op) => (
            <option key={op} value={op}>
              {t(lang, DERIVED_KEYS[op])}
            </option>
          ))}
        </select>
        {/* Only difference/ratio take a second column; picking one of those
          * with nothing to subtract is exactly the refusal the problem line
          * below reports. */}
        {derivedOp !== null && DERIVED_OPS_WITH_B.includes(derivedOp) ? (
          <select
            aria-label={t(lang, 'chart.data.derivedB')}
            className={CONTROL}
            value={instruction.derived?.b ?? ''}
            onChange={(e) => emit({ derived: { op: derivedOp, b: e.target.value === '' ? null : e.target.value } }, 'derived')}
            {...KIND_ATTR}
          >
            <option value="">{t(lang, 'chart.data.none')}</option>
            {yCandidates
              .filter((column) => column.id !== instruction.y[0])
              .map((column) => (
                <option key={column.id} value={column.id}>
                  {column.header}
                </option>
              ))}
          </select>
        ) : null}
      </div>
      {problemLine('derived')}
    </div>
  );
}

/** The always-visible trigger — the same controlled shape as
 * `ChartConfigTrigger` (its own header explains why the trigger is a separate
 * component from the region it opens). */
export function ChartDataTrigger({
  open,
  onToggle,
  controlsId,
  triggerId,
  lang,
}: {
  open: boolean;
  onToggle: () => void;
  controlsId: string;
  triggerId: string;
  lang: Lang;
}): ReactNode {
  const label = t(lang, 'chart.data.trigger');
  return (
    <Button
      id={triggerId}
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-controls={controlsId}
      onClick={onToggle}
      className="max-sm:size-11"
    >
      <Database aria-hidden="true" />
    </Button>
  );
}
