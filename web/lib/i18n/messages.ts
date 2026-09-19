// WP218 phase 4 (#219) — the interface-string catalogue. No i18n library
// (CLAUDE.md "cheapest mechanism first"): a plain object keyed by dotted
// surface names, a tiny `t()` that fills `{name}` placeholders, and a
// `Messages` type derived from the Dutch table so a missing English key is a
// compile error, not a silent runtime gap.
//
// The Dutch entries are today's Dutch strings, verbatim — this keeps every
// existing test that pins Dutch copy passing under the default language
// (docs/superpowers/specs/2026-09-09-language-switch-design.md §3). Each
// task in the WP218 phase-4 build order (see that doc §5) adds its own keys
// here; this file starts with only what Task 1 (core + header) needs.
export type Lang = 'nl' | 'en';
export const LANGS: readonly Lang[] = ['nl', 'en'];

const nl = {
  // The switch's own group label (aria-label), not a visible button caption.
  'lang.switchLabel': 'Taal',

  // site-header.tsx (workspace variant + the account menu inside it).
  'header.credits': 'Credits kopen',
  'header.history': 'Geschiedenis',
  // Owner punch-list item 6 (session 102): the account menu's link to the
  // new /about page — the menu is becoming the general nav hub (items 4/5
  // already added the theme toggle and Geschiedenis to it).
  'header.about': 'Over ons',
  'header.account': 'Account',
  'header.logout': 'Log uit',
  'header.busy': 'Bezig…',
  // Byte-identical to the original JSX `{balance} credits` — "credits" is
  // already the word used in the Dutch UI as-is.
  'header.balance': '{n} credits',

  // Shared across surfaces (dataset-chat.tsx, workspace.tsx) — same literal
  // string, same meaning, so ONE key rather than three near-duplicates.
  'common.sessionExpired': 'Je sessie is verlopen. Vernieuw de pagina.',
  // Session 110 UX audit pass 3, row 7: components/ui/dialog.tsx's generic
  // × close control (shared by every modal that doesn't set its own
  // showCloseButton copy) hardcoded the English word "Close" regardless of
  // language — so in the Dutch UI every modal's last accessible name
  // announced "Close". One shared key (not a chart.*-scoped one like
  // chart.panel.close/chart.embed.close above) because dialog.tsx is the
  // generic shadcn primitive, used by dialogs outside the chart surfaces too.
  'common.close': 'Sluiten',

  // chat.tsx (the CBS chat loop). Task 2 (WP218 phase 4, #219).
  'chat.placeholder': 'Stel een vraag…',
  'chat.send': 'Verstuur',
  // #20 (session 110 UX audit): the composer's near-the-cap character
  // counter (e.g. "412/500") — language-neutral punctuation, kept as its
  // own key (rather than hardcoded in chat.tsx) per this catalogue's own
  // convention that every interface string lives here.
  'chat.composerCounter': '{current}/{max}',
  'chat.copyCitation': 'Kopieer',
  'chat.copyCitationCopied': 'Gekopieerd!',
  'chat.downloadCsv': 'CSV',
  'chat.downloadCsvFailed': 'Downloaden lukte niet in deze browser.',
  'chat.webSectionHeader': 'Van het web (niet door checkdecijfers geverifieerd)',
  'chat.webSectionFailedInsufficientBalance':
    'De webzoekopdracht is niet uitgevoerd (onvoldoende saldo) — geen extra kosten.',
  'chat.webSectionFailedGeneric': 'De webzoekopdracht is niet gelukt — geen extra kosten.',
  'chat.unauthenticated': 'Je bent niet ingelogd. Log in via /login om een vraag te stellen.',
  'chat.duplicateRequest': 'Deze vraag wordt al verwerkt — even geduld.',
  'chat.insufficientCredits': 'Je hebt niet genoeg credits ({balance} over, {required} nodig). Koop credits via /credits.',
  'chat.redactedMessage': 'Deze vraag is verwijderd.',
  'chat.refusalHeader': 'Dit kon ik niet beantwoorden',
  'chat.refusalBadge': 'geen antwoord = geen gok',
  'chat.provisionalBadge': 'voorlopig',
  // Leading space + middle dot, appended directly after `chat.costCredits` —
  // matches the original template literal exactly.
  'chat.replyCostSuffix': ' · antwoorden op de wedervraag kost ~{price} credits',
  'chat.costCredits': '{n} credits',
  // ADR 026 addendum (session 101): the confirm-first offer's own button
  // (#109's reversal, owner decision 4) — a chat.tsx-owned label, unlike the
  // byte-pinned pipeline copy (ONBOARDING_OFFER_TEXT) it sits next to, since
  // it's chrome (a button caption), not the CBS pipeline's own Dutch output.
  'chat.onboardingOfferButton': 'Haal op voor {n} credits',
  'chat.dockedChipChart': 'Grafiek in het paneel →',
  'chat.dockedChipCard': 'Kaart in het paneel →',
  // The owner-mandated busy-text honesty distinction (CBS vs web vs both) —
  // byte-identical to the strings this replaces; see CLAUDE.md/brief.
  'chat.busyBoth': 'Bezig met het doorzoeken van CBS-cijfers en het web…',
  'chat.busyWebOnly': 'Bezig met het doorzoeken van het web…',
  'chat.busyCbsOnly': 'Bezig met het doorzoeken van CBS-cijfers…',
  'chat.staleDeployPrefix':
    'De site is net bijgewerkt, waardoor deze vraag niet is verstuurd (er zijn geen credits afgeschreven).',
  'chat.staleDeployButton': 'Ververs de pagina',
  'chat.staleDeploySuffix': 'en stel je vraag daarna opnieuw.',
  'chat.genericError': 'Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.',
  'chat.nothingSelectedHint': 'Selecteer minstens één bron.',
  'chat.suggestionsHint': 'Suggesties voor een vervolgvraag:',
  // "data" is the same loanword in Dutch, so the value is identical in both
  // languages; still catalogued (every literal string goes through t()).
  'chat.sourceDataSuffix': '{name} data',
  'chat.internetChip': 'Internet',
  'chat.addLink': 'Link toevoegen',
  'chat.uploadFile': 'Bestand uploaden',
  'chat.uploadFileComingSoonTitle': 'Binnenkort beschikbaar: upload een bestand (bijv. PDF)',
  'chat.linkWithSheet': 'Sheet koppelen',
  'chat.linkWithSheetComingSoonTitle': 'Binnenkort beschikbaar: koppel een spreadsheet (bijv. Google Sheets)',
  'chat.connectDatabase': 'Data koppelen',
  'chat.connectDatabaseComingSoonTitle': 'Binnenkort beschikbaar: verbind een databron (bijv. een Postgres-database)',
  // A URL example, not language-dependent prose — same value both languages.
  'chat.linkUrlPlaceholder': 'https://example.com/page-with-a-table',
  'chat.fetchButton': 'Ophalen',
  'chat.linkComingSoonMessage': 'Dit is nog niet beschikbaar — binnenkort wel.',
  'chat.fileReading': 'Bestand wordt gelezen…',
  'chat.fileReadError': 'Er ging iets mis bij het lezen van dat bestand. Probeer het opnieuw.',
  // The pre-send pricing line (WP20 #82; WP129+130 added the Internet
  // variants) — three fixed variants, unchanged wording, now through t().
  'chat.pricingBoth':
    'Een vraag kost ~{total} credits (waarvan {addon} voor internet) · saldo: {balance} credits. Stel ik eerst een verduidelijkingsvraag, dan kost die {clarification} credits en krijg je de rest terug.',
  'chat.pricingWebOnly':
    'Een vraag kost ~{addon} credits (er wordt tijdelijk {reserved} gereserveerd) · saldo: {balance} credits.',
  'chat.pricingDefault':
    'Een vraag kost ~{simple} credits · saldo: {balance} credits. Stel ik eerst een verduidelijkingsvraag, dan kost die {clarification} credits en krijg je de rest terug.',

  // thread-sidebar.tsx.
  'sidebar.collapsedExpandLabel': 'Toon gesprekken',
  'sidebar.collapseLabel': 'Verberg gesprekken',
  'sidebar.navLabel': 'Gesprekken',
  'sidebar.header': 'Chats',
  'sidebar.newChat': 'Nieuwe chat',
  'sidebar.searchPlaceholder': 'Zoek in chats',
  'sidebar.searchLabel': 'Zoek in chats',
  'sidebar.empty': 'Nog geen gesprekken.',
  'sidebar.noMatches': 'Geen chats gevonden voor “{query}”.',
  'sidebar.datasetThreadTitle': 'Jouw data: {title}',
  'sidebar.optionsLabel': 'Chatopties',
  'sidebar.deleteChat': 'Chat verwijderen',
  'sidebar.deleteConfirmLabel': 'Chat verwijderen?',
  'sidebar.deleteConfirmText':
    'Chat verwijderen? Je vragen verdwijnen dan ook uit je geschiedenis. Dit kan niet ongedaan worden gemaakt.',
  'sidebar.deleteButton': 'Verwijder',
  'sidebar.deletingButton': 'Bezig…',
  'sidebar.cancelButton': 'Annuleren',
  'sidebar.deleteFailed': 'Kon deze chat niet verwijderen. Probeer het later opnieuw.',

  // workspace.tsx.
  'workspace.newChatTitle': 'Nieuwe chat',
  'workspace.chatSectionLabel': 'Chat',
  // R2.4 (journey WP-C): the page no longer tells the reader to refresh —
  // the poll (Workspace's own router.refresh() loop, onboarding-live-status's
  // pattern) does that for them.
  'workspace.purchaseSuccessMessage': 'Bedankt! Je saldo verschijnt hier zodra Stripe de betaling bevestigt.',
  'workspace.purchaseSuccessDismiss': 'Sluiten',

  // visual-dock.tsx.
  'dock.header': 'Grafieken',
  'dock.tablistLabel': 'Visualisaties',
  // Session 110 UX audit row 5: the per-visual tab label (dock-visuals.ts's
  // `count` field) — kept byte-identical to the old hardcoded template
  // literals (`Grafiek ${n}` / `Kaart ${n}`) in Dutch.
  'dock.chartTab': 'Grafiek {n}',
  'dock.cardTab': 'Kaart {n}',

  // dataset-chat.tsx.
  'datasetChat.needsDecisionFallback': 'Niets meer te beslissen.',
  'datasetChat.noLongerNeedsDecision': 'Dit bestand hoeft niet meer beoordeeld te worden — het is mogelijk verwijderd.',
  'datasetChat.saveChoiceError': 'Er ging iets mis bij het opslaan van die keuze. Probeer het opnieuw.',
  'datasetChat.insufficientCredits': 'Niet genoeg credits (nodig: {required}, je hebt: {balance}).',
  'datasetChat.notFound': 'Dit bestand is niet meer beschikbaar.',
  'datasetChat.answerError': 'Er ging iets mis bij het beantwoorden van die vraag. Probeer het opnieuw.',
  'datasetChat.redactedMessage': 'Deze vraag is verwijderd.',
  'datasetChat.chipChartInPanel': 'Grafiek in het paneel →',
  'datasetChat.busy': 'Bezig…',
  'datasetChat.placeholder': 'Stel een vraag over je data…',
  'datasetChat.send': 'Verstuur',

  // user-chart.tsx.
  'userChart.keyboardHint': 'Gebruik de pijltjestoetsen om de punten van de grafiek te doorlopen.',
  'userChart.heading': '{y} per {x}',
  'userChart.accessibleName': 'Grafiek: {heading}',
  'userChart.provenanceLine': 'Uit bestand {file}, geüpload op {date} · {count} punten weergegeven',
  // Co-pilot phase 2 (session 113): the own-data card's own title (the CBS
  // card's caption keys — chart.caption.* — are tier-neutral and reused as
  // they are), and the three ways a data command can fail to draw.
  'userChart.title.placeholder': 'Titel boven de grafiek',
  'userChart.title.edit': 'Titel bewerken',
  'userChart.title.add': 'Titel toevoegen',
  'userChart.title.save': 'Opslaan',
  'userChart.title.cancel': 'Annuleren',
  'userChart.renderFailed.validation': 'Deze combinatie kan niet worden getekend.',
  'userChart.renderFailed.zero_rows': 'Geen rijen voldoen aan dit filter.',
  'userChart.renderFailed.too_many_points': 'Te veel punten — filter eerst.',


  // chart-data-panel.tsx — co-pilot phase 2 (session 113, Task 6): doorway A
  // for a data command. Digit-free throughout; the spelled-out numbers below
  // are what keeps a `limit` out of a summary as a figure.
  'chart.data.trigger': 'Data',
  'chart.data.regionLabel': 'Welke data deze grafiek toont',
  'chart.data.close': 'Sluiten',
  'chart.data.kind': 'Soort grafiek',
  'chart.data.kindLine': 'Lijn',
  'chart.data.kindBar': 'Staaf',
  'chart.data.x': 'Horizontale as',
  'chart.data.y': 'Waarden',
  'chart.data.seriesBy': 'Uitsplitsen naar',
  'chart.data.none': 'Geen',
  'chart.data.filters': 'Filters',
  'chart.data.filterValues': 'Waarden van {col}',
  'chart.data.filterFrom': 'Van {col}',
  'chart.data.filterTo': 'Tot {col}',
  'chart.data.filterClear': 'Filter wissen: {col}',
  'chart.data.sort': 'Sorteren op',
  'chart.data.sortNone': 'Niet sorteren',
  'chart.data.sortX': 'Horizontale as',
  'chart.data.sortValue': 'Waarde',
  'chart.data.direction': 'Richting',
  'chart.data.directionAsc': 'Oplopend',
  'chart.data.directionDesc': 'Aflopend',
  'chart.data.limit': 'Maximaal aantal',
  'chart.data.aggregate': 'Samenvatten',
  'chart.data.agg.sum': 'Som',
  'chart.data.agg.mean': 'Gemiddelde',
  'chart.data.agg.min': 'Laagste',
  'chart.data.agg.max': 'Hoogste',
  'chart.data.agg.count': 'Aantal rijen',
  'chart.data.derived': 'Berekening',
  'chart.data.derived.difference': 'Verschil',
  'chart.data.derived.share_of_total': 'Aandeel van het totaal',
  'chart.data.derived.percent_change': 'Verandering',
  'chart.data.derived.ratio': 'Verhouding',
  'chart.data.derivedB': 'Tweede kolom',
  // The reason comes from the server's own validator (English, like every
  // other backend-built string in this tier — #206).
  'chart.data.problem': 'Dit kan niet: {message}',
  // summarizeInstruction (chart-data-instruction.ts) — the history-menu label.
  'chart.data.summary.aggregate': '{fn} van {y}',
  'chart.data.summary.by': 'per {x}',
  'chart.data.summary.splitBy': 'uitgesplitst naar {s}',
  'chart.data.summary.filtered': 'gefilterd op {cols}',
  'chart.data.summary.highestFirst': 'hoogste eerst',
  'chart.data.summary.lowestFirst': 'laagste eerst',
  'chart.data.summary.sortAsc': 'oplopend op {col}',
  'chart.data.summary.sortDesc': 'aflopend op {col}',
  'chart.data.summary.top': 'top {n}',
  'chart.data.summary.limited': 'beperkt',
  'chart.data.summary.difference': '{a} min {b}',
  'chart.data.summary.ratio': '{a} gedeeld door {b}',
  'chart.data.summary.shareOfTotal': 'aandeel van {a}',
  'chart.data.summary.percentChange': 'verandering van {a}',
  'chart.data.summary.column': 'kolom',
  'chart.data.count.one': 'een',
  'chart.data.count.two': 'twee',
  'chart.data.count.three': 'drie',
  'chart.data.count.four': 'vier',
  'chart.data.count.five': 'vijf',
  'chart.data.count.six': 'zes',
  'chart.data.count.seven': 'zeven',
  'chart.data.count.eight': 'acht',
  'chart.data.count.nine': 'negen',
  'chart.data.count.ten': 'tien',

  // chart-copilot-input.tsx — co-pilot phase 2 (session 113, Task 8):
  // doorway B for a chart edit, the chat under the own-data card. Digit-free
  // throughout EXCEPT `cost`, which is the one credit figure this surface
  // shows — rendered outside the export container, like the notes strip.
  'chart.copilot.placeholder': 'Pas deze grafiek aan',
  'chart.copilot.regionLabel': 'Deze grafiek aanpassen via de chat',
  'chart.copilot.send': 'Versturen',
  'chart.copilot.busy': 'Bezig…',
  'chart.copilot.examplesLabel': 'Voorbeelden',
  'chart.copilot.undoReply': 'Dit antwoord ongedaan maken',
  'chart.copilot.retry': 'Opnieuw proberen (kost credits)',
  'chart.copilot.thumbsUp': 'Dit antwoord was goed',
  'chart.copilot.thumbsDown': 'Dit antwoord was niet goed',
  'chart.copilot.feedbackThanks': 'Bedankt voor je feedback.',
  'chart.copilot.cost': 'Kostte {n} credits',
  'chart.copilot.dropped': 'Eén onderdeel kon niet worden toegepast.',
  'chart.copilot.droppedMany': 'Een paar onderdelen konden niet worden toegepast.',
  'chart.copilot.error.failed': 'Deze aanpassing lukte niet. Probeer het opnieuw.',
  'chart.copilot.error.duplicate': 'Deze aanpassing is al verwerkt. Vernieuw de pagina om het resultaat te zien.',
  // The group Undo can go stale: the reader changed something else after the
  // reply, so this reply is no longer the top of the history.
  'chart.copilot.undoUnavailable': 'Dit antwoord staat niet meer bovenaan. Gebruik Ongedaan maken of de geschiedenis.',
  'chart.copilot.undone': 'ongedaan gemaakt',
  'chart.copilot.reason.not_available': 'kan deze grafiek niet',
  'chart.copilot.reason.not_on_this_chart': 'staat niet op deze grafiek',
  'chart.copilot.reason.needs_click': 'vraagt een klik',
  'chart.copilot.reason.unplotted_number': 'bevat een getal dat niet in de grafiek staat',
  'chart.copilot.reason.invalid': 'kon niet worden toegepast',
  'chart.copilot.hint.notes': 'Notities: klik op een punt in de grafiek.',
  'chart.copilot.hint.style': 'Opmaak: open het paneel Opmaak.',
  'chart.copilot.hint.data': 'Data: open het paneel Data.',
  'chart.copilot.hint.form': 'Weergave: kies een vorm boven de grafiek.',
  'chart.copilot.hint.none': '',
  // The three example chips (chart-capabilities.ts). Every one is also the
  // MESSAGE that is sent — the reader sees exactly what they ask for.
  'chart.copilot.example.totalPer': 'Totaal per {col}',
  'chart.copilot.example.spotlight': 'Zet {series} in de schijnwerper',
  'chart.copilot.example.highestFirst': 'Hoogste eerst',
  'chart.copilot.example.shorterTitle': 'Maak de kop korter',
  'chart.copilot.example.addTitle': 'Geef de grafiek een kop',
  'chart.copilot.example.makeBar': 'Maak er een staafdiagram van',
  'chart.copilot.example.hideGrid': 'Verberg het raster',
  // Co-pilot phase 3 (session 114, Task 2): the CBS/Eurostat tier's own
  // example chips + follow-up hand-off + the "figures don't change" note.
  'chart.copilot.example.lastYears': 'Alleen de laatste jaren',
  'chart.copilot.example.newsroomLook': 'Geef het de nieuwsroom-look',
  'chart.copilot.followUp': 'Stel als vervolgvraag',
  'chart.copilot.followUpHint': 'Dit vraagt om andere data. Als vervolgvraag krijgt het een eigen antwoord en grafiek.',
  'chart.copilot.tableLocked': 'In tabelvorm is de chat uit: kies eerst een grafiekvorm boven de grafiek.',
  'chart.copilot.cbsLocked':
    'De cijfers zelf veranderen hier niet: dit is een officiële grafiek. Vorm, periode, reeksen, opmaak en tekst wel.',
  'chart.extended.badge': 'Grafiek uitgebreid',
  'chart.extended.hint': 'Vervolg op de vorige grafiek: dezelfde bron en eenheid, in dezelfde vorm en opmaak.',

  // feedback-buttons.tsx.
  'feedback.helpful': 'Nuttig antwoord',
  'feedback.notHelpful': 'Niet nuttig',
  'feedback.thanks': 'Bedankt voor je feedback.',
  'feedback.failed': 'Feedback kon niet worden opgeslagen.',
  'feedback.textPlaceholder': 'Wat kon beter? (optioneel)',
  'feedback.submitWithText': 'Verstuur feedback',
  'feedback.skip': 'Overslaan',

  // answer-proof.tsx.
  'answerProof.triggerSingle': 'Bewijs dit cijfer',
  'answerProof.triggerPlural': 'Bewijs deze cijfers',
  'answerProof.regionLabel': 'Onderbouwing van dit antwoord',
  'answerProof.technicalToggle': 'Technische details',
  'answerProof.whyHeading': 'Waarom dit antwoord',
  'answerProof.cellsHeading': 'De gebruikte cellen',
  'answerProof.stepsHeading': 'Stap voor stap',
  'answerProof.readingLine': 'Gebruikte lezing: {reading}.',
  'answerProof.periodSemanticsLine': 'Periodebetekenis: {value}',
  'answerProof.notChosenLine': 'Niet gekozen: {label}',
  'answerProof.colSubject': 'Onderwerp',
  'answerProof.colRegion': 'Regio',
  'answerProof.colPeriod': 'Periode',
  'answerProof.colValue': 'Waarde',
  'answerProof.colStatus': 'Status',
  'answerProof.colCellId': 'Cel-id',
  'answerProof.colMeasureCode': 'Meetcode',
  'answerProof.colRegionCode': 'Regiocode',
  'answerProof.colPeriodCode': 'Periodecode',
  'answerProof.colBatch': 'Batch',
  'answerProof.dateUnknown': 'onbekend',
  'answerProof.tableCaption': 'Tabel {tableId} — {tableTitle} · versie {version} · gesynchroniseerd {date} · licentie {license}',
  'answerProof.highlightLinkTitle': 'Bekijk deze cel bij CBS',
  // WP30c D7(b) (ADR 048): shown under Technische details, only when the
  // live request_urls lookup found at least one entry (answer-proof.tsx's
  // RequestUrlsSection).
  'answerProof.requestUrlsHeading': "Opgehaalde URL's",
  'answerProof.requestUrlsBatchLabel': 'Batch {batchId}:',

  // WP218 phase 4 (#219), Task 3 (Sweep B: pages + shell).
  // landing.tsx. The owner asked (session 90) to keep the Dutch headline
  // UNCHANGED verbatim; the English value below is a faithful MEANING
  // translation, not a literal one.
  'landing.heroTitle': 'Chat met de officiële cijfers van Nederland',
  'landing.ctaStart': 'Begin met vragen',
  'landing.ctaHowItWorks': 'Hoe het werkt',
  'landing.exampleLabel': 'Zo antwoordt het product — echt voorbeeld',
  'landing.howItWorksHeading': 'Geen gokwerk, maar rekenwerk',
  'landing.step1Title': 'Jij vraagt',
  'landing.step1Body': 'In gewone taal — “wat doet de inflatie?”, “hoe hard groeide de economie?”',
  'landing.step2Title': 'Code rekent',
  'landing.step2Body':
    'Het antwoord komt uit onze database met officiële CBS-cijfers — deterministische berekening, geen taalmodel dat cijfers verzint.',
  'landing.step3Title': 'Bron erbij',
  'landing.step3Body':
    'Elk getal met CBS-tabel, periode en publicatiestatus. Weten we het niet zeker, dan zeggen we dat — liever geen antwoord dan een verzonnen antwoord.',
  'landing.pricingHeading': 'Eerlijke prijs per vraag',
  'landing.pricingBody':
    'Je betaalt per vraag met credits — geen abonnement. Een account aanmaken is gratis en zo gebeurd: e-mailadres invullen, inloglink aanklikken, vragen maar.',
  // Shared with trial-chat.tsx's LoginNudge (same CTA, same purpose) — one
  // key so the two never drift (the common.sessionExpired precedent).
  'common.createFreeAccount': 'Maak gratis een account',

  // login/login-form.tsx, login/page.tsx, login/actions.ts. googleFailed is
  // shared between the server action's own return value and the client's
  // (near-unreachable) post-unstable_rethrow fallback — one sentence, one key.
  'login.pageHeading': 'Inloggen',
  'login.pageBody': 'Vul je e-mailadres in; je krijgt een inloglink toegestuurd. Geen wachtwoord nodig.',
  'login.sentMessage': 'Check je e-mail voor de inloglink.',
  'login.emailPlaceholder': 'jij@voorbeeld.nl',
  'login.sendMagicLink': 'Stuur inloglink',
  'login.or': 'of',
  'login.continueWithGoogle': 'Doorgaan met Google',
  'login.emailRequired': 'E-mailadres is verplicht.',
  'login.magicLinkFailed': 'Er ging iets mis bij het versturen van de inloglink. Probeer het opnieuw.',
  'login.googleFailed': 'Inloggen met Google is niet gelukt. Probeer het opnieuw of gebruik de inloglink.',

  // app/credits/*.
  'credits.pageHeading': 'Credits',
  'credits.balancePrefix': 'Je huidige saldo:',
  'credits.creditsWord': 'credits.',
  'credits.purchaseSuccess': 'Bedankt! Je saldo verschijnt hier zodra Stripe de betaling bevestigt.',
  'credits.purchaseCancelled': 'Betaling geannuleerd.',
  // Task 11 (#205): the Pro subscription Checkout's own success/cancel pair.
  'credits.proSuccess': 'Bedankt! Je Pro-abonnement verschijnt hier zodra Stripe de betaling bevestigt.',
  'credits.proCancelled': 'Pro-abonnement geannuleerd.',
  'credits.buy': 'Kopen',
  'credits.unknownPack': 'Onbekend of niet meer beschikbaar pakket.',
  'credits.notLoggedIn': 'Je bent niet ingelogd.',
  'credits.unavailable': 'Betalen is momenteel niet beschikbaar.',
  'credits.startFailed': 'Er ging iets mis bij het starten van de betaling.',
  'credits.noCheckoutUrl': 'Stripe gaf geen checkout-URL terug.',

  // thread-sidebar.tsx group headings (session 110 UX audit row 4) — the
  // bucket KEYS in web/lib/thread-groups.ts (ThreadGroupLabel) stay Dutch
  // literals used only as internal identifiers; these are the rendered
  // labels shown above each day-bucket of threads in the CHAT SIDEBAR (not
  // the /geschiedenis page below, despite the shared "history." prefix).
  'history.today': 'Vandaag',
  'history.yesterday': 'Gisteren',
  'history.last7': 'Afgelopen 7 dagen',
  'history.older': 'Ouder',

  // app/geschiedenis/page.tsx.
  'history.pageHeading': 'Geschiedenis',

  // question-history.tsx (Server Component; onboarding.failureSummary itself
  // is backend text and is never translated — only the fixed template words
  // around it go through the catalogue).
  'history.empty': 'Nog geen eerdere vragen.',
  'history.heading': 'Eerdere vragen',
  'history.creditsInline': '{n} credits · ',
  'history.creditsInlineTotal': '{n} credits totaal · ',
  'history.deletedQuestionLabel': 'Verwijderde vraag',
  'history.deletedBody': 'De tekst van deze vraag is verwijderd.',
  'history.clarificationLabel': 'Verduidelijkingsvraag',
  'history.yourReplyLabel': 'Jouw antwoord',
  'history.moreAboutMeasurement': 'Meer over deze meting',
  'history.onboardingPreparingLabel': 'Wordt voorbereid',
  'history.onboardingPreparingBody':
    'We vragen de cijfers over "{topic}" nu automatisch op bij het CBS en controleren ze. Je krijgt een e-mail zodra je vraag beantwoord kan worden.',
  'history.onboardingFailedLabel': 'Kon niet worden opgehaald',
  'history.onboardingFailedFallback': 'Het ophalen van deze cijfers is niet gelukt.',
  'history.onboardingFailedRefundSuffix': ' De credits zijn teruggestort.',

  // onboarding-live-status.tsx.
  'status.inFlightSingular':
    'Er is 1 aanvraag bij het CBS in behandeling — de status hieronder wordt automatisch bijgewerkt.',
  'status.inFlightPlural':
    'Er zijn {n} aanvragen bij het CBS in behandeling — de status hieronder wordt automatisch bijgewerkt.',

  // account-panel.tsx (rendered only inside the client Dashboard — treated as
  // a client surface; header.credits is reused below for the identical "Buy
  // credits" CTA, workspace.purchaseSuccessMessage/Dismiss reused in
  // dashboard.tsx for the identical #95 banner).
  'account.balanceLabel': 'Saldo',
  'account.lowBalanceWarning': 'Je saldo is bijna op — er is nog genoeg voor één vraag.',
  'account.explainerWithQuestions':
    "Bij aanmelding krijg je eenmalig {grant} credits. Een gewone vraag kost {price} credits — {grant} credits zijn dus goed voor zo'n {questions} vragen.",
  'account.explainerNoQuestions': 'Bij aanmelding krijg je eenmalig {grant} credits. Een gewone vraag kost {price} credits.',

  // site-footer.tsx. Session 110 UX audit row 21 REVERSES the earlier
  // "FOOTER_ATTRIBUTION stays byte-pinned, untranslated" decision — an
  // English page showing Dutch attribution copy read as unfinished. Both
  // languages must keep "CBS StatLine (CC BY 4.0)" verbatim (R4 attribution;
  // asserted in messages.test.ts).
  'footer.attribution': 'Cijfers: CBS StatLine (CC BY 4.0) · Elk getal herleidbaar tot een officiële CBS-tabel',
  // Session 110 UX audit row 18 (ADR 048 addendum): the ONE internal page
  // that is entirely Eurostat data (web/app/eurostat-explorer/page.tsx) gets
  // its own source-correct footer line instead of the CBS one above — see
  // site-footer.tsx's `sourceRoute` prop. Wording mirrors 'footer.attribution'
  // exactly, swapping CBS StatLine/CBS-tabel for the registry's own Eurostat
  // attributionLabel/license (src/sources/registry.ts EUROSTAT_SOURCE_KEY
  // entry: attributionLabel 'Eurostat', license 'CC BY 4.0'). "Eurostat (CC
  // BY 4.0)" must stay verbatim in both languages (messages.test.ts).
  'footer.attributionEurostat':
    'Cijfers: Eurostat (CC BY 4.0) · Elk getal herleidbaar tot een officiële Eurostat-dataset',
  'footer.aboutLabel': 'Over dit project',
  'footer.systemMapLabel': 'Systeemoverzicht',

  // delete-history-button.tsx.
  'deleteHistory.confirmText':
    'Weet je het zeker? Je vraagteksten worden permanent verwijderd. Dit kan niet ongedaan worden gemaakt.',
  'deleteHistory.confirmYes': 'Ja, verwijder',
  'deleteHistory.cancel': 'Annuleren',
  'deleteHistory.trigger': 'Verwijder mijn vraaggeschiedenis',
  'deleteHistory.failed': 'Verwijderen is niet gelukt. Probeer het later opnieuw.',

  // trial.tsx / trial-chat.tsx (formerly lib/trial-copy.ts's TRIAL_COPY,
  // folded into the one catalogue — the #184 "single-sourced copy" intent
  // now lives here instead of a second file).
  'trial.heading': 'Probeer het direct',
  'trial.subheading':
    'Twee gratis proefvragen, zonder account. Elk antwoord komt uit officiële CBS-cijfers, met bron en datum erbij.',
  'trial.potEmpty': 'Het gratis proefpotje is op dit moment leeg. Log in om verder te gaan — een account is gratis.',
  'trial.unavailable':
    'De gratis proefvragen zijn nu even niet beschikbaar. Log in om verder te gaan — een account is gratis.',
  'trial.usedUp': 'Je hebt je gratis proefvragen gebruikt. Maak een gratis account om verder te gaan.',
  'trial.ipLimit': 'Vanaf dit netwerk zijn de gratis proefvragen voor vandaag op. Maak een gratis account om verder te gaan.',
  'trial.error': 'Er ging iets mis; je proefvraag is niet verbruikt. Probeer het zo nog eens.',
  'trial.clarificationPrefix':
    'In het proefpotje kun je niet doorvragen op een verduidelijking — stel je vraag preciezer opnieuw, of ',
  'trial.createAccountInline': 'maak een gratis account',
  'trial.inputPlaceholder': 'Bijv. wat is de inflatie nu?',
  'trial.inputAriaLabel': 'Stel je gratis proefvraag',
  'trial.submitBusy': 'Rekenen…',
  'trial.submitIdle': 'Vraag',
  'trial.of': 'van',
  'trial.freeQuestionsLeft': 'gratis proefvragen over — geen account nodig.',

  // source-badge.tsx (Client — always rendered from chart.tsx/chat.tsx).
  'sourceBadge.syncedLabel': 'gesynchroniseerd {date}',

  // stat-card.tsx.
  'statCard.provisional': 'voorlopig',
  'statCard.downloadPng': 'Download als afbeelding',
  'statCard.downloadFailed': 'Downloaden lukte niet in deze browser.',
  'statCard.attributionLine': '{source} · tabel {table} · gesynchroniseerd {date} · checkdecijfers.nl',

  // theme-toggle.tsx — English today, Dutch added as the nl default (design
  // §3): the pins move from the literal English strings to these nl values.
  'themeToggle.groupLabel': 'Thema',
  'themeToggle.light': 'Licht thema',
  'themeToggle.dark': 'Donker thema',
  'themeToggle.system': 'Systeemthema',

  // app/layout.tsx metadata (generateMetadata).
  'meta.title': 'Check de Cijfers',
  'meta.description': 'Chat met officiële CBS-cijfers — elk getal herleidbaar tot een CBS-tabel.',

  // WP218 phase 4 (#219), Task 4 (design §4): the chart card — chart.tsx,
  // chart-download.tsx, chart-notes.tsx, chart-small-multiples.tsx,
  // chart-toggle.tsx, chart-config-panel.tsx. Dutch entries are today's
  // literal strings, verbatim — ChartView's `chartLang` falls back to
  // `useLang()`, which defaults to 'nl' with no `<LangProvider>` above it
  // (same default every other surface uses), so every existing chart test
  // keeps passing unchanged.
  'chart.weergaveLabel': 'Weergave',
  'chart.tabLine': 'Lijn',
  'chart.tabBar': 'Staaf',
  'chart.tabTable': 'Tabel',
  'chart.lineDisabledReason': 'Een lijn tussen regio’s zou een trend suggereren die niet is gemeten.',
  // WP218 phase 5 (owner D): two more Weergave tabs — Vlak (area) and
  // Liggend (horizontal bar) — plus their own disabled-tab reasons.
  'chart.form.area': 'Vlak',
  'chart.form.hbar': 'Liggend',
  // Phase 5 (chart-fit scorer, session 116): the three new Weergave tab
  // labels — needed from Task 1 on because chart-history-menu.tsx's
  // `formLabel` is exhaustive over ChartForm. "Dumbbell" is a chart-type
  // name without an established Dutch translation (same as the plan keeps
  // it). Their disabled-tab reasons arrive with the tabs (Tasks 2-4).
  'chart.form.dumbbell': 'Dumbbell',
  'chart.form.slope': 'Helling',
  'chart.form.heatmap': 'Warmtekaart',
  'chart.formReason.areaMultiSeries':
    'Een gevuld vlak per reeks zou de reeksen over elkaar leggen en gaten verbergen.',
  'chart.formReason.areaComparison': 'Een vlak past alleen bij een reeks in de tijd.',
  // Session 110 UX audit pass 4, row 7: this used to say "only fits a
  // comparison between regions" — false on a real multi-region time series
  // (a `region_series` answer IS a comparison between regions), where the
  // real reason Liggend is disallowed is the time axis, not the region
  // count (see the `hbarDisabledReason` comment in chart.tsx: it fires for
  // any line-kind spec, regardless of series count).
  'chart.formReason.hbarTimeSeries': 'Liggende staven tonen één periode; deze grafiek loopt over meerdere periodes.',
  // Phase 5 (chart-fit scorer, Task 2): the Helling tab's disabled reason —
  // digit-free on purpose (the whole-card digit scan in chart.test.tsx).
  'chart.slopeDisabledReason': 'Beschikbaar zodra je precies twee momenten vergelijkt.',
  // Phase 5 (Task 3): the Dumbbell tab's disabled reason. Same condition as
  // slope's (plus: every point must have a real value), worded differently
  // on purpose — a spec that disables both tabs would otherwise render the
  // identical sentence twice, and the reason should read as the dumbbell's
  // own. Digit-free (the whole-card digit scan).
  'chart.dumbbellDisabledReason': 'Beschikbaar zodra minstens twee reeksen elk precies een begin- en een eindwaarde hebben.',
  'chart.heatmapDisabledReason': 'Beschikbaar zodra je minstens twee reeksen en twee momenten vergelijkt.',
  'chart.from': 'Vanaf',
  'chart.to': 'Tot',
  // #254: the alternate-reading toggle. Only the CONTROL's own chrome lives
  // here — every option label is the registry's own alternate label string,
  // rendered verbatim, never translated or invented by the UI.
  'chart.reading.label': 'Lezing',
  'chart.reading.primary': 'Standaard',
  'chart.graphPanelLabel': 'Grafiek',
  'chart.seriesGroupLabel': 'Reeksen',
  'chart.highlightButton': 'Markeer {label}',
  'chart.highlightTitle': 'Markeer {label}, andere reeksen worden gedimd',
  'chart.dimButton': 'Dim {label}',
  'chart.dimTitle': '{label} dimmen; zichtbaar maar minder nadruk',
  'chart.hiddenSeriesDisclosure': '{n} van {m} reeksen verborgen',
  'chart.zoomDisclosure': 'Getoond: {from}–{to} van {coveredFrom}–{coveredTo}.',
  'chart.smallMultiplesToggle': 'Kleine grafieken',
  'chart.axisGroupLabel': 'Gelijke assen of eigen assen',
  'chart.sharedAxes': 'Gelijke assen',
  'chart.ownAxes': 'Eigen assen',
  'chart.markedInChart': 'Gemarkeerd in de grafiek: {label}',
  'chart.keyboardHint': 'Gebruik de pijltjestoetsen om de punten van de grafiek te doorlopen.',
  // Chart-card polish (2026-09-15): the screen-reader prefix for the large
  // headline figure above the chart (the figure itself is a spec string).
  'chart.headline.label': 'Laatste waarde in de grafiek',
  'chart.headline.suggest': 'Kop voorstellen',
  'chart.headline.edit': 'Kop bewerken',
  'chart.headline.placeholder': 'Typ een kop…',
  'chart.headline.save': 'Opslaan',
  'chart.headline.cancel': 'Annuleren',
  'chart.headline.drafting': 'Bezig met voorstellen…',
  'chart.headline.unauthenticated': 'Log in om een kop toe te voegen.',
  'chart.headline.error': 'Kon de kop niet opslaan.',
  // #6 (session 110 UX audit pass 2): the draft (Kop voorstellen) and the
  // save (Opslaan) path used to share `chart.headline.error` — a failed
  // AI draft showed "Kon de kop niet opslaan", which is false: nothing was
  // being saved yet. Own string for the draft failure.
  'chart.headline.draftError': 'Kon de kop niet voorstellen.',
  // Task 5 (co-pilot phase 4): reader-chosen headline number. Clicking a
  // point shows buttons to make it the featured headline or clear an override.
  'chart.headline.setOverride': 'Maak dit het hoofdcijfer',
  'chart.headline.clearOverride': 'Toon standaard hoofdcijfer',
  // Chart co-pilot phase 1 (session 112, ADR 056): the card's undo/redo
  // pair. Digit-free by construction — the chart card's own digit scan
  // (chart.test.tsx) treats every rendered digit as a claim about data.
  // Task 5 (co-pilot phase 1): in-place title and caption editing. The
  // reader's OWN words — digit-free strings by construction, like the
  // undo/redo pair below, so the whole-card digit scan stays clean.
  'chart.title.edit': 'Titel bewerken',
  'chart.title.placeholder': 'Eigen titel',
  'chart.title.original': 'Oorspronkelijke titel: {title}',
  'chart.caption.add': 'Bijschrift toevoegen',
  'chart.caption.edit': 'Bijschrift bewerken',
  'chart.caption.placeholder': 'Bijschrift onder de grafiek',
  'chart.caption.save': 'Opslaan',
  'chart.caption.cancel': 'Annuleren',
  'chart.history.undo': 'Ongedaan maken',
  'chart.history.redo': 'Opnieuw',
  'chart.history.undoHint': 'Ongedaan maken (⌘Z / Ctrl+Z)',
  'chart.history.redoHint': 'Opnieuw (⇧⌘Z / Ctrl+Y)',
  // Task 4 (co-pilot phase 1): the history popover's own strings, plus
  // describeCommand's one-sentence-per-command-kind vocabulary. `{form}`,
  // `{keys}` and `{id}` are always enum/id strings (never data), so this
  // stays digit-free the same way the undo/redo pair above does.
  'chart.history.menu': 'Geschiedenis van bewerkingen',
  'chart.history.empty': 'Nog geen bewerkingen',
  'chart.history.undone': 'ongedaan gemaakt',
  'chart.history.source.panel': 'via het paneel',
  'chart.history.source.canvas': 'op de grafiek',
  'chart.history.source.chat': 'via de chat',
  'chart.command.setForm': 'Weergave: {form}',
  'chart.command.toggleSeries': 'Reeks verborgen of getoond',
  'chart.command.setSeriesView': 'Reeksen hersteld',
  'chart.command.setHighlight': 'Reeks in de schijnwerper',
  'chart.command.setHighlightOff': 'Schijnwerper uit',
  'chart.command.setPeriodRange': 'Periode aangepast',
  'chart.command.setPeriodRangeOff': 'Hele periode',
  'chart.command.setPresentation': 'Opmaak: {keys}',
  'chart.command.replacePresentation': 'Opmaak hersteld',
  'chart.command.resetPresentation': 'Opmaak teruggezet',
  'chart.command.applyTemplate': 'Sjabloon: {id}',
  'chart.command.setReading': 'Andere lezing',
  'chart.command.addNote': 'Notitie toegevoegd',
  'chart.command.removeNote': 'Notitie verwijderd',
  'chart.command.setTitle': 'Titel aangepast',
  'chart.command.setTitleOff': 'Titel hersteld',
  'chart.command.setCaption': 'Bijschrift aangepast',
  'chart.command.setCaptionOff': 'Bijschrift verwijderd',
  'chart.command.setInstruction': 'Data: {summary}',
  'chart.command.setHeadlineOverride': 'Hoofdcijfer aangepast',
  'chart.command.clearHeadlineOverride': 'Hoofdcijfer hersteld',
  'chart.command.addGoalLine': 'Doellijn toegevoegd',
  'chart.command.removeGoalLine': 'Doellijn verwijderd',
  'chart.command.addEraShading': 'Schaduw toegevoegd',
  'chart.command.removeEraShading': 'Schaduw verwijderd',
  'chart.command.setDimmed': 'Serie verzwakt',
  'chart.command.addDerivedOverlay': 'Overlay toegevoegd',
  'chart.command.removeDerivedOverlay': 'Overlay verwijderd',
  'chart.noteAriaLabel': 'Voeg notitie toe bij {series}, {period}',
  'chart.schemaRefusal':
    'Deze grafiek is gemaakt in een nieuwere versie dan deze pagina kan tonen. De cijfers staan in het antwoord zelf.',
  'chart.table.period': 'Periode',
  'chart.table.region': 'Regio',
  'chart.table.value': 'Waarde',

  // chart-notes.tsx.
  'chart.notes.heading': 'Uw aantekeningen (geen CBS-data)',
  'chart.notes.delete': 'Verwijder',
  // #13 (session 110 UX audit pass 2): plain "Verwijder" on every note's
  // delete button reads as "Verwijder, Verwijder, Verwijder" with several
  // notes. Own accessible-name key carrying the note's own point context —
  // the visible button label stays the short `chart.notes.delete` text.
  'chart.notes.deleteAriaLabel': 'Verwijder de notitie bij {series} · {period}',
  'chart.notes.draftLabel': 'Notitie bij {series} · {period}',
  'chart.notes.save': 'Opslaan',
  'chart.notes.cancel': 'Annuleren',
  // #17 (session 110 UX audit pass 2): notes are session-only and excluded
  // from every download/embed by construction (ADR 038) — nothing on
  // screen said so before this line.
  'chart.notes.sessionOnly': 'Aantekeningen staan niet in downloads of embeds.',

  // chart-goal-line.tsx.
  'chart.goalLine.heading': 'Uw doellijnen (geen CBS-data)',
  'chart.goalLine.add': 'Doellijn toevoegen',
  'chart.goalLine.valueLabel': 'Waarde',
  'chart.goalLine.textLabel': 'Label',
  'chart.goalLine.save': 'Opslaan',
  'chart.goalLine.cancel': 'Annuleren',
  'chart.goalLine.delete': 'Verwijder',
  'chart.goalLine.removeAriaLabel': '{label} verwijderen',
  // Final-review fix I5: the old text claimed goal lines "stay in this
  // session and are not included in downloads or embeds" — both halves are
  // now wrong. use-chart-edits.ts saves the FULL command history (goal
  // lines included), so for a signed-in reader on a saved chart it DOES
  // survive a reload; and the C2 fix draws the line itself inside the export
  // (chart.tsx, "Task 3 (phase 4)" block) — only the reader's own typed
  // label text stays outside it. What stays true, and is worth saying: it's
  // the reader's own annotation, never checked against a CBS cell.
  'chart.goalLine.sessionOnly': 'Dit doel is jouw eigen aantekening, niet gecontroleerd aan CBS-cijfers. De lijn zelf is zichtbaar in downloads; het label dat je typt niet, en geen van beide verschijnt in een embed.',

  // chart-era-shading.tsx.
  'chart.eraShading.heading': 'Periode markeren (geen CBS-data)',
  'chart.eraShading.delete': 'Verwijder',
  'chart.eraShading.deleteAriaLabel': 'Verwijder de markering {period}',
  // Final-review fix I5: same correction as chart.goalLine.sessionOnly above
  // — the band (ReferenceArea) genuinely is inside the export (Task 3), and
  // a signed-in reader's era shadings persist across a reload the same way
  // goal lines do; only the typed label text stays out.
  'chart.eraShading.sessionOnly': 'Deze markering is jouw eigen aantekening, niet gecontroleerd aan CBS-cijfers. De band zelf is zichtbaar in downloads; het label dat je typt niet, en geen van beide verschijnt in een embed.',
  'chart.eraShading.trigger': 'Periode markeren',
  'chart.eraShading.fromLabel': 'Van',
  'chart.eraShading.toLabel': 'Tot',
  'chart.eraShading.labelLabel': 'Label',
  'chart.eraShading.labelPlaceholder': 'Bijv. financiële crisis',
  'chart.eraShading.save': 'Opslaan',
  'chart.eraShading.cancel': 'Annuleren',

  // chart-download.tsx.
  'chart.download.trigger': 'Download',
  'chart.download.menuLabel': 'Downloadformaat',
  'chart.download.png': 'Download als PNG',
  'chart.download.svg': 'Download als SVG',
  // #215 (ADR 053): vector export as PDF, and a chart-only PNG for external
  // layout work — label says plainly what it leaves out, since the file
  // itself carries no source line to say so.
  'chart.download.pdf': 'Download als PDF',
  'chart.download.pngTransparent': 'PNG, alleen grafiek (transparant, zonder bronregel)',
  'chart.download.failed': 'Downloaden lukte niet in deze browser.',

  // chart-small-multiples.tsx.
  'chart.smallMultiplesGroupLabel': 'Kleine grafieken per reeks',
  // Row 11 (session 110 UX audit pass 4): the grid never stated its period
  // span. {from}/{to} are the spec's own period labels (R6 — no invented
  // number), so this template carries no digit itself.
  'chart.smallMultiplesPeriodSpan': 'Periode {from} – {to}',

  // chart-toggle.tsx.
  'chart.toggle.definitionGroupLabel': 'Definitie wisselen',

  // chart-config-panel.tsx — PANEL_COPY folded into the catalogue (Task 4);
  // the component's own `lang` prop is unchanged (chart.tsx now passes it
  // the resolved chart language instead of always 'nl').
  'chart.panel.trigger': 'Opmaak',
  'chart.panel.regionLabel': 'Opmaak van de grafiek',

  // Story mode (session 92 design, spec 2026-09-09-story-mode-and-embed-design.md
  // Part A). Digit-free by construction: every number a caption shows is a
  // spec string filled into a placeholder, never part of the template.
  // Superseded 2026-09-10 (session 94, owner ask): the trigger/panel now
  // present as "Insights" — genuine outlier findings (chart-insights.ts),
  // optionally AI-phrased — rather than the old chronological Start/High/
  // Low/Latest story. Key NAMES stay `chart.story.*` (chart.tsx/chart-
  // story.tsx and their tests reference them by string) — only the shown
  // VALUES changed; see open-questions.md for the chart-story.ts cleanup
  // this left tracked.
  'chart.story.trigger': 'Inzichten',
  'chart.story.regionLabel': 'Inzichten bij de grafiek',
  // Session 110 a11y audit (#Fix-now 3): the findings-card scroll area's own
  // aria-label — it's a distinct focusable/scrollable region NESTED inside
  // the panel above, so it needs its own accessible name.
  'chart.story.findingsListLabel': 'Lijst met bevindingen',
  'chart.story.hint': 'Scroll of gebruik de pijlen',
  'chart.story.prev': 'Vorige',
  'chart.story.next': 'Volgende',
  'chart.story.close': 'Sluiten',
  'chart.story.stepsLabel': 'Stappen',
  'chart.story.pointCaption': '{period}: {value} {unit}',
  'chart.story.seriesCaption': '{fromPeriod}: {fromValue} → {toPeriod}: {toValue} {unit}',
  'chart.story.barCaption': '{label}: {value} {unit}',
  'chart.story.provisional': ' (voorlopig cijfer)',
  // Insights (session 94): the 4 finding kinds chart-insights.ts selects.
  // {series} is the series/region label — omitted from the sentence itself
  // on a single-series chart (buildComparePrompt's own title-only usage).
  'chart.insights.recordHighTitle': 'Uitschieter naar boven',
  'chart.insights.recordLowTitle': 'Uitschieter naar beneden',
  // Session 110 addendum (audit pass 3, row 16): a comparison chart (bar —
  // every series exactly one point, a ranking, no time axis) has no "jump"
  // to have leapt from — its extremes are the highest/lowest MEMBER, not an
  // "uitschieter" (a time-series-shaped word implying a departure from a
  // trend). chart-insights.ts's TITLE_KEY picks these two instead of
  // recordHigh/recordLowTitle whenever the spec is bar-shaped.
  'chart.insights.highestMemberTitle': 'Hoogste',
  'chart.insights.lowestMemberTitle': 'Laagste',
  // Session 110 addendum (ADR 041): a point that is above/below the
  // series' own mean but is NOT the actual highest/lowest point — kept
  // distinct from the "Uitschieter" titles above so a mid-series point is
  // never mislabelled as the record it isn't.
  'chart.insights.aboveAverageTitle': 'Boven het gemiddelde',
  'chart.insights.belowAverageTitle': 'Onder het gemiddelde',
  'chart.insights.jumpUpTitle': 'Sterke stijging',
  'chart.insights.jumpDownTitle': 'Sterke daling',
  // A multi-series finding's caption has no other way to say WHICH series it
  // is about (chart.story.pointCaption/seriesCaption only ever name the
  // period) — this prefixes it. Single-series and bar findings never use it.
  'chart.insights.seriesLabelPrefix': '{series} — ',
  'chart.story.controlsLocked': 'Sluit het verhaal om dit te wijzigen.',
  // ADR 044 (Task 4): the full-viewport Story stage — its own dialog chrome,
  // distinct from the compact panel's `chart.story.*` strings above (which
  // stay for the panel; the stage is a separate surface).
  'chart.stage.present': 'Presenteren',
  'chart.stage.label': 'Presentatie van de inzichten',
  'chart.stage.close': 'Sluiten',
  'chart.stage.scrollHint': 'Scroll om verder te gaan',
  'chart.stage.autoplay': 'Automatisch afspelen',
  'chart.stage.stepsLabel': 'Stappen',
  // Fix round 1: the dots list needs its own accessible name, distinct from
  // the steps list — both were sharing `chart.stage.stepsLabel`.
  'chart.stage.positionLabel': 'Positie in het verhaal',
  'chart.panel.tabsLabel': 'Opmaak-onderdelen',
  'chart.panel.tabChart': 'Grafiek',
  'chart.panel.tabColors': 'Kleuren',
  'chart.panel.tabFont': 'Lettertype',
  'chart.panel.lineWidth': 'Lijndikte',
  'chart.panel.markers': 'Punten',
  'chart.panel.grid': 'Rasterlijnen',
  'chart.panel.xLabels': 'Labels op de x-as',
  // Owner decision (option A, compact grid): shortened from "Aslijnen tonen"/
  // "Waarden tonen" now that the "Tonen" group label above them already says
  // what the row does — see `chart.panel.showGroup` below.
  'chart.panel.axisLines': 'Aslijnen',
  'chart.panel.valueLabels': 'Waarden',
  'chart.panel.zeroBaseline': 'Y-as vanaf nul',
  'chart.panel.areaFill': 'Verloop in het vlak',
  'chart.panel.showGroup': 'Tonen',
  // Audit pass 2, row 12 (2026-09-17): the whole accessible name of this
  // control used to be just "Standaard" — sitting directly above "Bewaar
  // als mijn standaard" it read as a state label, not the reset action it
  // actually is.
  'chart.panel.reset': 'Terug naar standaard',
  'chart.panel.lineWidthOption.thin': 'Dun',
  'chart.panel.lineWidthOption.normal': 'Normaal',
  'chart.panel.lineWidthOption.thick': 'Dik',
  'chart.panel.lineWidthOption.extraThick': 'Extra dik',
  'chart.panel.markersOption.all': 'Alle punten',
  'chart.panel.markersOption.ends': 'Eerste en laatste',
  'chart.panel.markersOption.provisionalOnly': 'Alleen voorlopige',
  'chart.panel.gridOption.both': 'Beide',
  'chart.panel.gridOption.horizontal': 'Alleen horizontaal',
  'chart.panel.gridOption.none': 'Geen',
  'chart.panel.xLabelsOption.flat': 'Horizontaal',
  'chart.panel.xLabelsOption.tilted': 'Schuin',
  'chart.panel.colourOf': 'Kleur van',
  'chart.panel.hexSuffix': '(hex-code)',
  'chart.panel.pickSuffix': 'kiezen',
  'chart.panel.resetColors': 'Standaardkleuren',
  'chart.panel.warnLight': 'Deze kleur is slecht leesbaar in het lichte thema.',
  'chart.panel.warnDark': 'Deze kleur is slecht leesbaar in het donkere thema.',
  'chart.panel.warnBoth': 'Deze kleur is slecht leesbaar in beide thema’s.',
  'chart.panel.font': 'Lettertype',
  'chart.panel.fontDefault': 'Standaard',
  'chart.panel.accountSave': 'Bewaar als mijn standaard',
  'chart.panel.accountForget': 'Vergeet mijn standaard',
  'chart.panel.accountSaved': 'Opgeslagen.',
  'chart.panel.accountForgotten': 'Vergeten.',
  'chart.panel.accountUnavailable': 'Opslaan is op dit moment niet mogelijk.',
  'chart.panel.accountError': 'Er ging iets mis. Probeer het later opnieuw.',
  'chart.panel.accountHint': 'Mijn standaard is actief.',
  'chart.panel.brandHeading': 'Merkkleuren',
  'chart.panel.brandIntro': 'Haal de kleuren en het lettertype van je organisatie op.',
  'chart.panel.brandApply': 'Pas merkkleuren toe',
  'chart.panel.brandWebsiteLabel': 'Website van je organisatie',
  'chart.panel.brandWebsitePlaceholder': 'bijv. jouworganisatie.nl',
  'chart.panel.brandApplied': 'Kleuren en lettertype van {name} toegepast, via Brandfetch.',
  'chart.panel.brandFontSkipped': 'Een lettertype dat niet vrij beschikbaar is, is overgeslagen.',
  'chart.panel.brandUnavailable': 'Merkkleuren ophalen is op dit moment niet mogelijk.',
  'chart.panel.brandNotFound': 'Voor dit domein is geen merk gevonden.',
  'chart.panel.brandInvalidDomain': 'Dat ziet er niet uit als een website.',
  'chart.panel.brandTryLater': 'Probeer het later nog eens.',
  // Global monthly Brandfetch cap (owner decision 2026-09-09) — digit-free
  // per the panel's own honesty scan, deliberately vague about the reset
  // moment rather than naming a date or a count.
  'chart.panel.brandMonthlyCap':
    'Merkkleuren ophalen is deze maand niet meer beschikbaar; vanaf de volgende maand weer.',
  'chart.panel.brandError': 'Er ging iets mis. Probeer het later opnieuw.',
  // WP218 phase 4: the new "Taal van de grafiek" select (design §4). The
  // other two option labels are the languages' own self-names ('Nederlands',
  // 'English') — proper nouns, identical in both languages, catalogued below
  // for the "every literal goes through t()" rule rather than hardcoded.
  'chart.panel.languageLabel': 'Taal van de grafiek',
  'chart.panel.languageNl': 'Nederlands',
  'chart.panel.languageEn': 'English',
  // WP218 phase 5 (chart-types plan, Task 3): the Grafiek tab's collapsed
  // note explaining why pie/donut, stacked, scatter and sorted-by-value
  // charts are never offered as a form — digit-free per the resolver's own
  // honesty invariant ('één'/'twee' are words, not numerals).
  'chart.panel.whyNotTitle': 'Waarom geen taart- of gestapelde grafiek?',
  'chart.panel.whyNotBody':
    'Een taart- of gestapelde grafiek tekent een totaal of een aandeel dat in geen enkele CBS-cel staat. Een spreidingsgrafiek heeft twee meetwaarden per punt nodig, en deze grafiek heeft er één. Sorteren op waarde is een rangorde die niet gemeten is.',
  'chart.panel.tabFrame': 'Kader',
  // ADR 043: chart templates v1 — the catalogue keys for the six named
  // looks plus the brand template shown alongside them.
  'chart.panel.tabTemplates': 'Sjablonen',
  'chart.template.standard': 'Basis',
  'chart.template.standardDescription': 'De standaardlook: rustig raster, duidelijke lijnen.',
  'chart.template.classic': 'Klassiek',
  'chart.template.classicDescription': 'De vertrouwde look met punten op elk meetmoment.',
  'chart.template.newsroom': 'Redactie',
  'chart.template.newsroomDescription': 'Publicatieklaar: stevige lijn, geen franje, liggend formaat.',
  'chart.template.presentation': 'Presentatie',
  'chart.template.presentationDescription': 'Een kaart op een donkere achtergrond, klaar voor een slide.',
  'chart.template.social': 'Sociaal',
  'chart.template.socialDescription': 'Staand formaat met een kleurige rand voor sociale media.',
  'chart.template.minimal': 'Minimaal',
  'chart.template.minimalDescription': 'Alleen de lijn, de waarden en de open markering.',
  'chart.template.warm': 'Warm',
  'chart.template.warmDescription': 'Een zachte kleurovergang, ideaal voor een redactioneel verhaal.',
  'chart.template.earth': 'Aards',
  'chart.template.earthDescription': 'Een stevige lijn op een zandkleurige kaart, vierkant formaat.',
  'chart.template.brand': 'Merk',
  'chart.template.brandDescription': 'Jouw merkkleuren en lettertype, opgehaald via je website.',
  'chart.template.brandOpen': 'Naar Kleuren',
  'chart.template.current': 'Huidig',
  'chart.template.galleryLabel': 'Sjablonen',
  'chart.panel.frameBackground': 'Achtergrond',
  'chart.panel.frameBgNone': 'Geen',
  'chart.panel.frameBgSolid': 'Kleur',
  'chart.panel.frameBgGradient': 'Verloop',
  'chart.panel.frameBgImage': 'Eigen afbeelding',
  'chart.panel.frameGradientPreset': 'Voorbeeld',
  'chart.panel.frameGradientDawn': 'Dageraad',
  'chart.panel.frameGradientOcean': 'Oceaan',
  'chart.panel.frameGradientForest': 'Bos',
  'chart.panel.frameGradientBerry': 'Bes',
  'chart.panel.frameGradientSlate': 'Leisteen',
  'chart.panel.frameGradientSand': 'Zand',
  'chart.panel.frameFrom': 'Van',
  'chart.panel.frameTo': 'Naar',
  'chart.panel.framePadding': 'Ruimte rondom',
  'chart.panel.frameCorners': 'Hoeken',
  'chart.panel.frameShadow': 'Schaduw',
  'chart.panel.frameInset': 'Kaart',
  'chart.panel.frameAspect': 'Verhouding',
  'chart.panel.sizeNone': 'Geen',
  'chart.panel.sizeSmall': 'Klein',
  'chart.panel.sizeMedium': 'Middel',
  'chart.panel.sizeLarge': 'Groot',
  'chart.panel.cornersSquare': 'Recht',
  'chart.panel.cornersRounded': 'Rond',
  'chart.panel.cornersVeryRounded': 'Extra rond',
  'chart.panel.shadowSoft': 'Zacht',
  'chart.panel.shadowStrong': 'Sterk',
  'chart.panel.aspectAuto': 'Zoals het is',
  'chart.panel.aspectWide': 'Breedbeeld',
  'chart.panel.aspectPortrait': 'Staand',
  'chart.panel.aspectSquare': 'Vierkant',
  'chart.panel.aspectSocial': 'Social',
  'chart.panel.frameImagePick': 'Kies een afbeelding',
  'chart.panel.frameImageRemove': 'Verwijder afbeelding',
  'chart.panel.frameImageTooLarge': 'De afbeelding is te groot. Kies een kleinere.',
  'chart.panel.frameImageBadType': 'Kies een PNG, JPEG of WebP.',
  'chart.panel.frameImageNotSaved': 'De afbeelding wordt niet bewaard in je standaard.',
  'chart.panel.frameReset': 'Kader wissen',
  'chart.panel.frameBgRefused': 'Deze achtergrond maakt een reeks onleesbaar. Kies een andere kleur of zet de kaart aan.',
  'chart.panel.close': 'Sluiten',
  'chart.panel.dialogLabel': 'Opmaak',
  // Embed (session 92, spec 2026-09-09-story-mode-and-embed-design.md Part
  // B1): the footer button + pop-up that generates an <iframe> embed code.
  // `chart.embed.languageNl`/`languageEn` deliberately reuse the existing
  // `chart.panel.language*` self-name proper nouns rather than duplicating
  // them under a new key (the panel's own convention above already
  // catalogues 'Nederlands'/'English' for this exact concept).
  'chart.embed.trigger': 'Insluiten',
  'chart.embed.dialogTitle': 'Grafiek insluiten',
  'chart.embed.dialogExplain': 'Plak deze code in een artikel om deze grafiek te tonen, met bronvermelding.',
  // Session 110 (embed auto-resize, ADR 041 addendum): one sentence
  // explaining the new mechanism — the generated snippet's own inline
  // <script> resizes the iframe to fit; the height attribute on the
  // <iframe> itself is only the fallback for a host that blocks scripts.
  'chart.embed.autoResizeExplain':
    'De grafiek past zichzelf aan op de inhoud; de hoogte in de code is de terugvaloptie als scripts geblokkeerd zijn.',
  'chart.embed.languageLabel': 'Taal',
  'chart.embed.colourLabel': 'Kleuren',
  'chart.embed.colourLight': 'Licht',
  'chart.embed.colourDark': 'Donker',
  'chart.embed.colourAuto': 'Volgt apparaat van de lezer',
  'chart.embed.chartTypeLabel': 'Grafiektype',
  'chart.embed.chartTypeAsShown': 'Zoals getoond',
  'chart.embed.chartTypeDefault': 'Standaard',
  'chart.embed.liveLabel': 'Live insluiten',
  'chart.embed.liveProOnly':
    'Onderdeel van Pro. De ingesloten grafiek werkt zichzelf automatisch bij wanneer het CBS de cijfers corrigeert of aanvult.',
  'chart.embed.proPrice': '€19 / maand',
  'chart.embed.proUpgradeCta': 'Interesse in Pro',
  'chart.embed.proUpgradeThanks': 'Bedankt! We laten het weten zodra Pro beschikbaar is.',
  'chart.embed.copyCode': 'Kopieer code',
  'chart.embed.copyCodeCopied': 'Gekopieerd!',
  'chart.embed.close': 'Sluiten',
  'chart.embed.unavailable': 'Insluiten is nu niet beschikbaar.',
  'chart.embed.loading': 'Code wordt gemaakt…',
  // #254 Task 6 addendum: insluiten publiceert altijd de standaardlezing
  // (de opgeslagen audit-rij kent geen lezingkeuze) — deze reden verschijnt
  // zodra een andere lezing dan de standaard is gekozen, zodat een lezer
  // nooit denkt dat de getoonde (afwijkende) lezing wordt gepubliceerd.
  'chart.embed.readingDisabledReason':
    'Insluiten publiceert altijd de standaardlezing van deze grafiek, niet de gekozen lezing. Kies eerst de standaardlezing om in te sluiten.',

  // WP-B (journey programme, phase 3/4 R5.1/R5.4/R6) — trust pages, footer
  // links and the landing "Publiceer" step. Added as one block at the tail
  // per the WP-B brief (this file is edited in parallel by another WP).
  'footer.werkwijzeLabel': 'Werkwijze',
  'footer.privacyLabel': 'Privacy',
  'trust.draftNote': 'Concept — wordt nog nagekeken.',
  'werkwijze.pageTitle': 'Werkwijze — Check de Cijfers',
  'werkwijze.heading': 'Hoe we werken',
  'werkwijze.publicClaim':
    'Elk getal dat we tonen is herleidbaar naar een officiële CBS-cel, met bron en datum erbij getoond.',
  'werkwijze.step1Title': '1. Je stelt een vraag',
  'werkwijze.step1Body':
    'Een taalmodel leest alleen wat je vraagt — het rekent nooit en verzint nooit een cijfer. Het herkent welk CBS-onderwerp, welke regio en welke periode je bedoelt.',
  'werkwijze.step2Title': '2. Deterministische code haalt het cijfer op',
  'werkwijze.step2Body':
    'De vraag wordt vertaald naar een exacte opzoeking in onze eigen database met vooraf ingeladen CBS-tabellen. Geen enkel getal komt uit het taalmodel zelf.',
  'werkwijze.step3Title': '3. We tonen het antwoord met bron en datum',
  'werkwijze.step3Body':
    'Elk antwoord vermeldt de CBS-tabel, de synchronisatiedatum en de licentie (CC BY 4.0), zodat je het zelf kunt naslaan.',
  'werkwijze.provisionalHeading': 'Wat betekent "voorlopig"?',
  'werkwijze.provisionalBody':
    'CBS publiceert sommige cijfers eerst als voorlopig of nader voorlopig voordat ze definitief worden. Als een cijfer niet definitief is, zeggen we dat er expliciet bij. Een definitief cijfer kan later alsnog door CBS worden herzien — dat gebeurt af en toe bij grote revisies.',
  'werkwijze.refusalHeading': 'Wat betekent een weigering?',
  'werkwijze.refusalBody':
    'Als een vraag niet eenduidig is, buiten onze geladen gegevens valt, of om een voorspelling of mening vraagt, weigeren we liever te antwoorden dan te gokken. Je krijgt dan uitleg en, waar mogelijk, een bruikbaar alternatief.',
  'werkwijze.notCoveredHeading': 'Wat de claim niet dekt',
  'werkwijze.notCoveredBody':
    'De herleidbaarheidsclaim geldt voor CBS-cijfers uit ons register. Ze geldt niet voor je eigen geüploade data, voor internetresultaten (apart gemarkeerd als niet geverifieerd), of voor andere bronnen — die kunnen in de toekomst worden toegevoegd, maar zijn dat vandaag niet.',
  'privacy.pageTitle': 'Privacy — Check de Cijfers',
  'privacy.heading': 'Privacy',
  'privacy.storedHeading': 'Wat we bewaren',
  'privacy.storedBody':
    'We bewaren je vragen en antwoorden als een auditspoor (zodat elk getal herleidbaar blijft) en je accountgegevens (e-mailadres). Vragen van bezoekers zonder account bewaren we losstaand van je account.',
  'privacy.retentionHeading': 'Hoe lang we het bewaren',
  'privacy.retentionBody':
    'Vraaggeschiedenis bij een account bewaren we 2 jaar; vragen van anonieme bezoekers (proefvragen) bewaren we 90 dagen. Je kunt je eigen vraaggeschiedenis altijd zelf verwijderen via het accountmenu.',
  'privacy.llmHeading': 'Verwerking door een taalmodel',
  'privacy.llmBody':
    'Je vraag wordt verwerkt door een taalmodel van Anthropic om de vraag te begrijpen en het antwoord te verwoorden — nooit de ruwe CBS-cijfers zelf, die komen altijd uit onze eigen database.',
  'privacy.paymentHeading': 'Betalingen',
  'privacy.paymentBody': 'Stripe verwerkt betalingen als onze betaaldienstverlener. Wij slaan geen kaart- of bankgegevens op.',
  'privacy.cookiesHeading': 'Cookies',
  // Strong-tier review HIGH-2: this used to claim "no tracking cookies or
  // analytics — only a session cookie", which the build contradicts. As
  // built: the anonymous trial sets a per-browser visitor_id cookie (ADR 036
  // D2) and stores a hashed IP (trial_questions.ip_hash, migration 020) for
  // abuse limits, purged after 90 days; the chart-style counter
  // (app/usage-actions.ts, ADR 039 / #220) records aggregate per-day event
  // counts with no user id and no IP. All of that is disclosed here.
  'privacy.cookiesBody':
    'Om je ingelogd te houden gebruiken we één noodzakelijk sessiecookie. Gebruik je de proefversie zonder account, dan zetten we daarnaast een cookie met een willekeurig bezoekersnummer en bewaren we een versleutelde (gehashte) versie van je IP-adres — allebei alleen om misbruik van de gratis proef te beperken, en na 90 dagen verwijderd. Daarnaast tellen we per dag hoe vaak bepaalde acties gebeuren, als kale aantallen zonder account, gebruikersnaam of IP-adres, dus niet herleidbaar naar een persoon. Verder geen trackingcookies en geen analytics van derden.',
  'privacy.contactHeading': 'Contact',
  'privacy.contactBody': 'Vragen over je gegevens? Mail [contact e-mail — eigenaar vult dit aan].',

  // /about — owner punch-list item 6 (session 102). Same shell as /privacy;
  // NOT the placeholder above (that one is unrelated, privacy-specific and
  // deliberately left as a TODO) — this contact line has a real address.
  'about.pageTitle': 'Over ons — Check de Cijfers',
  'about.heading': 'Over ons',
  'about.introHeading': 'Over Check de Cijfers',
  'about.introBody':
    'Check de Cijfers beantwoordt vragen over officiële CBS-statistieken. Een taalmodel leest je vraag, maar rekent zelf nooit: elk cijfer komt uit een database met CBS-data en is te herleiden tot de brontabel en de datum. We maken het voor journalisten, onderzoekers en studenten die snel een betrouwbaar cijfer nodig hebben, met een bron die ze kunnen verantwoorden.',
  'about.contactHeading': 'Contact',
  'about.contactIntro': 'Vragen, opmerkingen of feedback? Mail ons op',

  'landing.ontdekCaption': 'Probeer het meteen: Opmaak (sjablonen), Inzichten, Presenteren — en download als PNG.',
  'landing.step4Title': 'Publiceer',
  'landing.step4Body': 'Kies een sjabloon, download of embed — bron en datum reizen mee.',
  // WP-C (journey programme, session 96): R10 credits-page pack copy, R2.4
  // purchase poll banner, R9.2 phone-header account-menu labels (reusing
  // header.credits/header.history text, no new keys needed there), and R5.3
  // the anonymous-Insights login line. Digit-free where noted — the packQuestions
  // and packPricePerQuestion strings carry the ONLY digits (via {n}/{price},
  // computed server-side from the pack's own priceCents/credits, never
  // hardcoded), and neither can appear inside a chart card.
  // Row 7 (session 110 UX audit): the pack's own price/credits line, built
  // from its priceCents/credits rather than the DB-stored `label` (which was
  // a fixed Dutch string, e.g. "€30 — 2.000 credits", shown even in English)
  // — both {price} and {credits} are pre-formatted via Intl.NumberFormat for
  // the page's own language before being substituted in.
  'credits.packLabel': '{price} — {credits} credits',
  // Row 13: the Buy button's accessible name, same pre-formatted vars.
  'credits.buyAriaLabel': 'Koop {price} — {credits} credits',
  'credits.packQuestions': '≈ {n} gewone vragen',
  'credits.packPricePerQuestion': '{price} per vraag',
  'credits.neverExpires': 'Credits verlopen nooit. Geen abonnement.',
  'chart.story.loginForInsights': 'Log in voor AI-verwoorde inzichten.',
  // ---- WP-D (journey programme, 2026-09-12, session 97) -----------------
  // R2.1: the chip caption now varies by message kind — a clarification's
  // chips are the WP26 options ("kies een optie"), a refusal retry chip
  // offers an alternative ("probeer dit in plaats daarvan"), an answer's
  // follow-up chips keep the existing `chat.suggestionsHint` unchanged.
  'chat.clarificationOptionsHint': 'Kies een optie:',
  'chat.refusalRetryHint': 'Probeer in plaats daarvan:',
  // R2.2 (#69/#75/#211): the insufficient-credits message, split into a
  // base sentence (unchanged numbers, `chat.insufficientCredits` below kept
  // for the deploy-window / generic fallback) and a buy line that renders
  // `/credits` as a REAL link — with or without a named covering pack,
  // depending on whether `packs` was threaded in.
  'chat.insufficientCreditsBase': 'Je hebt niet genoeg credits ({balance} over, {required} nodig).',
  'chat.insufficientCreditsBuyPack': 'Koop bijvoorbeeld {packLabel} via',
  'chat.insufficientCreditsBuyGeneric': 'Koop credits via',
  // R2.3 (#69): appended to the pre-send price line, amber-tinted, only when
  // `simple <= balance < 2 * simple` — the #68 rule allows comparing the
  // server's own numbers, never recomputing a cost.
  'chat.lowBalanceSuffix': ' Genoeg voor nog één vraag.',
  // R11: an honest elapsed-time reassurance line — real wait time, never a
  // fabricated pipeline stage (#211 addendum) — after 8 real seconds of busy.
  'chat.slowWaitNotice': 'Dit duurt iets langer dan gewoonlijk; we controleren het antwoord nog.',
  // ---- WP-E (journey programme, 2026-09-12, session 98) -----------------
  // R4: the coverage disclosure — collapsed by default, one row per served
  // CBS table (title, MEASURED sync date, concepts, an optional example
  // question), plus an honest "Eurostat — coming" group that never claims to
  // answer anything (principle c). Digit-free chrome — the sync date and
  // example question are CONTENT (measured/registry-built), not chart-card
  // chrome, so they are exempt from the whole-card digit scan.
  'coverage.summary': 'Welke bronnen zijn ingebouwd?',
  'coverage.cbsHeading': 'CBS',
  'coverage.syncedOn': 'gesynchroniseerd {date}',
  // The example question itself stays DUTCH in both languages: the answer
  // pipeline parses Dutch (CLAUDE.md language carve-out) — translating it
  // would break the parse, not localise it.
  'coverage.exampleLabel': 'bijvoorbeeld: {question}',
  'coverage.onRequestLine': 'Andere CBS-onderwerpen halen we op verzoek op.',
  'coverage.landingHeading': 'Dit weten we nu',

  // #237/ADR 046 (session 98, journey programme "public face"): the
  // positioning sentence — chatten van officieel CBS-onderzoek naar een
  // ingesloten, gesourcete grafiek — and the public gallery of curated
  // stories that shows it live. Digit-free throughout (messages.test.ts's
  // digit-parity rule, plus the whole-card chart digit scans): no card here
  // ever states a number, the live ChartView underneath does that.
  // Fix-wave finding 7: "ingesloten"/embedded promised a feature that does
  // not ship on this branch (PR #9 not merged) — softened to what is
  // actually true today: a chart with its source shown, ready to share.
  'landing.heroSubtitleV2':
    'Stel je vraag in gewone taal en chat zo van officieel CBS-onderzoek naar een grafiek met bron erbij, klaar om te delen.',
  'landing.ctaGallery': 'Bekijk de galerij',
  'gallery.teaserHeading': 'Verhalen uit de galerij',
  'gallery.teaserAllLink': 'Alle verhalen',
  'gallery.pageTitle': 'Galerij — Check de Cijfers',
  'gallery.heading': 'De galerij',
  // Fix-wave finding 7: "gesourcete" is not Dutch, and the claim must match
  // what actually ships on this branch — built from real CBS-cijfers, with
  // bron en datum, never "gesourcet" or "echt" as vague marketing filler.
  'gallery.intro':
    'Elke kaart hieronder is gebouwd uit officiële CBS-cijfers, met bron en datum erbij — door dezelfde deterministische motor die ook antwoorden geeft in de chat. Klik op Inzichten om te zien wat erin opvalt.',
  'gallery.embedComingSoon': 'Zelf inline insluiten komt binnenkort.',
  // #3 (session 110 UX audit): shown instead of a silent empty grid while
  // getGalleryStories() is still building its cache (a cold read, #190) —
  // see gallery.tsx's GalleryLoadingRow.
  'gallery.loadingNote': 'Bezig met laden — vernieuw de pagina zo dadelijk als dit leeg blijft.',
  // Fix-wave finding 4: every title is now the QUESTION a reader would have
  // typed in chat — it demonstrates the positioning sentence directly and
  // never repeats the chart's own on-screen title one line below. The
  // separate "lead" line was dropped: the question already says it.
  'gallery.story.consumentenvertrouwen.title': 'Hoe optimistisch zijn Nederlanders?',
  'gallery.story.economische-groei.title': 'Hoe hard groeide de economie?',
  'gallery.story.inflatie.title': 'Wat deed de inflatie?',
  'gallery.story.huizenprijzen.title': 'Wat kostte een huis?',
  'gallery.story.werkloosheid.title': 'Hoe hoog was de werkloosheid?',
  'gallery.story.faillissementen.title': 'Hoeveel bedrijven gingen failliet?',
  'gallery.story.producentenprijzen.title': 'Wat deden de producentenprijzen?',
  'gallery.story.detailhandelsomzet.title': 'Hoe deed de detailhandel het?',
  'gallery.story.supermarktomzet.title': 'Hoe deden de supermarkten het?',
  'gallery.story.consumptie-huishoudens.title': 'Hoeveel gaven huishoudens uit?',
  'gallery.story.werkloosheid-maandelijks.title': 'Hoe ontwikkelde de werkloosheid zich per maand?',
  'gallery.story.zonnestroom.title': 'Hoeveel stroom kwam er uit zonnepanelen?',

  // --- ADR 049: the 3D municipality DEMO (route kept out of this comment on purpose — isolation.test.ts pins that the string never appears outside its own directory). Every number on that page is fiction; these labels say so. ---
  'lab3d.pageTitle': 'Demo: 3D-gemeentekaart (fictieve data) — Check de Cijfers',
  'lab3d.title': 'Nederland groeit, maar niet overal',
  'lab3d.intro': 'Een demonstratie van een 3D-kaart: elke gemeente is een kolom, de hoogte staat voor het aantal inwoners en de kleur voor de groei sinds het startjaar. Alle cijfers zijn verzonnen; alleen de gemeentegrenzen en -namen zijn echt.',
  'lab3d.badge': 'DEMO — FICTIEVE DATA',
  'lab3d.badgeDetail': 'Elke waarde op deze pagina is verzonnen, alleen ter demonstratie. Dit is geen CBS-cijfer.',
  'lab3d.watermark': 'FICTIEF',
  'lab3d.footer': 'Cijfers: fictief, alleen ter demonstratie. Gemeentegrenzen: CBS/PDOK via cartomap.github.io, licentie CC BY 4.0.',
  'lab3d.mapLabel': '3D-kaart van gemeenten (fictieve data)',
  'lab3d.year': 'Jaar',
  'lab3d.play': 'Afspelen',
  'lab3d.pause': 'Pauzeren',
  'lab3d.resetView': 'Herstel weergave',
  'lab3d.typeLabel': 'Gemeentetype',
  'lab3d.typeAll': 'Alle gemeenten',
  'lab3d.typeCity': 'Stad',
  'lab3d.typeMid': 'Middelgroot',
  'lab3d.typeRural': 'Landelijk',
  'lab3d.pickLabel': 'Gemeente',
  'lab3d.pickNone': 'Kies een gemeente',
  'lab3d.population': 'Inwoners (fictief)',
  'lab3d.growth': 'Groei sinds startjaar (fictief)',
  'lab3d.legendLow': 'krimp',
  'lab3d.legendHigh': 'groei',
  'lab3d.heightNote': 'Hoogte = inwoners (fictief) · kleur = groei (fictief)',
  'lab3d.loading': 'Kaart laden…',
  'lab3d.unavailable': 'Deze browser kan geen 3D tonen (WebGL ontbreekt).',
  'lab3d.loadFailed': 'De gemeentegrenzen konden niet worden geladen.',
  // v2 (D4′, session 104): the guided narrative card below the map — five
  // static steps drawing on this demo's OWN scale/domain constants
  // (GROWTH_DOMAIN, YEAR_START/YEAR_END), filled in via t()'s {vars} so the
  // numbers can never drift from scales.ts/fake-data.ts.
  'lab3d.narrativeTitle': 'Zo lees je deze kaart',
  'lab3d.narrativePrev': 'Vorige',
  'lab3d.narrativeNext': 'Volgende',
  'lab3d.narrativeDotLabel': 'Ga naar stap {n} van {total}',
  'lab3d.narrativeStep1': 'Elke gemeente is twee dingen tegelijk: een gekleurd vlak op de kaart én een kolom die erboven uitsteekt.',
  'lab3d.narrativeStep2': 'De hoogte van de kolom staat voor het aantal inwoners — hoe hoger, hoe meer (fictieve) inwoners die gemeente heeft.',
  'lab3d.narrativeStep3': 'De kleur van het vlak én de kolom staat voor groei sinds {start}: blauw is groei, rood-oranje is krimp, tot ongeveer ±{domain}%.',
  'lab3d.narrativeStep4': 'Sleep de tijdbalk van {start} naar {end}, of klik op Afspelen om de groei jaar voor jaar te zien.',
  'lab3d.narrativeStep5': 'Alle cijfers op deze kaart zijn verzonnen, uitsluitend om de techniek te laten zien — geen CBS-cijfer.',

  // Chart co-pilot phase 4 (session 115): difference arrow and average line controls.
  'chart.derived.differenceLabel': 'Verschil aanduiden',
  'chart.derived.differencePick': 'Kies twee punten voor het verschil',
  'chart.derived.meanLabel': 'Gemiddelde tonen',
  'chart.derived.meanPeriodRange': 'Gemiddelde over de zichtbare periode',
  'chart.derived.remove': 'Verwijder',
  'chart.derived.errorMissingRegion': 'Dit kan niet: de punten liggen in verschillende regio\'s.',
  // Final-review fix I6: replaces the old `errorOtherIssue`, which
  // interpolated the server's raw English developer-facing reason string
  // straight into the Dutch UI (e.g. "Dit kan niet: mean needs at least 2
  // source cells, got 1"). These keys cover the known, literal refusal
  // reasons from
  // app/chart-derivation-actions.ts and src/query/derivations.ts
  // (deriveDifference/deriveMean) — see `derivationRefusalMessage` in
  // chart.tsx. A reason NOT in that lookup (mostly the ones carrying a
  // dynamic resultId/count/unit list, which cannot be pre-translated
  // word-for-word without guessing) falls back to `errorGeneric`.
  'chart.derived.errorUnavailableChart': 'Dit kan alleen bij een CBS- of Eurostat-grafiek.',
  'chart.derived.errorAnswerUnavailable': 'Dit antwoord is niet meer beschikbaar.',
  'chart.derived.errorNoChart': 'Bij dit antwoord hoort geen grafiek om uit af te leiden.',
  'chart.derived.errorPointNotOnChart': 'Een van de gekozen punten staat niet in deze grafiek.',
  'chart.derived.errorSamePeriod': 'Kies twee verschillende periodes voor een verschil.',
  'chart.derived.errorGeneric': 'Dit kan niet met deze punten.',

  // Session 110 UX audit pass 3, row 9: /eurostat-explorer's own chrome
  // (labels, buttons, the empty-state paragraph) is internal-tool English
  // by design (D3(a) in the page itself), but the SHARED site footer below
  // it renders in whatever language the reader's `lang` cookie says — so an
  // nl-cookie reader saw an English page with a Dutch footer, one language
  // per page violated. Cheapest honest fix (≤15 new keys would still leave
  // long, code/dynamic-value-bearing strings like the empty-state paragraph
  // untranslated and inconsistent) is a single intro sentence, in the
  // reader's OWN language, saying so up front — not a full translation of
  // an internal, never-publicly-linked tool.
  'eurostatExplorer.englishOnlyNotice':
    'Deze interne tool is alleen in het Engels beschikbaar; de voettekst hieronder blijft in jouw eigen taal.',
};

// `Messages` is derived from the (widened, non-`const`) Dutch object above,
// so every property type is `string` rather than a literal — which is what
// lets `en` below be assigned a DIFFERENT string per key while TypeScript
// still enforces the SAME set of keys (excess-property checking on a
// directly-annotated object literal catches both a missing and a stray key).
export type Messages = typeof nl;
export type MessageKey = keyof Messages;

const en: Messages = {
  'lang.switchLabel': 'Language',
  'header.credits': 'Buy credits',
  'header.history': 'History',
  'header.about': 'About us',
  'header.account': 'Account',
  'header.logout': 'Log out',
  'header.busy': 'Working…',
  'header.balance': '{n} credits',

  'common.sessionExpired': 'Your session has expired. Please refresh the page.',
  'common.close': 'Close',

  'chat.placeholder': 'Ask a question…',
  'chat.send': 'Send',
  // #20 (session 110 UX audit): see the nl entry's comment.
  'chat.composerCounter': '{current}/{max}',
  'chat.copyCitation': 'Copy',
  'chat.copyCitationCopied': 'Copied!',
  'chat.downloadCsv': 'CSV',
  'chat.downloadCsvFailed': 'Download did not work in this browser.',
  'chat.webSectionHeader': 'From the web (not verified by checkdecijfers)',
  'chat.webSectionFailedInsufficientBalance':
    'The web search was not run (insufficient balance) — no extra cost.',
  'chat.webSectionFailedGeneric': 'The web search failed — no extra cost.',
  'chat.unauthenticated': 'You are not logged in. Log in via /login to ask a question.',
  'chat.duplicateRequest': 'This question is already being processed — please wait.',
  'chat.insufficientCredits': 'You do not have enough credits ({balance} left, {required} needed). Buy credits via /credits.',
  'chat.redactedMessage': 'This question has been deleted.',
  'chat.refusalHeader': 'I could not answer this',
  'chat.refusalBadge': 'no answer = no guess',
  'chat.provisionalBadge': 'provisional',
  'chat.replyCostSuffix': ' · answering the follow-up question costs ~{price} credits',
  'chat.costCredits': '{n} credits',
  'chat.onboardingOfferButton': 'Fetch for {n} credits',
  'chat.dockedChipChart': 'Chart in panel →',
  'chat.dockedChipCard': 'Card in panel →',
  'chat.busyBoth': 'Searching CBS figures and the web…',
  'chat.busyWebOnly': 'Searching the web…',
  'chat.busyCbsOnly': 'Searching CBS figures…',
  'chat.staleDeployPrefix':
    'The site was just updated, so this question was not sent (no credits were charged).',
  'chat.staleDeployButton': 'Refresh the page',
  'chat.staleDeploySuffix': 'and ask your question again.',
  'chat.genericError': 'Something went wrong getting the answer. Please try again.',
  'chat.nothingSelectedHint': 'Select at least one source.',
  'chat.suggestionsHint': 'Suggested follow-up questions:',
  'chat.sourceDataSuffix': '{name} data',
  'chat.internetChip': 'Internet',
  'chat.addLink': 'Add link',
  'chat.uploadFile': 'Upload file',
  'chat.uploadFileComingSoonTitle': 'Coming soon: upload a file (e.g. PDF)',
  'chat.linkWithSheet': 'Link sheet',
  'chat.linkWithSheetComingSoonTitle': 'Coming soon: connect a spreadsheet (e.g. Google Sheets)',
  'chat.connectDatabase': 'Connect data',
  'chat.connectDatabaseComingSoonTitle': 'Coming soon: connect a data source (e.g. a Postgres database)',
  'chat.linkUrlPlaceholder': 'https://example.com/page-with-a-table',
  'chat.fetchButton': 'Fetch',
  'chat.linkComingSoonMessage': "This isn't available yet — coming soon.",
  'chat.fileReading': 'Reading file…',
  'chat.fileReadError': 'Something went wrong reading that file. Please try again.',
  'chat.pricingBoth':
    'A question costs ~{total} credits ({addon} of which for internet) · balance: {balance} credits. If I first ask a clarifying question, that costs {clarification} credits and you get the rest back.',
  'chat.pricingWebOnly':
    'A question costs ~{addon} credits ({reserved} is temporarily reserved) · balance: {balance} credits.',
  'chat.pricingDefault':
    'A question costs ~{simple} credits · balance: {balance} credits. If I first ask a clarifying question, that costs {clarification} credits and you get the rest back.',

  'sidebar.collapsedExpandLabel': 'Show chats',
  'sidebar.collapseLabel': 'Hide chats',
  'sidebar.navLabel': 'Chats',
  'sidebar.header': 'Chats',
  'sidebar.newChat': 'New chat',
  'sidebar.searchPlaceholder': 'Search chats',
  'sidebar.searchLabel': 'Search chats',
  'sidebar.empty': 'No chats yet.',
  'sidebar.noMatches': 'No chats match “{query}”.',
  'sidebar.datasetThreadTitle': 'Your data: {title}',
  'sidebar.optionsLabel': 'Chat options',
  'sidebar.deleteChat': 'Delete chat',
  'sidebar.deleteConfirmLabel': 'Delete this chat?',
  'sidebar.deleteConfirmText':
    'Delete this chat? Its questions also disappear from your history. This can’t be undone.',
  'sidebar.deleteButton': 'Delete',
  'sidebar.deletingButton': 'Deleting…',
  'sidebar.cancelButton': 'Cancel',
  'sidebar.deleteFailed': 'Couldn’t delete this chat. Try again later.',

  'workspace.newChatTitle': 'New chat',
  'workspace.chatSectionLabel': 'Chat',
  'workspace.purchaseSuccessMessage': 'Thanks! Your balance will appear here once Stripe confirms the payment.',
  'workspace.purchaseSuccessDismiss': 'Close',

  'dock.header': 'Charts',
  'dock.tablistLabel': 'Visualizations',
  'dock.chartTab': 'Chart {n}',
  'dock.cardTab': 'Card {n}',

  'datasetChat.needsDecisionFallback': 'Nothing left to decide.',
  'datasetChat.noLongerNeedsDecision': 'This file no longer needs a decision — it may have been deleted.',
  'datasetChat.saveChoiceError': 'Something went wrong saving that choice. Please try again.',
  'datasetChat.insufficientCredits': 'Not enough credits (need {required}, you have {balance}).',
  'datasetChat.notFound': 'This file is no longer available.',
  'datasetChat.answerError': 'Something went wrong answering that question. Please try again.',
  'datasetChat.redactedMessage': 'This question has been deleted.',
  'datasetChat.chipChartInPanel': 'Chart in panel →',
  'datasetChat.busy': 'Working on it…',
  'datasetChat.placeholder': 'Ask about your data…',
  'datasetChat.send': 'Send',

  'userChart.keyboardHint': 'Use the arrow keys to move through the chart’s points.',
  'userChart.heading': '{y} by {x}',
  'userChart.accessibleName': 'Chart: {heading}',
  'userChart.provenanceLine': 'From file {file}, uploaded {date} · {count} points plotted',
  'userChart.title.placeholder': 'Title above the chart',
  'userChart.title.edit': 'Edit title',
  'userChart.title.add': 'Add a title',
  'userChart.title.save': 'Save',
  'userChart.title.cancel': 'Cancel',
  'userChart.renderFailed.validation': "This combination can't be drawn.",
  'userChart.renderFailed.zero_rows': 'No rows match this filter.',
  'userChart.renderFailed.too_many_points': 'Too many points — filter first.',


  'chart.data.trigger': 'Data',
  'chart.data.regionLabel': 'Which data this chart shows',
  'chart.data.close': 'Close',
  'chart.data.kind': 'Chart type',
  'chart.data.kindLine': 'Line',
  'chart.data.kindBar': 'Bar',
  'chart.data.x': 'Horizontal axis',
  'chart.data.y': 'Values',
  'chart.data.seriesBy': 'Split by',
  'chart.data.none': 'None',
  'chart.data.filters': 'Filters',
  'chart.data.filterValues': 'Values of {col}',
  'chart.data.filterFrom': 'From {col}',
  'chart.data.filterTo': 'To {col}',
  'chart.data.filterClear': 'Clear filter: {col}',
  'chart.data.sort': 'Sort by',
  'chart.data.sortNone': 'No sorting',
  'chart.data.sortX': 'Horizontal axis',
  'chart.data.sortValue': 'Value',
  'chart.data.direction': 'Direction',
  'chart.data.directionAsc': 'Ascending',
  'chart.data.directionDesc': 'Descending',
  'chart.data.limit': 'Maximum number',
  'chart.data.aggregate': 'Summarise',
  'chart.data.agg.sum': 'Sum',
  'chart.data.agg.mean': 'Average',
  'chart.data.agg.min': 'Lowest',
  'chart.data.agg.max': 'Highest',
  'chart.data.agg.count': 'Count of rows',
  'chart.data.derived': 'Calculation',
  'chart.data.derived.difference': 'Difference',
  'chart.data.derived.share_of_total': 'Share of total',
  'chart.data.derived.percent_change': 'Change',
  'chart.data.derived.ratio': 'Ratio',
  'chart.data.derivedB': 'Second column',
  'chart.data.problem': "That isn't possible: {message}",
  'chart.data.summary.aggregate': '{fn} of {y}',
  'chart.data.summary.by': 'by {x}',
  'chart.data.summary.splitBy': 'split by {s}',
  'chart.data.summary.filtered': 'filtered on {cols}',
  'chart.data.summary.highestFirst': 'highest first',
  'chart.data.summary.lowestFirst': 'lowest first',
  'chart.data.summary.sortAsc': 'ascending by {col}',
  'chart.data.summary.sortDesc': 'descending by {col}',
  'chart.data.summary.top': 'top {n}',
  'chart.data.summary.limited': 'limited',
  'chart.data.summary.difference': '{a} minus {b}',
  'chart.data.summary.ratio': '{a} divided by {b}',
  'chart.data.summary.shareOfTotal': 'share of {a}',
  'chart.data.summary.percentChange': 'change in {a}',
  'chart.data.summary.column': 'column',
  'chart.data.count.one': 'one',
  'chart.data.count.two': 'two',
  'chart.data.count.three': 'three',
  'chart.data.count.four': 'four',
  'chart.data.count.five': 'five',
  'chart.data.count.six': 'six',
  'chart.data.count.seven': 'seven',
  'chart.data.count.eight': 'eight',
  'chart.data.count.nine': 'nine',
  'chart.data.count.ten': 'ten',

  'chart.copilot.placeholder': 'Adjust this chart',
  'chart.copilot.regionLabel': 'Adjust this chart through chat',
  'chart.copilot.send': 'Send',
  'chart.copilot.busy': 'Working…',
  'chart.copilot.examplesLabel': 'Examples',
  'chart.copilot.undoReply': 'Undo this reply',
  'chart.copilot.retry': 'Try again (costs credits)',
  'chart.copilot.thumbsUp': 'This reply was good',
  'chart.copilot.thumbsDown': 'This reply was not good',
  'chart.copilot.feedbackThanks': 'Thanks for your feedback.',
  'chart.copilot.cost': 'Cost {n} credits',
  'chart.copilot.dropped': 'One item could not be applied.',
  'chart.copilot.droppedMany': 'A few items could not be applied.',
  'chart.copilot.error.failed': 'That adjustment did not work. Please try again.',
  'chart.copilot.error.duplicate': 'This adjustment was already processed. Refresh the page to see the result.',
  'chart.copilot.undoUnavailable': 'This reply is no longer the latest change. Use Undo or the edit history.',
  'chart.copilot.undone': 'undone',
  'chart.copilot.reason.not_available': 'is not something this chart offers',
  'chart.copilot.reason.not_on_this_chart': 'is not on this chart',
  'chart.copilot.reason.needs_click': 'needs a click',
  'chart.copilot.reason.unplotted_number': 'contains a number that is not on the chart',
  'chart.copilot.reason.invalid': 'could not be applied',
  'chart.copilot.hint.notes': 'Notes: click a point on the chart.',
  'chart.copilot.hint.style': 'Style: open the Style panel.',
  'chart.copilot.hint.data': 'Data: open the Data panel.',
  'chart.copilot.hint.form': 'View: pick a form above the chart.',
  'chart.copilot.hint.none': '',
  'chart.copilot.example.totalPer': 'Total per {col}',
  'chart.copilot.example.spotlight': 'Spotlight {series}',
  'chart.copilot.example.highestFirst': 'Highest first',
  'chart.copilot.example.shorterTitle': 'Make the title shorter',
  'chart.copilot.example.addTitle': 'Give the chart a title',
  'chart.copilot.example.makeBar': 'Make it a bar chart',
  'chart.copilot.example.hideGrid': 'Hide the grid',
  'chart.copilot.example.lastYears': 'Only the last few years',
  'chart.copilot.example.newsroomLook': 'Give it the newsroom look',
  'chart.copilot.followUp': 'Ask as a follow-up question',
  'chart.copilot.followUpHint': 'This asks for other data. As a follow-up it gets its own answer and chart.',
  'chart.copilot.tableLocked': 'In table form the chat is off: pick a chart form above the chart first.',
  'chart.copilot.cbsLocked':
    'The figures themselves do not change here: this is an official chart. Form, period, series, style and text do.',
  'chart.extended.badge': 'Chart extended',
  'chart.extended.hint': 'Continues the previous chart: the same source and unit, in the same form and look.',

  'feedback.helpful': 'Helpful answer',
  'feedback.notHelpful': 'Not helpful',
  'feedback.thanks': 'Thanks for your feedback.',
  'feedback.failed': 'Feedback could not be saved.',
  'feedback.textPlaceholder': 'What could be better? (optional)',
  'feedback.submitWithText': 'Send feedback',
  'feedback.skip': 'Skip',

  'answerProof.triggerSingle': 'Prove this number',
  'answerProof.triggerPlural': 'Prove these numbers',
  'answerProof.regionLabel': 'Evidence for this answer',
  'answerProof.technicalToggle': 'Technical details',
  'answerProof.whyHeading': 'Why this answer',
  'answerProof.cellsHeading': 'The cells used',
  'answerProof.stepsHeading': 'Step by step',
  'answerProof.readingLine': 'Reading used: {reading}.',
  'answerProof.periodSemanticsLine': 'Period meaning: {value}',
  'answerProof.notChosenLine': 'Not chosen: {label}',
  'answerProof.colSubject': 'Subject',
  'answerProof.colRegion': 'Region',
  'answerProof.colPeriod': 'Period',
  'answerProof.colValue': 'Value',
  'answerProof.colStatus': 'Status',
  'answerProof.colCellId': 'Cell ID',
  'answerProof.colMeasureCode': 'Measure code',
  'answerProof.colRegionCode': 'Region code',
  'answerProof.colPeriodCode': 'Period code',
  'answerProof.colBatch': 'Batch',
  'answerProof.dateUnknown': 'unknown',
  'answerProof.tableCaption': 'Table {tableId} — {tableTitle} · version {version} · synced {date} · licence {license}',
  'answerProof.highlightLinkTitle': 'View this cell at CBS',
  'answerProof.requestUrlsHeading': 'Fetched URLs',
  'answerProof.requestUrlsBatchLabel': 'Batch {batchId}:',

  // WP218 phase 4 (#219), Task 3 (Sweep B). Faithful MEANING translations of
  // the Dutch marketing copy — the Dutch headline stays owner-pinned verbatim
  // (see the nl block); this is not a literal word-for-word rendering.
  'landing.heroTitle': "Chat with the Netherlands' official statistics",
  'landing.ctaStart': 'Start asking',
  'landing.ctaHowItWorks': 'How it works',
  'landing.exampleLabel': 'How the product answers — a real example',
  'landing.howItWorksHeading': 'No guesswork, just computation',
  'landing.step1Title': 'You ask',
  'landing.step1Body': 'In plain language — “what’s inflation doing?”, “how fast did the economy grow?”',
  'landing.step2Title': 'Code computes',
  'landing.step2Body':
    'The answer comes from our database of official CBS figures — deterministic calculation, no language model inventing numbers.',
  'landing.step3Title': 'Source included',
  'landing.step3Body':
    'Every figure comes with its CBS table, period and publication status. When we are not sure, we say so — no answer beats a made-up one.',
  'landing.pricingHeading': 'Honest, per-question pricing',
  'landing.pricingBody':
    'You pay per question with credits — no subscription. Creating an account is free and takes seconds: enter your email, click the login link, start asking.',
  'common.createFreeAccount': 'Create a free account',

  'login.pageHeading': 'Log in',
  'login.pageBody': 'Enter your email address; you will get a login link. No password needed.',
  'login.sentMessage': 'Check your email for the login link.',
  'login.emailPlaceholder': 'you@example.com',
  'login.sendMagicLink': 'Send login link',
  'login.or': 'or',
  'login.continueWithGoogle': 'Continue with Google',
  'login.emailRequired': 'Email address is required.',
  'login.magicLinkFailed': 'Something went wrong sending the login link. Please try again.',
  'login.googleFailed': 'Signing in with Google did not work. Please try again or use the login link.',

  'credits.pageHeading': 'Credits',
  'credits.balancePrefix': 'Your current balance:',
  'credits.creditsWord': 'credits.',
  'credits.purchaseSuccess': 'Thanks! Your balance will appear here once Stripe confirms the payment.',
  'credits.purchaseCancelled': 'Payment cancelled.',
  // Task 11 (#205): the Pro subscription Checkout's own success/cancel pair.
  'credits.proSuccess': 'Thanks! Your Pro subscription will appear here once Stripe confirms the payment.',
  'credits.proCancelled': 'Pro subscription cancelled.',
  'credits.buy': 'Buy',
  'credits.unknownPack': 'Unknown or no longer available pack.',
  'credits.notLoggedIn': 'You are not logged in.',
  'credits.unavailable': 'Payments are not available right now.',
  'credits.startFailed': 'Something went wrong starting the payment.',
  'credits.noCheckoutUrl': 'Stripe did not return a checkout URL.',

  'history.today': 'Today',
  'history.yesterday': 'Yesterday',
  'history.last7': 'Last 7 days',
  'history.older': 'Older',

  'history.pageHeading': 'History',

  'history.empty': 'No previous questions yet.',
  'history.heading': 'Previous questions',
  'history.creditsInline': '{n} credits · ',
  'history.creditsInlineTotal': '{n} credits total · ',
  'history.deletedQuestionLabel': 'Deleted question',
  'history.deletedBody': 'The text of this question has been deleted.',
  'history.clarificationLabel': 'Clarifying question',
  'history.yourReplyLabel': 'Your reply',
  'history.moreAboutMeasurement': 'More about this measurement',
  'history.onboardingPreparingLabel': 'Being prepared',
  'history.onboardingPreparingBody':
    'We are automatically requesting the figures about "{topic}" from CBS now and checking them. You will get an email once your question can be answered.',
  'history.onboardingFailedLabel': 'Could not be retrieved',
  'history.onboardingFailedFallback': 'Retrieving these figures did not work.',
  'history.onboardingFailedRefundSuffix': ' The credits have been refunded.',

  'status.inFlightSingular':
    'There is 1 request being processed at CBS — the status below updates automatically.',
  'status.inFlightPlural':
    'There are {n} requests being processed at CBS — the status below updates automatically.',

  'account.balanceLabel': 'Balance',
  'account.lowBalanceWarning': 'Your balance is almost gone — there is still enough for one more question.',
  'account.explainerWithQuestions':
    "Signing up gets you {grant} credits once. An ordinary question costs {price} credits — so {grant} credits is good for about {questions} questions.",
  'account.explainerNoQuestions': 'Signing up gets you {grant} credits once. An ordinary question costs {price} credits.',

  'footer.attribution': 'Figures: CBS StatLine (CC BY 4.0) · Every number traceable to an official CBS table',
  'footer.attributionEurostat':
    'Figures: Eurostat (CC BY 4.0) · Every number traceable to an official Eurostat dataset',
  'footer.aboutLabel': 'About this project',
  'footer.systemMapLabel': 'System map',

  'deleteHistory.confirmText':
    'Are you sure? Your question texts will be permanently deleted. This cannot be undone.',
  'deleteHistory.confirmYes': 'Yes, delete',
  'deleteHistory.cancel': 'Cancel',
  'deleteHistory.trigger': 'Delete my question history',
  'deleteHistory.failed': 'Deleting did not work. Please try again later.',

  'trial.heading': 'Try it now',
  'trial.subheading':
    'Two free trial questions, no account needed. Every answer comes from official CBS figures, with source and date shown.',
  'trial.potEmpty': 'The free trial pot is empty right now. Log in to continue — an account is free.',
  'trial.unavailable': 'The free trial questions are not available right now. Log in to continue — an account is free.',
  'trial.usedUp': 'You have used your free trial questions. Create a free account to continue.',
  'trial.ipLimit': "This network's free trial questions are used up for today. Create a free account to continue.",
  'trial.error': 'Something went wrong; your trial question was not used. Please try again shortly.',
  'trial.clarificationPrefix':
    "The trial has no follow-up round — rephrase your question more precisely, or ",
  'trial.createAccountInline': 'create a free account',
  'trial.inputPlaceholder': 'E.g. what is inflation right now?',
  'trial.inputAriaLabel': 'Ask your free trial question',
  'trial.submitBusy': 'Computing…',
  'trial.submitIdle': 'Ask',
  'trial.of': 'of',
  'trial.freeQuestionsLeft': 'free trial questions left — no account needed.',

  'sourceBadge.syncedLabel': 'synced {date}',

  'statCard.provisional': 'provisional',
  'statCard.downloadPng': 'Download as image',
  'statCard.downloadFailed': 'Download did not work in this browser.',
  'statCard.attributionLine': '{source} · table {table} · synced {date} · checkdecijfers.nl',

  'themeToggle.groupLabel': 'Theme',
  'themeToggle.light': 'Light theme',
  'themeToggle.dark': 'Dark theme',
  'themeToggle.system': 'System theme',

  'meta.title': 'Check de Cijfers',
  'meta.description': 'Chat with official CBS statistics — every figure traceable to a CBS table.',

  'chart.weergaveLabel': 'View',
  'chart.tabLine': 'Line',
  'chart.tabBar': 'Bar',
  'chart.tabTable': 'Table',
  'chart.lineDisabledReason': 'A line between regions would suggest a trend that was never measured.',
  'chart.form.area': 'Area',
  'chart.form.hbar': 'Horizontal bar',
  'chart.form.dumbbell': 'Dumbbell',
  'chart.form.slope': 'Slope',
  'chart.form.heatmap': 'Heatmap',
  'chart.formReason.areaMultiSeries':
    'A filled area per series would stack the series on top of each other and hide gaps.',
  'chart.formReason.areaComparison': 'An area chart only fits a single series over time.',
  // Session 110 UX audit pass 4, row 7: see the nl entry's comment — the
  // real reason is the time axis, not the region count.
  'chart.formReason.hbarTimeSeries': 'Horizontal bars show one period; this chart spans several.',
  'chart.slopeDisabledReason': "Available once you're comparing exactly two points in time.",
  'chart.dumbbellDisabledReason': 'Available once at least two series each have exactly a start and an end value.',
  'chart.heatmapDisabledReason': "Available once you're comparing at least two series across at least two points in time.",
  'chart.from': 'From',
  'chart.to': 'To',
  'chart.reading.label': 'Reading',
  'chart.reading.primary': 'Default',
  'chart.graphPanelLabel': 'Chart',
  'chart.seriesGroupLabel': 'Series',
  'chart.highlightButton': 'Highlight {label}',
  'chart.highlightTitle': 'Highlight {label}; other series are dimmed',
  'chart.dimButton': 'Dim {label}',
  'chart.dimTitle': 'Dim {label}; visible but with reduced emphasis',
  'chart.hiddenSeriesDisclosure': '{n} of {m} series hidden',
  'chart.zoomDisclosure': 'Shown: {from}–{to} of {coveredFrom}–{coveredTo}.',
  'chart.smallMultiplesToggle': 'Small multiples',
  'chart.axisGroupLabel': 'Shared axes or own axes',
  'chart.sharedAxes': 'Shared axes',
  'chart.ownAxes': 'Own axes',
  'chart.markedInChart': 'Marked in the chart: {label}',
  'chart.keyboardHint': 'Use the arrow keys to move through the chart’s points.',
  'chart.headline.label': 'Latest value on the chart',
  'chart.headline.suggest': 'Suggest headline',
  'chart.headline.edit': 'Edit headline',
  'chart.headline.placeholder': 'Type a headline…',
  'chart.headline.save': 'Save',
  'chart.headline.cancel': 'Cancel',
  'chart.headline.drafting': 'Drafting…',
  'chart.headline.unauthenticated': 'Log in to add a headline.',
  'chart.headline.error': 'Could not save the headline.',
  'chart.headline.draftError': 'Could not suggest a headline.',
  'chart.headline.setOverride': 'Make this the featured number',
  'chart.headline.clearOverride': 'Show default featured number',
  'chart.title.edit': 'Edit title',
  'chart.title.placeholder': 'Your own title',
  'chart.title.original': 'Original title: {title}',
  'chart.caption.add': 'Add a caption',
  'chart.caption.edit': 'Edit caption',
  'chart.caption.placeholder': 'Caption under the chart',
  'chart.caption.save': 'Save',
  'chart.caption.cancel': 'Cancel',
  'chart.history.undo': 'Undo',
  'chart.history.redo': 'Redo',
  'chart.history.undoHint': 'Undo (⌘Z / Ctrl+Z)',
  'chart.history.redoHint': 'Redo (⇧⌘Z / Ctrl+Y)',
  'chart.history.menu': 'Edit history',
  'chart.history.empty': 'No edits yet',
  'chart.history.undone': 'undone',
  'chart.history.source.panel': 'via the panel',
  'chart.history.source.canvas': 'on the chart',
  'chart.history.source.chat': 'via chat',
  'chart.command.setForm': 'View: {form}',
  'chart.command.toggleSeries': 'Series hidden or shown',
  'chart.command.setSeriesView': 'Series restored',
  'chart.command.setHighlight': 'Series highlighted',
  'chart.command.setHighlightOff': 'Highlight off',
  'chart.command.setPeriodRange': 'Period adjusted',
  'chart.command.setPeriodRangeOff': 'Full period',
  'chart.command.setPresentation': 'Style: {keys}',
  'chart.command.replacePresentation': 'Style restored',
  'chart.command.resetPresentation': 'Style reset',
  'chart.command.applyTemplate': 'Template: {id}',
  'chart.command.setReading': 'Other reading',
  'chart.command.addNote': 'Note added',
  'chart.command.removeNote': 'Note removed',
  'chart.command.setTitle': 'Title edited',
  'chart.command.setTitleOff': 'Title restored',
  'chart.command.setCaption': 'Caption edited',
  'chart.command.setCaptionOff': 'Caption removed',
  'chart.command.setInstruction': 'Data: {summary}',
  'chart.command.setHeadlineOverride': 'Featured number edited',
  'chart.command.clearHeadlineOverride': 'Featured number restored',
  'chart.command.addGoalLine': 'Goal line added',
  'chart.command.removeGoalLine': 'Goal line removed',
  'chart.command.addEraShading': 'Era shading added',
  'chart.command.removeEraShading': 'Era shading removed',
  'chart.command.setDimmed': 'Series dimmed',
  'chart.command.addDerivedOverlay': 'Overlay added',
  'chart.command.removeDerivedOverlay': 'Overlay removed',
  'chart.noteAriaLabel': 'Add a note at {series}, {period}',
  'chart.schemaRefusal':
    'This chart was made in a newer version than this page can show. The figures are in the answer itself.',
  'chart.table.period': 'Period',
  'chart.table.region': 'Region',
  'chart.table.value': 'Value',

  'chart.notes.heading': 'Your notes (not CBS data)',
  'chart.notes.delete': 'Delete',
  'chart.notes.deleteAriaLabel': 'Delete the note at {series} · {period}',
  'chart.notes.draftLabel': 'Note at {series} · {period}',
  'chart.notes.save': 'Save',
  'chart.notes.cancel': 'Cancel',
  'chart.notes.sessionOnly': 'Notes are not included in downloads or embeds.',

  'chart.goalLine.heading': 'Your goal lines (not CBS data)',
  'chart.goalLine.add': 'Add goal line',
  'chart.goalLine.valueLabel': 'Value',
  'chart.goalLine.textLabel': 'Label',
  'chart.goalLine.save': 'Save',
  'chart.goalLine.cancel': 'Cancel',
  'chart.goalLine.delete': 'Delete',
  'chart.goalLine.removeAriaLabel': 'Delete {label}',
  // Final-review fix I5: see the `nl` entry's comment — the line itself now
  // is inside downloads/embeds (C2), and it persists across a reload for a
  // signed-in reader on a saved chart (use-chart-edits.ts); only the typed
  // label text stays out of the export and is never checked against a CBS
  // cell.
  'chart.goalLine.sessionOnly': 'This goal is your own note, not checked against CBS figures. The line itself shows up in downloads; the label you type does not, and neither appears in an embed.',

  'chart.eraShading.heading': 'Mark period ranges (not CBS data)',
  'chart.eraShading.delete': 'Delete',
  'chart.eraShading.deleteAriaLabel': 'Delete the marking {period}',
  // Final-review fix I5: see the `nl` entry's comment.
  'chart.eraShading.sessionOnly': 'This marking is your own note, not checked against CBS figures. The band itself shows up in downloads; the label you type does not, and neither appears in an embed.',
  'chart.eraShading.trigger': 'Mark period range',
  'chart.eraShading.fromLabel': 'From',
  'chart.eraShading.toLabel': 'To',
  'chart.eraShading.labelLabel': 'Label',
  'chart.eraShading.labelPlaceholder': 'E.g. financial crisis',
  'chart.eraShading.save': 'Save',
  'chart.eraShading.cancel': 'Cancel',

  'chart.download.trigger': 'Download',
  'chart.download.menuLabel': 'Download format',
  'chart.download.png': 'Download as PNG',
  'chart.download.svg': 'Download as SVG',
  'chart.download.pdf': 'Download as PDF',
  'chart.download.pngTransparent': 'PNG, chart only (transparent, no source line)',
  'chart.download.failed': 'Download did not work in this browser.',

  'chart.smallMultiplesGroupLabel': 'Small multiples per series',
  'chart.smallMultiplesPeriodSpan': 'Period {from} – {to}',

  'chart.toggle.definitionGroupLabel': 'Switch definition',

  'chart.panel.trigger': 'Style',
  'chart.panel.regionLabel': 'Chart style',

  'chart.story.trigger': 'Insights',
  'chart.story.regionLabel': 'Insights for this chart',
  'chart.story.findingsListLabel': 'Findings list',
  'chart.story.hint': 'Scroll or use the arrows',
  'chart.story.prev': 'Previous',
  'chart.story.next': 'Next',
  'chart.story.close': 'Close',
  'chart.story.stepsLabel': 'Steps',
  'chart.story.pointCaption': '{period}: {value} {unit}',
  'chart.story.seriesCaption': '{fromPeriod}: {fromValue} → {toPeriod}: {toValue} {unit}',
  'chart.story.barCaption': '{label}: {value} {unit}',
  'chart.story.provisional': ' (provisional figure)',
  'chart.insights.recordHighTitle': 'Notable high',
  'chart.insights.recordLowTitle': 'Notable low',
  'chart.insights.highestMemberTitle': 'Highest',
  'chart.insights.lowestMemberTitle': 'Lowest',
  'chart.insights.aboveAverageTitle': 'Above average',
  'chart.insights.belowAverageTitle': 'Below average',
  'chart.insights.jumpUpTitle': 'Sharp rise',
  'chart.insights.jumpDownTitle': 'Sharp drop',
  'chart.insights.seriesLabelPrefix': '{series} — ',
  'chart.story.controlsLocked': 'Close the story to change this.',
  'chart.stage.present': 'Present',
  'chart.stage.label': 'Insights presentation',
  'chart.stage.close': 'Close',
  'chart.stage.scrollHint': 'Scroll to continue',
  'chart.stage.autoplay': 'Auto-play',
  'chart.stage.stepsLabel': 'Steps',
  'chart.stage.positionLabel': 'Position in the story',
  'chart.panel.tabsLabel': 'Style sections',
  'chart.panel.tabChart': 'Chart',
  'chart.panel.tabColors': 'Colours',
  'chart.panel.tabFont': 'Font',
  'chart.panel.lineWidth': 'Line thickness',
  'chart.panel.markers': 'Points',
  'chart.panel.grid': 'Gridlines',
  'chart.panel.xLabels': 'X-axis labels',
  'chart.panel.axisLines': 'Axis lines',
  'chart.panel.valueLabels': 'Values',
  'chart.panel.zeroBaseline': 'Y-axis from zero',
  'chart.panel.areaFill': 'Gradient fill',
  'chart.panel.showGroup': 'Show',
  // Audit pass 2, row 12 (2026-09-17): see the `nl` entry above.
  'chart.panel.reset': 'Reset to default',
  'chart.panel.lineWidthOption.thin': 'Thin',
  'chart.panel.lineWidthOption.normal': 'Normal',
  'chart.panel.lineWidthOption.thick': 'Thick',
  'chart.panel.lineWidthOption.extraThick': 'Extra thick',
  'chart.panel.markersOption.all': 'All points',
  'chart.panel.markersOption.ends': 'First and last',
  'chart.panel.markersOption.provisionalOnly': 'Provisional only',
  'chart.panel.gridOption.both': 'Both',
  'chart.panel.gridOption.horizontal': 'Horizontal only',
  'chart.panel.gridOption.none': 'None',
  'chart.panel.xLabelsOption.flat': 'Flat',
  'chart.panel.xLabelsOption.tilted': 'Tilted',
  'chart.panel.colourOf': 'Colour of',
  'chart.panel.hexSuffix': '(hex code)',
  'chart.panel.pickSuffix': 'picker',
  'chart.panel.resetColors': 'Default colours',
  'chart.panel.warnLight': 'This colour is hard to read in the light theme.',
  'chart.panel.warnDark': 'This colour is hard to read in the dark theme.',
  'chart.panel.warnBoth': 'This colour is hard to read in both themes.',
  'chart.panel.font': 'Font',
  'chart.panel.fontDefault': 'Default',
  'chart.panel.accountSave': 'Save as my default',
  'chart.panel.accountForget': 'Forget my default',
  'chart.panel.accountSaved': 'Saved.',
  'chart.panel.accountForgotten': 'Forgotten.',
  'chart.panel.accountUnavailable': 'Saving is not possible right now.',
  'chart.panel.accountError': 'Something went wrong. Try again later.',
  'chart.panel.accountHint': 'My default is active.',
  'chart.panel.brandHeading': 'Brand colours',
  'chart.panel.brandIntro': "Fetch your organisation's colours and font.",
  'chart.panel.brandApply': 'Apply brand colours',
  'chart.panel.brandWebsiteLabel': "Your organisation's website",
  'chart.panel.brandWebsitePlaceholder': 'e.g. yourorganisation.com',
  'chart.panel.brandApplied': 'Colours and font of {name} applied, via Brandfetch.',
  'chart.panel.brandFontSkipped': "A font that isn't freely available was skipped.",
  'chart.panel.brandUnavailable': 'Fetching brand colours is not possible right now.',
  'chart.panel.brandNotFound': 'No brand was found for this domain.',
  'chart.panel.brandInvalidDomain': "That doesn't look like a website.",
  'chart.panel.brandTryLater': 'Try again later.',
  'chart.panel.brandMonthlyCap': 'Brand colours are no longer available this month; they return next month.',
  'chart.panel.brandError': 'Something went wrong. Try again later.',
  'chart.panel.languageLabel': 'Chart language',
  'chart.panel.languageNl': 'Nederlands',
  'chart.panel.languageEn': 'English',
  'chart.panel.whyNotTitle': 'Why no pie or stacked chart?',
  'chart.panel.whyNotBody':
    'A pie or a stacked chart draws a total or a share that no CBS cell contains. A scatter plot needs two measures per point, and this chart has one. Sorting by value asserts a ranking that was never measured.',
  'chart.panel.tabFrame': 'Frame',
  'chart.panel.tabTemplates': 'Templates',
  'chart.template.standard': 'Standard',
  'chart.template.standardDescription': 'The default look: a quiet grid, clear lines.',
  'chart.template.classic': 'Classic',
  'chart.template.classicDescription': 'The familiar look with a dot on every point.',
  'chart.template.newsroom': 'Newsroom',
  'chart.template.newsroomDescription': 'Publication-ready: a firm line, no frills, landscape.',
  'chart.template.presentation': 'Presentation',
  'chart.template.presentationDescription': 'A card on a dark backdrop, ready for a slide.',
  'chart.template.social': 'Social',
  'chart.template.socialDescription': 'Portrait with a colourful frame for social media.',
  'chart.template.minimal': 'Minimal',
  'chart.template.minimalDescription': 'Just the line, the values and the hollow marker.',
  'chart.template.warm': 'Warm',
  'chart.template.warmDescription': 'A soft colour gradient, suited to an editorial story.',
  'chart.template.earth': 'Earth',
  'chart.template.earthDescription': 'A firm line on a sand-toned card, square format.',
  'chart.template.brand': 'Brand',
  'chart.template.brandDescription': 'Your brand colours and font, fetched from your website.',
  'chart.template.brandOpen': 'Go to Colours',
  'chart.template.current': 'Current',
  'chart.template.galleryLabel': 'Templates',
  'chart.panel.frameBackground': 'Background',
  'chart.panel.frameBgNone': 'None',
  'chart.panel.frameBgSolid': 'Colour',
  'chart.panel.frameBgGradient': 'Gradient',
  'chart.panel.frameBgImage': 'Own image',
  'chart.panel.frameGradientPreset': 'Preset',
  'chart.panel.frameGradientDawn': 'Dawn',
  'chart.panel.frameGradientOcean': 'Ocean',
  'chart.panel.frameGradientForest': 'Forest',
  'chart.panel.frameGradientBerry': 'Berry',
  'chart.panel.frameGradientSlate': 'Slate',
  'chart.panel.frameGradientSand': 'Sand',
  'chart.panel.frameFrom': 'From',
  'chart.panel.frameTo': 'To',
  'chart.panel.framePadding': 'Padding',
  'chart.panel.frameCorners': 'Corners',
  'chart.panel.frameShadow': 'Shadow',
  'chart.panel.frameInset': 'Inset card',
  'chart.panel.frameAspect': 'Aspect ratio',
  'chart.panel.sizeNone': 'None',
  'chart.panel.sizeSmall': 'Small',
  'chart.panel.sizeMedium': 'Medium',
  'chart.panel.sizeLarge': 'Large',
  'chart.panel.cornersSquare': 'Square',
  'chart.panel.cornersRounded': 'Rounded',
  'chart.panel.cornersVeryRounded': 'Very rounded',
  'chart.panel.shadowSoft': 'Soft',
  'chart.panel.shadowStrong': 'Strong',
  'chart.panel.aspectAuto': 'As is',
  'chart.panel.aspectWide': 'Widescreen',
  'chart.panel.aspectPortrait': 'Portrait',
  'chart.panel.aspectSquare': 'Square',
  'chart.panel.aspectSocial': 'Social',
  'chart.panel.frameImagePick': 'Choose an image',
  'chart.panel.frameImageRemove': 'Remove image',
  'chart.panel.frameImageTooLarge': 'The image is too large. Choose a smaller one.',
  'chart.panel.frameImageBadType': 'Choose a PNG, JPEG or WebP.',
  'chart.panel.frameImageNotSaved': 'The image is not kept in your default.',
  'chart.panel.frameReset': 'Clear frame',
  'chart.panel.frameBgRefused': 'This background would make a series unreadable. Choose another colour or turn the inset card on.',
  'chart.panel.close': 'Close',
  'chart.panel.dialogLabel': 'Style',
  'chart.embed.trigger': 'Embed',
  'chart.embed.dialogTitle': 'Embed this chart',
  'chart.embed.dialogExplain': 'Paste this code into an article to show this chart, with attribution.',
  'chart.embed.autoResizeExplain':
    'The chart resizes itself to its content; the height attribute is the fallback when scripts are blocked.',
  'chart.embed.languageLabel': 'Language',
  'chart.embed.colourLabel': 'Colours',
  'chart.embed.colourLight': 'Light',
  'chart.embed.colourDark': 'Dark',
  'chart.embed.colourAuto': "Reader's device",
  'chart.embed.chartTypeLabel': 'Chart type',
  'chart.embed.chartTypeAsShown': 'As shown',
  'chart.embed.chartTypeDefault': 'Default',
  'chart.embed.liveLabel': 'Live embed',
  'chart.embed.liveProOnly': 'Part of Pro. The embedded chart updates automatically when CBS corrects or extends the data.',
  'chart.embed.proPrice': '€19/month',
  'chart.embed.proUpgradeCta': "I'm interested in Pro",
  'chart.embed.proUpgradeThanks': "Thanks — we'll let you know once Pro is available.",
  'chart.embed.copyCode': 'Copy code',
  'chart.embed.copyCodeCopied': 'Copied!',
  'chart.embed.close': 'Close',
  'chart.embed.unavailable': 'Embedding is not available right now.',
  'chart.embed.loading': 'Generating code…',
  'chart.embed.readingDisabledReason':
    "Embedding always publishes this chart's default reading, not the one currently selected. Switch back to the default reading first to embed.",

  // WP-B (journey programme, phase 3/4 R5.1/R5.4/R6) — trust pages, footer
  // links and the landing "Publish" step. Added as one block at the tail
  // per the WP-B brief (this file is edited in parallel by another WP).
  'footer.werkwijzeLabel': 'How we work',
  'footer.privacyLabel': 'Privacy',
  'trust.draftNote': 'Draft — under review.',
  'werkwijze.pageTitle': 'How we work — Check de Cijfers',
  'werkwijze.heading': 'How we work',
  'werkwijze.publicClaim':
    'Every number we show is traceable to an official CBS cell, with source and date shown alongside it.',
  'werkwijze.step1Title': '1. You ask a question',
  'werkwijze.step1Body':
    'A language model only reads what you ask — it never calculates and never invents a number. It recognises which CBS topic, region and period you mean.',
  'werkwijze.step2Title': '2. Deterministic code looks up the number',
  'werkwijze.step2Body':
    'The question is translated into an exact lookup in our own database of pre-loaded CBS tables. No number ever comes from the language model itself.',
  'werkwijze.step3Title': '3. We show the answer with source and date',
  'werkwijze.step3Body':
    'Every answer states the CBS table, the sync date and the licence (CC BY 4.0), so you can look it up yourself.',
  'werkwijze.provisionalHeading': 'What does "provisional" mean?',
  'werkwijze.provisionalBody':
    'CBS first publishes some figures as provisional before they become definitive. When a figure is not definitive, we say so explicitly. A definitive figure can still be revised by CBS later — this happens occasionally with large revisions.',
  'werkwijze.refusalHeading': 'What does a refusal mean?',
  'werkwijze.refusalBody':
    'If a question is ambiguous, falls outside our loaded data, or asks for a prediction or opinion, we would rather refuse than guess. You get an explanation and, where possible, a usable alternative.',
  'werkwijze.notCoveredHeading': 'What the claim does not cover',
  'werkwijze.notCoveredBody':
    'The traceability claim applies to CBS figures from our registry. It does not apply to your own uploaded data, to internet results (marked separately as unverified), or to other sources — those may be added later, but are not covered today.',
  'privacy.pageTitle': 'Privacy — Check de Cijfers',
  'privacy.heading': 'Privacy',
  'privacy.storedHeading': 'What we store',
  'privacy.storedBody':
    'We store your questions and answers as an audit trail (so every number stays traceable) and your account details (email address). Questions from visitors without an account are stored separately from your account.',
  'privacy.retentionHeading': 'How long we keep it',
  'privacy.retentionBody':
    'Question history tied to an account is kept for 2 years; questions from anonymous visitors (trial questions) are kept for 90 days. You can always delete your own question history yourself via the account menu.',
  'privacy.llmHeading': 'Processing by a language model',
  'privacy.llmBody':
    'Your question is processed by a language model from Anthropic to understand the question and phrase the answer — never the raw CBS figures themselves, which always come from our own database.',
  'privacy.paymentHeading': 'Payments',
  'privacy.paymentBody': 'Stripe processes payments as our payment provider. We do not store card or bank details.',
  'privacy.cookiesHeading': 'Cookies',
  // Mirrors the Dutch block above (strong-tier review HIGH-2).
  'privacy.cookiesBody':
    'To keep you signed in we use one necessary session cookie. If you use the trial without an account, we also set a cookie holding a random visitor number and store an encrypted (hashed) version of your IP address — both only to limit abuse of the free trial, and deleted after 90 days. We also count how often certain actions happen per day, as bare totals with no account, user name or IP address, so they cannot be traced back to a person. Beyond that: no tracking cookies and no third-party analytics.',
  'privacy.contactHeading': 'Contact',
  'privacy.contactBody': 'Questions about your data? Email [contact email — owner fills in].',

  // Mirrors the Dutch /about block above.
  'about.pageTitle': 'About us — Check de Cijfers',
  'about.heading': 'About us',
  'about.introHeading': 'About Check de Cijfers',
  'about.introBody':
    'Check de Cijfers answers questions about official CBS statistics. A language model reads your question, but never does the calculation itself: every number comes from a database of CBS data and can be traced back to its source table and date. We build it for journalists, researchers and students who need a reliable figure fast, with a source they can stand behind.',
  'about.contactHeading': 'Contact',
  'about.contactIntro': 'Questions, comments or feedback? Email us at',

  'landing.ontdekCaption': 'Try it right away: Style (templates), Insights, Present — and download as PNG.',
  'landing.step4Title': 'Publish',
  'landing.step4Body': 'Pick a template, download or embed — source and date travel with it.',
  // WP-C (journey programme, session 96): mirrors the Dutch block above —
  // R10 credits-page pack copy, R5.3 the anonymous-Insights login line.
  'credits.packLabel': '{price} — {credits} credits',
  'credits.buyAriaLabel': 'Buy {price} — {credits} credits',
  'credits.packQuestions': '≈ {n} simple questions',
  'credits.packPricePerQuestion': '{price} per question',
  'credits.neverExpires': 'Credits never expire. No subscription.',
  'chart.story.loginForInsights': 'Log in for AI-phrased insights.',
  // ---- WP-D (journey programme, 2026-09-12, session 97) -----------------
  'chat.clarificationOptionsHint': 'Pick an option:',
  'chat.refusalRetryHint': 'Try instead:',
  'chat.insufficientCreditsBase': 'You do not have enough credits ({balance} left, {required} needed).',
  'chat.insufficientCreditsBuyPack': 'Buy e.g. {packLabel} via',
  'chat.insufficientCreditsBuyGeneric': 'Buy credits via',
  'chat.lowBalanceSuffix': ' Enough for one more question.',
  'chat.slowWaitNotice': 'This is taking a little longer than usual; we are still checking the answer.',
  // ---- WP-E (journey programme, 2026-09-12, session 98) -----------------
  'coverage.summary': 'Which sources are built in?',
  'coverage.cbsHeading': 'CBS',
  'coverage.syncedOn': 'synced {date}',
  'coverage.exampleLabel': 'e.g.: {question}',
  'coverage.onRequestLine': 'Other CBS topics we fetch on request.',
  'coverage.landingHeading': 'What we know today',

  // #237/ADR 046 — faithful MEANING translations, digit-free like the nl
  // originals (messages.test.ts's digit-parity rule).
  'landing.heroSubtitleV2':
    'Ask your question in plain language and chat your way from official CBS research to a sourced chart, ready to share.',
  'landing.ctaGallery': 'See the gallery',
  'gallery.teaserHeading': 'Stories from the gallery',
  'gallery.teaserAllLink': 'All stories',
  'gallery.pageTitle': 'Gallery — Check de Cijfers',
  'gallery.heading': 'The gallery',
  // Fix-wave finding 7: matches the truer, on-message nl copy — built from
  // real CBS figures, with source and date, never vague "real/sourced"
  // marketing filler.
  'gallery.intro':
    'Every card below is built from official CBS figures, with source and date shown — by the same deterministic engine that answers questions in chat. Click Insights to see what stands out.',
  'gallery.embedComingSoon': 'Inline embedding of your own is coming soon.',
  // #3 (session 110 UX audit): see the nl entry's comment.
  'gallery.loadingNote': 'Loading the gallery — reload in a moment if it stays empty.',
  // Fix-wave finding 4: every title is the QUESTION a reader would have
  // typed — the separate "lead" line was dropped, the question says it.
  'gallery.story.consumentenvertrouwen.title': 'How optimistic are the Dutch?',
  'gallery.story.economische-groei.title': 'How fast did the economy grow?',
  'gallery.story.inflatie.title': 'What did inflation do?',
  'gallery.story.huizenprijzen.title': 'What did a house cost?',
  'gallery.story.werkloosheid.title': 'How high was unemployment?',
  'gallery.story.faillissementen.title': 'How many businesses went bankrupt?',
  'gallery.story.producentenprijzen.title': 'What did producer prices do?',
  'gallery.story.detailhandelsomzet.title': 'How did retail do?',
  'gallery.story.supermarktomzet.title': 'How did supermarkets do?',
  'gallery.story.consumptie-huishoudens.title': 'How much did households spend?',
  'gallery.story.werkloosheid-maandelijks.title': 'How did unemployment move month by month?',
  'gallery.story.zonnestroom.title': 'How much power came from solar panels?',

  // --- ADR 049: the 3D municipality DEMO (route kept out of this comment on purpose — isolation.test.ts pins that the string never appears outside its own directory). Every number on that page is fiction; these labels say so. ---
  'lab3d.pageTitle': 'Demo: 3D municipality map (fictional data) — Check de Cijfers',
  'lab3d.title': 'The Netherlands is growing, but not everywhere',
  'lab3d.intro': 'A demonstration of a 3D map: every municipality is a column, height stands for population and colour for growth since the start year. Every figure is made up; only the municipal boundaries and names are real.',
  'lab3d.badge': 'DEMO — FICTIONAL DATA',
  'lab3d.badgeDetail': 'Every value on this page is made up, for demonstration only. This is not a CBS figure.',
  'lab3d.watermark': 'FICTIONAL',
  'lab3d.footer': 'Figures: fictional, for demonstration only. Municipal boundaries: CBS/PDOK via cartomap.github.io, licence CC BY 4.0.',
  'lab3d.mapLabel': '3D map of municipalities (fictional data)',
  'lab3d.year': 'Year',
  'lab3d.play': 'Play',
  'lab3d.pause': 'Pause',
  'lab3d.resetView': 'Reset view',
  'lab3d.typeLabel': 'Municipality type',
  'lab3d.typeAll': 'All municipalities',
  'lab3d.typeCity': 'City',
  'lab3d.typeMid': 'Mid-sized',
  'lab3d.typeRural': 'Rural',
  'lab3d.pickLabel': 'Municipality',
  'lab3d.pickNone': 'Choose a municipality',
  'lab3d.population': 'Population (fictional)',
  'lab3d.growth': 'Growth since start year (fictional)',
  'lab3d.legendLow': 'shrinking',
  'lab3d.legendHigh': 'growth',
  'lab3d.heightNote': 'Height = population (fictional) · colour = growth (fictional)',
  'lab3d.loading': 'Loading map…',
  'lab3d.unavailable': 'This browser cannot show 3D (no WebGL).',
  'lab3d.loadFailed': 'The municipal boundaries could not be loaded.',
  'lab3d.narrativeTitle': 'How to read this map',
  'lab3d.narrativePrev': 'Previous',
  'lab3d.narrativeNext': 'Next',
  'lab3d.narrativeDotLabel': 'Go to step {n} of {total}',
  'lab3d.narrativeStep1': 'Every municipality is two things at once: a coloured area on the map, and a column rising above it.',
  'lab3d.narrativeStep2': "The column's height stands for population — the taller it is, the more (fictional) residents that municipality has.",
  'lab3d.narrativeStep3': 'The colour of both the area and the column stands for growth since {start}: blue is growth, red-orange is shrinkage, up to about ±{domain}%.',
  'lab3d.narrativeStep4': 'Drag the time bar from {start} to {end}, or click Play to watch the growth year by year.',
  'lab3d.narrativeStep5': 'Every figure on this map is made up, shown purely to demonstrate the technique — not a CBS figure.',

  // Chart co-pilot phase 4: see the `nl` entry's comment.
  'chart.derived.differenceLabel': 'Show difference',
  'chart.derived.differencePick': 'Pick two points to show the difference',
  'chart.derived.meanLabel': 'Show average',
  'chart.derived.meanPeriodRange': 'Average over the visible period',
  'chart.derived.remove': 'Remove',
  'chart.derived.errorMissingRegion': 'This cannot be done: the points are in different regions.',
  'chart.derived.errorUnavailableChart': 'This only works on a CBS or Eurostat chart.',
  'chart.derived.errorAnswerUnavailable': 'This answer is no longer available.',
  'chart.derived.errorNoChart': 'This answer has no chart to derive from.',
  'chart.derived.errorPointNotOnChart': 'One of the chosen points is not on this chart.',
  'chart.derived.errorSamePeriod': 'Pick two different periods for a difference.',
  'chart.derived.errorGeneric': 'This cannot be done with these points.',

  // Session 110 UX audit pass 3, row 9 — see the `nl` entry's comment. The
  // reader this row actually reports on is the nl-cookie one; this English
  // entry only exists because `Messages` (below) requires the same key set
  // in both languages — trivially true for an English reader, but never
  // skipped, so a future language switch never silently loses this key.
  'eurostatExplorer.englishOnlyNotice':
    'This internal tool is English-only; the footer below stays in your own language.',
};

export const MESSAGES = { nl, en } as const satisfies Record<Lang, Messages>;

export function isLang(x: unknown): x is Lang {
  return x === 'nl' || x === 'en';
}

// Fills `{name}` placeholders from `vars`; an unrecognised lang (defensive —
// callers should only ever hold a real `Lang`, but `t` stays safe if one
// slips through some untyped boundary) falls back to Dutch.
export function t(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const table = MESSAGES[lang] ?? MESSAGES.nl;
  const template = table[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}
