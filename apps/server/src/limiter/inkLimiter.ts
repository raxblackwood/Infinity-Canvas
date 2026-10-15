import {
  INK_BURST,
  INK_REFILL_PER_SEC,
  calculateStrokeInkCost,
} from '@infinite-canvas/shared';

export class UserInkBucket {
  private balance: number = INK_BURST;
  private lastRefillTimestamp: number = Date.now();

  getBalance(): number {
    this.refill();
    return Math.floor(this.balance);
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillTimestamp) / 1000;
    this.balance = Math.min(INK_BURST, this.balance + elapsedSec * INK_REFILL_PER_SEC);
    this.lastRefillTimestamp = now;
  }

  tryConsume(pointsCount: number): { allowed: boolean; remaining: number } {
    this.refill();
    const cost = calculateStrokeInkCost(pointsCount);
    if (this.balance < cost) {
      return { allowed: false, remaining: Math.floor(this.balance) };
    }
    this.balance -= cost;
    return { allowed: true, remaining: Math.floor(this.balance) };
  }

  refund(pointsCount: number): number {
    this.refill();
    const cost = calculateStrokeInkCost(pointsCount);
    this.balance = Math.min(INK_BURST, this.balance + cost);
    return Math.floor(this.balance);
  }
}

export class InkManager {
  private buckets: Map<string, UserInkBucket> = new Map();

  getBucket(userId: string): UserInkBucket {
    let b = this.buckets.get(userId);
    if (!b) {
      b = new UserInkBucket();
      this.buckets.set(userId, b);
    }
    return b;
  }
}
