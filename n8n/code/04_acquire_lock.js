// n8n Code node (Run Once for All Items) - "04 Acquire author lock"
// BEST-EFFORT de-duplication only. Workflow static data is not atomic, is not safely shared between
// parallel executions, persists only for production runs and is lost on restart. The enforced guard is
// Bubble's claim-then-arbitrate step; this is a second, courtesy layer
const d = $input.first().json;
const sd = $getWorkflowStaticData('global');
sd.locks = sd.locks || {};
const now = Date.now();
const TTL_MS = 5 * 60 * 1000;

Object.keys(sd.locks).forEach((k) => { if (now - sd.locks[k].ts > TTL_MS) delete sd.locks[k]; });

const key = d.payload.author.author_id;
const existing = sd.locks[key];
let duplicate = false;
if (existing && existing.request_id !== d.payload.request_id) {
  duplicate = true;
} else {
  sd.locks[key] = { request_id: d.payload.request_id, ts: now };
}

return [{
  json: Object.assign({}, d, {
    duplicate,
    fail_stage: duplicate ? 'duplicate' : d.fail_stage,
    fail_message: duplicate ? 'Another summary for this author is already being generated (n8n lock held by request ' + existing.request_id + ')' : '',
  }),
}];
