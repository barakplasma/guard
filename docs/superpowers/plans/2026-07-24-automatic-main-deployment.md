# Automatic Main Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically deploy each successfully built Guard image from GitHub `main` to K3s using headless Argo CD and native ARM64 components.

**Architecture:** GitHub Actions publishes a mutable `main` image tag plus immutable `sha-*` tags. Argo CD Core reconciles the Guard Helm chart from the private GitHub repository, while Argo CD Image Updater follows the `main` tag by OCI digest and patches the live Argo `Application` through the Kubernetes API.

**Tech Stack:** K3s v1.36, Helm 3, Argo CD chart 10.1.3, Argo CD Image Updater chart 1.2.4, GitHub Actions, private GHCR, Kubernetes Secrets.

## Global Constraints

- All application and controller images must support `linux/arm64` natively.
- Do not use emulation on the VPS; QEMU is allowed on GitHub Actions build runners.
- Do not use Keel.
- Do not expose Argo CD or Image Updater through an Ingress.
- Do not commit credentials.
- Do not recreate the removed manual `cloudflare` namespace.
- Preserve `guard.526462738.xyz`, its Cloudflare Access restriction, the Guard Secrets, and PocketBase PVC data.
- Modify no more than three repository files in one task.
- Run all validation required by `AGENTS.md`.

---

## File map

- `.github/workflows/image.yml`: publish the mutable `main` deployment channel.
- `charts/guard/values.yaml`: make `main` the chart's default image tag.
- `README.md`: document published tags and automatic deployment behavior.
- `k8s/argocd/guard-application.yaml`: declare the private Git source and Guard Helm release.
- `k8s/argocd/guard-image-updater.yaml`: select the ARM64 `main` digest and map it to Helm image values.

### Task 1: Publish and consume the `main` image channel

**Files:**
- Modify: `.github/workflows/image.yml`
- Modify: `charts/guard/values.yaml`
- Modify: `README.md`

**Interfaces:**
- Consumes: successful multi-platform builds from the existing image workflow.
- Produces: `ghcr.io/barakplasma/guard-app:main` and chart value `image.tag=main`.

- [ ] **Step 1: Verify the current chart renders `latest`**

Run:

```bash
helm template guard charts/guard | /home/linuxbrew/.linuxbrew/bin/rg 'image:'
```

Expected: output contains `ghcr.io/barakplasma/guard-app:latest`.

- [ ] **Step 2: Change the default-branch image tag**

Replace the default-branch raw tag in `.github/workflows/image.yml`:

```yaml
tags: |
  type=raw,value=main,enable={{is_default_branch}}
  type=sha,prefix=sha-
  type=semver,pattern={{version}}
  type=semver,pattern={{major}}.{{minor}}
```

Change `charts/guard/values.yaml`:

```yaml
image:
  repository: ghcr.io/barakplasma/guard-app
  tag: main
  pullPolicy: Always
```

Update the README container-image paragraph to say that pushes to `main`
publish `main` and `sha-*`, and that Argo deploys digest changes behind `main`.

- [ ] **Step 3: Render and lint the chart**

Run:

```bash
helm lint charts/guard
helm template guard charts/guard | /home/linuxbrew/.linuxbrew/bin/rg 'image:'
```

Expected: lint reports `0 chart(s) failed`; rendered image ends in `:main`.

- [ ] **Step 4: Run repository validation**

Run:

```bash
npm test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: all commands exit zero.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/image.yml charts/guard/values.yaml README.md
git commit -m "Publish main deployment image"
```

### Task 2: Declare the Guard Argo application

**Files:**
- Create: `k8s/argocd/guard-application.yaml`

**Interfaces:**
- Consumes: private Git repository credentials labeled for Argo in `argocd`.
- Produces: Argo `Application/guard` targeting Helm release `guard` in namespace `guard`.

- [ ] **Step 1: Add the Application manifest**

Create `k8s/argocd/guard-application.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: guard
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/barakplasma/guard.git
    targetRevision: main
    path: charts/guard
    helm:
      releaseName: guard
  destination:
    server: https://kubernetes.default.svc
    namespace: guard
  syncPolicy:
    automated:
      enabled: true
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=false
```

- [ ] **Step 2: Validate schema and rendered source**

Run after Argo CRDs exist:

```bash
kubectl apply --dry-run=server -f k8s/argocd/guard-application.yaml
helm template guard charts/guard --namespace guard > /tmp/guard-rendered.yaml
kubectl apply --dry-run=server -f /tmp/guard-rendered.yaml
```

Expected: both dry runs succeed. Do not apply the Application yet.

- [ ] **Step 3: Commit**

```bash
git add k8s/argocd/guard-application.yaml
git commit -m "Declare Guard Argo application"
```

### Task 3: Declare ARM64 digest automation

**Files:**
- Create: `k8s/argocd/guard-image-updater.yaml`

**Interfaces:**
- Consumes: `Application/guard`, `Secret/ghcr-pull` in `argocd`, and image tag `ghcr.io/barakplasma/guard-app:main`.
- Produces: a digest-pinned `image.tag` Helm parameter for the Guard Application.

- [ ] **Step 1: Add the ImageUpdater manifest**

Create `k8s/argocd/guard-image-updater.yaml`:

```yaml
apiVersion: argocd-image-updater.argoproj.io/v1alpha1
kind: ImageUpdater
metadata:
  name: guard
  namespace: argocd
spec:
  writeBackConfig:
    method: argocd
  applicationRefs:
    - namePattern: guard
      images:
        - alias: guard
          imageName: ghcr.io/barakplasma/guard-app:main
          commonUpdateSettings:
            updateStrategy: digest
            pullSecret: pullsecret:argocd/ghcr-pull
            platforms:
              - linux/arm64
          manifestTargets:
            helm:
              name: image.repository
              tag: image.tag
```

- [ ] **Step 2: Validate against the installed CRD**

Run after Image Updater CRDs exist:

```bash
kubectl apply --dry-run=server -f k8s/argocd/guard-image-updater.yaml
```

Expected: `imageupdater.argocd-image-updater.argoproj.io/guard created (server dry run)`.

- [ ] **Step 3: Commit**

```bash
git add k8s/argocd/guard-image-updater.yaml
git commit -m "Track Guard main image digest"
```

### Task 4: Bootstrap headless Argo controllers

**Files:**
- No repository files.

**Interfaces:**
- Consumes: K3s, Helm, private GitHub access, and existing `guard/ghcr-pull`.
- Produces: healthy Argo CD Core and Image Updater controllers in `argocd`.

- [ ] **Step 1: Confirm cluster architecture and Guard baseline**

Run:

```bash
kubectl get nodes -o custom-columns=NAME:.metadata.name,ARCH:.status.nodeInfo.architecture,VERSION:.status.nodeInfo.kubeletVersion
kubectl -n guard get deployment,service,ingress,pvc,pod
helm -n guard get values guard -a
```

Expected: every schedulable node reports `arm64`; Guard has one Ready pod and
its PVC is Bound. Save the current Guard image digest for rollback:

```bash
kubectl -n guard get pod -l app=guard -o jsonpath='{.items[0].status.containerStatuses[0].imageID}{"\n"}'
```

- [ ] **Step 2: Install pinned Argo CD Core-equivalent chart components**

Run:

```bash
helm upgrade --install argocd oci://ghcr.io/argoproj/argo-helm/argo-cd \
  --version 10.1.3 \
  --namespace argocd \
  --create-namespace \
  --set server.enabled=false \
  --set dex.enabled=false \
  --set applicationSet.enabled=false \
  --set notifications.enabled=false \
  --wait \
  --timeout 10m
```

Expected: release `argocd` is deployed. Only the application controller,
repo-server, and their required cache/configuration components run; no Argo
server or ingress exists.

- [ ] **Step 3: Install pinned Image Updater**

Run:

```bash
helm upgrade --install argocd-image-updater \
  oci://ghcr.io/argoproj/argo-helm/argocd-image-updater \
  --version 1.2.4 \
  --namespace argocd \
  --wait \
  --timeout 10m
```

Expected: release is deployed in its default Kubernetes API mode and its CRD
exists:

```bash
kubectl get crd imageupdaters.argocd-image-updater.argoproj.io
```

- [ ] **Step 4: Verify native ARM64 controller images**

Run:

```bash
kubectl -n argocd get pods -o json | jq -r '.items[] | [.metadata.name,.spec.nodeName,([.status.containerStatuses[]?.imageID] | join(",")),([.status.containerStatuses[]?.ready] | all)] | @tsv'
kubectl get nodes -o json | jq -r '.items[] | [.metadata.name,.status.nodeInfo.architecture] | @tsv'
```

Expected: every Argo container is Ready on an `arm64` node. No pod reports
`exec format error` or uses emulation.

### Task 5: Create runtime credentials

**Files:**
- No repository files.

**Interfaces:**
- Consumes: an authenticated `gh` CLI token and existing `guard/ghcr-pull`.
- Produces: Argo repository credential Secret and `argocd/ghcr-pull`.

- [ ] **Step 1: Copy the GHCR pull Secret without exposing its value**

Run:

```bash
kubectl -n guard get secret ghcr-pull -o json |
  jq 'del(.metadata.namespace,.metadata.uid,.metadata.resourceVersion,.metadata.creationTimestamp,.metadata.managedFields) | .metadata.namespace="argocd"' \
  > /tmp/argocd-ghcr-pull.json
kubectl apply -f /tmp/argocd-ghcr-pull.json
```

Expected: `secret/ghcr-pull created` or `configured`.

- [ ] **Step 2: Create the private repository credential**

Use the authenticated GitHub CLI token without printing it:

```bash
kubectl -n argocd create secret generic guard-repository \
  --from-literal=type=git \
  --from-literal=url=https://github.com/barakplasma/guard.git \
  --from-literal=username=barakplasma \
  --from-literal=password="$(gh auth token)" \
  --dry-run=client -o yaml > /tmp/guard-repository.yaml
kubectl label --local -f /tmp/guard-repository.yaml \
  argocd.argoproj.io/secret-type=repository -o yaml \
  > /tmp/guard-repository-labeled.yaml
kubectl apply -f /tmp/guard-repository-labeled.yaml
```

Expected: `secret/guard-repository created` or `configured`. Command output
must not contain the token.

- [ ] **Step 3: Verify credentials by controller logs**

Run:

```bash
kubectl -n argocd rollout status deployment/argocd-repo-server --timeout=5m
kubectl -n argocd get secret guard-repository ghcr-pull
```

Expected: repo-server rollout succeeds and both Secrets exist.

### Task 6: Adopt Guard and enable image automation

**Files:**
- No repository files.

**Interfaces:**
- Consumes: committed Argo manifests and healthy controllers.
- Produces: Synced/Healthy Guard Application automatically following `main`.

- [ ] **Step 1: Publish repository changes before reconciliation**

Push the commits from Tasks 1–3 to `main`, then wait for both workflows:

```bash
git push origin main
gh run watch --repo barakplasma/guard --exit-status
```

Expected: CI and Container image workflows succeed for the pushed commit.

- [ ] **Step 2: Confirm the `main` image is pullable on ARM64**

Run:

```bash
crictl pull \
  --creds "$(kubectl -n guard get secret ghcr-pull -o json | jq -r '.data[".dockerconfigjson"] | @base64d | fromjson | .auths["ghcr.io"].auth | @base64d')" \
  ghcr.io/barakplasma/guard-app:main
```

Expected: pull succeeds and reports an image digest.

- [ ] **Step 3: Apply only the Guard Application**

Run:

```bash
kubectl apply -f k8s/argocd/guard-application.yaml
kubectl -n argocd get application guard -w
```

Expected: Guard becomes `Synced` and `Healthy`. Stop watching after both are
reported. Verify PVC and ingress survived:

```bash
kubectl -n guard get pvc,ingress
kubectl -n guard rollout status deployment/guard --timeout=5m
```

- [ ] **Step 4: Apply Image Updater**

Run:

```bash
kubectl apply -f k8s/argocd/guard-image-updater.yaml
kubectl -n argocd get imageupdater guard
kubectl -n argocd logs deployment/argocd-image-updater --since=10m
```

Expected: logs show the Guard Application and GHCR image were processed
without authentication, platform, or write-back errors.

- [ ] **Step 5: Verify digest convergence**

Run:

```bash
kubectl -n argocd get application guard -o json |
  jq '{sync:.status.sync.status,health:.status.health.status,parameters:.spec.source.helm.parameters}'
kubectl -n guard get pod -l app=guard -o json |
  jq -r '.items[] | [.metadata.name,.status.phase,.status.containerStatuses[0].ready,.status.containerStatuses[0].image,.status.containerStatuses[0].imageID] | @tsv'
```

Expected: Application is `Synced` and `Healthy`; `image.tag` contains
`main@sha256:...`; the Ready pod uses the same digest.

- [ ] **Step 6: Verify the external service**

Run:

```bash
xh --check-status https://guard.526462738.xyz/api/health
```

Expected: Cloudflare Access protects the endpoint. An unauthenticated redirect
or denial is acceptable; DNS, TLS, and tunnel routing must succeed.

### Task 7: Prove a subsequent build deploys automatically

**Files:**
- No repository files unless a real application change is intentionally made.

**Interfaces:**
- Consumes: the running automation from Task 6.
- Produces: evidence that a changed `main` digest rolls out without manual Helm or kubectl mutation.

- [ ] **Step 1: Record the current digest and Deployment revision**

```bash
kubectl -n guard get deployment guard -o json |
  jq '{revision:.metadata.annotations["deployment.kubernetes.io/revision"],image:.spec.template.spec.containers[0].image}'
```

- [ ] **Step 2: Trigger a controlled rebuild of the current `main`**

```bash
gh workflow run image.yml --repo barakplasma/guard --ref main
gh run watch --repo barakplasma/guard --exit-status
```

Expected: Container image workflow succeeds and GHCR updates `main`.

- [ ] **Step 3: Observe automatic convergence**

Run:

```bash
kubectl -n argocd logs deployment/argocd-image-updater -f
```

After Image Updater reports the new digest, run:

```bash
kubectl -n guard rollout status deployment/guard --timeout=10m
kubectl -n argocd get application guard
kubectl -n guard get pod -l app=guard -o json |
  jq -r '.items[] | [.metadata.name,.status.containerStatuses[0].imageID,.status.containerStatuses[0].restartCount] | @tsv'
```

Expected: a new pod digest is running, Guard is Synced/Healthy, and the
container has no restart loop.

### Task 8: Rollback drill and final validation

**Files:**
- No repository files.

**Interfaces:**
- Consumes: a known-good `sha-*` tag from GitHub Actions.
- Produces: validated manual rollback procedure and restored `main` automation.

- [ ] **Step 1: Suspend image automation for the drill**

```bash
kubectl -n argocd patch imageupdater guard --type=merge -p '{"spec":{"applicationRefs":[]}}'
```

Expected: the ImageUpdater no longer selects Guard.

- [ ] **Step 2: Pin a known-good immutable tag**

```bash
kubectl -n argocd patch application guard --type=merge -p '{"spec":{"source":{"helm":{"parameters":[{"name":"image.tag","value":"sha-6238943","forceString":true}]}}}}'
kubectl -n guard rollout status deployment/guard --timeout=10m
```

Expected: Guard becomes Healthy on the known-good image.

- [ ] **Step 3: Resume `main` automation**

```bash
kubectl apply -f k8s/argocd/guard-image-updater.yaml
kubectl -n argocd patch application guard --type=json -p='[{"op":"remove","path":"/spec/source/helm/parameters"}]'
kubectl -n guard rollout status deployment/guard --timeout=10m
```

Expected: Image Updater restores `main@sha256:...` and Guard becomes
Synced/Healthy.

- [ ] **Step 4: Final checks**

```bash
helm list -n argocd
kubectl -n argocd get pods,applications,imageupdaters
kubectl -n guard get deployment,pod,pvc,ingress
git status --short
```

Expected: both Argo releases are deployed, all pods are Ready, Guard is
Synced/Healthy, its PVC remains Bound, ingress remains unchanged, and the
worktree is clean.
