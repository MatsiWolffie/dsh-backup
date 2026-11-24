# Contributing

Thanks for helping. This is a small, dependency-free DSH bundle; keep it that way.

## Setup

1. Clone the repository.
2. In DSH: **Plugins → Add plugin → select this directory** (or point your profile at it).
3. Make your change and run the checks:

```bash
node --check index.js
node --check client.js
node --check lib/engine.js
node test/engine.test.mjs
node test/tool.test.mjs
```

## Rules

- **No runtime dependencies.** Only Node built-ins (`node:fs`, `node:path`, ...). The
  client module loads React from the host module table via `require('react')`; do not
  bundle React or import Harness client packages.
- Keep the package name in sync in all four places:
  `package.json` `name`, `client.js` module `id`, `client.js` `plugins.bundle.config` key,
  and `cordis.patch.yml` `name`.
- UI copy goes through the `locale` service (`en` + `zh` are both required); use
  `--dsw-alias-*` theme tokens for color.
- Do not weaken the backup defaults: sign-in records stay opt-in, the generated
  `dsh-backups/.gitignore` stays, and the HTTP routes stay same-origin only.
- Tests must not touch a real `DSH_HOME`; use a temporary directory (see `test/`).
- Update `CHANGELOG.md` for user-visible changes.
- Release notes live in `docs/RELEASE_NOTES_V<version>.md` (copy `docs/RELEASE_NOTES_TEMPLATE.md`);
  the first lines must state the applicable and minimum DSH versions.

## Pull requests

Describe the user-visible effect, the verification you ran, and any platform you could not
test. Screenshots are welcome but never include real session data or credentials.
