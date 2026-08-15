import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement matchMedia — several existing components/CSS
// rely on prefers-reduced-motion; this stub is enough for component
// tests that don't specifically assert on media-query behavior.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
