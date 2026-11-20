# ClearPost

**Track CTT, DPD / BRT, InPost, DHL, GLS, UPS, and Correos Express parcels in a Clear Glass PWA.**

Live app: **[clearpost-pt.web.app](https://clearpost-pt.web.app)**

![ClearPost on iPhone — Google Sign-In and Clear Glass Dashboard](docs/preview-iphone.jpg)

---

## Features

- **Clear Glass interface (Light & Dark automatic):** layered translucent panes with specular edge highlights, an optical **Delivery Lens** hero widget, and a continuous light-rail delivery progress track.
- **Automatic carrier detection + ambiguity picker:** recognizes CTT, DPD, BRT Italy (18 digits), InPost, DHL, GLS, UPS, and Correos Express formats; when a digit length matches multiple carriers, a native Clear Glass dialog lets you choose the right one.
- **One-tap clipboard paste:** paste tracking numbers straight from your clipboard on mobile.
- **Google Sign-In + Cloud Firestore (Firebase Spark — free):** clean initial Google sign-in gate with private per-user real-time sync.
- **Separate Cloudflare Worker proxy ($0/mo):**
  - Direct keyless tracking for **DPD** and **InPost** plus parallel auto-detection.
  - Free **DHL Unified Tracking API** support (250 req/day with a personal `developer.dhl.com` account).
  - One-tap **Open carrier page** links for CTT, BRT Italy (`mybrt.it`), GLS, UPS, and more.
- **iPhone PWA + Scriptable Widget:** custom Clear Glass home screen icon (`apple-touch-icon.png`) and a lightweight `GET /api/widget` endpoint for iOS Scriptable or Android KWGT widgets.

---

## Architecture

```text
PWA (Vite + React + TypeScript)
 ├── Firebase Auth (Google) + Cloud Firestore (per-user security rules)
 ├── Firebase Hosting (HTTPS + HTTP security headers)
 └── Cloudflare Worker Proxy (worker/)
      ├── DPD / InPost (free public endpoints)
      ├── DHL Unified API (optional free key)
      └── GET /api/widget (lightweight JSON for Scriptable / KWGT)
```

---

## Local Setup

```bash
git clone https://github.com/bernam07/ClearPost.git
cd ClearPost
npm install
cp .env.example .env
```

Fill `.env` with your Firebase Web App config from the [Firebase Console](https://console.firebase.google.com/), then start the dev server:

```bash
npm run dev
```

---

## Free Deployment

### 1. Firebase (Spark Plan)

1. Enable **Authentication → Google** and **Cloud Firestore** in the Firebase Console.
2. Build and deploy:

```bash
npm run build
npx firebase-tools@latest login
npx firebase-tools@latest use --add
npx firebase-tools@latest deploy --only hosting,firestore:rules
```

### 2. Separate Proxy (Cloudflare Worker)

Works out of the box with **no API keys** for DPD and InPost. Optionally create a free key at [developer.dhl.com](https://developer.dhl.com/) (*Shipment Tracking - Unified*):

```bash
cd worker
npm install
npx wrangler login
npm run deploy
npx wrangler secret put DHL_API_KEY   # optional
```

Paste your `.workers.dev` URL in **Settings** inside the PWA (or set `VITE_PROXY_URL` in `.env`).

---

## Install on iPhone (PWA)

1. Open **[clearpost-pt.web.app](https://clearpost-pt.web.app)** in **Safari**.
2. Tap **Share** → **Add to Home Screen**.
3. Launch **ClearPost** from your Home Screen and sign in with Google.

---

## Security

- **Zero secrets in Git:** `.env`, `.firebaserc`, `worker/.dev.vars`, and local credential files are blocked in `.gitignore`.
- **Strict per-user Firestore rules (`firestore.rules`):** default-deny everywhere; only `request.auth.uid == userId` can read/write their parcels, with strict `hasOnly` field validation, size caps, and immutable `createdAt`.
- **Hardened Worker & Hosting:** strict `^[A-Za-z0-9_-]{4,64}$` tracking number validation, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, and `Permissions-Policy`.
- **Production tip:** set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your exact Firebase Hosting origin (`https://<project-id>.web.app`).
