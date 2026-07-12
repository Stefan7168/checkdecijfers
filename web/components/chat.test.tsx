// WP13 (ADR 020): the chat must render the billing gate's non-'ok'
// GatedResponse kinds as distinct messages — never via the generic
// try/catch (those are normal return values, not exceptions).
// WP15 (ADR 021): askQuestion/replyToClarification now return an AskOutcome
// ({ gated, context }), not a bare GatedResponse — the chat must hold the
// context across turns and thread it back as askQuestion's third argument.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskOutcome } from '../app/actions.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { WebSection } from '../backend/websearch/types.ts';
import { UnrecognizedActionError } from 'next/dist/client/components/unrecognized-action-error';
import { buildAnswerCsv } from '../lib/csv.ts';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';
import { Chat } from './chat.tsx';

// jsdom does not implement scrollIntoView (pre-existing chat.tsx effect,
// unrelated to WP13) — stubbed here rather than in the shared setup file,
// same scoping choice chart.test.tsx makes for ResizeObserver.
Element.prototype.scrollIntoView = vi.fn();

// Typed explicitly against the real AskOutcome/GatedResponse shapes
// (adversarial-review finding, WP13; kept for WP15's new return shape):
// web/tsconfig.json includes *.test.tsx in typecheck, and even so, an
// untyped `vi.fn()` mock's `mockResolvedValue({...})` argument is never
// checked against the real return type unless the mock itself is typed — a
// field-name typo (e.g. `creditsLeft` instead of `balance`, or `response`
// instead of `gated`) would pass both `web:typecheck` and, if chat.tsx
// happened not to render the mismatched field, `web:test` too. Both gaps
// stay closed here: the mock is pinned to AskOutcome.
const { askQuestion, replyToClarification, submitAnswerFeedback } = vi.hoisted(() => ({
  // WP129+130: the additive optional `rawSelection` 4th arg is included so the
  // 4-arg call sites (chips path) typecheck; the pre-WP 3-arg assertions below
  // still pass unchanged (the chat only passes a 4th arg when a websearch prop
  // is present — the sibling-mock rule).
  askQuestion:
    vi.fn<(question: string, requestId: string, rawContext?: unknown, rawSelection?: unknown) => Promise<AskOutcome>>(),
  replyToClarification:
    vi.fn<(pending: unknown, reply: string, requestId: string, rawSelection?: unknown) => Promise<AskOutcome>>(),
  // WP128: FeedbackButtons (rendered by Chat) imports this from the same
  // mocked module — typed against the real action's signature.
  submitAnswerFeedback:
    vi.fn<(auditId: number, verdict: 'up' | 'down', feedbackText?: string) => Promise<{ ok: boolean }>>(),
}));
vi.mock('../app/actions.ts', () => ({
  askQuestion,
  replyToClarification,
  submitAnswerFeedback,
}));

afterEach(() => {
  cleanup();
  askQuestion.mockReset();
  replyToClarification.mockReset();
  submitAnswerFeedback.mockReset();
});

/** Wraps a GatedResponse into the AskOutcome shape, with no context —
 * the common case for the pre-existing gated-branch tests below (none of
 * them exercise WP15 context propagation). */
function outcome(gated: GatedResponse, context: ConversationContext | null = null): AskOutcome {
  return { gated, context };
}

async function submit(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
  // Let the pending promise from askQuestion resolve.
  await screen.findByText(text);
}

/** A real ComposedAnswer/ValidatedResult has many more fields than chat.tsx
 * ever reads (since WP20: `.text`, `.chart`, `answer.body` and the
 * result fields citation/stat-card extraction touch) — the shared
 * fake-answer fixture keeps that narrow read-surface honest with one
 * documented, isolated cast, rather than leaving every GatedResponse literal
 * in the test body untyped (the exact gap the WP13 review found: an untyped
 * mock lets a field-name typo on the kinds that DON'T need this cast —
 * unauthenticated / duplicate_request / insufficient_credits, all plain
 * scalar shapes — pass silently. Those three stay fully typed against
 * GatedResponse above; only the envelope, deliberately, does not.) */
function fakeAnswer(text: string, netCost = 20): GatedResponse {
  return {
    kind: 'ok',
    auditId: 1,
    netCost,
    response: fakeAnswerResponse({ body: text }) as ComposedResponse,
  };
}

/** Minimal clarification 'ok' outcome — chat.tsx reads kind/text/pending. */
function fakeClarification(text: string, netCost = 10): GatedResponse {
  return {
    kind: 'ok',
    auditId: 2,
    netCost,
    response: { kind: 'clarification', text, pending: { questionNl: text } } as unknown as ComposedResponse,
  };
}

/** A minimal, registry-shaped ConversationContext for testing propagation
 * only — chat.tsx never inspects its fields, only holds and forwards the
 * object, so the exact values are arbitrary but the shape is pinned to the
 * real type (same discipline as fakeAnswer above). */
function fakeContext(topicKey = 'bevolking'): ConversationContext {
  return {
    version: 1,
    topicKey,
    regions: null,
    period: { kind: 'year', year: 2024 },
    derivation: 'none',
  };
}

describe('Chat — GatedResponse branches', () => {
  it('shows a sign-in prompt for kind "unauthenticated", never the generic error', async () => {
    askQuestion.mockResolvedValue(outcome({ kind: 'unauthenticated' }));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText(/Log in via \/login/)).toBeInTheDocument();
    expect(screen.queryByText('Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.')).toBeNull();
  });

  it('shows a wait message for kind "duplicate_request"', async () => {
    askQuestion.mockResolvedValue(outcome({ kind: 'duplicate_request' }));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/al verwerkt/)).toBeInTheDocument();
  });

  it('shows the balance and required credits for kind "insufficient_credits"', async () => {
    askQuestion.mockResolvedValue(outcome({ kind: 'insufficient_credits', balance: 0, required: 1 }));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/0 over, 1 nodig/)).toBeInTheDocument();
  });

  it('renders the real answer text for kind "ok" (existing behavior, unaffected)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText('Nederland telt 18.044.027 inwoners.')).toBeInTheDocument();
  });

  it('shows the netCost exactly once, bound to the assistant message — never on the user message', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.', 20)));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    // Exactly one caption in the whole document (the WP8 lesson: membership
    // without binding lets a caption render on every message and still pass).
    const captions = await screen.findAllByText('20 credits');
    expect(captions).toHaveLength(1);
    // ...and it sits inside the assistant's (left-aligned) message block, as
    // a sibling of the answer bubble — not inside the user's block.
    const assistantBlock = screen.getByText('Nederland telt 18.044.027 inwoners.').closest('.text-left');
    expect(assistantBlock).not.toBeNull();
    expect(assistantBlock).toContainElement(captions[0]!);
  });

  it('shows no cost caption for a non-"ok" gated outcome', async () => {
    askQuestion.mockResolvedValue(outcome({ kind: 'duplicate_request' }));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/al verwerkt/)).toBeInTheDocument();
    expect(screen.queryByText(/credits$/)).toBeNull();
  });
});

describe('Chat — WP20 citation copy (#78)', () => {
  it('offers "Kopieer als citaat" under an answer and copies the built citation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');

    fireEvent.click(await screen.findByRole('button', { name: 'Kopieer als citaat' }));
    expect(await screen.findByText('Gekopieerd!')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      'Nederland telt 18.044.027 inwoners. (CBS StatLine, tabel 86141NED, gesynchroniseerd 3 juli 2026)',
    );
  });

  it('offers no citation button on a non-answer (clarification) message', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke gemeente bedoel je?')));
    render(<Chat />);
    await submit('Hoeveel werklozen zijn er?');
    expect(await screen.findByText('Welke gemeente bedoel je?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kopieer als citaat' })).toBeNull();
  });
});

describe('Chat — WP20 stat card (#80)', () => {
  it('renders the card for a single-cell answer, with the download button', async () => {
    const response = fakeAnswerResponse({
      body: 'De inflatie in 2024 was 3,3%.',
      shape: 'single',
      cells: [fakeCell()],
    });
    askQuestion.mockResolvedValue(outcome({ kind: 'ok', auditId: 1, netCost: 20, response: response as ComposedResponse }));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText('3,3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download als afbeelding' })).toBeInTheDocument();
  });

  it('renders no card for a series answer', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('De inflatie steeg van 2020 tot 2024.')));
    render(<Chat />);
    await submit('Hoe ontwikkelde de inflatie zich?');
    await screen.findByText('De inflatie steeg van 2020 tot 2024.');
    expect(screen.queryByRole('button', { name: 'Download als afbeelding' })).toBeNull();
  });
});

// WP21 (#52): unlike the PNG path (which needs real image decoding), the CSV
// download's SUCCESS leg is fully verifiable in jsdom — the Blob's exact
// content and the anchor's filename are asserted, not just the button.
describe('Chat — WP21 CSV export (#52)', () => {
  afterEach(() => {
    // jsdom's URL lacks createObjectURL entirely; remove what a test added
    // (the WP20 stat-card cleanup pattern).
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  it('offers "Download als CSV" under an answer and downloads exactly the built file', async () => {
    const blobs: Blob[] = [];
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:mock-csv';
    });
    const revoke = vi.fn();
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revoke;
    const clicked: { href: string; download: string }[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ href: this.href, download: this.download });
      });

    const response = fakeAnswerResponse({
      body: 'De inflatie in 2024 was 3,3%.',
      shape: 'single',
      cells: [fakeCell()],
    });
    askQuestion.mockResolvedValue(
      outcome({ kind: 'ok', auditId: 1, netCost: 20, response: response as ComposedResponse }),
    );
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');

    fireEvent.click(await screen.findByRole('button', { name: 'Download als CSV' }));

    const expected = buildAnswerCsv(response);
    expect(clicked).toEqual([{ href: 'blob:mock-csv', download: expected.filename }]);
    expect(blobs).toHaveLength(1);
    // Blob.text() strips a leading BOM by spec (UTF-8 decode), so the BOM is
    // asserted on the raw bytes and the text on the decoded remainder.
    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    await expect(blobs[0]!.text()).resolves.toBe(expected.content.replace(/^\ufeff/, ''));
    expect(blobs[0]!.type).toBe('text/csv;charset=utf-8');
    expect(revoke).toHaveBeenCalledWith('blob:mock-csv');
    expect(screen.queryByText('Downloaden lukte niet in deze browser.')).toBeNull();
    clickSpy.mockRestore();
  });

  it('offers no CSV button on a non-answer (clarification) message', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke gemeente bedoel je?')));
    render(<Chat />);
    await submit('Hoeveel werklozen zijn er?');
    expect(await screen.findByText('Welke gemeente bedoel je?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download als CSV' })).toBeNull();
  });

  it('shows the honest failure note when the browser API throws (jsdom default: no createObjectURL)', async () => {
    // Deliberately NO createObjectURL stub — the call throws, the catch leg
    // must surface the same failure copy the stat card uses.
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    fireEvent.click(await screen.findByRole('button', { name: 'Download als CSV' }));
    expect(await screen.findByText('Downloaden lukte niet in deze browser.')).toBeInTheDocument();
  });
});

// WP22 (#96a): a stale tab's first action after a deploy throws Next's
// UnrecognizedActionError — the chat must show the honest deploy message
// with a refresh affordance, never the misleading generic error. The test
// rejects with the REAL Next class (imported from Next's own module) so the
// detector's instanceof check is exercised, not mocked.
// WP23 (#84/#86/#90/#91/#71/#75): message-type styling, the source chip with
// the StatLine deep-link, the voorlopig pill, structural answer rendering
// (zero loss vs the assembled text), and the empty-state example chips.
describe('Chat — WP23 display smalls', () => {
  function fakeRefusal(text: string, reason = 'forecast'): GatedResponse {
    return {
      kind: 'ok',
      auditId: 3,
      netCost: 0,
      response: { kind: 'refusal', reason, text } as unknown as ComposedResponse,
    };
  }

  it('renders an answer from its structural fields with zero loss: body, staleness, definition, marking, chip (#90)', async () => {
    // The fixture's `text` mirrors the REAL production assembly (compose.ts:
    // [body, '', definitionLine, markingLine, attribution].join('\n'), then
    // respond.ts appends the staleness warning) — and the assertion below
    // walks every non-empty LINE of that assembled string, so a field the
    // production text carries that the structural rendering dropped fails
    // here (review fix: presence-of-fixture-fields alone pinned less than
    // the zero-loss claim said).
    const body = 'De inflatie in 2024 was 3,3%.';
    const definitionLine = 'Definitie: consumentenprijsindex (CPI), alle bestedingen.';
    const markingLine = 'bewerking van CBS-gegevens door checkdecijfers.nl';
    const attributionLine =
      'Bron: CBS StatLine, tabel 86141NED — Consumentenprijzen; prijsindex 2015=100. Gegevens gesynchroniseerd op 2026-07-03. Licentie: CC BY 4.0.';
    const stalenessWarning = 'Let op: deze tabel wordt normaal maandelijks bijgewerkt door CBS.';
    const assembledText =
      [body, '', definitionLine, markingLine, attributionLine].join('\n') + '\n\n' + stalenessWarning;
    const response = fakeAnswerResponse({
      body,
      text: assembledText,
      definitionLine,
      markingLine,
      attributionLine,
      stalenessWarning,
      cells: [fakeCell()],
    });
    askQuestion.mockResolvedValue(
      outcome({ kind: 'ok', auditId: 1, netCost: 20, response: response as ComposedResponse }),
    );
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText('De inflatie in 2024 was 3,3%.')).toBeInTheDocument();
    // Zero loss vs the production-assembled text: every non-empty line of
    // `text` must be visible somewhere in the rendered message.
    for (const line of assembledText.split('\n').filter((l) => l.trim() !== '')) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    // The chip carries the FULL R4 sentence, always visible (#90), plus the
    // pinned StatLine deep-link (#86) bound to the answer's own table id.
    expect(
      screen.getByText(
        'Bron: CBS StatLine, tabel 86141NED — Consumentenprijzen; prijsindex 2015=100. Gegevens gesynchroniseerd op 2026-07-03. Licentie: CC BY 4.0.',
      ),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Bekijk bij CBS StatLine' });
    expect(link).toHaveAttribute('href', 'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/86141NED/table');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('binds the StatLine link to the ANSWER OWN table id, not a constant (#86 binding)', async () => {
    // A different table than the fixture default — a hardcoded-URL mutation
    // (the membership-without-binding class) must fail here.
    askQuestion.mockResolvedValue(
      outcome({
        kind: 'ok',
        auditId: 1,
        netCost: 20,
        response: fakeAnswerResponse({
          body: 'De werkloosheid was 3,8%.',
          tableId: '85224NED',
          cells: [fakeCell({ tableId: '85224NED' })],
        }) as ComposedResponse,
      }),
    );
    render(<Chat />);
    await submit('Hoe hoog is de werkloosheid?');
    const link = await screen.findByRole('link', { name: 'Bekijk bij CBS StatLine' });
    expect(link).toHaveAttribute('href', 'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/85224NED/table');
  });

  it('shows the amber voorlopig pill exactly when a quoted cell is provisional (#71)', async () => {
    askQuestion.mockResolvedValueOnce(
      outcome({
        kind: 'ok',
        auditId: 1,
        netCost: 20,
        response: fakeAnswerResponse({
          body: 'Serie-antwoord met voorlopige cijfers.',
          cells: [fakeCell(), fakeCell({ resultId: 'X', provisional: true, status: 'Voorlopig' })],
        }) as ComposedResponse,
      }),
    );
    render(<Chat />);
    await submit('Hoe ontwikkelde de inflatie zich?');
    expect(await screen.findByText('voorlopig')).toBeInTheDocument();
    cleanup();

    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Definitief antwoord zonder voorbehoud.')));
    render(<Chat />);
    await submit('Wat was de inflatie in 2023?');
    await screen.findByText('Definitief antwoord zonder voorbehoud.');
    expect(screen.queryByText('voorlopig')).toBeNull();
  });

  it('styles a clarification amber and repeats no fixed refusal strings (#84)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke gemeente bedoel je?')));
    render(<Chat />);
    await submit('Hoeveel werklozen zijn er?');
    const bubble = await screen.findByText('Welke gemeente bedoel je?');
    expect(bubble.className).toContain('bg-amber-50');
    expect(screen.queryByText('Dit kon ik niet beantwoorden')).toBeNull();
  });

  it('announces a refusal with the two fixed strings (#84)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeRefusal('Ik kan geen voorspellingen doen.')));
    render(<Chat />);
    await submit('Wordt de inflatie volgend jaar hoger?');
    expect(await screen.findByText('Ik kan geen voorspellingen doen.')).toBeInTheDocument();
    // Position-bound, not just present (worktree-lens catch: a swap of the
    // two strings between header and badge survived presence checks): the
    // header IS the bold span, the badge IS the pill.
    expect(screen.getByText('Dit kon ik niet beantwoorden').className).toContain('font-semibold');
    expect(screen.getByText('geen antwoord = geen gok').className).toContain('rounded-full');
    // A refusal has no attribution chip — there is no source to cite.
    expect(screen.queryByRole('link', { name: 'Bekijk bij CBS StatLine' })).toBeNull();
  });

  it('never puts the refusal header on a META answer — the envelope is refusal-kind by design, the text ANSWERS (#84 review fix, HIGH)', async () => {
    askQuestion.mockResolvedValue(
      outcome(fakeRefusal('Al mijn cijfers komen rechtstreeks uit officiële tabellen van CBS StatLine.', 'meta')),
    );
    render(<Chat />);
    await submit('Welke bronnen gebruik je?');
    expect(
      await screen.findByText('Al mijn cijfers komen rechtstreeks uit officiële tabellen van CBS StatLine.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Dit kon ik niet beantwoorden')).toBeNull();
    expect(screen.queryByText('geen antwoord = geen gok')).toBeNull();
  });

  it('never puts the refusal header on a smalltalk reply (#84 review fix)', async () => {
    askQuestion.mockResolvedValue(
      outcome(fakeRefusal('Ik beantwoord vragen over officiële CBS-cijfers.', 'smalltalk')),
    );
    render(<Chat />);
    await submit('Hoi!');
    expect(await screen.findByText('Ik beantwoord vragen over officiële CBS-cijfers.')).toBeInTheDocument();
    expect(screen.queryByText('Dit kon ik niet beantwoorden')).toBeNull();
  });

  // WP16 sub-part 2 (ADR 026): the onboarding acknowledgment rides the refusal
  // envelope but ANSWERS ("we're fetching it") — like meta/smalltalk it must
  // NOT show the refusal header or the geen-gok badge, and the caption shows
  // the 100-credit fetch cost the web action put on netCost.
  it('renders an onboarding_pending acknowledgment as plain info with the 100-credit caption', async () => {
    const ack =
      'Dat onderwerp staat nog niet in onze database. We vragen de cijfers nu automatisch op bij het CBS en controleren ze — meestal een kwestie van minuten. Je krijgt een e-mail zodra je vraag beantwoord kan worden. Heb je ondertussen nog een andere vraag?';
    askQuestion.mockResolvedValue(
      outcome({
        kind: 'ok',
        auditId: 7,
        netCost: 100,
        response: {
          kind: 'refusal',
          reason: 'onboarding_pending',
          text: ack,
          onboarding: { tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91 },
        } as unknown as ComposedResponse,
      }),
    );
    render(<Chat />);
    await submit('Hoeveel zonnestroom werd er opgewekt in 2024?');
    expect(await screen.findByText(ack)).toBeInTheDocument();
    expect(screen.queryByText('Dit kon ik niet beantwoorden')).toBeNull();
    expect(screen.queryByText('geen antwoord = geen gok')).toBeNull();
    expect(await screen.findByText('100 credits')).toBeInTheDocument();
  });

  it('renders an onboarding_already_pending acknowledgment as plain info, no header', async () => {
    const ack =
      'Deze cijfers worden al voor je opgehaald bij het CBS. Je krijgt een e-mail zodra je vraag beantwoord kan worden.';
    askQuestion.mockResolvedValue(
      outcome({
        kind: 'ok',
        auditId: 8,
        netCost: 0,
        response: {
          kind: 'refusal',
          reason: 'onboarding_already_pending',
          text: ack,
          onboarding: null,
        } as unknown as ComposedResponse,
      }),
    );
    render(<Chat />);
    await submit('Hoeveel zonnestroom werd er opgewekt in 2024?');
    expect(await screen.findByText(ack)).toBeInTheDocument();
    expect(screen.queryByText('Dit kon ik niet beantwoorden')).toBeNull();
    expect(screen.queryByText('geen antwoord = geen gok')).toBeNull();
  });

  it('keeps answers free of the refusal strings and the amber clarification style (#84)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    const bubble = await screen.findByText('Nederland telt 18.044.027 inwoners.');
    expect(bubble.className).not.toContain('bg-amber-50');
    expect(screen.queryByText('Dit kon ik niet beantwoorden')).toBeNull();
    expect(screen.queryByText('geen antwoord = geen gok')).toBeNull();
  });

  it('offers example chips on the empty chat that FILL the input, never send (#75)', async () => {
    render(<Chat />);
    const chip = screen.getByRole('button', { name: 'Wat was de inflatie in 2024?' });
    fireEvent.click(chip);
    expect(screen.getByPlaceholderText('Stel een vraag…')).toHaveValue('Wat was de inflatie in 2024?');
    expect(askQuestion).not.toHaveBeenCalled();
  });

  it('hides the example chips once a conversation exists (#75)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(screen.queryByRole('button', { name: 'Wat was de inflatie in 2024?' })).toBeNull();
  });
});

// WP29 (#73, ADR 029): follow-up chips under an answer — the server-gated
// `suggestions` field renders as chips with the #75 fill-don't-send behavior.
describe('Chat — WP29 follow-up suggestion chips (#73)', () => {
  /** An 'ok' outcome whose answer carries server-gated suggestions. */
  function answerWithSuggestions(body: string, suggestions: string[]): GatedResponse {
    return {
      kind: 'ok',
      auditId: 3,
      netCost: 20,
      response: fakeAnswerResponse({ body, suggestions }) as ComposedResponse,
    };
  }

  it('renders the chips under an answer; clicking FILLS the input and never sends (the #75 handler verbatim)', async () => {
    askQuestion.mockResolvedValue(
      outcome(
        answerWithSuggestions('De inflatie bedroeg in 2024 3,3%.', [
          'Wat was inflatie (jaarmutatie CPI, alle bestedingen) in 2025?',
          'Hoe ontwikkelde inflatie (jaarmutatie CPI, alle bestedingen) zich van 2020 tot en met 2024?',
        ]),
      ),
    );
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');

    const chip = await screen.findByRole('button', {
      name: 'Wat was inflatie (jaarmutatie CPI, alle bestedingen) in 2025?',
    });
    expect(
      screen.getByRole('button', {
        name: 'Hoe ontwikkelde inflatie (jaarmutatie CPI, alle bestedingen) zich van 2020 tot en met 2024?',
      }),
    ).toBeInTheDocument();

    fireEvent.click(chip);
    expect(screen.getByPlaceholderText('Stel een vraag…')).toHaveValue(
      'Wat was inflatie (jaarmutatie CPI, alle bestedingen) in 2025?',
    );
    // Fill, never send: only the original submit reached the server action.
    expect(askQuestion).toHaveBeenCalledTimes(1);
  });

  it('renders NO chip block when suggestions is empty (zero survivors of the server gate)', async () => {
    askQuestion.mockResolvedValue(
      outcome(answerWithSuggestions('De inflatie bedroeg in 2024 3,3%.', [])),
    );
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    await screen.findByText('De inflatie bedroeg in 2024 3,3%.');
    // The only buttons left are the form + per-answer action buttons — no
    // rounded suggestion chip carries a question.
    expect(screen.queryByRole('button', { name: /Wat was .*\?/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Hoe ontwikkelde .*\?/ })).toBeNull();
  });
});

describe('Chat — WP22 stale-deploy action failure (#96a)', () => {
  it('shows the honest deploy copy + refresh button, never the generic error', async () => {
    askQuestion.mockRejectedValue(
      new UnrecognizedActionError('Server Action "709ed9" was not found on the server.'),
    );
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(
      await screen.findByText(/De site is net bijgewerkt, waardoor deze vraag niet is verstuurd/),
    ).toBeInTheDocument();
    expect(screen.getByText(/geen credits\s+afgeschreven/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ververs de pagina' })).toBeInTheDocument();
    expect(
      screen.queryByText('Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.'),
    ).toBeNull();
    // The form recovered (busy cleared) — the user can type again.
    expect(screen.getByPlaceholderText('Stel een vraag…')).not.toBeDisabled();
  });

  it('the refresh button really reloads (worktree-lens catch: onClick was unbound)', async () => {
    // vi.spyOn(window.location, 'reload') throws in jsdom (non-configurable
    // property) — full-object replacement is the working idiom, proven by
    // the WP22 review's executing lens.
    const original = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...original, reload },
      configurable: true,
      writable: true,
    });
    try {
      askQuestion.mockRejectedValue(new UnrecognizedActionError('gone'));
      render(<Chat />);
      await submit('Wat was de inflatie in 2024?');
      fireEvent.click(await screen.findByRole('button', { name: 'Ververs de pagina' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true });
    }
  });

  it('keeps the generic copy for any other thrown error', async () => {
    askQuestion.mockRejectedValue(new Error('network down'));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(
      await screen.findByText('Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/De site is net bijgewerkt/)).toBeNull();
  });

  it('clears the deploy notice on the next submit', async () => {
    askQuestion.mockRejectedValueOnce(new UnrecognizedActionError('gone'));
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/De site is net bijgewerkt/)).toBeInTheDocument();
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText('Nederland telt 18.044.027 inwoners.')).toBeInTheDocument();
    expect(screen.queryByText(/De site is net bijgewerkt/)).toBeNull();
  });
});

describe('Chat — WP20 cost transparency (#82)', () => {
  const pricing = { simple: 20, clarification: 10, balance: 100 };

  it('shows the pre-send cost line with live prices and balance', () => {
    render(<Chat pricing={pricing} />);
    expect(
      screen.getByText(
        'Een vraag kost ~20 credits · saldo: 100 credits. Stel ik eerst een verduidelijkingsvraag, dan kost die 10 credits en krijg je de rest terug.',
      ),
    ).toBeInTheDocument();
  });

  it('repeats the reply price at the clarification message itself', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke gemeente bedoel je?')));
    render(<Chat pricing={pricing} />);
    await submit('Hoeveel werklozen zijn er?');
    expect(
      await screen.findByText('10 credits · antwoorden op de wedervraag kost ~20 credits'),
    ).toBeInTheDocument();
  });

  it('renders none of the cost surfaces without the pricing prop', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke gemeente bedoel je?')));
    render(<Chat />);
    await submit('Hoeveel werklozen zijn er?');
    expect(screen.queryByText(/saldo/)).toBeNull();
    expect(await screen.findByText('10 credits')).toBeInTheDocument();
    expect(screen.queryByText(/wedervraag kost/)).toBeNull();
  });
});

describe('Chat — WP19 onOutcome reporting (open-questions #68)', () => {
  it('reports the gated outcome exactly once per submit, for ok and non-ok kinds alike', async () => {
    const onOutcome = vi.fn();
    const answer = fakeAnswer('Nederland telt 18.044.027 inwoners.');
    askQuestion.mockResolvedValueOnce(outcome(answer));
    askQuestion.mockResolvedValueOnce(outcome({ kind: 'insufficient_credits', balance: 5, required: 20 }));
    render(<Chat onOutcome={onOutcome} />);

    await submit('Hoeveel inwoners heeft Nederland?');
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenNthCalledWith(1, answer);

    await submit('Wat was de inflatie in 2024?');
    expect(onOutcome).toHaveBeenCalledTimes(2);
    expect(onOutcome).toHaveBeenNthCalledWith(2, { kind: 'insufficient_credits', balance: 5, required: 20 });
  });

  it('works without onOutcome (the prop is optional; existing call sites unaffected)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText('Nederland telt 18.044.027 inwoners.')).toBeInTheDocument();
  });
});

describe('Chat — WP15 conversation context propagation (ADR 021)', () => {
  it('sends the context from a prior "ok" outcome as the next askQuestion call', async () => {
    const context = fakeContext();
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.'), context));
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Rotterdam telt 656.050 inwoners.')));
    render(<Chat />);

    await submit('Hoeveel inwoners heeft Nederland?');
    expect(askQuestion).toHaveBeenNthCalledWith(1, 'Hoeveel inwoners heeft Nederland?', expect.any(String), null);

    await submit('En Rotterdam?');
    expect(askQuestion).toHaveBeenNthCalledWith(2, 'En Rotterdam?', expect.any(String), context);
  });

  it('leaves the held context in place when an "ok" outcome carries context null', async () => {
    const context = fakeContext();
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.'), context));
    // A smalltalk/refusal detour: 'ok' but no honest referent (ADR 021).
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Hallo! Stel gerust een vraag over CBS-cijfers.'), null));
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Rotterdam telt 656.050 inwoners.')));
    render(<Chat />);

    await submit('Hoeveel inwoners heeft Nederland?');
    await submit('Hoi!');
    expect(askQuestion).toHaveBeenNthCalledWith(2, 'Hoi!', expect.any(String), context);

    await submit('En Rotterdam?');
    // Still the FIRST context — the null from turn 2 never overwrote it.
    expect(askQuestion).toHaveBeenNthCalledWith(3, 'En Rotterdam?', expect.any(String), context);
  });

  it('leaves the held context unchanged on a non-"ok" gated outcome (e.g. insufficient_credits)', async () => {
    const context = fakeContext();
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.'), context));
    askQuestion.mockResolvedValueOnce(outcome({ kind: 'insufficient_credits', balance: 0, required: 1 }));
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Rotterdam telt 656.050 inwoners.')));
    render(<Chat />);

    await submit('Hoeveel inwoners heeft Nederland?');
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/0 over, 1 nodig/)).toBeInTheDocument();
    expect(askQuestion).toHaveBeenNthCalledWith(2, 'Wat was de inflatie in 2024?', expect.any(String), context);

    await submit('En Rotterdam?');
    // Still the FIRST context — the gated non-'ok' outcome changed nothing.
    expect(askQuestion).toHaveBeenNthCalledWith(3, 'En Rotterdam?', expect.any(String), context);
  });
});

describe('Chat — WP128 feedback buttons (#128)', () => {
  it('an answer with an auditId renders both feedback buttons, wired to the real-module action', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Het antwoord is 42.')));
    submitAnswerFeedback.mockResolvedValue({ ok: true });
    render(<Chat />);
    await submit('Hoeveel?');
    await screen.findByText('Het antwoord is 42.');
    const up = screen.getByRole('button', { name: 'Nuttig antwoord' });
    expect(screen.getByRole('button', { name: 'Niet nuttig' })).toBeTruthy();
    fireEvent.click(up);
    await screen.findByText('Bedankt voor je feedback.');
    // The anchor is the fakeAnswer's auditId (1) — the store's write key.
    expect(submitAnswerFeedback).toHaveBeenCalledWith(1, 'up', undefined);
  });

  it('an answer whose audit write failed (auditId null) renders NO feedback buttons', async () => {
    const gated = fakeAnswer('Antwoord zonder audit.');
    (gated as { auditId: number | null }).auditId = null;
    askQuestion.mockResolvedValue(outcome(gated));
    render(<Chat />);
    await submit('Hoeveel?');
    await screen.findByText('Antwoord zonder audit.');
    expect(screen.queryByRole('button', { name: 'Nuttig antwoord' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Niet nuttig' })).toBeNull();
  });

  it('a clarification renders NO feedback buttons (answers only)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke periode bedoel je?')));
    render(<Chat />);
    await submit('Hoeveel?');
    await screen.findByText('Welke periode bedoel je?');
    expect(screen.queryByRole('button', { name: 'Nuttig antwoord' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Niet nuttig' })).toBeNull();
  });

  it('an answer reached via the CLARIFICATION-REPLY path gets buttons too (both entry paths share the anchor)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke periode bedoel je?')));
    replyToClarification.mockResolvedValue(outcome(fakeAnswer('In 2024 was het 3,3%.')));
    submitAnswerFeedback.mockResolvedValue({ ok: true });
    render(<Chat />);
    await submit('Wat was de inflatie?');
    await screen.findByText('Welke periode bedoel je?');
    // While a clarification is pending the input's placeholder IS the
    // clarifying question (chat.tsx) — the submit helper's default one is gone.
    fireEvent.change(screen.getByPlaceholderText('Welke periode bedoel je?'), {
      target: { value: '2024' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await screen.findByText('In 2024 was het 3,3%.');
    const up = screen.getByRole('button', { name: 'Nuttig antwoord' });
    fireEvent.click(up);
    await screen.findByText('Bedankt voor je feedback.');
    // The anchor is the reply-path answer's auditId (fakeAnswer -> 1).
    expect(submitAnswerFeedback).toHaveBeenCalledWith(1, 'up', undefined);
  });
});

// WP129+130 (#129/#130, ADR 032): the source-tags chips + the unverified-web
// section. The chips render (and a selection payload rides every submit) ONLY
// when the websearch prop is present; the section renders keyed on the FIELD
// VALUE, below everything else.
describe('Chat — WP129+130 source chips (#129)', () => {
  const pricing = { simple: 20, clarification: 10, balance: 100, websearch: { enabled: true as const, addonPrice: 10 } };

  it('renders no chips without the websearch prop (byte-identical to today)', () => {
    render(<Chat pricing={{ simple: 20, clarification: 10, balance: 100 }} />);
    expect(screen.queryByRole('button', { name: 'CBS data' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Internet' })).toBeNull();
  });

  it('renders CBS pre-checked and Internet off when the websearch prop is present', () => {
    render(<Chat pricing={pricing} />);
    expect(screen.getByRole('button', { name: 'CBS data', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Internet', pressed: false })).toBeInTheDocument();
  });

  it('toggles the chips (aria-pressed) on click', () => {
    render(<Chat pricing={pricing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Internet' }));
    expect(screen.getByRole('button', { name: 'Internet', pressed: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'CBS data' }));
    expect(screen.getByRole('button', { name: 'CBS data', pressed: false })).toBeInTheDocument();
  });

  it('sends the selection payload as the 4th arg on submit (default: cbs, web:false)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat pricing={pricing} />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(askQuestion).toHaveBeenCalledWith('Hoeveel inwoners heeft Nederland?', expect.any(String), null, {
      sources: ['cbs'],
      web: false,
    });
  });

  it('reflects the Internet toggle in the sent payload', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat pricing={pricing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Internet' }));
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(askQuestion).toHaveBeenCalledWith('Hoeveel inwoners heeft Nederland?', expect.any(String), null, {
      sources: ['cbs'],
      web: true,
    });
  });

  it('disables send + shows the hint when everything is deselected', () => {
    render(<Chat pricing={pricing} />);
    fireEvent.click(screen.getByRole('button', { name: 'CBS data' })); // deselect the only source
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'iets' } });
    expect(screen.getByRole('button', { name: 'Verstuur' })).toBeDisabled();
    expect(screen.getByText('Selecteer minstens één bron.')).toBeInTheDocument();
  });

  it('the busy indicator names CBS én het web when the Internet chip is on (go-live owner feedback 2026-07-12)', async () => {
    let resolveAsk!: (v: AskOutcome) => void;
    askQuestion.mockReturnValue(new Promise<AskOutcome>((r) => { resolveAsk = r; }));
    render(<Chat pricing={pricing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Internet' }));
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Vraag?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    expect(
      await screen.findByText('Bezig met het doorzoeken van CBS-cijfers en het web…'),
    ).toBeInTheDocument();
    resolveAsk(outcome(fakeAnswer('Klaar.')));
    await screen.findByText('Klaar.');
  });

  it('the busy indicator names only het web in web-only mode, and only CBS with Internet off', async () => {
    let resolveAsk!: (v: AskOutcome) => void;
    askQuestion.mockReturnValue(new Promise<AskOutcome>((r) => { resolveAsk = r; }));
    render(<Chat pricing={pricing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Internet' })); // web on
    fireEvent.click(screen.getByRole('button', { name: 'CBS data' })); // cbs off
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Vraag?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    expect(await screen.findByText('Bezig met het doorzoeken van het web…')).toBeInTheDocument();
    resolveAsk(outcome(fakeAnswer('Klaar.')));
    await screen.findByText('Klaar.');
    // Internet back off ⇒ the pre-WP copy, byte-identical.
    fireEvent.click(screen.getByRole('button', { name: 'CBS data' }));
    fireEvent.click(screen.getByRole('button', { name: 'Internet' }));
    askQuestion.mockReturnValue(new Promise<AskOutcome>(() => {}));
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Nog een?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    expect(
      await screen.findByText('Bezig met het doorzoeken van CBS-cijfers…'),
    ).toBeInTheDocument();
  });

  it('sends the selection payload on the CLARIFICATION-REPLY path too (post-build review: the pending+websearch leg)', async () => {
    // The brief's "sent on EVERY submit (both actions)" claim: the reply turn
    // carries the same chips state as the question turn — a dropped 4th arg or
    // a swapped ternary branch in chat.tsx's submit would silently skip the
    // web add-on on clarification replies despite the Internet chip being on.
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke periode bedoel je?')));
    replyToClarification.mockResolvedValue(outcome(fakeAnswer('In 2024 was het 3,3%.')));
    render(<Chat pricing={pricing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Internet' })); // web on before the question
    await submit('Wat was de inflatie?');
    await screen.findByText('Welke periode bedoel je?');
    fireEvent.change(screen.getByPlaceholderText('Welke periode bedoel je?'), {
      target: { value: '2024' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await screen.findByText('In 2024 was het 3,3%.');
    expect(replyToClarification).toHaveBeenCalledWith(expect.anything(), '2024', expect.any(String), {
      sources: ['cbs'],
      web: true,
    });
  });
});

describe('Chat — WP129+130 cost-line variants (⟨W4⟩)', () => {
  const pricing = { simple: 20, clarification: 10, balance: 100, websearch: { enabled: true as const, addonPrice: 10 } };

  it('shows the base line when Internet is off', () => {
    render(<Chat pricing={pricing} />);
    expect(screen.getByText(/Een vraag kost ~20 credits · saldo: 100 credits/)).toBeInTheDocument();
  });

  it('CBS + internet: "~30 credits (waarvan 10 voor internet)"', () => {
    render(<Chat pricing={pricing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Internet' }));
    expect(screen.getByText(/~30 credits \(waarvan 10 voor internet\)/)).toBeInTheDocument();
  });

  it('web-only: "~10 credits (er wordt tijdelijk 30 gereserveerd)"', () => {
    render(<Chat pricing={pricing} />);
    fireEvent.click(screen.getByRole('button', { name: 'Internet' })); // web on
    fireEvent.click(screen.getByRole('button', { name: 'CBS data' })); // cbs off
    expect(screen.getByText(/~10 credits \(er wordt tijdelijk 30 gereserveerd\)/)).toBeInTheDocument();
  });
});

describe('Chat — WP129+130 web section rendering (#130)', () => {
  function okSection(overrides: Partial<Extract<WebSection, { status: 'ok' }>> = {}): WebSection {
    return {
      status: 'ok',
      findings: [
        { text: 'Een bevinding van het web.', citations: [{ url: 'https://www.example.nl/pad', title: null }] },
      ],
      model: 'claude-sonnet-5',
      searches: 1,
      usage: { inputTokens: 10, outputTokens: 5 },
      promptVersion: 1,
      ...overrides,
    };
  }

  function answerWithSection(body: string, webSection: WebSection): GatedResponse {
    return {
      kind: 'ok',
      auditId: 1,
      netCost: 30,
      response: { ...fakeAnswerResponse({ body }), webSection } as unknown as ComposedResponse,
    };
  }

  function refusalWithSection(text: string, reason: string, webSection: WebSection): GatedResponse {
    return {
      kind: 'ok',
      auditId: 3,
      netCost: 10,
      response: { kind: 'refusal', reason, text, webSection } as unknown as ComposedResponse,
    };
  }

  it('renders the header, finding, and a DOMAIN-ONLY anchor with the safe rel attrs', async () => {
    askQuestion.mockResolvedValue(outcome(answerWithSection('Nederland telt 18.044.027 inwoners.', okSection())));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    const header = await screen.findByText('Van het web (niet door checkdecijfers geverifieerd)');
    const block = header.parentElement!;
    expect(block).toHaveTextContent('Een bevinding van het web.');
    // Domain-only (www stripped), full URL in href, opened safely.
    const link = within(block).getByRole('link', { name: 'example.nl' });
    expect(link).toHaveAttribute('href', 'https://www.example.nl/pad');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('caps the rendered findings at 4', async () => {
    const findings = Array.from({ length: 6 }, (_, i) => ({
      text: `Bevinding ${i}.`,
      citations: [{ url: `https://bron${i}.nl/x`, title: null }],
    }));
    askQuestion.mockResolvedValue(
      outcome(answerWithSection('Antwoord.', okSection({ findings }))),
    );
    render(<Chat />);
    await submit('Vraag?');
    const header = await screen.findByText('Van het web (niet door checkdecijfers geverifieerd)');
    expect(within(header.parentElement!).getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders one domain link per citation on a multi-citation finding (⟨W9⟩ — by-design shape)', async () => {
    // The client can legitimately emit ONE finding carrying several citations
    // (a single cited text block with multiple sources — pinned backend-side in
    // tests/websearch/client.test.ts). The UI must render every link, each
    // domain-only with the full URL in href.
    askQuestion.mockResolvedValue(
      outcome(
        answerWithSection(
          'Antwoord.',
          okSection({
            findings: [
              {
                text: 'Bevinding met twee bronnen.',
                citations: [
                  { url: 'https://www.cbs.nl/a', title: null },
                  { url: 'https://nos.nl/b', title: 'NOS' },
                ],
              },
            ],
          }),
        ),
      ),
    );
    render(<Chat />);
    await submit('Vraag?');
    const header = await screen.findByText('Van het web (niet door checkdecijfers geverifieerd)');
    const item = within(header.parentElement!).getByRole('listitem');
    const links = within(item).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['cbs.nl', 'nos.nl']);
    expect(links[0]).toHaveAttribute('href', 'https://www.cbs.nl/a');
    expect(links[1]).toHaveAttribute('href', 'https://nos.nl/b');
  });

  it('shows the insufficient-balance failure note', async () => {
    askQuestion.mockResolvedValue(
      outcome(answerWithSection('Antwoord.', { status: 'failed', code: 'insufficient_balance' })),
    );
    render(<Chat />);
    await submit('Vraag?');
    expect(
      await screen.findByText('De webzoekopdracht is niet uitgevoerd (onvoldoende saldo) — geen extra kosten.'),
    ).toBeInTheDocument();
  });

  it('shows the generic failure note for every other code (incl. not_configured)', async () => {
    askQuestion.mockResolvedValue(
      outcome(answerWithSection('Antwoord.', { status: 'failed', code: 'not_configured' })),
    );
    render(<Chat />);
    await submit('Vraag?');
    expect(
      await screen.findByText('De webzoekopdracht is niet gelukt — geen extra kosten.'),
    ).toBeInTheDocument();
  });

  it('renders the section BELOW a refusal (Q5 coexistence)', async () => {
    askQuestion.mockResolvedValue(
      outcome(refusalWithSection('Ik kan geen voorspellingen doen.', 'forecast', okSection())),
    );
    render(<Chat />);
    await submit('Wordt de inflatie volgend jaar hoger?');
    expect(await screen.findByText('Ik kan geen voorspellingen doen.')).toBeInTheDocument();
    expect(screen.getByText('Dit kon ik niet beantwoorden')).toBeInTheDocument();
    expect(screen.getByText('Van het web (niet door checkdecijfers geverifieerd)')).toBeInTheDocument();
  });

  it('renders the section under a web_only refusal (the web-only mode)', async () => {
    askQuestion.mockResolvedValue(
      outcome(
        refusalWithSection(
          'Je hebt CBS-data uitgeschakeld voor deze vraag, dus ik geef geen geverifieerd antwoord.',
          'web_only',
          okSection(),
        ),
      ),
    );
    render(<Chat />);
    await submit('Iets zonder CBS.');
    expect(
      await screen.findByText(/Je hebt CBS-data uitgeschakeld voor deze vraag/),
    ).toBeInTheDocument();
    expect(screen.getByText('Van het web (niet door checkdecijfers geverifieerd)')).toBeInTheDocument();
  });

  it('renders NOTHING web-shaped when webSection is absent (the ?? null deploy-skew guard)', async () => {
    // fakeAnswer's response carries no webSection field → ?? null → no block.
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    await screen.findByText('Nederland telt 18.044.027 inwoners.');
    expect(screen.queryByText('Van het web (niet door checkdecijfers geverifieerd)')).toBeNull();
  });
});
