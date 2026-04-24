# Meta Chatbot Backend

Production-oriented TypeScript monorepo scaffold for a context-driven chatbot that starts with:

- WhatsApp inbound and outbound messaging
- Instagram DM inbound and outbound messaging
- Messenger inbound and outbound messaging
- Albanian jewelry catalog template and product matching
- OpenAI-powered reply generation
- PostgreSQL persistence through Prisma
- Redis + BullMQ worker processing

## What is implemented

- NestJS API app in `apps/api`
- NestJS-based worker process in `apps/worker`
- Shared workspace packages for config, logging, queueing, Prisma access, adapters, and AI
- Meta webhook signature verification and challenge handling
- WhatsApp, Instagram, and Messenger payload normalization
- In-memory loading of `data/argjendari-catalog.al.json` for Albanian product matching
- Raw webhook event persistence with idempotent event IDs
- Conversation, user, channel, and message creation in the worker
- Simple OpenAI Responses API reply generation with safe fallback
- Channel-specific outbound reply sending through the Meta Graph API
- Docker Compose services for PostgreSQL + pgvector and Redis

## Quick start

1. Copy `.env.example` to `.env`.
2. Start infrastructure:

```bash
docker compose up -d
```

3. Install dependencies:

```bash
npm install
```

4. Generate or apply database state:

```bash
npm run db:enable-pgvector
npm run db:push
```

5. Start the API and worker in separate terminals:

```bash
npm run dev:api
npm run dev:worker
```

## Render free-tier workaround

Render free instances do not include background workers. For a low-cost test deployment, run the API and worker in a single web service:

- Build Command: `npm install && npm run build:render`
- Start Command: `npm run start:render`

Use a paid Render background worker when you move beyond basic testing.

## Jewelry catalog template

- The default Albanian jewelry catalog file is `data/argjendari-catalog.al.json`
- `CATALOG_FILE_PATH` can point to another JSON file if you want a different catalog
- `PUBLIC_BASE_URL` should point to your public app URL so WhatsApp can fetch catalog images
- Each product can store strings plus image references through the `images` array
- The worker loads the catalog into memory and uses it to match Albanian queries such as `a keni unaze 22 karat te meshkujve?`

## Important endpoints

- `GET /webhooks/meta/verify`
- `GET /webhooks/meta/whatsapp`
- `GET /webhooks/meta/instagram`
- `GET /webhooks/meta/messenger`
- `POST /webhooks/meta/whatsapp`
- `POST /webhooks/meta/instagram`
- `POST /webhooks/meta/messenger`
- `GET /internal/health`

## Meta channel setup

- WhatsApp callback URL: `https://YOUR-SERVICE/webhooks/meta/whatsapp`
- Instagram callback URL: `https://YOUR-SERVICE/webhooks/meta/instagram`
- Messenger callback URL: `https://YOUR-SERVICE/webhooks/meta/messenger`
- Instagram requires `INSTAGRAM_PAGE_ACCESS_TOKEN` and `INSTAGRAM_PAGE_ID`
- Messenger requires `MESSENGER_PAGE_ACCESS_TOKEN` and `MESSENGER_PAGE_ID`
- Reuse the same `META_APP_SECRET` and `META_VERIFY_TOKEN` when the channels live in the same Meta app

## Verification

The current scaffold is verified with:

- `npm run build`
- `npm test`
- `npx prisma validate`

## Next implementation phase

- retrieval and FAQ grounding
- tool calling and tool execution logging
- conversation summaries and memory extraction
- human handoff workflows
- deeper observability and tracing
