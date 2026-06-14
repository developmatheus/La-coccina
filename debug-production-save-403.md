[OPEN] production-save-403

# Sintoma
- Em produção, o admin não consegue salvar o endereço base do restaurante.
- O comportamento relatado é erro 403 ao tentar salvar.

# Escopo
- Reproduzir em produção.
- Descobrir se o 403 vem do frontend, backend, proxy, CORS ou sessão.
- Não alterar lógica de negócio antes de ter evidência.

# Hipóteses iniciais
1. A requisição de salvar ainda está indo com um header antigo ou formato incorreto e algum proxy/backend está recusando.
2. O token de admin salvo no `sessionStorage` está ausente, expirado ou não está sendo enviado no `Authorization`.
3. A produção não está rodando o código atual de `settings.js` e ainda exige uma checagem extra do painel de ferramentas.
4. O endpoint chamado pelo frontend em produção não é o mesmo backend esperado por causa de `API_BASE`/origem incorreta.
5. O 403 não vem do Node app, mas de alguma camada externa de hospedagem, rewrite ou proteção do servidor.

# Evidências
- Produção acessada em `https://lacoccina.com.br/admin/login.html`.
- `POST /api/login` em produção retornou `500` com corpo: `{"success":false,"error":"Configuração de senha de admin inválida no servidor"}`.
- `GET /api/settings/admin` sem token retornou `401` com corpo: `{"error":"Sessão expirada ou inválida. Faça login novamente."}`.
- `PUT /api/settings/admin` sem token retornou `401` com corpo: `{"error":"Sessão expirada ou inválida. Faça login novamente."}`.
- O HTML publicado de `/admin/dashboard.html` já é o novo:
  - sem `toolApiFetch`
  - sem header `x-tool-access`
  - com `saveDeliverySettings()`
  - com a seção `Endereco base para entregas`

# Conclusão parcial
- O frontend publicado está atualizado.
- O bloqueio atual de produção está no login/admin token, porque o backend em produção está com `ADMIN_PASSWORD` em formato inválido para produção.
- Pelo código, isso acontece quando `ADMIN_PASSWORD` está em texto puro em produção; nessa condição o login retorna `500` e não gera token novo para o admin.
- Sem token válido, salvar endereço em `/api/settings/admin` falha por autenticação.

# Evidências adicionais
- A árvore de deploy local [httpdocs](file:///C:/Projetos/La%20coccina/httpdocs) estava no branch `deploy/httpdocs`, 3 commits atrás de `origin/main`.
- Nessa versão antiga, [settings.js](file:///C:/Projetos/La%20coccina/httpdocs/backend/routes/settings.js) ainda tinha `requireToolAccess` em `GET /admin` e `PUT /admin`.
- O worktree local `deploy/httpdocs` foi alinhado por fast-forward para `6739203`, mesma ponta da `main`.
- Após esse alinhamento, o novo [settings.js](file:///C:/Projetos/La%20coccina/httpdocs/backend/routes/settings.js#L15-L48) não usa mais `requireToolAccess`.
- O HTML atualmente servido em produção para `/admin/dashboard.html` já não contém `tool-panel-lock`, nem `x-tool-access`, nem o texto `Acesso extra para configuracoes sensiveis`.

# Conclusão atual
- A mensagem `Acesso extra das configurações expirado ou inválido.` só pode vir de um backend antigo ainda carregado em memória ou de uma instância/checkout diferente ainda não alinhado.
- Como o frontend publicado já está novo, mas o usuário ainda recebe a mensagem antiga ao salvar, o cenário mais provável é: o processo Node em produção não foi reiniciado após a atualização do código, ou a API está rodando de outra pasta ainda antiga.

# Próximos passos
1. Identificar a URL de produção usada pelo admin.
2. Reproduzir no navegador com DevTools.
3. Capturar request, response, headers e corpo.
4. Cruzar com o código local e concluir a causa raiz.
