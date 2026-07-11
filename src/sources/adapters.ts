// WP30b (ADR 030 D5, scoped per the pre-build review's B1 amendment): the
// node-only adapter seam. The source registry (./registry.ts) is a PURE LEAF
// consumed by client-bundled web code, so adapter construction lives here —
// a separate module the web bundle never imports.
//
// `SourceAdapter` is the A5-sanctioned neutral alias for the adapter
// contract; the interface (and its nested Cbs* wire types) keeps its
// historical name in src/cbs-adapter/types.ts — a rename is deliberately NOT
// worth 31+ files of diff noise (ADR 030 A5).
//
// Fail-direction (deliberate, the third of three): DISPLAY paths fall back to
// the cbs registry entry (A1, registry.ts), catalog RANKING treats an unknown
// source as not-current (src/catalog/current-status.ts), but a FETCH seam
// throws loud — a typo'd source key must never silently ingest as CBS.
//
// Wired call sites (WP30b): the two owner-run CLIs (src/ingestion/cli.ts,
// src/catalog/cli.ts). The onboarding-cron route deliberately keeps its
// direct `new ODataV4Source()` construction — and its literal-scan wiring pin
// (web/app/onboarding-cron.test.ts) — until WP30c gives routing a real second
// target on that money path.
import { ODataV4Source } from '../cbs-adapter/odata-v4.ts';
import type { CbsSource } from '../cbs-adapter/types.ts';
import { CBS_SOURCE_KEY } from './registry.ts';

/** The adapter contract, under its source-neutral name (ADR 030 A5). */
export type SourceAdapter = CbsSource;

const ADAPTER_FACTORIES: Readonly<Record<string, () => SourceAdapter>> = {
  [CBS_SOURCE_KEY]: () => new ODataV4Source(),
};

/**
 * The one place a source key becomes a live adapter (ADR 030 D5). Adding a
 * source means adding a factory line here — after its conformance harness
 * passes (docs/how-to-add-a-source.md).
 */
export function adapterFor(sourceKey: string): SourceAdapter {
  const factory = ADAPTER_FACTORIES[sourceKey];
  if (!factory) {
    throw new Error(
      `No adapter is registered for source '${sourceKey}'. Registered sources: ` +
        `${Object.keys(ADAPTER_FACTORIES).join(', ')}. A new source needs a registry entry, ` +
        `an adapter and a green conformance harness first — see docs/how-to-add-a-source.md.`,
    );
  }
  return factory();
}
