set -e

APP_DIR="/var/www/vhosts/lacoccina.com.br/httpdocs/backend"
DATA_DIR="/var/data/lacoccina"
UPLOAD_DIR="$DATA_DIR/uploads"

# 1. Garantir que os diretórios persistem fora do projeto
mkdir -p "$DATA_DIR" "$UPLOAD_DIR"
chown -R $(whoami) "$DATA_DIR"

# 2. Apontar DB_PATH e UPLOAD_DIR para fora do projeto
sed -i "s|DB_PATH=.*|DB_PATH=$DATA_DIR/lacoccina.db|" "$APP_DIR/config/.env"
if grep -q "^UPLOAD_DIR=" "$APP_DIR/config/.env"; then
  sed -i "s|UPLOAD_DIR=.*|UPLOAD_DIR=$UPLOAD_DIR|" "$APP_DIR/config/.env"
else
  printf '\nUPLOAD_DIR=%s\n' "$UPLOAD_DIR" >> "$APP_DIR/config/.env"
fi

# 3. Instalar dependências de produção
cd "$APP_DIR"
npm install --omit=dev

# 4. Aplicar migrations
npm run migrate

# 5. Verificar se servidor responde
sleep 2
curl -sf http://localhost:3001/api/health && echo "✅ Deploy OK" || echo "⚠️ Servidor ainda não respondeu"
