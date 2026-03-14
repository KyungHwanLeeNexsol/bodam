/**
 * K6 Custom Summary Handler and HTML Report Generator
 * Generates HTML performance reports from k6 test results
 */

/**
 * Custom handleSummary function for k6.
 * Generates an HTML report and JSON summary from test results.
 *
 * Usage: export { handleSummary } from './lib/reporters.js';
 *
 * @param {Object} data - K6 summary data object
 * @returns {Object} Output files to write
 */
export function handleSummary(data) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = `performance-report-${timestamp}.html`;
  const summaryPath = `performance-summary-${timestamp}.json`;

  return {
    [reportPath]: generateHtmlReport(data),
    [summaryPath]: JSON.stringify(data, null, 2),
    stdout: generateTextSummary(data),
  };
}

/**
 * Generate an HTML report from k6 summary data.
 *
 * @param {Object} data - K6 summary data
 * @returns {string} HTML report content
 */
function generateHtmlReport(data) {
  const metrics = extractMetrics(data);
  const status = data.state.testRunDurationMs
    ? formatDuration(data.state.testRunDurationMs)
    : 'N/A';
  const passedThresholds = countThresholds(data, true);
  const failedThresholds = countThresholds(data, false);
  const overallStatus = failedThresholds === 0 ? 'PASS' : 'FAIL';
  const statusColor = overallStatus === 'PASS' ? '#28a745' : '#dc3545';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bodam Performance Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; }
    .header { background: #1a1a2e; color: white; padding: 24px 32px; }
    .header h1 { font-size: 24px; margin-bottom: 4px; }
    .header p { color: #aaa; font-size: 14px; }
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; color: white; background: ${statusColor}; margin-left: 12px; }
    .container { max-width: 1200px; margin: 24px auto; padding: 0 24px; }
    .card { background: white; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card h2 { font-size: 18px; margin-bottom: 16px; color: #1a1a2e; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
    .metrics-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .metric { background: #f8f9fa; border-radius: 6px; padding: 16px; text-align: center; }
    .metric-label { font-size: 12px; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .metric-value { font-size: 24px; font-weight: bold; color: #1a1a2e; }
    .metric-unit { font-size: 12px; color: #888; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8f9fa; padding: 10px 12px; text-align: left; font-size: 13px; color: #555; border-bottom: 2px solid #e0e0e0; }
    td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; font-size: 14px; }
    .pass { color: #28a745; font-weight: bold; }
    .fail { color: #dc3545; font-weight: bold; }
    .footer { text-align: center; color: #aaa; font-size: 12px; padding: 24px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Bodam Performance Report <span class="status-badge">${overallStatus}</span></h1>
    <p>Generated: ${new Date().toISOString()} | Duration: ${status}</p>
  </div>
  <div class="container">
    <div class="card">
      <h2>Summary</h2>
      <div class="metrics-grid">
        <div class="metric">
          <div class="metric-label">Total Requests</div>
          <div class="metric-value">${metrics.totalRequests}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Failed Requests</div>
          <div class="metric-value">${metrics.failedRequests}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Req/sec</div>
          <div class="metric-value">${metrics.reqPerSec}</div>
        </div>
        <div class="metric">
          <div class="metric-label">p95 Response</div>
          <div class="metric-value">${metrics.p95}</div>
          <div class="metric-unit">ms</div>
        </div>
        <div class="metric">
          <div class="metric-label">Thresholds Passed</div>
          <div class="metric-value" style="color:#28a745">${passedThresholds}</div>
        </div>
        <div class="metric">
          <div class="metric-label">Thresholds Failed</div>
          <div class="metric-value" style="color:${failedThresholds > 0 ? '#dc3545' : '#28a745'}">${failedThresholds}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>HTTP Metrics</h2>
      <table>
        <thead>
          <tr><th>Metric</th><th>Avg</th><th>p50</th><th>p90</th><th>p95</th><th>p99</th><th>Max</th></tr>
        </thead>
        <tbody>
          ${generateMetricsRows(data)}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Threshold Results</h2>
      <table>
        <thead>
          <tr><th>Threshold</th><th>Result</th></tr>
        </thead>
        <tbody>
          ${generateThresholdRows(data)}
        </tbody>
      </table>
    </div>
  </div>
  <div class="footer">Bodam Performance Testing Suite | k6</div>
</body>
</html>`;
}

/**
 * Generate a text summary for stdout output.
 *
 * @param {Object} data - K6 summary data
 * @returns {string} Text summary
 */
function generateTextSummary(data) {
  const metrics = extractMetrics(data);
  const failedThresholds = countThresholds(data, false);
  const status = failedThresholds === 0 ? 'PASS' : 'FAIL';

  return `
=== Bodam Performance Test Summary ===
Status: ${status}
Total Requests: ${metrics.totalRequests}
Failed Requests: ${metrics.failedRequests}
Requests/sec: ${metrics.reqPerSec}
p95 Response Time: ${metrics.p95}ms
Failed Thresholds: ${failedThresholds}
=====================================
`;
}

/**
 * Extract key metrics from k6 summary data.
 *
 * @param {Object} data - K6 summary data
 * @returns {Object} Extracted metric values
 */
function extractMetrics(data) {
  const httpReqs = data.metrics['http_reqs'];
  const httpDuration = data.metrics['http_req_duration'];

  return {
    totalRequests: httpReqs ? Math.round(httpReqs.values.count || 0) : 0,
    failedRequests: data.metrics['http_req_failed']
      ? Math.round((data.metrics['http_req_failed'].values.rate || 0) * (httpReqs ? httpReqs.values.count : 0))
      : 0,
    reqPerSec: httpReqs ? (httpReqs.values.rate || 0).toFixed(2) : '0',
    p95: httpDuration ? Math.round(httpDuration.values['p(95)'] || 0) : 0,
  };
}

/**
 * Count thresholds by pass/fail status.
 *
 * @param {Object} data - K6 summary data
 * @param {boolean} passed - true to count passed, false to count failed
 * @returns {number} Count of thresholds
 */
function countThresholds(data, passed) {
  if (!data.metrics) return 0;
  let count = 0;
  for (const metric of Object.values(data.metrics)) {
    if (metric.thresholds) {
      for (const threshold of Object.values(metric.thresholds)) {
        if (threshold.ok === passed) count++;
      }
    }
  }
  return count;
}

/**
 * Generate HTML table rows for HTTP metrics.
 *
 * @param {Object} data - K6 summary data
 * @returns {string} HTML table rows
 */
function generateMetricsRows(data) {
  const durationMetric = data.metrics['http_req_duration'];
  if (!durationMetric) return '<tr><td colspan="7">No duration data</td></tr>';

  const v = durationMetric.values;
  return `<tr>
    <td>http_req_duration</td>
    <td>${Math.round(v.avg || 0)}ms</td>
    <td>${Math.round(v['p(50)'] || 0)}ms</td>
    <td>${Math.round(v['p(90)'] || 0)}ms</td>
    <td>${Math.round(v['p(95)'] || 0)}ms</td>
    <td>${Math.round(v['p(99)'] || 0)}ms</td>
    <td>${Math.round(v.max || 0)}ms</td>
  </tr>`;
}

/**
 * Generate HTML table rows for threshold results.
 *
 * @param {Object} data - K6 summary data
 * @returns {string} HTML table rows
 */
function generateThresholdRows(data) {
  const rows = [];
  if (!data.metrics) return '<tr><td colspan="2">No threshold data</td></tr>';

  for (const [metricName, metric] of Object.entries(data.metrics)) {
    if (metric.thresholds) {
      for (const [condition, result] of Object.entries(metric.thresholds)) {
        const statusClass = result.ok ? 'pass' : 'fail';
        const statusText = result.ok ? 'PASS' : 'FAIL';
        rows.push(`<tr>
          <td>${metricName}: ${condition}</td>
          <td class="${statusClass}">${statusText}</td>
        </tr>`);
      }
    }
  }

  return rows.length > 0 ? rows.join('') : '<tr><td colspan="2">No thresholds defined</td></tr>';
}

/**
 * Format duration in milliseconds to human-readable string.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
