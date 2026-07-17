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
import { ChartView } from './chart.tsx';

export async function OntdekCharts() {
  const charts = await getOntdekCharts();
  if (charts.length === 0) return null;
  return (
    <section className="border-b border-line py-12">
      <h2 className="text-2xl text-ink">Ontdek Nederland in grafieken</h2>
      <p className="mt-3 max-w-xl text-ink-soft">
        Rechtstreeks uit onze database met officiële CBS-cijfers:
        consumentenvertrouwen, economische groei, inflatie en de gemiddelde
        verkoopprijs van woningen. Elk punt is herleidbaar tot een CBS-tabel —
        bron en datum staan erbij.
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {charts.map((chart) => (
          <ChartView key={chart.slug} spec={chart.spec} />
        ))}
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
