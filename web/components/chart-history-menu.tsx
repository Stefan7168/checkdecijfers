// Chart co-pilot phase 1 (session 112, ADR 056), Task 4: the edit-history
// popover. Pure presentation + a pure `describeCommand` — no data values are
// ever rendered, only enum/id strings, so the digit-scan tests stay clean.
'use client';

import { History, MessageSquare, MousePointerClick, SlidersHorizontal } from 'lucide-react';
import type { ChartCommand, ChartCommandSource } from '../lib/chart-commands.ts';
import type { ChartHistory } from '../lib/chart-history.ts';
import type { PresentationKey } from '../lib/chart-presentation.ts';
import { templateById, type ChartTemplate, type ChartTemplateId } from '../lib/chart-templates.ts';
import type { ChartForm } from '../lib/chart-view-state.ts';
import { t, type MessageKey, type Lang } from '../lib/i18n/messages.ts';
import { Button } from './ui/button.tsx';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu.tsx';

// `chart.form.<form>` only exists for the two forms the tablist doesn't
// already label (area, hbar) — for line/bar/table the tablist's own keys
// (chart.tabLine/tabBar/tabTable) are the form word, per the Task 4 brief.
function formLabel(form: ChartForm, lang: Lang): string {
  switch (form) {
    case 'line':
      return t(lang, 'chart.tabLine');
    case 'bar':
      return t(lang, 'chart.tabBar');
    case 'table':
      return t(lang, 'chart.tabTable');
    case 'area':
      return t(lang, 'chart.form.area');
    case 'hbar':
      return t(lang, 'chart.form.hbar');
  }
}

/** Final-review finding M2: a presentation key is an INTERNAL name
 * ('seriesColors'), never something to show a reader. Every key maps to the
 * label of the Style panel row that sets it — the words the reader just
 * clicked — so no new copy (and no new translation) is invented here. All of
 * them are digit-free, which the digit-scan test below relies on. */
const PRESENTATION_KEY_LABEL: Record<PresentationKey, MessageKey> = {
  lineWidth: 'chart.panel.lineWidth',
  markers: 'chart.panel.markers',
  grid: 'chart.panel.grid',
  xLabels: 'chart.panel.xLabels',
  axisLines: 'chart.panel.axisLines',
  valueLabels: 'chart.panel.valueLabels',
  zeroBaseline: 'chart.panel.zeroBaseline',
  areaFill: 'chart.panel.areaFill',
  seriesColors: 'chart.panel.tabColors',
  fontFamily: 'chart.panel.font',
  language: 'chart.panel.languageLabel',
  frameBackground: 'chart.panel.frameBackground',
  framePadding: 'chart.panel.framePadding',
  frameCorners: 'chart.panel.frameCorners',
  frameShadow: 'chart.panel.frameShadow',
  frameInset: 'chart.panel.frameInset',
  frameAspect: 'chart.panel.frameAspect',
};

/** The Sjablonen gallery labels a template by `t(lang, template.nameKey)`;
 * so does the history. `templateById` returns undefined for an id no longer
 * in the set (an old stored log) — fall back to the raw id then. */
function templateName(id: ChartTemplateId, lang: Lang): string {
  const template = templateById(id) as ChartTemplate | undefined;
  return template ? t(lang, template.nameKey) : id;
}

function presentationKeysLabel(patch: object, lang: Lang): string {
  return Object.keys(patch)
    // A key the map doesn't know (an older stored log, a future key) falls
    // back to its own name rather than rendering "undefined".
    .map((key) => {
      const messageKey = PRESENTATION_KEY_LABEL[key as PresentationKey];
      return messageKey ? t(lang, messageKey) : key;
    })
    .join(', ');
}

const SOURCE_ICON: Record<ChartCommandSource, typeof SlidersHorizontal> = {
  panel: SlidersHorizontal,
  canvas: MousePointerClick,
  chat: MessageSquare,
};

function sourceLabel(source: ChartCommandSource, lang: Lang): string {
  switch (source) {
    case 'panel':
      return t(lang, 'chart.history.source.panel');
    case 'canvas':
      return t(lang, 'chart.history.source.canvas');
    case 'chat':
      return t(lang, 'chart.history.source.chat');
  }
}

/** One plain sentence describing a command — never a data value, only enum
 * strings (form/template ids, presentation key names), so it never contains
 * a digit that came from CBS data. */
export function describeCommand(cmd: ChartCommand, lang: Lang): string {
  switch (cmd.kind) {
    case 'setForm':
      return t(lang, 'chart.command.setForm', { form: formLabel(cmd.form, lang) });
    case 'toggleSeries':
      return t(lang, 'chart.command.toggleSeries');
    case 'setSeriesView':
      return t(lang, 'chart.command.setSeriesView');
    case 'setHighlight':
      return cmd.key !== null ? t(lang, 'chart.command.setHighlight') : t(lang, 'chart.command.setHighlightOff');
    case 'setPeriodRange':
      return cmd.range !== null ? t(lang, 'chart.command.setPeriodRange') : t(lang, 'chart.command.setPeriodRangeOff');
    case 'setPresentation':
      return t(lang, 'chart.command.setPresentation', { keys: presentationKeysLabel(cmd.patch, lang) });
    case 'replacePresentation':
      return t(lang, 'chart.command.replacePresentation');
    case 'resetPresentation':
      return t(lang, 'chart.command.resetPresentation');
    case 'applyTemplate':
      // The gallery's own name for that look ("Redactie"), not its id.
      return t(lang, 'chart.command.applyTemplate', { id: templateName(cmd.templateId, lang) });
    case 'setReading':
      return t(lang, 'chart.command.setReading');
    case 'addNote':
      return t(lang, 'chart.command.addNote');
    case 'removeNote':
      return t(lang, 'chart.command.removeNote');
    case 'setTitle':
      return cmd.title !== null ? t(lang, 'chart.command.setTitle') : t(lang, 'chart.command.setTitleOff');
    case 'setCaption':
      return cmd.caption !== null ? t(lang, 'chart.command.setCaption') : t(lang, 'chart.command.setCaptionOff');
    case 'setInstruction':
      // The doorway's own summary — deterministic and digit-free by
      // construction (validateCommand enforces both), so this stays inside
      // the "never a data value" rule above.
      return t(lang, 'chart.command.setInstruction', { summary: cmd.summary });
    case 'setHeadlineOverride':
      return cmd.resultId !== null ? t(lang, 'chart.command.setHeadlineOverride') : t(lang, 'chart.command.clearHeadlineOverride');
    case 'addGoalLine':
      return t(lang, 'chart.command.addGoalLine');
    case 'removeGoalLine':
      return t(lang, 'chart.command.removeGoalLine');
    case 'addEraShading':
      return t(lang, 'chart.command.addEraShading');
    case 'removeEraShading':
      return t(lang, 'chart.command.removeEraShading');
    case 'setDimmed':
      return t(lang, 'chart.command.setDimmed');
    case 'addDerivedOverlay':
      return t(lang, 'chart.command.addDerivedOverlay');
    case 'removeDerivedOverlay':
      return t(lang, 'chart.command.removeDerivedOverlay');
  }
}

export function ChartHistoryMenu(props: {
  history: ChartHistory;
  lang: Lang;
  onUndoTo: (index: number) => void;
  onRedoTo: (index: number) => void;
}) {
  const { history, lang, onUndoTo, onRedoTo } = props;
  const isEmpty = history.past.length === 0 && history.future.length === 0;
  // Newest-first: reverse for display but keep each entry's index in the
  // ORIGINAL `past` array — that's the index onUndoTo expects.
  const pastNewestFirst = history.past.map((entry, i) => ({ entry, i })).reverse();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="ghost" size="sm" aria-label={t(lang, 'chart.history.menu')} title={t(lang, 'chart.history.menu')}>
            <History className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        {isEmpty ? (
          <DropdownMenuItem disabled>{t(lang, 'chart.history.empty')}</DropdownMenuItem>
        ) : (
          <>
            {pastNewestFirst.map(({ entry, i }) => {
              const SourceIcon = SOURCE_ICON[entry.command.source];
              return (
                <DropdownMenuItem key={entry.command.id} onClick={() => onUndoTo(i)}>
                  <SourceIcon className="size-4" aria-hidden="true" />
                  <span className="sr-only">{sourceLabel(entry.command.source, lang)}</span>
                  {describeCommand(entry.command, lang)}
                </DropdownMenuItem>
              );
            })}
            {history.future.map((entry, i) => {
              const SourceIcon = SOURCE_ICON[entry.command.source];
              return (
                <DropdownMenuItem
                  key={entry.command.id}
                  onClick={() => onRedoTo(i)}
                  className="text-muted-foreground"
                >
                  <SourceIcon className="size-4" aria-hidden="true" />
                  <span className="sr-only">{sourceLabel(entry.command.source, lang)}</span>
                  {t(lang, 'chart.history.undone')}: {describeCommand(entry.command, lang)}
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
