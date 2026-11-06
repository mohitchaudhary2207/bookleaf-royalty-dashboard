// n8n Code node (Run Once for All Items) - "99 Release author lock" (runs after the response has been sent)
// Releases only the lock this request owns, so a duplicate request can never release the original's lock.
let p = null;
try { p = $('02 Validate Input').first().json.payload; } catch (e) { p = null; }
if (p && p.author && p.author.author_id) {
  const sd = $getWorkflowStaticData('global');
  if (sd.locks && sd.locks[p.author.author_id] && sd.locks[p.author.author_id].request_id === p.request_id) {
    delete sd.locks[p.author.author_id];
  }
}
return [{ json: { released: true } }];
