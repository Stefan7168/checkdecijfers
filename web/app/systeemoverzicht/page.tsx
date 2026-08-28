// The public, noindexed system-map page (bereikbaar via het tandwiel-icoon in
// de footer, net als het equivalent op het andere project van de eigenaar).
// Static content only — no DB reads, no auth gate, safe for an anonymous
// visitor. Every status label below (Live / Gebouwd, uit / Gepland) is a
// hand-written constant, NOT read live from the database or from env vars —
// whoever flips a flag or ships a new external service must update this file
// by hand in the same change, the same convention the sibling project uses
// for its own system map.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SystemMapDiagram } from '../../components/system-map-diagram.tsx';

export const metadata: Metadata = {
  title: 'Systeemoverzicht — Check de Cijfers',
  description: 'Hoe Check de Cijfers is opgebouwd: de onderdelen, elke externe dienst, en de reis van één vraag.',
  // Belt-and-suspenders: the whole site is already blanket-noindexed via
  // web/app/layout.tsx + web/app/robots.ts (Phase 0, pre-launch). This page
  // should stay noindexed even after that global flag is eventually lifted —
  // it's an internal reference page, not a page meant to rank.
  robots: { index: false, follow: false },
};

const DRAWN_ON = '28 augustus 2026';

type StatusKind = 'live' | 'frozen' | 'planned';

const STATUS_STYLES: Record<StatusKind, string> = {
  live: 'bg-ok/10 text-ok',
  frozen: 'bg-warn-soft text-warn',
  planned: 'bg-paper-sunken text-ink-soft',
};

const STATUS_LABELS: Record<StatusKind, string> = {
  live: 'Live',
  frozen: 'Gebouwd, uit',
  planned: 'Gepland',
};

function StatusPill({ kind }: { kind: StatusKind }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[kind]}`}
    >
      ● {STATUS_LABELS[kind]}
    </span>
  );
}

const STATUS_LEGEND: Array<{ kind: StatusKind; description: string }> = [
  { kind: 'live', description: 'Draait vandaag echt in productie.' },
  { kind: 'frozen', description: 'De code bestaat, maar staat bewust uit achter een vlag.' },
  { kind: 'planned', description: 'Besloten, nog niet gebouwd.' },
];

function StatusLegend() {
  return (
    <div className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-paper-raised p-4 sm:grid-cols-3">
      {STATUS_LEGEND.map(({ kind, description }) => (
        <div key={kind}>
          <StatusPill kind={kind} />
          <p className="mt-1.5 text-xs text-ink-muted">{description}</p>
        </div>
      ))}
    </div>
  );
}

const JOURNEY_STEPS: Array<{ status: 'live' | 'frozen' | 'planned'; title: string; body: string }> = [
  {
    status: 'live',
    title: 'Vraag herkennen',
    body:
      'Claude leest de Nederlandse vraag en zet die om in een gestructureerd verzoek (welk cijfer, welke periode, welke plek) — vastgelegd in een schema, nooit vrije tekst die verderop wordt vertrouwd.',
  },
  {
    status: 'live',
    title: 'Nog niet geladen? Eerst ophalen bij CBS',
    body:
      'Gaat de vraag over een tabel die nog niet in onze database staat, dan wordt die eerst automatisch opgehaald en gecontroleerd bij CBS StatLine. De bezoeker krijgt direct "we zoeken dit voor je uit" te zien en een e-mail zodra het klaar is — nooit een slepende wachttijd zonder bericht.',
  },
  {
    status: 'live',
    title: 'Opzoeken, niet berekenen',
    body:
      'Het eigenlijke antwoord komt uit een vaste, deterministische zoekopdracht tegen onze eigen database — dezelfde vraag levert altijd hetzelfde antwoord op. Claude ziet dit resultaat pas NADAT het al is opgezocht; het getal zelf komt nooit uit een taalmodel.',
  },
  {
    status: 'live',
    title: 'Controleren: bestaat het, klopt de periode en de eenheid',
    body:
      'Voordat er iets wordt geantwoord, checkt de code of het gevraagde cijfer echt bestaat, of de periode niet verouderd is, en of eenheden kloppen. Ontbreekt of klopt iets niet, dan volgt een eerlijke weigering of een verduidelijkende vraag — nooit een slag in de lucht.',
  },
  {
    status: 'live',
    title: 'Antwoord verwoorden',
    body:
      'Claude schrijft de lopende tekst rond het al opgezochte cijfer. Elk getal in die tekst wordt achteraf woord-voor-woord teruggecontroleerd tegen het opgezochte resultaat — een getal dat niet terug te herleiden is, wordt geweigerd en het antwoord valt terug op een vaste sjabloonzin.',
  },
  {
    status: 'live',
    title: 'Eindcontrole — mag alleen weigeren',
    body:
      'Een laatste, aparte AI-check leest het kant-en-klare antwoord nog eens over en mag het ALLEEN afkeuren (nooit iets toevoegen of aanpassen) als er toch iets verzonnen aandoet. Wijst deze check iets af, dan wordt het antwoord opnieuw geschreven of valt terug op de sjabloonzin.',
  },
  {
    status: 'live',
    title: 'Grafiek, indien van toepassing',
    body:
      'Een eventuele grafiek wordt met gewone code getekend uit hetzelfde opgezochte cijfer — geen AI, geen verzonnen schaalverdeling.',
  },
  {
    status: 'live',
    title: 'Alles vastleggen',
    body:
      'Elk antwoord wordt met de brontabel, peildatum en licentie opgeslagen. Die opname is zo gebouwd dat hij achteraf, alleen met de database, opnieuw is samen te stellen — zo blijft controleerbaar dat wat toen is getoond ook echt klopte.',
  },
];

const NEVER_ITEMS = [
  'Een getal zelf berekenen of afronden',
  'Een cijfer, bron, periode of eenheid verzinnen',
  'Een verouderd cijfer als actueel laten doorgaan',
  'Twee keer afschrijven, of afschrijven zonder terugboeken bij een weigering',
];

const ALLOWED_ITEMS = [
  'De vraag interpreteren (welk cijfer, welke periode, welke plek)',
  'De lopende tekst rond een al opgezocht cijfer schrijven',
  'Een tabel opzoeken op onderwerp als die nog niet geladen is',
  'Een reeds geschreven antwoord afkeuren als het toch onbetrouwbaar oogt',
];

type ServiceRow = {
  name: string;
  role: string;
  detail: string;
  why: string;
  cost: string;
  status: 'live' | 'frozen' | 'planned';
};

const SERVICES: ServiceRow[] = [
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
    detail:
      'Verstuurt de inlogmail (magic link) en de melding zodra een opgezochte tabel klaar is.',
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
];

type AutomationRow = { name: string; schedule: string; purpose: string; status: 'live' | 'frozen' };

const AUTOMATIONS: AutomationRow[] = [
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
];

export default function SystemMapPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Check de Cijfers · Systeemoverzicht</p>
        <h1 className="font-display text-3xl text-ink">Systeemoverzicht</h1>
        <p className="text-ink-soft">Chat met officiële CBS-cijfers — elk getal herleidbaar tot een CBS-tabel.</p>
        <p className="text-xs text-ink-muted">Getekend vanuit de repo-docs op {DRAWN_ON}.</p>
        <p className="text-sm leading-relaxed text-ink-soft">
          Deze pagina laat het hele systeem zien: de bouwstenen, elke externe dienst, hoe één vraag door de
          machine reist van binnenkomst tot antwoord, en wat daarvan écht live is, gebouwd-maar-uit, of nog
          alleen gepland. De kleuren hieronder betekenen overal op deze pagina hetzelfde — dat is de enige
          belofte die deze pagina doet: staat iets op groen, dan draait het vandaag echt, niet als plan of
          als wens.
        </p>
      </header>

      <StatusLegend />

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">Het grote plaatje</h2>
        <p className="text-sm text-ink-soft">
          Elk blok is een echt, apart stukje techniek. Elke pijl is iets dat vandaag ook echt gebeurt — behalve
          de gestippelde, die laat zien dat het ophalen bij CBS een los proces is, nooit iets dat gebeurt
          terwijl een bezoeker op een antwoord wacht.
        </p>
        <div className="overflow-x-auto rounded-lg border border-line bg-paper-raised p-4">
          <SystemMapDiagram />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">De reis van één vraag</h2>
        <p className="text-sm text-ink-soft">
          Zonder account: 2 gratis vragen. Daarna, of om te blijven vragen, een gratis account (voor wie
          liever niet betaalt geldt hetzelfde als voor iedereen: zoeken kost niets, alleen een beantwoorde
          vraag kost credits — een geweigerd antwoord wordt teruggeboekt).
        </p>
        <ol className="flex flex-col gap-3">
          {JOURNEY_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 rounded-lg border border-line bg-paper-raised p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line-strong text-sm font-semibold tnum text-ink-soft">
                {i + 1}
              </span>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{step.title}</h3>
                  <StatusPill kind={step.status} />
                </div>
                <p className="text-sm leading-relaxed text-ink-soft">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">Wat de AI wel en nooit mag</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-line bg-paper-raised p-4">
            <h3 className="text-sm font-semibold text-ok">MAG</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-soft">
              {ALLOWED_ITEMS.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border border-line bg-paper-raised p-4">
            <h3 className="text-sm font-semibold text-danger">NOOIT</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-ink-soft">
              {NEVER_ITEMS.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">Elke externe dienst</h2>
        <p className="text-sm text-ink-soft">
          Check de Cijfers is niet één programma — het is de website plus een rij externe partijen, elk met
          precies één taak. Hier staat elke partij, wat die doet, waarom die gekozen is, wat die kost, en of
          die vandaag echt aanstaat.
        </p>
        <div className="flex flex-col gap-3">
          {SERVICES.map((s) => (
            <div key={s.name} className="rounded-lg border border-line bg-paper-raised p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{s.role}</p>
                  <h3 className="font-semibold text-ink">{s.name}</h3>
                </div>
                <StatusPill kind={s.status} />
              </div>
              <p className="mt-2 text-sm text-ink-soft">{s.detail}</p>
              <p className="mt-2 text-xs text-ink-muted">Waarom deze: {s.why}</p>
              <p className="mt-1 text-xs text-ink-muted">Kosten: {s.cost}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">Geautomatiseerde taken</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-paper-raised">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5 font-semibold">Taak</th>
                <th className="px-4 py-2.5 font-semibold">Ritme</th>
                <th className="px-4 py-2.5 font-semibold">Doel</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {AUTOMATIONS.map((a) => (
                <tr key={a.name} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{a.name}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{a.schedule}</td>
                  <td className="px-4 py-2.5 text-ink-soft">{a.purpose}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill kind={a.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl text-ink">Gebouwd, uit</h2>
        <p className="text-sm text-ink-soft">
          Deze werken al, maar staan bewust uit achter een vlag totdat de eigenaar ze aanzet:
        </p>
        <ul className="flex flex-col gap-2 text-sm text-ink-soft">
          <li className="rounded-lg border border-line bg-paper-raised p-3">
            <strong className="text-ink">Direct doorklikken op een verduidelijkende vraag</strong> — in
            plaats van te typen, op een van de aangeboden keuzes klikken.
          </li>
          <li className="rounded-lg border border-line bg-paper-raised p-3">
            <strong className="text-ink">Standaard landelijk antwoorden</strong> — als plek of periode
            ontbreekt, eerst een redelijk standaardantwoord geven in plaats van meteen te verduidelijken.
          </li>
          <li className="rounded-lg border border-line bg-paper-raised p-3">
            <strong className="text-ink">Getalvrij verwoorden</strong> — de tekst rond een cijfer laten
            invullen via vaste plekhouders in plaats van vrije tekst, zodat een verzonnen getal
            onmogelijk wordt in plaats van achteraf betrapt.
          </li>
        </ul>
      </section>

      {/* A plain div, not <footer> — the global SiteFooter (app/layout.tsx)
        * already renders the page's one <footer> landmark; a second one here
        * would double up on assistive-tech footer navigation. */}
      <div className="border-t border-line pt-4 text-xs text-ink-muted">
        <p>
          Getekend vanuit de repo-docs op {DRAWN_ON}. Vragen of iets klopt niet meer? Kijk in de repo onder{' '}
          <code className="rounded bg-paper-sunken px-1 py-0.5">docs/04-architecture.md</code>.
        </p>
        <p className="mt-2">
          <Link href="/" className="text-accent hover:underline">
            ← Terug naar Check de Cijfers
          </Link>
        </p>
      </div>
    </div>
  );
}
