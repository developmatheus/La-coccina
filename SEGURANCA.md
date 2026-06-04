# Segurança — La Coccina

## Configuração obrigatória (produção)

1. Copie `backend/config/.env.example` para `backend/config/.env`
2. Gere hash da senha admin:
   ```bash
   cd backend
   npm run hash-password -- "sua_senha_forte"
   ```
3. Cole o hash em `ADMIN_PASSWORD` no `.env`
4. Defina `SESSION_SECRET` com pelo menos 32 caracteres aleatórios
5. Nunca envie o arquivo `.env` para o Git

## O que o servidor já protege

- **Helmet** — cabeçalhos HTTP seguros
- **CORS** — só origens permitidas no `.env`
- **Rate limit** — limite de requisições e tentativas de login
- **Token admin** — sessão de 4 horas, assinada com HMAC
- **Rotas admin** — produtos, upload e lista completa exigem login
- **Upload** — só imagens (JPEG, PNG, WebP, GIF), máx. 5 MB
- **SQL** — prepared statements (anti-injection)
- **Validação** — nome, preço, categoria e pedidos sanitizados

## Frontend

- **CSP** — Content Security Policy nas páginas
- **escapeHtml** — nomes de pratos escapados contra XSS
- **Pedido** — bloqueio após envio no WhatsApp (sessão)

## Checklist antes de publicar na internet

- [ ] Senha admin com bcrypt no `.env`
- [ ] `SESSION_SECRET` forte e única
- [ ] `NODE_ENV=production`
- [ ] HTTPS no domínio (certificado SSL)
- [ ] MySQL com usuário só para este banco (não usar `root` em produção)
- [ ] Firewall liberando só portas necessárias
