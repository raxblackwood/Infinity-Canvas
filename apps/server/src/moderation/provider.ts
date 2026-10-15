export interface ModerationResult {
  flagged: boolean;
  reason?: string;
  confidence?: number;
  categories?: string[];
}

export interface ModerationProvider {
  scan(image: Buffer): Promise<ModerationResult>;
}

export class MockModerationProvider implements ModerationProvider {
  private shouldFlag = false;
  private nextReason = 'Automated policy violation detected';
  private flaggedTiles: Set<string> = new Set();

  setFlag(flag: boolean, reason = 'Automated policy violation detected'): void {
    this.shouldFlag = flag;
    this.nextReason = reason;
  }

  setTileFlagged(tileX: number, tileY: number, flagged: boolean): void {
    const key = `${tileX},${tileY}`;
    if (flagged) {
      this.flaggedTiles.add(key);
    } else {
      this.flaggedTiles.delete(key);
    }
  }

  isTileFlagged(tileX: number, tileY: number): boolean {
    return this.flaggedTiles.has(`${tileX},${tileY}`);
  }

  async scan(image: Buffer, metadata?: { tileX?: number; tileY?: number }): Promise<ModerationResult> {
    const tileFlagged = metadata?.tileX !== undefined && metadata?.tileY !== undefined && this.isTileFlagged(metadata.tileX, metadata.tileY);

    if (this.shouldFlag || tileFlagged) {
      return {
        flagged: true,
        reason: this.nextReason,
        confidence: 0.99,
        categories: ['inappropriate_content'],
      };
    }

    return {
      flagged: false,
    };
  }
}
