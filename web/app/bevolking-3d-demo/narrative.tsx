'use client';
// ADR 049 v2 (D4′, session 104): a guided narrative card below the map —
// five static steps with dot pagination + Vorige/Volgende (Previous/Next).
// Expository text only: it never touches the 3D scene (no camera control,
// no scene-state wiring) — that would be a materially bigger feature
// (camera choreography) this bounded polish pass does not include. Copy is
// drawn from this demo's OWN scale/domain constants (GROWTH_DOMAIN,
// YEAR_START/YEAR_END), filled in through t()'s {vars} mechanism so the
// numbers shown here can never drift from scales.ts/fake-data.ts. Rendered
// directly by page.tsx (not lazy-loaded with the 3D chunk): it has nothing
// to do with three.js and should be visible even while — or if — the WebGL
// chunk is still loading or fails.
import { useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { t, type Lang, type MessageKey } from '../../lib/i18n/messages.ts';
import { YEAR_END, YEAR_START } from './fake-data.ts';
import { GROWTH_DOMAIN } from './scales.ts';

const STEP_KEYS = ['lab3d.narrativeStep1', 'lab3d.narrativeStep2', 'lab3d.narrativeStep3', 'lab3d.narrativeStep4', 'lab3d.narrativeStep5'] as const satisfies readonly MessageKey[];

export function Narrative({ lang }: { lang: Lang }): ReactNode {
  const [step, setStep] = useState(0);
  const total = STEP_KEYS.length;
  const vars = { start: YEAR_START, end: YEAR_END, domain: Math.round(GROWTH_DOMAIN * 100) };

  return (
    <section aria-label={t(lang, 'lab3d.narrativeTitle')} data-fictional="true" className="mt-6 rounded-lg border border-border bg-card p-4 text-card-foreground">
      <h2 className="text-sm font-semibold">{t(lang, 'lab3d.narrativeTitle')}</h2>
      <p className="mt-2 min-h-12 text-sm text-muted-foreground">{t(lang, STEP_KEYS[step]!, vars)}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t(lang, 'lab3d.narrativeTitle')} className="flex gap-1.5">
          {STEP_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={i === step}
              aria-label={t(lang, 'lab3d.narrativeDotLabel', { n: i + 1, total })}
              onClick={() => setStep(i)}
              className={`h-2 w-2 rounded-full transition-colors ${i === step ? 'bg-foreground' : 'bg-muted-foreground/40'}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            {t(lang, 'lab3d.narrativePrev')}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={step === total - 1} onClick={() => setStep((s) => Math.min(total - 1, s + 1))}>
            {t(lang, 'lab3d.narrativeNext')}
          </Button>
        </div>
      </div>
    </section>
  );
}
