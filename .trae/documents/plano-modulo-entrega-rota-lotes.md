# Plano — Módulo de Entrega com Rota, Lotes e QR Code

## Resumo

Objetivo: implementar um módulo de entrega no Kanban com uma coluna exclusiva para preparação de rota, configuração do endereço-base do restaurante, geração de lotes de entrega, QR Code por lote e página pública do motoboy com mapa embutido do Google Maps e entregas ordenadas.

Ao iniciar a execução, criar a branch:

`feature/modulo-entrega-rota-lotes`

Escopo fechado com o usuário:

- Serviço de mapa: Google Maps.
- Nova coluna exclusiva para preparação de rota.
- O botão `Preparar rota` fica no cabeçalho dessa coluna.
- Ao preparar a rota, o lote é criado mas os pedidos ainda não saem para `a_caminho`.
- Cada lote recebe uma tag visível nos cards em `a_caminho`.
- Cada lote recebe um QR Code próprio.
- O QR abre uma página pública por token, sem login.
- O motoboy precisa aceitar o lote ao ler o QR Code.
- Depois do aceite do motoboy, a cozinha precisa confirmar a saída.
- Só após a confirmação da cozinha o lote é movido para `a_caminho`.
- O motoboy conclui entregas card a card, não por lote inteiro.
- A página do motoboy deve manter um cadastro-base em `localStorage`.
- Os dados do cadastro do motoboy são: `Nome`, `Whatsapp`, `CPF`, `Modelo`, `Placa`.
- O mapa na página do lote é embutido no site.
- A chave `GOOGLE_MAPS_API_KEY` é obrigatória para a feature.

## Current State Analysis

### Estrutura atual confirmada

- O backend é `Node.js + Express + SQLite`, com migrations em `backend/migrations` e rotas principais montadas em `backend/server.js`.
- O Kanban administrativo está concentrado em `Frontend/admin/kanban.html`.
- Os pedidos são persistidos em `orders`, com os campos atuais `status`, `kanban_order`, `order_token` e `updated_at`.
- Os status ativos hoje são `novo`, `em_producao`, `aguardando_envio` e `a_caminho`; finais: `entregue` e `cancelado`.
- O endereço do cliente está em `orders.address` como texto simples.
- O projeto já possui página pública por token em `Frontend/track.html`, o que serve de padrão para a página pública do lote.
- A persistência de configuração do sistema hoje usa a tabela `config`, mas só existe uso real para `isOpen`.
- O painel administrativo que faz mais sentido para “gestão do restaurante” é `Frontend/admin/dashboard.html`, na área de configurações.
- Não existe hoje qualquer configuração de Google Maps, nem chave em `backend/config/.env.example`.
- Não existe hoje conceito de lote de entrega, QR Code, relação pedido-lote ou página pública do motoboy.
- Não existe hoje conceito de aceite de motoboy, confirmação da cozinha, cadastro local do motorista ou vínculo de motorista com lote.

### Impactos funcionais identificados

- O fluxo atual do Kanban não possui uma etapa intermediária para separar “pedido pronto” de “rota preparada”, nem estados de lote entre “rota pronta” e “saída confirmada”.
- O fluxo público de rastreio do cliente precisa reconhecer o novo status intermediário.
- Para renderizar um mapa embutido e também calcular rota otimizada, a implementação dependerá da `Google Maps JavaScript API` carregada no frontend com chave pública restrita por domínio.
- Como o card exibe apenas dados do próprio pedido, será necessário enriquecer a listagem de pedidos com dados do lote para mostrar a tag da entrega em andamento.
- Como o fluxo operacional agora depende de lote e não apenas de pedido, será necessário persistir status do lote e dados do motorista no backend.

## Proposed Changes

### 1. Branch de trabalho

#### `git checkout -b feature/modulo-entrega-rota-lotes`

- Criar a branch antes de qualquer edição de código.
- Todo o desenvolvimento desta feature deve ocorrer nela.

### 2. Persistência: status de preparação, lotes, motorista e ordenação

#### `backend/migrations/006_delivery_batches.js`

Criar uma nova migration para adicionar o modelo de lotes de entrega:

- Criar tabela `delivery_batches` com:
  - `id`
  - `batch_code` texto único e legível para o operador, por exemplo `L001`, `L002`...
  - `public_token` texto único para o QR/public page
  - `batch_status` com ciclo: `preparado`, `aceito_motoboy`, `liberado_cozinha`
  - `origin_address` texto com o endereço-base usado na rota
  - `maps_url` texto com a URL da rota no Google Maps
  - `driver_name`
  - `driver_whatsapp`
  - `driver_cpf`
  - `vehicle_model`
  - `vehicle_plate`
  - `accepted_at`
  - `kitchen_confirmed_at`
  - `created_at`
  - `updated_at`
- Adicionar em `orders`:
  - `delivery_batch_id INTEGER NULL`
  - `delivery_sequence INTEGER NULL`
- Criar índices para:
  - `delivery_batches.public_token`
  - `orders.delivery_batch_id`
  - `orders.status`
- Manter compatibilidade com SQLite e com o runner atual de migrations.

Decisão de modelagem:

- O vínculo do lote fica normalizado em `orders.delivery_batch_id`.
- A ordem da entrega fica em `orders.delivery_sequence`.
- A tag do lote exibida no Kanban virá por `JOIN` com `delivery_batches.batch_code`.
- O lote representa uma “saída” real de entrega; um pedido pertence a no máximo um lote ativo por vez.
- Os dados do motorista ficam vinculados ao lote, não aos pedidos, porque um único motoboy assume um conjunto de entregas.
- A ida para `a_caminho` depende de `batch_status = liberado_cozinha`.

### 3. Configuração do restaurante e Google Maps

#### `backend/routes/settings.js` (novo)

Criar uma rota dedicada para configurações operacionais do restaurante:

- `GET /api/settings/admin`
  - requer autenticação admin
  - retorna:
    - `restaurantOriginAddress`
    - `googleMapsApiKeyConfigured`
    - `googleMapsApiKey`
- `PUT /api/settings/admin`
  - requer autenticação admin
  - salva em `config`:
    - `restaurantOriginAddress`
- `GET /api/settings/public-delivery`
  - uso público controlado para a página do lote
  - retorna:
    - `googleMapsApiKey`

Decisão:

- O endereço-base do restaurante fica no banco, em `config`.
- A chave do Google Maps fica em ambiente, via `GOOGLE_MAPS_API_KEY`.
- A chave será exposta ao frontend somente porque a Google Maps JS API já é pública por natureza; a proteção esperada é restrição por domínio/referrer no Google Cloud.

#### `backend/server.js`

- Montar a nova rota `/api/settings`.
- Ajustar a `Content-Security-Policy` para permitir carregamento do Google Maps, incluindo:
  - `https://maps.googleapis.com`
  - `https://maps.gstatic.com`
- Validar que `scriptSrc`, `styleSrc`, `imgSrc`, `connectSrc` e `fontSrc` comportem o carregamento do mapa embutido.

#### `backend/config/.env.example`

- Adicionar:
  - `GOOGLE_MAPS_API_KEY=`
- Documentar em comentário que a chave é obrigatória para o módulo de entrega e deve ter restrição por domínio.

### 4. API de lotes de entrega, aceite e liberação

#### `backend/routes/deliveryBatches.js` (novo)

Criar uma rota focada no fluxo de preparação e consulta de lotes:

- `POST /api/delivery-batches/prepare`
  - requer admin
  - recebe:
    - `orderIds`
    - `orderedOrderIds`
    - `mapsUrl`
    - `originAddress`
  - valida:
    - pedidos existem
    - todos estão em `preparando_rota`
    - há ao menos 2 pedidos ou 1 pedido válido para um lote
    - existe endereço-base configurado
  - cria o lote
  - grava `batch_status = preparado`
  - atualiza `orders.delivery_batch_id`
  - grava `orders.delivery_sequence`
  - atualiza `updated_at`
  - retorna:
    - `batchId`
    - `batchCode`
    - `publicToken`
    - `publicUrl`
    - `mapsUrl`
- `POST /api/delivery-batches/public/:token/accept`
  - público
  - recebe:
    - `name`
    - `whatsapp`
    - `cpf`
    - `vehicleModel`
    - `vehiclePlate`
  - valida:
    - token válido
    - lote ainda não liberado pela cozinha
    - todos os campos obrigatórios preenchidos
  - grava os dados do motorista no lote
  - grava `accepted_at`
  - atualiza `batch_status = aceito_motoboy`
  - retorna o estado atualizado do lote
- `POST /api/delivery-batches/:id/confirm-kitchen`
  - requer admin
  - valida:
    - lote existe
    - lote já foi aceito pelo motoboy
    - pedidos do lote continuam ativos
  - grava `kitchen_confirmed_at`
  - atualiza `batch_status = liberado_cozinha`
  - move todos os pedidos do lote para `a_caminho`
  - atualiza `updated_at` de lote e pedidos
  - retorna resumo do lote liberado
- `GET /api/delivery-batches/public/:token`
  - público
  - retorna:
    - dados do lote
    - endereço-base
    - pedidos do lote em ordem
    - status individual de cada pedido
    - status do lote
    - dados do motorista já aceitos
    - `mapsUrl`
- `GET /api/delivery-batches/:id`
  - admin
  - usado para consultar/mostrar QR de um lote já criado, se necessário

Decisões de fluxo:

- O cálculo da melhor rota acontece no frontend com Google Maps Directions/Routes e o backend persiste somente o resultado já ordenado.
- Isso evita colocar lógica de roteirização dentro do backend e mantém a modelagem compatível com a stack atual.
- A criação do lote, o aceite do motoboy e a liberação da cozinha passam a ser três etapas distintas.
- O lote só se torna “em rota” depois que a cozinha confirma o lote já aceito pelo motoboy.

#### `backend/server.js`

- Montar a nova rota `/api/delivery-batches`.

### 5. Ajustes na API de pedidos e nos status

#### `backend/routes/orders.js`

Atualizar a rota atual de pedidos para suportar o novo fluxo:

- Incluir o novo status `preparando_rota` em `VALID_STATUSES` e `STATUS_LABEL`.
- Na listagem `GET /api/orders`, buscar também:
  - `delivery_batch_id`
  - `delivery_sequence`
  - `delivery_batches.batch_code`
  - `delivery_batches.batch_status`
  - `delivery_batches.vehicle_plate`
- Ordenação:
  - para `a_caminho`, priorizar `batch_code` e `delivery_sequence`
  - para as demais colunas, manter `kanban_order` e `created_at`
- Manter `PUT /api/orders/:id/status` válido para conclusão individual `entregue`.
- Ao marcar um pedido como `entregue`, manter o vínculo de lote para histórico visual, mas remover o card do Kanban ativo como já acontece hoje.

Decisão operacional:

- A coluna `aguardando_envio` continua representando pedidos prontos.
- O novo estágio `preparando_rota` entra entre `aguardando_envio` e `a_caminho`.
- O lote pode existir enquanto os pedidos ainda permanecem visualmente em `preparando_rota`, aguardando aceite/liberação.

### 6. Gestão do restaurante: endereço-base

#### `Frontend/admin/dashboard.html`

Adicionar uma configuração persistida na área já existente de ferramentas/configurações:

- Novo campo `Endereço base para entregas`
- Botão `Salvar`
- Estado carregado via `/api/settings/admin`
- Mensagem de sucesso/erro
- Validação mínima:
  - campo obrigatório
  - tamanho mínimo razoável

Comportamento esperado:

- O endereço salvo é o ponto de partida padrão de toda rota.
- Sem esse endereço, o botão `Preparar rota` no Kanban fica bloqueado com feedback claro.

### 7. Kanban: nova coluna, lote, QR e preparação de rota

#### `Frontend/admin/kanban.html`

Alterar o Kanban existente para suportar preparação de rota:

- Inserir nova coluna:
  - `preparando_rota`
  - rótulo visual: `Preparando Rota`
  - posição: após `aguardando_envio` e antes de `a_caminho`
- Ajustar `COLUMNS`, `STATUS_LABELS`, cores e textos dos botões de avanço:
  - `aguardando_envio` -> `preparando_rota`
  - `preparando_rota` não avança card a card por botão simples; o avanço principal é pelo botão de cabeçalho `Preparar rota`
- No cabeçalho da coluna `preparando_rota`, renderizar o botão `Preparar rota`.
- Ao clicar no botão:
  - validar se existem cards na coluna
  - validar se existe endereço-base configurado
  - abrir modal/drawer de preparação do lote
- O modal deve:
  - carregar o Google Maps JS
  - calcular a melhor rota a partir do endereço-base + endereços dos pedidos da coluna
  - mostrar mapa embutido com rota
  - mostrar lista ordenada das paradas
  - permitir confirmar o lote
- Após confirmar:
  - chamar `POST /api/delivery-batches/prepare`
  - manter os pedidos na coluna `preparando_rota`
  - exibir tag visual do lote nos cards, por exemplo `Lote L003`
  - exibir badge do estado do lote, por exemplo `Aguardando aceite do motoboy`
  - disponibilizar QR Code e link público do lote
- Quando o motoboy aceitar o lote:
  - refletir o estado no Kanban, por exemplo `Motoboy aceitou`
  - habilitar ação da cozinha `Confirmar saída`
- Quando a cozinha confirmar:
  - mover todos os pedidos do lote para `a_caminho`
  - manter tag do lote e placa do motorista visíveis nos cards
- No card em `a_caminho`:
  - exibir tag do lote
  - exibir placa do motorista
  - exibir posição da parada quando houver, por exemplo `Parada 2/5`
- No drawer de detalhes do pedido:
  - exibir lote atual, link público do lote e QR Code do lote quando o pedido estiver associado
  - exibir status do lote
  - exibir dados do motoboy quando já houver aceite

Decisões de UI:

- O lote é montado com todos os pedidos que estiverem em `preparando_rota` e ainda sem lote ativo no momento da ação.
- O botão de cabeçalho cria um lote por vez a partir do conjunto elegível da coluna.
- Pedidos de um lote anterior continuam visíveis em `a_caminho` com tag própria, permitindo coexistência de múltiplos lotes.
- Pedidos de lote já preparado, mas ainda não liberado pela cozinha, continuam em `preparando_rota` com badge de ciclo do lote.

### 8. Página pública do motoboy, cadastro local e aceite

#### `Frontend/delivery-batch.html` (novo)

Criar uma página pública por token, inspirada na estrutura de `track.html`, mas voltada ao motoboy:

- Carrega lote pelo `token` na query string.
- Busca dados em `/api/delivery-batches/public/:token`.
- Carrega a Google Maps JS API usando a chave retornada/configurada.
- Mantém um cadastro-base do motoboy em `localStorage`, por exemplo na chave `lc_driver_profile`.
- Se não houver cadastro salvo, abre formulário obrigatório com:
  - `Nome`
  - `Whatsapp`
  - `CPF`
  - `Modelo`
  - `Placa`
- Se houver cadastro salvo, não abre o formulário em modo de edição por padrão.
- Nesse caso, a página mostra os dados já configurados do motoboy em modo de resumo e oferece apenas o botão opcional `Editar dados`.
- O formulário só aparece novamente quando o motoboy clicar em `Editar dados`.
- Ao clicar em `Aceitar lote`:
  - envia os dados para `POST /api/delivery-batches/public/:token/accept`
  - registra o motoboy no lote
  - salva/atualiza o cadastro local
- Após o aceite e antes da confirmação da cozinha:
  - exibe tela de espera com status `Aguardando confirmação da cozinha`
  - atualiza periodicamente o lote até a liberação
- Após a confirmação da cozinha:
  - libera a visualização principal da rota
- Renderiza:
  - cabeçalho do lote
  - dados do motoboy vinculado
  - mapa embutido com a rota
  - lista ordenada das entregas
  - cliente, telefone e endereço de cada parada
  - botão `Abrir no Google Maps`
- Exibe QR-resolvido sem necessidade de login.
- Pode destacar visualmente pedidos já entregues caso o motoboy recarregue a página depois de marcações no painel.

Decisão:

- A conclusão de entrega continua sendo feita no painel admin, card a card.
- A página do motoboy é responsável pelo aceite do lote e pela consulta/execução da rota, mas não pela baixa administrativa de entrega.

### 9. Rastreio do cliente

#### `Frontend/track.html`

- Incluir `preparando_rota` na régua visual de status entre `Pronto` e `A caminho`.
- Ajustar rótulos para manter consistência com o backend.
- Garantir que um pedido que entrou em preparação de rota continue mostrando progresso correto ao cliente.

### 10. Segurança e consistência do fluxo

#### Arquivos afetados

- `backend/routes/orders.js`
- `backend/routes/deliveryBatches.js`
- `backend/routes/settings.js`
- `backend/server.js`
- `Frontend/admin/kanban.html`
- `Frontend/admin/dashboard.html`
- `Frontend/track.html`
- `Frontend/delivery-batch.html`

Regras a validar na implementação:

- Não permitir criar lote sem pedidos na coluna `preparando_rota`.
- Não permitir criar lote sem endereço-base configurado.
- Não permitir criar lote sem `GOOGLE_MAPS_API_KEY`.
- Não permitir que pedidos fora de `preparando_rota` entrem no preparo do lote.
- Não permitir que um pedido já associado a lote ativo entre em outro lote.
- Não permitir aceite do lote sem os cinco campos do motoboy.
- Não permitir confirmação da cozinha antes do aceite do motoboy.
- Se a preparação falhar, nenhum pedido deve ser vinculado ao lote.
- Se o aceite falhar, o lote permanece sem motoboy associado.
- Se a confirmação da cozinha falhar, nenhum pedido deve ser movido para `a_caminho`.
- Se o token do lote for inválido, a página pública deve exibir erro amigável.

## Assumptions & Decisions

- A área “gestão do restaurante” será implementada no `dashboard.html`, na seção de configurações já existente.
- O endereço-base será um único campo textual livre, não um formulário estruturado por CEP/bairro/latitude/longitude.
- A roteirização será baseada nos endereços textuais já existentes em `orders.address`.
- A ordenação final da rota virá do Google Maps no frontend; o backend persistirá a sequência calculada.
- A tag visual do lote seguirá o padrão `Lote <batch_code>`.
- O QR Code apontará para `delivery-batch.html?token=<public_token>`.
- O cadastro-base do motoboy será salvo no navegador do próprio motoboy via `localStorage`.
- O motoboy é identificado no lote por `Nome`, `Whatsapp`, `CPF`, `Modelo` e `Placa`.
- A placa também será tratada como dado operacional do lote e aparecerá no Kanban quando o lote já tiver sido aceito.
- O mapa embutido depende obrigatoriamente de `GOOGLE_MAPS_API_KEY`.
- A chave do Google Maps deverá ser configurada antes de considerar a feature pronta para produção.
- Não entra neste escopo automatizar “entregue” a partir da página do motoboy.
- Não entra neste escopo geocodificação própria, cálculo interno de distância ou integração com outros provedores.

## Verification Steps

### Banco e backend

- Criar a branch de feature.
- Aplicar migrations com `npm run migrate` em `backend`.
- Confirmar que a nova tabela e colunas foram criadas.
- Validar `GET/PUT /api/settings/admin`.
- Validar `POST /api/delivery-batches/prepare` com pedidos válidos.
- Validar `POST /api/delivery-batches/public/:token/accept`.
- Validar `POST /api/delivery-batches/:id/confirm-kitchen`.
- Validar `GET /api/delivery-batches/public/:token`.

### Fluxo administrativo

- Abrir `admin/dashboard.html` e salvar o endereço-base do restaurante.
- Abrir `admin/kanban.html`.
- Mover pedidos de `aguardando_envio` para `preparando_rota`.
- Clicar em `Preparar rota`.
- Confirmar que o modal mostra mapa embutido e lista ordenada.
- Confirmar criação do lote, QR Code e link público.
- Confirmar que os cards permanecem em `preparando_rota` com tag do lote e badge de aceite pendente.
- Após o aceite do motoboy, confirmar que a ação `Confirmar saída` fica disponível.
- Confirmar que, ao liberar pela cozinha, os cards migram para `a_caminho` com tag do lote, placa e ordem de parada.

### Fluxo público

- Abrir a URL pública do lote gerada pelo QR.
- Confirmar exibição do formulário do motoboy quando não houver cadastro salvo.
- Confirmar persistência do cadastro-base no `localStorage`.
- Confirmar que, com cadastro salvo, a página mostra apenas o resumo configurado e o botão `Editar dados`.
- Confirmar que o formulário só reaparece ao clicar em `Editar dados`.
- Confirmar registro do motoboy no lote após o aceite.
- Confirmar estado intermediário `Aguardando confirmação da cozinha`.
- Confirmar carregamento do mapa embutido após a liberação da cozinha.
- Confirmar lista ordenada de entregas e botão para abrir no Google Maps.
- Marcar um pedido como `entregue` no painel e recarregar a página pública do lote para verificar refletência do status.

### Fluxo do cliente

- Abrir `track.html?token=...`.
- Confirmar exibição correta do novo status `preparando_rota`.
- Confirmar permanência em `preparando_rota` após criação do lote e avanço para `a_caminho` somente depois da confirmação da cozinha.

### Verificação técnica

- Revisar erros de console e de rede nas páginas alteradas.
- Revisar diagnósticos/linter dos arquivos editados.
- Testar pelo menos:
  - lote com 1 pedido
  - lote com múltiplos pedidos
  - ausência de endereço-base
  - ausência de `GOOGLE_MAPS_API_KEY`
  - aceite sem cadastro completo do motoboy
  - confirmação da cozinha sem aceite prévio
  - token público inválido
