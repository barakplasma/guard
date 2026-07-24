# Guard repository notes

## Current integration branch

- PR 7 (`agent/position-staffing`) is the combined source of truth.
- PR 6 was closed as superseded after its selected changes were merged into PR 7.
- Preserve PR 7's dated vacations and signup approval model when resolving older branch differences.
- Use PR 6's `headcount`/`guards` position model, preference-with-fallback staffing, continuous time-restricted shifts, rotation, sleep report, and invariant tests.

## User and vacation semantics

- `approved = false` and `active = false` means Pending.
- `approved = true` and `active = true` means Active.
- `approved = true` and `active = false` means Disabled.
- Vacation is independent of account access and uses `vacation_start`/`vacation_end`.
- Commanders may manage approval, active state, vacation dates, and minimum sleep.
- Only PocketBase superusers may change roles.

## PocketBase hooks and Zod

- PocketBase JSVM cannot import npm packages directly.
- Author the temp-login hook template in `pb_hooks_src/temp_login.pb.js`.
- Run `npm run build:hooks` to validate its configuration with Zod and generate
  the ignored, closure-free JSVM file `pb_hooks/temp_login.pb.js`.
- Do not edit or commit the generated hook.
- PocketBase request callbacks run in isolated runtimes, so imported npm state
  cannot be captured by a callback. Keep runtime checks closure-free.
- `npm test`, `scripts/setup.sh`, and the Docker build generate the hook before PocketBase starts.
- Consult `https://github.com/rgfx/pocketbase-llms` and current official PocketBase docs for JSVM behavior, then verify against the pinned PocketBase binary.

## Temporary roster link

- The unauthenticated route is `#/temp-login/{code}`.
- Its four-digit code is stored in the superuser-only `app_settings` singleton.
- The code rotates daily at 12:00 in `Asia/Jerusalem`; a superuser may also rotate it manually in PocketBase Admin.
- The custom endpoint must return only roster-safe shift, guard name/id, and position name/id fields.

## Validation and delivery

- Run `npm test`.
- Run `npm --prefix frontend run lint`.
- Run `npm --prefix frontend run build`.
- Build the Docker image before publishing changes that affect deployment.
- `.github/workflows/image.yml` builds PR images and publishes multi-architecture GHCR images from `main` and version tags.
- Never commit any `node_modules` directory.
