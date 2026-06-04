/**
 * ============================================================================
 * LA COCCINA — Script auxiliar do carrinho (legado / compatibilidade)
 * ============================================================================
 */

let cart = JSON.parse(localStorage.getItem('cart') || '[]');

function addToCart(product) {
  cart.push(product);
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartCount();
  if (typeof showNotification === 'function') {
    showNotification(`${product.name} adicionado ao carrinho!`);
  }
}

function updateCartCount() {
  const counts = document.querySelectorAll('#cart-count');
  counts.forEach((el) => {
    el.textContent = cart.length;
  });
}

function showNotification(message) {
  const notif = document.createElement('div');
  notif.style.cssText = `
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: #27ae60;
    color: white;
    padding: 15px 25px;
    border-radius: 50px;
    z-index: 99999;
    font-weight: bold;
    box-shadow: 0 5px 15px rgba(0,0,0,0.3);
  `;
  notif.textContent = message;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 2500);
}

function removeFromCart(index) {
  cart.splice(index, 1);
  localStorage.setItem('cart', JSON.stringify(cart));
  updateCartCount();
  if (typeof loadCart === 'function') loadCart();
}

window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.updateCartCount = updateCartCount;

document.addEventListener('DOMContentLoaded', () => {
  updateCartCount();
});
