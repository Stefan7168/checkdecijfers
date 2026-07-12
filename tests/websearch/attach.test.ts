// WP129+130 (ADR 032): attachWebAugmentation — the owed/skip rules, fail-soft,
// debit-before-spend, and the A1 both-keys-always-serialized guarantee.
// Hermetic: a hand-authored FakeWebSearchClient + a reserve() closure spy, no
// billing/db, no spend. attach is a pure function over the envelope, so minimal
// response shapes exercise every branch (it reads only kind/question/reason).
import { describe, expect, it } from 'vitest';
import { attachWebAugmentation } from '../../src/websearch/attach.ts';
import type { WebBilling } from '../../src/websearch/attach.ts';
import type { WebSearchClient } from '../../src/websearch/client.ts';
import type { SourceSelection, WebSection } from '../../src/websearch/types.ts';
import type { ComposedResponse, RefusalReason } from '../../src/answer/respond/types.ts';
import { RESPONSE_SCHEMA_VERSION } from '../../src/answer/respond/types.ts';

const OK_SECTION: WebSection = {
  status: 'ok',
  findings: [{ text: 'geheim webresultaat', citations: [{ url: 'https://x.nl', title: 't' }] }],
  model: 'claude-sonnet-5',
  searches: 1,
  usage: { inputTokens: 10, outputTokens: 5 },
  promptVersion: 1,
};

class FakeWebSearchClient implements WebSearchClient {
  readonly calls: string[] = [];
  private readonly result: WebSection;
  private readonly log: string[] | undefined;
  constructor(result: WebSection, log?: string[]) {
    this.result = result;
    this.log = log;
  }
  async search(question: string): Promise<WebSection> {
    this.calls.push(question);
    this.log?.push('search');
    return this.result;
  }
}

class ThrowingWebSearchClient implements WebSearchClient {
  async search(): Promise<WebSection> {
    throw new Error('boom');
  }
}

function fakeBilling(reserveResult: boolean, log?: string[]): WebBilling & { calls: number } {
  const billing = {
    calls: 0,
    async reserve(): Promise<boolean> {
      billing.calls += 1;
      log?.push('reserve');
      return reserveResult;
    },
  };
  return billing;
}

function answer(question = 'hoeveel inwoners?'): ComposedResponse {
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question,
    text: 'CBS body text',
    kind: 'answer',
  } as unknown as ComposedResponse;
}

function refusal(reason: RefusalReason, question = 'q'): ComposedResponse {
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question,
    text: `refusal text (${reason})`,
    kind: 'refusal',
    reason,
    offer: null,
    guidance: null,
    freshness: null,
    parse: null,
    queryRefusal: null,
    internalNote: null,
    onboarding: null,
  } as unknown as ComposedResponse;
}

function clarification(question = 'q'): ComposedResponse {
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    question,
    text: 'welke regio?',
    kind: 'clarification',
  } as unknown as ComposedResponse;
}

const WEB_ON: SourceSelection = { sources: ['cbs'], web: true };
const WEB_OFF: SourceSelection = { sources: ['cbs'], web: false };

describe('attachWebAugmentation — both keys always serialized (A1)', () => {
  it('benchmark shape (no options at all) ⇒ both keys null, no web machinery constructed', async () => {
    const result = await attachWebAugmentation(answer(), {});
    expect('sourceSelection' in result).toBe(true);
    expect('webSection' in result).toBe(true);
    expect(result.sourceSelection).toBeNull();
    expect(result.webSection).toBeNull();
  });

  it('web off ⇒ selection recorded, webSection null, client never touched', async () => {
    const log: string[] = [];
    const client = new FakeWebSearchClient(OK_SECTION, log);
    const result = await attachWebAugmentation(answer(), {
      selection: WEB_OFF,
      client,
      billing: fakeBilling(true, log),
    });
    expect(result.sourceSelection).toEqual(WEB_OFF);
    expect(result.webSection).toBeNull();
    expect(client.calls).toEqual([]);
    expect(log).toEqual([]);
  });
});

describe('attachWebAugmentation — owed cases', () => {
  it('answer + web on + reserve ok ⇒ ok section attached, reserve BEFORE search', async () => {
    const log: string[] = [];
    const client = new FakeWebSearchClient(OK_SECTION, log);
    const result = await attachWebAugmentation(answer(), {
      selection: WEB_ON,
      client,
      billing: fakeBilling(true, log),
    });
    expect(result.webSection).toEqual(OK_SECTION);
    expect(result.sourceSelection).toEqual(WEB_ON);
    expect(client.calls).toEqual(['hoeveel inwoners?']);
    // Debit-before-spend: the reserve fires before the search.
    expect(log).toEqual(['reserve', 'search']);
  });

  it('the web section text NEVER leaks into response.text (the separation IS the honesty model)', async () => {
    const result = await attachWebAugmentation(answer(), {
      selection: WEB_ON,
      client: new FakeWebSearchClient(OK_SECTION),
      billing: fakeBilling(true),
    });
    expect(result.text).toBe('CBS body text');
    expect(result.text).not.toContain('geheim webresultaat');
  });

  it('⟨W8⟩ coexistence direction: a non-skip-list refusal (forecast) + web on ⇒ search IS called, ok section attaches, refusal text byte-untouched', async () => {
    const client = new FakeWebSearchClient(OK_SECTION);
    const original = refusal('forecast');
    const result = await attachWebAugmentation(original, {
      selection: WEB_ON,
      client,
      billing: fakeBilling(true),
    });
    expect(client.calls).toHaveLength(1);
    expect(result.webSection).toEqual(OK_SECTION);
    expect(result.text).toBe(original.text); // refusal wording untouched
  });

  it('web_only refusal + web on ⇒ search called, ok section attaches (web_only is NOT skipped)', async () => {
    const client = new FakeWebSearchClient(OK_SECTION);
    const result = await attachWebAugmentation(refusal('web_only'), {
      selection: WEB_ON,
      client,
      billing: fakeBilling(true),
    });
    expect(client.calls).toHaveLength(1);
    expect(result.webSection).toEqual(OK_SECTION);
  });

  it('⟨W6⟩ owed but no client/billing wired ⇒ not_configured section (never a silent null)', async () => {
    const result = await attachWebAugmentation(answer(), { selection: WEB_ON });
    expect(result.webSection).toEqual({ status: 'failed', code: 'not_configured' });
    expect(result.sourceSelection).toEqual(WEB_ON);
  });

  it('reserve returns false ⇒ insufficient_balance section, client NEVER called (debit-before-spend)', async () => {
    const client = new FakeWebSearchClient(OK_SECTION);
    const billing = fakeBilling(false);
    const result = await attachWebAugmentation(answer(), { selection: WEB_ON, client, billing });
    expect(result.webSection).toEqual({ status: 'failed', code: 'insufficient_balance' });
    expect(billing.calls).toBe(1);
    expect(client.calls).toEqual([]);
  });

  it('fail-soft: a throwing client ⇒ failed api_error section, the CBS response still ships', async () => {
    const result = await attachWebAugmentation(answer(), {
      selection: WEB_ON,
      client: new ThrowingWebSearchClient(),
      billing: fakeBilling(true),
    });
    expect(result.webSection).toEqual({ status: 'failed', code: 'api_error' });
    expect(result.kind).toBe('answer');
    expect(result.text).toBe('CBS body text');
  });

  it('a failed section from the client still attaches verbatim (settlement refunds upstream)', async () => {
    const failed: WebSection = { status: 'failed', code: 'no_findings' };
    const result = await attachWebAugmentation(answer(), {
      selection: WEB_ON,
      client: new FakeWebSearchClient(failed),
      billing: fakeBilling(true),
    });
    expect(result.webSection).toEqual(failed);
  });
});

describe('attachWebAugmentation — skip cases (no web attempt owed)', () => {
  it('clarification ⇒ webSection null, client never called', async () => {
    const client = new FakeWebSearchClient(OK_SECTION);
    const result = await attachWebAugmentation(clarification(), {
      selection: WEB_ON,
      client,
      billing: fakeBilling(true),
    });
    expect(result.webSection).toBeNull();
    expect(client.calls).toEqual([]);
  });

  it.each<RefusalReason>(['smalltalk', 'meta', 'compound', 'internal', 'no_sources', 'onboarding_pending', 'onboarding_already_pending'])(
    'skip-list refusal reason %s ⇒ webSection null, client never called',
    async (reason) => {
      const client = new FakeWebSearchClient(OK_SECTION);
      const result = await attachWebAugmentation(refusal(reason), {
        selection: WEB_ON,
        client,
        billing: fakeBilling(true),
      });
      expect(result.webSection).toBeNull();
      expect(client.calls).toEqual([]);
    },
  );
});
