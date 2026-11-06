// n8n Code node (Run Once for All Items) - "98 Build failed response"
// Every failure branch (validation, duplicate, data, ai, output_validation) ends here, so Bubble always gets a
// structured Failed/Skipped result with a stage and a human-readable reason - never silence.
const j = $input.first().json;
let p = {};
try { p = $('02 Validate Input').first().json.payload || {}; } catch (e) { p = {}; }

let stage = j.fail_stage;
let message = j.fail_message;
if (j.error) { // an error output of an HTTP node (the OpenAI call)
  const e = j.error;
  stage = 'ai';
  message = 'AI request failed: ' + (e.message || 'unknown error') + (e.httpCode ? ' (HTTP ' + e.httpCode + ')' : '') + (e.description ? ' - ' + String(e.description).slice(0, 200) : '');
}
stage = stage || 'unknown';
message = message || 'Unknown failure';

return [{
  json: {
    http_code: 200,
    response: {
      request_id: p.request_id || '',
      status: stage === 'duplicate' ? 'Skipped' : 'Failed',
      completed_at: new Date().toISOString(),
      email_subject: '',
      email_body: '',
      recipient_email: p.author ? p.author.email : '',
      ai_model: '',
      failure_stage: stage,
      error_message: String(message).slice(0, 900),
      n8n_execution_id: String($execution.id),
      pending_snapshot: p.totals ? p.totals.pending : 0,
      payout_mode: '',
      attempts: 0,
      demo_mode: !!p.demo_mode,
      reference_date_used: p.reference_date || '',
    },
  },
}];
