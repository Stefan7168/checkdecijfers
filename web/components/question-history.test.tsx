// QuestionHistory (user dashboard, docs/06-roadmap.md "question history"):
// truncation, cost/date display, and the empty state -- the actual logic
// worth pinning in this otherwise-plain Server Component.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionHistoryEntry } from '../backend/billing/index.ts';
import { QuestionHistory } from './question-history.tsx';

afterEach(cleanup);

function entry(overrides: Partial<QuestionHistoryEntry> = {}): QuestionHistoryEntry {
  return {
    id: 1,
    source: 'audit',
    kind: 'answer',
    question: 'Hoeveel inwoners heeft Nederland?',
    finalText: 'Nederland telt 18.044.027 inwoners.',
    createdAt: '2026-07-04T14:19:31.199Z',
    creditsCharged: 20,
    clarification: null,
    isDeleted: false,
    onboarding: null,
    ...overrides,
  };
}

describe('QuestionHistory', () => {
  it('shows an empty-state message when there are no past questions', () => {
    render(<QuestionHistory items={[]} />);
    expect(screen.getByText('Nog geen eerdere vragen.')).toBeInTheDocument();
  });

  it('renders the question, credits charged, and the full answer text (available even collapsed)', () => {
    render(<QuestionHistory items={[entry()]} />);
    expect(screen.getByText('Hoeveel inwoners heeft Nederland?')).toBeInTheDocument();
    expect(screen.getByText(/20 credits/)).toBeInTheDocument();
    // Short text isn't truncated, so it legitimately appears twice (the
    // collapsed snippet and the expanded full text) — assert presence, not
    // uniqueness.
    expect(screen.getAllByText('Nederland telt 18.044.027 inwoners.').length).toBeGreaterThanOrEqual(1);
  });

  it('truncates a long answer in the collapsed snippet', () => {
    const longText = 'A'.repeat(200);
    render(<QuestionHistory items={[entry({ finalText: longText })]} />);
    expect(screen.getByText(`${'A'.repeat(120)}…`)).toBeInTheDocument();
  });

  it('omits the credits label when creditsCharged is null (a row with no attributable debit)', () => {
    render(<QuestionHistory items={[entry({ creditsCharged: null })]} />);
    expect(screen.queryByText(/credits/)).toBeNull();
  });

  // WP19 (open-questions #67): a collapsed clarification round renders as ONE
  // item -- original question, the exchange inside the fold, final outcome.
  it('renders a collapsed clarification round as one item with the full exchange', () => {
    render(
      <QuestionHistory
        items={[
          entry({
            kind: 'answer',
            question: 'Hoeveel inwoners heeft de gemeente?',
            finalText: 'Amsterdam telt 931.298 inwoners.',
            creditsCharged: 30,
            clarification: { text: 'Welke gemeente bedoel je?', reply: 'Amsterdam' },
          }),
        ]}
      />,
    );
    // One entry, one summary line -- never two rows for the same question.
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByText('Hoeveel inwoners heeft de gemeente?')).toBeInTheDocument();
    expect(screen.getByText('Welke gemeente bedoel je?')).toBeInTheDocument();
    expect(screen.getByText('Amsterdam')).toBeInTheDocument();
    // The round's TOTAL, shown once on the summary line and LABELED as a
    // total (review finding: unlabeled it reads as one answer's price).
    expect(screen.getByText(/30 credits totaal/)).toBeInTheDocument();
    expect(screen.getAllByText('Amsterdam telt 931.298 inwoners.').length).toBeGreaterThanOrEqual(1);
  });

  it('renders no exchange block and no "totaal" label when clarification is null', () => {
    render(<QuestionHistory items={[entry()]} />);
    expect(screen.queryByText('Verduidelijkingsvraag')).toBeNull();
    expect(screen.queryByText('Jouw antwoord')).toBeNull();
    // Binding both ways: a single-turn answer's price must NOT be labeled
    // as a total.
    expect(screen.queryByText(/totaal/)).toBeNull();
  });

  // #14 (GDPR self-service deletion + retention purge): a redacted row must
  // render as a "verwijderde vraag" placeholder -- never hidden (the row
  // itself, and its credit amount, must stay visible), never leaking the
  // original question or answer text.
  describe('deleted-question placeholder (#14)', () => {
    it('shows the placeholder label instead of the question, keeps the credit amount visible', () => {
      render(
        <QuestionHistory
          items={[
            entry({
              question: 'Deze vraag is verwijderd.',
              finalText: 'Deze vraag is verwijderd.',
              creditsCharged: 20,
              isDeleted: true,
            }),
          ]}
        />,
      );
      expect(screen.getByText('Verwijderde vraag')).toBeInTheDocument();
      expect(screen.getByText(/20 credits/)).toBeInTheDocument();
      // The row still expands to an honest "text is gone" note, never the
      // literal redaction sentinel and never silence.
      expect(screen.getByText('De tekst van deze vraag is verwijderd.')).toBeInTheDocument();
    });

    it('never renders the raw redaction sentinel text as if it were real content', () => {
      render(
        <QuestionHistory
          items={[
            entry({
              question: 'Deze vraag is verwijderd.',
              finalText: 'Deze vraag is verwijderd.',
              isDeleted: true,
            }),
          ]}
        />,
      );
      // The sentinel string must not appear verbatim anywhere in the
      // rendered output -- only the distinct placeholder copy should.
      expect(screen.queryByText('Deze vraag is verwijderd.', { exact: true })).toBeNull();
    });

    it('renders no clarification exchange for a deleted round, even if one was recorded', () => {
      render(
        <QuestionHistory
          items={[
            entry({
              question: 'Deze vraag is verwijderd.',
              finalText: 'Deze vraag is verwijderd.',
              clarification: { text: 'Welke gemeente bedoel je?', reply: 'Amsterdam' },
              isDeleted: true,
            }),
          ]}
        />,
      );
      expect(screen.queryByText('Welke gemeente bedoel je?')).toBeNull();
      expect(screen.queryByText('Amsterdam')).toBeNull();
    });

    it('a non-deleted row renders normally alongside a deleted one', () => {
      render(
        <QuestionHistory
          items={[
            entry({ id: 1, question: 'Deze vraag is verwijderd.', finalText: 'Deze vraag is verwijderd.', isDeleted: true }),
            entry({ id: 2, question: 'Hoeveel inwoners heeft Nederland?', isDeleted: false }),
          ]}
        />,
      );
      expect(screen.getByText('Verwijderde vraag')).toBeInTheDocument();
      expect(screen.getByText('Hoeveel inwoners heeft Nederland?')).toBeInTheDocument();
    });
  });

  // WP16 sub-part 2 (design §5-dashboard, ADR 026): the on-demand CBS table
  // onboarding queue folded into the same history list -- pending/running
  // renders amber "wordt voorbereid" (mirrors the #84 amber clarification
  // style), delivered rides the ordinary answer branch above (nothing new to
  // test here — it's just entry() with source: 'audit'), failed/unanswerable
  // renders an honest refunded state.
  describe('onboarding queue entries (WP16 sub-part 2)', () => {
    function onboardingEntry(overrides: Partial<QuestionHistoryEntry> = {}): QuestionHistoryEntry {
      return entry({
        source: 'onboarding',
        kind: 'onboarding_pending',
        question: 'hoeveel zonnestroom werd er opgewekt in 2024',
        finalText: '',
        creditsCharged: 100,
        onboarding: { status: 'pending', topicTerm: 'zonnestroom', failureSummary: null },
        ...overrides,
      });
    }

    it('renders a pending request as "Wordt voorbereid" naming the topic, cost 100', () => {
      render(<QuestionHistory items={[onboardingEntry()]} />);
      expect(screen.getByText('hoeveel zonnestroom werd er opgewekt in 2024')).toBeInTheDocument();
      expect(screen.getByText('Wordt voorbereid')).toBeInTheDocument();
      // The topic name appears both in the summary body copy and (as part of
      // the question) in the collapsed body -- assert presence, not
      // uniqueness (same convention as the rest of this file).
      expect(screen.getAllByText(/zonnestroom/).length).toBeGreaterThanOrEqual(1);
      // Sign convention matches every other entry's creditsCharged
      // (src/billing/history.ts): a positive "amount actually charged", not
      // a signed ledger delta -- so this must read "100 credits", not "-100".
      expect(screen.getByText(/^100 credits/)).toBeInTheDocument();
    });

    it('renders a running request the same as pending -- both are "in flight" to the user', () => {
      render(
        <QuestionHistory
          items={[onboardingEntry({ onboarding: { status: 'running', topicTerm: 'zonnestroom', failureSummary: null } })]}
        />,
      );
      expect(screen.getByText('Wordt voorbereid')).toBeInTheDocument();
    });

    it('renders a failed request as an honest refunded state, net 0, with the plain-language reason', () => {
      render(
        <QuestionHistory
          items={[
            onboardingEntry({
              creditsCharged: 0,
              onboarding: {
                status: 'failed',
                topicTerm: 'zonnestroom',
                failureSummary: 'Het inladen van tabel 82610NED bij het CBS is mislukt (stap: fetch).',
              },
            }),
          ]}
        />,
      );
      expect(screen.getByText('Kon niet worden opgehaald')).toBeInTheDocument();
      expect(screen.getByText(/Het inladen van tabel 82610NED bij het CBS is mislukt/)).toBeInTheDocument();
      expect(screen.getByText(/De credits zijn teruggestort/)).toBeInTheDocument();
      expect(screen.getByText(/0 credits/)).toBeInTheDocument();
    });

    it('renders an unanswerable request the same as failed -- both are an honest non-delivery', () => {
      render(
        <QuestionHistory
          items={[
            onboardingEntry({
              creditsCharged: 0,
              onboarding: {
                status: 'unanswerable',
                topicTerm: 'zonnestroom',
                failureSummary: 'De vraag kon niet betrouwbaar worden beantwoord met de opgehaalde cijfers.',
              },
            }),
          ]}
        />,
      );
      expect(screen.getByText('Kon niet worden opgehaald')).toBeInTheDocument();
      expect(screen.getByText(/niet betrouwbaar worden beantwoord/)).toBeInTheDocument();
    });

    it('does not apply the amber pending styling to a failed/refunded entry', () => {
      const { container } = render(
        <QuestionHistory
          items={[
            onboardingEntry({
              creditsCharged: 0,
              onboarding: { status: 'failed', topicTerm: 'zonnestroom', failureSummary: 'mislukt' },
            }),
          ]}
        />,
      );
      expect(container.querySelector('.bg-amber-50')).toBeNull();
    });

    it('applies the amber pending styling to a pending entry', () => {
      const { container } = render(<QuestionHistory items={[onboardingEntry()]} />);
      expect(container.querySelector('.bg-amber-50')).not.toBeNull();
    });

    it('a delivered onboarding answer renders through the ORDINARY answer branch, not the onboarding branch', () => {
      // A delivered request never reaches QuestionHistory as an
      // onboarding-sourced entry (history.ts skips it) -- it arrives exactly
      // like any other answered question. Regression guard: it must never
      // show the amber box or the onboarding labels.
      render(
        <QuestionHistory
          items={[
            entry({
              source: 'audit',
              kind: 'answer',
              question: 'hoeveel zonnestroom werd er opgewekt in 2024',
              finalText: 'In 2024 werd 8.204 GWh zonnestroom opgewekt.',
              creditsCharged: 100,
              onboarding: null,
            }),
          ]}
        />,
      );
      // Short text legitimately appears twice (collapsed snippet + full text,
      // same as the non-onboarding case tested above) -- assert presence.
      expect(screen.getAllByText('In 2024 werd 8.204 GWh zonnestroom opgewekt.').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Wordt voorbereid')).toBeNull();
      expect(screen.queryByText('Kon niet worden opgehaald')).toBeNull();
    });

    it('keys onboarding and audit entries independently even if their numeric ids collide', () => {
      // pending_table_requests.id and audit_answers.id are independent bigint
      // sequences -- id=1 on both is a real possible collision, not a
      // contrived one. Both entries must render (a naive `key={item.id}`
      // would not crash React here since content differs, but this pins the
      // fix at the presence level regardless).
      render(
        <QuestionHistory
          items={[
            entry({ id: 1, source: 'audit', question: 'gewone vraag' }),
            onboardingEntry({ id: 1, question: 'onboarding vraag' }),
          ]}
        />,
      );
      expect(screen.getByText('gewone vraag')).toBeInTheDocument();
      expect(screen.getByText('onboarding vraag')).toBeInTheDocument();
    });
  });
});
