# Cornerstone Kiosk development

- Preserve existing branding, Source Sans 3, colors, responsive layout, and behavior.
- Work on a branch. Read app.js and staticwebapp.config.json before changing API or authentication behavior.
- Run `node --check app.js` and `node scripts/package.mjs`. Review the PR preview.
- Preview code still calls the production Jail API. Never submit test intake records or access customer data during deployment checks. Use the locked page and static assets.
- Obtain explicit user approval for each production deployment, production security change, database change, destructive action, or chargeable resource. Identify the release commit and target in approval requests.
- Never merge or trigger production before approval. Configure and verify a production environment reviewer rule before merging this pilot; the YAML environment name alone does not enforce approval.
- Preserve Azure resources, domains, and APIs. Keep secrets in GitHub/Azure; never print, commit, or request secrets in chat.
- Deploy only dist/. Preserve minimal workflow permissions and the existing application-scoped SWA secret.
- Follow DEPLOYMENT.md for release and rollback; report commit, run URL, preview/live URL, checks, and limitations.
