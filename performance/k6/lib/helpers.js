/**
 * K6 Load Test Helpers
 * Common utilities for Bodam performance tests
 */

import http from 'k6/http';
import { check, sleep } from 'k6';

// Base URL from environment variable with fallback
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

// Default headers for JSON API requests
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

/**
 * Authenticate a user and return the JWT token.
 * Performs registration (if needed) then login.
 *
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {string|null} JWT access token or null on failure
 */
export function authenticate(email, password) {
  const loginPayload = JSON.stringify({ email, password });

  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    loginPayload,
    { headers: JSON_HEADERS }
  );

  const loginOk = check(loginRes, {
    'login status is 200': (r) => r.status === 200,
    'login has access_token': (r) => {
      try {
        return JSON.parse(r.body).access_token !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!loginOk) {
    return null;
  }

  try {
    return JSON.parse(loginRes.body).access_token;
  } catch {
    return null;
  }
}

/**
 * Register a new test user.
 *
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {string} name - User display name
 * @returns {boolean} true if registration succeeded
 */
export function registerUser(email, password, name) {
  const payload = JSON.stringify({ email, password, name });

  const res = http.post(
    `${BASE_URL}/api/v1/auth/register`,
    payload,
    { headers: JSON_HEADERS }
  );

  return check(res, {
    'register status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
}

/**
 * Get auth headers for an authenticated request.
 *
 * @param {string} token - JWT access token
 * @returns {Object} headers object with Authorization
 */
export function authHeaders(token) {
  return {
    ...JSON_HEADERS,
    'Authorization': `Bearer ${token}`,
  };
}

/**
 * Create a new chat session for the authenticated user.
 *
 * @param {string} token - JWT access token
 * @param {string} title - Session title
 * @returns {string|null} Session ID or null on failure
 */
export function createChatSession(token, title) {
  const payload = JSON.stringify({ title: title || 'Performance Test Session' });

  const res = http.post(
    `${BASE_URL}/api/v1/chat/sessions`,
    payload,
    { headers: authHeaders(token) }
  );

  const ok = check(res, {
    'create session status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'create session has id': (r) => {
      try {
        return JSON.parse(r.body).id !== undefined;
      } catch {
        return false;
      }
    },
  });

  if (!ok) {
    return null;
  }

  try {
    return JSON.parse(res.body).id;
  } catch {
    return null;
  }
}

/**
 * Send a chat message to an existing session.
 *
 * @param {string} token - JWT access token
 * @param {string} sessionId - Chat session ID
 * @param {string} message - Message content
 * @returns {boolean} true if message was sent successfully
 */
export function sendChatMessage(token, sessionId, message) {
  const payload = JSON.stringify({ content: message });

  const res = http.post(
    `${BASE_URL}/api/v1/chat/sessions/${sessionId}/messages`,
    payload,
    {
      headers: authHeaders(token),
      timeout: '35s', // LLM API can take up to 30s
    }
  );

  return check(res, {
    'send message status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
}

/**
 * Check system health endpoint.
 *
 * @returns {boolean} true if system is healthy
 */
export function checkHealth() {
  const res = http.get(`${BASE_URL}/health`);

  return check(res, {
    'health status is 200': (r) => r.status === 200,
    'health response time < 100ms': (r) => r.timings.duration < 100,
  });
}

/**
 * Generate a unique test email address.
 *
 * @param {string} prefix - Email prefix
 * @returns {string} Unique email address
 */
export function generateTestEmail(prefix) {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `${prefix}-${timestamp}-${random}@perf-test.bodam.io`;
}

/**
 * Sample insurance-related questions for chat performance testing.
 */
export const SAMPLE_INSURANCE_QUESTIONS = [
  '실손 보험에서 본인 부담금 한도는 얼마인가요?',
  '암보험 진단비 지급 기준을 알려주세요.',
  '교통사고 시 자동차보험 처리 절차는 어떻게 되나요?',
  '치아보험 임플란트 보장 범위가 어떻게 되나요?',
  '종신보험과 정기보험의 차이점은 무엇인가요?',
  '뇌졸중 진단비 보험금 청구 방법을 알려주세요.',
  '화재보험 가입 시 주의사항은 무엇인가요?',
  '운전자보험에서 보장하는 항목을 설명해주세요.',
];

/**
 * Get a random insurance question from the sample list.
 *
 * @returns {string} Random insurance question
 */
export function getRandomInsuranceQuestion() {
  return SAMPLE_INSURANCE_QUESTIONS[
    Math.floor(Math.random() * SAMPLE_INSURANCE_QUESTIONS.length)
  ];
}

/**
 * Validate that an API response contains expected fields.
 *
 * @param {Object} res - K6 HTTP response object
 * @param {Array<string>} fields - Required field names
 * @returns {boolean} true if all fields are present
 */
export function validateResponseFields(res, fields) {
  try {
    const body = JSON.parse(res.body);
    return fields.every((field) => body[field] !== undefined);
  } catch {
    return false;
  }
}
