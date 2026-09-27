// #296 part 2 Task 7: "Download als CSV" for a two-measure scatter answer —
// one row per plotted region with BOTH axes, in the SAME file dialect as the
// one-measure export (csv.ts: ';' separator, decimal comma, no thousands
// grouping, UTF-8 BOM, CRLF), so a journalist's Excel opens both the same way.
//
// Honesty rules, structural (the csv.ts ones, applied to two legs):
// - R1: every number is a plotted point's own `x`/`y` (the SAME value the dot
//   sits on and its `xFormatted`/`yFormatted` display), serialized by csv.ts's
//   `csvCellNumberNl` — lossless, never re-rounded; each row carries both
//   cell ids so a value traces to its CBS cell.
// - R4: both axes' attribution sentences, verbatim from the spec (one when
//   the two are identical), head the file.
// - R11 / principle (c): a provisional point is marked `*` in its own column
//   (the spec's own provisional note in the preamble says what `*` means),
//   and every left-out region is listed in a "Niet getoond" block with each
//   side's reason — the SAME reason wording the coverage line names
//   (`sideReason`, src/chart/scatter-text.ts) — so nothing is dropped
//   silently. The coverage line itself (scatterLineNl) sits in the preamble.
// - Language: buildAnswerCsv's handling — the provenance preamble and all
//   CBS data (measure titles, units, region names) stay as stored; only this
//   module's OWN fixed column names, the block title and the reasons (our
//   own words, not CBS data) are English for an English reader.
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import type { ScatterAxis, ScatterSpec } from '../backend/chart/scatter.ts';
import { scatterLineNl, sideReason } from '../backend/chart/scatter-text.ts';
import type { AnswerCsv } from './csv.ts';
import { BOM, buildAnswerCsv, CRLF, csvCellNumberNl, csvRow } from './csv.ts';
import type { Lang } from './i18n/messages.ts';
import { scatterCardText } from './scatter-card.ts';
import { sideReasonEn } from './scatter-text-en.ts';

const HEADER_EN: Readonly<Record<string, string>> = {
  regio: 'region',
  regiocode: 'region code',
  voorlopig: 'provisional',
  'cel-id verticale as': 'cell ID vertical axis',
  'cel-id horizontale as': 'cell ID horizontal axis',
  'reden verticale as': 'reason vertical axis',
  'reden horizontale as': 'reason horizontal axis',
  'Niet getoond': 'Not shown',
};

function fixed(lang: Lang, field: string): string {
  return lang === 'en' ? (HEADER_EN[field] ?? field) : field;
}

/** An axis's column header: the CBS measure title plus its unit, as stored. */
function axisHeader(axis: ScatterAxis): string {
  return axis.unit.trim() === '' ? axis.measureTitle : `${axis.measureTitle} (${axis.unit})`;
}

/** "2024" / "2024 1e kwartaal" → a filename-safe slug. */
function slug(text: string): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

export function buildScatterCsv(
  spec: ScatterSpec,
  lang: Lang = 'nl',
  lines: {
    definitionLine?: string | null;
    pairedDefinitionLine?: string | null;
    stalenessWarning?: string | null;
  } = {},
): AnswerCsv {
  // The Dutch card text is the preamble's source (definitions labelled per
  // axis, staleness one line per table) — the SAME lines the card shows.
  const card = scatterCardText(
    {
      scatter: spec,
      body: '',
      definitionLine: lines.definitionLine,
      pairedDefinitionLine: lines.pairedDefinitionLine,
      stalenessWarning: lines.stalenessWarning,
    },
    'nl',
  );
  const preamble = [
    ...card.attributionLines,
    ...card.definitionLines,
    scatterLineNl(spec),
    ...card.stalenessLines,
    ...(spec.provisionalNote !== null ? [spec.provisionalNote] : []),
    'Bestand aangemaakt door checkdecijfers.nl',
  ].map((line) => csvRow([line]));

  const header = csvRow([
    fixed(lang, 'regio'),
    fixed(lang, 'regiocode'),
    axisHeader(spec.y),
    axisHeader(spec.x),
    fixed(lang, 'voorlopig'),
    fixed(lang, 'cel-id verticale as'),
    fixed(lang, 'cel-id horizontale as'),
  ]);
  const dataRows = spec.points.map((p) =>
    csvRow([
      p.label,
      p.regionCode,
      csvCellNumberNl(p.y, spec.y.decimals),
      csvCellNumberNl(p.x, spec.x.decimals),
      p.provisional ? '*' : '',
      p.yResultId,
      p.xResultId,
    ]),
  );

  const out = [...preamble, '', header, ...dataRows];
  if (spec.leftOut.length > 0) {
    const reason = lang === 'en' ? sideReasonEn : sideReason;
    out.push(
      '',
      csvRow([fixed(lang, 'Niet getoond')]),
      csvRow([
        fixed(lang, 'regio'),
        fixed(lang, 'regiocode'),
        fixed(lang, 'reden verticale as'),
        fixed(lang, 'reden horizontale as'),
      ]),
      ...spec.leftOut.map((item) =>
        csvRow([item.label, item.regionCode, reason(item.y, spec.y) ?? '', reason(item.x, spec.x) ?? '']),
      ),
    );
  }

  const tables = [...new Set([spec.y.tableId, spec.x.tableId])];
  return {
    filename: `checkdecijfers-${tables.join('-')}-${slug(spec.y.periodLabel)}.csv`,
    content: BOM + out.join(CRLF) + CRLF,
  };
}

/** The CSV of any answer: a scatter answer gets the two-axis file above, every
 * other answer buildAnswerCsv's unchanged — the ONE dispatch the live chat
 * turn (chat.tsx) and thread replay (replay-assemble.ts) both call, so the
 * two can never disagree (ADR 033 ⟨A3⟩). */
export function answerCsvFor(response: AnswerResponse, lang: Lang = 'nl'): AnswerCsv {
  const spec = response.scatter ?? null;
  if (spec === null) return buildAnswerCsv(response, lang);
  return buildScatterCsv(spec, lang, {
    definitionLine: response.answer.definitionLine,
    pairedDefinitionLine: response.answer.pairedDefinitionLine ?? null,
    stalenessWarning: response.stalenessWarning,
  });
}
