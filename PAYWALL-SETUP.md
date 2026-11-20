# Access codes: how to switch the paywall on

The app is ready. Nothing changes for walkers until you turn it on.

## What is built
- `villages/warmington/walk.json` has an `access` block: `enabled` (false now), `free_stops` (2), `buy_url`, `verify_url`, and the wording (cyan until approved).
- When `enabled` is true, stops after the free ones send the walker to an "Unlock the rest of the walk" page. They type a code. A correct code is remembered on that phone.
- "Reset my progress" does NOT remove the unlock, so a walker who has paid never loses it.
- `tools/make_codes.py` makes codes like `WARM-K7QD-3MXP` (one set per village, so codes only unlock their own village) and saves only their hashes in `villages/warmington/access-codes.json`.

## Day one, with no extra services (simple and manual)
1. Create a Stripe Payment Link for the walk (stripe.com, Payment Links). Put its address in `buy_url`.
2. Run `python3 tools/make_codes.py warmington 50`. Keep the printed list private (not in the repo).
3. Commit and push `villages/warmington/access-codes.json` (hashes only).
4. When a payment email arrives, email the buyer one unused code. Cross it off the list.
5. Set `"enabled": true` in `villages/warmington/walk.json`, then commit and push.

## Honest limits of this version
- The repo is public, so a determined person can read the stop files and answers without a code. The code gate stops ordinary walkers, not copying.
- A shared code works for anyone, many times.
- GitHub Pages' terms say Pages is not meant to be a free host for running an online business. Before charging, move hosting to a service that allows commercial sites (Cloudflare Pages or Netlify, check their terms) or ask GitHub. The files are static, so a move is easy.

## Next level: server-checked codes (use `verify_url`)
`tools/access-worker.js` is a starting point for a small Cloudflare Worker that checks a code, limits it to a number of phones, and (optionally) creates a code when Stripe confirms a payment. It is NOT deployed or tested. Setting `verify_url` in the village walk.json to the Worker's address makes the app check codes there instead of in the published file.
To really protect the content, the stops after the free ones must also be served by the Worker only after a valid code. That is a bigger change: ask Claude to do it when you are ready.

## Before taking money (checklist)
- Business name, refund wording and contact email on the buy page.
- A short privacy note: the app stores progress and the unlock on the phone only; location, if allowed, is used on the phone and not sent anywhere.
- Parish Council permission for the village board artwork and photographs, if you quote or reproduce the boards.

## Getting it online as a proper website (draft plan, nothing set up yet)

1. **Today:** the app is live on GitHub Pages at lomtom3.github.io/from-sparks-warmington. That's fine for testing, but GitHub's rules say Pages isn't meant for running a business.
2. **Your own address:** buy a domain such as fromsparks.co.uk, about £10 a year from any registrar. Sign up with tsjprints+domain@gmail.com.
3. **Selling-friendly free hosting:** connect the same GitHub repo to Cloudflare Pages (free, allows commercial use). Every push in GitHub Desktop then updates the site, just like now. Point the domain at it, and HTTPS is automatic.
4. **Taking payment:** use one Stripe Payment Link per walk. After payment, the buyer gets an email with an access code from the code list made by `tools/make_codes.py`.
   - At first you send the codes by hand.
   - Later, `tools/access-worker.js` on Cloudflare Workers can check codes and send them out automatically.
5. **Switching it on for a walk:** in that walk's `walk.json`, set `access.enabled` to true and fill in `buy_url` with the Stripe link. Until then, nobody is asked for a code.
6. **Previewing it:** with "Show draft colours" on, the welcome page shows a draft "How buying a walk will work" card and a preview of the unlock page.
