# Us — private couples app (starter v0.1)

A private two-person Android-first app scaffold using Vite, Capacitor, Firebase Realtime Database, WebRTC and a private Cloudflare R2 Worker.

## Included
- Email/password sign-up and login
- Partner connection by email (partner must sign up first)
- Private text chat
- Shared text feed
- Audio/video WebRTC call signaling and call history
- Mute/camera controls
- Browser screen-share attempt (Android WebView support is not guaranteed)
- Shared file upload and private retrieval through Cloudflare R2 Worker
- Memories list and local browser recording upload workflow
- GitHub Actions debug APK build

## Important limitations in this first build
1. WebRTC uses public STUN servers only. Calls may fail across restrictive mobile networks or NATs without TURN. Add a TURN service for reliability.
2. Android WebView does not reliably expose `getDisplayMedia()`. Native Android screen sharing requires a MediaProjection Capacitor plugin and foreground-service/notification handling. The app reports unsupported when unavailable.
3. Browser MediaRecorder support varies by Android device. The current recorder records the available local and remote tracks; verify both sides' audio/video on your devices before relying on it.
4. This is a functional starter, not a security-audited production app. The included RTDB rules are a starting point and should be tightened after your two Firebase UIDs are known. The starter rules are a two-UID allowlist, but this is still an early prototype: validate all writes and add per-path schema checks before storing highly sensitive content.
5. Calls are not end-to-end encrypted at the application level beyond WebRTC's built-in DTLS-SRTP media encryption. Files are private behind Firebase token verification in the Worker.

## 1. Create Firebase project
- Create a Firebase project.
- Add a Realtime Database in a region near you.
- Enable Authentication > Email/Password.
- Copy the web app config into `src/firebase.js`.
- Create both accounts first using temporary authenticated-user rules, copy both Firebase Auth UIDs, replace `REPLACE_WITH_FIRST_UID` and `REPLACE_WITH_SECOND_UID` in `database.rules.json`, then deploy those rules. The supplied rules allow only those two UIDs to read or write the database. Do not leave temporary test rules enabled.

## 2. Configure private R2 uploads
- Create an R2 bucket named `us-private-media`.
- Install Wrangler: `npm install -g wrangler`
- From `cloudflare-worker/`, run `wrangler login` and `wrangler deploy`.
- Set secrets:
  - `wrangler secret put FIREBASE_WEB_API_KEY`
  - `wrangler secret put ALLOWED_UIDS` (comma-separated two Firebase Auth UIDs)
- Copy the Worker URL into `.env` as `VITE_R2_WORKER_URL=https://...workers.dev`
- Rebuild after setting `.env`.

R2 bucket must remain private. Do not enable public bucket access.

## 3. Run locally
```bash
npm install
cp .env.example .env
# edit .env and src/firebase.js
npm run dev
```

## 4. Build APK with GitHub
- Upload the project contents to a GitHub repository (not the outer zip folder).
- Add the Firebase config and `.env` values before building. For a public repository, do not commit private values. Use GitHub Actions secrets and inject them during build instead.
- Run Actions > Build Android APK.
- Download the `us-debug-apk` artifact.

## 5. First use
- Both people create accounts.
- Connect partner from Profile using their exact sign-up email.
- Test text chat first.
- Test audio calls on Wi-Fi, then mobile data.
- Test video calls.
- Test screen share on a compatible browser. Native Android screen sharing is a separate next phase.
- Test recordings with both participants aware and consenting.

## Next engineering milestones
- Replace partner email lookup with one-time invitation code.
- Harden every RTDB path with a strict two-UID allowlist and validate sender/receiver fields.
- Add TURN relay configuration.
- Add native Android MediaProjection screen sharing.
- Add call recording service that records both participants reliably, with explicit mutual consent.
- Add synchronized PDF/image/video viewer state (current file upload and preview are implemented; synchronization is next).
- Add push notifications for incoming calls using Firebase Cloud Messaging.
- Add image/video post upload UI and profile photos.
- Add tests and signed release APK.

## Notes
The free tiers and quotas of Firebase and Cloudflare can change. Check current pricing before deploying at scale. This starter does not promise zero-cost TURN traffic or unlimited recording storage.
