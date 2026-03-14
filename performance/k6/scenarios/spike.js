/**
 * K6 Spike Load Test
 *
 * Scenario: Sudden burst to 200 VUs in 10 seconds, hold for 30 seconds, back to 0
 * Purpose: Verify system can handle sudden traffic spikes without complete failure
 *
 * SLO Thresholds:
 *   - http_req_failed rate < 0.10 (10%) - more lenient for spike test
 */

import { sleep } from 'k6';
import {
  BASE_URL,
  authenticate,
  registerUser,
  checkHealth,
  generateTestEmail,
} from '../lib/helpers.js';
import { handleSummary } from '../lib/reporters.js';

// Spike test: sudden burst to 200 VUs
export const options = {
  stages: [
    // Spike: 0 -> 200 VUs in 10 seconds
    { duration: '10s', target: 200 },
    // Hold at peak: 30 seconds
    { duration: '30s', target: 200 },
    // Recovery: back to 0
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    // Spike test is more lenient - focus on system not crashing
    http_req_duration: ['p(99)<5000'],
    // Allow up to 10% error rate during spike
    http_req_failed: ['rate<0.10'],
  },
};

export { handleSummary };

export function setup() {
  const healthOk = checkHealth();
  if (!healthOk) {
    console.warn(`[WARN] Health check failed before spike test at ${BASE_URL}`);
  }
  return { baseUrl: BASE_URL };
}

/**
 * Main test function for spike test.
 * Uses lightweight scenarios to maximize request throughput.
 */
export default function () {
  const vuId = __VU;
  const iterationId = __ITER;

  // Use only auth flow during spike (avoid heavy LLM calls)
  // This focuses the spike on the authentication and API infrastructure
  authFlowScenario(vuId, iterationId);
  sleep(0.1);
}

/**
 * Lightweight auth flow scenario for spike testing.
 *
 * @param {number} vuId - Virtual user ID
 * @param {number} iterationId - Current iteration number
 */
function authFlowScenario(vuId, iterationId) {
  const email = generateTestEmail(`spike-vu${vuId}-it${iterationId}`);
  const password = 'TestPassword123!';
  const name = `Spike User ${vuId}`;

  // Register - this creates database load
  registerUser(email, password, name);
  sleep(0.1);

  // Login - this creates JWT signing load
  authenticate(email, password);
}
