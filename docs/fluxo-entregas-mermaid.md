# Fluxos De Entrega

Este documento descreve os fluxos operacionais do ciclo de entrega no La Coccina, incluindo as transicoes do pedido, do lote, do motoboy e as regras de visibilidade/LGPD.

## Regras Gerais

- O pedido entra no fluxo normal de venda ate chegar ao ponto de expedicao.
- Um lote de entrega agrupa pedidos que estao em `preparando_rota`.
- O motoboy so pode operar o lote depois de aceitar o lote.
- A cozinha ainda precisa confirmar a saida para o lote virar `liberado_cozinha`.
- A rota principal mostra apenas pedidos elegiveis:
  - nao entregues
  - nao cancelados
  - nao adiados
- Pedidos adiados ou cancelados saem da fila principal e ficam em `deferredStops`.
- Se nao houver mais parada elegivel:
  - a parada atual vira `null`
  - a janela de visualizacao LGPD inicia
- A visualizacao de dados do cliente fica:
  - livre durante entrega ativa
  - livre por 2 minutos sem entrega ativa
  - bloqueada apos isso
  - reaberta por 10 minutos se o restaurante autorizar a extensao

## Fluxo Macro

```mermaid
flowchart TD
    A[Cliente faz pedido] --> B{Pedido validado?}
    B -- Nao --> BX[Pedido nao segue para entrega]
    B -- Sim --> C[Novo Pedido]
    C --> D[Em Producao]
    D --> E[Aguardando Envio]
    E --> F[Preparando Rota]
    F --> G[Criar lote de entrega]
    G --> H[Lote preparado]
    H --> I{Motoboy aceitou?}
    I -- Nao --> H1[Lote aguarda QR / link]
    H1 --> I
    I -- Sim --> J[Lote aceito pelo motoboy]
    J --> K{Cozinha confirmou saida?}
    K -- Nao --> K1[Lote aguardando liberacao da cozinha]
    K1 --> K
    K -- Sim --> L[Lote liberado para entrega]
    L --> M[Motoboy opera entregas]
    M --> N{Ainda ha parada elegivel?}
    N -- Sim --> M
    N -- Nao --> O[Fim da rota principal]
    O --> P[Janela LGPD de 2 min]
    P --> Q{Restaurante autorizou +10 min?}
    Q -- Sim --> R[Visualizacao estendida]
    Q -- Nao --> S[Dados bloqueados]
```

## Estados Do Lote

```mermaid
stateDiagram-v2
    [*] --> preparado
    preparado --> aceito_motoboy: motoboy aceita lote
    aceito_motoboy --> liberado_cozinha: cozinha confirma saida
    liberado_cozinha --> liberado_cozinha: operacao continua\nentrega / adiamento / cancelamento
```

## Fluxo Do Motoboy No Lote

```mermaid
flowchart TD
    A[Motoboy abre link publico do lote] --> B{Lote existe?}
    B -- Nao --> BX[Erro de lote/token]
    B -- Sim --> C{Status do lote}
    C -- preparado --> D[Preenche cadastro e aceita lote]
    C -- aceito_motoboy --> E[Renova sessao e aguarda cozinha]
    C -- liberado_cozinha --> F[Renova sessao e entra em operacao]
    D --> G[Lote vira aceito_motoboy]
    G --> E
    E --> H{Cozinha confirmou saida?}
    H -- Nao --> E
    H -- Sim --> F
    F --> I{Existe parada atual?}
    I -- Sim --> J[Visualiza dados essenciais e executa entrega]
    I -- Nao --> K[Sem entrega ativa]
```

## Fluxo De Navegacao Da Rota

```mermaid
flowchart TD
    A[Batch liberado] --> B[Backend ordena pedidos por delivery_sequence]
    B --> C[Filtra pedidos elegiveis para rota principal]
    C --> D[Define currentStop]
    D --> E[Define nextStops]
    E --> F[Define routeWindow]
    F --> G[App exibe rota completa]
    G --> H{Motoboy troca parada manualmente?}
    H -- Sim --> I[PATCH current-stop]
    I --> J[Backend recalcula currentStop]
    J --> G
    H -- Nao --> K[Segue na parada atual]
```

## Pedido Entregue

```mermaid
flowchart TD
    A[Pedido em rota] --> B[Motoboy toca ENTREGUE]
    B --> C{Sessao valida e visibilidade liberada?}
    C -- Nao --> CX[Acao bloqueada]
    C -- Sim --> D[Status do pedido vira entregue]
    D --> E[delivered_at preenchido]
    E --> F[followup limpo]
    F --> G[Log de tentativa entregue]
    G --> H{advance = true?}
    H -- Sim --> I[Busca proxima parada elegivel]
    H -- Nao --> J[Mantem current_order_id]
    I --> K{Existe proxima parada elegivel?}
    K -- Sim --> L[Current stop avanca]
    K -- Nao --> M[current stop vira null]
    M --> N[Inicia janela LGPD]
```

## Pedido Nao Entregue

```mermaid
flowchart TD
    A[Pedido em rota] --> B[Motoboy toca NAO ENTREGUE]
    B --> C[Seleciona motivo]
    C --> D{Modo escolhido}
    D -- Adiar --> E[followup_state = delayed]
    D -- Cancelar --> F{Politica do admin}
    F -- auto --> G[status = cancelado]
    F -- admin_confirmation --> H[status permanece a_caminho]
    H --> I[followup_state = delayed]
    G --> J[followup_state = cancelled]
    E --> K[Pedido sai da fila principal]
    I --> K
    J --> K
    K --> L[Pedido aparece em Adiados]
    L --> M{advance = true?}
    M -- Sim --> N[Busca proxima parada elegivel]
    M -- Nao --> O[Mantem parada selecionada]
    N --> P{Existe proxima parada elegivel?}
    P -- Sim --> Q[Current stop avanca]
    P -- Nao --> R[current stop vira null]
    R --> S[Inicia janela LGPD]
```

## O Que Acontece Quando O Motoboy Adia

```mermaid
flowchart TD
    A[Motoboy adia entrega] --> B[status continua a_caminho]
    B --> C[delivery_failed_reason preenchido]
    C --> D[delivery_failed_note preenchido]
    D --> E[delivery_attempted_at preenchido]
    E --> F[delivery_followup_state = delayed]
    F --> G[Pedido deixa de ser elegivel na rota principal]
    G --> H[Pedido entra em deferredStops]
    H --> I{Ainda ha outras entregas elegiveis?}
    I -- Sim --> J[Motoboy continua normalmente]
    I -- Nao --> K[Sem entrega ativa]
    K --> L[Janela LGPD de 2 min]
```

## O Que Acontece Se Cancelar

```mermaid
flowchart TD
    A[Motoboy marca cancelamento] --> B{driverCancellationMode}
    B -- auto --> C[Pedido vira cancelado]
    B -- admin_confirmation --> D[Pedido nao vira cancelado imediatamente]
    D --> E[Pedido fica como a_caminho com followup delayed]
    C --> F[followup_state cancelled]
    E --> G[Aparece em Adiados]
    F --> H[Aparece em Adiados/Cancelados]
    G --> I{Ha outras entregas elegiveis?}
    H --> I
    I -- Sim --> J[Fluxo segue para a proxima parada]
    I -- Nao --> K[Inicia janela LGPD]
```

## E Se For A Ultima Entrega?

```mermaid
flowchart TD
    A[Motoboy esta na ultima parada elegivel] --> B{Resultado}
    B -- Entregue --> C[Pedido vira entregue]
    B -- Adiado --> D[Pedido vira delayed]
    B -- Cancelado auto --> E[Pedido vira cancelado]
    B -- Cancelado com confirmacao admin --> F[Pedido fica delayed]
    C --> G[Sem proxima parada elegivel]
    D --> G
    E --> G
    F --> G
    G --> H[current stop = null]
    H --> I[routeWindow principal fica vazio]
    I --> J[deferredStops pode continuar com itens]
    J --> K[Visualizacao entra em grace period de 2 min]
    K --> L{Motoboy pede extensao?}
    L -- Nao --> M[Dados bloqueados]
    L -- Sim --> N[Restaurante avalia]
    N --> O{Aprovou?}
    O -- Sim --> P[+10 min de visualizacao]
    O -- Nao --> M
```

## Pode Fazer Depois Que Todas As Entregas Acabaram?

```mermaid
flowchart TD
    A[Todas as paradas elegiveis acabaram] --> B[current stop = null]
    B --> C{Ainda existem itens adiados/cancelados?}
    C -- Nao --> D[Sem rota restante]
    C -- Sim --> E[Itens ficam apenas em deferredStops]
    E --> F{Visualizacao ainda esta liberada?}
    F -- Sim --> G[Motoboy pode abrir Adiados e tornar uma parada atual]
    F -- Nao --> H[Dados protegidos por LGPD]
    H --> I{Motoboy pede +10 min?}
    I -- Nao --> J[Operacao fica parada]
    I -- Sim --> K{Restaurante aprova?}
    K -- Sim --> L[Visualizacao volta por 10 min]
    K -- Nao --> J
    L --> G
```

## Fluxo LGPD Da Visualizacao

```mermaid
stateDiagram-v2
    [*] --> pre_release
    pre_release --> active: cozinha libera e ha currentStop
    active --> grace: nao ha currentStop elegivel
    grace --> active: surge / reabre currentStop
    grace --> restricted: expiram 2 min
    restricted --> extended: motoboy solicita e restaurante aprova
    extended --> active: volta a existir currentStop
    extended --> restricted: expiram 10 min
```

## Condicoes De Visibilidade No PWA

```mermaid
flowchart TD
    A[Motoboy abre PWA] --> B{deliveryManagementEnabled?}
    B -- Nao --> BX[PWA somente consulta]
    B -- Sim --> C{batch_status}
    C -- preparado --> D[Dados de clientes ocultos]
    C -- aceito_motoboy --> E[Dados de clientes ocultos]
    C -- liberado_cozinha --> F{Ha currentStop?}
    F -- Sim --> G[Mostra nome, telefone, endereco]
    F -- Nao --> H[Inicia grace period]
    H --> I{2 min expiraram?}
    I -- Nao --> J[Ainda mostra dados]
    I -- Sim --> K[Oculta dados]
    K --> L{Extensao aprovada?}
    L -- Sim --> M[Mostra dados por 10 min]
    L -- Nao --> N[Continua oculto]
```

## Fluxo De Reabertura De Pedido Adiado

```mermaid
flowchart TD
    A[Pedido esta em deferredStops] --> B{Visualizacao esta liberada?}
    B -- Nao --> BX[Nao pode reabrir agora]
    B -- Sim --> C[Motoboy escolhe pedido adiado]
    C --> D[Pedido vira current stop]
    D --> E[Backend atualiza current_order_id]
    E --> F[Pedido volta a ser operado]
    F --> G{Resultado}
    G -- Entregue --> H[Sai da rota]
    G -- Novo adiamento --> I[Retorna para deferredStops]
    G -- Cancelamento auto --> J[Vira cancelado]
    G -- Cancelamento c/ confirmacao --> K[Fica delayed]
```

## Observacoes Importantes

- O pedido `cancelado` nunca volta para a rota principal automaticamente.
- O pedido `delayed` continua operacionalmente disponivel apenas pela area de adiados.
- Se o motoboy estiver sem entrega ativa e nao houver extensao aprovada, a visibilidade bloqueia mesmo que ainda existam itens adiados.
- Se o pedido for a ultima parada elegivel, qualquer desfecho encerra a rota principal e ativa a regra de LGPD.
- No modo `admin_confirmation`, o motoboy nao conclui o cancelamento final; ele apenas registra a ocorrencia e tira o pedido da fila principal.
