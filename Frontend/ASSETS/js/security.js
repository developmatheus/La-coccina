/**
 * ============================================================================
 * LA COCCINA — Configuração da API + segurança (frontend)
 * ============================================================================
 */

(function (global) {
  'use strict';

  function getApiBase() {
    const custom = global.__LA_COCCINA_API__;

    if (custom !== undefined && custom !== null && String(custom).trim() !== '') {
      return String(custom).trim().replace(/\/$/, '');
    }

    if (typeof window !== 'undefined' && window.location) {
      const { protocol, origin } = window.location;

      // Quando aberto como arquivo local, assume que o servidor está em localhost:3001
      if (protocol === 'file:') {
        return 'http://localhost:3001';
      }

      // Em qualquer ambiente servido (dev local, produção, Cloudflare), usa a própria origem
      return origin.replace(/\/$/, '');
    }

    return '';
  }

  const API_BASE = getApiBase();

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeJsonForHtml(obj) {
    return JSON.stringify(obj)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
  }

  function uploadUrl(path) {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return `${API_BASE}${path}`;
  }

  global.LaCoccinaSecurity = {
    API_BASE,
    escapeHtml,
    safeJsonForHtml,
    uploadUrl,
  };
})(typeof window !== 'undefined' ? window : global);
