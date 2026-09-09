// THROWAWAY (session 91, WP218 answer-card redesign, "Option B — answer
// card"): a fixed answered message rendered through the real <Chat>
// component, purely so the owner can eyeball the Card + CardFooter treatment
// in a browser. No link points here, no i18n route handling. Behind the
// normal session gate (proxy.ts) like every other app/ route — open it while
// signed in.
//
// Named `preview-answer-card`, NOT `__preview-answer` as first drafted: Next's
// App Router treats any `_`-prefixed folder as a private, non-routable
// segment (confirmed live — `npm run build`'s route table silently omitted
// it), so that path would never have resolved. This file (and its own
// separate commit, "chore(preview): throwaway answer-card preview route (to
// be removed)") is meant to be reverted once reviewed. Do not build on top
// of it.
'use client';

import { Chat } from '../../components/chat.tsx';
import type { ChatMessage } from '../../lib/chat-message.ts';

const PREVIEW_MESSAGES: ChatMessage[] = [
  {
    role: 'user',
    kind: null,
    text: 'Wat was de inflatie in 2024?',
    chart: null,
    cost: null,
    citation: null,
    card: null,
    csv: null,
    proof: null,
    answerView: null,
    provisional: false,
    suggestions: [],
    auditId: null,
    webSection: null,
    carrier: null,
  },
  {
    role: 'assistant',
    kind: 'answer',
    text: 'De inflatie in 2024 was 3,3%.',
    chart: null,
    cost: 20,
    citation:
      'De inflatie in 2024 was 3,3%. (CBS StatLine, tabel 86141NED, gesynchroniseerd 3 juli 2026)',
    card: null,
    csv: { filename: 'inflatie-2024.csv', content: 'jaar,waarde\n2024,3.3\n' },
    proof: {
      tableId: '86141NED',
      tableTitle: 'Consumentenprijzen; prijsindex 2015=100',
      tableVersion: 1,
      syncedAt: '2026-07-03',
      license: 'CC BY 4.0',
      reading: 'Inflatie (CPI)',
      periodSemantics: null,
      alternates: [],
      cells: [
        {
          resultId: '86141NED:CPI000000:NL01:2024JJ00',
          measure: 'CPI000000',
          measureTitle: 'Inflatie (CPI)',
          regionLabel: null,
          regionCode: null,
          periodLabel: '2024',
          periodCode: '2024JJ00',
          dims: {},
          dimLabels: {},
          valueText: '3,3%',
          status: 'Voorlopig',
          provisional: true,
          batchId: 7,
        },
      ],
      steps: [
        {
          text: 'Gelezen: 1 cel uit tabel 86141NED: Inflatie (CPI), 2024 → 3,3%.',
          technical: ' [cel-id 86141NED:CPI000000:NL01:2024JJ00]',
        },
      ],
      nullNotice: null,
      marked: false,
    },
    answerView: {
      body: 'De inflatie in 2024 was 3,3%.',
      assumptionLine: null,
      stalenessWarning: 'Let op: deze tabel wordt normaal maandelijks bijgewerkt door CBS.',
      definitionLine: 'Definitie: consumentenprijsindex (CPI), alle bestedingen.',
      alternatesLine: null,
      markingLine: 'bewerking van CBS-gegevens door checkdecijfers.nl',
      attribution:
        'Bron: CBS StatLine, tabel 86141NED — Consumentenprijzen; prijsindex 2015=100. Gegevens gesynchroniseerd op 2026-07-03. Licentie: CC BY 4.0.',
      tableId: '86141NED',
      source: 'cbs',
      syncedAt: '2026-07-03',
    },
    provisional: true,
    suggestions: ['Vergelijk met 2023', 'Toon de hele reeks'],
    auditId: 1,
    webSection: null,
    carrier: null,
  },
];

export default function PreviewAnswerCardPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-lg font-semibold text-foreground">Answer card preview (throwaway)</h1>
      <p className="text-sm text-muted-foreground">
        Fixed messages, no server actions wired — for a visual look at the Card + CardFooter
        answer treatment only.
      </p>
      <Chat initialMessages={PREVIEW_MESSAGES} />
    </main>
  );
}
