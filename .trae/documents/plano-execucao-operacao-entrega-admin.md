# Plano — Execução da feature de operação de entrega e admin

## Summary

Objetivo: concluir a feature grande já iniciada para que o admin ganhe follow-up operacional e painel financeiro completos, o kanban passe a respeitar o tema administrativo, e o PWA do motoboy adote o novo fluxo de rota/entrega/não entrega/adiados com histórico de tentativas.

Diretriz de branch:

- Continuar todo o trabalho isolado na branch de feature já definida pelo usuário: `feature/operacao-entrega-admin`.
- Não misturar esta entrega com `main` até validar backend, admin, kanban e PWA juntos.

## Current State Analysis

### O que já existe no código

- `backend/migrations/009_delivery_attempts_followup_finance.js` já cria `delivery_followup_state`, `delivery_followup_updated_at` e a tabela `delivery_attempt_logs` com índices.
- `backend/routes/settings.js` já expõe e persiste `driverCancellationMode` junto com `restaurantOriginAddress`.
- `backend/routes/deliveryBatches.js` já:
  - garante schema de follow-up/tentativas
  - serializa `deferredStops`
  - devolve `operationConfig.driverCancellationMode`
  - aceita `failureMode`
  - registra tentativas `delivered`, `delayed`, `cancelled` e `reopened`
  - permite reabrir pedidos em exceção ao selecionar a parada atual
- `backend/routes/orders.js` já possui:
  - `GET /api/orders/followup`
  - `GET /api/orders/:id/delivery-attempts`
  - `GET /api/orders/finance/summary`
  - `GET /api/orders/finance/details`
- `Frontend/admin/dashboard.html` já possui:
  - seção visual de `Follow-up de Atendimentos`
  - seção visual de `Financeiro / Contabil`
  - configuração de política de cancelamento do motoboy
  - funções `loadFollowupDashboard()`, `loadFinanceDashboard()` e histórico de tentativas
- `Frontend/admin/kanban.html` já possui sincronização de tema via `lc_admin_theme`, com `normalizeAdminTheme()` e `syncKanbanTheme()`.
- `Frontend/delivery-batch.html` ainda está no layout anterior do PWA, com:
  - `Trecho Maps`
  - `Waze atual`
  - `Ligar`
  - `Entregue`
  - `Nao entregue`
  - `Anterior`
  - `Proxima`
  - modal simples de não entrega

### Lacunas reais restantes

- O PWA ainda não consome o novo modelo operacional retornado pelo backend:
  - `deferredStops`
  - `operationConfig.driverCancellationMode`
  - reabertura de exceções
  - histórico/tentativas enriquecidas
- O payload offline/online do PWA ainda não envia `failureMode`.
- A UI do PWA ainda não possui:
  - botão principal `ROTA`
  - seletor persistente `Maps/Waze`
  - contador central `1/X`
  - botão/lista `Adiados`
  - modal em dois estágios para `Adiar entrega` e `Registrar cancelamento`
  - visualização de tentativas recentes na entrega atual
- O admin e o kanban já têm implementação parcial, mas ainda precisam ser validados em conjunto com os dados reais que o backend já expõe.

## Proposed Changes

### 1. Manter a execução na branch de feature

#### Arquivo/escopo

- Fluxo de trabalho em `feature/operacao-entrega-admin`

#### O que fazer

- Executar toda a implementação restante e validação dentro dessa branch específica.
- Tratar essa branch como a linha única da feature, sem abrir uma segunda branch.

#### Por quê

- As mudanças são transversais entre banco, API, admin, kanban e PWA.
- Separar em outra branch agora só aumenta risco de divergência.

### 2. Concluir o PWA do motoboy

#### Arquivo

- `Frontend/delivery-batch.html`

#### O que mudar

- Substituir a barra fixa atual por três linhas funcionais:
  - `ROTA |v| | LIGAR`
  - `ENTREGUE | NÃO ENTREGUE`
  - `ANTERIOR | 1/X | PRÓXIMO | ADIADOS`
- Fazer `ENTREGUE` e `NÃO ENTREGUE` ocuparem metade da largura cada.
- Remover o link dedicado `Waze atual`.
- Trocar o fluxo de rota para um botão principal `ROTA` e um botão secundário de seletor.
- Persistir o provedor de rota em `localStorage`, usando uma chave dedicada do PWA, com padrão `maps`.
- Quando o usuário escolher `waze`, o próximo clique no botão `ROTA` abre diretamente o Waze.

#### Integração com estado já existente

- Consumir `currentBatch.operationConfig.driverCancellationMode`.
- Consumir `currentBatch.deferredStops`.
- Continuar usando `currentBatch.links.googleMapsWindow`, `currentBatch.links.googleMapsCurrent` e `currentBatch.links.wazeCurrent`.
- Reaproveitar `renderBatch()`, `sendStatusAction()`, `setCurrentOrder()` e `applyBatchSnapshot()` como pontos centrais, ajustando-os ao novo estado.

#### Como implementar

- Introduzir helpers para:
  - ler/salvar o provedor de rota
  - calcular a URL ativa do botão `ROTA`
  - abrir/fechar dropdown de provedor
  - renderizar lista de adiados/cancelados
  - renderizar timeline curta de tentativas da entrega atual
- Expandir `buildBatchRefreshSignature()` para incluir `deferredStops`, `operationConfig` e dados mínimos de tentativas, evitando refresh ignorado quando a exceção muda.
- Ajustar `applyOptimisticAction()` para refletir:
  - `failureMode = delayed`
  - `failureMode = cancelled`
  - movimentação do pedido para `deferredStops`
  - avanço automático após `delivered` e após `failed`
- Alterar `sendStatusAction()` para enviar também `failureMode` quando a ação for `failed`.
- Ajustar a fila offline para armazenar e reenviar `failureMode`, preservando coerência com o backend atual.

### 3. Trocar o modal de não entrega pelo fluxo operacional novo

#### Arquivo

- `Frontend/delivery-batch.html`

#### O que mudar

- Substituir o modal simples atual por um modal de decisão com dois caminhos:
  - `Adiar entrega`
  - `Registrar cancelamento`
- Após escolher o modo, mostrar:
  - motivo
  - observação
  - texto contextual conforme `driverCancellationMode`

#### Regras de UX

- Se `driverCancellationMode === 'auto'`, informar que o cancelamento é aplicado imediatamente.
- Se `driverCancellationMode === 'admin_confirmation'`, informar que o registro vai para revisão do admin e operacionalmente continua como exceção.
- Ao confirmar:
  - `Adiar entrega` envia `action: 'failed'` com `failureMode: 'delayed'`
  - `Registrar cancelamento` envia `action: 'failed'` com `failureMode: 'cancelled'`

#### Resultado esperado

- O pedido sai da fila principal.
- O backend o devolve em `deferredStops`.
- O contador central avança automaticamente para a próxima entrega elegível.

### 4. Adicionar a lista operacional de adiados/cancelados

#### Arquivo

- `Frontend/delivery-batch.html`

#### O que mudar

- Criar um botão `ADIADOS` na barra inferior.
- Ao clicar, abrir lista suspensa, drawer ou painel compacto com todos os itens de `deferredStops`.

#### Conteúdo mínimo da lista

- cliente
- sequência original, se existir
- estado (`adiado` ou `cancelado`)
- última tentativa
- motivo resumido

#### Comportamento

- Clicar em um item chama `setCurrentOrder(orderId, true, true)`.
- Se o item estava em `cancelled` ou `delayed`, o backend já executa reabertura operacional pelo endpoint `PATCH /public/:token/current-stop`.
- Depois de reaberto, o card atual volta a aceitar `ENTREGUE` e `NÃO ENTREGUE`.

### 5. Enriquecer o card da entrega atual com tentativas

#### Arquivo

- `Frontend/delivery-batch.html`

#### O que mudar

- Além do campo atual `Ultima tentativa`, mostrar:
  - total de tentativas
  - badge de follow-up (`adiado`, `cancelado`, `em rota`, `entregue`)
  - timeline curta com as tentativas mais recentes, usando os dados já serializados pelo backend na parada atual ou no pedido correspondente

#### Como buscar os dados

- Priorizar os dados já presentes no `batch` serializado.
- Se houver divergência entre `currentStop` e `orders`, usar `orders` como fonte completa do pedido atual para tentativa, follow-up e timestamps.

### 6. Validar e ajustar follow-up do admin

#### Arquivos

- `Frontend/admin/dashboard.html`
- `backend/routes/orders.js`

#### O que fazer

- Validar se o frontend já renderiza corretamente os campos retornados pelos endpoints novos.
- Ajustar apenas se necessário:
  - labels de estado
  - métricas agregadas
  - empty states
  - consistência de datas e valores
- Confirmar que `Não Entregues` agrupa corretamente:
  - `delivery_followup_state = delayed`
  - `delivery_followup_state = cancelled`
  - registros operacionais de falha/cancelamento

#### Critério de conclusão

- A tabela carrega.
- O histórico abre.
- As métricas do topo são coerentes com os itens filtrados.

### 7. Validar e ajustar o painel financeiro

#### Arquivos

- `Frontend/admin/dashboard.html`
- `backend/routes/orders.js`

#### O que fazer

- Validar o contrato entre `finance/summary` e `finance/details`.
- Confirmar coerência entre:
  - KPIs
  - breakdown de pagamento
  - breakdown de status
  - top clientes
  - top produtos
  - série diária
  - tabela detalhada
- Corrigir somente o que for necessário para:
  - consistência de nomenclatura
  - apresentação de status/follow-up
  - renderização vazia/erro

#### Fora de escopo nesta entrega

- exportação
- integração contábil externa
- conciliação bancária

### 8. Validar o espelhamento de tema no kanban

#### Arquivo

- `Frontend/admin/kanban.html`

#### O que fazer

- Confirmar que o tema muda ao:
  - abrir o kanban
  - voltar o foco da aba
  - alterar `lc_admin_theme` no admin
- Ajustar somente se houver inconsistência visual residual em elementos ainda presos a cores fixas.

### 9. Verificação técnica final

#### Arquivos a checar

- `Frontend/delivery-batch.html`
- `Frontend/admin/dashboard.html`
- `Frontend/admin/kanban.html`
- `backend/routes/deliveryBatches.js`
- `backend/routes/orders.js`
- `backend/routes/settings.js`

#### O que validar

- diagnostics/linter dos arquivos alterados
- fluxo do admin autenticado
- fluxo do kanban com tema
- fluxo do PWA do motoboy
- coerência da migration `009` com o uso em runtime

## Assumptions & Decisions

- A branch correta para seguir é `feature/operacao-entrega-admin`.
- Não é necessário abrir outra branch específica; esta já é a branch específica da feature.
- O backend já implementa a maior parte da regra de negócio nova; o maior bloco pendente está no frontend do PWA.
- `Adiados` é a visão operacional unificada de itens `delayed` e `cancelled`.
- Cancelados podem ser reabertos enquanto o lote estiver ativo, e o backend atual já suporta isso.
- O follow-up e o financeiro permanecem dentro de `Frontend/admin/dashboard.html`, sem criar nova página administrativa.

## Verification Steps

- Validar no admin:
  - carregamento de `Follow-up de Atendimentos`
  - abertura do histórico por pedido
  - filtros de bucket, subtipo e busca
- Validar no financeiro:
  - KPIs preenchidos
  - listas de breakdown
  - top clientes e top produtos
  - tabela detalhada coerente com os filtros
- Validar no kanban:
  - tema `Dia`
  - tema `Noite`
  - tema `Entardecer`
- Validar no PWA:
  - `ROTA` abre `Maps` por padrão
  - troca para `Waze` persiste
  - `ENTREGUE` avança automaticamente de `1/X` para `2/X`
  - `NÃO ENTREGUE -> Adiar entrega` move o pedido para `ADIADOS`
  - `NÃO ENTREGUE -> Registrar cancelamento` respeita `driverCancellationMode`
  - item cancelado aparece em `ADIADOS` e pode ser reaberto
  - cada tentativa gera e reapresenta registro histórico
- Rodar diagnostics nos arquivos alterados ao final da implementação.
