// The "big picture" system diagram on /systeemoverzicht — hand-drawn inline
// SVG in the stat-card.tsx style (rect/text/line, huisstijl CSS vars via
// currentColor, never raw hex), not a generic diagramming library. Every box
// here is a real, separately-hosted piece of technology; every arrow is
// something that actually happens today (docs/04-architecture.md's System
// shape section, translated from ASCII to a picture). Bilingual: the page's
// own language toggle passes `lang` through so the diagram switches with the
// rest of the content.
const TEXT = {
  en: {
    ariaLabel:
      "Diagram: a visitor asks the Website (Next.js on Vercel) a question. The Website reads and writes to the Database (Supabase/Postgres: CBS figures, users, credits, audit records), calls the Claude API to recognize the question, phrase the answer, and run the final check, and talks to Stripe (payments) and Resend (email). CBS StatLine feeds the Database through a separate, scheduled fetch process — never through the answer path itself.",
    visitor: 'Visitor',
    visitorSub: 'mostly on the phone',
    askLine1: 'asks a question,',
    askLine2: 'gets the answer',
    website: 'Website',
    websiteSub: 'Next.js app on Vercel',
    websiteSub2: 'recognize question · look up · write answer',
    readsWrites: 'reads & writes',
    calls: 'calls',
    payMail: 'pay & email',
    database: 'Database',
    databaseSub: 'Supabase — Postgres',
    databaseLine1: 'CBS figures · users',
    databaseLine2: 'credits · audit records',
    databaseNote: 'never reachable directly from outside',
    claude: 'Claude',
    claudeSub: 'Anthropic API',
    claudeLine1: 'recognize question',
    claudeLine2: 'phrase the answer',
    claudeLine3: 'final check (may only refuse)',
    stripeResend: 'Stripe & Resend',
    stripeResendSub: 'pay · email',
    stripeResendLine1: 'buy credits',
    stripeResendLine2: 'login email · notifications',
    stripeTestOnly: 'Stripe: test mode only',
    feeds: 'feeds, separate process',
    cbs: 'CBS StatLine',
    cbsSub: 'the official source',
    cbsLine1: 'tables are fetched and',
    cbsLine2: 'checked in advance — never live',
    cbsLine3: 'while answering a question',
  },
  nl: {
    ariaLabel:
      'Diagram: een bezoeker stelt een vraag aan de Website (Next.js op Vercel). De Website leest en schrijft in de Database (Supabase/Postgres: CBS-cijfers, gebruikers, credits, audit-opnamen), roept de Claude API aan voor het herkennen van de vraag, het verwoorden van het antwoord en de eindcontrole, en praat met Stripe (betalingen) en Resend (e-mail). CBS StatLine voedt de Database via een los, geplande ophaalproces — niet via het antwoordpad zelf.',
    visitor: 'Bezoeker',
    visitorSub: 'meestal op de telefoon',
    askLine1: 'stelt een vraag,',
    askLine2: 'krijgt het antwoord',
    website: 'Website',
    websiteSub: 'Next.js-app op Vercel',
    websiteSub2: 'vraag herkennen · opzoeken · antwoord schrijven',
    readsWrites: 'leest & schrijft',
    calls: 'roept aan',
    payMail: 'betalen & mailen',
    database: 'Database',
    databaseSub: 'Supabase — Postgres',
    databaseLine1: 'CBS-cijfers · gebruikers',
    databaseLine2: 'credits · audit-opnamen',
    databaseNote: 'nooit rechtstreeks bereikbaar van buitenaf',
    claude: 'Claude',
    claudeSub: 'Anthropic API',
    claudeLine1: 'vraag herkennen',
    claudeLine2: 'antwoord verwoorden',
    claudeLine3: 'eindcontrole (mag alleen weigeren)',
    stripeResend: 'Stripe & Resend',
    stripeResendSub: 'betalen · e-mail',
    stripeResendLine1: 'credits kopen',
    stripeResendLine2: 'inlogmail · meldingen',
    stripeTestOnly: 'Stripe: alleen testmodus',
    feeds: 'voedt, los proces',
    cbs: 'CBS StatLine',
    cbsSub: 'de officiële bron',
    cbsLine1: 'tabellen worden vooraf opgehaald',
    cbsLine2: 'en gecontroleerd — nooit live',
    cbsLine3: 'tijdens het beantwoorden zelf',
  },
} as const;

export function SystemMapDiagram({ lang }: { lang: 'en' | 'nl' }) {
  const t = TEXT[lang];
  return (
    <svg
      viewBox="0 0 760 470"
      role="img"
      aria-label={t.ariaLabel}
      className="block w-full min-w-[640px] text-ink"
    >
      <defs>
        <marker
          id="system-map-arrowhead"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="currentColor" />
        </marker>
      </defs>

      {/* Visitor */}
      <rect x="290" y="10" width="180" height="55" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="380" y="32" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">
        {t.visitor}
      </text>
      <text x="380" y="49" textAnchor="middle" fontSize="11" fill="currentColor">
        {t.visitorSub}
      </text>

      <line x1="380" y1="65" x2="380" y2="94" stroke="currentColor" strokeWidth="2" markerEnd="url(#system-map-arrowhead)" />
      <text x="398" y="83" fontSize="11" fill="currentColor">
        {t.askLine1}
      </text>
      <text x="398" y="95" fontSize="11" fill="currentColor">
        {t.askLine2}
      </text>

      {/* Website */}
      <rect x="250" y="96" width="260" height="76" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="380" y="120" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">
        {t.website}
      </text>
      <text x="380" y="138" textAnchor="middle" fontSize="12" fill="currentColor">
        {t.websiteSub}
      </text>
      <text x="380" y="154" textAnchor="middle" fontSize="11" fill="currentColor">
        {t.websiteSub2}
      </text>

      {/* Website -> Database */}
      <line x1="330" y1="172" x2="180" y2="207" stroke="currentColor" strokeWidth="2" markerEnd="url(#system-map-arrowhead)" />
      <text x="205" y="188" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.readsWrites}
      </text>

      {/* Website -> Claude */}
      <line x1="380" y1="172" x2="380" y2="207" stroke="currentColor" strokeWidth="2" markerEnd="url(#system-map-arrowhead)" />
      <text x="398" y="192" fontSize="10.5" fill="currentColor">
        {t.calls}
      </text>

      {/* Website -> Stripe/Resend */}
      <line x1="440" y1="172" x2="590" y2="207" stroke="currentColor" strokeWidth="2" markerEnd="url(#system-map-arrowhead)" />
      <text x="555" y="188" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.payMail}
      </text>

      {/* Database */}
      <rect x="20" y="210" width="230" height="102" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="135" y="233" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        {t.database}
      </text>
      <text x="135" y="250" textAnchor="middle" fontSize="11" fill="currentColor">
        {t.databaseSub}
      </text>
      <text x="135" y="266" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.databaseLine1}
      </text>
      <text x="135" y="280" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.databaseLine2}
      </text>
      <text x="135" y="298" textAnchor="middle" fontSize="10" fill="currentColor">
        {t.databaseNote}
      </text>

      {/* Claude */}
      <rect x="270" y="210" width="220" height="102" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="380" y="233" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        {t.claude}
      </text>
      <text x="380" y="250" textAnchor="middle" fontSize="11" fill="currentColor">
        {t.claudeSub}
      </text>
      <text x="380" y="266" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.claudeLine1}
      </text>
      <text x="380" y="280" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.claudeLine2}
      </text>
      <text x="380" y="294" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.claudeLine3}
      </text>

      {/* Stripe + Resend */}
      <rect x="515" y="210" width="225" height="102" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="627" y="233" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        {t.stripeResend}
      </text>
      <text x="627" y="250" textAnchor="middle" fontSize="11" fill="currentColor">
        {t.stripeResendSub}
      </text>
      <text x="627" y="266" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.stripeResendLine1}
      </text>
      <text x="627" y="280" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.stripeResendLine2}
      </text>
      <rect x="565" y="288" width="125" height="17" rx="8.5" className="fill-warn-soft" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" />
      <text x="627" y="300" textAnchor="middle" fontSize="9.5" fontWeight="800" className="fill-warn">
        {t.stripeTestOnly}
      </text>

      {/* CBS StatLine -> Database (dashed, out of band) */}
      <line
        x1="135"
        y1="350"
        x2="135"
        y2="316"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="5 4"
        markerEnd="url(#system-map-arrowhead)"
      />
      <text x="153" y="337" fontSize="10.5" fill="currentColor">
        {t.feeds}
      </text>

      {/* CBS StatLine */}
      <rect x="20" y="352" width="230" height="98" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="135" y="375" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        {t.cbs}
      </text>
      <text x="135" y="392" textAnchor="middle" fontSize="11" fill="currentColor">
        {t.cbsSub}
      </text>
      <text x="135" y="408" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.cbsLine1}
      </text>
      <text x="135" y="422" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.cbsLine2}
      </text>
      <text x="135" y="436" textAnchor="middle" fontSize="10.5" fill="currentColor">
        {t.cbsLine3}
      </text>
    </svg>
  );
}
