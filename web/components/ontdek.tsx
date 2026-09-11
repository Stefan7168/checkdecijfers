// "Ontdek Nederland in grafieken" — the free, LLM-free discovery section on
// the public landing (owner decision session 51, open-questions #53(c);
// ADR 035). Server components: the data work (freshest anchor → runQuery →
// buildChartSpec) happens in src/chart/curated.ts via web/lib/ontdek.ts; the
// pixels are drawn by the SAME client ChartView the paid product uses, so a
// visitor sees exactly the chart surface a customer gets — huisstijl tokens,
// R4 attribution line, R11 provisional note and all.
//
// Fail-safe (#53 posture): no charts available → the section renders as
// nothing at all; the landing above and below is untouched. The Suspense
// boundary keeps the hero streaming ahead of the database read.
import { Suspense } from 'react';
import { getOntdekCharts } from '../lib/ontdek.ts';
import { getLang } from '../lib/i18n/server.ts';
import { t } from '../lib/i18n/messages.ts';
import { ChartView } from './chart.tsx';
import { ChartWithToggle } from './chart-toggle.tsx';

export async function OntdekCharts() {
  const [charts, lang] = await Promise.all([getOntdekCharts(), getLang()]);
  if (charts.length === 0) return null;
  return (
    <section className="border-b border-border py-12">
      <h2 className="text-2xl text-foreground">{t(lang, 'ontdek.heading')}</h2>
      <p className="mt-3 max-w-xl text-muted-foreground">{t(lang, 'ontdek.body')}</p>
      {/* R5 item 1 (experience-improvement-plan, session 96): names the chart
        * features these live charts already carry — placement is unchanged
        * (ADR 035), this only tells visitors the charts are interactive. */}
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t(lang, 'ontdek.tryItCaption')}</p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {charts.map((chart) =>
          // #170(4): a chart with a built toggle gets the client switcher;
          // every other chart renders exactly as before this feature existed.
          chart.toggle ? (
            <ChartWithToggle key={chart.slug} spec={chart.spec} toggle={chart.toggle} />
          ) : (
            <ChartView key={chart.slug} spec={chart.spec} />
          ),
        )}
      </div>
    </section>
  );
}

export function OntdekSectie() {
  return (
    <Suspense fallback={null}>
      <OntdekCharts />
    </Suspense>
  );
}
