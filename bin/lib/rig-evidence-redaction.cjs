// Shared by the packaged federation rig and the physical drill's evidence bank.
const sensitiveKey = /(authorization|cookie|credential|password|secret|token|private.?key|api.?key)/i;

function sanitizeText(value) {
  return value
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/g, '[REDACTED TOKEN]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/^((?:set-)?cookie\s*:)[^\r\n]*/gim, '$1 [REDACTED]')
    // Error strings and malformed responses can contain credential assignments
    // even when there is no corresponding JSON field to redact.
    .replace(/(\b(?:[\w.-]*[_-])?(?:token|accessToken|refreshToken|secret|password|passwd|credential|api[_-]?key)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s&,;"'}]+)/gi, '$1[REDACTED]');
}

function sanitize(value, key = '') {
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  return value;
}

module.exports = { sanitize, sanitizeText };
