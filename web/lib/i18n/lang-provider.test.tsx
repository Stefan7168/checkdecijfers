// WP218 phase 4 (#219): the provider's default (no provider -> nl), that it
// passes through the given lang, and that useT() resolves against it.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LangProvider, useLang, useT } from './lang-provider.tsx';

function Probe() {
  const lang = useLang();
  const t = useT();
  return (
    <p>
      {lang}:{t('header.credits')}
    </p>
  );
}

describe('LangProvider / useLang / useT', () => {
  it('defaults to nl with no provider above it', () => {
    render(<Probe />);
    expect(screen.getByText('nl:Credits kopen')).toBeInTheDocument();
  });

  it('provides the given lang to useLang() and useT()', () => {
    render(
      <LangProvider lang="en">
        <Probe />
      </LangProvider>,
    );
    expect(screen.getByText('en:Buy credits')).toBeInTheDocument();
  });
});
