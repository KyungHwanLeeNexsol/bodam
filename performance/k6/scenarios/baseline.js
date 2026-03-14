/**
 * K6 Baseline Load Test
 *
 * Scenario: 10 VUs for 1 minute
 * Purpose: Establish performance baseline and verify SLO under normal load
 *
 * SLO Thresholds:
 *   - http_req_duration p95 < 1000ms
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

// Test configuration: 10 VUs for 1 minute
export const options = {
  vus: 10,
  duration: '1m',
  thresholds: {
    // SLO: API p95 < 1s
    http_req_duration: [
      'p(50)<200',
      'p(95)<1000',
      'p(99)<3000',
    ],
    // SLO: error rate < 1%
    http_req_failed: ['rate<0.01'],
    // Health check specific threshold
    'http_req_duration{endpoint:health}': ['p(99)<50'],
  },
};

export { handleSummary };

// Test setup: runs once before the test
export function setup() {
  // Verify the service is available before starting the test
  const healthOk = checkHealth();
  if (!healthOk) {
    console.warn(`[WARN] Health check failed - service may not be ready at ${BASE_URL}`);
  }
  return { baseUrl: BASE_URL };
}

/**
 * Main test function - executed by each VU on each iteration.
 *
 * Runs all three scenarios in sequence:
 * 1. Health check (lightweight)
 * 2. Auth flow (register + login + profile)
 * 3. Chat session (create + send messages)
 */
export default function () {
  const vuId = __VU;
  const iterationId = __ITER;

  // Scenario 1: Health Check (fast, always included)
  healthCheckScenario();
  sleep(0.5);

  // Scenario 2: Auth Flow
  const token = authFlowScenario(vuId, iterationId);
  sleep(1);

  // Scenario 3: Chat Session (requires auth token)
  if (token) {
    chatSessionScenario(token);
    sleep(1);
  }
}

/**
 * Health check scenario.
 */
function healthCheckScenario() {
  checkHealth();
}

/**
 * Auth flow scenario: register -> login -> get profile.
 *
 * @param {number} vuId - Virtual user ID
 * @param {number} iterationId - Current iteration number
 * @returns {string|null} JWT token if successful
 */
function authFlowScenario(vuId, iterationId) {
  const email = generateTestEmail(`baseline-vu${vuId}-it${iterationId}`);
  const password = 'TestPassword123!';
  const name = `Baseline User ${vuId}`;

  // Register new user
  registerUser(email, password, name);
  sleep(0.3);

  // Login and get token
  const token = authenticate(email, password);
  return token;
}

/**
 * Chat session scenario: create session -> send 5 messages.
 *
 * @param {string} token - JWT access token
 */
function chatSessionScenario(token) {
  const sessionId = createChatSession(token, 'Baseline Test Session');
  if (!sessionId) {
    console.log('[INFO] Failed to create chat session - skipping message send');
    return;
  }

  sleep(0.5);

  // Send 5 insurance-related messages
  for (let i = 0; i < 5; i++) {
    const question = getRandomInsuranceQuestion();
    sendChatMessage(token, sessionId, question);

    // Brief pause between messages to simulate real user behavior
    if (i < 4) {
      sleep(2);
    }
  }
}
