# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Don't code from memory: match this repo's existing idioms, consult the official Next.js docs for the installed major version when unsure, and verify changes against a real `next build` (the repo's verification block runs it). Heed deprecation notices.

(An earlier version of this file pointed to a bundled guide in `node_modules/next/dist/docs/` — that path does not exist in the installed Next 16.x; see open-questions #136. `AGENTS.md` here is a symlink to this file — same text, two names; don't turn it back into a separate copy.)

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
