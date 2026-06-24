# Plano de Implementação: Menu Lateral (Sidebar)

## Resumo
Remover o menu superior (header) atual e substituí-lo por um **menu lateral responsivo e recolhível (mobile first)** nas páginas administrativas (`dashboard.html`, `cadastros.html` e `kanban.html`).
No Desktop, a barra lateral ficará **fixa e aberta** à esquerda. No Mobile, ficará oculta (off-canvas) e será aberta por um **botão de hambúrguer (☰)** localizado em uma nova barra superior minimalista.
A página do **Kanban** terá uma barra superior dedicada (topbar) para acomodar seus itens específicos (Status de Conexão e Ícone de Ajuda), mantendo a "lateralidade" necessária.

## Análise do Estado Atual
- As páginas `dashboard.html` já possui a nova estrutura de sidebar aplicada.
- A página `cadastros.html` teve o HTML alterado, mas faltam ajustes finos no CSS (remover restos do `.admin-header`) e a inclusão da função JS `toggleSidebar()`.
- A página `kanban.html` ainda possui o layout antigo baseado em `.admin-header-shell`. O CSS do Kanban usa variáveis com prefixo `--kb-` que devem ser respeitadas.

## Mudanças Propostas

### 1. Atualizar `cadastros.html`
- **CSS**: Remover ou substituir as classes `.admin-header-shell`, `.admin-header`, `.admin-utility-btn`, `.admin-header-status` pelo novo estilo de sidebar, copiando os estilos baseados no `dashboard.html` (com `.admin-layout`, `.admin-sidebar`, `.sidebar-nav`, `.sidebar-link`, `.mobile-topbar`).
- **JavaScript**: Adicionar a função `toggleSidebar()` no final do arquivo.

### 2. Atualizar `kanban.html`
- **CSS**: 
  - Adicionar a estrutura de grid/flex com `.admin-layout` e `.admin-main` usando as variáveis `--kb-*`.
  - Adicionar as classes do Sidebar adaptadas para o Kanban (`.admin-sidebar`, `.sidebar-header`, `.sidebar-nav`, `.sidebar-link`, `.sidebar-footer`).
  - Adicionar uma classe `.kanban-topbar` para substituir o antigo `.admin-header` e acomodar o botão de menu (no mobile), Status de Conexão e Hint Icon.
- **HTML**:
  - Envolver todo o conteúdo em `<div class="admin-layout">` e `<main class="admin-main">`.
  - Inserir a `<aside class="admin-sidebar" id="admin-sidebar">` contendo os links de navegação.
  - Substituir o `<div class="admin-header-shell">` por uma `<header class="kanban-topbar">`.
  - Adicionar `<div class="sidebar-overlay" id="sidebar-overlay" onclick="toggleSidebar()"></div>`.
- **JavaScript**:
  - Adicionar a função `toggleSidebar()`.

## Verificação
- Verificar se o menu lateral aparece corretamente fixado à esquerda em telas grandes.
- Verificar se no celular o menu lateral é oculto e a barra superior exibe o botão `☰`.
- Clicar no botão `☰` no mobile e verificar se a animação do sidebar desliza suavemente, e se clicar fora (overlay) fecha o menu.
- Validar se o Kanban mantém seus indicadores (Conexão, Hint) no topo e rola horizontalmente sem problemas.