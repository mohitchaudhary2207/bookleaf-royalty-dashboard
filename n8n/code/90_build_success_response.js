// n8n Code node (Run Once for All Items) - "90 Build success response"
// Output is returned to Bubble as the webhook's HTTP response (Bubble's Free plan cannot receive a separate callback).
const v = $input.first().json; // result of the output validator that passed
const ctx = $('06 Integrity & facts').first().json;
const p = ctx.payload;
return [{
  json: {
    http_code: 200,
    response: {
      request_id: p.request_id,
      status: 'Success',
      completed_at: new Date().toISOString(),
      email_subject: v.email_subject,
      email_body: v.email_body,
      recipient_email: p.author.email,
      ai_model: ctx.model,
      failure_stage: '',
      error_message: '',
      n8n_execution_id: String($execution.id),
      pending_snapshot: p.totals.pending,
      payout_mode: ctx.payout_mode,
      attempts: v.attempt,
      demo_mode: p.demo_mode,
      reference_date_used: p.reference_date,
    },
  },
}];
