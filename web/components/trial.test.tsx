// The trial section's dormancy + degrade contract (ADR 036): flag off ⇒ the
// landing carries NO trial markup at all (byte-identical, deploy-order-safe);
// configured ⇒ open renders the chat, closed/used_up render the owner's
// "log in om verder te gaan" degrade — never a broken section.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getTrialGateState } = vi.hoisted(() => ({ getTrialGateState: vi.fn() }));
vi.mock('../lib/trial.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/trial.ts')>()),
  getTrialGateState,
}));
vi.mock('./trial-chat.tsx', () => ({
  TrialChat: ({ initialQuestionsLeft }: { initialQuestionsLeft: number }) => (
    <div data-testid="trial-chat" data-left={initialQuestionsLeft} />
  ),
  LoginNudge: ({ text }: { text: string }) => <div data-testid="login-nudge">{text}</div>,
}));

import { TrialGate, TrialSectie } from './trial.tsx';
import { TRIAL_COPY } from '../lib/trial-copy.ts';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function configure() {
  vi.stubEnv('TRIAL_ENABLED', '1');
  vi.stubEnv('ANTHROPIC_TRIAL_API_KEY', 'sk-trial-test');
  vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
}

describe('TrialSectie dormancy', () => {
  it('renders NOTHING while the trial envs are unset (byte-identical landing)', () => {
    expect(TrialSectie()).toBeNull();
  });

  it('mounts the gate only when fully configured', () => {
    configure();
    expect(TrialSectie()).not.toBeNull();
  });
});

describe('TrialGate', () => {
  it('renders the chat with the visitor budget when open', async () => {
    getTrialGateState.mockResolvedValue({ kind: 'open', questionsLeft: 2 });
    render(await TrialGate());
    expect(screen.getByText('Probeer het direct')).toBeInTheDocument();
    expect(screen.getByTestId('trial-chat').dataset.left).toBe('2');
  });

  it('degrades to the login prompt on an empty pot — section present, input absent', async () => {
    getTrialGateState.mockResolvedValue({ kind: 'closed' });
    render(await TrialGate());
    expect(screen.getByTestId('login-nudge')).toHaveTextContent('proefpotje is op dit moment leeg');
    expect(screen.queryByTestId('trial-chat')).toBeNull();
  });

  // The degrade is identical; the CLAIM is not. During a #173 pooler
  // exhaustion the gate cannot read the pot, and telling every visitor it is
  // empty is a statement we have not verified.
  it('does NOT claim the pot is empty when it could not read the pot', async () => {
    getTrialGateState.mockResolvedValue({ kind: 'unavailable' });
    render(await TrialGate());
    const nudge = screen.getByTestId('login-nudge');
    expect(nudge).not.toHaveTextContent('leeg');
    expect(nudge).toHaveTextContent('niet beschikbaar');
    expect(screen.queryByTestId('trial-chat')).toBeNull();
  });

  it('tells an exhausted visitor their own budget is spent', async () => {
    getTrialGateState.mockResolvedValue({ kind: 'used_up' });
    render(await TrialGate());
    expect(screen.getByTestId('login-nudge')).toHaveTextContent('proefvragen gebruikt');
  });

  // #184: the visitor behind an exhausted NAT usually asked nothing themselves,
  // so the copy must blame the NETWORK and never them — and must not leak that
  // we bucket by a hash of their address.
  it('blames the NETWORK, not the visitor, when the per-IP backstop is spent', async () => {
    getTrialGateState.mockResolvedValue({ kind: 'ip_limit' });
    render(await TrialGate());
    const nudge = screen.getByTestId('login-nudge');
    expect(nudge).toHaveTextContent('Vanaf dit netwerk');
    expect(nudge).not.toHaveTextContent(/\bje hebt\b/i);
    expect(nudge.textContent ?? '').not.toMatch(/ip|hash|adres/i);
    expect(screen.queryByTestId('trial-chat')).toBeNull();
  });

  // One state, one sentence, whichever surface discovers it (#184). Before the
  // shared copy these were two literals that could drift apart.
  it('shows the SAME sentence the action would show a round-trip later', () => {
    expect(TRIAL_COPY.ip_limit).toContain('Vanaf dit netwerk');
    expect(new Set(Object.values(TRIAL_COPY)).size).toBe(Object.keys(TRIAL_COPY).length);
  });

  it('renders nothing at all when the gate reads dormant', async () => {
    getTrialGateState.mockResolvedValue({ kind: 'dormant' });
    expect(await TrialGate()).toBeNull();
  });
});
