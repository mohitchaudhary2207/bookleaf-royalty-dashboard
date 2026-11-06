// n8n Code node (Run Once for All Items) - "09 Validate output" (attempt 1) / "12 Validate output (retry)" (attempt 2)
// Never trust the model: every number, date and required element is checked against the deterministic facts.
const ATTEMPT = 1; // the build script sets this to 2 for the retry node
const ctx = $('06 Integrity & facts').first().json;
const facts = ctx.facts;
const resp = $input.first().json;
const violations = [];
let subject = '';
let body = '';

try {
  const content = resp.choices[0].message.content;
  const j = JSON.parse(content);
  subject = typeof j.subject === 'string' ? j.subject.trim() : '';
  body = typeof j.body === 'string' ? j.body.trim() : '';
} catch (e) {
  violations.push('The model output was not valid JSON with "subject" and "body".');
}
if (!subject) violations.push('Subject is empty.');
if (!body) violations.push('Body is empty.');

if (body) {
  const mode = ctx.payout_mode;
  const flags = facts.scenario_flags;
  const allowedNums = ctx.allowed_numbers;
  const allowedDates = ctx.allowed_dates;
  const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

  // 1. number whitelist
  const nums = body.match(/\d[\d,]*/g) || [];
  nums.forEach((t) => {
    const n = t.replace(/,+$/, '').replace(/,/g, '');
    if (allowedNums.indexOf(n) < 0) violations.push('Unknown number "' + t + '" (not in FACTS).');
  });

  // 2. date whitelist
  const dateRe = new RegExp('\\b\\d{1,2} (?:' + MONTHS + ') \\d{4}\\b', 'g');
  (body.match(dateRe) || []).forEach((dt) => {
    if (allowedDates.indexOf(dt) < 0) violations.push('Date "' + dt + '" is not allowed here.');
  });

  // 3. required content
  if (body.slice(0, 160).indexOf(facts.author_first_name) < 0) violations.push('The greeting must use the author\'s first name.');
  facts.published_books.forEach((b) => { if (body.indexOf(b.title) < 0) violations.push('Missing published book "' + b.title + '".'); });
  facts.production_books.forEach((b) => { if (body.indexOf(b.title) < 0) violations.push('Missing in-production book "' + b.title + '".'); });
  ['earned', 'paid', 'pending'].forEach((k) => { if (body.indexOf(facts.totals[k]) < 0) violations.push('Missing total ' + k + ' (' + facts.totals[k] + ').'); });
  if (!/Warm regards,\s*\n?\s*The BookLeaf Team\s*$/.test(body)) violations.push('The email must end with "Warm regards," then "The BookLeaf Team".');

  // 4. mode-specific rules
  if (mode === 'ALL_PAID') {
    if (/outstanding|next payout|due by|will be paid|upcoming payout/i.test(body)) violations.push('All-paid email must not mention outstanding amounts or upcoming payouts.');
  }
  if (mode === 'OVERDUE') {
    if (/\b(soon|shortly|within the next|by the end of)\b/i.test(body)) violations.push('Overdue email must not use timing promises (soon/shortly/within the next/by the end of).');
    if (/will be (paid|credited|processed|released|transferred|disbursed)/i.test(body)) violations.push('Overdue email must not promise a future payment.');
  }
  if (mode === 'IN_CYCLE') {
    if (facts.payout_policy.standard_due_by && body.indexOf(facts.payout_policy.standard_due_by) < 0) violations.push('Must state the standard due date ' + facts.payout_policy.standard_due_by + '.');
  }
  if (mode === 'BELOW_THRESHOLD' && /\b(overdue|late|delay\w*)\b/i.test(body)) violations.push('Below-minimum email must not call the amount overdue, late or delayed.');
  if (/\*\*|^#{1,6}\s/m.test(body)) violations.push('Plain text only: markdown symbols are not allowed.');
  if (facts.production_books.length === 0 && /production/i.test(body)) violations.push('Mentions production although no book is in production.');
  if (mode === 'OVERDUE' && !facts.payout_policy.date_statement_allowed && ctx.allowed_dates.length && /\bdue by\b/i.test(body)) violations.push('Overdue email must not state a due-by date.');
  if (flags.indexOf('BELOW_THRESHOLD') >= 0) {
    if (body.indexOf(facts.payout_policy.minimum_payout) < 0 || !/next quarter/i.test(body)) violations.push('Must explain the minimum payout and rollover to the next quarter.');
  }

  // 5. forbidden patterns
  if (/\[|\]|\{\{|\}\}|TODO|guarantee|as an AI|\bAI\b|FACTS/i.test(body + ' ' + subject)) violations.push('Contains a placeholder, "guarantee", or a reference to AI/FACTS.');
  if (!ctx.escalation_commitment_enabled) {
    const stripped = body.replace(/45[- ]days?/gi, '');
    if (/\b(within|in)\s+(a|an|one|two|three|\d+)\s+(hours?|days?|business days?)\b/i.test(stripped)) violations.push('Contains a response-time commitment, which is not enabled.');
  }

  // 6. length
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < 80 || words > 450) violations.push('Length ' + words + ' words is outside 80-450.');
}

const ok = violations.length === 0;
const out = { ok, violations, attempt: ATTEMPT, email_subject: subject, email_body: body, fail_stage: ok ? '' : 'output_validation', fail_message: ok ? '' : 'AI output failed validation after ' + ATTEMPT + ' attempt(s): ' + violations.join(' | ') };

if (!ok && ATTEMPT === 1) {
  const retryBody = JSON.parse(JSON.stringify(ctx.openai_body));
  retryBody.messages.push({ role: 'assistant', content: JSON.stringify({ subject, body }) });
  retryBody.messages.push({ role: 'user', content: 'Your draft broke these rules:\n- ' + violations.join('\n- ') + '\nWrite the email again, fixing every point. Use only numbers and dates from FACTS.' });
  out.openai_body_retry = retryBody;
}
return [{ json: out }];
