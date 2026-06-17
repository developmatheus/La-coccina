# Plano: Bairros E Cidades Na Configuracao Admin

## Resumo

Trocar o cadastro hardcoded de locais de entrega em `Frontend/cart.html` por uma configuracao administravel no painel do admin, com lista funcional de `cidade + bairro + frete + ativo`.

A nova versao tera dois modos complementares:

- **Admin:** ferramenta de descoberta por `endereco-base + raio`, usada apenas no administrativo para sugerir bairros/cidades automaticamente com Google Maps; o admin revisa, ativa/desativa e ajusta frete antes de salvar.
- **Cliente:** continua vendo um unico campo combinado no checkout, com busca digitavel por qualquer parte do bairro/cidade, consumindo apenas a lista final ativa salva pelo admin.

## Analise Do Estado Atual

- O checkout usa uma lista fixa em `Frontend/cart.html`:
  - o `<select id="bairro">` contem bairros hardcoded com o frete no `value`
  - o frete e calculado em `updateTotal()` com `parseFloat(document.getElementById('bairro').value)`
  - a persistencia local salva o texto selecionado do bairro em `localStorage`
  - o pedido enviado para o backend concatena `bairroText - address`
- Nao existe hoje um modulo de cadastro de bairros/cidades no admin.
- O backend ja possui uma infraestrutura simples de configuracoes em `backend/routes/settings.js`, baseada na tabela `config (key, value)` criada em `backend/migrations/001_initial_schema.js`.
- O admin ja carrega/salva configuracoes pelo endpoint `GET/PUT /api/settings/admin` em:
  - `Frontend/admin/dashboard.html`
  - `Frontend/admin/cadastros.html`
- Isso torna viavel salvar a lista de areas de entrega como JSON na tabela `config`, sem exigir nova tabela para a primeira versao funcional.

## Decisoes Fechadas

- **Checkout:** 1 campo combinado, com busca digitavel.
- **Estrutura do cadastro:** `cidade + bairro + frete + ativo`.
- **Geracao da lista:** sugestao automatica + revisao manual.
- **Fonte geografica:** Google Maps.
- **Escopo do raio:** somente no admin; o cliente nao usa a ferramenta de raio.
- **Objetivo funcional:** eliminar hardcode e permitir manutencao real pelo admin, sem depender de deploy para alterar bairros/frete.

## Mudancas Propostas

### 1. Backend: expandir configuracoes admin para areas de entrega

**Arquivo:** `backend/routes/settings.js`

Adicionar suporte a uma nova chave de configuracao, sugerida como `deliveryAreas`, armazenada em JSON.

Formato sugerido:

```json
[
  {
    "id": "uuid-ou-slug",
    "city": "Florianopolis",
    "district": "Ingleses",
    "fee": 8.99,
    "active": true
  }
]
```

Implementacao prevista:

- Criar normalizador/leitor seguro para a lista, com fallback para `[]`.
- Incluir `deliveryAreas` no payload do `GET /api/settings/admin`.
- Aceitar `deliveryAreas` no `PUT /api/settings/admin`.
- Validar no backend:
  - `city` obrigatoria
  - `district` obrigatorio
  - `fee` numerico e `>= 0`
  - `active` booleano
- Sanitizar espacos e evitar objetos quebrados antes de persistir.

**Por que aqui:** o projeto ja usa `config` para toggles e preferencias, entao esta e a extensao mais curta e consistente para uma primeira versao funcional.

### 2. Backend admin-only: gerar sugestoes por endereco-base + raio

**Arquivo:** `backend/routes/settings.js`

Adicionar um endpoint administrativo novo para descoberta geografica, protegido por `requireAdmin`, com comportamento do tipo:

- `POST /api/settings/admin/delivery-areas/suggest`

Payload previsto:

```json
{
  "originAddress": "Rua do Restaurante, 123 - Centro, Florianopolis/SC",
  "radiusKm": 8
}
```

Resposta prevista:

```json
{
  "origin": {
    "address": "...",
    "lat": -27.59,
    "lng": -48.54
  },
  "suggestions": [
    {
      "city": "Florianopolis",
      "district": "Ingleses",
      "source": "google-grid-reverse-geocode"
    }
  ]
}
```

Abordagem tecnica proposta:

- usar `GOOGLE_MAPS_API_KEY` do servidor
- geocodificar o endereco-base
- gerar uma malha de pontos dentro do raio (grid sampling)
- fazer reverse geocoding dos pontos amostrados
- extrair de cada resposta os componentes equivalentes a:
  - cidade (`administrative_area_level_2` / `locality`)
  - bairro (`sublocality`, `sublocality_level_1`, `neighborhood`)
- deduplicar pares `cidade + bairro`
- devolver a lista como **sugestao**, nunca como verdade absoluta

Regras importantes:

- a ferramenta e **best effort**
- nao publica nada automaticamente
- o admin sempre revisa o resultado antes de salvar
- se a API do Google nao estiver configurada, o endpoint retorna erro claro

**Por que no backend:** protege a chave, concentra a logica de descoberta e cumpre o requisito de uso restrito ao admin.

### 3. Backend: expor areas de entrega para o checkout publico

**Arquivo:** `backend/routes/settings.js`

Adicionar um endpoint publico dedicado, por exemplo `GET /api/settings/delivery-areas`, retornando apenas os itens ativos e ordenados para o checkout.

Resposta planejada:

```json
{
  "areas": [
    {
      "id": "ingleses-florianopolis",
      "city": "Florianopolis",
      "district": "Ingleses",
      "fee": 8.99,
      "label": "Florianopolis - Ingleses"
    }
  ]
}
```

Regras:

- somente itens `active === true`
- ordenar por `city`, depois `district`
- gerar um `label` pronto para uso no frontend

**Por que separado do admin:** o checkout nao precisa receber configuracoes privadas nem depender de autenticacao.

### 4. Admin: criar editor funcional da lista de bairros/cidades com ferramenta de raio

**Arquivos:**
- `Frontend/admin/dashboard.html`
- `Frontend/admin/cadastros.html`

Adicionar ao painel de configuracoes um bloco de “Areas de entrega” com:

- bloco de descoberta automatica:
  - `Endereco-base`
  - `Raio em km`
  - botao `Sugerir bairros/cidades`
- formulario de revisao/edicao:
  - `Cidade`
  - `Bairro`
  - `Frete`
  - `Ativo`
- formulario de inclusao:
- listagem/editavel das entradas cadastradas
- acoes minimas:
  - importar sugestoes para a grade local
  - adicionar
  - editar inline ou reabrindo o formulario
  - ativar/desativar
  - remover
  - salvar no backend

Abordagem sugerida para manter escopo funcional:

- manter um array local em JS com os itens da tela
- carregar esse array em `loadDeliverySettings()`
- persistir esse array em `saveDeliverySettings()`
- usar uma segunda estrutura local temporaria para `deliveryAreaSuggestions`
- ao clicar em `Sugerir bairros/cidades`, chamar o endpoint admin-only de sugestoes
- permitir que o admin:
  - aceite todas as sugestoes
  - aceite e edite uma a uma
  - descarte sugestoes indesejadas
- reaproveitar o estilo do painel de ferramentas ja existente

Decisoes de UX do admin:

- usar uma tabela/lista simples, sem drag and drop
- usar botao unico “Salvar” do bloco
- mostrar feedback de sucesso/erro no mesmo padrao das outras configuracoes
- mostrar aviso textual de que a descoberta por raio e apenas assistida pelo Google e requer revisao humana
- pre-preencher o endereco-base com `restaurantOriginAddress` quando existir

### 5. Checkout: substituir o `<select>` hardcoded por campo pesquisavel

**Arquivo:** `Frontend/cart.html`

Trocar o comportamento atual baseado em `<select id="bairro">` por um controle combinado com busca.

Implementacao planejada:

- manter um valor selecionado em JS (`selectedDeliveryArea`)
- carregar areas do endpoint publico ao abrir a pagina
- criar um campo pesquisavel com:
  - input digitavel
  - lista/caixa de resultados
  - filtro por qualquer parte de `city` ou `district`
- ao selecionar uma opcao:
  - preencher visualmente o campo
  - habilitar endereco
  - atualizar frete
  - permitir envio do pedido

Comportamentos a preservar:

- endereco continua desabilitado enquanto nenhum local valido estiver selecionado
- frete continua somando ao subtotal
- validacao do botao de checkout continua exigindo nome, endereco, telefone e area valida
- `address-history` e `client snapshot` continuam funcionando

### 6. Checkout: adaptar calculo e persistencia para nao depender do `value` do select

**Arquivo:** `Frontend/cart.html`

Refatorar os pontos que hoje assumem:

- `bairro` como DOM select com `value` numerico
- `bairroText` vindo de `selectedIndex`

Trocas previstas:

- `updateTotal()` passa a ler `selectedDeliveryArea?.fee`
- `habilitarEndereco()` passa a depender da presenca de item selecionado
- `verificarCampos()` valida `selectedDeliveryArea`
- `buildWhatsAppMessage()` usa `selectedDeliveryArea.label`
- `sendToWhatsApp()` monta o endereco com `selectedDeliveryArea.label`
- `loadSavedClient()` e `applyClientSnapshot()` passam a restaurar por label/ID, com fallback seguro se a area nao existir mais
- se uma area salva localmente estiver inativa/removida:
  - nao selecionar automaticamente
  - manter o endereco bloqueado
  - exigir nova escolha do cliente

### 7. Compatibilidade e migracao de dados locais

**Arquivo:** `Frontend/cart.html`

Como o cliente ja salva historico/localStorage com o nome textual do bairro, a implementacao deve manter compatibilidade:

- o snapshot continuara guardando o texto exibido da area
- na restauracao, o sistema tenta achar a area pelo `label`
- se nao achar, limpa apenas a selecao da area e preserva nome/telefone/pagamento

Isso evita quebrar dados locais antigos e reduz atrito no primeiro uso apos a mudanca.

## Abordagem Tecnica Recomendada

### Estrutura de dados

Persistir `deliveryAreas` em `config.value` como JSON string.

### Estrutura do item

```json
{
  "id": "florianopolis__ingleses",
  "city": "Florianopolis",
  "district": "Ingleses",
  "fee": 8.99,
  "active": true
}
```

### Regras de ID

- gerar `id` no frontend admin ao criar item, usando slug simples ou timestamp
- manter `id` estavel para edicao/ativacao/remocao

### Regra de exibicao no checkout

- label padrao: `Cidade - Bairro`
- busca case-insensitive
- filtro por substring em `city`, `district` e `label`

### Estrategia de descoberta por raio

- geocodificar o endereco-base
- construir uma grade circular simples no raio informado
- reverse geocodificar os pontos
- extrair `cidade + bairro`
- deduplicar
- devolver conjunto sugerido

### Limites aceitos desta abordagem

- cobertura de bairros depende do que o Google retornar para cada ponto
- o resultado pode perder microbairros ou trazer nomes administrativos diferentes
- por isso a etapa de revisao manual no admin e obrigatoria no fluxo

### Escopo propositalmente fora desta entrega

- geolocalizacao
- CEP
- matriz de frete por distancia
- tabela relacional nova para delivery areas
- importacao/exportacao CSV

## Arquivos Impactados

- `backend/routes/settings.js`
  - adicionar persistencia, endpoint admin-only de sugestoes por raio e endpoint publico de areas de entrega
- `Frontend/admin/dashboard.html`
  - adicionar UI do cadastro de areas de entrega e da ferramenta de raio
- `Frontend/admin/cadastros.html`
  - adicionar UI do cadastro de areas de entrega e da ferramenta de raio
- `Frontend/cart.html`
  - substituir lista hardcoded por controle pesquisavel integrado com API

## Riscos E Cuidados

- O checkout hoje usa bastante logica acoplada ao `<select>`; a refatoracao precisa cobrir todos os pontos de leitura/escrita para nao quebrar calculo, validacao e snapshot.
- Como `loadSavedClient()` e `applyClientSnapshot()` dependem de texto exibido, a migracao deve tolerar labels antigos ou areas removidas.
- O admin existe em duas paginas (`dashboard` e `cadastros`); ambas precisam ficar alinhadas para nao gerar comportamento diferente.
- A descoberta por raio nao tem garantia cartografica perfeita; o plano assume fluxo de sugestao assistida, nao publicacao automatica.
- O endpoint admin-only de sugestoes deve ter protecao e mensagens claras quando `GOOGLE_MAPS_API_KEY` nao estiver disponivel.

## Verificacao Planejada

### Backend

- `GET /api/settings/admin` retorna `deliveryAreas`
- `PUT /api/settings/admin` salva a lista corretamente
- `POST /api/settings/admin/delivery-areas/suggest` retorna sugestoes deduplicadas a partir do endereco-base e raio
- `GET /api/settings/delivery-areas` retorna apenas itens ativos e ordenados

### Admin

- informar endereco-base + raio e gerar sugestoes
- revisar sugestoes antes de salvar
- cadastrar uma nova area
- editar uma area existente
- desativar uma area
- remover uma area
- salvar e recarregar a pagina sem perder dados

### Checkout

- carregar areas dinamicamente
- filtrar digitando parte do bairro
- filtrar digitando parte da cidade
- selecionar uma area e ver o frete atualizado
- trocar de area e recalcular total
- confirmar que area inativa nao aparece
- validar que botao de checkout so habilita com area valida
- enviar pedido e confirmar endereco formatado com `Cidade - Bairro`

### Compatibilidade

- restaurar cliente salvo com area ainda existente
- restaurar cliente salvo com area removida/inativa e exigir nova selecao sem quebrar os demais dados

## Assumptions & Decisions

- A primeira versao funcional usara a tabela `config`, nao uma tabela nova.
- A lista sera compartilhada entre `dashboard.html` e `cadastros.html`.
- O checkout tera um unico campo combinado com busca, nao dois selects separados.
- O valor do frete sera definido por item `cidade + bairro`.
- Apenas areas ativas aparecerao para o cliente.
- A ferramenta de raio existira apenas no admin.
- A geracao por raio usara Google Maps no backend, com resultado de sugestao + revisao manual.
