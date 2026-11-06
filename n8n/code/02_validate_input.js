// n8n Code node (Run Once for All Items) - "02 Validate Input"
// Checks the shape of the payload sent by Bubble and normalises numbers. It never trusts the sender:
// anything missing/invalid becomes a validation failure that is returned to Bubble as status "Failed".
const item = $input.first().json;
const b = (item && item.body) || {};
const errors = [];

const isStr = (v) => typeof v === 'string' && v.trim().length > 0;
// tolerant of how Bubble prints numbers inside text (e.g. "3,570" or "₹3570"), strict about everything else
const toNum = (v) => {
  if (v === null || v === undefined) return NaN;
  const s = String(v).replace(/[,\s₹]/g, '');
  return s === '' ? NaN : Number(s);
};
const optStr = (v) => (v === null || v === undefined ? '' : String(v));

// Bubble's API Connector substitutes a saved sample value when a field is empty. The sample values are the
// marker "__MISSING__", so an empty field can never turn into believable data - it fails here instead.
if (JSON.stringify(b).indexOf('__MISSING__') >= 0) errors.push('a required field was empty in the request from Bubble');
if (!isStr(b.request_id)) errors.push('request_id is missing');
if (!b.author || !isStr(b.author.author_id) || !isStr(b.author.name)) errors.push('author.author_id and author.name are required');
if (!/^\d{4}-\d{2}-\d{2}/.test(String(b.reference_date || ''))) errors.push('reference_date must be YYYY-MM-DD');

let books = b.books;
if (typeof books === 'string') {
  try { books = JSON.parse(books); } catch (e) { errors.push('books is not valid JSON'); books = null; }
}
if (!Array.isArray(books) || books.length < 1) errors.push('books must be a non-empty array');

const STATUSES = ['Paid up', 'In cycle', 'Overdue', 'Not applicable'];
const clean = [];
(Array.isArray(books) ? books : []).forEach((bk, i) => {
  const tag = 'books[' + i + ']';
  if (!bk || !isStr(bk.book_id) || !isStr(bk.title)) { errors.push(tag + ' needs book_id and title'); return; }
  if (!isStr(bk.status)) errors.push(tag + '.status is missing');
  const nums = {};
  ['copies_sold', 'total_earned', 'paid', 'pending'].forEach((k) => {
    const n = toNum(bk[k]);
    if (Number.isNaN(n) || n < 0) errors.push(tag + '.' + k + ' must be a number >= 0');
    nums[k] = n;
  });
  if (!STATUSES.includes(bk.royalty_status)) errors.push(tag + '.royalty_status must be one of ' + STATUSES.join('/'));
  clean.push({
    book_id: String(bk.book_id), title: String(bk.title), status: optStr(bk.status),
    publication_date: optStr(bk.publication_date).slice(0, 10), last_payout_date: optStr(bk.last_payout_date).slice(0, 10),
    mrp: bk.mrp === null || bk.mrp === undefined || bk.mrp === '' ? null : toNum(bk.mrp),
    royalty_per_copy: bk.royalty_per_copy === null || bk.royalty_per_copy === undefined || bk.royalty_per_copy === '' ? null : toNum(bk.royalty_per_copy),
    copies_sold: nums.copies_sold, total_earned: nums.total_earned, paid: nums.paid, pending: nums.pending,
    royalty_status: bk.royalty_status,
  });
});

const t = b.totals || {};
const totals = { earned: toNum(t.earned), paid: toNum(t.paid), pending: toNum(t.pending) };
['earned', 'paid', 'pending'].forEach((k) => { if (Number.isNaN(totals[k])) errors.push('totals.' + k + ' must be a number'); });

return [{
  json: {
    ok: errors.length === 0,
    errors,
    fail_stage: 'validation',
    fail_message: errors.join('; '),
    payload: {
      request_id: optStr(b.request_id),
      trigger_type: optStr(b.trigger_type),
      batch_id: optStr(b.batch_id) === 'null' ? '' : optStr(b.batch_id),
      requested_by: optStr(b.requested_by),
      requested_at: optStr(b.requested_at),
      reference_date: optStr(b.reference_date).slice(0, 10),
      demo_mode: b.demo_mode === true || b.demo_mode === 'true',
      author: {
        author_id: b.author ? optStr(b.author.author_id) : '', name: b.author ? optStr(b.author.name) : '',
        email: b.author ? optStr(b.author.email) : '', city: b.author ? optStr(b.author.city) : '',
      },
      books: clean,
      totals,
    },
  },
}];
