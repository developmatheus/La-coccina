# Plano — Kanban com Tema, Follow-up, Financeiro e Fluxo PWA de Entrega

## Summary

Objetivo: alinhar o `kanban` ao tema da área administrativa, criar no admin um follow-up operacional de entregas e um painel financeiro/contábil completo, e reestruturar o PWA do motoboy com seletor persistente de navegação, nova barra de ações, fluxo de adiamento/cancelamento e histórico de tentativas por entrega.

Decisões fechadas com o usuário:

- A implementação deve acontecer em uma branch dedicada: `feature/operacao-entrega-admin`.
- O `kanban` deve respeitar o mesmo tema salvo pelo admin em `localStorage`.
- O follow-up do admin terá dois macrogrupos: `Entregues` e `Não Entregues`.
- Dentro de `Não Entregues`, `adiados` e `cancelados` ficam juntos, com filtros internos.
- O painel financeiro será a versão `Completa`.
- No PWA, `Entregue` e `Não Entregue` ficam em largura `50%` cada.
- O botão `Trecho Maps` vira `ROTA`, com seletor lateral persistente entre `Maps` e `Waze`.
- A ação `Entregue` continua avançando automaticamente para a próxima parada.
- A ação `Não Entregue` abre modal com dois caminhos: `Adiar entrega` e `Registrar cancelamento`.
- O cancelamento do motoboy é configurável no admin:
  - `Cancelamento automático pelo motoboy`
  - `Cancelamento aguarda confirmação do ADMIN`
- Quando o cancelamento automático estiver ativo, o pedido é cancelado imediatamente.
- Pedidos `adiados` e `cancelados` entram no botão/lista `Adiados`.
- Pedidos `cancelados` podem ser reabertos pelo motoboy enquanto a corrida/lote estiver ativa.
- Cada tentativa operacional precisa gerar um registro histórico com horários, contexto da entrega e observações.

## Current State Analysis

### Estrutura atual confirmada

- O tema do admin é salvo em `localStorage` pela chave `lc_admin_theme` em [dashboard.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/dashboard.html#L1539-L1664).
- O `kanban` em [kanban.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/kanban.html#L1-L140) usa palette fixa dark e hoje não consome `lc_admin_theme`.
- O admin principal em [dashboard.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/dashboard.html#L1263-L1422) já possui cabeçalho, catálogo, cardápio e modal de configurações, mas não possui seções de `follow-up` nem `financeiro`.
- O backend de pedidos em [orders.js](file:///C:/Projetos/La%20coccina/La-coccina/backend/routes/orders.js#L14-L42) trabalha com os status `novo`, `em_producao`, `aguardando_envio`, `preparando_rota`, `a_caminho`, `entregue` e `cancelado`.
- O histórico admin atual em [orders.js](file:///C:/Projetos/La%20coccina/La-coccina/backend/routes/orders.js#L269-L281) retorna apenas `entregues + cancelados`, limitado e sem follow-up operacional.
- O fluxo do motoboy no PWA está em [delivery-batch.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/delivery-batch.html#L651-L818), com botões separados para `Trecho Maps`, `Waze atual`, `Ligar`, `Entregue`, `Não entregue`, `Anterior` e `Próxima`.
- O modal de falha atual em [delivery-batch.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/delivery-batch.html#L770-L784) só registra um motivo genérico de não entrega.
- O backend operacional do motoboy está em [deliveryBatches.js](file:///C:/Projetos/La%20coccina/La-coccina/backend/routes/deliveryBatches.js#L789-L898) e hoje aceita apenas duas ações:
  - `delivered`
  - `failed`
- O backend já persiste `delivery_failed_reason`, `delivery_failed_note`, `delivery_attempted_at`, `delivered_at` e `delivery_actor_name`, mas ainda não possui tabela dedicada de tentativas nem conceito explícito de `adiado`.
- A configuração operacional do admin em [settings.js](file:///C:/Projetos/La%20coccina/La-coccina/backend/routes/settings.js#L15-L48) hoje salva apenas `restaurantOriginAddress`.

### Limites do modelo atual

- O `kanban` não possui nenhum mecanismo de sincronização visual com os temas `Dia`, `Noite` e `Entardecer`.
- O follow-up admin não mostra reentregas, adiamentos, tentativas, observações ou reaberturas.
- O financeiro admin não existe hoje, apesar de o sistema já ter `total`, `payment`, `created_at`, `updated_at`, `delivered_at` e `status`.
- O PWA do motoboy não tem:
  - seletor persistente de app de rota
  - botão `Adiados`
  - contador central `1/X`
  - diferenciação entre `adiar` e `cancelar`
  - reabertura de cancelados dentro do mesmo lote
  - histórico visível de tentativas por pedido

## Proposed Changes

### 0. Branch de trabalho

#### `git checkout -b feature/operacao-entrega-admin`

- Criar a branch antes de qualquer edição de código.
- Manter todas as alterações desta entrega isoladas nela até validação.

### 1. Tema compartilhado entre admin e kanban

#### `Frontend/admin/kanban.html`

- Introduzir a mesma normalização de tema usada em [dashboard.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/dashboard.html#L1637-L1664), lendo `lc_admin_theme` no carregamento.
- Substituir as cores hardcoded principais por variáveis CSS dependentes de `html[data-theme]`.
- Implementar os três estados de tema no próprio `kanban`:
  - `light`
  - `night`
  - `sunset`
- Fazer o `kanban` aplicar o tema ao abrir e ao voltar o foco da aba, para refletir mudança feita no admin sem exigir novo login.

Decisão:

- O `kanban` não terá controle de tema próprio; ele sempre espelha a preferência da área administrativa.

### 2. Configuração operacional do cancelamento

#### `backend/routes/settings.js`

- Expandir `GET /api/settings/admin` para retornar também:
  - `driverCancellationMode`
- Expandir `PUT /api/settings/admin` para aceitar e persistir:
  - `restaurantOriginAddress`
  - `driverCancellationMode`
- Usar a tabela `config` existente com a chave:
  - `driverCancellationMode`
- Valor persistido:
  - `auto`
  - `admin_confirmation`

#### `Frontend/admin/dashboard.html`

- Adicionar na área de configurações um bloco específico de entrega para o modo de cancelamento do motoboy.
- UI proposta:
  - opção `Cancelamento automático pelo motoboy`
  - opção `Cancelamento aguarda confirmação do ADMIN`
- Carregar essa configuração junto com `restaurantOriginAddress` em [loadDeliverySettings()](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/dashboard.html#L2711-L2725).
- Salvar junto em [saveDeliverySettings()](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/dashboard.html#L2727-L2750).

Decisão:

- A configuração fica no admin e o PWA só consome o valor entregue pelo backend do lote/configuração, sem salvar política de cancelamento localmente.

### 3. Persistência de tentativas, adiamentos e reabertura operacional

#### `backend/migrations/009_delivery_attempts_followup_finance.js`

- Criar nova migration após [008_driver_compact_mode.js](file:///C:/Projetos/La%20coccina/La-coccina/backend/migrations/008_driver_compact_mode.js).
- Adicionar em `orders`:
  - `delivery_followup_state TEXT NOT NULL DEFAULT ''`
  - valores previstos: `''`, `delayed`, `cancelled`
  - `delivery_followup_updated_at TEXT`
- Criar tabela `delivery_attempt_logs` com:
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `order_id INTEGER NOT NULL`
  - `delivery_batch_id INTEGER`
  - `attempt_action TEXT NOT NULL`
  - valores previstos: `delivered`, `delayed`, `cancelled`, `reopened`
  - `order_status_before TEXT NOT NULL DEFAULT ''`
  - `order_status_after TEXT NOT NULL DEFAULT ''`
  - `followup_state_before TEXT NOT NULL DEFAULT ''`
  - `followup_state_after TEXT NOT NULL DEFAULT ''`
  - `actor_name TEXT NOT NULL DEFAULT ''`
  - `reason TEXT NOT NULL DEFAULT ''`
  - `note TEXT NOT NULL DEFAULT ''`
  - `customer_name TEXT NOT NULL DEFAULT ''`
  - `address TEXT NOT NULL DEFAULT ''`
  - `phone TEXT NOT NULL DEFAULT ''`
  - `payment_method TEXT NOT NULL DEFAULT ''`
  - `order_total REAL NOT NULL DEFAULT 0`
  - `delivery_sequence INTEGER`
  - `attempted_at TEXT NOT NULL DEFAULT (datetime('now'))`
- Criar índices:
  - `idx_delivery_attempt_logs_order`
  - `idx_delivery_attempt_logs_batch`
  - `idx_delivery_attempt_logs_attempted_at`
  - `idx_orders_delivery_followup_state`

Decisão de modelagem:

- `status` continua sendo o status principal do pedido para o resto do sistema.
- `delivery_followup_state` carrega a situação operacional da corrida:
  - `delayed` para adiados ainda reentregáveis
  - `cancelled` para cancelados dentro da corrida, reabríveis enquanto o lote estiver ativo
- O histórico oficial de tentativas fica em `delivery_attempt_logs`; os campos atuais em `orders` seguem como último resumo operacional.

### 4. Regras operacionais do lote e novas respostas da API do motoboy

#### `backend/routes/deliveryBatches.js`

- Atualizar o `ensureDeliveryBatchSchema()` para garantir os novos campos e a nova tabela mesmo em bancos legados.
- Expandir `serializeRouteStop()` e `serializeBatch()` para retornar também:
  - `followupState`
  - `attemptCount`
  - `attemptHistoryPreview`
  - `deferredStops`
- Mudar a lógica de janela de rota:
  - a janela principal continua mostrando a parada atual + próximas pendentes
  - pedidos com `delivery_followup_state IN ('delayed','cancelled')` saem da fila principal automática
  - esses pedidos entram em `deferredStops`
- Permitir que a troca da parada atual aceite:
  - próximas entregas normais
  - itens da lista `deferredStops`
- Permitir reabrir pedido cancelado dentro do lote ativo quando o motoboy o selecionar novamente.

#### Mudanças no endpoint operacional

Atualizar [PATCH /public/:token/orders/:orderId/status](file:///C:/Projetos/La%20coccina/La-coccina/backend/routes/deliveryBatches.js#L789-L898) para aceitar:

- `action = 'delivered'`
- `action = 'failed'`
- `failureMode = 'delayed' | 'cancelled'`
- `advance = true|false`
- `reason`
- `note`

Regras:

- `delivered`
  - `status -> entregue`
  - `delivery_followup_state -> ''`
  - limpa resumo de falha atual
  - registra tentativa `delivered`
  - avança para a próxima entrega elegível
- `failed + delayed`
  - `status -> a_caminho`
  - `delivery_followup_state -> delayed`
  - mantém pedido fora da fila principal automática
  - registra tentativa `delayed`
  - avança para a próxima entrega elegível
- `failed + cancelled` com `driverCancellationMode = auto`
  - `status -> cancelado`
  - `delivery_followup_state -> cancelled`
  - registra tentativa `cancelled`
  - entra em `deferredStops`
  - pode ser reaberto no mesmo lote
- `failed + cancelled` com `driverCancellationMode = admin_confirmation`
  - `status -> a_caminho`
  - `delivery_followup_state -> delayed`
  - grava `reason` indicando cancelamento pendente de admin
  - registra tentativa operacional, mas não finaliza o pedido

Reabertura:

- Ao selecionar um item `cancelled` em `deferredStops`, o backend permite:
  - marcar esse pedido como parada atual
  - limpar o bloqueio operacional para nova tentativa
  - registrar tentativa `reopened`
- A reabertura só é permitida enquanto:
  - o lote existir
  - o pedido continuar vinculado ao lote
  - o lote estiver em `aceito_motoboy` ou `liberado_cozinha`

### 5. PWA do motoboy: nova barra de ações e navegação persistente

#### `Frontend/delivery-batch.html`

- Reestruturar a barra fixa em três linhas:
  - `ROTA |v| | LIGAR`
  - `ENTREGUE | NÃO ENTREGUE`
  - `ANTERIOR | 1/X | PRÓXIMO | ADIADOS`
- Fazer `Entregue` e `Não Entregue` ocuparem `50%` cada na linha principal.
- Substituir os botões atuais `Trecho Maps` + `Waze atual` por:
  - botão principal `ROTA`
  - botão secundário dropdown `|v|`
- Persistir a preferência de navegação em `localStorage`, por exemplo:
  - `lc_driver_route_provider`
- Comportamento:
  - default `maps`
  - se o usuário trocar para `waze`, o próximo clique em `ROTA` abre `waze` direto
- Remover o botão dedicado `Waze atual`.
- Usar o contador central `1/X` como estado visual da parada atual, derivado de `currentIndex + 1` e do total do lote.

### 6. PWA do motoboy: modal de não entrega, adiados e histórico visível

#### `Frontend/delivery-batch.html`

- Substituir o modal atual de falha por um modal em dois estágios:
  - escolha de ação:
    - `Adiar entrega`
    - `Registrar cancelamento`
  - motivo + observação
- O modal deve refletir a política do admin:
  - se `driverCancellationMode = auto`, o texto deixa claro que o cancelamento será aplicado imediatamente
  - se `driverCancellationMode = admin_confirmation`, o texto deixa claro que o cancelamento vai para revisão
- Adicionar botão `Adiados` na barra inferior.
- Ao clicar em `Adiados`, abrir uma lista/drawer com:
  - pedidos `delayed`
  - pedidos `cancelled`
  - badge/label de estado
  - última tentativa
  - motivo resumido
- Cada item da lista pode ser clicado para virar a entrega atual.
- Se o pedido estiver `cancelled`, ele ainda pode voltar ao fluxo com `Entregue` ou `Não Entregue`, desde que o lote esteja ativo.
- Mostrar no card da entrega atual:
  - total de tentativas
  - última tentativa
  - timeline resumida das tentativas mais recentes

Decisão:

- `Anterior` e `Próximo` continuam existindo para navegação manual.
- `Entregue` segue autoavançando.
- `Não Entregue` também avança por padrão quando o resultado for `adiar` ou `cancelar`, porque o pedido sai da fila principal e entra em `Adiados`.

### 7. Follow-up operacional no admin

#### `backend/routes/orders.js`

- Substituir o histórico simplificado atual por endpoints admin específicos:
  - `GET /api/orders/followup`
  - filtros:
    - `bucket=delivered|not_delivered`
    - `from`
    - `to`
    - `search`
    - `followupState`
    - `status`
    - `page`
    - `limit`
- Regras do bucket:
  - `delivered`: pedidos com `status = entregue`
  - `not_delivered`: pedidos com `delivery_followup_state IN ('delayed','cancelled')` ou com histórico operacional de falha/cancelamento
- Incluir em cada item:
  - dados básicos do pedido
  - lote atual
  - última tentativa
  - total de tentativas
  - modo do último desfecho
  - observações
- Criar endpoint para detalhes de tentativas:
  - `GET /api/orders/:id/delivery-attempts`

#### `Frontend/admin/dashboard.html`

- Adicionar uma seção visível no admin para `Follow-up de Atendimentos`.
- Estrutura:
  - tabs/chips `Entregues` e `Não Entregues`
  - filtros por período, busca e subtipo
  - tabela/lista com:
    - pedido
    - cliente
    - valor
    - forma de pagamento
    - lote
    - última tentativa
    - total de tentativas
    - estado atual
  - drawer/modal lateral com timeline completa das tentativas

Decisão:

- `Não Entregues` agrupa `adiados` e `cancelados`.
- A separação fina ocorre por filtros internos e badges, não por terceira aba principal.

### 8. Painel financeiro/contábil completo no admin

#### `backend/routes/orders.js`

- Criar endpoints admin para analytics financeiro:
  - `GET /api/orders/finance/summary`
  - `GET /api/orders/finance/details`
- `summary` retorna:
  - `grossSales`
  - `deliveredRevenue`
  - `cancelledValue`
  - `openOperationalValue`
  - `ordersCount`
  - `deliveredCount`
  - `cancelledCount`
  - `averageTicket`
  - `paymentBreakdown`
  - `statusBreakdown`
  - `dailySeries`
  - `hourlySeries`
  - `topCustomers`
  - `topProducts`
- `details` retorna a listagem paginada de pedidos para a grade/tabela financeira.
- Base de cálculo:
  - vendas por `created_at`
  - entrega concluída por `delivered_at`
  - cancelamentos por `updated_at` ou `delivery_followup_updated_at` quando aplicável
- `topProducts` pode ser calculado parseando `orders.items` com o mesmo parser já existente em [orders.js](file:///C:/Projetos/La%20coccina/La-coccina/backend/routes/orders.js#L49-L68).

#### `Frontend/admin/dashboard.html`

- Adicionar uma seção dedicada `Financeiro / Contábil` fora do modal de configuração, no corpo principal do admin.
- Estrutura recomendada:
  - filtros de período
  - cards KPI
  - gráfico de série diária
  - gráfico por forma de pagamento
  - gráfico por status
  - ranking de clientes
  - ranking de produtos
  - tabela detalhada de pedidos
- Dados mínimos exibidos na tabela:
  - pedido
  - cliente
  - data
  - status
  - pagamento
  - valor
  - lote
  - entregador

Decisão:

- A primeira versão é “completa” em leitura/gestão, mas sem exportação fiscal e sem integração contábil externa.
- O painel será construído apenas com os dados já persistidos no sistema; não haverá conciliação bancária externa nesta etapa.

### 9. Carregamento, estado e inicialização do admin

#### `Frontend/admin/dashboard.html`

- Ajustar o `window.onload` em [dashboard.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/dashboard.html#L2753-L2762) para também carregar:
  - configurações de entrega expandidas
  - follow-up
  - financeiro
- Encapsular a nova lógica em funções dedicadas, mantendo o arquivo navegável:
  - `loadDeliveryAdminSettings()`
  - `saveDeliveryAdminSettings()`
  - `loadFollowupDashboard()`
  - `loadFinanceDashboard()`
  - `openFollowupAttemptHistory()`

## Assumptions & Decisions

- A implementação deve iniciar em `feature/operacao-entrega-admin`.
- Não haverá nova página admin; o trabalho será concentrado em [dashboard.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/dashboard.html), [kanban.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/kanban.html) e [delivery-batch.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/delivery-batch.html).
- O modo de cancelamento do motoboy é global para a operação e configurado no admin.
- `Adiados` é a lista operacional de exceções da corrida e inclui `delayed` e `cancelled`.
- `Cancelado` continua sendo status válido de pedido, mas ainda pode ser reaberto dentro do mesmo lote ativo.
- O financeiro será baseado em dados persistidos de pedidos e itens, sem dependência de serviço externo.
- Não há necessidade de alterar autenticação/admin login para esta entrega.

## Verification Steps

- Validar que [kanban.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/kanban.html) muda visualmente ao alternar tema no [dashboard.html](file:///C:/Projetos/La%20coccina/La-coccina/Frontend/admin/dashboard.html).
- Validar no PWA:
  - `ROTA` abre `Maps` por padrão
  - ao escolher `Waze`, a próxima abertura usa `Waze`
  - `Entregue` avança de `1/X` para `2/X`
  - `Não Entregue -> Adiar entrega` move o pedido para `Adiados`
  - `Não Entregue -> Registrar cancelamento` respeita o modo configurado no admin
  - um cancelado aparece em `Adiados` e pode ser reaberto no mesmo lote
- Validar que cada ação operacional cria registro em `delivery_attempt_logs`.
- Validar que o follow-up admin mostra:
  - `Entregues`
  - `Não Entregues`
  - timeline completa por pedido
- Validar que o painel financeiro mostra números coerentes com os pedidos do período:
  - total vendido
  - ticket médio
  - breakdown por pagamento
  - breakdown por status
  - séries temporais
  - tabela detalhada
- Rodar diagnostics nos arquivos alterados e verificar fluxo manual no browser preview do admin e do PWA.
