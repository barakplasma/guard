#!/usr/bin/env bash
# Tear down the retired PocketBase guard deployment from the cluster.
#
# Triggered automatically by .github/workflows/teardown.yml when the static
# planner PR merges into main. Safe to run repeatedly: every delete uses
# --ignore-not-found, so a second run is a no-op.
#
# What it removes:
#   - namespace/guard            -> cascades Deployment, Service, Ingress,
#                                   the local-path PVC (and its PV, reclaim=Delete),
#                                   and the guard-scoped secrets
#   - application/guard (argocd) -> the ArgoCD app that watched charts/guard
#   - imageupdater/guard (argocd)-> the argocd-image-updater entry
#
# What it intentionally leaves:
#   - secret/ghcr-pull in argocd (shared pull secret, not guard-specific)
#   - every other namespace (argocd, gatus, ...)
#
# Usage:
#   scripts/teardown-guard.sh            # interactive, prompts before deleting
#   scripts/teardown-guard.sh --yes      # non-interactive (CI)
#   KUBECONFIG=/path/kc scripts/teardown-guard.sh --yes
set -euo pipefail

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl not found on PATH" >&2
  exit 1
fi

# Refuse to run blind: confirm we can see the cluster and that the guard
# deployment actually exists there. Deleting the wrong cluster is irreversible.
if ! kubectl get ns argocd >/dev/null 2>&1; then
  echo "This script expects the home k3s cluster (no 'argocd' namespace found)." >&2
  echo "Refusing to delete anything. Check KUBECONFIG." >&2
  exit 1
fi

echo "Cluster context: $(kubectl config current-context 2>/dev/null || echo '(unknown)')"
echo
echo "Resources currently present:"
have_guard_ns=0
if kubectl get ns guard >/dev/null 2>&1; then
  have_guard_ns=1
  kubectl get all,pvc,ingress,secrets -n guard 2>&1 | sed 's/^/    /'
else
  echo "    namespace/guard: already gone"
fi
have_app=0
if kubectl get application guard -n argocd >/dev/null 2>&1; then
  have_app=1
  echo "    application/guard (argocd): present"
else
  echo "    application/guard (argocd): already gone"
fi
have_iu=0
if kubectl get imageupdater guard -n argocd >/dev/null 2>&1; then
  have_iu=1
  echo "    imageupdater/guard (argocd): present"
else
  echo "    imageupdater/guard (argocd): already gone"
fi

if [ "$have_guard_ns" = 0 ] && [ "$have_app" = 0 ] && [ "$have_iu" = 0 ]; then
  echo
  echo "Nothing to do: guard is already fully torn down."
  exit 0
fi

echo
if [ "$ASSUME_YES" = 0 ]; then
  read -r -p "Delete the above? Type 'yes' to confirm: " reply
  if [ "$reply" != "yes" ]; then
    echo "Aborted, nothing was changed."
    exit 1
  fi
fi

echo
echo "Deleting namespace/guard (cascades all resources inside it)..."
kubectl delete ns guard --ignore-not-found --wait=true

echo "Deleting application/guard in argocd..."
kubectl delete application guard -n argocd --ignore-not-found --wait=true

echo "Deleting imageupdater/guard in argocd..."
kubectl delete imageupdater guard -n argocd --ignore-not-found --wait=true

echo
echo "Verifying k3s is clean..."
fail=0
kubectl get ns guard >/dev/null 2>&1 && { echo "  FAIL: namespace/guard still exists"; fail=1; } || echo "  ok: namespace/guard gone"
kubectl get application guard -n argocd >/dev/null 2>&1 && { echo "  FAIL: application/guard still exists"; fail=1; } || echo "  ok: application/guard gone"
kubectl get imageupdater guard -n argocd >/dev/null 2>&1 && { echo "  FAIL: imageupdater/guard still exists"; fail=1; } || echo "  ok: imageupdater/guard gone"
kubectl get pvc guard-pb-data -n guard >/dev/null 2>&1 && { echo "  FAIL: guard PVC still exists"; fail=1; } || echo "  ok: guard PVC gone"

if [ "$fail" = 1 ]; then
  echo
  echo "Teardown incomplete: some resources remain. Re-run or delete manually." >&2
  exit 1
fi

echo
echo "Done. The guard namespace is gone; k3s and all other namespaces are untouched."
