# ADR 064 — Rebrand: every reader-visible name is graphmaker.studio

**Status:** accepted (owner, in chat, session 144, 2026-09-29). **Supersedes** the "working name, not the focus, no
copy, no domain wiring" note on [open-questions #7](../open-questions.md) (2026-09-17).

## Context

The product has carried the working name checkdecijfers.nl since the first interview (2026-07-02). The owner bought
graphmaker.studio on 2026-09-17 and recorded it as the rebrand's working name, explicitly not the focus then. On
2026-09-29, reviewing the new share picture — which prints the brand in its corner — the owner said: "we've
rebranded, remember? graphmaker.studio", and chose, in one dialog with three options, to rename everything visible
now (not only the picture; not the domain wiring yet).

Facts checked before acting: the old name appeared in 25 interface strings and 69 code files; graphmaker.studio
resolved nowhere (no A record, no HTTPS answer) — so every link still has to point at `checkdecijfers.vercel.app`.

## Decision

1. **Every string a reader can see says graphmaker.studio**: the wordmark, page titles (`meta.title`, about,
   privacy, werkwijze, gallery, system map), the "about" intro, the footer credit under a reader's own chart, the
   "from the web, not verified by …" header, the embed page title / `siteName` / image alt, the embed backlink text,
   the embed `<iframe>` titles, the share picture's brand line, the derived-data marking ("bewerking van
   CBS-gegevens door graphmaker.studio" / "adaptation of CBS data by graphmaker.studio"), the uploaded-data
   disclaimer, CSV preambles, the attribution suffix baked into PNG/SVG/PDF downloads, `llms.txt`, and the
   subjects of the owner's alert e-mails. File names change from `checkdecijfers-…` to `graphmaker-…`.
2. **Not renamed — infrastructure, each with its own later step:**
   - the repository, folder and every historical document (history is not rewritten);
   - the public address `checkdecijfers.vercel.app` (`NEXT_PUBLIC_APP_URL`) until the domain is wired: a Vercel
     domain step plus DNS at the registrar, with the owner present (and `APP_URL`'s parked default,
     [chart-embed-dialog.tsx](../../web/components/chart-embed-dialog.tsx), keeps its reason until then);
   - mail: the Resend sender domain `mail.checkdecijfers.nl` and the mailbox `hi@checkdecijfers.nl` (a graphmaker
     mailbox and a verified sender domain first);
   - the embed protocol: the `data-checkdecijfers-embed` attribute and the `checkdecijfers:embed-height` message
     type — every embed ever pasted into a third-party page carries them; renaming would silently stop those
     embeds resizing;
   - the internal dev seam `global.__checkdecijfersDb` and the `CDC_*` env names;
   - **the model prompts.** Seven system prompts introduce the model to "checkdecijfers.nl". A prompt byte change
     shifts every recorded fixture's request hash (the benchmark, the co-pilot, the table parser, the translator),
     which is a recording run with real spend — and the model is never asked to write the brand into an answer,
     so a reader never sees it. Renamed at the next planned recording run, not before.

## Alternatives considered

- **Share picture only.** Cheapest, but leaves the site contradicting its own share cards; the owner's words were
  "everywhere".
- **Rename and wire the domain in the same change.** Wiring needs the owner at the registrar and a Vercel domain
  step; the rename is safe on its own because every link is built from `NEXT_PUBLIC_APP_URL`, never from the brand
  string. Kept as the explicit next step.
- **Rename the embed protocol strings too.** Rejected: breaks pasted embeds for no reader-visible gain.

## Consequences

- Tests pin the new strings (79 test lines updated in the same change); CI green is the proof.
- The English/Dutch parity test still holds (no digits in the brand).
- Follow-ups, all tracked on [#7](../open-questions.md): wire the domain; a graphmaker mailbox and Resend domain;
  the Supabase auth custom domain for the Google consent screen; the prompt rename at the next recording run.
- [#353](../open-questions.md): SEO landing pages per data source under the new domain (owner idea, same session).

## Revisit triggers

- The domain is wired: switch `NEXT_PUBLIC_APP_URL`, retire the parked-default comment, redirect the vercel
  address.
- A recording run is planned anyway: rename the prompts in the same run.
