// Chart co-pilot phase 1 (session 112, ADR 056) — the spec §6 "no chat-only
// capability" contract in its phase-1 form: EVERY command kind in
// CHART_COMMAND_KINDS is reachable from an on-screen control, so a later
// chat doorway can never gain a capability the panel/canvas does not
// already offer. Each dispatching control carries `data-command-kind`
// (a data attribute only — no behaviour hangs off it).
//
// Mocking/render conventions copied verbatim from chart-headline-ui.test.tsx
// (which in turn copied chart.test.tsx): `vi.hoisted` + `vi.mock` for every
// Server Action module chart.tsx imports directly.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHART_COMMAND_KINDS, validateCommand, type ChartCommandKind, type CommandContext } from '../lib/chart-commands.ts';
import type { ChartSpec } from '../backend/chart/types.ts';
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';
import { ChartGoalLine } from './chart-goal-line.tsx';
import { ChartEraShading } from './chart-era-shading.tsx';

const chartHeadlineActions = vi.hoisted(() => ({
  draftChartHeadline: vi.fn(),
  saveChartHeadline: vi.fn(),
  fetchChartHeadline: vi.fn().mockResolvedValue({ ok: true, headline: null }),
}));
vi.mock('../app/chart-headline-actions.ts', () => chartHeadlineActions);
// Task 7 (co-pilot phase 1): chart.tsx imports the chart_edits Server Action
// module directly — without this mock the real module (and its db/auth
// imports) would load in jsdom.
const chartEditsActions = vi.hoisted(() => ({
  fetchChartEdits: vi.fn().mockResolvedValue({ ok: true, log: null }),
  saveChartEdits: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../app/chart-edits-actions.ts', () => chartEditsActions);
const chartInsightsActions = vi.hoisted(() => ({
  generateInsights: vi.fn().mockResolvedValue({ ok: true, phrased: {} }),
}));
vi.mock('../app/chart-insights-actions.ts', () => chartInsightsActions);
const chartStyleActions = vi.hoisted(() => ({
  saveMyChartStyle: vi.fn(),
  forgetMyChartStyle: vi.fn(),
  lookupBrand: vi.fn(),
}));
vi.mock('../app/chart-style-actions.ts', () => chartStyleActions);
const { createEmbedCode } = vi.hoisted(() => ({ createEmbedCode: vi.fn() }));
vi.mock('../app/embed-actions.ts', () => ({ createEmbedCode }));
// Co-pilot phase 2 (session 113), Task 6: the own-data card imports the
// dataset render action directly — mocked here the way user-chart.test.tsx
// mocks it, so the real 'use server' module never loads in jsdom.
const datasetActions = vi.hoisted(() => ({ renderDatasetInstruction: vi.fn() }));
vi.mock('../app/dataset-actions.ts', () => datasetActions);
// Co-pilot phase 3 (session 114), Task 3: the CBS chat doorway itself now
// mounts on this card too (with embed.auditId given), so its own Server
// Action module needs the same jsdom-import guard as the others above.
const chartCopilotActions = vi.hoisted(() => ({ adjustCbsChart: vi.fn() }));
vi.mock('../app/chart-copilot-actions.ts', () => chartCopilotActions);
// Final-review fix I10/I11's removeDerivedOverlay test (below) actually adds
// a derived-overlay recipe, which fires chart.tsx's resolution effect — the
// same jsdom-import guard as every Server Action mock above, so that effect
// resolves against a harmless stub instead of the real db/auth-backed
// module.
const chartDerivationActions = vi.hoisted(() => ({
  requestChartDerivation: vi.fn().mockResolvedValue({ ok: false, reason: 'not resolved in this test' }),
}));
vi.mock('../app/chart-derivation-actions.ts', () => chartDerivationActions);
// Phase 5b (verified-whole, Task 4): the on-demand whole check's Server
// Action module — same jsdom-import guard.
const chartWholeActions = vi.hoisted(() => ({
  requestWholeVerification: vi.fn().mockResolvedValue({ ok: false, reason: 'not resolved in this test' }),
}));
vi.mock('../app/chart-whole-verification-actions.ts', () => chartWholeActions);
// Own-data verified-whole parity (Task 4): the own-data card's OWN on-demand
// whole check — same jsdom-import guard as every Server Action mock above.
// (requestDatasetDerivation, the own-data card's OTHER direct Server Action
// import, is already exercised unmocked elsewhere in this file's own-data
// tests below — its effect only ever fires when derivedOverlayRequests is
// non-empty, which no test here produces, so it is never actually called.)
const datasetWholeActions = vi.hoisted(() => ({
  requestDatasetWholeVerification: vi.fn().mockResolvedValue({ ok: false, reason: 'not resolved in this test' }),
}));
vi.mock('../app/dataset-whole-verification-actions.ts', () => datasetWholeActions);

import { ChartView } from './chart.tsx';
import { cbsViewCommandSchema } from '../backend/chart/copilot/schema.ts';
import { UserChartView, type UserChartEditContext } from './user-chart.tsx';
import { allowedForms } from '../lib/chart-fit.ts';
import type { ChartForm } from '../lib/chart-view-state.ts';
import { t } from '../lib/i18n/messages.ts';

// chart.test.tsx does not export its fixtures, so its `point`/`spec`/
// `twoSeriesLineSpec` factories are copied here (chart.test.tsx:87-125 and
// :1766-1788) rather than guessed.
function point(overrides: Partial<ChartSpec['series'][0]['points'][0]> = {}) {
  return {
    resultId: 'r1',
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    decimals: 1,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    ...overrides,
  };
}

function twoSeriesLineSpec(): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [
      {
        label: 'Nederland',
        regionCode: null,
        points: [
          point({ resultId: 'nl-2020', periodCode: '2020', periodLabel: '2020', value: 100, formattedValue: '100' }),
          point({ resultId: 'nl-2021', periodCode: '2021', periodLabel: '2021', value: 110, formattedValue: '110' }),
        ],
      },
      {
        label: 'Utrecht',
        regionCode: 'GM0344',
        points: [
          point({ resultId: 'ut-2020', periodCode: '2020', periodLabel: '2020', value: 50, formattedValue: '50' }),
          point({ resultId: 'ut-2021', periodCode: '2021', periodLabel: '2021', value: 55, formattedValue: '55' }),
        ],
      },
    ],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 12345NED.',
    attribution: {
      tableId: '12345NED',
      tableTitle: 'Test',
      tableVersion: 1,
      syncedAt: '2026-07-01',
      coveredPeriods: { from: '2020', to: '2024' },
      license: 'CC BY 4.0',
    },
  };
}

/** Phase 5b (verified-whole, Task 5): a region-CLASS chart the way
 * buildChartSpec draws one — twelve one-point series (one per province, the
 * codes CBS's own 'PV' dimension group carries), `kind: 'bar'`, and the
 * `regionScope` provenance only `resolveRegionSet` ever stamps. The codes
 * and values are shape, not data: nothing here is asserted as a number. */
function provinciesRosterSpec(): ChartSpec {
  const codes = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26', 'PV27', 'PV28', 'PV29', 'PV30', 'PV31'];
  const base = twoSeriesLineSpec();
  return {
    ...base,
    kind: 'bar',
    series: codes.map((code, i) => ({
      label: `Provincie ${code}`,
      regionCode: code,
      points: [point({ resultId: `${code}-2025`, periodCode: '2025', periodLabel: '2025', value: 100 + i, formattedValue: String(100 + i) })],
    })),
    regionScope: { kind: 'all_provincies' },
  };
}

afterEach(cleanup);

/** Kinds whose control only exists inside the open Style panel. */
const PANEL_KINDS: ChartCommandKind[] = ['setPresentation', 'replacePresentation', 'resetPresentation', 'applyTemplate'];
/** Kinds whose control only exists once a point has been clicked, or once a
 * note/goal-line/era-shading/derived-overlay already exists to remove.
 * `setHeadlineOverride` (phase 4, Task 5) lives in the SAME pendingPoint UI
 * as addNote/removeNote — same gating, same reasoning.
 *
 * Own-data verified-whole parity (Task 4): `setWholeReference` too — its
 * control (a pie slice / stack segment) only exists once the reader has
 * switched to one of the three whole-form tabs, which `twoSeriesUserSpec`
 * below never does (the own-data contract test opens the Style/Data panels
 * only, never a form tab). A dedicated compensating test below (mirroring
 * the setHeadlineOverride/removeGoalLine/removeEraShading/
 * removeDerivedOverlay ones this file already has, per the I10/I11 finding
 * that a bare exemption with no test of its own is the gap to avoid)
 * switches to Taartdiagram and proves the marker is really there. */
const NOTE_KINDS: ChartCommandKind[] = [
  'addNote',
  'removeNote',
  'setHeadlineOverride',
  'removeGoalLine',
  'removeEraShading',
  'removeDerivedOverlay',
  'setWholeReference',
];
/** Co-pilot phase 2 (session 113), Task 4: kinds whose control lives on the
 * OWN-DATA card, not this CBS one. `setInstruction` names dataset columns, so
 * a CBS chart has no control for it and — by the ADR 037 D11 type guard —
 * could not validate one anyway. Its own-data control is covered by that
 * card's suite (Task 5/6), which scans the same `data-command-kind`
 * attribute.
 *
 * Own-data verified-whole parity (plan 2026-09-22, Task 4): `setWholeReference`
 * joins it — the reader-designated-total gesture is a pie slice / stack
 * segment click that exists ONLY on the own-data card (CBS's own phase 5b
 * verified-whole check is fully automatic, server-computed against a
 * registry total; it has no reader-designation gesture and never dispatches
 * this command). Its own-data control is covered below (NOTE_KINDS — the
 * SAME "gated behind a precondition" reasoning, plus a compensating test). */
const OWN_DATA_KINDS: ChartCommandKind[] = ['setInstruction', 'setWholeReference'];
/** Phase 4, Task 7 (ADR 056): a derived overlay (difference/average) is
 * computed via `requestChartDerivation`, which only accepts an audited CBS
 * answer (`{ kind: 'answer', id }`) — own-data charts have no audit row to
 * re-derive from, and already have full arithmetic freedom via
 * `setInstruction`'s own aggregate/derive vocabulary (owner decision,
 * spec §7.1). CBS-only by construction, same as `setPeriodRange`/
 * `setReading` above. */
const DERIVED_OVERLAY_KINDS: ChartCommandKind[] = ['addDerivedOverlay', 'removeDerivedOverlay'];
/** Phase 4 (session 115): goal line, era shading and the reader-chosen
 * headline override were built for the CBS/Eurostat card only this session
 * — own-data support is a natural, cheap follow-up (none of the three has
 * any data-provenance complexity that would make it harder there) but was
 * not part of this session's scope. Tracked as a residual, not silently
 * dropped. */
const CBS_CARD_ONLY_KINDS: ChartCommandKind[] = [
  'addGoalLine',
  'removeGoalLine',
  'addEraShading',
  'removeEraShading',
  'setHeadlineOverride',
];

function kindsInDom(root: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const el of root.querySelectorAll('[data-command-kind]')) {
    for (const k of (el.getAttribute('data-command-kind') ?? '').split(/\s+/)) if (k) out.add(k);
  }
  return out;
}

describe('command ↔ control contract (ADR 056 decision 2, phase-1 form)', () => {
  it('every command kind is reachable from an on-screen control', async () => {
    render(
      <ChartView
        spec={twoSeriesLineSpec()}
        alternates={[{ label: 'Alternatieve lezing', spec: twoSeriesLineSpec() }]}
        embed={{ auditId: 1 }}
      />,
    );
    // Opening the Style panel mounts its kinds. The panel is a portaled,
    // next/dynamic-loaded modal (chart.test.tsx's own note), so this awaits
    // a control inside it and the scan below reads document.body, not the
    // render container. Goal line and era shading (phase 4) are ALSO their
    // own next/dynamic components (`ssr: false`) — their trigger buttons can
    // resolve a tick after the modal tab, so each is awaited explicitly
    // before the scan; without this the scan can run before their lazy
    // import settles and flag them as missing when they are not.
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    await screen.findByRole('tab', { name: 'Grafiek' });
    // Goal line's and era shading's own `addGoalLine`/`addEraShading`
    // data-command-kind sits on each form's SAVE button, not its trigger —
    // same gating as addNote (see NOTE_KINDS), so the forms are opened here
    // rather than exempting the kinds outright.
    fireEvent.click(await screen.findByRole('button', { name: 'Doellijn toevoegen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Periode markeren' }));

    const found = kindsInDom(document.body);
    const missing = CHART_COMMAND_KINDS.filter(
      (k) => !found.has(k) && !NOTE_KINDS.includes(k) && !OWN_DATA_KINDS.includes(k),
    );
    expect(missing, `command kinds with no control: ${missing.join(', ')}`).toEqual([]);
    expect(PANEL_KINDS.every((k) => found.has(k))).toBe(true);
  });

  // Task 3, Step 4: the CBS/Eurostat co-pilot's own vocabulary
  // (cbsViewCommandSchema) is read straight off the schema — never a
  // hand-copied kind list that could drift from it — and every kind it can
  // produce must already have an on-screen control on THIS card (the ADR
  // 056 §6 "no chat-only capability" contract, now over the actual schema
  // instead of the phase-1 CHART_COMMAND_KINDS superset).
  it('every kind cbsViewCommandSchema can produce has an on-screen control', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 1 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    await screen.findByRole('tab', { name: 'Grafiek' });
    // Co-pilot phase 6 (Tasks 3 and 5): the CBS schema now names
    // addEraShading and addGoalLine too. Each one's `data-command-kind`
    // sits on its form's SAVE button, not on the trigger — the same gating
    // the phase-1 assertion above handles by opening both forms — so they
    // are opened here as well, rather than exempting the two kinds (which
    // would hollow out the very contract this test exists to hold).
    fireEvent.click(await screen.findByRole('button', { name: 'Doellijn toevoegen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Periode markeren' }));

    const found = kindsInDom(document.body);
    const cbsKinds = cbsViewCommandSchema.options.map((option) => option.shape.kind.value as string);
    // addNote's control only exists once a point has been clicked (same
    // NOTE_KINDS carve-out the phase-1 assertion above makes) — asserted
    // separately, over the notes editor itself, further down.
    const missing = cbsKinds.filter((k) => !found.has(k) && !NOTE_KINDS.includes(k as ChartCommandKind));
    expect(missing, `CBS co-pilot command kinds with no control: ${missing.join(', ')}`).toEqual([]);
  });

  // Phase 5 (chart-fit scorer, session 116, Task 5): the same §6 contract one
  // level down, at the VALUE of `setForm`. The kind-level scan above only
  // proves "some setForm control exists"; this pins that every form the CBS
  // schema can emit is its own real tab on this card, that the tabs enabled
  // right now are exactly the scorer's `allowedForms` (the one list both the
  // tab strip and `cbsCapabilities` read — so the chat is never told about a
  // shape the reader could not click), and that every disabled tab explains
  // itself. Read straight off the schema, never a hand-copied form list.
  it('every form the CBS co-pilot schema can emit is a real tab, enabled exactly when the scorer offers it', () => {
    const setFormOption = cbsViewCommandSchema.options.find((option) => option.shape.kind.value === 'setForm');
    expect(setFormOption).toBeDefined();
    // The union member's `form` enum — read through the shape, since the
    // union type does not expose the one member's own field.
    const formSchema = (setFormOption!.shape as { form?: { options: readonly string[] } }).form;
    expect(formSchema).toBeDefined();
    const chatForms = [...formSchema!.options] as ChartForm[];
    // The tab labels, per form, from the same message keys chart.tsx renders
    // (chart-history-menu.tsx's `formLabel` keeps the identical map).
    const tabLabel: Record<ChartForm, string> = {
      line: t('nl', 'chart.tabLine'),
      bar: t('nl', 'chart.tabBar'),
      table: t('nl', 'chart.tabTable'),
      area: t('nl', 'chart.form.area'),
      hbar: t('nl', 'chart.form.hbar'),
      dumbbell: t('nl', 'chart.form.dumbbell'),
      slope: t('nl', 'chart.form.slope'),
      heatmap: t('nl', 'chart.form.heatmap'),
      // Phase 5b (verified-whole): the three roster-only forms — their tabs
      // landed with Task 4; the shapes below and the provenance test further
      // down (Task 5) exercise them.
      pie: t('nl', 'chart.form.pie'),
      stacked: t('nl', 'chart.form.stacked'),
      stacked100: t('nl', 'chart.form.stacked100'),
    };
    // The chat vocabulary IS the panel vocabulary: no form the schema can
    // emit without a tab, and no tab the schema cannot name.
    expect([...chatForms].sort()).toEqual((Object.keys(tabLabel) as ChartForm[]).sort());

    // Three shapes: one that qualifies for all three phase-5 forms
    // (twoSeriesLineSpec: 2 series × 2 shared periods, every value real),
    // one that qualifies for none (its first series alone), and — phase 5b
    // — a region-class roster that qualifies for the three verified-whole
    // forms (with `embed.auditId` given, so the card has a saved answer to
    // check the whole against; no verdict has come back yet, and a pending
    // verdict leaves the tab enabled — the canvas, not the tab, shows the
    // checking state).
    const qualifying = twoSeriesLineSpec();
    const single: ChartSpec = { ...qualifying, series: [qualifying.series[0]!] };
    const roster = provinciesRosterSpec();
    for (const spec of [qualifying, single, roster]) {
      const { container, unmount } = render(<ChartView spec={spec} embed={{ auditId: 1 }} />);
      const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"][data-command-kind="setForm"]')];
      const byForm = new Map<ChartForm, HTMLButtonElement>();
      for (const form of chatForms) {
        const tab = tabs.find((el) => el.textContent === tabLabel[form]);
        expect(tab, `no setForm tab for "${form}" (label "${tabLabel[form]}")`).toBeDefined();
        byForm.set(form, tab!);
      }
      const enabled = chatForms.filter((form) => !byForm.get(form)!.disabled).sort();
      expect(enabled).toEqual([...allowedForms(spec, spec.series.length)].sort());
      // A disabled tab's reason is reachable: `title` for the pointer and a
      // non-empty `aria-describedby` target for a screen reader.
      for (const form of chatForms) {
        const tab = byForm.get(form)!;
        if (!tab.disabled) continue;
        expect(tab.getAttribute('title'), `${form} title`).toBeTruthy();
        const reason = container.querySelector(`#${CSS.escape(tab.getAttribute('aria-describedby') ?? '')}`);
        expect(reason?.textContent, `${form} aria-describedby`).toBe(tab.getAttribute('title'));
      }
      unmount();
    }
    // The three phase-5 forms, named: on the qualifying shape they are all
    // offered, on the single-series shape none is.
    for (const form of ['dumbbell', 'slope', 'heatmap'] as const) {
      expect(allowedForms(qualifying, 2), form).toContain(form);
      expect(allowedForms(single, 1), form).not.toContain(form);
    }
    // The three phase-5b forms, named: offered on the roster, on neither of
    // the hand-picked shapes.
    for (const form of ['pie', 'stacked', 'stacked100'] as const) {
      expect(allowedForms(roster, roster.series.length), form).toContain(form);
      expect(allowedForms(qualifying, 2), form).not.toContain(form);
      expect(allowedForms(single, 1), form).not.toContain(form);
    }
  });

  // Phase 5b (verified-whole, Task 5, spec §11): the same contract at the
  // TAB, for provenance. chart-fit.test.ts proves the guard reads
  // `regionScope` and not the code list; this proves the card does what the
  // guard says — the SAME twelve province codes, one point each, render the
  // three tabs enabled with a real `regionScope` and disabled, each with its
  // reason reachable, with `regionScope: null` (a hand-picked or
  // LLM-assembled selection that merely happens to name every province is
  // still no whole: only `resolveRegionSet` vouches for a roster).
  it('pie/stacked/stacked100 tabs follow the regionScope provenance, never the code list', () => {
    const roster = provinciesRosterSpec();
    const sameCodesNoScope: ChartSpec = { ...roster, regionScope: null };
    const forms = [
      ['pie', t('nl', 'chart.form.pie'), t('nl', 'chart.pieDisabledReason')],
      ['stacked', t('nl', 'chart.form.stacked'), t('nl', 'chart.stackedDisabledReason')],
      ['stacked100', t('nl', 'chart.form.stacked100'), t('nl', 'chart.stacked100DisabledReason')],
    ] as const;
    const tabFor = (container: HTMLElement, label: string) => {
      const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"][data-command-kind="setForm"]')].find(
        (el) => el.textContent === label,
      );
      expect(tab, `no setForm tab "${label}"`).toBeDefined();
      return tab!;
    };

    const withScope = render(<ChartView spec={roster} embed={{ auditId: 1 }} />);
    for (const [form, label] of forms) {
      expect(tabFor(withScope.container, label).disabled, `${form} enabled on the roster`).toBe(false);
    }
    withScope.unmount();

    const withoutScope = render(<ChartView spec={sameCodesNoScope} embed={{ auditId: 1 }} />);
    for (const [form, label, reason] of forms) {
      const tab = tabFor(withoutScope.container, label);
      expect(tab.disabled, `${form} disabled without provenance`).toBe(true);
      expect(tab.getAttribute('title'), `${form} title`).toBe(reason);
      const described = withoutScope.container.querySelector(`#${CSS.escape(tab.getAttribute('aria-describedby') ?? '')}`);
      expect(described?.textContent, `${form} aria-describedby`).toBe(reason);
    }
    withoutScope.unmount();
  });

  // Task 5: the reader's own title and caption edit IN PLACE on the card —
  // no panel to open, so a plain non-embed render already carries both
  // controls (the pencil next to the heading and the "add a caption" button).
  it('setTitle and setCaption have in-place controls', () => {
    const { container } = render(<ChartView spec={twoSeriesLineSpec()} />);
    const found = kindsInDom(container);
    expect(found.has('setTitle')).toBe(true);
    expect(found.has('setCaption')).toBe(true);
  });

  it('addNote/removeNote controls exist in the notes editor', async () => {
    const { ChartNotes } = await import('./chart-notes.tsx');
    const { container } = render(
      <ChartNotes
        notes={[{ id: 'n1', resultId: 'nl-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'x' }]}
        pendingPoint={{ resultId: 'nl-2020', periodLabel: '2020', seriesLabel: 'Nederland' }}
        idPrefix="t"
        onSave={() => {}}
        onCancelPending={() => {}}
        onDelete={() => {}}
        headlineOverrideResultId={null}
        onSetHeadline={() => {}}
        onClearHeadline={() => {}}
      />,
    );
    const found = kindsInDom(container);
    expect(found.has('addNote')).toBe(true);
    expect(found.has('removeNote')).toBe(true);
  });

  // Final-review findings I10/I11: `addNote`/`removeNote` above are the only
  // NOTE_KINDS members with a compensating test of their own — the other
  // four kinds this session added to that same exemption list
  // (`setHeadlineOverride`, `removeGoalLine`, `removeEraShading`,
  // `removeDerivedOverlay`) got none, despite being just as absent from the
  // phase-1 scan (NOTE_KINDS excludes them from the "missing" check the same
  // way it excludes addNote/removeNote). Each test below renders the
  // component that actually owns the control and asserts its
  // `data-command-kind` is reachable, mirroring the addNote/removeNote test
  // immediately above.
  it('setHeadlineOverride control exists in the notes editor once a point is pending', async () => {
    const { ChartNotes } = await import('./chart-notes.tsx');
    const { container } = render(
      <ChartNotes
        notes={[]}
        pendingPoint={{ resultId: 'nl-2020', periodLabel: '2020', seriesLabel: 'Nederland' }}
        idPrefix="t"
        onSave={() => {}}
        onCancelPending={() => {}}
        onDelete={() => {}}
        headlineOverrideResultId={null}
        onSetHeadline={() => {}}
        onClearHeadline={() => {}}
      />,
    );
    expect(kindsInDom(container).has('setHeadlineOverride')).toBe(true);
  });

  it('removeGoalLine control exists once a goal line has been saved', () => {
    const { container } = render(
      <ChartGoalLine
        goalLines={[{ id: 'g1', value: 100, label: 'Doel 2026' }]}
        idPrefix="t"
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(kindsInDom(container).has('removeGoalLine')).toBe(true);
  });

  it('removeEraShading control exists once an era shading has been saved', () => {
    const { container } = render(
      <ChartEraShading
        eraShadings={[{ id: 'e1', fromPeriodCode: '2020', toPeriodCode: '2021', label: 'Testperiode' }]}
        periodOptions={[{ code: '2020', label: '2020' }, { code: '2021', label: '2021' }]}
        idPrefix="t"
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(kindsInDom(container).has('removeEraShading')).toBe(true);
  });

  it('removeDerivedOverlay control exists once a derived overlay has been added', async () => {
    render(<ChartView spec={twoSeriesLineSpec()} embed={{ auditId: 1 }} />);
    // Same single-visible-series gate the I8 final-review fix added to the
    // "Gemiddelde tonen" control: hide one of the two series first.
    fireEvent.click(screen.getByRole('button', { name: 'Utrecht' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Gemiddelde tonen' }));
    // `addDerivedOverlay`'s recipe lands in state.derivedOverlayRequests
    // synchronously (the reducer never awaits the async resolution), so the
    // remove chip is reachable immediately, with no need to wait on
    // requestChartDerivation.
    expect(kindsInDom(document.body).has('removeDerivedOverlay')).toBe(true);
  });
});

// --- the own-data card (co-pilot phase 2, session 113, Task 6) -------------
// The SAME contract over the other card: with the Style and Data panels open,
// every command kind an own-data chat doorway (Task 8) could emit already has
// an on-screen control. Two kinds are CBS-only and are asserted to be
// *impossible* here rather than merely absent.
const CBS_ONLY_KINDS: ChartCommandKind[] = ['setPeriodRange', 'setReading'];

const USER_PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Jaar', type: 'year', distinct: ['2023', '2024'], min: 2023, max: 2024, nulls: 0 },
    { id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', min: 0, max: 100, nulls: 0 },
  ],
  rowCount: 2,
};

const USER_INSTRUCTION: ClientChartInstruction = {
  version: 2,
  kind: 'line',
  x: 'c0',
  y: ['c1'],
  seriesBy: null,
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
};

function userEdit(): UserChartEditContext {
  return { datasetId: 3, threadId: 42, turnId: 7, profile: USER_PROFILE, lastInstruction: USER_INSTRUCTION };
}

/** Two series, two points each — the legend (toggleSeries/setHighlight/
 * setSeriesView) only mounts above one series. */
function twoSeriesUserSpec(): UserChartSpec {
  const point = (rowRef: string, xKey: string, value: number, formattedValue: string) => ({
    rowRef,
    xKey,
    xLabel: xKey,
    value,
    formattedValue,
    sourceText: formattedValue,
  });
  return {
    schemaVersion: 1,
    origin: 'user_dataset',
    trust: 'unverified',
    kind: 'line',
    xHeader: 'Jaar',
    yHeaders: ['Omzet'],
    series: [
      { label: 'Amsterdam', points: [point('r1:c1', '2023', 40, '40,0'), point('r2:c1', '2024', 42, '42,0')] },
      { label: 'Rotterdam', points: [point('r1:c2', '2023', 20, '20,0'), point('r2:c2', '2024', 24, '24,0')] },
    ],
    provenance: {
      datasetId: 7,
      sourceKind: 'file_csv',
      displayName: 'omzet.csv',
      sourceUrlHost: null,
      capturedAt: '2026-09-18T12:00:00.000Z',
      contentSha256: 'deadbeef',
    },
    disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
  };
}

describe('own-data card — the same command ↔ control contract (Task 6)', () => {
  it('every command kind except the CBS-only ones is reachable from an on-screen control', async () => {
    render(<UserChartView spec={twoSeriesUserSpec()} edit={userEdit()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    await screen.findByRole('tab', { name: 'Grafiek' });
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));

    const found = kindsInDom(document.body);
    const missing = CHART_COMMAND_KINDS.filter(
      (k) =>
        !found.has(k) &&
        !CBS_ONLY_KINDS.includes(k) &&
        !NOTE_KINDS.includes(k) &&
        !DERIVED_OVERLAY_KINDS.includes(k) &&
        !CBS_CARD_ONLY_KINDS.includes(k),
    );
    expect(missing, `command kinds with no control: ${missing.join(', ')}`).toEqual([]);
    // The one kind the CBS card cannot offer at all.
    expect(found.has('setInstruction')).toBe(true);
  });

  // Own-data verified-whole parity (Task 4) — the SAME "compensating test"
  // discipline the I10/I11 finding above established for every NOTE_KINDS
  // exemption: setWholeReference's control (a pie slice / stack segment) is
  // gated behind a whole-form tab, which the generic scan above never
  // switches to. `twoSeriesUserSpec` qualifies for Gestapeld (seriesCount
  // >= 2) though not for Taartdiagram (two periods per series, not one), so
  // this switches to the stack and proves the marker genuinely reaches a
  // real, clickable element there.
  it('setWholeReference control exists on a stack segment once a whole-form tab is showing', () => {
    render(<UserChartView spec={twoSeriesUserSpec()} edit={userEdit()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gestapeld' }));
    expect(kindsInDom(document.body).has('setWholeReference')).toBe(true);
  });

  it('validateCommand refuses the two CBS-only kinds on an own-data context', () => {
    const ctx: CommandContext = {
      spec: {
        kind: 'line',
        series: twoSeriesUserSpec().series.map((s) => ({
          label: s.label,
          regionCode: null,
          points: s.points.map((p) => ({
            resultId: p.rowRef,
            periodCode: p.xKey,
            periodLabel: p.xLabel,
            value: p.value,
            formattedValue: p.formattedValue,
            decimals: 0,
            status: '',
            provisional: false,
            valueAttribute: '',
          })),
        })),
      },
      alternatesCount: 0,
      profile: USER_PROFILE,
    };
    // No alternate readings on own data.
    expect(validateCommand({ kind: 'setReading', index: 0 }, ctx)).toBe(false);
    // `periodCodes()` reads point.periodCode — which is the own-data xKey, so
    // a range of real x keys would otherwise validate. The explicit rule: a
    // non-null range is invalid whenever the context carries a profile (an
    // own-data card has no zoom control to produce one).
    expect(validateCommand({ kind: 'setPeriodRange', range: ['2023', '2024'] }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setPeriodRange', range: null }, ctx)).toBe(true);
    // …and the same non-null range still validates on a CBS context.
    expect(validateCommand({ kind: 'setPeriodRange', range: ['2023', '2024'] }, { ...ctx, profile: undefined })).toBe(true);
  });
});
