export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(private capacity: number, private refillPerSecond: number) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = now;
  }

  tryTake(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

export const globalPollBucket = new TokenBucket(14, 14);
export const globalSubmitBucket = new TokenBucket(4, 4);

const perAccountSubmitBuckets = new Map<string, TokenBucket>();

export function getAccountSubmitBucket(accountId: string, ratePerMin: number): TokenBucket {
  let b = perAccountSubmitBuckets.get(accountId);
  if (!b || (b as unknown as { _rate?: number })._rate !== ratePerMin) {
    b = new TokenBucket(Math.max(1, Math.ceil(ratePerMin / 60)), ratePerMin / 60);
    (b as unknown as { _rate?: number })._rate = ratePerMin;
    perAccountSubmitBuckets.set(accountId, b);
  }
  return b;
}
