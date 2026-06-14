# Como publicar o La Coccina (admin → todo mundo vê na hora)

## Como funciona

Hoje o site no seu PC fala só com `localhost` — só você vê as mudanças.

Para **todo mundo** ver o que você faz no admin:

1. **Um servidor na internet** roda o Node.js + MySQL (24h ligado).
2. **Um banco de dados** único guarda os pratos.
3. **Loja + admin** apontam para esse mesmo servidor.

Quando você ativa um prato, adiciona foto ou fecha o restaurante no admin → salva no **banco do servidor** → **todos os clientes** recebem a atualização (tempo real).

```
[Você no admin]  →  API na nuvem  →  MySQL
                         ↑
              [Clientes no site] (mesma API)
```

---

## Opção recomendada: tudo no mesmo servidor (VPS)

Exemplos: Hostinger VPS, Contabo, DigitalOcean, AWS Lightsail.

### 1. Enviar os arquivos

Envie a pasta do projeto (sem `node_modules`):

- `backend/` (com `config/.env` configurado)
- `Frontend/`

No servidor, rode:

```bash
cd backend
npm install
```

### 2. Configurar `backend/config/.env`

```env
NODE_ENV=production
SERVE_FRONTEND=true
PORT=3001

PUBLIC_URL=https://www.SEUDOMINIO.com.br

DB_HOST=localhost
DB_USER=seu_usuario_mysql
DB_PASSWORD=senha_forte
DB_NAME=lacoccina

ADMIN_USERNAME=seu_login
ADMIN_PASSWORD=hash_bcrypt_aqui
SESSION_SECRET=string_aleatoria_longa_32_caracteres

CORS_ORIGINS=https://www.SEUDOMINIO.com.br,null
```

Gere a senha admin:

```bash
npm run hash-password -- "sua_senha"
```

### 3. MySQL no servidor

- Crie o banco `lacoccina`.
- Importe suas tabelas `products` e `orders` (export do MySQL do seu PC).

### 4. Subir o servidor (sempre ligado)

```bash
cd backend
npm start
```

Teste: `https://SEUDOMINIO.com.br/index.html`  
Admin: `https://SEUDOMINIO.com.br/admin/login.html`

Use **PM2** para não cair quando fechar o terminal:

```bash
npm install -g pm2
pm2 start server.js --name la-coccina
pm2 save
pm2 startup
```

### 5. Domínio e HTTPS

- Aponte o domínio para o IP do servidor.
- Use **Nginx** na frente (porta 80/443) repassando para `localhost:3001`.
- Certificado **Let's Encrypt** (grátis) para HTTPS.

O arquivo `Frontend/assets/js/config.js` deve ficar assim (já está por padrão):

```js
window.__LA_COCCINA_API__ = '';
```

Vazio = API no **mesmo domínio** do site (ideal).

---

## Testar no PC antes de publicar

No PowerShell, pasta `backend`:

```powershell
$env:NODE_ENV="production"
$env:SERVE_FRONTEND="true"
node server.js
```

Abra: `http://localhost:3001/index.html`  
Admin: `http://localhost:3001/admin/login.html`

Se funcionar aí, funciona online da mesma forma.

---

## Plesk com Git + httpdocs

Se o **Plesk baixa o repositório em uma pasta Git separada**, a forma mais segura é publicar o site com um **worktree apontando para o `httpdocs`**.

### Estrutura sugerida no servidor

```bash
/var/www/vhosts/SEUDOMINIO/
  git/La-coccina        # repositório Git que o Plesk atualiza
  httpdocs              # raiz pública do site
```

### Criar o worktree na primeira vez

No servidor:

```bash
cd /var/www/vhosts/SEUDOMINIO/git/La-coccina
chmod +x deploy-httpdocs-worktree.sh
./deploy-httpdocs-worktree.sh /var/www/vhosts/SEUDOMINIO/httpdocs
```

Isso cria um worktree com a branch `deploy/httpdocs` e coloca no `httpdocs` exatamente o conteúdo de `origin/main`.

### Atualizar após cada push para `main`

Sempre que o Plesk baixar a `main` nova na pasta Git:

```bash
cd /var/www/vhosts/SEUDOMINIO/git/La-coccina
./deploy-httpdocs-worktree.sh /var/www/vhosts/SEUDOMINIO/httpdocs
```

O script:

- faz `fetch` da `origin/main`
- cria o worktree se ainda não existir
- faz `merge --ff-only` no `httpdocs`

### Quando usar esse modelo

- quando o **Git do Plesk não publica direto em `httpdocs`**
- quando você quer manter o repositório Git separado da pasta pública
- quando o deploy deve seguir exatamente o que está em `main`

### Importante

- o `backend/config/.env` de produção precisa existir no servidor
- se alterar variáveis como `TOOL_PANEL_PASSWORD`, reinicie o Node/PM2
- se o backend roda fora do `httpdocs`, ajuste o processo para apontar para a pasta correta do projeto

---

## O que NÃO fazer

- Não publique só a pasta `Frontend` em hospedagem de HTML — o admin não terá API.
- Não deixe `127.0.0.1:3001` no `config.js` em produção.
- Não suba o arquivo `.env` para o GitHub.

---

## Checklist rápido (hoje)

- [ ] Servidor/VPS com Node 18+ e MySQL
- [ ] `.env` de produção preenchido
- [ ] Banco `lacoccina` importado
- [ ] `npm start` ou PM2 rodando
- [ ] Domínio + HTTPS
- [ ] Testar loja e admin no celular (4G, não Wi‑Fi do PC)

Dúvidas sobre Hostinger ou outro provedor: diga qual usa que adapto o passo a passo.
