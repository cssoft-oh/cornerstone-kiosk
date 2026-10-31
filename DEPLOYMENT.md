# Deployment and recovery

Target: existing swa-cornerstone-kiosk in rg-cornerstone-kiosk-prod.
Production: https://kiosk.cornerstonetech.online . Production branch: main.
This app has no npm dependencies, build service, runtime environment variables, or API package.
Preserve GitHub secret AZURE_STATIC_WEB_APPS_API_TOKEN_KIOSK without printing its value. It authorizes this SWA; no subscription-wide identity or new Azure resource is needed.

## Release

1. Develop on a branch. Run `node --check app.js` and `node scripts/package.mjs`.
2. Open a same-repository PR. Validation stores the exact static package for 30 days and publishes a PR preview. Fork PRs receive validation only.
3. Check the locked page, CSS, JS, and release.json. Do not submit intake or access customer data. Preview browser code still targets production Jail; full functional testing requires an approved test backend.
4. Before the first merge, obtain approval to configure GitHub production environment reviewer cssoft-oh with administrator bypass disabled. Permit self review for this single-owner account. Verify the rule exists; a YAML environment declaration alone is insufficient. Also require the validate status check on main with administrator enforcement after approval.
5. Present the PR, reviewed head commit, preview, target, rollback baseline, and results to the user. Merge only after explicit production approval. The environment is a second gate; approve its job only for that release.
6. Verify Actions success, live release.json commit, and locked-page/static-asset responses. No database changes are part of this release.

## Rollback

Before release record the last successful production run, commit, and live asset hashes. Initial baseline: 2fde9c968a9d72afaac9b623a011f220a4ba6b6a, run https://github.com/cssoft-oh/cornerstone-kiosk/actions/runs/34767672466 . Reconfirm before release because main can move.

For content regression, branch from current main and restore index.html, app.js, styles.css, and staticwebapp.config.json from the recorded good commit. Preserve the protected workflow. Open a PR, validate its preview, obtain explicit rollback production approval, then merge and approve its production job. Verify live hashes match baseline. Never force-push or reset main.

For workflow failure, inspect Actions logs and fix on a branch. Failed validation cannot reach upload. Preserve the functioning deployment. Do not claim rollback verified until restored assets have been rehearsed in a preview and, after approval, confirmed in production.

Artifacts expire after 30 days; Git history is the durable source for rebuilding this dependency-free static app. Rollback never touches Jail, Cosmos DB, authentication, or DNS.
