# Session 45 kickoff (paste-ready)

Durable copy of the next-session kickoff prompt (STATUS.md remains the plan of record;
this is a convenience so the handoff survives a clean 0%-context restart). Written at the
end of session 44 (which spanned 2026-07-13 → 2026-07-16 across a usage-limit interruption).

---

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 44) is leidend; bij twijfel wint STATUS's top-blok. Productie is LIVE en verwerkt echt geld; ik (Stefan, geen developer) ben de enige gebruiker — leg alles uit in gewone taal.

**Stand:** sessie 44 (liep 2026-07-13 → 2026-07-16, onderbroken door een usage-limit) mergede 3 PR's, allemaal live + geverifieerd (gate groen + prod-deploy + HTTP 307): #134(b) te-oude-vraag chip (#41, 07-13), auth/ownership-jacht CLEAN + open-redirect fix #139 (#42, 07-13), en #140 — een **kritiek verzin-getal-gat in de anti-verzin-validator, groot versmald (v3)** (#43, 07-16). `main` is schoon, geen open PR's, docs kloppen met de live-werkelijkheid (stale-sweep + datum-correctie gedaan).

**Belangrijkste context bij #140:** de validator liet vroeger élk verzonnen getal door dat samenviel met welk cijfer dan ook in de data-beschrijvingen (breed gat, was live). v3 sluit dat breed, maar er is een **bekend, begrensd restje (#144)**: een verzonnen getal dat exact gelijk is aan een van de eigen omschrijvings-getallen van datzelfde antwoord (leeftijds-/inkomensklasse, "1 januari") náást datzelfde woord kan nog passeren — deterministisch niet te scheiden van een legitieme echo, dus het vergt een *semantische* controle. Lees docs/decisions/013 §6 (#140 as-built) + docs/lessons-learned (deterministisch-plafond-les) vóór je hieraan raakt.

**Aanbevolen volgende klus (geen owner-beslissing nodig, raakt de kernbelofte):** **#141 (HIGH)** — dezelfde verzin-klasse op de PERIODE-vrijstelling van de validator (een verzonnen getal gelijk aan een jaartal 2010–2025 glipt nog door). Er staat een task-chip klaar (`task_62e59808`) met de ontwerp-waarschuwing: periode-labels hebben geen woord-anker, dus de #140-aanpak transponeert níét 1-op-1 — een *temporele-context*-regel is nodig, en bewijs vals-positieven-vrij door `npm test` (benchmark 14/14 + 6/6 + 0 fabricated moet groen blijven). Daarna #144 (semantische check voor het #140-restje) en #142/#143 (medium). Of kies uit de owner-beslis-stack: #138, WP26 (safelist read-back), #121, #131, WP30c. Of nog een gerichte security/bug-jacht.

**Regels:** volledig verificatieblok vóór elke merge (npm ci via CI + typechecks + alle suites + benchmark 14/14 + 6/6 + 0 fabricated + echte next build); kernproduct/geld-pad-code op eigen branch + PR, mergen alléén op mijn expliciete in-chat-akkoord (#118b); live DDL / echte spend / env-flag-flip alléén in een door mij begeleide stap; bij ontbrekende/dubbelzinnige data: weigeren of mij vragen, nooit gokken (principe c). **Adversariële-review-hygiëne:** sweep `zzdel_*`/`__scratch*`-testbestanden en stop review-workflows vóór je een volledige suite-run vertrouwt.

**Model/kosten:** ik zette in sessie 44 het model op **Fable-5** (Fable lijkt weer beschikbaar — bevestig het huidige tier-beleid; de memory/CLAUDE.md zeiden nog "Fable tijdelijk weg"). Top-tier doet het denk-werk (scoping/brief/synthese/eindreview); fan-out op goedkopere tiers.

**Restpunten (tracked, niet-focus):** #132 route B ~2026-07-19 (forks==0 = T-0 go/no-go), #104/#112 (vergen live-LLM-spend), format.ts NUL (task_e718f60d), /login-header cosmetisch.
