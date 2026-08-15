import '@testing-library/jest-dom/vitest';

/**
 * jsdom doesn't implement these — Radix primitives (Dialog, Tooltip,
 * DropdownMenu, Toggle, …) and AiConciergeDemo's own auto-scroll call
 * into them unconditionally, so a test that merely *renders* one of
 * these components throws "not implemented" without these polyfills,
 * long before the test gets anywhere near what it's actually checking.
 */
if (typeof window !== 'undefined') {
  window.matchMedia =
    window.matchMedia ??
    ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = window.ResizeObserver ?? ResizeObserverStub;

  // framer-motion's `whileInView`/viewport feature (used across the
  // homepage's fadeUp sections) needs this to mount at all.
  class IntersectionObserverStub {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  window.IntersectionObserver = window.IntersectionObserver ?? IntersectionObserverStub;

  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  // Radix's pointer-capture-based interactions (Dialog close, Toggle,
  // Tooltip) call these; jsdom has neither.
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
}
