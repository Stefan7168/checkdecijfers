# #130 websearch — owner interview sheet (2026-07-12)

Companion to ADR [032](../decisions/032-websearch-augmentation.md) (direction settled there; THESE points are what the ~30-minute interview decides). Each question comes with a recommended default so the owner can answer "akkoord" or override per item. Conduct in Dutch; record answers inline and then mark ADR 032 Accepted.

**Cost fact to state up front (verified 2026-07-12):** native web_search costs $10 per 1.000 zoekopdrachten (≈ €0,01 per zoekopdracht) + tokens; a web-opted question lands rond **€0,03–€0,08 all-in**. The Brave/Tavily alternative saves at most half a euro-cent per search but adds an owned pipeline — native is the "voordeligst" answer once engineering time counts.

---

**Q1 — Section header copy.** Recommended: **"Van het web (niet door checkdecijfers geverifieerd)"** (the phrasing already recorded in #130). Alternative shorter: "Van het web — niet geverifieerd".
> Antwoord: _

**Q2 — Pricing in credits.** The web add-on is opt-in via the #129 chip. Cost basis ≈ €0,03–€0,08 per question. Recommended: **+10 credits** on top of the normal question price when the web chip is selected (simple, covers cost with margin, same order as a normal question). Alternatives: free during pilot (owner is only user — real pricing decided at launch), or +25.
> Antwoord: _

**Q3 — Section shape.** Recommended: **max ~4 short findings, each one sentence + source link (domain name shown), in a visually distinct bordered block below the validated answer; no numbers in bold, no charts, never above the CBS body.** Sub-question: show favicon/domain only, or full URL?
> Antwoord: _

**Q4 — Web-only questions.** If the user deselects CBS and selects only web: does the product answer with ONLY the unverified-web section (validated body absent, no public claim applies), or refuse? Recommended: **allow it in v1** — the section's own disclaimer carries the honesty; refusing would make the chip feel broken. (All sources deselected → refusal, already decided in #129.)
> Antwoord: _

**Q5 — When CBS refuses but web is selected.** Recommended: **the refusal text stays exactly as today, and the web section may still appear below it** (the user paid for web; the refusal machinery is untouched).
> Antwoord: _

**Q6 — Failure behavior + refund.** The web call is fail-soft (CBS answer always ships). If the web part errors: recommended — **show a one-line honest note ("De webzoekopdracht is niet gelukt — geen extra kosten") and refund the web add-on credits automatically** via the existing compensation mechanism. Alternative: silently absent + refund.
> Antwoord: _

**Q7 — Domain policy.** Recommended: **open web in v1, with `user_location` set to Nederland** for Dutch-relevant results; no allowlist (an allowlist would quietly bias "what the web says"), revisit after real usage. Alternative: blocklist for known-problem domains as incidents occur.
> Antwoord: _

**Q8 — #129 chip label.** The web source chip next to the "CBS data" chip. Recommended: **"Internet"** (plain Dutch, self-explaining). Alternatives: "Websearch", "Het web".
> Antwoord: _

**Q9 — Search cap.** Recommended: **max_uses: 3** per question (bounds cost at ~€0,03 search fees; 1–3 searches covers factual questions per Anthropic's guidance). Not really an owner call — confirm or delegate.
> Antwoord: _

**Q10 — Build sequencing.** #129 (source chips) and #130 (web search) are owner-confirmed to build TOGETHER (a lone CBS chip adds choice-noise). Recommended: one WP, chips UI first (structural source filter), web channel second, in the same branch/PR per #118. Confirm.
> Antwoord: _

---

After the interview: fill the answers in, flip ADR 032 to Accepted with an "owner interview" note, update open-questions #130, and write the frozen executor brief (WP27 pattern: pre-build adversarial review before the build).
