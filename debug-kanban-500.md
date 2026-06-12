# Debug Session: kanban-500

Status: OPEN

## Sintoma
- `admin/kanban.html` não carrega.
- A API retorna erro `500`.

## Hipóteses iniciais
1. A rota `GET /api/orders` está quebrando ao normalizar ou ordenar pedidos do kanban.
2. Existe dado antigo no banco com `status` inesperado ou nulo causando exceção no backend.
3. Algum campo de entrega como `delivery_batch_code` ou `created_at` vem em formato inesperado e quebra a ordenação.
4. O erro acontece apenas no ambiente publicado por diferença entre dados reais e dados locais.
5. O frontend do kanban está chamando a API corretamente, mas a resposta `500` vem de uma exceção silenciosa no servidor.

## Plano de evidência
- Reproduzir o `500` localmente na rota usada pelo kanban.
- Capturar stack trace/log do backend.
- Identificar a linha exata da exceção.
- Corrigir com a menor mudança possível.
- Validar novamente a carga do kanban.

## Evidências coletadas
- Produção: login administrativo bem-sucedido em `https://lacoccina.com.br/admin/login.html`.
- Produção: `fetch('/api/orders')` retornou `500` com body `{"error":"Erro ao buscar pedidos"}`.
- Local: a mesma rota `GET /api/orders` respondeu `200`, indicando diferença de dados entre ambiente local e publicado.

## Hipótese mais forte
- Existe ao menos um pedido ativo em produção com `items` legado ou malformado, e o parse desse campo estava derrubando a rota inteira do kanban.

## Nova evidência
- O deploy em produção foi concluído, mas o `500` continuou.
- O backend no Render inicia com `npm start`, e o script `start` ainda não executava `npm run migrate`.
- A migration `006_delivery_batches.js` é a responsável por criar `delivery_batches` e adicionar `delivery_batch_id` / `delivery_sequence` em `orders`.

## Causa raiz mais provável
- Produção está com código novo do kanban, mas banco sem a migration `006`, então a query de `/api/orders` quebra ao acessar estrutura de entrega inexistente.

## Mitigação aplicada
- Endurecimento do parse de `order.items` para aceitar formatos legados e fazer fallback seguro para `[]`, mantendo o kanban operacional.
- Alteração do script `npm start` para executar `npm run migrate` antes de subir o servidor, aplicando migrations pendentes automaticamente no boot.
