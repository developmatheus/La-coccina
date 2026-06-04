/**
 * Eventos em tempo real (SSE) — avisa o site quando o cardápio muda.
 */

const clients = new Set();

function subscribe(res) {
  clients.add(res);
}

function unsubscribe(res) {
  clients.delete(res);
}

function notifyClients(eventType = 'menu-updated') {
  const payload = `data: ${JSON.stringify({ type: eventType, at: Date.now() })}\n\n`;

  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

module.exports = { subscribe, unsubscribe, notifyClients };
