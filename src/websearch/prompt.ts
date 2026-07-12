// WP129+130 (ADR 032 decision 8): the web-search augmentation prompt — the ONE
// place NEW prompt bytes are allowed in this WP. The standing zero-prompt-bytes
// rule (R2) protects the EXISTING validated pipeline; this is a NEW,
// self-contained call, so its prompt does not touch any recorded fixture.
// Dutch, because the findings render in Dutch below the CBS body. The version
// travels inside WebSection.promptVersion — NOT the audit PromptVersions type,
// which stays untouched (that shape is pinned by the audit schema).

export const WEBSEARCH_PROMPT_VERSION = 1;

export const WEBSEARCH_PROMPT = `Je zoekt op het web naar het antwoord op de vraag van de gebruiker.

Regels:
- Geef HOOGSTENS vier bevindingen, elk één korte Nederlandse zin.
- Elke zin vermeldt alleen wat een bron zegt — geen advies, geen speculatie voorbij de bronnen.
- Gebruik bij voorkeur recente, gezaghebbende bronnen.
- Vind je niets relevants, zeg dat dan in één zin, zonder iets te verzinnen.`;
