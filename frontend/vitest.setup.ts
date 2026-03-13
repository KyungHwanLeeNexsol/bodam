import '@testing-library/jest-dom/vitest'

// jsdom에서 scrollIntoView를 지원하지 않아 mock 처리
window.HTMLElement.prototype.scrollIntoView = function () {}

