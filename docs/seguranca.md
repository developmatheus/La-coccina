# Segurança — La Coccina

## Configuração de produção

1. Copie `backend/config/.env.example` para `backend/config/.env`.
2. Gere o hash da senha administrativa:
   ```bash
   cd backend
   npm run hash-password -- "sua_senha_forte"
   ```
3. Defina `ADMIN_USERNAME`, `ADMIN_PASSWORD` (hash bcrypt) e `SESSION_SECRET` com ao menos 32 caracteres aleatórios.
4. Configure `NODE_ENV=production` e permita apenas as origens necessárias em `CORS_ORIGINS`.
5. Nunca envie `.env`, bancos de dados ou uploads privados ao Git.

## Proteções implementadas

- Helmet configura cabeçalhos HTTP.
- CORS e limite de requisições são configurados no servidor.
- A sessão administrativa usa token HMAC com expiração.
- Rotas administrativas exigem autenticação.
- Uploads aceitam tipos de imagem permitidos e têm limite de tamanho.
- Entradas são validadas e consultas usam parâmetros.
- As páginas do frontend definem políticas de segurança de conteúdo.

## Armazenamento

O backend usa SQLite. Em produção, configure `DB_PATH` para uma pasta persistente e restrinja o acesso ao arquivo e às cópias de segurança. Faça backups regulares e teste a restauração.

Use HTTPS no domínio público e mantenha as variáveis de ambiente fora do repositório.
