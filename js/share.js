/* Clipboard, share sheet, export/import payloads.
 *
 * iOS rule: navigator.clipboard.writeText must be *called* synchronously
 * inside the tap handler. Await anything first and Safari silently rejects.
 * So every function here builds its string eagerly and never awaits before
 * the write.
 */

import * as store from './store.js';
import * as bank from './bank.js';
import { plaintext } from './mathtext.js';
import { toast } from './ui.js';

/** Sync-safe copy with an execCommand fallback for insecure contexts. */
export function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
      return true;
    }
  } catch { /* fall through */ }
  return legacyCopy(text);
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.append(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export const exportText = () => JSON.stringify(store.buildExport(bank.allIds()), null, 2);

export function exportToClipboard() {
  const text = exportText();
  const ok = copyText(text);
  store.setMeta({ lastExportAt: store.today() });
  toast(ok
    ? 'Progress copied. Paste it somewhere safe.'
    : 'Copy failed — use Share instead.');
  return ok;
}

export const canShare = () => typeof navigator.share === 'function';

export async function shareExport() {
  if (!canShare()) return false;
  const text = exportText();
  try {
    await navigator.share({ title: 'AI Quiz progress', text });
    store.setMeta({ lastExportAt: store.today() });
    return true;
  } catch (err) {
    // A cancelled share sheet rejects with AbortError. Not an error.
    if (err?.name !== 'AbortError') toast('Share failed.');
    return false;
  }
}

/**
 * Payload for the Claude iOS app: the question, what they picked, what the
 * right answer was, and any pattern of repeated wrong picks.
 */
export function askClaudePayload(q, picked) {
  const rec = store.getRecord(q.id);
  const lines = [
    "I'm studying for AI/MLE interviews and got this quiz question wrong. Explain it to me from first principles, then give me one similar practice question.",
    '',
    `Topic: ${q.topic} (week ${q.week})`,
    `Question: ${plaintext(q.prompt)}`,
    '',
    'Options:',
    ...q.options.map((o, i) => `  ${i === q.answer ? '✓' : ' '} ${plaintext(o)}`),
    '',
    `I picked: ${plaintext(q.options[picked] ?? '(skipped)')}`,
    `Correct answer: ${plaintext(q.options[q.answer])}`,
    '',
    `The app's explanation: ${plaintext(q.explanation)}`,
  ];
  if (rec && rec.wrongPicks?.length > 1) {
    lines.push('', `Note: I've picked ${rec.wrongPicks.length} different wrong answers on this one across ${rec.n} attempts, so something conceptual isn't landing.`);
  }
  return lines.join('\n');
}

export function copyAskClaude(q, picked) {
  const ok = copyText(askClaudePayload(q, picked));
  toast(ok ? 'Copied — paste into the Claude app.' : 'Copy failed.');
  return ok;
}
