// WP30b test helper: a complete, coherent non-CBS SourceInfo for exercising
// registry-driven behavior (provisional rule, catalog-current predicate,
// conformance harness) with a source whose vocabularies deliberately differ
// from CBS's — proving code reads the registry, not the old literals.
import type { SourceInfo } from '../../src/sources/registry.ts';

export function fakeSourceInfo(overrides: Partial<SourceInfo> = {}): SourceInfo {
  return {
    key: 'fake',
    displayName: 'FAKE',
    attributionLabel: 'FAKE Bron',
    license: 'CC BY 4.0',
    deepLink: (tableId: string) => `https://fake.example/dataset/${tableId}`,
    provisionalDisplay: { Voorlopig: ' (voorlopig cijfer)' },
    definitiveStatuses: ['Definitief'],
    nullReasonLabels: { Missing: 'door FAKE niet geleverd' },
    currentCatalogStatuses: ['Actueel'],
    ...overrides,
  };
}
