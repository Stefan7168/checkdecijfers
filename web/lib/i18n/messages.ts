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
  'header.account': 'Account',
  'header.logout': 'Log uit',
  'header.busy': 'Bezig…',
  // Byte-identical to the original JSX `{balance} credits` — "credits" is
  // already the word used in the Dutch UI as-is.
  'header.balance': '{n} credits',

  // Shared across surfaces (dataset-chat.tsx, workspace.tsx) — same literal
  // string, same meaning, so ONE key rather than three near-duplicates.
  'common.sessionExpired': 'Je sessie is verlopen. Vernieuw de pagina.',

  // chat.tsx (the CBS chat loop). Task 2 (WP218 phase 4, #219).
  'chat.placeholder': 'Stel een vraag…',
  'chat.send': 'Verstuur',
  'chat.copyCitation': 'Kopieer als citaat',
  'chat.copyCitationCopied': 'Gekopieerd!',
  'chat.downloadCsv': 'Download als CSV',
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
  // "data" is the same loanword in Dutch, so the value is identical in both
  // languages; still catalogued (every literal string goes through t()).
  'chat.sourceDataSuffix': '{name} data',
  'chat.internetChip': 'Internet',
  'chat.addLink': 'Link toevoegen',
  'chat.uploadFile': 'Bestand uploaden',
  'chat.uploadFileComingSoonTitle': 'Binnenkort beschikbaar: upload een bestand (bijv. PDF)',
  'chat.linkWithSheet': 'Koppel een spreadsheet',
  'chat.linkWithSheetComingSoonTitle': 'Binnenkort beschikbaar: koppel een spreadsheet (bijv. Google Sheets)',
  'chat.connectDatabase': 'Database koppelen',
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
  'workspace.purchaseSuccessMessage':
    'Betaling gelukt — je credits worden bijgeschreven zodra Stripe de betaling bevestigt (meestal een paar seconden). Ververs daarna de pagina om je nieuwe saldo te zien.',
  'workspace.purchaseSuccessDismiss': 'Sluiten',

  // visual-dock.tsx.
  'dock.header': 'Grafieken',
  'dock.tablistLabel': 'Visualisaties',

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

  // WP218 phase 4 (#219), Task 3 (Sweep B: pages + shell).
  // landing.tsx. The owner asked (session 90) to keep the Dutch headline
  // UNCHANGED verbatim; the English value below is a faithful MEANING
  // translation, not a literal one.
  'landing.heroTitle': 'Chat met de officiële cijfers van Nederland',
  'landing.heroSubtitle':
    'Stel je vraag in gewone taal. Check de Cijfers rekent het antwoord uit op officiële CBS-statistieken — elk getal herleidbaar tot een CBS-tabel, met bron en datum erbij.',
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
  'login.pageHeading': 'Inloggen — Check de Cijfers',
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
  'credits.pageHeading': 'Credits — Check de Cijfers',
  'credits.balancePrefix': 'Je huidige saldo:',
  'credits.creditsWord': 'credits.',
  'credits.purchaseSuccess': 'Betaling gelukt — je credits worden bijgeschreven zodra Stripe de betaling bevestigt.',
  'credits.purchaseCancelled': 'Betaling geannuleerd.',
  'credits.buy': 'Kopen',
  'credits.unknownPack': 'Onbekend of niet meer beschikbaar pakket.',
  'credits.notLoggedIn': 'Je bent niet ingelogd.',
  'credits.unavailable': 'Betalen is momenteel niet beschikbaar.',
  'credits.startFailed': 'Er ging iets mis bij het starten van de betaling.',
  'credits.noCheckoutUrl': 'Stripe gaf geen checkout-URL terug.',

  // app/geschiedenis/page.tsx.
  'history.pageHeading': 'Geschiedenis — Check de Cijfers',

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

  // site-footer.tsx (FOOTER_ATTRIBUTION itself stays byte-pinned, untranslated).
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

  // ontdek.tsx.
  'ontdek.heading': 'Ontdek Nederland in grafieken',
  'ontdek.body':
    'Rechtstreeks uit onze database met officiële CBS-cijfers: consumentenvertrouwen, economische groei, inflatie, de gemiddelde verkoopprijs van woningen en de werkloosheid. Elk punt is herleidbaar tot een CBS-tabel — bron en datum staan erbij.',

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
  'chart.formReason.areaMultiSeries':
    'Een gevuld vlak per reeks zou de reeksen over elkaar leggen en gaten verbergen.',
  'chart.formReason.areaComparison': 'Een vlak past alleen bij een reeks in de tijd.',
  'chart.formReason.hbarTimeSeries': 'Liggende staven passen alleen bij een vergelijking tussen regio’s.',
  'chart.from': 'Vanaf',
  'chart.to': 'Tot',
  'chart.graphPanelLabel': 'Grafiek',
  'chart.seriesGroupLabel': 'Reeksen',
  'chart.highlightButton': 'Markeer {label}',
  'chart.highlightTitle': 'Markeer {label}, andere reeksen worden gedimd',
  'chart.hiddenSeriesDisclosure': '{n} van {m} reeksen verborgen',
  'chart.zoomDisclosure': 'Getoond: {from}–{to} van {coveredFrom}–{coveredTo}.',
  'chart.smallMultiplesToggle': 'Kleine grafieken',
  'chart.axisGroupLabel': 'Gelijke assen of eigen assen',
  'chart.sharedAxes': 'Gelijke assen',
  'chart.ownAxes': 'Eigen assen',
  'chart.provisionalMarkerNote': '○ = voorlopig cijfer',
  'chart.markedInChart': 'Gemarkeerd in de grafiek: {label}',
  'chart.keyboardHint': 'Gebruik de pijltjestoetsen om de punten van de grafiek te doorlopen.',
  'chart.noteAriaLabel': 'Voeg notitie toe bij {series}, {period}',
  'chart.schemaRefusal':
    'Deze grafiek is gemaakt in een nieuwere versie dan deze pagina kan tonen. De cijfers staan in het antwoord zelf.',
  'chart.table.period': 'Periode',
  'chart.table.region': 'Regio',
  'chart.table.value': 'Waarde',

  // chart-notes.tsx.
  'chart.notes.heading': 'Uw aantekeningen (geen CBS-data)',
  'chart.notes.delete': 'Verwijder',
  'chart.notes.draftLabel': 'Notitie bij {series} · {period}',
  'chart.notes.save': 'Opslaan',
  'chart.notes.cancel': 'Annuleren',

  // chart-download.tsx.
  'chart.download.trigger': 'Download',
  'chart.download.menuLabel': 'Downloadformaat',
  'chart.download.png': 'Download als PNG',
  'chart.download.svg': 'Download als SVG',
  'chart.download.failed': 'Downloaden lukte niet in deze browser.',

  // chart-small-multiples.tsx.
  'chart.smallMultiplesGroupLabel': 'Kleine grafieken per reeks',

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
  'chart.story.trigger': 'Verhaal',
  'chart.story.regionLabel': 'Verhaal bij de grafiek',
  'chart.story.hint': 'Scroll of gebruik de pijlen',
  'chart.story.prev': 'Vorige',
  'chart.story.next': 'Volgende',
  'chart.story.close': 'Sluiten',
  'chart.story.stepsLabel': 'Stappen',
  'chart.story.overviewTitle': 'Overzicht',
  'chart.story.overviewCaption': 'Van {from} tot {to}.',
  'chart.story.overviewSeriesCaption': 'Meerdere reeksen; het verhaal loopt ze één voor één langs.',
  'chart.story.moreSeries': 'Niet elke reeks krijgt een eigen stap.',
  'chart.story.compareCaption': 'Eén staaf per regio; hierna de hoogste en de laagste.',
  'chart.story.startTitle': 'Begin',
  'chart.story.highTitle': 'Hoogste punt',
  'chart.story.lowTitle': 'Laagste punt',
  'chart.story.latestTitle': 'Meest recent',
  'chart.story.pointCaption': '{period}: {value} {unit}',
  'chart.story.seriesCaption': '{fromPeriod}: {fromValue} → {toPeriod}: {toValue} {unit}',
  'chart.story.barCaption': '{label}: {value} {unit}',
  'chart.story.provisional': ' (voorlopig cijfer)',
  'chart.story.exploreTitle': 'Verken zelf',
  'chart.story.exploreCaption': 'Wissel van weergave met de tabs, kies een periode met Vanaf en Tot, of pas de opmaak aan.',
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
  'chart.panel.showGroup': 'Tonen',
  'chart.panel.reset': 'Standaard',
  'chart.panel.lineWidthOption.thin': 'Dun',
  'chart.panel.lineWidthOption.normal': 'Normaal',
  'chart.panel.lineWidthOption.thick': 'Dik',
  'chart.panel.lineWidthOption.extraThick': 'Extra dik',
  'chart.panel.markersOption.all': 'Alle punten',
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
  'chart.panel.languageFollowApp': 'Zoals de app',
  'chart.panel.languageNl': 'Nederlands',
  'chart.panel.languageEn': 'English',
  // WP218 phase 5 (chart-types plan, Task 3): the Grafiek tab's collapsed
  // note explaining why pie/donut, stacked, scatter and sorted-by-value
  // charts are never offered as a form — digit-free per the resolver's own
  // honesty invariant ('één'/'twee' are words, not numerals).
  'chart.panel.whyNotTitle': 'Waarom geen taart- of gestapelde grafiek?',
  'chart.panel.whyNotBody':
    'Een taart- of gestapelde grafiek tekent een totaal of een aandeel dat in geen enkele CBS-cel staat. Een spreidingsgrafiek heeft twee meetwaarden per punt nodig, en deze grafiek heeft er één. Sorteren op waarde is een rangorde die niet gemeten is.',
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
  'header.account': 'Account',
  'header.logout': 'Log out',
  'header.busy': 'Working…',
  'header.balance': '{n} credits',

  'common.sessionExpired': 'Your session has expired. Please refresh the page.',

  'chat.placeholder': 'Ask a question…',
  'chat.send': 'Send',
  'chat.copyCitation': 'Copy as citation',
  'chat.copyCitationCopied': 'Copied!',
  'chat.downloadCsv': 'Download as CSV',
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
  'chat.sourceDataSuffix': '{name} data',
  'chat.internetChip': 'Internet',
  'chat.addLink': 'Add link',
  'chat.uploadFile': 'Upload file',
  'chat.uploadFileComingSoonTitle': 'Coming soon: upload a file (e.g. PDF)',
  'chat.linkWithSheet': 'Link with sheet',
  'chat.linkWithSheetComingSoonTitle': 'Coming soon: connect a spreadsheet (e.g. Google Sheets)',
  'chat.connectDatabase': 'Connect database',
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
  'workspace.purchaseSuccessMessage':
    'Payment successful — your credits will be added once Stripe confirms the payment (usually a few seconds). Refresh the page afterwards to see your new balance.',
  'workspace.purchaseSuccessDismiss': 'Close',

  'dock.header': 'Charts',
  'dock.tablistLabel': 'Visualizations',

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
  'answerProof.tableCaption': 'Table {tableId} — {tableTitle} · version {version} · synced {date} · license {license}',

  // WP218 phase 4 (#219), Task 3 (Sweep B). Faithful MEANING translations of
  // the Dutch marketing copy — the Dutch headline stays owner-pinned verbatim
  // (see the nl block); this is not a literal word-for-word rendering.
  'landing.heroTitle': "Chat with the Netherlands' official statistics",
  'landing.heroSubtitle':
    'Ask your question in plain language. Check de Cijfers computes the answer from official CBS statistics — every figure traceable to a CBS table, with source and date shown.',
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

  'login.pageHeading': 'Log in — Check de Cijfers',
  'login.pageBody': 'Enter your email address; you will get a login link. No password needed.',
  'login.sentMessage': 'Check your email for the login link.',
  'login.emailPlaceholder': 'you@example.com',
  'login.sendMagicLink': 'Send login link',
  'login.or': 'or',
  'login.continueWithGoogle': 'Continue with Google',
  'login.emailRequired': 'Email address is required.',
  'login.magicLinkFailed': 'Something went wrong sending the login link. Please try again.',
  'login.googleFailed': 'Signing in with Google did not work. Please try again or use the login link.',

  'credits.pageHeading': 'Credits — Check de Cijfers',
  'credits.balancePrefix': 'Your current balance:',
  'credits.creditsWord': 'credits.',
  'credits.purchaseSuccess': 'Payment successful — your credits will be added once Stripe confirms the payment.',
  'credits.purchaseCancelled': 'Payment cancelled.',
  'credits.buy': 'Buy',
  'credits.unknownPack': 'Unknown or no longer available pack.',
  'credits.notLoggedIn': 'You are not logged in.',
  'credits.unavailable': 'Payments are not available right now.',
  'credits.startFailed': 'Something went wrong starting the payment.',
  'credits.noCheckoutUrl': 'Stripe did not return a checkout URL.',

  'history.pageHeading': 'History — Check de Cijfers',

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

  'ontdek.heading': 'Discover the Netherlands in charts',
  'ontdek.body':
    'Straight from our database of official CBS figures: consumer confidence, economic growth, inflation, the average house sale price and unemployment. Every point is traceable to a CBS table — source and date included.',

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
  'chart.formReason.areaMultiSeries':
    'A filled area per series would stack the series on top of each other and hide gaps.',
  'chart.formReason.areaComparison': 'An area chart only fits a single series over time.',
  'chart.formReason.hbarTimeSeries': 'Horizontal bars only fit a comparison between regions.',
  'chart.from': 'From',
  'chart.to': 'To',
  'chart.graphPanelLabel': 'Chart',
  'chart.seriesGroupLabel': 'Series',
  'chart.highlightButton': 'Highlight {label}',
  'chart.highlightTitle': 'Highlight {label}; other series are dimmed',
  'chart.hiddenSeriesDisclosure': '{n} of {m} series hidden',
  'chart.zoomDisclosure': 'Shown: {from}–{to} of {coveredFrom}–{coveredTo}.',
  'chart.smallMultiplesToggle': 'Small multiples',
  'chart.axisGroupLabel': 'Shared axes or own axes',
  'chart.sharedAxes': 'Shared axes',
  'chart.ownAxes': 'Own axes',
  'chart.provisionalMarkerNote': '○ = provisional figure',
  'chart.markedInChart': 'Marked in the chart: {label}',
  'chart.keyboardHint': 'Use the arrow keys to move through the chart’s points.',
  'chart.noteAriaLabel': 'Add a note at {series}, {period}',
  'chart.schemaRefusal':
    'This chart was made in a newer version than this page can show. The figures are in the answer itself.',
  'chart.table.period': 'Period',
  'chart.table.region': 'Region',
  'chart.table.value': 'Value',

  'chart.notes.heading': 'Your notes (not CBS data)',
  'chart.notes.delete': 'Delete',
  'chart.notes.draftLabel': 'Note at {series} · {period}',
  'chart.notes.save': 'Save',
  'chart.notes.cancel': 'Cancel',

  'chart.download.trigger': 'Download',
  'chart.download.menuLabel': 'Download format',
  'chart.download.png': 'Download as PNG',
  'chart.download.svg': 'Download as SVG',
  'chart.download.failed': 'Download did not work in this browser.',

  'chart.smallMultiplesGroupLabel': 'Small multiples per series',

  'chart.toggle.definitionGroupLabel': 'Switch definition',

  'chart.panel.trigger': 'Style',
  'chart.panel.regionLabel': 'Chart style',

  'chart.story.trigger': 'Story mode',
  'chart.story.regionLabel': 'Story for this chart',
  'chart.story.hint': 'Scroll or use the arrows',
  'chart.story.prev': 'Previous',
  'chart.story.next': 'Next',
  'chart.story.close': 'Close',
  'chart.story.stepsLabel': 'Steps',
  'chart.story.overviewTitle': 'Overview',
  'chart.story.overviewCaption': 'From {from} to {to}.',
  'chart.story.overviewSeriesCaption': 'Several series; the story walks through them one by one.',
  'chart.story.moreSeries': 'Not every series gets its own step.',
  'chart.story.compareCaption': 'One bar per region; the highest and the lowest follow.',
  'chart.story.startTitle': 'Start',
  'chart.story.highTitle': 'Highest point',
  'chart.story.lowTitle': 'Lowest point',
  'chart.story.latestTitle': 'Latest',
  'chart.story.pointCaption': '{period}: {value} {unit}',
  'chart.story.seriesCaption': '{fromPeriod}: {fromValue} → {toPeriod}: {toValue} {unit}',
  'chart.story.barCaption': '{label}: {value} {unit}',
  'chart.story.provisional': ' (provisional figure)',
  'chart.story.exploreTitle': 'Explore yourself',
  'chart.story.exploreCaption': 'Switch the view with the tabs, pick a period with From and To, or change the style.',
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
  'chart.panel.showGroup': 'Show',
  'chart.panel.reset': 'Default',
  'chart.panel.lineWidthOption.thin': 'Thin',
  'chart.panel.lineWidthOption.normal': 'Normal',
  'chart.panel.lineWidthOption.thick': 'Thick',
  'chart.panel.lineWidthOption.extraThick': 'Extra thick',
  'chart.panel.markersOption.all': 'All points',
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
  'chart.panel.languageFollowApp': 'Same as the app',
  'chart.panel.languageNl': 'Nederlands',
  'chart.panel.languageEn': 'English',
  'chart.panel.whyNotTitle': 'Why no pie or stacked chart?',
  'chart.panel.whyNotBody':
    'A pie or a stacked chart draws a total or a share that no CBS cell contains. A scatter plot needs two measures per point, and this chart has one. Sorting by value asserts a ranking that was never measured.',
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
