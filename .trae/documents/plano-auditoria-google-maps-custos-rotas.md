# Plano: Auditoria de custo Google Maps + Modo Motoboy Compacto

## Resumo
- Objetivo combinado:
  - auditar tecnicamente e financeiramente o uso atual do Google Maps Platform com base no comportamento real do codigo;
  - implementar uma versao responsiva `Modo Motoboy Compacto` preparada para tela dividida no Android, priorizando abertura de Google Maps/Waze por link externo em vez de mapa embarcado;
  - reduzir custo recorrente removendo chamadas desnecessarias no fluxo do motoboy e estruturando o fluxo para nao recalcular/geocodificar sem necessidade.
- Estrategia principal:
  - manter o admin com montagem de rota;
  - adaptar a tela existente do motoboy, em vez de criar produto paralelo;
  - usar `delivery-batch.html?token=...&modo=compacto` como entrada do modo compacto;
  - retirar o mapa embutido do motoboy no modo compacto e, preferencialmente, do fluxo padrao do motoboy tambem;
  - concentrar a navegacao no app externo (`Google Maps` e `Waze`) com deep links;
  - preparar backend para atualizacao real de status por token publico + sessao de motoboy.
- Entregas finais planejadas:
  - diagnostico do codigo atual;
  - auditoria de custo por SKU/acao/cenario;
  - patches de frontend e backend para o modo compacto;
  - novos endpoints publicos de operacao do motoboy;
  - recomendacoes de seguranca, offline minimo seguro e medicao de consumo.

## Current State Analysis

### Fluxo atual do motoboy
- Arquivo principal: `Frontend/delivery-batch.html`
- Entrada:
  - abre por `delivery-batch.html?token=<public_token>`
  - o token tambem e guardado em `localStorage` (`LAST_TOKEN_KEY`)
- Carregamento:
  - `init()` chama `refreshBatch()`
  - `refreshBatch()` faz `fetchBatch()` em `GET /api/delivery-batches/public/:token`
  - `renderBatch()` renderiza as views e inicia `startPolling()` a cada 10s
- Estado local:
  - usa `localStorage` para `collectedIds`, `deliveredIds` e `currentStopId`
  - nao salva a parada atual no banco
- Status real:
  - o motoboy hoje nao atualiza status real no backend para entregue/nao entregue
  - a acao atual `toggleLocalDelivered()` e apenas local no navegador
- Navegacao:
  - existe `currentBatch.mapsUrl` para rota completa
  - existe `stopMapsUrlFromAddress(address)` para abrir uma parada no Google Maps
  - nao existe botao Waze
- Atualizacao:
  - usa `fetch` e polling a cada 10s; nao recarrega a pagina inteira
- Mobile/PWA:
  - ja tem `viewport`, manifest e service worker
  - a tela e mobile-first, mas nao foi desenhada para ocupar 30% a 40% da altura em tela dividida

### Fluxo atual do admin
- `Frontend/admin/kanban.html`
  - abre o modal `Preparar rota`
  - carrega Maps JS API sob demanda
  - geocodifica origem + todos os enderecos em `geocodeAddress()`
  - usa `computeNearestNeighbor()` para ordenar
  - usa `DirectionsService`/`DirectionsRenderer` para desenhar rota
  - permite drag-and-drop e `Inverter ordem`, recalculando a rota
  - envia ao backend apenas ordem, origem e `mapsUrl`
- `backend/routes/deliveryBatches.js`
  - persiste lote, token publico, `maps_url`, `origin_address`, aceite e liberacao
  - nao persiste lat/lng das entregas
  - nao expõe endpoint publico para marcar entrega ou nao entrega

### Backend e seguranca atuais
- `backend/routes/deliveryBatches.js`
  - `GET /public/:token` e publico
  - `POST /public/:token/accept` e publico
  - nao existe token de sessao do motoboy para operacoes mutantes
  - nao existe endpoint publico para mudar status dos pedidos
- `backend/routes/orders.js`
  - `PUT /:id/status` exige `requireAdmin`
  - qualquer mudanca real de status hoje depende de sessao admin
- Multi-tenant:
  - nao existe `tenant_id`, `client_id`, `restaurant_id` ou equivalente no schema
  - o sistema atual nao esta estruturado com isolamento por cliente

### APIs Google usadas hoje
- Confirmadas no codigo:
  - Maps JavaScript API
  - Geocoding via `google.maps.Geocoder`
  - Directions API legacy via `google.maps.DirectionsService`
  - DirectionsRenderer
  - Geometry library
  - links externos `google.com/maps/dir` nao faturados pelo projeto
- Nao encontradas:
  - Routes API nova / `computeRoutes`
  - Distance Matrix / Route Matrix
  - Route Optimization
  - Places / Autocomplete
  - Static Maps
  - Street View

### Principais problemas ja confirmados
- Custo no motoboy:
  - `delivery-batch.html` carrega Google Maps JS API e renderiza mapa mesmo com view padrao `coleta`
  - `renderBatch()` chama `renderRouteView()` em todo refresh
  - `renderRouteView()` chama `renderRouteMap()` sempre que o lote esta `liberado_cozinha`
  - com polling de 10s, isso e um risco serio de custo e de performance
- Custo no admin:
  - geocoding repetido toda vez que abre `Preparar rota`
  - sem cache de coordenadas
  - sem persistencia de lat/lng
- Operacao do motoboy:
  - nao ha modo compacto verdadeiro
  - nao ha botao Waze
  - nao ha status real sem reload parcial/fetch mutante
  - nao ha fila local de sincronizacao para internet ruim
- Seguranca:
  - token publico da rota e suficiente para leitura do lote
  - mutacoes futuras nao devem depender so desse token
  - nao ha isolamento por cliente no schema atual

## Assumptions & Decisions

### Decisoes de produto/arquitetura
- Adaptar a tela existente `Frontend/delivery-batch.html` em vez de criar uma pagina nova separada.
- Introduzir `modo=compacto` por query string:
  - URL-alvo: `delivery-batch.html?token=<token>&modo=compacto`
- O modo compacto sera a interface preferencial de rua:
  - sem mapa embutido
  - com foco em uma entrega por vez
  - com botoes fixos e toque rapido
- O app do motoboy vai abrir apps externos de navegacao:
  - Google Maps
  - Waze
- O fluxo do motoboy deixara de depender de Google Maps JS API para navegar.
- O modo padrao do motoboy sera ajustado para reaproveitar a mesma logica compacta e eliminar recalc de mapa desnecessario.

### Decisoes de persistencia
- Salvar progresso atual da rota em duas camadas:
  - banco: fonte de verdade do lote/parada atual
  - `localStorage`: apoio offline/retentativa
- Adicionar persistencia de coordenadas das entregas para reduzir geocoding futuro.
- Preferencia de coordenadas:
  - usar lat/lng salvas se existirem
  - fallback para endereco na URL se nao existirem

### Decisoes de seguranca
- Leitura do lote continua via `public_token`.
- Operacoes mutantes do motoboy passarao a exigir uma credencial de sessao do motoboy emitida no aceite do lote.
- A credencial de sessao ficara ligada ao lote e sera armazenada localmente no aparelho.
- Endpoints publicos de mutacao validarao:
  - lote existente
  - token publico valido
  - sessao do motoboy valida
  - pedido pertencente ao lote
  - transicoes de status permitidas

### Decisoes de custo
- Classificar o uso atual de `DirectionsService` como Directions API legacy:
  - 1 a 10 waypoints => `Directions`
  - 11 a 25 waypoints => `Directions Advanced`
- Classificar `google.maps.Geocoder` como `Geocoding`.
- Classificar `new google.maps.Map()` como `Dynamic Maps`.
- `google.com/maps` e `waze.com` via deep link nao entram como consumo faturado do projeto.
- Cambio em BRL sera calculado com taxa de referencia datada e explicitada na resposta.

## Proposed Changes

### Etapa 1 - Auditoria tecnica do fluxo atual
- Arquivos:
  - `Frontend/delivery-batch.html`
  - `Frontend/admin/kanban.html`
  - `Frontend/admin/dashboard.html`
  - `backend/routes/deliveryBatches.js`
  - `backend/routes/orders.js`
  - `backend/routes/settings.js`
  - `backend/middleware/auth.js`
  - `backend/migrations/001_initial_schema.js`
  - `backend/migrations/006_delivery_batches.js`
  - `Frontend/driver-sw.js`
- O que fazer:
  - montar a tabela `Arquivo | Funcao/rota | O que faz | Problema encontrado | Recomendacao`
  - documentar o fluxo atual do motoboy, incluindo token, polling, localStorage e links externos
- Por que:
  - o usuario pediu diagnostico baseado no codigo real antes da sugestao/implementacao
- Como:
  - levantar gatilhos reais de leitura, mutacao, abertura de Maps/Waze e renderizacao atual da tela

### Etapa 2 - Reprojetar a experiencia do motoboy para modo compacto
- Arquivos-alvo:
  - `Frontend/delivery-batch.html`
- O que mudar:
  - introduzir detecao de `modo=compacto`
  - criar layout compacto de baixa altura com foco em uma entrega atual
  - mostrar apenas:
    - entrega atual `X/Y`
    - cliente
    - endereco
    - telefone/WhatsApp
    - valor
    - forma de pagamento
    - observacao curta
    - status
    - botoes `Maps`, `Waze`, `Entregue`, `Nao entregue`, `Proxima`, `Anterior`
  - esconder/reduzir elementos nao essenciais em altura baixa
- Por que:
  - a tela atual e rica demais para split screen real
- Como:
  - reaproveitar dados do lote atual
  - trocar a logica de navegacao por uma view compacta orientada por `currentStop`
  - manter rodape de acoes fixo

### Etapa 3 - CSS especifico para tela dividida
- Arquivos-alvo:
  - `Frontend/delivery-batch.html`
- O que mudar:
  - criar um conjunto de regras para `modo=compacto`
  - adicionar breakpoints:
    - `@media (max-height: 450px)`
    - `@media (max-height: 350px)`
    - `@media (max-width: 480px)`
- Comportamento decidido:
  - esconder marca/topbar grandes no compacto baixo
  - reduzir margens, gaps e paddings
  - permitir scroll apenas na area de detalhes da entrega
  - manter area de acoes sempre visivel
  - favorecer uso com uma mao
- Por que:
  - o requisito principal e funcionar em 250px a 450px de altura

### Etapa 4 - Retirar o mapa embutido do motoboy e abrir app externo
- Arquivos-alvo:
  - `Frontend/delivery-batch.html`
  - possivelmente `backend/routes/deliveryBatches.js` para enriquecer payload
- O que mudar:
  - remover dependencia de `ensureGoogleMapsLoaded()` e `renderRouteMap()` do fluxo do motoboy compacto
  - opcionalmente eliminar tambem do fluxo padrao do motoboy para cortar custo
  - criar helpers:
    - `buildGoogleMapsUrl(stop)`
    - `buildWazeUrl(stop)`
  - prioridade de destino:
    - lat/lng persistidas
    - fallback para endereco codificado
- Por que:
  - reduz custo com Dynamic Maps e Directions no motoboy
  - encaixa no uso real de split screen com app externo
- Como:
  - usar `target="_blank"` / `window.open` ou `location.href` controlado para deep link
  - manter `mapsUrl` de lote para rota completa, mas priorizar parada atual no modo compacto

### Etapa 5 - Persistencia de coordenadas e reducao de geocoding repetido
- Arquivos-alvo:
  - nova migration em `backend/migrations/`
  - `backend/routes/orders.js`
  - `backend/routes/deliveryBatches.js`
  - `Frontend/admin/kanban.html`
- Mudanca decidida:
  - adicionar colunas em `orders` para coordenadas e metadata minima de geocoding:
    - `address_lat`
    - `address_lng`
    - `address_geocoded_at`
  - incluir essas colunas no payload do Kanban e do lote
  - no admin:
    - usar coordenadas persistidas quando disponiveis
    - geocodificar apenas pedidos sem coordenadas
    - persistir coordenadas resolvidas ao confirmar ou preparar a rota
- Por que:
  - evita geocodificar o mesmo endereco em toda abertura do modal
- Como:
  - ampliar query de pedidos
  - ajustar `openRouteModal()` para pular geocoding de itens ja resolvidos
  - criar endpoint/admin path para gravar coordenadas resolvidas com seguranca

### Etapa 6 - Endpoints reais para operacao do motoboy sem full reload
- Arquivos-alvo:
  - `backend/routes/deliveryBatches.js`
  - possivel nova migration para colunas de operacao
  - `Frontend/delivery-batch.html`
- Endpoints planejados:
  - `POST /api/delivery-batches/public/:token/session`
    - emite/renova sessao do motoboy apos aceite ou reentrada
  - `PATCH /api/delivery-batches/public/:token/current-stop`
    - salva parada atual do lote
  - `PATCH /api/delivery-batches/public/:token/orders/:orderId/status`
    - marca `entregue` ou `nao_entregue`
    - registra timestamp
    - registra motivo rapido e nota opcional
    - registra identidade do motoboy vinculada ao lote
- Estados e campos planejados:
  - migration em `orders` para:
    - `delivery_failed_reason`
    - `delivery_failed_note`
    - `delivered_at`
    - `delivery_attempted_at`
    - `delivery_actor_name`
  - migration em `delivery_batches` para:
    - `current_order_id`
    - `driver_session_token`
    - `driver_session_expires_at`
- Por que:
  - hoje o motoboy so marca localmente; o requisito pede atualizacao real sem reload
- Como:
  - front usa `fetch`
  - bloqueio de duplo clique
  - feedback visual
  - retry controlado em caso de erro

### Etapa 7 - Offline minimo seguro
- Arquivos-alvo:
  - `Frontend/delivery-batch.html`
  - `Frontend/driver-sw.js`
- O que mudar:
  - manter cache da shell e ultimo lote carregado
  - adicionar fila local de acoes pendentes no `localStorage`
  - acao pendente guarda:
    - token do lote
    - orderId
    - tipo de acao
    - payload
    - timestamp
    - idempotency key local
  - botao/rotina de reenviar pendencias
- Versao minima segura decidida:
  - leitura offline do ultimo lote: sim
  - fila local de mutacoes simples: sim
  - sincronizacao automatica com de-duplicacao basica: sim
  - sem tentar conflito complexo multi-dispositivo nesta fase
- Por que:
  - o usuario pediu suporte para internet ruim, mas sem superengenharia

### Etapa 8 - Ajuste do service worker e polling
- Arquivos-alvo:
  - `Frontend/driver-sw.js`
  - `Frontend/delivery-batch.html`
- O que mudar:
  - manter cache de shell
  - persistir tambem resposta serializada do ultimo lote fora do SW, no proprio app
  - reduzir custo operacional removendo recalc de mapa do ciclo de polling
  - manter polling para dados do lote/status, nao para mapa
- Por que:
  - o problema atual e menos "fetch do lote" e mais "mapa re-renderizado em todo refresh"

### Etapa 9 - Hardening de seguranca
- Arquivos-alvo:
  - `backend/routes/deliveryBatches.js`
  - `backend/routes/orders.js`
  - possivel migration nova
- O que mudar:
  - validar que o pedido alterado pertence ao lote do token
  - validar transicoes permitidas:
    - `a_caminho` -> `entregue`
    - `a_caminho` -> `nao_entregue` ou estado equivalente decidido
  - impedir alteracao de lote de outro token
  - reduzir exposicao desnecessaria de dados no payload publico se houver excesso
- Observacao importante:
  - como nao existe multi-tenant no schema atual, a seguranca "por cliente SaaS" estrutural nao sera resolvida integralmente nesta entrega
  - o plano vai apontar isso explicitamente como limitacao arquitetural

### Etapa 10 - Auditoria financeira detalhada
- Fontes externas:
  - pricing oficial Google Maps Platform
  - usage/billing de Maps JS, Geocoding e Directions legacy
  - cotacao USD/BRL datada
- O que fazer:
  - gerar inventario de SKUs usadas
  - tabela `Acao | API usada | Quantidade de chamadas por acao | Observacao`
  - simulacoes de custo para 1/5/10/20/50/100/200 clientes
  - comparativo:
    - Cenário A: implementacao atual
    - Cenário B: otimizada com modo compacto + links externos + coordenadas persistidas
    - Cenário C: pior caso
- Por que:
  - o usuario quer calcular custo real e economia apos as mudancas

## Verification steps
- Confirmar no codigo que o motoboy atual nao faz mutacao real de status.
- Confirmar que o mapa do motoboy e re-renderizado em cada `refreshBatch()` quando o lote esta liberado.
- Confirmar que a view padrao do motoboy e `coleta`, mas o custo do mapa acontece mesmo assim hoje.
- Confirmar que `orders.js` so permite mudanca de status via admin atualmente.
- Confirmar inexistencia de tenant isolation no backend.
- Validar novamente os SKUs oficiais e a classificacao `Directions` vs `Directions Advanced`.
- Validar que o novo modo compacto cumpre:
  - usabilidade em pouca altura
  - abertura de Maps/Waze
  - operacao sem reload total
  - ausencia de recalculo/mapa embarcado no motoboy

## Formulas que a execucao vai usar
- `entregas_mes = clientes x entregas_dia x dias_mes`
- `rotas_mes = clientes x motos_por_cliente x rotas_por_dia x dias_mes`
- `map_loads_mes_atual = eventos_de_abertura_e_refresh_com_mapa`
- `geocoding_mes_atual = rotas_montadas x (1 origem + entregas_sem_coord + recalc_adicional)`
- `directions_mes_atual = renderizacoes_de_rota_admin + renderizacoes_de_rota_motoboy`
- `custo_api = max(0, uso_mes - cota_gratis) / 1000 x preco_por_1000`
- `custo_total = soma(custos_por_sku)`
- `custo_por_cliente = custo_total / clientes`
- `custo_por_entrega = custo_total / entregas_mes`

## Pontos que exigem instrumentacao para medicao exata
- Quantas vezes por dia o admin abre `Preparar rota`.
- Quantas reordenacoes manuais faz por lote.
- Quantos lotes tem mais de 10 waypoints.
- Tempo medio do motoboy com a tela aberta.
- Quantas vezes retorna do background.
- Quantas tentativas de entrega falham por lote.
- Quantos dispositivos/abas simultaneas usam o mesmo token.

## Resultado esperado apos execucao
- O motoboy opera com tela compacta em split screen, sem depender de mapa embarcado.
- `Maps` e `Waze` abrem direto com a parada atual.
- `Entregue` e `Nao entregue` atualizam o backend via `fetch`, sem refresh total.
- A entrega atual avanca/volta com estado consistente entre banco e `localStorage`.
- O custo do motoboy com Google Maps cai drasticamente porque o browser deixa de carregar/recalcular mapa.
- A auditoria financeira mostra o custo atual, o custo otimizado e o pior caso com base no codigo real.
