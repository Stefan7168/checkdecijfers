// The "big picture" system diagram on /systeemoverzicht — hand-drawn inline
// SVG in the stat-card.tsx style (rect/text/line, huisstijl CSS vars via
// currentColor, never raw hex), not a generic diagramming library. Every box
// here is a real, separately-hosted piece of technology; every arrow is
// something that actually happens today (docs/04-architecture.md's System
// shape section, translated from ASCII to a picture).
export function SystemMapDiagram() {
  return (
    <svg
      viewBox="0 0 760 470"
      role="img"
      aria-label="Diagram: een bezoeker stelt een vraag aan de Website (Next.js op Vercel). De Website leest en schrijft in de Database (Supabase/Postgres: CBS-cijfers, gebruikers, credits, audit-opnamen), roept de Claude API aan voor het herkennen van de vraag, het verwoorden van het antwoord en de eindcontrole, en praat met Stripe (betalingen) en Resend (e-mail). CBS StatLine voedt de Database via een los, geplande ophaalproces — niet via het antwoordpad zelf."
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

      {/* Bezoeker */}
      <rect x="290" y="10" width="180" height="55" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="380" y="32" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">
        Bezoeker
      </text>
      <text x="380" y="49" textAnchor="middle" fontSize="11" fill="currentColor">
        meestal op de telefoon
      </text>

      <line x1="380" y1="65" x2="380" y2="94" stroke="currentColor" strokeWidth="2" markerEnd="url(#system-map-arrowhead)" />
      <text x="398" y="83" fontSize="11" fill="currentColor">
        stelt een vraag,
      </text>
      <text x="398" y="95" fontSize="11" fill="currentColor">
        krijgt het antwoord
      </text>

      {/* Website */}
      <rect x="250" y="96" width="260" height="76" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="380" y="120" textAnchor="middle" fontSize="14" fontWeight="700" fill="currentColor">
        Website
      </text>
      <text x="380" y="138" textAnchor="middle" fontSize="12" fill="currentColor">
        Next.js-app op Vercel
      </text>
      <text x="380" y="154" textAnchor="middle" fontSize="11" fill="currentColor">
        vraag herkennen · opzoeken · antwoord schrijven
      </text>

      {/* Website -> Database */}
      <line x1="330" y1="172" x2="180" y2="207" stroke="currentColor" strokeWidth="2" markerEnd="url(#system-map-arrowhead)" />
      <text x="205" y="188" textAnchor="middle" fontSize="10.5" fill="currentColor">
        leest &amp; schrijft
      </text>

      {/* Website -> Claude */}
      <line x1="380" y1="172" x2="380" y2="207" stroke="currentColor" strokeWidth="2" markerEnd="url(#system-map-arrowhead)" />
      <text x="398" y="192" fontSize="10.5" fill="currentColor">
        roept aan
      </text>

      {/* Website -> Stripe/Resend */}
      <line x1="440" y1="172" x2="590" y2="207" stroke="currentColor" strokeWidth="2" markerEnd="url(#system-map-arrowhead)" />
      <text x="555" y="188" textAnchor="middle" fontSize="10.5" fill="currentColor">
        betalen &amp; mailen
      </text>

      {/* Database */}
      <rect x="20" y="210" width="230" height="102" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="135" y="233" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        Database
      </text>
      <text x="135" y="250" textAnchor="middle" fontSize="11" fill="currentColor">
        Supabase — Postgres
      </text>
      <text x="135" y="266" textAnchor="middle" fontSize="10.5" fill="currentColor">
        CBS-cijfers · gebruikers
      </text>
      <text x="135" y="280" textAnchor="middle" fontSize="10.5" fill="currentColor">
        credits · audit-opnamen
      </text>
      <text x="135" y="298" textAnchor="middle" fontSize="10" fill="currentColor">
        nooit rechtstreeks bereikbaar van buitenaf
      </text>

      {/* Claude */}
      <rect x="270" y="210" width="220" height="102" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="380" y="233" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        Claude
      </text>
      <text x="380" y="250" textAnchor="middle" fontSize="11" fill="currentColor">
        Anthropic API
      </text>
      <text x="380" y="266" textAnchor="middle" fontSize="10.5" fill="currentColor">
        vraag herkennen
      </text>
      <text x="380" y="280" textAnchor="middle" fontSize="10.5" fill="currentColor">
        antwoord verwoorden
      </text>
      <text x="380" y="294" textAnchor="middle" fontSize="10.5" fill="currentColor">
        eindcontrole (mag alleen weigeren)
      </text>

      {/* Stripe + Resend */}
      <rect x="515" y="210" width="225" height="102" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="627" y="233" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        Stripe &amp; Resend
      </text>
      <text x="627" y="250" textAnchor="middle" fontSize="11" fill="currentColor">
        betalen · e-mail
      </text>
      <text x="627" y="266" textAnchor="middle" fontSize="10.5" fill="currentColor">
        credits kopen
      </text>
      <text x="627" y="280" textAnchor="middle" fontSize="10.5" fill="currentColor">
        inlogmail · meldingen
      </text>
      <rect x="565" y="288" width="125" height="17" rx="8.5" className="fill-warn-soft" stroke="currentColor" strokeOpacity="0.4" strokeWidth="1" />
      <text x="627" y="300" textAnchor="middle" fontSize="9.5" fontWeight="800" className="fill-warn">
        Stripe: alleen testmodus
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
        voedt, los proces
      </text>

      {/* CBS StatLine */}
      <rect x="20" y="352" width="230" height="98" rx="10" className="fill-paper-raised" stroke="currentColor" strokeWidth="1.5" />
      <text x="135" y="375" textAnchor="middle" fontSize="13" fontWeight="700" fill="currentColor">
        CBS StatLine
      </text>
      <text x="135" y="392" textAnchor="middle" fontSize="11" fill="currentColor">
        de officiële bron
      </text>
      <text x="135" y="408" textAnchor="middle" fontSize="10.5" fill="currentColor">
        tabellen worden vooraf opgehaald
      </text>
      <text x="135" y="422" textAnchor="middle" fontSize="10.5" fill="currentColor">
        en gecontroleerd — nooit live
      </text>
      <text x="135" y="436" textAnchor="middle" fontSize="10.5" fill="currentColor">
        tijdens het beantwoorden zelf
      </text>
    </svg>
  );
}
