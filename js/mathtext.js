/* Tiny math/inline-code renderer. No KaTeX, no fonts, no CDN.
 *
 *   `[1, 2, 3]`  → monospace span
 *   x^2, x^{10}  → superscript
 *   d_k, W_{ij}  → subscript
 *
 * Everything else is written directly in Unicode by the author:
 *   ‖v‖ · Σ ∂ √ ≈ ≠ ≤ θ λ μ σ ∇ ᵀ ⊙ → ⁻¹ ² ³
 * See AUTHORING.md for the full table.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ESC[ch]);
}

// ^{...} / ^x and _{...} / _x  →  <sup> / <sub>
function scripts(s) {
  return s
    .replace(/\^\{([^}]{1,12})\}/g, (_, g) => `<sup>${g}</sup>`)
    .replace(/\^(-?[0-9A-Za-z]+)/g, (_, g) => `<sup>${g}</sup>`)
    .replace(/_\{([^}]{1,12})\}/g, (_, g) => `<sub>${g}</sub>`)
    .replace(/_([0-9A-Za-z]+)/g, (_, g) => `<sub>${g}</sub>`);
}

/** Render authored text to safe HTML. */
export function mathtext(input) {
  if (input == null) return '';
  // Odd indices are the insides of backtick pairs: escape but never transform.
  return String(input)
    .split('`')
    .map((part, i) => (i % 2 === 1
      ? `<span class="mono">${escapeHtml(part)}</span>`
      : scripts(escapeHtml(part))))
    .join('');
}

/** Same text with markup stripped — for clipboard payloads and aria labels. */
export function plaintext(input) {
  if (input == null) return '';
  return String(input).replace(/`/g, '').replace(/[\^_]\{([^}]*)\}/g, '$1');
}
