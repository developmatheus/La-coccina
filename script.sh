#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Uso:
  ADMIN_PASS='admin123' ./script.sh --domain lacoccina.com.br

Exemplo completo:
  ./script.sh \
    --domain lacoccina.com.br \
    --repo-dir /var/www/vhosts/lacoccina.com.br/git/La-coccina \
    --httpdocs-dir /var/www/vhosts/lacoccina.com.br/httpdocs \
    --admin-user admin \
    --admin-pass 'admin123'

Opções:
  --domain <dominio>              Domínio principal. Ex.: lacoccina.com.br
  --repo-dir <diretorio>          Pasta do repositório Git no servidor
  --httpdocs-dir <diretorio>      Pasta pública httpdocs
  --data-dir <diretorio>          Pasta persistente de dados (default: /var/data/lacoccina)
  --admin-user <usuario>          Usuário admin (default: admin)
  --admin-pass <senha>            Senha admin em texto puro
  --public-url <url>              URL pública (default: https://<domain>)
  --cors-origins <lista>          Valor de CORS_ORIGINS (default: <public-url>,null)
  --session-secret <valor>        SESSION_SECRET. Se omitido, gera se estiver ausente/fraco
  --pm2-name <nome>               Nome do processo PM2 (default: la-coccina)
  --restart-mode <pm2|none>       Modo de restart (default: pm2)
  --restart-cmd <comando>         Comando customizado de restart
  --deploy-branch <branch>        Branch do worktree de deploy (default: deploy/httpdocs)
  --skip-deploy                   Não roda o deploy do httpdocs
  --help                          Exibe esta ajuda

Observação:
  Você também pode passar a senha via variável de ambiente:
  ADMIN_PASS='admin123' ./script.sh --domain lacoccina.com.br
EOF
}

log() {
  printf '\n==> %s\n' "$1"
}

fail() {
  printf '\n[ERRO] %s\n' "$1" >&2
  exit 1
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[&|]/\\&/g'
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped
  escaped="$(escape_sed_replacement "$value")"

  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

infer_vhost_root() {
  local repo_dir="$1"
  if [ -d "$repo_dir/../../httpdocs" ]; then
    cd "$repo_dir/../.." && pwd
    return
  fi
  if [ -d "$repo_dir/../httpdocs" ]; then
    cd "$repo_dir/.." && pwd
    return
  fi
  return 1
}

wait_for_health() {
  local url="$1"
  local attempts="${2:-15}"
  local sleep_seconds="${3:-2}"
  local i

  for i in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
  done

  return 1
}

deploy_httpdocs() {
  local repo_dir="$1"
  local httpdocs_dir="$2"
  local deploy_branch="${3:-deploy/httpdocs}"

  log "Atualizando repositório base"
  cd "$repo_dir"
  git fetch origin main

  if git worktree list --porcelain | grep -Fq "worktree $httpdocs_dir"; then
    log "Worktree do httpdocs já existe. Atualizando"
  else
    log "Criando worktree do httpdocs"
    git worktree add -B "$deploy_branch" "$httpdocs_dir" origin/main
  fi

  cd "$httpdocs_dir"
  git fetch origin main
  git merge --ff-only origin/main
}

DOMAIN=""
REPO_DIR=""
HTTPDOCS_DIR=""
DATA_DIR="/var/data/lacoccina"
ADMIN_USER="admin"
ADMIN_PASS="${ADMIN_PASS:-}"
PUBLIC_URL=""
CORS_ORIGINS=""
SESSION_SECRET_INPUT=""
PM2_NAME="la-coccina"
RESTART_MODE="pm2"
RESTART_CMD=""
SKIP_DEPLOY="false"
DEPLOY_BRANCH="deploy/httpdocs"

while [ $# -gt 0 ]; do
  case "$1" in
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --repo-dir)
      REPO_DIR="${2:-}"
      shift 2
      ;;
    --httpdocs-dir)
      HTTPDOCS_DIR="${2:-}"
      shift 2
      ;;
    --data-dir)
      DATA_DIR="${2:-}"
      shift 2
      ;;
    --admin-user)
      ADMIN_USER="${2:-}"
      shift 2
      ;;
    --admin-pass)
      ADMIN_PASS="${2:-}"
      shift 2
      ;;
    --public-url)
      PUBLIC_URL="${2:-}"
      shift 2
      ;;
    --cors-origins)
      CORS_ORIGINS="${2:-}"
      shift 2
      ;;
    --session-secret)
      SESSION_SECRET_INPUT="${2:-}"
      shift 2
      ;;
    --pm2-name)
      PM2_NAME="${2:-}"
      shift 2
      ;;
    --restart-mode)
      RESTART_MODE="${2:-}"
      shift 2
      ;;
    --restart-cmd)
      RESTART_CMD="${2:-}"
      shift 2
      ;;
    --deploy-branch)
      DEPLOY_BRANCH="${2:-}"
      shift 2
      ;;
    --skip-deploy)
      SKIP_DEPLOY="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      fail "Opção desconhecida: $1"
      ;;
  esac
done

if [ -z "$REPO_DIR" ]; then
  REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -z "$HTTPDOCS_DIR" ]; then
  if VHOST_ROOT="$(infer_vhost_root "$REPO_DIR")"; then
    HTTPDOCS_DIR="$VHOST_ROOT/httpdocs"
  elif [ -n "$DOMAIN" ]; then
    HTTPDOCS_DIR="/var/www/vhosts/$DOMAIN/httpdocs"
  else
    fail "Não foi possível inferir o httpdocs. Use --httpdocs-dir."
  fi
fi

if [ -z "$DOMAIN" ]; then
  DOMAIN="$(basename "$(dirname "$HTTPDOCS_DIR")")"
fi

if [ -z "$PUBLIC_URL" ]; then
  PUBLIC_URL="https://$DOMAIN"
fi

if [ -z "$CORS_ORIGINS" ]; then
  CORS_ORIGINS="$PUBLIC_URL,null"
fi

[ -d "$REPO_DIR" ] || fail "Repo não encontrado: $REPO_DIR"
[ -d "$HTTPDOCS_DIR" ] || fail "httpdocs não encontrado: $HTTPDOCS_DIR"
[ -n "$ADMIN_PASS" ] || fail "Informe a senha admin via --admin-pass ou ADMIN_PASS."

APP_DIR="$HTTPDOCS_DIR/backend"
ENV_FILE="$APP_DIR/config/.env"
UPLOAD_DIR="$DATA_DIR/uploads"
HEALTH_URL="http://localhost:3001/api/health"

log "Repo: $REPO_DIR"
log "httpdocs: $HTTPDOCS_DIR"
log "backend: $APP_DIR"
log "domínio: $DOMAIN"

if [ "$SKIP_DEPLOY" != "true" ]; then
  log "Alinhando httpdocs com origin/main"
  deploy_httpdocs "$REPO_DIR" "$HTTPDOCS_DIR" "$DEPLOY_BRANCH"
fi

[ -d "$APP_DIR" ] || fail "Backend não encontrado após deploy: $APP_DIR"

log "Garantindo diretórios persistentes"
mkdir -p "$DATA_DIR" "$UPLOAD_DIR"
chown -R "$(id -un)" "$DATA_DIR" >/dev/null 2>&1 || true

if [ ! -f "$ENV_FILE" ]; then
  [ -f "$APP_DIR/config/.env.example" ] || fail ".env e .env.example ausentes em $APP_DIR/config"
  cp "$APP_DIR/config/.env.example" "$ENV_FILE"
fi

cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"

log "Instalando dependências"
cd "$APP_DIR"
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

log "Gerando hash bcrypt do ADMIN_PASSWORD"
ADMIN_HASH="$(node ./scripts/hash-password.js "$ADMIN_PASS" | awk -F= '/^ADMIN_PASSWORD=/{print $2}')"
[ -n "$ADMIN_HASH" ] || fail "Falha ao gerar hash bcrypt do ADMIN_PASSWORD."

if [ -n "$SESSION_SECRET_INPUT" ]; then
  SESSION_SECRET_VALUE="$SESSION_SECRET_INPUT"
else
  CURRENT_SECRET="$(grep '^SESSION_SECRET=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
  if [ "${#CURRENT_SECRET}" -ge 32 ]; then
    SESSION_SECRET_VALUE="$CURRENT_SECRET"
  else
    SESSION_SECRET_VALUE="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  fi
fi

log "Atualizando $ENV_FILE"
set_env_value "$ENV_FILE" "NODE_ENV" "production"
set_env_value "$ENV_FILE" "SERVE_FRONTEND" "true"
set_env_value "$ENV_FILE" "PUBLIC_URL" "$PUBLIC_URL"
set_env_value "$ENV_FILE" "CORS_ORIGINS" "$CORS_ORIGINS"
set_env_value "$ENV_FILE" "DB_PATH" "$DATA_DIR/lacoccina.db"
set_env_value "$ENV_FILE" "UPLOAD_DIR" "$UPLOAD_DIR"
set_env_value "$ENV_FILE" "ADMIN_USERNAME" "$ADMIN_USER"
set_env_value "$ENV_FILE" "ADMIN_PASSWORD" "$ADMIN_HASH"
set_env_value "$ENV_FILE" "SESSION_SECRET" "$SESSION_SECRET_VALUE"

log "Aplicando migrations"
npm run migrate

if [ -n "$RESTART_CMD" ]; then
  log "Executando restart customizado"
  bash -lc "$RESTART_CMD"
elif [ "$RESTART_MODE" = "pm2" ]; then
  command -v pm2 >/dev/null 2>&1 || fail "PM2 não encontrado. Use --restart-cmd ou instale o PM2."
  log "Reiniciando processo PM2: $PM2_NAME"
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_NAME"
  else
    pm2 start server.js --name "$PM2_NAME" --cwd "$APP_DIR"
  fi
  pm2 save >/dev/null 2>&1 || true
elif [ "$RESTART_MODE" = "none" ]; then
  log "Restart pulado por --restart-mode none"
else
  fail "Modo de restart inválido: $RESTART_MODE"
fi

log "Validando saúde da API"
if wait_for_health "$HEALTH_URL" 20 2; then
  curl -fsS "$HEALTH_URL"
  printf '\n\n✅ Deploy concluído com sucesso.\n'
else
  fail "A API não respondeu em $HEALTH_URL após o restart."
fi
