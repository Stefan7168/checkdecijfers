// Breadth step 5, Task 3 — the table lane's deterministic texts: one refusal
// template per TableLaneRefusalReason (Dutch + the English sibling the
// `english: NonAnswerEnglish` path attaches for an English reader) and the
// breakdown/region button question.
//
// Templates only, never an LLM (ADR 015): these messages exist precisely
// because there is no validated number to phrase. No data value ever enters
// them — the only variable parts are the CBS table's own title (or id), a
// dimension's own title, a member count, and on `table_lane_period_missing`
// the readable label of the table's latest PERIOD CODE (a period, never a
// value). A refusal never ends in '?' (docs/05: refusals open no round).
// Informal "je", like every other refusal/clarification template (Ruling R7).
import type { BuiltRefusal } from '../respond/refusals.ts';
import { periodCodeToNl } from '../respond/period-nl.ts';
import { periodCodeToEn } from '../respond/english.ts';
import type { BreakdownQuestion } from '../../query/breakdowns.ts';
import type { TableLaneRefusalReason } from './plan.ts';

export interface TableLaneTemplateContext {
  tableId: string;
  /** CBS's own table title; null/blank ⇒ the table id names the table. */
  tableTitle: string | null;
  /** table_lane_period_missing only: the table's latest period code. */
  latestPeriodCode?: string;
  /** Owner-readable diagnostic (never rendered): the plan's detail. */
  detail: string;
}

interface Texts {
  nl: string;
  en: string;
}

function tableName(ctx: TableLaneTemplateContext): string {
  const title = ctx.tableTitle?.trim() ?? '';
  return title.length > 0 ? `"${title}"` : ctx.tableId;
}

function texts(reason: TableLaneRefusalReason, ctx: TableLaneTemplateContext): Texts {
  const t = tableName(ctx);
  switch (reason) {
    case 'table_lane_ineligible':
      return {
        nl: `Ik kan CBS-tabel ${t} niet gebruiken om deze vraag te beantwoorden.`,
        en: `I can't use CBS table ${t} to answer this question.`,
      };
    case 'table_lane_no_measure':
      return {
        nl: `In CBS-tabel ${t} staat geen cijfer dat precies bij deze vraag past.`,
        en: `CBS table ${t} has no figure that matches this question exactly.`,
      };
    case 'table_lane_unsure':
      return {
        nl: `Ik weet niet zeker welk cijfer uit CBS-tabel ${t} je bedoelt. Stel de vraag iets specifieker, bijvoorbeeld met het onderwerp, de groep of de periode.`,
        en: `I'm not sure which figure from CBS table ${t} you mean. Please ask a more specific question, for example naming the topic, the group or the period.`,
      };
    case 'table_lane_period_unsupported':
      return {
        nl: `Dit soort periode kan ik in CBS-tabel ${t} nog niet opzoeken. Noem een jaar, kwartaal of maand, of een reeks jaren.`,
        en: `I can't look up this kind of period in CBS table ${t} yet. Name a year, quarter or month, or a range of years.`,
      };
    case 'table_lane_period_grain':
      return {
        nl: `CBS-tabel ${t} heeft geen cijfers per jaar, kwartaal of maand zoals je vraagt. Probeer een andere periode-indeling.`,
        en: `CBS table ${t} has no figures per year, quarter or month the way you ask. Try a different kind of period.`,
      };
    case 'table_lane_period_missing': {
      const latest = ctx.latestPeriodCode;
      return {
        nl:
          `CBS-tabel ${t} heeft geen cijfer voor de gevraagde periode.` +
          (latest !== undefined ? ` De meest recente periode in deze tabel is ${periodCodeToNl(latest)}.` : ''),
        en:
          `CBS table ${t} has no figure for the period you asked about.` +
          (latest !== undefined ? ` The most recent period in this table is ${periodCodeToEn(latest)}.` : ''),
      };
    }
    case 'table_lane_region_class':
      return {
        nl: `Voor een hele groep regio's tegelijk (zoals alle provincies of gemeenten) kan ik uit CBS-tabel ${t} nog geen antwoord geven. Noem de plaats of regio die je bedoelt.`,
        en: `I can't yet answer for a whole group of regions at once (such as all provinces or municipalities) from CBS table ${t}. Name the place or region you mean.`,
      };
    case 'region_unknown':
      return {
        nl: `De plaats of regio die je noemt, staat niet in CBS-tabel ${t}. Controleer de naam of noem een andere plaats.`,
        en: `The place or region you name is not in CBS table ${t}. Check the name or name another place.`,
      };
    case 'region_unavailable':
      return {
        nl: `CBS-tabel ${t} heeft geen cijfers voor de plaats of regio die je noemt.`,
        en: `CBS table ${t} has no figures for the place or region you name.`,
      };
    case 'table_lane_too_large':
      return {
        nl: `Deze vraag vraagt te veel cijfers tegelijk uit CBS-tabel ${t}. Maak de vraag kleiner, bijvoorbeeld met één groep, één regio of minder jaren.`,
        en: `This question asks for too many figures at once from CBS table ${t}. Make the question smaller, for example one group, one region or fewer years.`,
      };
    case 'cbs_unreachable':
      return {
        nl: 'CBS is op dit moment niet bereikbaar, dus ik kan dit cijfer nu niet ophalen. Probeer het later opnieuw.',
        en: "CBS can't be reached right now, so I can't fetch this figure. Please try again later.",
      };
    case 'table_lane_failed':
      return {
        nl: 'Het ophalen van deze CBS-tabel is niet gelukt. Je betaalt hier niets voor.',
        en: "Fetching this CBS table didn't work. You won't be charged for this.",
      };
  }
}

function assertNotAQuestion(text: string): string {
  if (text.trimEnd().endsWith('?')) {
    throw new Error(`internal: table-lane refusal text must not end in '?': ${JSON.stringify(text)}`);
  }
  return text;
}

/** The BuiltRefusal for one table-lane reason — fed to toRefusalResponse, so
 * the envelope assembly (and its present-only `english`) is the shared one. */
export function buildTableLaneRefusal(reason: TableLaneRefusalReason, ctx: TableLaneTemplateContext): BuiltRefusal {
  const { nl, en } = texts(reason, ctx);
  const title = ctx.tableTitle?.trim() ?? '';
  return {
    reason,
    text: assertNotAQuestion(nl),
    offer: null,
    guidance: null,
    freshness: null,
    internalNote: ctx.detail,
    en: {
      text: assertNotAQuestion(en),
      offer: null,
      guidance: null,
      // CBS's own (Dutch) table title stays verbatim inside the English text.
      untranslated: en.includes(`"${title}"`) && title.length > 0 ? [title] : [],
    },
  };
}

/** The button question: "Welke <dimension> bedoel je?" — with the "type
 * another name" hint when the dimension has more members than the buttons
 * show. CBS's own dimension title, verbatim, in both languages. */
export function tableLaneQuestionText(question: BreakdownQuestion): Texts {
  const more = question.totalOptions > question.options.length;
  return {
    nl:
      `Welke ${question.dimensionTitle} bedoel je?` +
      (more ? ` (of typ een andere naam uit de lijst van ${question.totalOptions})` : ''),
    en:
      `Which ${question.dimensionTitle} do you mean?` +
      (more ? ` (or type another name from the list of ${question.totalOptions})` : ''),
  };
}
