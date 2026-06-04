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
      const { protocol, hostname, port, origin } = window.location;

      if (protocol === 'file:') {
        return 'http://127.0.0.1:3001';
      }

      if (port === '3001') {
        return origin.replace(/\/$/, '');
      }

      if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return 'http://127.0.0.1:3001';
      }

      return origin.replace(/\/$/, '');
    }

    return 'http://127.0.0.1:3001';
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
