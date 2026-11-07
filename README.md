# Us — setup (one time)

Only 2 files go on GitHub: `index.html` and `.github/workflows/android.yml`.
`worker.js` and `database.rules.json` are copy-paste into dashboards.
Delete your old files (main.js, style.css, firebase.js, package.json, capacitor_config.json, wrangler.toml, index.js, ANDROID_PERMISSIONS.txt, old database_rules.json).

## 1. Firebase
- Authentication → Sign-in method → enable Email/Password
- Realtime Database → create → Rules tab → paste `database.rules.json` → Publish
- Data tab: delete any old data (old /users had emails)
- Project settings → Your apps → Web app → copy the 5 config values

## 2. Files (Cloudflare)
- R2 → create bucket `us-private-media` (keep private)
- Workers & Pages → Create → Hello World → Edit code → paste `worker.js` → Deploy
- Worker → Settings → Bindings → R2 bucket: name `PRIVATE_MEDIA` → bucket above
- Worker → Settings → Variables: `FIREBASE_WEB_API_KEY` = your Firebase apiKey
- Copy the worker URL

## 3. Fill CONFIG
Top of `index.html`: paste the 5 Firebase values + worker URL.

## 4. GitHub
- New PUBLIC repo (free Pages needs public; no secrets are in it)
- Upload `index.html`; create file `.github/workflows/android.yml` (paste)
- Settings → Pages → Deploy from branch → main → / (root)
- Actions → Build APK → Run workflow → download artifact `us-apk` → install `Us.apk`

## Updating later
Edit `index.html` on GitHub → commit. Live in ~1 min. App updates itself next time you open it. No new APK.
Rebuild the APK only if you edit `android.yml`.

## Use
Both sign up → Find your person → search a name → Connect → they Accept.

## Known limits
- Calls ring only while Us is open (background ringing needs Firebase push).
- Screen share doesn't exist in Android WebView; button is hidden there.
- Mobile-data calls between different carriers may need TURN: paste yours in CONFIG.ice (free key: metered.ca).
- Recording shows a red "Recording" banner on both phones.
