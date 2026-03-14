/**
 * K6 Soak (Endurance) Test
 *
 * Scenario: 50 VUs for 30 minutes
 * Purpose: Detect memory leaks, connection pool exhaustion, and gradual performance degradation
 *
 * SLO Thresholds:
 *   - http_req_duration p95 < 1000ms throughout the test
 *   - http_req_failed rate < 0.01 (1%)
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

// Soak test: 50 VUs for 30 minutes total (2m warm-up + 26m soak + 2m cool-down = 30m)
export const options = {
  stages: [
    // Warm-up: ramp up to 50 VUs over 2 minutes
    { duration: '2m', target: 50 },
    // Soak: hold at 50 VUs for 26 minutes (core soak phase)
    { duration: '26m', target: 50 },
    // Cool-down: ramp down over 2 minutes
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    // SLO must be maintained throughout the entire 30-minute run
    http_req_duration: [
      'p(50)<200',
      'p(95)<1000',
      'p(99)<3000',
    ],
    // Very low error rate expected during soak
    http_req_failed: ['rate<0.01'],
  },
};

export { handleSummary };

export function setup() {
  const healthOk = checkHealth();
  if (!healthOk) {
    console.warn(`[WARN] Health check failed before soak test at ${BASE_URL}`);
  }
  return { baseUrl: BASE_URL };
}

/**
 * Main test function for soak test.
 * Includes all scenarios with realistic pacing to simulate long-term load.
 */
export default function () {
  const vuId = __VU;
  const iterationId = __ITER;

  // Scenario 1: Health check (low overhead, verifies service health over time)
  checkHealth();
  sleep(1);

  // Scenario 2: Auth flow (tests JWT token handling over time)
  const token = authFlowScenario(vuId, iterationId);
  sleep(2);

  // Scenario 3: Chat session (tests DB connections and LLM calls over time)
  if (token) {
    chatSessionScenario(token);
    sleep(3);
  }
}

/**
 * Auth flow for soak test.
 *
 * @param {number} vuId - Virtual user ID
 * @param {number} iterationId - Current iteration number
 * @returns {string|null} JWT token
 */
function authFlowScenario(vuId, iterationId) {
  // Use timestamp to ensure unique emails across the 30-minute test
  const timestamp = Date.now();
  const email = generateTestEmail(`soak-vu${vuId}-it${iterationId}-${timestamp}`);
  const password = 'TestPassword123!';
  const name = `Soak User ${vuId}`;

  registerUser(email, password, name);
  sleep(1);

  return authenticate(email, password);
}

/**
 * Chat session for soak test (full 5 messages to stress LLM and DB).
 *
 * @param {string} token - JWT access token
 */
function chatSessionScenario(token) {
  const sessionId = createChatSession(token, 'Soak Test Session');
  if (!sessionId) return;

  sleep(1);

  // Full 5-message conversation to test context handling over time
  for (let i = 0; i < 5; i++) {
    const question = getRandomInsuranceQuestion();
    sendChatMessage(token, sessionId, question);

    // Realistic pause between messages
    if (i < 4) {
      sleep(3);
    }
  }
}
