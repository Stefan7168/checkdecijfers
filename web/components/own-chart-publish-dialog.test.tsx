// Task 6 (own-data publish, ADR 057): OwnChartPublishButton/dialog. Mirrors
// chart-embed-dialog.test.tsx's mocking shape for the same footer-button
// class of component — the Server Actions (own-chart-publish-actions.ts)
// are mocked at the module boundary; Dialog/Button render for real, since
// the dialog's own open/close/focus behaviour is exactly the CBS embed
// dialog's already-proven Base UI primitive (chart-edit-modal.tsx's own
// header comment).
//
// The trigger button and the in-dialog "Publish" button share the exact
// same accessible name (spec: trigger 'Publish'; not-published state's own
// button is also 'Publish') — every query below that needs the IN-DIALOG
// button scopes through `within(dialog)` to avoid ambiguity with the
// trigger, which stays mounted (behind the overlay) while the dialog is open.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getOwnChartPublication, publishOwnChart, unpublishOwnChart } = vi.hoisted(() => ({
  getOwnChartPublication: vi.fn(),
  publishOwnChart: vi.fn(),
  unpublishOwnChart: vi.fn(),
}));
vi.mock('../app/own-chart-publish-actions.ts', () => ({ getOwnChartPublication, publishOwnChart, unpublishOwnChart }));

import { buildOwnEmbedCode, buildOwnEmbedUrl, OwnChartPublishButton } from './own-chart-publish-dialog.tsx';

beforeEach(() => {
  getOwnChartPublication.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderButton(props: Partial<Parameters<typeof OwnChartPublishButton>[0]> = {}) {
  return render(<OwnChartPublishButton turnId={7} lang="en" getLog={() => []} {...props} />);
}

describe('OwnChartPublishButton / dialog', () => {
  it('opens the dialog on click and shows the "not published" state (no link/code yet)', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(getOwnChartPublication).toHaveBeenCalledWith(7);
    await waitFor(() => expect(within(dialog).getByText(/anyone with the link/i)).toBeInTheDocument());
    expect(within(dialog).queryByText(/<iframe/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^publish$/i })).toBeInTheDocument();
  });

  it('shows a neutral loading line before getOwnChartPublication resolves', async () => {
    getOwnChartPublication.mockReturnValue(new Promise(() => {}));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/checking/i)).toBeInTheDocument();
  });

  it('publish sends getLog() and the trimmed source line, then shows the link and code containing /embed/own/<id>', async () => {
    publishOwnChart.mockResolvedValue({ ok: true, publicId: 'abc123' });
    const getLog = vi.fn(() => [{ kind: 'setTitle', title: 'x' }]);
    renderButton({ getLog });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText(/source line/i)).toBeInTheDocument());

    // B2: the placeholder carries no "Source:" prefix — the page adds it.
    expect(within(dialog).getByLabelText(/source line/i)).toHaveAttribute('placeholder', 'e.g. our own sales records');
    fireEvent.change(within(dialog).getByLabelText(/source line/i), { target: { value: '  our own sales records  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /^publish$/i }));

    await waitFor(() => expect(publishOwnChart).toHaveBeenCalledTimes(1));
    expect(publishOwnChart).toHaveBeenCalledWith(7, [{ kind: 'setTitle', title: 'x' }], 'our own sales records');

    await waitFor(() => expect(within(dialog).getByText(/\/embed\/own\/abc123/)).toBeInTheDocument());
    expect(within(dialog).getByText(/<iframe/)).toBeInTheDocument();
  });

  it('published state shows Update published version and Unpublish', async () => {
    getOwnChartPublication.mockResolvedValue({ publicId: 'xyz789', sourceLine: 'Our data' });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(/\/embed\/own\/xyz789/)).toBeInTheDocument());
    expect(within(dialog).getByRole('button', { name: /update published version/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^unpublish$/i })).toBeInTheDocument();
  });

  it('Unpublish needs the confirm click, then calls unpublishOwnChart and returns to the not-published state', async () => {
    getOwnChartPublication.mockResolvedValue({ publicId: 'xyz789', sourceLine: null });
    unpublishOwnChart.mockResolvedValue({ ok: true });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^unpublish$/i })).toBeInTheDocument());

    fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
    expect(unpublishOwnChart).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/link stops working immediately/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: /yes, unpublish/i }));
    await waitFor(() => expect(unpublishOwnChart).toHaveBeenCalledWith(7));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^publish$/i })).toBeInTheDocument());
    expect(within(dialog).queryByText(/<iframe/)).toBeNull();
  });

  const failureCases: Array<[string, RegExp]> = [
    ['disabled', /not available right now/i],
    ['unavailable', /not available right now/i],
    ['limit', /limit of 50 published charts/i],
    ['changed', /could not be published exactly as shown/i],
    ['invalid', /too long or this chart cannot be published/i],
    ['forbidden', /something went wrong/i],
    ['unauthenticated', /something went wrong/i],
    ['error', /something went wrong/i],
  ];

  it.each(failureCases)('shows the failure line for reason "%s"', async (reason, expected) => {
    publishOwnChart.mockResolvedValue({ ok: false, reason });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^publish$/i })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: /^publish$/i }));
    await waitFor(() => expect(within(dialog).getByText(expected)).toBeInTheDocument());
  });
});

// Final-review fix A5: getLog() returning null means "this log would not
// reproduce the chart exactly as shown" — refused client-side, never sent.
describe('OwnChartPublishButton — a log that cannot reproduce the chart (A5)', () => {
  it('shows the "changed" failure line and never calls publishOwnChart when getLog() returns null', async () => {
    renderButton({ getLog: () => null });
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^publish$/i })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: /^publish$/i }));
    await waitFor(() => expect(within(dialog).getByText(/could not be published exactly as shown/i)).toBeInTheDocument());
    expect(publishOwnChart).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: /^publish$/i })).not.toBeDisabled();
  });
});

// B1: a rejected Server Action must never leave a button disabled, and must
// say something (the generic line) rather than nothing.
describe('OwnChartPublishButton — rejected actions (B1)', () => {
  it('a rejected publish shows the generic line and re-enables Publish', async () => {
    publishOwnChart.mockRejectedValue(new Error('network down'));
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^publish$/i })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: /^publish$/i }));
    await waitFor(() => expect(within(dialog).getByText(/something went wrong/i)).toBeInTheDocument());
    expect(within(dialog).getByRole('button', { name: /^publish$/i })).not.toBeDisabled();
  });

  async function openPublishedAndConfirmUnpublish() {
    getOwnChartPublication.mockResolvedValue({ publicId: 'xyz789', sourceLine: null });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: /^publish$/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /^unpublish$/i })).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /yes, unpublish/i }));
    return dialog;
  }

  it('a rejected unpublish shows the generic line and leaves no button disabled', async () => {
    unpublishOwnChart.mockRejectedValue(new Error('network down'));
    const dialog = await openPublishedAndConfirmUnpublish();
    await waitFor(() => expect(within(dialog).getByText(/something went wrong/i)).toBeInTheDocument());
    // Still published (nothing was removed), and the Unpublish control is usable again.
    expect(within(dialog).getByText(/\/embed\/own\/xyz789/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^unpublish$/i })).not.toBeDisabled();
    for (const button of within(dialog).getAllByRole('button')) expect(button).not.toBeDisabled();
  });

  it('an unpublish that returns ok:false shows the generic line', async () => {
    unpublishOwnChart.mockResolvedValue({ ok: false });
    const dialog = await openPublishedAndConfirmUnpublish();
    await waitFor(() => expect(within(dialog).getByText(/something went wrong/i)).toBeInTheDocument());
    expect(within(dialog).getByText(/\/embed\/own\/xyz789/)).toBeInTheDocument();
  });
});

describe('buildOwnEmbedUrl', () => {
  it('puts lang and theme in the query', () => {
    const url = buildOwnEmbedUrl('abc123', { lang: 'nl', theme: 'dark' });
    expect(url).toContain('/embed/own/abc123?');
    expect(url).toContain('lang=nl');
    expect(url).toContain('theme=dark');
  });
});

describe('buildOwnEmbedCode', () => {
  it('escapes a title containing " and <', () => {
    const code = buildOwnEmbedCode('abc123', { lang: 'en', theme: 'light' }, 'My <chart> "sales"');
    expect(code).toContain('title="My &lt;chart&gt; &quot;sales&quot;"');
    expect(code).not.toContain('title="My <chart> "sales""');
  });

  it('embeds a resize script and the data-checkdecijfers-embed selector keyed to the publicId', () => {
    const code = buildOwnEmbedCode('abc123', { lang: 'en', theme: 'light' }, 'Chart');
    expect(code).toContain('data-checkdecijfers-embed="abc123"');
    expect(code).toContain('checkdecijfers:embed-height');
  });
});
