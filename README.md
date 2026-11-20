# ClearPost

**Acompanha encomendas CTT, DPD / BRT, InPost, DHL, GLS, UPS e Correos Express numa PWA em estilo Clear Glass.**

![ClearPost em iPhone — Login Google e Painel Clear Glass](docs/preview-iphone.jpg)

---

## Funcionalidades

- **Design Clear Glass (Claro e Escuro automático):** interface translúcida com hierarquia real de espessura de vidro, *Delivery Lens* com reflexo especular subtil e trilho ótico de estado da entrega.
- **Deteção automática de transportadora + seletor de ambiguidade:** reconhece códigos CTT, DPD, BRT Itália (18 dígitos), InPost, DHL, GLS, UPS e Correos Express; quando o número de dígitos coincide com várias transportadoras, abre um popup nativo para escolher.
- **Colar em 1 toque:** botão direto para colar códigos da área de transferência no telemóvel.
- **Autenticação Google + Firestore (Firebase Spark — gratuito):** ecrã inicial de login com Google e sincronização em tempo real privada por utilizador.
- **Proxy separado em Cloudflare Worker (0 €):**
  - Consulta direta **sem chave API** para **DPD** e **InPost** + sondagem automática.
  - Suporte gratuito a **DHL Unified Tracking API** (250 req/dia com conta pessoal em `developer.dhl.com`).
  - Link direto **Abrir na transportadora** para CTT, BRT Itália (`mybrt.it`), GLS, UPS e restantes.
- **Pronta para iPhone (PWA) + Widget Scriptable:** instalável no ecrã inicial (*Partilhar → Adicionar ao ecrã principal*) e endpoint `GET /api/widget` para widgets nativos no iOS (Scriptable) ou Android (KWGT).

---

## Arquitetura

```text
PWA (Vite + React + TypeScript)
 ├── Firebase Auth (Google) + Cloud Firestore (regras por utilizador)
 ├── Firebase Hosting (HTTPS + headers de segurança)
 └── Cloudflare Worker Proxy (worker/)
      ├── DPD / InPost (APIs públicas gratuitas)
      ├── DHL Unified API (opcional, chave gratuita)
      └── GET /api/widget (JSON leve para Scriptable / KWGT)
```

---

## Instalação local

```bash
git clone https://github.com/bernam07/clearpost.git
cd clearpost
npm install
cp .env.example .env
```

Preenche o `.env` com a configuração da tua Web App no [Firebase Console](https://console.firebase.google.com/) e arranca em desenvolvimento:

```bash
npm run dev
```

---

## Deploy (100% gratuito)

### 1. Firebase (Plano Spark)

1. Ativa **Authentication → Google** e **Cloud Firestore** no Firebase Console.
2. Publica as regras de segurança e a PWA:

```bash
npm run build
npx firebase-tools@latest login
npx firebase-tools@latest use --add
npx firebase-tools@latest deploy --only hosting,firestore:rules
```

### 2. Proxy separado (Cloudflare Worker)

Funciona logo **sem chaves** para DPD e InPost. Opcionalmente, cria uma chave gratuita em [developer.dhl.com](https://developer.dhl.com/) (*Shipment Tracking - Unified*):

```bash
cd worker
npm install
npx wrangler login
npm run deploy
npx wrangler secret put DHL_API_KEY   # opcional
```

Cola o URL `.workers.dev` em **Definições** dentro da PWA (ou em `VITE_PROXY_URL` no `.env`).

---

## Instalar no iPhone (PWA)

1. Abre o URL do teu Firebase Hosting (`https://<project-id>.web.app`) no **Safari**.
2. Toca no ícone **Partilhar** → **Adicionar ao ecrã principal**.
3. Abre a **ClearPost** a partir do ecrã inicial e inicia sessão com a tua conta Google.

---

## Segurança

- **Zero segredos no repositório:** `.env`, `.firebaserc`, `worker/.dev.vars` e credenciais locais estão bloqueados no `.gitignore`.
- **Firestore estritamente privado por utilizador** (`firestore.rules`): apenas `request.auth.uid == userId` tem acesso às suas encomendas, com validação de schema (`hasOnly`), limites de tamanho e `createdAt` imutável.
- **Validação estrita no Worker:** apenas códigos alfanuméricos válidos (`^[A-Za-z0-9_-]{4,64}$`), headers `X-Content-Type-Options: nosniff` e `Referrer-Policy: no-referrer`.
- **Headers HTTP de segurança** configurados no `firebase.json` (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy`).
- **Recomendações para produção:** atualiza `ALLOWED_ORIGIN` em `worker/wrangler.toml` para o teu domínio `https://<project-id>.web.app` em vez de `*`.
