# Linux worktree development

`tools/twenty-dev` prepares an isolated development environment for the current Git worktree. It needs Linux, Python 3, Docker with Compose, and a full Node 24.5 or newer distribution within Node 24, including npm and npx. It uses the checked-in Yarn 4.13 release and preserves the repository's immutable install and dependency policies.

## Install and start

```sh
python3 tools/twenty-dev --install
~/.local/bin/twenty-dev setup
```

Installation atomically copies the self-contained helper to `~/.local/bin/twenty-dev`. The installed copy also works in compatible branches that do not yet contain `tools/twenty-dev`. Run it from the selected worktree. Reinstall after updating the helper.

Setup blocks until startup verification finishes, then leaves the API, worker and frontend running under owned process supervisors. It installs dependencies, builds native Nx dependencies, provisions PostgreSQL 16 and Redis 7, initializes a new database and seeds the demo workspace once. A partially completed initialization is reported for explicit repair or reset; startup never silently deletes it.

The API uses the repository's Nest watch build. The worker watches its compiled entrypoint and imports after the API becomes ready, so the API compiler is the sole writer of server output. The frontend uses the repository's Vite development server. Source changes that require schema changes are applied with `migrate` or on the next `start` after the source fingerprint changes.

The printed frontend URL uses localhost. For a remote host, forward the printed frontend and API ports to matching local ports with SSH. PostgreSQL, Redis and the frontend bind to loopback. The API retains the repository's native listener behavior.

Use “Continue with Email” and the seeded `tim@apple.dev` account with password `tim@apple.dev`.

## Lifecycle commands

| Command | Behavior |
| --- | --- |
| `setup` or `start` | Prepare and start this worktree, apply pending migrations after source changes, and verify readiness. |
| `status` | Show worktree identity, ports, database phase, infrastructure and HTTP checks, and process liveness. |
| `stop` | Stop owned application groups and containers, retaining volumes and checkout data. |
| `migrate` | Stop applications, build current source, run forward instance commands, then restart. |
| `reset` | Delete this environment's containers and database/Redis volumes, then initialize and start it again. |
| `remove` | Delete this environment's containers, volumes and state. Retain the checkout and installed dependencies. |
| `start --reallocate-ports` | After `stop`, replace this environment's container port bindings while retaining its volumes. |

A host allocation lock reserves all four ports against other worktree manifests, including stopped environments. Ports normally remain stable. An occupied port is an error, not permission to stop another process. Port reallocation must be requested explicitly while stopped.

Environment identity is a hash of the canonical worktree path. Private manifests, generated Compose configuration and logs live under `~/.local/state/twenty/<identity>`. Do not copy manifests between worktrees. A per-environment lock prevents overlapping lifecycle operations. Process shutdown requires matching Linux PID, boot identity and start time. Docker mutations require exact ownership labels and expected resources.

Each worktree retains its own dependencies, generated outputs, Nx state, storage and package dotenv files. The helper preserves unrelated dotenv settings while writing the isolated ports and service URLs. It writes these values to package files because the server's raw datasource loads dotenv with override enabled.

## Checks and focused tests

```sh
~/.local/bin/twenty-dev check front
~/.local/bin/twenty-dev check server
~/.local/bin/twenty-dev check shared
~/.local/bin/twenty-dev test front packages/twenty-front/path/to/example.test.ts
~/.local/bin/twenty-dev test server packages/twenty-server/path/to/example.spec.ts
~/.local/bin/twenty-dev test ui path/to/example.test.tsx
```

Frontend and server checks invoke the local `tsgo -p tsconfig.json --noEmit` directly. Shared checks rebuild `twenty-shared` without Nx cache. Frontend/server tests use Jest with explicit file paths. UI tests use the `unit` Vitest project. The helper prepares dependencies before checks. If rebuilding changed source requires stopping a running development stack, it restores the stack afterward, including after a failed check. A restoration failure is reported explicitly.

These focused checks do not replace the repository's broader integration, browser, translation and CI checks. They do not run reset-based integration tests.

## T3 actions

The root `t3.json` provides worktree actions. Setup is automatic and blocking (`async: false`). `tools/t3-actions.json` contains the same definitions with stable IDs for server-side registration. Both invoke the installed helper, so install it on each execution host before enabling automatic setup. Focused test commands stay in the CLI because they require explicit file arguments.

## Diagnostics and verification

Private phase-specific command logs and application logs are in the printed state directory. Complete command logs remain private with mode 0600. Errors include recent redacted output; redaction does not remove diagnostics from the private log files. Fix the reported phase and retry. If initialization or seeding was interrupted, inspect the database before deciding whether explicit reset is appropriate.

Readiness verifies SQL and the demo workspace separately from API `/healthz`, which only establishes API liveness. It also checks Redis PONG, frontend HTML and demo login through the frontend proxy. It submits the existing `MessagingCleanCacheJob` with random probe-only IDs, then checks both job completion and deletion of its cache marker. This exercises the worker handler without sending mail or changing user data. Status reports process liveness separately from this startup queue proof.

Run the helper's focused tests without installing JavaScript dependencies:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tools -p test_twenty_dev.py -v
```
