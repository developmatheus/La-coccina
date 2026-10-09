# Arquitetura do La Coccina

## Visão geral

O projeto é uma aplicação web com frontend em HTML, CSS e JavaScript e backend em Node.js/Express. O backend expõe a API, acessa o banco SQLite e também serve os arquivos estáticos do frontend.

## Pastas principais

- `Frontend/`: páginas HTML, estilos em `ASSETS/CSS`, scripts do navegador em `ASSETS/js`, imagens e service workers.
- `backend/`: servidor Express, rotas da API, autenticação, uploads, acesso ao SQLite e migrations.
- `UPLOADS/`: imagens públicas de produtos referenciadas pelos dados do cardápio.
- `docs/`: documentação técnica e imagens de referência.
- `scripts/demos/`: geração local de vídeos e narração para demonstrações.
- `tests/e2e/`: automações Playwright para percorrer fluxos do site.

## Caminho de inicialização

`backend/server.js` encontra o frontend em `../Frontend` e serve `Frontend/index.html` na rota `/`. As rotas de API ficam sob `/api`; imagens enviadas pelo painel são servidas em `/uploads`. O backend carrega `backend/config/.env` e usa SQLite conforme `DB_PATH`.

## Configuração e implantação

- A amostra de variáveis fica em `backend/config/.env.example`, no caminho esperado pelo backend.
- `render.yaml` define `backend` como diretório raiz do serviço.
- `script.sh` e `deploy-httpdocs-worktree.sh` são ferramentas operacionais de implantação.
- Os scripts do projeto e os nomes de pastas usados pelo servidor devem continuar referenciados nesses caminhos.

## Organização do código

O projeto mantém `Frontend/` e `backend/` como raízes separadas porque o servidor e a configuração de hospedagem dependem desses caminhos. Não foi criado um `src/` genérico nem foram movidos arquivos da aplicação. As linguagens principais são HTML, CSS, JavaScript no navegador e JavaScript/Node.js no servidor.
