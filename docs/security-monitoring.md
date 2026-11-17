# GitHub security monitoring

This baseline adds repository checks without deploying or changing application implementation.

## Coverage
- Pull requests, main pushes, Mondays at 10:17 KST, and manual dispatch: high/critical dependency audit and CodeQL (JS/TS, security-extended).
- The default `main` branch contains the application: a root `package.json` with `package-lock.json`, `tsconfig.json`, and `src/`. The dependency audit and CodeQL therefore scan real inputs on `main`.
- Audit uses `npm audit --audit-level=high` against `package-lock.json`, including dev dependencies. The job summary records the lockfile hash, the lockfile entry count, and the package count `npm audit` reported, so a run that audited nothing is distinguishable from one that audited the lockfile.
- The "NOT SCANNED" messages are kept for refs that lack a root manifest or JavaScript/TypeScript source, such as an older branch that predates the application. They report the gap instead of presenting a false pass.
- Dependabot opens weekly version-update PRs for two ecosystems, both with an open-PR limit of 3: GitHub Actions (Mondays 10:45 KST) and root npm dependencies (Mondays 11:00 KST). The configuration does not auto-merge anything; every update PR needs a person to review and merge it.

## Required follow-up
- The existing stacked Draft PRs target **other feature branches**, not main; a branch that does not contain this workflow does not run it. Merge this baseline into the specific branch to be tested or perform an equivalent manual audit. An absent CI result is never a pass.
- After the first successful scan on `main`, consider requiring status checks in branch protection. This change does not touch branch protection.
- Review the repository **Settings → Advanced Security** for Dependabot alerts, security updates, secret scanning and push protection. The workflow does not change repository settings.
- CodeQL results are uploaded to code scanning with `security-events: write`. If an upload is refused, the cause is a repository setting or permission, and it needs an owner decision rather than a workflow change.
- This does not scan the runtime OS, Node.js host binary, Nginx, OpenSSL, deployed environments or live TLS configuration.
