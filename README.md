# GatherKit

One event brief. Your whole event pack.

[Try the live app](https://masterasnackin.github.io/gatherkit/)

Turn an organiser's event brief into an editable promotional and operations pack. Review the copy and poster, approve the assets, then download the files for your own publishing workflow.

Built for the Event Autopilot track of the Grok Bot Community Engineering London Hackathon, 22 October 2026. The included demonstration uses a **fictional London community and invented event details**. It is not a real event invitation.

## Run it next week

Requirements: Node.js 20.19+ or 22.12+ and npm. Clone or download this repository, open its folder, and run:

```sh
npm install
npm run dev
```

Open [the local app](http://127.0.0.1:4318). If that port is already occupied, use the address printed by Vite. No API key, account, paid service or backend is required.

For a production build:

```sh
npm run build
npm run preview
```

The `dist/` directory can be hosted as a static website. This repository includes a GitHub Pages workflow that runs the tests and production build before deploying changes on `main`. Enable Pages with GitHub Actions as the source in your fork to use it. The app does not submit itself to the hackathon.

## One complete organiser workflow

1. Start with the labelled sample or enter your community, audience, event idea, date, times, venue, accessibility details, ticket price, budget and volunteers.
2. Assemble the pack. The app uses deterministic templates to create an event page, LinkedIn post, WhatsApp message, Discord announcement and newsletter copy, alongside a poster, run sheet, budget and volunteer rota.
3. Edit the copy, resolve missing details and review the final artwork. Each copy asset and the poster has an explicit approval state.
4. Approve the assets you have checked. Changes to the source brief require the pack to be regenerated and reviewed again; edited copy must be approved again.
5. Download the approved pack and files, then publish through your own tools. The app performs no social posting, email sending, venue booking or external submission.

Approval records your review. It does not independently verify venue availability, prices, access arrangements, permission to share personal data or external links.

## What is implemented

- Structured event and community context, with missing-detail checks.
- Five editable promotional copy assets and individual review states.
- Original, code-generated SVG and PNG poster artwork with no remote image assets.
- Run sheet and volunteer rota, with names drawn from the brief rather than invented assignments to real people.
- Budget calculations in GBP, distinguishing confirmed costs from estimates. Capacity multiplied by ticket price is maximum possible ticket income, not a sales forecast. Fees, taxes and refunds are excluded.
- Local workspace persistence and portable JSON backup/import.
- Markdown and standalone HTML organiser packs, including approval states, provenance and operations details. HTML is suitable for printing from a browser.
- Calendar `.ics` export with correct Europe/London daylight-saving conversion. Calendar entries are tentative planning records. Events must start and end on the same date; ambiguous or nonexistent times around clock changes are rejected.
- Measured local assembly duration and a user-adjustable time-saving estimate. The estimate is not observed volunteer time saved or an independently measured outcome.

## Honest integration boundary

The event pack starts with a **deterministic local template engine**. For AI-assisted promotional copy, the app also offers a **Grok Bot desktop handoff**: copy the prepared prompt, send it to your signed-in Grok Bot, then paste its structured reply back into GatherKit. This is a human-assisted workflow, not a direct API connection from the website.

The handoff includes the current event details and a source fingerprint. GatherKit rejects replies for another version of the brief, checks that all five copy assets are present, previews them, and requires an explicit replacement action. Imported copy starts as drafts with fresh approval required. The poster, run sheet and rota stay in place. Imported copy is labelled in the workspace and organiser exports; the app does not independently authenticate who generated pasted text.

The organisers link to the [Grok Bot skill](https://github.com/adamanz/grok-bot-skill) for using Grok Bot from a coding agent. That optional tool uses a locally signed-in desktop session. No session material or credentials belong in this repository or the public app. You can also use Grok Bot manually with the copied prompt.

The website itself makes no language-model calls. It has no live Notion, Ghost, Supabase, Cognee, Zero, email or social-media integration. Partner tools are only described as connected when a connection has actually been implemented and verified.

The event pack is editable, but it does not offer live collaborative editing or account-based access control. The poster uses a fixed visual template. Long text is wrapped and may be shortened with an ellipsis; the organiser pack retains the full details. Review every exported asset before sharing it.

## Privacy and storage

The running app keeps its workspace in this browser's local storage. It does not send event details to an application server or model provider. If you choose the Grok Bot handoff, you send the copied event details to that separate service yourself; review the prompt first. Installing packages, loading a deployed site or opening links can still create network requests; the application is not a network isolation tool.

Local storage belongs to the browser profile and site origin. Other people using that profile may see the workspace. Clearing browser data can remove it. Save a portable JSON backup when you need a durable copy or want to move between browsers.

Exports may contain organiser contact details, volunteer names and internal notes. Review files before sharing. The fictional sample label is retained in the organiser packs, calendar and poster while sample mode is enabled. Replacing sample details with real information is your responsibility.

Generated HTML and SVG encode input as text. Calendar content is escaped and folded by UTF-8 byte length. No CSV is generated.

## Checks

```sh
npm test
npm run build
```

Export tests cover mixed approval states, budget arithmetic, unsafe markup, calendar daylight-saving changes, calendar content-line injection, UTF-8 folding and long poster text. Unit tests do not establish live integration, public deployment, successful hackathon submission or organiser acceptance. A browser walkthrough is needed to check downloads, local persistence, poster rendering and the complete review flow.

## Adapt it for your community

Fork the repository, replace the sample with your own brief and adjust the templates and visual styling. Keep provenance and review labels visible. If adding a provider, make its configured and live states explicit, keep credentials out of the browser bundle, and retain approval before publishing.

The source is available under the [MIT licence](LICENSE). No external visual assets or fonts are required.
