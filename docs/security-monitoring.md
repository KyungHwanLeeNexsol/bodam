# GitHub security monitoring

This baseline adds repository checks without deploying or changing application implementation.

## Coverage
- Pull requests, main pushes, Mondays at 10:17 KST, and manual dispatch: high/critical dependency audit and CodeQL (JS/TS, security-extended).
- The default `main` branch has **no root package.json**: dependency audit and CodeQL explicitly report **NOT SCANNED** rather than presenting a false pass.
- On a branch with `package.json` plus `package-lock.json`, audit uses `npm audit --audit-level=high`, including dev dependencies. The current M1–M5 implementation chain contains an application manifest.
- Dependabot checks GitHub Actions versions weekly. Add npm to `.github/dependabot.yml` after the application manifest lands on `main`.

## Required follow-up
- The existing M1–M5 Draft PRs target **other feature branches**, not main; they may not inherit the new workflow. Rebase/merge the new security workflow into the specific branch to be tested or perform an equivalent manual audit. An absent CI result is never a pass.
- After the first successful scan, consider requiring status checks in branch protection.
- Review the repository **Settings → Advanced Security** for Dependabot alerts, security updates, secret scanning and push protection. The workflow does not change repository settings.
- This does not scan the runtime OS, Node.js host binary, Nginx, OpenSSL, deployed environments or live TLS configuration.
