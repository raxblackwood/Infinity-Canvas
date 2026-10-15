import {
  MAX_CONNECTIONS_PER_IP,
  MAX_SESSIONS_PER_IP_PER_MIN,
  MAX_OPEN_PREVIEWS_PER_CONNECTION,
  MAX_PREVIEW_BYTES_PER_SEC,
} from '@infinite-canvas/shared';

export class RateLimiter {
  private ipConnections: Map<string, number> = new Map();
  private ipSessionCreations: Map<string, { count: number; windowStart: number }> = new Map();
  public exemptLoopback = false;

  // Connection limit per IP
  allowConnection(ip: string): boolean {
    if (this.exemptLoopback && (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost')) {
      return true;
    }
    const current = this.ipConnections.get(ip) || 0;
    if (current >= MAX_CONNECTIONS_PER_IP) {
      return false;
    }
    this.ipConnections.set(ip, current + 1);
    return true;
  }

  releaseConnection(ip: string): void {
    const current = this.ipConnections.get(ip) || 0;
    if (current <= 1) {
      this.ipConnections.delete(ip);
    } else {
      this.ipConnections.set(ip, current - 1);
    }
  }

  // Session creation limit per IP
  allowSessionCreation(ip: string): boolean {
    if (this.exemptLoopback && (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost')) {
      return true;
    }
    const now = Date.now();
    const entry = this.ipSessionCreations.get(ip);
    if (!entry || now - entry.windowStart >= 60000) {
      this.ipSessionCreations.set(ip, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= MAX_SESSIONS_PER_IP_PER_MIN) {
      return false;
    }

    entry.count++;
    return true;
  }
}

export class ConnectionPreviewLimiter {
  private openPreviews: Set<number> = new Set();
  private windowStart = Date.now();
  private bytesInWindow = 0;

  canBeginPreview(clientStrokeId: number): boolean {
    if (this.openPreviews.size >= MAX_OPEN_PREVIEWS_PER_CONNECTION) {
      return false;
    }
    this.openPreviews.add(clientStrokeId);
    return true;
  }

  canSendPoints(bytesCount: number): boolean {
    const now = Date.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.bytesInWindow = 0;
    }

    if (this.bytesInWindow + bytesCount > MAX_PREVIEW_BYTES_PER_SEC) {
      return false;
    }

    this.bytesInWindow += bytesCount;
    return true;
  }

  endPreview(clientStrokeId: number): void {
    this.openPreviews.delete(clientStrokeId);
  }

  get openCount(): number {
    return this.openPreviews.size;
  }
}
