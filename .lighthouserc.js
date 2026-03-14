/**
 * Lighthouse CI Configuration
 * Frontend performance thresholds for Bodam
 *
 * Targets (REQ-PERF-019 to REQ-PERF-021):
 *   - Performance score > 90
 *   - LCP < 2500ms
 *   - CLS < 0.1
 *   - FCP < 1800ms
 *   - Initial JS bundle < 150KB gzipped
 *   - Per-page chunk < 50KB gzipped
 */

module.exports = {
  ci: {
    collect: {
      // URLs to test
      url: [
        'http://localhost:3000',
        'http://localhost:3000/chat',
      ],
      // Run 3 times and use the median to reduce noise
      numberOfRuns: 3,
      settings: {
        // Use desktop profile (adjust if mobile is primary target)
        preset: 'desktop',
        // Chrome flags for headless CI environment
        chromeFlags: '--no-sandbox --disable-dev-shm-usage',
      },
    },
    assert: {
      // Performance score threshold
      assertions: {
        // Overall performance score
        'categories:performance': ['error', { minScore: 0.9 }],
        // Accessibility score (good to have)
        'categories:accessibility': ['warn', { minScore: 0.85 }],

        // Core Web Vitals
        // LCP (Largest Contentful Paint) < 2500ms
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        // CLS (Cumulative Layout Shift) < 0.1
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        // FCP (First Contentful Paint) < 1800ms
        'first-contentful-paint': ['error', { maxNumericValue: 1800 }],
        // TBT (Total Blocking Time) - proxy for FID/INP < 200ms
        'total-blocking-time': ['warn', { maxNumericValue: 200 }],
        // INP proxy
        'interactive': ['warn', { maxNumericValue: 3800 }],

        // Bundle size budgets (approximate, Lighthouse measures transfer sizes)
        // Initial load JS budget: ~150KB gzipped
        'resource-summary:script:size': ['warn', { maxNumericValue: 153600 }],

        // No render-blocking resources
        'render-blocking-resources': ['warn', { maxNumericValue: 0 }],

        // Images should be modern format
        'uses-webp-images': 'warn',
        'uses-optimized-images': 'warn',

        // Accessibility
        'color-contrast': 'warn',

        // Best practices
        'is-on-https': 'off', // Disabled for localhost
        'uses-http2': 'off',   // Disabled for localhost
      },
    },
    upload: {
      // Store results as GitHub Actions artifacts
      target: 'temporary-public-storage',
    },
    server: {
      // If using LHCI server
      port: 9001,
    },
  },
};
