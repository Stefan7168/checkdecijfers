// The actual system-map content, as a Client Component: a Server Component
// can't hold the language-toggle's useState (and metadata can't be exported
// from a Client Component either — that's why this is split from page.tsx).
// English is the default per owner instruction; Dutch is the second option.
// Persisted per-viewer in localStorage only (never shared, never read by the
// server) — a private convenience, not state that needs to survive anywhere
// else.
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SystemMapDiagram } from '../../components/system-map-diagram.tsx';

type Lang = 'en' | 'nl';
type StatusKind = 'live' | 'frozen' | 'planned';

const STORAGE_KEY = 'systeemoverzicht-lang';

const STATUS_STYLES: Record<StatusKind, string> = {
  live: 'bg-ok/10 text-ok',
  frozen: 'bg-warn-soft text-warn',
  planned: 'bg-paper-sunken text-ink-soft',
};

type JourneyStep = { status: StatusKind; title: string; body: string };
type ServiceRow = { name: string; role: string; detail: string; why: string; cost: string; status: StatusKind };
type AutomationRow = { name: string; schedule: string; purpose: string; status: 'live' | 'frozen' };
type BuiltFrozenItem = { title: string; body: string };

type Content = {
  statusLabels: Record<StatusKind, string>;
  kicker: string;
  title: string;
  tagline: string;
  drawnOn: string;
  intro: string;
  legend: Array<{ kind: StatusKind; description: string }>;
  diagramHeading: string;
  diagramCaption: string;
  journeyHeading: string;
  journeyIntro: string;
  journeySteps: JourneyStep[];
  allowedNeverHeading: string;
  allowedLabel: string;
  neverLabel: string;
  allowedItems: string[];
  neverItems: string[];
  servicesHeading: string;
  servicesIntro: string;
  whyPrefix: string;
  costPrefix: string;
  services: ServiceRow[];
  automationsHeading: string;
  automationHeaders: { task: string; schedule: string; purpose: string; status: string };
  automations: AutomationRow[];
  builtFrozenHeading: string;
  builtFrozenIntro: string;
  builtFrozenItems: BuiltFrozenItem[];
  footerNote: string;
  backLink: string;
};

const DRAWN_ON_DATE = { en: '28 August 2026', nl: '28 augustus 2026' } as const;

const CONTENT: Record<Lang, Content> = {
  en: {
    statusLabels: { live: 'Live', frozen: 'Built, off', planned: 'Planned' },
    kicker: 'Check de Cijfers · System map',
    title: 'System map',
    tagline: 'Chat with official CBS figures — every number traceable to a CBS table.',
    drawnOn: `Drawn from the repo docs on ${DRAWN_ON_DATE.en}.`,
    intro:
      'This page maps the whole system: the building blocks, every external service, how one question travels through the machine from arriving to being answered, and what is honestly live, built-but-off, or only planned. The colors below mean the same thing everywhere on this page — that is the one promise this page makes: if something is marked green, it is genuinely running today, not a plan or a wish.',
    legend: [
      { kind: 'live', description: 'Really running in production today.' },
      { kind: 'frozen', description: 'The code exists, but is deliberately switched off behind a flag.' },
      { kind: 'planned', description: 'Decided, not built yet.' },
    ],
    diagramHeading: 'The big picture',
    diagramCaption:
      "Every box is a real, separate piece of technology. Every arrow is something that genuinely happens today — except the dashed one, which shows that fetching from CBS is a separate process, never something that happens while a visitor is waiting for an answer.",
    journeyHeading: 'The journey of one question',
    journeyIntro:
      "Without an account: 2 free questions. After that, or to keep asking, a free account (the same rule applies to everyone, paying or not: searching costs nothing, only an answered question costs credits — a refused answer is refunded).",
    journeySteps: [
      {
        status: 'live',
        title: 'Recognizing the question',
        body: 'Claude reads the Dutch question and turns it into a structured request (which figure, which period, which place) — captured in a schema, never free text that gets trusted further down the line.',
      },
      {
        status: 'live',
        title: 'Not loaded yet? Fetch it from CBS first',
        body: 'If the question is about a table not yet in our database, it is automatically fetched and checked at CBS StatLine first. The visitor immediately sees "we\'re looking this up for you" and gets an email once it\'s ready — never a silent, dragging wait.',
      },
      {
        status: 'live',
        title: 'Looking up, not calculating',
        body: 'The actual answer comes from a fixed, deterministic query against our own database — the same question always produces the same answer. Claude only sees this result AFTER it has already been looked up; the number itself never comes from a language model.',
      },
      {
        status: 'live',
        title: "Checking: does it exist, is the period and the unit right",
        body: "Before anything is answered, the code checks whether the requested figure genuinely exists, whether the period isn't outdated, and whether units are correct. If anything is missing or wrong, an honest refusal or a clarifying question follows — never a shot in the dark.",
      },
      {
        status: 'live',
        title: 'Phrasing the answer',
        body: "Claude writes the surrounding prose around the already-looked-up figure. Every number in that text is checked word-for-word against the looked-up result afterwards — a number that can't be traced back is rejected, and the answer falls back to a fixed template sentence.",
      },
      {
        status: 'live',
        title: 'Final check — may only refuse',
        body: 'One last, separate AI check reads the finished answer once more and may ONLY reject it (never add or change anything) if something still looks fabricated. If this check rejects it, the answer is rewritten, or falls back to the template sentence.',
      },
      {
        status: 'live',
        title: 'Chart, if applicable',
        body: 'Any chart is drawn with ordinary code from that same looked-up figure — no AI, no invented scale.',
      },
      {
        status: 'live',
        title: 'Recording everything',
        body: 'Every answer is stored with its source table, reference date, and license. That record is built so it can be reassembled afterwards, using only the database — so it stays verifiable that what was shown then was actually correct.',
      },
    ],
    allowedNeverHeading: 'What the AI may and may never do',
    allowedLabel: 'MAY',
    neverLabel: 'NEVER',
    allowedItems: [
      'Interpret the question (which figure, which period, which place)',
      'Write the prose around an already-looked-up figure',
      "Look up a table by topic if it isn't loaded yet",
      'Reject an already-written answer if it still looks unreliable',
    ],
    neverItems: [
      'Calculate or round a number itself',
      'Invent a figure, source, period, or unit',
      'Let an outdated figure pass as current',
      'Debit twice, or debit without refunding on a refusal',
    ],
    servicesHeading: 'Every external service',
    servicesIntro:
      "Check de Cijfers isn't one program — it's the website plus a row of external parties, each with exactly one job. Here is every one of them: what it does, why it was chosen, what it costs, and whether it's genuinely switched on today.",
    whyPrefix: 'Why this one: ',
    costPrefix: 'Cost: ',
    services: [
      {
        name: 'Vercel',
        role: 'WEBSITE HOSTING',
        detail: 'Runs the Next.js website and the planned background jobs (cron).',
        why: 'One provider for hosting and scheduling, good Next.js support.',
        cost: 'Free (Hobby)',
        status: 'live',
      },
      {
        name: 'Supabase',
        role: 'DATABASE & LOGIN',
        detail:
          'One managed Postgres database holding all CBS figures, users, credits, and audit records, plus the login system (magic link by email).',
        why: 'One provider instead of stitching together separate database and login services.',
        cost: 'Free tier',
        status: 'live',
      },
      {
        name: 'Anthropic (Claude)',
        role: 'LANGUAGE MODEL',
        detail:
          'Recognizes the question, phrases the answer, and runs the separate final check — every role may only propose or reject, never decide on its own.',
        why: 'Strong Dutch-language processing; every call is schema-validated, so the outcome is always checkable.',
        cost: '€25/month hard cap',
        status: 'live',
      },
      {
        name: 'CBS StatLine',
        role: 'THE OFFICIAL SOURCE',
        detail:
          'All figures come from here. Tables are fetched and checked in advance by a separate process — never live while answering a question.',
        why: 'The only source that matters: Statistics Netherlands (CBS) itself.',
        cost: 'Free, open data',
        status: 'live',
      },
      {
        name: 'Stripe',
        role: 'PAYMENTS',
        detail: 'Buying credits. Test mode only today, card only.',
        why: 'The standard choice for online payments.',
        cost: 'Per transaction, only once real payments go live',
        status: 'frozen',
      },
      {
        name: 'Resend',
        role: 'EMAIL',
        detail: "Sends the login email (magic link) and the notification once a looked-up table is ready.",
        why: "Reliable delivery, separated from the main domain so a mail problem can't affect the rest.",
        cost: 'Free tier',
        status: 'live',
      },
      {
        name: 'Namecheap',
        role: 'DOMAIN',
        detail:
          'Keeps checkdecijfers.nl registered, plus the DNS settings for the email above. Does NOT point at the website itself — that runs on the Vercel address.',
        why: 'Separate domain registration, ready for when the site goes public.',
        cost: 'Annual registration',
        status: 'planned',
      },
    ],
    automationsHeading: 'Scheduled automations',
    automationHeaders: { task: 'Task', schedule: 'Schedule', purpose: 'Purpose', status: 'Status' },
    automations: [
      {
        name: 'Fetch table (onboarding)',
        schedule: 'Right after the question, with a daily backstop at 06:00 UTC',
        purpose: "Fetches and checks a table that wasn't loaded yet.",
        status: 'live',
      },
      {
        name: 'Retention cleanup',
        schedule: 'Monthly (not yet switched on to actually delete)',
        purpose: 'Deletes/anonymizes question history past its retention period.',
        status: 'frozen',
      },
      {
        name: 'Dependabot',
        schedule: 'Weekly',
        purpose: 'Proposes dependency updates as a separate change to review.',
        status: 'live',
      },
    ],
    builtFrozenHeading: 'Built, off',
    builtFrozenIntro: 'These already work, but are deliberately switched off behind a flag until the owner turns them on:',
    builtFrozenItems: [
      {
        title: 'Clicking straight through a clarifying question',
        body: 'Instead of typing, clicking one of the offered choices.',
      },
      {
        title: 'Defaulting to the national figure',
        body: 'If a place or period is missing, giving a reasonable default answer first instead of immediately asking for clarification.',
      },
      {
        title: 'Number-free phrasing',
        body: 'Filling the text around a figure through fixed placeholders instead of free text, so a fabricated number becomes impossible instead of caught after the fact.',
      },
    ],
    footerNote: `Drawn from the repo docs on ${DRAWN_ON_DATE.en}. Something out of date? Check the repo under`,
    backLink: '← Back to Check de Cijfers',
  },
  nl: {
    statusLabels: { live: 'Live', frozen: 'Gebouwd, uit', planned: 'Gepland' },
    kicker: 'Check de Cijfers · Systeemoverzicht',
    title: 'Systeemoverzicht',
    tagline: 'Chat met officiële CBS-cijfers — elk getal herleidbaar tot een CBS-tabel.',
    drawnOn: `Getekend vanuit de repo-docs op ${DRAWN_ON_DATE.nl}.`,
    intro:
      'Deze pagina laat het hele systeem zien: de bouwstenen, elke externe dienst, hoe één vraag door de machine reist van binnenkomst tot antwoord, en wat daarvan écht live is, gebouwd-maar-uit, of nog alleen gepland. De kleuren hieronder betekenen overal op deze pagina hetzelfde — dat is de enige belofte die deze pagina doet: staat iets op groen, dan draait het vandaag echt, niet als plan of als wens.',
    legend: [
      { kind: 'live', description: 'Draait vandaag echt in productie.' },
      { kind: 'frozen', description: 'De code bestaat, maar staat bewust uit achter een vlag.' },
      { kind: 'planned', description: 'Besloten, nog niet gebouwd.' },
    ],
    diagramHeading: 'Het grote plaatje',
    diagramCaption:
      'Elk blok is een echt, apart stukje techniek. Elke pijl is iets dat vandaag ook echt gebeurt — behalve de gestippelde, die laat zien dat het ophalen bij CBS een los proces is, nooit iets dat gebeurt terwijl een bezoeker op een antwoord wacht.',
    journeyHeading: 'De reis van één vraag',
    journeyIntro:
      'Zonder account: 2 gratis vragen. Daarna, of om te blijven vragen, een gratis account (voor wie liever niet betaalt geldt hetzelfde als voor iedereen: zoeken kost niets, alleen een beantwoorde vraag kost credits — een geweigerd antwoord wordt teruggeboekt).',
    journeySteps: [
      {
        status: 'live',
        title: 'Vraag herkennen',
        body: 'Claude leest de Nederlandse vraag en zet die om in een gestructureerd verzoek (welk cijfer, welke periode, welke plek) — vastgelegd in een schema, nooit vrije tekst die verderop wordt vertrouwd.',
      },
      {
        status: 'live',
        title: 'Nog niet geladen? Eerst ophalen bij CBS',
        body: 'Gaat de vraag over een tabel die nog niet in onze database staat, dan wordt die eerst automatisch opgehaald en gecontroleerd bij CBS StatLine. De bezoeker krijgt direct "we zoeken dit voor je uit" te zien en een e-mail zodra het klaar is — nooit een slepende wachttijd zonder bericht.',
      },
      {
        status: 'live',
        title: 'Opzoeken, niet berekenen',
        body: 'Het eigenlijke antwoord komt uit een vaste, deterministische zoekopdracht tegen onze eigen database — dezelfde vraag levert altijd hetzelfde antwoord op. Claude ziet dit resultaat pas NADAT het al is opgezocht; het getal zelf komt nooit uit een taalmodel.',
      },
      {
        status: 'live',
        title: 'Controleren: bestaat het, klopt de periode en de eenheid',
        body: 'Voordat er iets wordt geantwoord, checkt de code of het gevraagde cijfer echt bestaat, of de periode niet verouderd is, en of eenheden kloppen. Ontbreekt of klopt iets niet, dan volgt een eerlijke weigering of een verduidelijkende vraag — nooit een slag in de lucht.',
      },
      {
        status: 'live',
        title: 'Antwoord verwoorden',
        body: 'Claude schrijft de lopende tekst rond het al opgezochte cijfer. Elk getal in die tekst wordt achteraf woord-voor-woord teruggecontroleerd tegen het opgezochte resultaat — een getal dat niet terug te herleiden is, wordt geweigerd en het antwoord valt terug op een vaste sjabloonzin.',
      },
      {
        status: 'live',
        title: 'Eindcontrole — mag alleen weigeren',
        body: 'Een laatste, aparte AI-check leest het kant-en-klare antwoord nog eens over en mag het ALLEEN afkeuren (nooit iets toevoegen of aanpassen) als er toch iets verzonnen aandoet. Wijst deze check iets af, dan wordt het antwoord opnieuw geschreven of valt terug op de sjabloonzin.',
      },
      {
        status: 'live',
        title: 'Grafiek, indien van toepassing',
        body: 'Een eventuele grafiek wordt met gewone code getekend uit hetzelfde opgezochte cijfer — geen AI, geen verzonnen schaalverdeling.',
      },
      {
        status: 'live',
        title: 'Alles vastleggen',
        body: 'Elk antwoord wordt met de brontabel, peildatum en licentie opgeslagen. Die opname is zo gebouwd dat hij achteraf, alleen met de database, opnieuw is samen te stellen — zo blijft controleerbaar dat wat toen is getoond ook echt klopte.',
      },
    ],
    allowedNeverHeading: 'Wat de AI wel en nooit mag',
    allowedLabel: 'MAG',
    neverLabel: 'NOOIT',
    allowedItems: [
      'De vraag interpreteren (welk cijfer, welke periode, welke plek)',
      'De lopende tekst rond een al opgezocht cijfer schrijven',
      'Een tabel opzoeken op onderwerp als die nog niet geladen is',
      'Een reeds geschreven antwoord afkeuren als het toch onbetrouwbaar oogt',
    ],
    neverItems: [
      'Een getal zelf berekenen of afronden',
      'Een cijfer, bron, periode of eenheid verzinnen',
      'Een verouderd cijfer als actueel laten doorgaan',
      'Twee keer afschrijven, of afschrijven zonder terugboeken bij een weigering',
    ],
    servicesHeading: 'Elke externe dienst',
    servicesIntro:
      'Check de Cijfers is niet één programma — het is de website plus een rij externe partijen, elk met precies één taak. Hier staat elke partij, wat die doet, waarom die gekozen is, wat die kost, en of die vandaag echt aanstaat.',
    whyPrefix: 'Waarom deze: ',
    costPrefix: 'Kosten: ',
    services: [
      {
        name: 'Vercel',
        role: 'HOSTING VAN DE WEBSITE',
        detail: 'Draait de Next.js-website en de geplande achtergrondtaken (cron).',
        why: 'Eén partij voor hosting én planning, goede Next.js-ondersteuning.',
        cost: 'Gratis (Hobby)',
        status: 'live',
      },
      {
        name: 'Supabase',
        role: 'DATABASE & INLOGGEN',
        detail:
          'Eén beheerde Postgres-database met alle CBS-cijfers, gebruikers, credits en audit-opnamen, plus het inlogsysteem (magic link via e-mail).',
        why: 'Eén partij in plaats van losse database- en inlogdiensten aan elkaar knopen.',
        cost: 'Gratis tier',
        status: 'live',
      },
      {
        name: 'Anthropic (Claude)',
        role: 'TAALMODEL',
        detail:
          'Herkent de vraag, verwoordt het antwoord, en voert de aparte eindcontrole uit — elke rol mag alleen voorstellen of afkeuren, nooit zelf beslissen.',
        why: 'Sterke Nederlandstalige verwerking; elke aanroep is schema-gevalideerd, dus de uitkomst is altijd te controleren.',
        cost: '€25/maand harde limiet',
        status: 'live',
      },
      {
        name: 'CBS StatLine',
        role: 'DE OFFICIËLE BRON',
        detail:
          'Alle cijfers komen hiervandaan. Tabellen worden vooraf opgehaald en gecontroleerd door een los proces — nooit live tijdens het beantwoorden van een vraag.',
        why: 'De enige bron die telt: het Centraal Bureau voor de Statistiek zelf.',
        cost: 'Gratis, open data',
        status: 'live',
      },
      {
        name: 'Stripe',
        role: 'BETALEN',
        detail: 'Credits kopen. Vandaag alleen in testmodus, alleen met kaart.',
        why: 'De gangbare standaard voor online betalen.',
        cost: 'Per transactie, pas bij echte betalingen',
        status: 'frozen',
      },
      {
        name: 'Resend',
        role: 'E-MAIL',
        detail: 'Verstuurt de inlogmail (magic link) en de melding zodra een opgezochte tabel klaar is.',
        why: 'Betrouwbare bezorging, gescheiden van het hoofddomein zodat een mailprobleem de rest niet raakt.',
        cost: 'Gratis tier',
        status: 'live',
      },
      {
        name: 'Namecheap',
        role: 'DOMEIN',
        detail:
          'Houdt checkdecijfers.nl geregistreerd en de DNS-instellingen voor de e-mail hierboven. Wijst NIET naar de website zelf — die draait op het Vercel-adres.',
        why: 'Losse domeinregistratie, klaar voor wanneer de site publiek gaat.',
        cost: 'Jaarlijkse registratie',
        status: 'planned',
      },
    ],
    automationsHeading: 'Geautomatiseerde taken',
    automationHeaders: { task: 'Taak', schedule: 'Ritme', purpose: 'Doel', status: 'Status' },
    automations: [
      {
        name: 'Tabel ophalen (onboarding)',
        schedule: 'Direct na de vraag, met een dagelijkse achtervang om 06:00 UTC',
        purpose: 'Haalt en controleert een tabel die nog niet geladen was.',
        status: 'live',
      },
      {
        name: 'Bewaartermijn opschonen',
        schedule: 'Maandelijks (nog niet ingeschakeld om echt te verwijderen)',
        purpose: 'Verwijdert/anonimiseert vraaggeschiedenis die de bewaartermijn voorbij is.',
        status: 'frozen',
      },
      {
        name: 'Dependabot',
        schedule: 'Wekelijks',
        purpose: 'Stelt updates voor afhankelijkheden voor als aparte, te beoordelen wijziging.',
        status: 'live',
      },
    ],
    builtFrozenHeading: 'Gebouwd, uit',
    builtFrozenIntro: 'Deze werken al, maar staan bewust uit achter een vlag totdat de eigenaar ze aanzet:',
    builtFrozenItems: [
      {
        title: 'Direct doorklikken op een verduidelijkende vraag',
        body: 'In plaats van te typen, op een van de aangeboden keuzes klikken.',
      },
      {
        title: 'Standaard landelijk antwoorden',
        body: 'Als plek of periode ontbreekt, eerst een redelijk standaardantwoord geven in plaats van meteen te verduidelijken.',
      },
      {
        title: 'Getalvrij verwoorden',
        body: 'De tekst rond een cijfer laten invullen via vaste plekhouders in plaats van vrije tekst, zodat een verzonnen getal onmogelijk wordt in plaats van achteraf betrapt.',
      },
    ],
    footerNote: `Getekend vanuit de repo-docs op ${DRAWN_ON_DATE.nl}. Vragen of iets klopt niet meer? Kijk in de repo onder`,
    backLink: '← Terug naar Check de Cijfers',
  },
};

function StatusPill({ kind, labels }: { kind: StatusKind; labels: Record<StatusKind, string> }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[kind]}`}
    >
      ● {labels[kind]}
    </span>
  );
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (lang: Lang) => void }) {
  const options: Array<{ value: Lang; label: string }> = [
    { value: 'en', label: 'EN' },
    { value: 'nl', label: 'NL' },
  ];
  return (
    <div className="inline-flex shrink-0 items-center rounded-full border border-line-strong p-0.5 text-xs font-semibold">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={lang === opt.value}
          className={`rounded-full px-2.5 py-1 ${
            lang === opt.value ? 'bg-accent text-paper-raised' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SystemMapContent() {
  const [lang, setLang] = useState<Lang>('en');

  // Read the visitor's last choice after mount only — the server (and the
  // first client render, to match it) always renders 'en', so there is no
  // hydration mismatch; this effect just updates state once, afterwards.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'nl') setLang(stored);
    } catch {
      // Private browsing / storage blocked: fall back to the 'en' default.
    }
  }, []);

  // Keep the document's lang attribute honest for assistive tech while this
  // page is toggled to English; restore the site's own Dutch default on
  // unmount so a client-side navigation away doesn't leak the override.
  useEffect(() => {
    const previous = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => {
      document.documentElement.lang = previous;
    };
  }, [lang]);

  function handleChange(next: Lang) {
    setLang(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / storage blocked: the toggle still works for this
      // visit, it just won't be remembered next time.
    }
  }

  const t = CONTENT[lang];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">{t.kicker}</p>
          <LangToggle lang={lang} onChange={handleChange} />
        </div>
        <h1 className="font-display text-3xl text-ink">{t.title}</h1>
        <p className="text-ink-soft">{t.tagline}</p>
        <p className="text-xs text-ink-muted">{t.drawnOn}</p>
        <p className="text-sm leading-relaxed text-ink-soft">{t.intro}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-paper-raised p-4 sm:grid-cols-3">
        {t.legend.map(({ kind, description }) => (
          <div key={kind}>
            <StatusPill kind={kind} labels={t.statusLabels} />
            <p className="mt-1.5 text-xs text-ink-muted">{description}</p>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">{t.diagramHeading}</h2>
        <p className="text-sm text-ink-soft">{t.diagramCaption}</p>
        <div className="overflow-x-auto rounded-lg border border-line bg-paper-raised p-4">
          <SystemMapDiagram lang={lang} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">{t.journeyHeading}</h2>
        <p className="text-sm text-ink-soft">{t.journeyIntro}</p>
        <ol className="flex flex-col gap-3">
          {t.journeySteps.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-lg border border-line bg-paper-raised p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-sm font-semibold tnum text-ink-soft">
                {i + 1}
              </span>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{step.title}</h3>
                  <StatusPill kind={step.status} labels={t.statusLabels} />
                </div>
                <p className="text-sm leading-relaxed text-ink-soft">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">{t.allowedNeverHeading}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-paper-raised p-4">
            <h3 className="text-sm font-semibold text-ok">{t.allowedLabel}</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-soft">
              {t.allowedItems.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-line bg-paper-raised p-4">
            <h3 className="text-sm font-semibold text-danger">{t.neverLabel}</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-soft">
              {t.neverItems.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">{t.servicesHeading}</h2>
        <p className="text-sm text-ink-soft">{t.servicesIntro}</p>
        <div className="flex flex-col gap-3">
          {t.services.map((s) => (
            <div key={s.name} className="rounded-lg border border-line bg-paper-raised p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{s.role}</p>
                  <h3 className="font-semibold text-ink">{s.name}</h3>
                </div>
                <StatusPill kind={s.status} labels={t.statusLabels} />
              </div>
              <p className="mt-2 text-sm text-ink-soft">{s.detail}</p>
              <p className="mt-2 text-xs text-ink-muted">
                {t.whyPrefix}
                {s.why}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {t.costPrefix}
                {s.cost}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">{t.automationsHeading}</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-paper-raised">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5 font-semibold">{t.automationHeaders.task}</th>
                <th className="px-4 py-2.5 font-semibold">{t.automationHeaders.schedule}</th>
                <th className="px-4 py-2.5 font-semibold">{t.automationHeaders.purpose}</th>
                <th className="px-4 py-2.5 font-semibold">{t.automationHeaders.status}</th>
              </tr>
            </thead>
            <tbody>
              {t.automations.map((a) => (
                <tr key={a.name} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{a.schedule}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{a.purpose}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill kind={a.status} labels={t.statusLabels} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">{t.builtFrozenHeading}</h2>
        <p className="text-sm text-ink-soft">{t.builtFrozenIntro}</p>
        <ul className="flex flex-col gap-2 text-sm text-ink-soft">
          {t.builtFrozenItems.map((item) => (
            <li key={item.title} className="rounded-lg border border-line bg-paper-raised p-3">
              <strong className="text-ink">{item.title}</strong> — {item.body}
            </li>
          ))}
        </ul>
      </section>

      {/* A plain div, not <footer> — the global SiteFooter (app/layout.tsx)
        * already renders the page's one <footer> landmark; a second one here
        * would double up on assistive-tech footer navigation. */}
      <div className="border-t border-line pt-4 text-xs text-ink-muted">
        <p>
          {t.footerNote} <code className="rounded bg-paper-sunken px-1 py-0.5">docs/04-architecture.md</code>.
        </p>
        <p className="mt-2">
          <Link href="/" className="text-accent hover:underline">
            {t.backLink}
          </Link>
        </p>
      </div>
    </div>
  );
}
