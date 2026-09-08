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
