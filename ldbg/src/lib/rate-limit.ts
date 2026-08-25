const COOLDOWN_MS = 60_000;
const lastCallByProject = new Map<string, number>();
const lastDesignContentByProject = new Map<string, number>();

export function checkInterpretRateLimit(projectId: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const last = lastCallByProject.get(projectId);
  if (last != null && now - last < COOLDOWN_MS) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((COOLDOWN_MS - (now - last)) / 1000),
    };
  }
  return { allowed: true };
}

export function recordInterpretCall(projectId: string): void {
  lastCallByProject.set(projectId, Date.now());
}

export function checkDesignContentRateLimit(projectId: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const last = lastDesignContentByProject.get(projectId);
  if (last != null && now - last < COOLDOWN_MS) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((COOLDOWN_MS - (now - last)) / 1000),
    };
  }
  return { allowed: true };
}

export function recordDesignContentCall(projectId: string): void {
  lastDesignContentByProject.set(projectId, Date.now());
}

const lastRenderByProject = new Map<string, number>();

export function checkRenderRateLimit(projectId: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const last = lastRenderByProject.get(projectId);
  if (last != null && now - last < COOLDOWN_MS) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((COOLDOWN_MS - (now - last)) / 1000),
    };
  }
  return { allowed: true };
}

export function recordRenderCall(projectId: string): void {
  lastRenderByProject.set(projectId, Date.now());
}