# Meta Chatbot Backend

Production-oriented TypeScript monorepo scaffold for a context-driven chatbot that starts with:

- WhatsApp inbound and outbound messaging
- Instagram DM inbound and outbound messaging
- OpenAI-powered reply generation
- PostgreSQL persistence through Prisma
- Redis + BullMQ worker processing

## What is implemented

- NestJS API app in `apps/api`
- NestJS-based worker process in `apps/worker`
- Shared workspace packages for config, logging, queueing, Prisma access, adapters, and AI
- Meta webhook signature verification and challenge handling
- WhatsApp and Instagram payload normalization
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
npm run db:push
```

5. Start the API and worker in separate terminals:

```bash
npm run dev:api
npm run dev:worker
```

## Render free-tier workaround

Render free instances do not include background workers. For a low-cost test deployment, run the API and worker in a single web service:

- Build Command: `npm install && npm run build`
- Start Command: `npm run start:render`

Use a paid Render background worker when you move beyond basic testing.

## Important endpoints

- `GET /webhooks/meta/verify`
- `GET /webhooks/meta/whatsapp`
- `GET /webhooks/meta/instagram`
- `POST /webhooks/meta/whatsapp`
- `POST /webhooks/meta/instagram`
- `GET /internal/health`

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
