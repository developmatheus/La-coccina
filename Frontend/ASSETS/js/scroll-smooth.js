/**
 * Scroll suave estilo streaming — La Coccina (vertical + carrosséis)
 */
(function (global) {
  'use strict';

  const sliderAnimations = new WeakMap();

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function getScrollOffset() {
    const header = document.querySelector('header');
    return (header ? header.offsetHeight : 0) + 16;
  }

  function getSliderStep(slider) {
    const card = slider.querySelector('.card');
    if (!card) return 0;
    const style = getComputedStyle(slider);
    const gap = parseFloat(style.columnGap || style.gap) || 25;
    return card.offsetWidth + gap;
  }

  function smoothScrollHorizontal(element, deltaX, opts) {
    if (!element || !deltaX) return;

    const options = opts || {};
    const duration = options.duration != null ? options.duration : 520;
    const startX = element.scrollLeft;
    const targetX = startX + deltaX;
    const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
    const clampedTarget = Math.max(0, Math.min(targetX, maxScroll));
    const distance = clampedTarget - startX;

    if (Math.abs(distance) < 2) return;

    const prev = sliderAnimations.get(element);
    if (prev && prev.rafId) cancelAnimationFrame(prev.rafId);

    const startTime = performance.now();
    const state = { rafId: 0 };
    sliderAnimations.set(element, state);

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(progress);
      element.scrollLeft = startX + distance * eased;

      if (progress < 1) {
        state.rafId = requestAnimationFrame(tick);
      } else {
        element.scrollLeft = clampedTarget;
        sliderAnimations.delete(element);
      }
    }

    state.rafId = requestAnimationFrame(tick);
  }

  function smoothScrollProductSlider(sliderId, direction, opts) {
    const slider = document.getElementById(sliderId);
    if (!slider) return;
    const step = getSliderStep(slider);
    if (!step) return;
    smoothScrollHorizontal(slider, step * direction, opts);
  }

  function smoothScrollToElement(element, opts) {
    if (!element) return;

    const options = opts || {};
    const duration = options.duration != null ? options.duration : 1500;
    const offset = options.offset != null ? options.offset : getScrollOffset();
    const startY = window.pageYOffset;
    const targetY = element.getBoundingClientRect().top + startY - offset;
    const distance = targetY - startY;

    if (Math.abs(distance) < 2) return;

    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(progress);
      window.scrollTo(0, startY + distance * eased);
      if (progress < 1) requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  function smoothScrollToSection(id, opts) {
    const el = document.getElementById(id);
    if (!el) return;
    smoothScrollToElement(el, opts);
  }

  function initScrollTriggers() {
    document.querySelectorAll('[data-scroll-to]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = btn.getAttribute('data-scroll-to');
        if (targetId) smoothScrollToSection(targetId);
      });
    });

    document.querySelectorAll('[data-slider]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const sliderId = btn.getAttribute('data-slider');
        const direction = parseInt(btn.getAttribute('data-dir'), 10);
        if (sliderId && direction) smoothScrollProductSlider(sliderId, direction);
      });
    });
  }

  global.smoothScrollToSection = smoothScrollToSection;
  global.smoothScrollToElement = smoothScrollToElement;
  global.smoothScrollProductSlider = smoothScrollProductSlider;
  global.scrollSliderFinal = smoothScrollProductSlider;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollTriggers);
  } else {
    initScrollTriggers();
  }
})(typeof window !== 'undefined' ? window : global);
