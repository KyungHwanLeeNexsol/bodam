/**
 * K6 Stress Load Test
 *
 * Scenario: Ramp up from 0 to 100 VUs over 5 minutes, hold for 2 minutes, ramp down
 * Purpose: Identify breaking point and verify system handles gradual load increase
 *
 * SLO Thresholds:
 *   - http_req_duration p99 < 3000ms
 *   - http_req_failed rate < 0.05 (5%)
 */

import { sleep } from 'k6';
import {
  BASE_URL,
  authenticate,
  registerUser,
  createChatSession,
  sendChatMessage,
  checkHealth,
  generateTestEmail,
  getRandomInsuranceQuestion,
} from '../lib/helpers.js';
import { handleSummary } from '../lib/reporters.js';

// Stress test configuration: ramp up to 100 VUs
export const options = {
  stages: [
    // Ramp-up phase: 0 -> 100 VUs over 5 minutes
    { duration: '1m', target: 20 },
    { duration: '1m', target: 40 },
    { duration: '1m', target: 60 },
    { duration: '1m', target: 80 },
    { duration: '1m', target: 100 },
    // Hold phase: stay at 100 VUs for 2 minutes
    { duration: '2m', target: 100 },
    // Ramp-down phase: back to 0
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    // Under stress, p99 must stay under 3s
    http_req_duration: [
      'p(95)<2000',
      'p(99)<3000',
    ],
    // Under stress, error rate must stay under 5%
    http_req_failed: ['rate<0.05'],
  },
};

export { handleSummary };

export function setup() {
  const healthOk = checkHealth();
  if (!healthOk) {
    console.warn(`[WARN] Health check failed before stress test at ${BASE_URL}`);
  }
  return { baseUrl: BASE_URL };
}

/**
 * Main test function for stress test.
 * Uses same scenarios as baseline but with much higher concurrency.
 */
export default function () {
  const vuId = __VU;
  const iterationId = __ITER;

  // Health check
  checkHealth();
  sleep(0.2);

  // Auth flow
  const token = authFlowScenario(vuId, iterationId);
  sleep(0.5);

  // Chat session (if authenticated)
  if (token) {
    chatSessionScenario(token);
    sleep(0.5);
  }
}

/**
 * Auth flow scenario for stress test.
 *
 * @param {number} vuId - Virtual user ID
 * @param {number} iterationId - Current iteration number
 * @returns {string|null} JWT token
 */
function authFlowScenario(vuId, iterationId) {
  const email = generateTestEmail(`stress-vu${vuId}-it${iterationId}`);
  const password = 'TestPassword123!';
  const name = `Stress User ${vuId}`;

  registerUser(email, password, name);
  sleep(0.2);

  return authenticate(email, password);
}

/**
 * Chat session scenario for stress test (reduced to 3 messages to avoid timeout).
 *
 * @param {string} token - JWT access token
 */
function chatSessionScenario(token) {
  const sessionId = createChatSession(token, 'Stress Test Session');
  if (!sessionId) return;

  sleep(0.3);

  // Send 3 messages in stress test (reduced from 5 to reduce LLM load)
  for (let i = 0; i < 3; i++) {
    const question = getRandomInsuranceQuestion();
    sendChatMessage(token, sessionId, question);

    if (i < 2) {
      sleep(1);
    }
  }
}
