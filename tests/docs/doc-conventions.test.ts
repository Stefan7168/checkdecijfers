// Documentation conventions that were being enforced by remembering to grep,
// and therefore were not being enforced.
//
// WHY THIS FILE EXISTS (session 60, 2026-07-26). [#132](docs/open-questions.md)
// interim rule (i) says sessions must reference pull requests in docs as PLAIN
// TEXT, never as live github.com links. The reason is not style: route (b) of
// the #132 privacy decision DELETES and recreates the repository, at which
// point every live PR link in the docs 404s — so the docs were deliberately
// neutralized (89 links in session 37, 29 more in session 55) and the rule
// recorded, with a note that the wrap-up sweep would catch future drift.
//
// It did not. Sessions 58 and 59 added 38 more live links and both wrap-ups
// reported the stale-doc sweep as done. Session 60 re-neutralized them and
// wrote this instead of a third note asking the next session to remember.
//
// This is the same "a convention ships with its pin" rule the 2026-07-25
// architecture memo proposed and the session-58 conformance bundle applied to
// four other conventions. The project pins every rule about a NUMBER with
// machinery and every rule about the SYSTEM with prose; this is one of the
// prose ones, converted.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function markdownFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      // lstat, not stat: this repo deliberately ships committed symlinks
      // (AGENTS.md → CLAUDE.md, web/backend → ../src). None is under docs/
      // today, but a symlinked directory added later would make a stat-based
      // walk recurse without bound and fail CI confusingly instead of failing
      // this test cleanly. Skip links; never follow them.
      const stats = lstatSync(full);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** The neutralized form is `PR #72`; the banned form is ANY reference to this
 * repo's pull-request URL. Deliberately NOT anchored on markdown `](…)` syntax:
 * the reason for the rule is that a repo recreate 404s the URL, and a bare
 * pasted URL, a reference-style link target and an HTML href all die exactly
 * the same way. The trailing part is open (`/files`, `#issuecomment-…`) for the
 * same reason. Optional `www.` for completeness. */
const LIVE_PR_LINK =
  /(?:https?:)?\/\/(?:www\.)?github\.com\/[^/\s)]+\/checkdecijfers\/pull\/\d+/gi;

/** The scar left by a careless neutralization: `PR [#68](…/pull/68)` rewritten
 * to `PR #68` yields `PR PR #68`. Session 60 shipped 10 of these in the very
 * commit that added this file, and found 17 more inherited from the session-37
 * and session-55 rounds — three rounds, same mistake. A URL check cannot see
 * prose damage, so this pins the one form the substitution actually produces. */
const DOUBLED_PR_WORD = /\bPR PR #/g;

/** Every markdown file in the repo that is NOT under docs/ and is not vendored.
 * Listed explicitly rather than globbed: a new top-level doc should be a
 * deliberate addition here, so nobody can add one and silently escape the rule.
 * Kept in sync by the test directly below, which fails if the repo grows one
 * this list does not name. */
const OUTSIDE_DOCS_MARKDOWN = [
  'README.md',
  'web/README.md',
  'CLAUDE.md',
  'web/CLAUDE.md',
  'AGENTS.md',
  'web/AGENTS.md',
  'KICKOFF_PROMPT.md',
  'checkdecijfers.nl.md',
  '.claude/commands/wrap-session.md',
];

/** Strip fenced blocks and inline code spans.
 *
 * Needed because the lessons-learned entry that DOCUMENTS the doubled-word
 * defect has to quote it, and tripped this check the moment it was written.
 * That is the right distinction, not a loophole: a careless search-and-replace
 * produces the doubled word in PROSE, while a session explaining the trap puts
 * it in backticks on purpose. Checking prose only is what the rule means. */
function withoutCode(markdown: string): string {
  return markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

describe('#132 interim rule (i): PR references in docs are plain text, never live links', () => {
  it('no markdown file under docs/ links to a pull request', () => {
    const offenders: string[] = [];
    for (const file of markdownFilesUnder(join(REPO_ROOT, 'docs'))) {
      const content = readFileSync(file, 'utf8');
      const hits = content.match(LIVE_PR_LINK);
      if (hits) offenders.push(`${file.slice(REPO_ROOT.length)} (${hits.length})`);
    }
    // The message is the point: whoever trips this is mid-wrap-up and needs to
    // know why a link is a bug, not just that it is one.
    expect(
      offenders,
      'Live PR links found in docs/. #132 route (b) deletes and recreates this repository, ' +
        'which turns every one of these into a 404. Write `PR #72`, not ' +
        '`[#72](https://github.com/…/pull/72)`. See open-questions #132, interim rule (i).',
    ).toEqual([]);
  });

  it('the same rule holds for every markdown file OUTSIDE docs/', () => {
    // Scoping this to docs/ + the two READMEs was the original blind spot: the
    // rule exists because the URL 404s after a repo recreate, and that is true
    // of CLAUDE.md — doc #1 in the reading order — exactly as it is of
    // docs/. Derive the set from the reason for the rule, not from where the
    // offenders happened to be found last time.
    //
    // AGENTS.md and web/AGENTS.md are SYMLINKS to their directory's CLAUDE.md
    // (a committed convention, see CLAUDE.md). realpath-dedupe keeps one file
    // from being reported twice under two names.
    const seen = new Set<string>();
    const offenders: string[] = [];
    for (const relative of OUTSIDE_DOCS_MARKDOWN) {
      const absolute = join(REPO_ROOT, relative);
      if (!existsSync(absolute)) continue;
      const real = realpathSync(absolute);
      if (seen.has(real)) continue;
      seen.add(real);
      const hits = readFileSync(absolute, 'utf8').match(LIVE_PR_LINK);
      if (hits) offenders.push(`${relative} (${hits.length})`);
    }
    expect(
      offenders,
      'Live PR links found outside docs/. Same reason as above: #132 route (b) recreates this ' +
        'repository and every one of these 404s. Write `PR #72`, not a link.',
    ).toEqual([]);
  });

  it('the outside-docs list names every markdown file the repo actually has', () => {
    // The blind spot this closes is structural, not textual: an explicit list
    // silently stops covering the repo the moment someone adds a top-level
    // doc. Walk the real tree and demand the list already knows about it, so a
    // new CONTRIBUTING.md cannot quietly become the one file nobody checks.
    const IGNORED = new Set(['node_modules', '.git', 'docs', 'dist', '.next', 'coverage']);
    const found: string[] = [];

    const walk = (dir: string, depth: number): void => {
      if (depth > 2) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (IGNORED.has(entry.name)) continue;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute, depth + 1);
        // REPO_ROOT already carries a trailing slash (it comes from a URL), so
        // slice at its raw length — a +1 here eats the first character.
        else if (entry.name.endsWith('.md')) found.push(absolute.slice(REPO_ROOT.length));
      }
    };
    walk(REPO_ROOT, 0);

    const unlisted = found.filter((relative) => !OUTSIDE_DOCS_MARKDOWN.includes(relative)).sort();
    expect(
      unlisted,
      'A markdown file outside docs/ is not named in OUTSIDE_DOCS_MARKDOWN, so the live-PR-link ' +
        'rule does not cover it. Add it to that list (that is the whole fix).',
    ).toEqual([]);
  });

  it('no doc carries the "PR PR #" scar of a careless neutralization', () => {
    const offenders: string[] = [];
    for (const file of markdownFilesUnder(join(REPO_ROOT, 'docs'))) {
      const hits = withoutCode(readFileSync(file, 'utf8')).match(DOUBLED_PR_WORD);
      if (hits) offenders.push(`${file.slice(REPO_ROOT.length)} (${hits.length})`);
    }
    expect(
      offenders,
      'Found a doubled "PR" in prose — a neutralization pass rewrote a linked PR reference to ' +
        'plain text without dropping the word already in front of it. Fix the prose, not just the ' +
        'link. (Quoting the bad form inside backticks is fine and is not what this catches.)',
    ).toEqual([]);
  });

  it('the check can actually see a violation (it is a pin, not a tautology)', () => {
    // Guards the class of failure where a path or pattern silently stops
    // matching and the suite goes green because it inspected nothing.
    // Every form that dies the same death when the repo is recreated — the
    // markdown link the rule was written for, plus the four the first version
    // of this regex was blind to (review finding, same session).
    const banned = [
      'zie [#72](https://github.com/Stefan7168/checkdecijfers/pull/72) voor de rest',
      'see [the review](https://github.com/Stefan7168/checkdecijfers/pull/71/files)',
      'context: https://github.com/Stefan7168/checkdecijfers/pull/64#issuecomment-99',
      '[pr]: https://github.com/Stefan7168/checkdecijfers/pull/60',
      '<a href="https://github.com/Stefan7168/checkdecijfers/pull/59">x</a>',
    ];
    for (const sample of banned) {
      expect(sample.match(LIVE_PR_LINK), sample).toHaveLength(1);
    }
    expect('zie PR #72 voor de rest'.match(LIVE_PR_LINK)).toBeNull();
    // An ISSUE link is not a PR link and must not be swept up by the widening.
    expect(
      'zie https://github.com/Stefan7168/checkdecijfers/issues/12'.match(LIVE_PR_LINK),
    ).toBeNull();
    expect('PR PR #72'.match(DOUBLED_PR_WORD)).toHaveLength(1);
    expect('PR #72'.match(DOUBLED_PR_WORD)).toBeNull();
    // Prose is checked; a deliberate quotation of the bad form is not. Both
    // halves matter — drop the first and the rule stops being enforced, drop
    // the second and no doc can ever describe the trap.
    expect(withoutCode('zie PR PR #72 hier').match(DOUBLED_PR_WORD)).toHaveLength(1);
    expect(withoutCode('de fout is `PR PR #72`').match(DOUBLED_PR_WORD)).toBeNull();
    expect(withoutCode('```\nPR PR #72\n```').match(DOUBLED_PR_WORD)).toBeNull();
    // And it must be looking at a non-empty file set, or the first two tests
    // would pass on an empty directory.
    expect(markdownFilesUnder(join(REPO_ROOT, 'docs')).length).toBeGreaterThan(20);
  });
});
