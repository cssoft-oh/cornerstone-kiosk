# Cornerstone Kiosk

Public-facing kiosk terminal for arresting officers to queue an inmate into Jail's booking flow.

Hosted at **kiosk.cornerstonetech.online**.

## What it does

The kiosk lives at the sally-port / booking-desk lobby. When an arresting officer walks in with a subject, they:

1. Unlock the kiosk with the shared credential (`arrest` / `Welcome1!`).
2. Walk through a 4-step wizard:
   - **Inmate** — last / first / middle / DOB / sex / SSN
   - **Arresting officer** — agency / officer / badge / arrest time / location
   - **Charges** — searches Jail's ORC / statute library and adds each charge (custom codes allowed)
   - **Review & Submit**
3. On submit, the intake POSTs to Jail's public `/api/public/kiosk-arrests` endpoint. It queues in Jail under **Pending Completion**.
4. The kiosk auto-locks after submit (90 s) or on 5-minute idle. Booking-officer takes it from there — Jail opens the submission, searches for existing/prior inmates by name + DOB + SSN, and merges into a full booking (or creates a fresh lifetime record).

## Architecture

Single static HTML + JS + CSS. **No build step, no server code in this repo.** Deploys directly to Azure Static Web Apps.

```
cornerstone-kiosk/
  index.html                        Lock screen + wizard shell
  app.js                            Login, wizard, charge autocomplete, submit
  styles.css                        Full-screen kiosk styling
  staticwebapp.config.json          SWA routing + headers (SPA fallback)
  .github/workflows/deploy.yml      Azure SWA deploy on push to main
```

## Configuration

Kiosk config is baked into `app.js` as constants:

```
KIOSK_USER      = 'arrest'
KIOSK_PASS      = 'Welcome1!'
JAIL_API_BASE   = 'https://jail.cornerstonetech.online/api'
IDLE_LOCK_MS    = 5 * 60 * 1000
POST_SUBMIT_LOCK_MS = 90 * 1000
```

These are intentionally in-source — the kiosk is a public terminal, real auth is enforced downstream at the booking-officer accept step. Rotate the shared credential by editing `KIOSK_USER` / `KIOSK_PASS` and re-deploying.

## Charge library

The kiosk fetches `GET https://jail.cornerstonetech.online/api/public/charge-library` on unlock. That endpoint returns `[{ code, desc, cls }, ...]`. If the fetch fails (offline / DNS), a small built-in fallback list keeps the kiosk usable so intake is never blocked.

## Cross-origin submit

Jail's `/api/public/kiosk-arrests` and `/api/public/charge-library` endpoints set CORS headers that allow `https://kiosk.cornerstonetech.online` (plus dev localhost). All other cross-origin requests to Jail's `/api/*` remain same-origin only.

## Provisioning

**One-time setup** (owner / SRE):

```bash
# 1. Provision the Static Web App in Azure
az group create --name rg-cornerstone-kiosk-prod --location eastus2
az staticwebapp create \
  --name swa-cornerstone-kiosk \
  --resource-group rg-cornerstone-kiosk-prod \
  --location eastus2 \
  --sku Standard \
  --source https://github.com/cssoft-oh/cornerstone-kiosk \
  --branch main \
  --app-location "." \
  --output-location ""

# 2. Get the deploy token and add it to the GitHub repo as
#    AZURE_STATIC_WEB_APPS_API_TOKEN_KIOSK
az staticwebapp secrets list \
  --name swa-cornerstone-kiosk \
  --resource-group rg-cornerstone-kiosk-prod \
  --query properties.apiKey -o tsv

# 3. Bind the custom domain
az staticwebapp hostname set \
  --name swa-cornerstone-kiosk \
  --resource-group rg-cornerstone-kiosk-prod \
  --hostname kiosk.cornerstonetech.online

# 4. Add the CNAME in your DNS provider:
#    kiosk.cornerstonetech.online → <the swa's default hostname>.azurestaticapps.net
```

## Kiosk hardware notes

- Full-screen browser on a dedicated Windows/Chromebook/iPad terminal at the sally-port.
- Set the browser home page to `https://kiosk.cornerstonetech.online/`.
- Enable "kiosk mode" in the browser to hide chrome and disable the URL bar.
- Physical keyboard preferred over on-screen for badge number entry.
- On any 5-minute idle, the kiosk auto-returns to the lock screen; no data leaks between officers.

## Development

To try the kiosk locally:

```bash
# Any static-file server works.
npx serve . -l 8090
# → http://localhost:8090
```

Charges will auto-populate from the fallback library if you're not on the same domain as Jail. Submit will fail cleanly with a CORS message pointing at the missing Jail endpoint.
