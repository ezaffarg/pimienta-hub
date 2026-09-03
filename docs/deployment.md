# Deployment

The application can deploy to Vercel or anywhere Docker runs. When
`BUILD_STANDALONE=true`, `next.config.ts` enables standalone output for
self-hosting.

## Production decision status

**Selected target:** Hostinger VPS → Ubuntu LTS → Docker → Coolify. The local
Docker foundation is implemented and validated, but public production, TLS,
domain, firewall, remote migrations and the real scheduler remain unvalidated.
Vercel is not the canonical production platform unless a future decision
explicitly changes this target.

## Vercel (non-canonical alternative)

1. Connect the repository to Vercel
2. Add environment variables in the dashboard
3. Deploy

For other platforms, see the [Next.js deployment docs](https://nextjs.org/docs/app/getting-started/deploying).

## Environment Variables for Production

Build-time values are limited to `BUILD_STANDALONE`, the required
`NEXT_PUBLIC_*` values and optional Sentry public metadata. If source maps are
uploaded, provide `SENTRY_AUTH_TOKEN` as a BuildKit secret; never pass it as an
image `ARG`.

Runtime-only configuration includes Clerk secrets, Supabase URL and
`service_role`, Mercado Libre client/redirect settings, the credential master
key, `INTERNAL_SCHEDULER_SECRET`, Sentry runtime settings, `PORT`, `HOSTNAME`
and `NODE_ENV`. Coolify must inject these values at runtime; only variable
names and safe examples belong in the repository.

## Docker

`Dockerfile` is the single canonical path. It pins Bun 1.3.14 for locked
installation and build, then runs the Next.js standalone output on the
repository-declared Node 22 major as the non-root `node` user.
`Dockerfile.bun` is deprecated and is not a production alternative.

Safe local build example:

```bash
docker build \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_safe_dummy \
  --build-arg NEXT_PUBLIC_APP_URL=http://localhost:3000 \
  -t pimienta-hub .
```

The runtime image contains only `public`, `.next/standalone` and
`.next/static`, binds `0.0.0.0:3000`, and runs `node server.js`. It declares a
Node-native healthcheck against `GET /api/health`; no package installation,
migration or privileged capability occurs at startup. Persistent volume:
none; Supabase remains the persistence authority. Coolify owns restart and
deployment lifecycle.

Coolify contract:

- Build Pack: Dockerfile; path: `./Dockerfile`.
- Port: `3000`; healthcheck: `GET /api/health`.
- Persistent volume: none.
- Scheduler cadence: every five minutes.
- Invocation: `POST /api/internal/maintenance/incremental-events` by loopback
  inside the application container with `Authorization: Bearer
  <INTERNAL_SCHEDULER_SECRET>`.

## Scheduler boundary — 2.20X-F3-B

The app-side boundary exists at
`POST /api/internal/maintenance/incremental-events`. It performs timing-safe
Bearer validation with the dedicated runtime secret, rejects non-empty request bodies,
does not use Clerk or caller tenant authority, and directly invokes
`runIncrementalEventMaintenance`. Responses are limited to safe status values.

The route is intended only for internal machine traffic. Production Traefik
must block it from public ingress. The local Coolify task
`Pimienta Hub Incremental Events` calls loopback every five minutes with an
empty body, 60-second task timeout and the secret inherited from runtime. The
existing 45-second application budget and ten-minute stale threshold remain
unchanged. Its first two natural executions succeeded; the second respected
the application cooldown and made no provider calls.

The future Owner status surface is initially read-only: it reports whether
incremental sync is active, the five-minute cadence, last run timestamp and
result, estimated next run, operational/error state and safe counters. Coolify
executes the scheduler; Pimienta Hub only observes it. Pause, cadence changes
and manual scheduler configuration are not Owner UI controls.

Before enabling the job, use this controlled deployment order:

1. Backup and preflight.
2. Apply the pending migrations through the authorized migration gate.
3. Verify schema, RPCs and security.
4. Deploy the application image.
5. Verify `GET /api/health`.
6. Enable the scheduler.
7. Observe the first bounded executions.

Migrations never run during application startup.

## Remaining production gates beyond the local laboratory

- Configure Coolify restart/resource/log retention and VPS firewall/backups.
- Align the final HTTPS domain with Clerk, `NEXT_PUBLIC_APP_URL`, Mercado Libre
  OAuth redirect and the items callback.
- Reproduce the validated private scheduler routing on the final production
  host; the local Coolify task is not evidence of Hostinger ingress policy.

The detailed audit is recorded in
[2.20X-F3-A](./prompts/phase-02/2.20x-f3a-coolify-docker-deployment-readiness-audit.md).
The local implementation checkpoint is recorded in
[2.20X-F3-B](./prompts/phase-02/2.20x-f3b-coolify-docker-production-implementation.md).
