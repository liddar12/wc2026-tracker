export function isValidJoinCode(code) {
  return /^[a-z]+-[a-z]+-[0-9]{4}$/.test(String(code || '').trim().toLowerCase());
}

export function computeBasePath(pathname = '/') {
  const parts = String(pathname || '/').split('/').filter(Boolean);
  const normalized = stripDocumentLeaf(parts);
  if (!normalized.length) return '/';
  if (normalized[0] === 'join') return '/';
  const joinIndex = normalized.indexOf('join');
  if (joinIndex === -1) return `/${normalized.join('/')}/`;
  const prefix = normalized.slice(0, joinIndex);
  return prefix.length ? `/${prefix.join('/')}/` : '/';
}

function stripDocumentLeaf(parts) {
  if (!parts.length) return parts;
  const last = parts[parts.length - 1];
  // Treat direct-document URLs (e.g. /index.html) as shell roots.
  if (/\.[a-z0-9]+$/i.test(last)) return parts.slice(0, -1);
  return parts;
}

export function extractJoinCodeFromPath(pathname = '/') {
  const parts = String(pathname || '/').split('/').filter(Boolean);
  const joinIndex = parts.indexOf('join');
  if (joinIndex === -1 || !parts[joinIndex + 1]) return null;
  const normalized = decodeURIComponent(parts[joinIndex + 1]).trim().toLowerCase();
  return isValidJoinCode(normalized) ? normalized : null;
}

export function buildPostJoinPath(pathname = '/', hash = '') {
  const safeHash = hash && hash !== '#' ? hash : '#/picks';
  return `${computeBasePath(pathname)}${safeHash}`;
}

/**
 * R11: per-match lock. A given match is locked once its kickoff_utc has
 * passed; picks for that match can no longer be edited. This replaces the
 * old per-stage lock which gated the entire group stage as a unit (~17
 * days) and prevented users from updating predictions for matches that
 * hadn't started yet.
 */
export function isMatchLocked(match, nowMs = Date.now()) {
  if (!match?.kickoff_utc) return false;
  const k = Date.parse(match.kickoff_utc);
  return Number.isFinite(k) && nowMs >= k;
}

/** R11: convenience — is the very first match of a given stage locked? */
export function stageStarted(schedule, stageName, nowMs = Date.now()) {
  const starts = (schedule || [])
    .filter((m) => m.stage === stageName)
    .map((m) => Date.parse(m.kickoff_utc))
    .filter(Number.isFinite);
  if (!starts.length) return false;
  return nowMs >= Math.min(...starts);
}

export function deriveLockState(schedule, nowMs = Date.now()) {
  if (!Array.isArray(schedule) || !schedule.length) {
    return { isLocked: false, groupsLocked: false, bracketLocked: false, phase: 'pre-tournament' };
  }
  const groupStarts = schedule.filter((m) => m.stage === 'group').map((m) => Date.parse(m.kickoff_utc)).filter(Number.isFinite);
  const groupLastKickoff = groupStarts.length ? Math.max(...groupStarts) : null;
  const groupEnds = Number.isFinite(groupLastKickoff) ? groupLastKickoff + (2 * 60 * 60 * 1000) : null;
  // Accept both 'r32' (legacy) and 'round_of_32' (current PDF-driven schema).
  const r32Starts = schedule.filter((m) => m.stage === 'r32' || m.stage === 'round_of_32').map((m) => Date.parse(m.kickoff_utc)).filter(Number.isFinite);
  const firstGroup = groupStarts.length ? Math.min(...groupStarts) : null;
  const firstR32 = r32Starts.length ? Math.min(...r32Starts) : null;
  const duringGroupStage = firstGroup && nowMs >= firstGroup && (!groupEnds || nowMs <= groupEnds);
  const inGapWindow = groupEnds && firstR32 && nowMs > groupEnds && nowMs < firstR32;
  const postR32Start = firstR32 && nowMs >= firstR32;
  if (duringGroupStage) return { isLocked: true, groupsLocked: true, bracketLocked: true, phase: 'group-stage-live' };
  if (inGapWindow) return { isLocked: false, groupsLocked: true, bracketLocked: false, phase: 'between-group-and-r32' };
  if (postR32Start) return { isLocked: true, groupsLocked: true, bracketLocked: true, phase: 'r32-live' };
  return { isLocked: false, groupsLocked: false, bracketLocked: false, phase: 'pre-tournament' };
}
