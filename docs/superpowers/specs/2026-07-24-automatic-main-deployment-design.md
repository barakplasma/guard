# Automatic Main Deployment Design

## Goal

Automatically deploy each successfully published Guard image from GitHub
`main` to the local K3s cluster, using only native `linux/arm64` components.
Keep the deployment headless and avoid automated commits to the repository.

## Non-goals

- No Argo CD web UI, public ingress, Dex, or external Argo API.
- No Keel.
- No Git write-back for image updates.
- No emulation on the VPS. QEMU is allowed on GitHub Actions build runners.
- No change to Guard application behavior or PocketBase data.

## Architecture

Install Argo CD Core in an isolated `argocd` namespace. Core reconciles a
single Argo `Application` whose source is the `charts/guard` Helm chart on the
`main` branch of `github.com/barakplasma/guard`.

Install Argo CD Image Updater beside Core. It uses Kubernetes API mode and an
`ImageUpdater` resource rather than the Argo API server. It watches the private
GHCR image `ghcr.io/barakplasma/guard-app:main` with:

- update strategy `digest`;
- allowed platform `linux/arm64`;
- Argo write-back, which patches the live `Application` resource;
- the existing GHCR pull credentials copied into the `argocd` namespace.

Argo CD then applies the updated Helm image parameter to the Guard Deployment.
The deployed image is represented by the readable `main` tag plus its immutable
OCI digest.

## Image publication

The image workflow publishes:

- `main`, a mutable deployment-channel tag, only for the default branch;
- `sha-<short-sha>`, an immutable tag retained for diagnosis and rollback;
- existing semantic-version tags for releases.

The workflow continues to build both `linux/amd64` and `linux/arm64`. GitHub
publishes the `main` tag only after the multi-architecture build succeeds, so a
failed build cannot alter the deployment channel.

The Guard chart defaults to repository `ghcr.io/barakplasma/guard-app`, tag
`main`, and `imagePullPolicy: Always`.

## Reconciliation and ownership

Argo CD owns the Guard Helm release after migration. Its automated sync policy
enables self-heal and pruning. The existing PVC and Secrets remain in place and
are not pruned during adoption.

The initial Argo sync must use the currently deployed settings, including:

- `Recreate` deployment strategy;
- existing Guard superuser Secret;
- existing GHCR pull Secret;
- existing persistent volume data;
- Cloudflare tunnel ingress at `guard.526462738.xyz`.

The Argo components remain ClusterIP-only and require no Cloudflare ingress.
Operational inspection uses `kubectl`.

## Data flow

1. A commit lands on GitHub `main`.
2. GitHub Actions tests and builds the multi-architecture image.
3. GHCR atomically points `main` at the newly published manifest digest.
4. Image Updater polls GHCR and observes the changed digest for `linux/arm64`.
5. Image Updater patches the Guard Argo `Application` image parameter.
6. Argo CD reconciles the Helm release.
7. K3s pulls the ARM64 image and replaces the Guard pod.
8. Readiness and liveness probes determine rollout health.

## Credentials and security

The GitHub repository and GHCR package are private. Argo receives narrowly
scoped Kubernetes Secrets for:

- read-only repository access;
- read-only GHCR access.

Secrets are created directly in the cluster and never committed. Existing
credentials should be reused or copied when they already have the required
scope. Argo has no public endpoint.

## Failure behavior

- Failed CI or image builds leave the previous `main` digest deployed.
- Registry or GitHub outages leave the current healthy revision running; the
  controllers retry reconciliation.
- A failed Guard rollout remains visible through Argo and Kubernetes status.
  The existing `Recreate` strategy means there may be downtime when a broken
  image fails readiness.
- Rollback is performed by setting the Argo image override to a known
  `sha-<short-sha>` image or digest. Returning to `main` resumes automation.
- Argo installation failure does not remove or replace the existing Guard
  release. Adoption happens only after controller readiness is verified.

## Implementation boundaries

To respect the repository's three-file change limit, implementation is split
into small tasks:

1. Image channel: update the image workflow and chart defaults.
2. Argo definitions: add the Guard `Application` and `ImageUpdater`
   configuration in no more than three files.
3. Cluster bootstrap: install pinned ARM64-capable Argo CD Core and Image
   Updater charts, create runtime Secrets, and apply the definitions.
4. Migration and verification: confirm Argo adoption, force a controlled image
   update, and verify the running digest.

## Verification

- Inspect all Argo pod `imageID` values and node architecture; no emulation.
- Confirm all Argo pods are Ready.
- Confirm the Guard Application is Healthy and Synced.
- Confirm Image Updater authenticates to private GHCR without errors.
- Confirm the running Guard pod uses `ghcr.io/barakplasma/guard-app:main` at the
  same digest published by GHCR.
- Push or manually dispatch a controlled `main` image build and observe a
  complete automatic rollout.
- Confirm `guard.526462738.xyz` remains reachable through Cloudflare Access.
- Run repository validation required by `AGENTS.md`.
