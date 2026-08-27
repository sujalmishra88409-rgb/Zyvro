# ZYVRO — Worklog

---
Task ID: 1
Agent: Super Z (main agent)
Task: Build ZYVRO — mobile-first private friend-location web app (dark tactical map, realtime sharing, weather/environment) per the uploaded master build prompt PDF, using provided logo + Ably / Turso / MapTiler credentials.

Work Log:
- Read ZYVRO_MASTER_UI_AND_BEHAVIOR_PROMPT.pdf (8 pages) — full UI/behavior spec; reviewed logo.png (black mark on cream).
- Loaded fullstack-dev skill; initialized Next.js 16 project; installed @libsql/client, ably, maplibre-gl.
- scripts/process_logo.py: extracted mark → off-white on transparency (public/zyvro-mark.png), favicon set (icon-512/192, favicon.ico), manifest.webmanifest.
- .env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ABLY_API_KEY, NEXT_PUBLIC_MAPTILER_API_KEY, AUTH_SECRET, NEXT_PUBLIC_APP_URL (server secrets never exposed; only MapTiler key is NEXT_PUBLIC per spec).
- scripts/init-turso.ts: created users / groups / group_members / locations tables + indexes + default group "ZYVRO" (code ZYVRO, id grp_zyvro_main).
- Server libs: src/lib/server/{turso,ably,ratelimit}.ts (Turso access, Ably REST + scoped publish, in-memory write throttle).
- API routes (all validated with zod, membership-gated): POST /api/register, POST /api/location (range/timestamp validation + 1.5s rate limit + Ably broadcast), GET /api/group/members (coords nulled for paused sharers), GET /api/realtime/token (returns ACTUAL issued TokenDetails so client reads effective capability), POST /api/sharing (delete stored fix on pause), POST /api/offline (pagehide beacon). All group endpoints accept internal id OR shareable code (resolveGroup).
- Client: zustand store; useZyvroSession hook (identity, geolocation watch + throttle 2.5s/8m/12s-heartbeat, realtime, 60s resync, pagehide beacon).
- Map: MapLibre + MapTiler darkmatter + applyMonochrome() re-paints every layer to charcoal monochrome palette (near-black land #0A0C0B, charcoal buildings, gray roads by class, muted labels, POI icons hidden). Custom DOM markers: deterministic character + hue from client_id hash, LIVE pulse only when fresh, dimmed when offline, green "YOU" pill for self, smooth exponential interpolation between fixes.
- Sheets (vaul): NameSheet (first visit only, dismissible=false), FriendSheet (status, area, distance via haversine, weather + AQI/PM2.5/PM10/O3 with 10-min grid cache, center-map), SettingsSheet (sharing pause/resume, rename, group code copy/join).
- KEY CONSTRAINT DISCOVERED: the provided Ably key 6uXe4Q.T6oGcg has capabilities {publish, presence, history} — NO subscribe / presence_subscribe. Tokens can't exceed key capabilities; direct channel subscription is impossible. → Adaptive transport: server persists to Turso then broadcasts to Ably (per spec §9 flow); clients with subscribe use push; otherwise they poll channel HISTORY every 2.5s (visible-tab only, message-id dedupe). Verified end-to-end via scripts/test-realtime.ts: server → Ably → friend delivery PASS.
- Browser verification (agent-browser, 412×915 Android viewport): fixed map container zero-height (MapLibre css position:relative overrode Tailwind absolute → inline style) and no-tile issue (blob workers blocked → setWorkerUrl("/maplibre-gl-csp-worker.mjs"), bundles copied to public/). Fixed group-code vs group-id channel mismatch; area geocode filters to locality/place types.
- Verified flows: first-open name sheet over map → join → header/controls → own "YOU" marker + live pulse → friend markers (LIVE + offline-dimmed) → tap marker → details sheet (status, area, distance, AQI/PM real data, Open-Meteo weather with graceful degradation on 429) → self sheet with sharing pause/resume → reload skips name prompt (localStorage identity) → settings (rename, group code copy/join) → desktop layout.
- Final: eslint clean, tsc clean, fresh page load zero console/page errors.

Stage Summary:
- Deliverable: production-ready ZYVRO MVP at / (single screen, map-first, Android-first).
- Stack: Next.js 16 + TS + Tailwind 4, Turso (persistence), Ably (broadcast + adaptive transport), MapLibre + MapTiler darkmatter (monochrome), Open-Meteo (weather/AQI), MapTiler geocoding (area names).
- IMPORTANT for user: their Ably key lacks "subscribe" capability. The app works today via Ably history polling (~2.5s latency). Enabling "Subscribe" + "Presence subscribe" + "Publish" on the Ably dashboard key upgrades the same build to instant push with zero code changes.
- Live data observed: real user "Utkarsh" (client 4de890e5…) registered and streamed a real GPS location from their device during verification; a second device identity (35a04c0e…) also appeared — the multi-device acceptance flow is being exercised by the user in real time.

---
Task ID: 2
Agent: Super Z (main agent)
Task: Fix five user-reported bugs — (1) app opens on New Delhi instead of user's location, (2) pin only accurate at full zoom, (3) duplicate icons of the same person, (4) no delete-profile option, (5) village name missing on friend profiles.

Work Log:
- Bug 1 (wrong default view): map no longer boots at hardcoded New Delhi [77.209,28.6139] z10.5 — starts on neutral country view [79.6,22.8] z3.4. Geolocation watch now starts IMMEDIATELY on mount (before registration round-trips). Display-first fix handling: noisy fixes (>500 m) are shown locally, only filtered from SENDING. 9 s low-accuracy fallback fix (network location) for slow GPS locks; maximumAge 0. First-fit is user-centred (accuracy-aware zoom) with member-data grace timer, retries until map API exists, plus mount-time catch-up (warm-cache race: fix could land before the lazy map chunk registered its transition listener → first fit never fired).
- Bug 2 (pin exact only at full zoom) — ROOT CAUSE: `.zyvro-marker { position: relative }` made the marker element participate in the map container's flow layout; its static position (~80 px) added a constant pixel offset on top of MapLibre's transform. 80 px ≈ 44 km at zoom 8 but ≈ 2–10 m at zoom 18 → exactly "accurate only when fully zoomed". Fixed with position:absolute + left/top 0; measured offset now 0.5 px (device-pixel rounding) at zooms 4/8/12/16/18. Also moved YOU pill ABOVE the badge and status dot to top-right so nothing visually reads as a "pin tip" below the true point.
- Bug 3 (duplicate person icons): live DB confirmed two "Utkarsh" + two "Arjun Test" rows (same human, two device identities). Three layers: (a) scripts/dedupe-members.ts one-off merge of existing duplicates (ran: removed 2 rows, kept freshest per group+name); (b) register API now ADOPTS the existing same-name profile when a fresh client_id registers (claimUserClientId — moves client_id onto the existing row; rename collisions with a DIFFERENT member's name are rejected 409); (c) client-side dedupeMembers() in the store keeps only the freshest row per normalized name.
- Bug 4 (delete profile): new POST /api/profile/delete (idempotent; broadcasts "left" to all member groups before deleting rows). New LeftBroadcast type; clients drop the member instantly (history-poll + push paths). SettingsSheet gained a red danger zone with two-step confirm; deleteProfile() action stops the session, clears localStorage identity, resets store → name sheet. Retrying wrapper for Turso: LibsqlError SERVER_ERROR transient HTTP 400s under concurrency made deletes 500 mid-way (non-atomic); turso() now wraps execute with backoff-retry (benefits every route) and the route tolerates broadcast-lookup failure.
- Bug 5 (village name): reverseGeocode rewritten around MapTiler's REAL geocoder taxonomy — the API 400s on unknown types ("village"/"town"/"city" are NOT valid; settlements are "locality"/"place"/"municipality") and forbids `limit` with multiple types on reverse geocoding. Typed pass (locality/neighbourhood → place/municipality/… → county/subregion/region) with priority picking + untyped fallback + cache-version bump (v2:) and short retry window for failures. Verified: rural Varanasi point → "Railwayganj Colony"; Delhi → "New Delhi".
- Also fixed: unhandled presence.leave() promise rejection on teardown/pagehide (caught as pageerror).
- Verification (Playwright, granted geolocation at rural village point, 412×915): A opens exactly on user (z16.2 at granted coords) PASS; B pin offset worst 0.50 px across zoom 4→18 PASS; C area shows "Railwayganj Colony" PASS; D delete → identity cleared → name sheet PASS; E zero page errors PASS. Register-merge tested via API: second client registering same name (case-insensitive) adopts the row (1 DB row, client_id moved). eslint + tsc clean (app code).
- Housekeeping: deleted test rows (Verify Bot / Diag Bot / Merge Test A) — DB now has only Praveen Shukla, Vishal, Utkarsh, Arjun Test.

Stage Summary:
- All five reported bugs fixed and verified end-to-end; key insight for the future: MapLibre marker elements MUST be position:absolute (flow-relative markers get a constant pixel offset that varies in metres per zoom), and MapTiler reverse geocoding requires its exact type taxonomy.
- Same-human-two-devices remains last-writer-wins by name (documented trade-off for a no-auth friends app).

---
Task ID: 3
Agent: Super Z (main agent)
Task: Fix persistent "opens at a demo location" report — root-cause the real hijack chain (leftover test users + member-grace auto-fit + a live duplicate-profile race), and stabilize the serving process.

Work Log:
- DB dump exposed the real culprit: leftover TEST profile "Praveen Shukla" (client_id test-cli…) holding a stale New Delhi fix (28.61, 77.21) in group ZYVRO, plus "Vishal"/"Arjun Test" test rows.
- ZyvroMap first-fit rewrote: the map now auto-centers ONLY on the user's own GPS fix — removed the 5 s member-grace fitAll() that deep-zoomed newcomers onto a (stale) friend pin when their GPS was slow; warm-cache catch-up + retry-until-map-api kept; map bundle retry now re-arms after ~10 s failure.
- Geolocation errors hardened: TIMEOUT/POSITION_UNAVAILABLE (no fix yet) now surfaces a "Can't find your position — tap to retry" banner (new geoStuck store state) instead of an endless spinner; denied-in-iframe gets "Open in a browser tab to enable location" (window.open escape) since preview iframes without allow=geolocation can never grant.
- Live duplicate found mid-session: TWO "Utkarsh" rows with different client_ids streaming simultaneously — root cause: register route's check-namesake→insert race (double-tap "Enter ZYVRO": page.tsx passed busy={false} always; two registers minted two fresh client_ids before identity save).
- Fixed server-side: registerFreshUser() — atomic claim-or-create inside ONE libsql write batch (UPDATE-claim → conditional INSERT via NOT EXISTS(client_id) → membership upsert → read-back); register route fresh path now calls it. Fixed in production: wrapClient must BIND batch/executeMultiple/transaction to the real client (private class fields throw "Cannot access invalid private field" when invoked through the Object.create wrapper).
- Fixed client-side: registeringRef reentrancy lock + registering store state; NameSheet busy now real (button locks, shows "Entering…").
- Belt-and-braces: members GET now dedupes server-side by normalized name (freshest row wins) so transient dup rows can never render twice.
- Cleanup: deleted test profiles (Praveen Shukla/Vishal/Arjun Test/Claim Probe/Health Check/Race Probe/ZK Verify/ZK NoGps), merged the live Utkarsh dup (kept original 4de890e5 identity, Ably "left" broadcast), DB now has exactly one user.
- Race test: 8 concurrent same-name registers → 8×200, 1 distinct user id, 1 DB row → PASS. Playwright re-verified: A opens on own GPS (Mumbai z16.2, 1148 km from Delhi) PASS; C delete-profile PASS; B denied → country view + banner PASS; zero page errors.
- OPS: dev server was OOM-killed (1.6 GB RSS) and tool-spawned processes get reaped between calls; plain `&` jobs die too. Durable runner = `start-stop-daemon --start --background --make-pidfile --pidfile /tmp/zyvro-ssd.pid --startas /usr/bin/env -- $(grep -v '^#' .env | xargs) NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 bun .next/standalone/server.js`. Production build deployed (bun run build; .env copied into .next/standalone). Bun fetch needs 127.0.0.1, not localhost (IPv6 ::1).

Stage Summary:
- Map opens ONLY on the user's own position now; friends' pins (stale or demo) can never hijack the first view; duplicate profiles are impossible at the DB level and impossible client-side under double-tap; geolocation failure states are explicit and recoverable.
- App now served by a production build (stable memory) on :3000, managed by start-stop-daemon (pidfile /tmp/zyvro-ssd.pid). Restart recipe recorded above.
