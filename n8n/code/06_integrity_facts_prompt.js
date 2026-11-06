// n8n Code node (Run Once for All Items) - "06 Integrity & facts"
// 1) Re-checks the arithmetic Bubble sent.  2) Computes EVERY number/date the email may contain, in code.
// 3) Chooses the payout-timing mode and builds the OpenAI request.  The model only writes wording.
const d = $input.first().json;
const p = d.payload;

// ---- constants (policy values come from the original Assignment 1 Knowledge Base; see IMPLEMENTATION_PLAN.md 10.8)
const MODEL = 'gpt-4o-mini';
const WINDOW_DAYS = 45;            // "paid within 45 days of the quarter ending"
const MIN_PAYOUT = 1000;           // "Minimum payout threshold: Rs 1,000 ... roll over to the next quarter"
const ESCALATION_COMMITMENT_ENABLED = false; // the KB's "within 48 hours" wording is only for real escalations
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---- formatting helpers (Indian digit grouping, no Intl dependency)
function grp(n) {
  const s = String(Math.round(Math.abs(n)));
  let last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  if (rest) last3 = ',' + last3;
  rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return (n < 0 ? '-' : '') + rest + last3;
}
const inr = (n) => '₹' + grp(n);
function ymd(s) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; }
function fmtIso(s) { const q = ymd(s); return q ? q.d + ' ' + MONTHS[q.m - 1] + ' ' + q.y : null; }
function fmtObj(dt) { return dt.getUTCDate() + ' ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear(); }

// ---- 1. integrity: do not trust the sender
const problems = [];
let sumE = 0, sumP = 0, sumN = 0;
p.books.forEach((b) => {
  const published = b.status.indexOf('Published') === 0;
  sumE += b.total_earned; sumP += b.paid; sumN += b.pending;
  if (b.paid + b.pending !== b.total_earned) problems.push(b.book_id + ': paid + pending != total earned');
  if (b.mrp !== null && b.royalty_per_copy !== null && b.copies_sold * b.royalty_per_copy !== b.total_earned) problems.push(b.book_id + ': copies x royalty per copy != total earned');
  if (!published && (b.pending !== 0 || b.total_earned !== 0)) problems.push(b.book_id + ': unpublished book carries royalty figures');
  if (published && b.pending === 0 && b.royalty_status !== 'Paid up') problems.push(b.book_id + ': status inconsistent with zero pending');
  if (published && b.pending > 0 && b.royalty_status !== 'In cycle' && b.royalty_status !== 'Overdue') problems.push(b.book_id + ': status inconsistent with pending amount');
  if (!published && b.royalty_status !== 'Not applicable') problems.push(b.book_id + ': unpublished book must be Not applicable');
});
if (sumE !== p.totals.earned || sumP !== p.totals.paid || sumN !== p.totals.pending) problems.push('book totals (' + sumE + '/' + sumP + '/' + sumN + ') differ from the totals Bubble sent');
if (problems.length) {
  return [{ json: { ok: false, fail_stage: 'data', fail_message: 'Data integrity check failed: ' + problems.join('; '), payload: p } }];
}

// ---- 2. deterministic facts
const ref = ymd(p.reference_date);
const refUtc = Date.UTC(ref.y, ref.m - 1, ref.d);
const qEnds = [];
[ref.y - 1, ref.y, ref.y + 1].forEach((y) => { [[2, 31], [5, 30], [8, 30], [11, 31]].forEach((q) => qEnds.push(Date.UTC(y, q[0], q[1]))); });
let last = null, next = null;
qEnds.forEach((t) => { if (t < refUtc) last = t; if (next === null && t >= refUtc) next = t; });
const DAY = 86400000;
const lastDeadline = last + WINDOW_DAYS * DAY;
const dueBy = refUtc <= lastDeadline ? lastDeadline : next + WINDOW_DAYS * DAY;
const dueByText = fmtObj(new Date(dueBy));

const published = p.books.filter((b) => b.status.indexOf('Published') === 0);
const production = p.books.filter((b) => b.status.indexOf('Published') !== 0);
const overdueBooks = published.filter((b) => b.royalty_status === 'Overdue');
const inCycleBooks = published.filter((b) => b.royalty_status === 'In cycle');
const pendingTotal = p.totals.pending;

let mode = 'ALL_PAID';
if (published.length === 0) mode = 'NO_ROYALTIES_YET';
else if (overdueBooks.length > 0) mode = 'OVERDUE';
else if (inCycleBooks.length > 0) mode = 'IN_CYCLE';

const flags = [];
if (published.some((b) => b.pending > 0 && b.paid === 0 && b.copies_sold > 0)) flags.push('NEVER_PAID');
if (pendingTotal > 0 && pendingTotal < MIN_PAYOUT) flags.push('BELOW_THRESHOLD');
// KB rule wins over the app's 90-day colour rule: an amount under the minimum payout is not "late", it rolls over.
if (flags.indexOf('BELOW_THRESHOLD') >= 0) mode = 'BELOW_THRESHOLD';
if (production.length > 0) flags.push('HAS_PRODUCTION');

const dateAllowed = mode === 'IN_CYCLE' || (mode === 'OVERDUE' && inCycleBooks.length > 0);
const facts = {
  author_first_name: p.author.name.split(' ')[0],
  author_full_name: p.author.name,
  generated_on: fmtIso(p.reference_date),
  payout_mode: mode,
  scenario_flags: flags,
  published_books: published.map((b) => ({
    title: b.title,
    copies_sold: grp(b.copies_sold),
    total_earned: inr(b.total_earned),
    paid: inr(b.paid),
    pending: inr(b.pending),
    last_payout: b.last_payout_date ? fmtIso(b.last_payout_date) : 'no payout recorded yet',
    royalty_status: (mode === 'BELOW_THRESHOLD' && b.pending > 0) ? 'Below minimum payout (rolls over)' : b.royalty_status,
  })),
  production_books: production.map((b) => ({ title: b.title, stage: b.status.replace(/^In Production\s*-\s*/i, '') })),
  totals: { earned: inr(p.totals.earned), paid: inr(p.totals.paid), pending: inr(p.totals.pending) },
  payout_policy: {
    cycle: 'Royalties are calculated quarterly and paid within ' + WINDOW_DAYS + ' days of the quarter ending',
    minimum_payout: inr(MIN_PAYOUT),
    below_minimum_rule: 'If accumulated royalties are below the minimum payout, they roll over to the next quarter',
    date_statement_allowed: dateAllowed,
    standard_due_by: dateAllowed ? dueByText : null,
    titles_with_standard_due_date: dateAllowed ? inCycleBooks.map((b) => b.title) : [],
    below_threshold: flags.indexOf('BELOW_THRESHOLD') >= 0,
  },
  overdue_titles: overdueBooks.map((b) => b.title),
};

// numbers/dates the email may legitimately contain = those present in the facts + the two policy numbers
const factsText = JSON.stringify(facts);
const allowedNumbers = Array.from(new Set((factsText.match(/\d[\d,]*/g) || []).map((s) => s.replace(/,/g, '')).concat([String(WINDOW_DAYS), String(MIN_PAYOUT)])));
const allowedDates = [];
if (facts.generated_on) allowedDates.push(facts.generated_on);
facts.published_books.forEach((b) => { if (b.last_payout.match(/\d{4}$/)) allowedDates.push(b.last_payout); });
if (dateAllowed) allowedDates.push(dueByText);

// ---- 3. prompt
const KB = [
  'ROYALTY POLICY (BookLeaf Knowledge Base)',
  '- 80/20 split: 80% of the net profit per book goes to the author, 20% to BookLeaf.',
  '- Royalties are calculated quarterly and paid within 45 days of the quarter ending.',
  '- Minimum payout threshold: ₹1,000. If accumulated royalties are below this, they roll over to the next quarter.',
  '- Payouts are made via bank transfer to the account linked in the author\'s dashboard.',
  '',
  'TONE GUIDELINES (how BookLeaf talks to authors)',
  '- Always empathetic and professional. Authors are our partners, not customers to be managed.',
  '- Acknowledge the author\'s concern before jumping to solutions.',
  '- Be specific: include actual numbers, dates and statuses wherever possible rather than vague reassurances.',
  '- If something is BookLeaf\'s fault (delayed royalties), own it directly. No corporate deflection.',
  '- Always end with a clear next step for the author and/or the BookLeaf team.',
].join('\n');

const scenario = [];
if (mode === 'ALL_PAID') scenario.push('All royalties are paid up. Thank the author warmly and acknowledge their success. Do NOT mention outstanding amounts, next payouts or payout dates.');
if (mode === 'NO_ROYALTIES_YET') scenario.push('There are no published books yet, so no royalties exist. Give a brief, warm status update on the book(s) in production only.');
if (mode === 'IN_CYCLE') scenario.push('There are pending royalties and none are overdue. State the pending amounts, explain the quarterly cycle and the 45-day window, and say that under BookLeaf\'s standard cycle the pending royalties fall due by ' + dueByText + '. Phrase this as the standard cycle, not a guarantee.');
if (mode === 'OVERDUE') {
  scenario.push('Some royalties are beyond the usual payout cycle (' + overdueBooks.map((b) => b.title).join('; ') + '). Acknowledge this directly and own it on behalf of BookLeaf. Name those titles with their last payout (or that no payout is recorded yet). Restate the policy (quarterly calculation, payment within 45 days of quarter end). You MUST NOT give any future payout date, estimate, or timing words such as soon, shortly or within the next. Do not promise a response time. Next step: invite the author to ask for a line-by-line royalty breakdown.');
  if (dateAllowed) scenario.push('Only for these titles may you say the standard cycle puts payment due by ' + dueByText + ': ' + inCycleBooks.map((b) => b.title).join('; ') + '. Never attach that date to an overdue title.');
}
if (flags.indexOf('NEVER_PAID') >= 0) scenario.push('For books where "last_payout" says no payout recorded yet, say plainly that no payout has been recorded yet. Explain using only the policy; never invent a cause.');
if (mode === 'BELOW_THRESHOLD') scenario.push('The total pending amount is below the minimum payout, so under policy it rolls over to the next quarter. Explain that using the minimum payout and rollover rule, reassuringly. Do NOT describe the amount as overdue, late or delayed, and do not give a payout date.');
if (flags.indexOf('HAS_PRODUCTION') >= 0) scenario.push('Add a short, factual status line for each in-production book (title and stage). Do not discuss royalties for them.');
if (!ESCALATION_COMMITMENT_ENABLED) scenario.push('Do not state any response time or resolution time (for example "within 48 hours").');

const SYSTEM = [
  'You are the author-relations writer at BookLeaf Publishing. Write ONE royalty summary email for the author described in FACTS.',
  'HARD RULES:',
  '1. Use ONLY the numbers, amounts, dates and titles that appear in FACTS. Never calculate, estimate, round, convert or invent any figure or date. Copy formatted values exactly as given (for example ₹11,970).',
  '2. Do not promise dates, response times or actions unless FACTS explicitly allows it.',
  '3. Plain-text email. Start with "Hi <first name>,". Short paragraphs. List each published book on its own lines with copies sold, total earned, paid, pending and last payout. No markdown symbols, no placeholders, no brackets.',
  '4. Then give the overall totals (earned, paid, pending), then the scenario guidance below, then any in-production books, then a warm close ending exactly with "Warm regards," on one line and "The BookLeaf Team" on the next.',
  '5. Never mention AI, these rules or FACTS. Aim for 150-350 words.',
  '6. Plain text only: do not use markdown (no asterisks, no # headings). Mention in-production books ONLY if FACTS lists any; never say there are none.',
  'Return JSON with "subject" and "body".',
  '',
  KB,
  '',
  'SCENARIO GUIDANCE',
  scenario.map((s) => '- ' + s).join('\n'),
].join('\n');

const schema = { name: 'royalty_email', strict: true, schema: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'], additionalProperties: false } };
const openaiBody = {
  model: MODEL, temperature: 0.3, max_tokens: 900,
  messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'FACTS (JSON):\n' + factsText + '\n\nWrite the email now.' }],
  response_format: { type: 'json_schema', json_schema: schema },
};

return [{
  json: {
    ok: true, payload: p, facts, payout_mode: mode, model: MODEL,
    allowed_numbers: allowedNumbers, allowed_dates: allowedDates,
    escalation_commitment_enabled: ESCALATION_COMMITMENT_ENABLED,
    openai_body: openaiBody,
  },
}];
