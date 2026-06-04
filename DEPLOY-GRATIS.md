# Publicar La Coccina de graça (Render + MySQL na nuvem)

O site **não é só HTML**: precisa do **Node.js**, **MySQL** e da pasta de **uploads** do admin. Por isso não dá para usar só GitHub Pages ou Netlify estático.

Eu **não consigo clicar “Publicar” por você** — isso exige sua conta (GitHub + Render) e suas senhas. O que dá para fazer é seguir este guia (≈ 30–45 min na primeira vez).

---

## Opção recomendada (100% grátis)

| Parte | Serviço | Observação |
|--------|---------|------------|
| Site + API | [Render](https://render.com) | Plano free; “dorme” após ~15 min sem visita (primeiro acesso pode demorar ~30 s) |
| Banco MySQL | [TiDB Cloud](https://tidbcloud.com) Serverless | MySQL compatível, tier gratuito |
| Código | [GitHub](https://github.com) | Repositório privado ou público |

**Limitação importante:** no Render gratuito, as **fotos enviadas pelo admin** ficam no disco do servidor e **somem se o serviço reiniciar**. Para produção séria, depois vale usar Cloudinary ou S3. Para testar e mostrar o cardápio, funciona.

---

## Passo 1 — Subir o código no GitHub

1. Crie uma conta em https://github.com (se ainda não tiver).
2. Crie um repositório novo, por exemplo `la-coccina` (pode ser **privado**).
3. No PowerShell, na pasta do projeto:

```powershell
cd "C:\Users\PC GAMER\Documents\La coccina"
git init
git add .
git commit -m "Preparar deploy La Coccina"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/la-coccina.git
git push -u origin main
```

O arquivo `.env` **não vai** pro GitHub (está no `.gitignore`). Isso é correto.

---

## Passo 2 — Banco MySQL gratuito (TiDB Cloud)

1. Crie conta em https://tidbcloud.com → **Serverless** (free).
2. Crie um cluster e um banco (nome sugerido: `lacoccina`).
3. Anote: **host**, **porta**, **usuário**, **senha**.
4. No MySQL do seu PC, exporte as tabelas (`products`, etc.) e importe no TiDB (DBeaver, MySQL Workbench ou `mysql` CLI).
5. No painel TiDB, ative conexão **SSL** se for obrigatório e use `DB_SSL=true` no Render (passo 4).

---

## Passo 3 — Publicar no Render

1. Conta em https://render.com → **New** → **Web Service**.
2. Conecte o repositório GitHub `la-coccina`.
3. Configuração:

| Campo | Valor |
|--------|--------|
| **Root Directory** | `backend` |
| **Build Command** | `npm install` |
| **Start Command** | `npm run start:online` |
| **Instance Type** | Free |

4. Em **Environment** (variáveis), adicione:

```env
NODE_ENV=production
SERVE_FRONTEND=true
PORT=10000

PUBLIC_URL=https://NOME-DO-SERVICO.onrender.com
CORS_ORIGINS=https://NOME-DO-SERVICO.onrender.com,null

DB_HOST=host-do-tidb
DB_PORT=4000
DB_USER=seu_usuario
DB_PASSWORD=sua_senha
DB_NAME=lacoccina
DB_SSL=true

ADMIN_USERNAME=seu_login_admin
ADMIN_PASSWORD=hash_bcrypt_aqui
SESSION_SECRET=uma_string_aleatoria_com_pelo_menos_32_caracteres
```

Troque `NOME-DO-SERVICO` pelo nome que o Render gerar (ex.: `la-coccina-xxxx`).

5. Gere o hash da senha do admin **no seu PC**:

```powershell
cd "C:\Users\PC GAMER\Documents\La coccina\backend"
npm run hash-password -- "sua_senha_forte"
```

Cole o hash em `ADMIN_PASSWORD`.

6. **Deploy**. Quando ficar “Live”, abra:

- Loja: `https://NOME-DO-SERVICO.onrender.com/index.html`
- Admin: `https://NOME-DO-SERVICO.onrender.com/admin/login.html`

O `Frontend/assets/js/config.js` deve continuar vazio (`window.__LA_COCCINA_API__ = ''`) — a API fica no mesmo domínio.

---

## Passo 4 — Testar no celular

Use **4G** (não só Wi‑Fi do PC): abra a URL do Render, adicione um item, envie pedido no WhatsApp, entre no admin e altere um prato.

---

## Outras opções grátis (resumo)

| Opção | Prós | Contras |
|--------|------|--------|
| **Render + TiDB** | Grátis, mesmo projeto | Servidor “dorme”; uploads não permanentes |
| **Oracle Cloud (VPS free)** | Sempre ligado, MySQL no mesmo servidor | Configuração mais difícil |
| **Só Frontend no Netlify** | Muito fácil | **Admin e cardápio dinâmico não funcionam** |

Para domínio próprio (`lacoccina.com.br`), depois você aponta o DNS para o Render ou para um VPS pago (Hostinger, etc.) — ver `COMO-PUBLICAR.md`.

---

## Checklist

- [ ] Repositório no GitHub (sem `.env`)
- [ ] MySQL na nuvem com tabelas importadas
- [ ] Web Service no Render com variáveis preenchidas
- [ ] `PUBLIC_URL` igual à URL real do Render (com `https://`)
- [ ] Loja e admin abrindo na internet
- [ ] WhatsApp e carrinho testados no celular

Se quiser, na próxima mensagem diga se já tem **conta GitHub** e se prefere **Render** ou **VPS** — monto os comandos exatos com o nome do seu repositório e te ajudo a revisar o `.env` (sem você colar senhas aqui no chat).
