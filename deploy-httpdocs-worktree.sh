#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   ./deploy-httpdocs-worktree.sh [diretorio-httpdocs] [branch]
#
# Exemplo no Plesk:
#   cd /var/www/vhosts/seu-dominio.com/git/La-coccina
#   ./deploy-httpdocs-worktree.sh /var/www/vhosts/seu-dominio.com/httpdocs

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HTTPDOCS_DIR="${1:-$(cd "$REPO_DIR/.." && pwd)/httpdocs}"
DEPLOY_BRANCH="${2:-deploy/httpdocs}"

echo "==> Repo:      $REPO_DIR"
echo "==> Httpdocs:  $HTTPDOCS_DIR"
echo "==> Branch:    $DEPLOY_BRANCH"

cd "$REPO_DIR"
git fetch origin main

if git worktree list --porcelain | grep -Fq "worktree $HTTPDOCS_DIR"; then
  echo "==> Worktree ja existe. Atualizando..."
else
  echo "==> Criando worktree para httpdocs..."
  git worktree add -B "$DEPLOY_BRANCH" "$HTTPDOCS_DIR" origin/main
fi

cd "$HTTPDOCS_DIR"
git fetch origin main
git merge --ff-only origin/main

echo
echo "Worktree pronto em: $HTTPDOCS_DIR"
echo "Conteudo alinhado com: origin/main"
