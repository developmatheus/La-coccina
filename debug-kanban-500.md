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

## Mitigação aplicada
- Endurecimento do parse de `order.items` para aceitar formatos legados e fazer fallback seguro para `[]`, mantendo o kanban operacional.
