// Pins scripts/check-migration-numbers.ts (docs/open-questions.md #263): the
// cross-branch migration-number collision guard added after two branches
// each minted a `031_*.sql` migration under different filenames and the
// clash surfaced only post-merge, as every applyMigrations-dependent suite
// failing on Postgres's own "duplicate key value violates unique constraint
// schema_migrations_pkey" (session 107 — ADR 048 as-built addendum,
// lessons-learned.md). Hermetic: filesystem only, no DB, no network.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  describeCollisions,
  findMigrationNumberCollisions,
  MIGRATION_FILENAME,
} from '../../scripts/check-migration-numbers.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

describe('findMigrationNumberCollisions', () => {
  it('flags two files that share a leading number — the exact session-107 shape', () => {
    const collisions = findMigrationNumberCollisions([
      '030_pro_subscriptions.sql',
      '031_source_doi.sql',
      '031_chart_headlines.sql',
      '032_ingestion_batch_request_urls.sql',
    ]);
    expect(collisions).toEqual([
      { number: '031', files: ['031_chart_headlines.sql', '031_source_doi.sql'] },
    ]);
  });

  it('reports every colliding number, not just the first', () => {
    const collisions = findMigrationNumberCollisions([
      '001_a.sql',
      '001_b.sql',
      '002_c.sql',
      '002_d.sql',
      '002_e.sql',
      '003_f.sql',
    ]);
    expect(collisions.map((c) => c.number)).toEqual(['001', '002']);
    expect(collisions.find((c) => c.number === '002')?.files).toEqual([
      '002_c.sql',
      '002_d.sql',
      '002_e.sql',
    ]);
  });

  it('finds nothing when every number is unique', () => {
    expect(
      findMigrationNumberCollisions(['001_a.sql', '002_b.sql', '003_c.sql']),
    ).toEqual([]);
  });

  it('ignores non-migration entries in the directory (README, dotfiles, non-.sql files)', () => {
    expect(
      findMigrationNumberCollisions([
        '001_a.sql',
        'README.md',
        '.gitkeep',
        'notes.txt',
        '002_b.sql',
      ]),
    ).toEqual([]);
  });

  it('does not treat an unpadded number as colliding with its padded twin (distinct filenames today)', () => {
    // Documents current behavior rather than prescribing it: this repo's
    // convention is always 3-digit zero-padded, so "31" never actually
    // appears — the check keys on the exact captured digit string, so
    // "031" and "31" are two different, non-colliding numbers.
    expect(findMigrationNumberCollisions(['031_a.sql', '31_b.sql'])).toEqual([]);
  });

  it('the real migrations/ directory has no leading-number collisions today', () => {
    const filenames = readdirSync(MIGRATIONS_DIR);
    expect(filenames.length).toBeGreaterThan(0);
    expect(findMigrationNumberCollisions(filenames)).toEqual([]);
  });
});

describe('describeCollisions', () => {
  it('names both files and the shared number in the message', () => {
    const message = describeCollisions([
      { number: '031', files: ['031_chart_headlines.sql', '031_source_doi.sql'] },
    ]);
    expect(message).toContain('031');
    expect(message).toContain('031_chart_headlines.sql');
    expect(message).toContain('031_source_doi.sql');
  });
});

describe('MIGRATION_FILENAME', () => {
  it('matches the real naming convention and rejects obvious non-matches', () => {
    expect(MIGRATION_FILENAME.test('001_ingestion_schema.sql')).toBe(true);
    expect(MIGRATION_FILENAME.test('README.md')).toBe(false);
    expect(MIGRATION_FILENAME.test('migration.sql')).toBe(false);
  });
});
