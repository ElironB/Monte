export interface RateLimiterStats {
  acquireCalls: number;
  immediateGrants: number;
  queuedAcquires: number;
  totalWaitMs: number;
  maxWaitMs: number;
}

export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private lastRefill: number;
  private readonly waitQueue: Array<{ resolve: () => void }> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private stats: RateLimiterStats = {
    acquireCalls: 0,
    immediateGrants: 0,
    queuedAcquires: 0,
    totalWaitMs: 0,
    maxWaitMs: 0,
  };

  constructor(requestsPerMinute: number) {
    const safeRPM = Math.max(1, Math.floor(requestsPerMinute));
    this.maxTokens = Math.max(1, Math.floor(safeRPM / 6));
    this.tokens = this.maxTokens;
    this.refillRate = safeRPM / 60;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.stats.acquireCalls += 1;
    this.refill();

    if (this.waitQueue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.stats.immediateGrants += 1;
      return;
    }

    this.stats.queuedAcquires += 1;
    const startedAt = Date.now();

    await new Promise<void>((resolve) => {
      this.waitQueue.push({
        resolve: () => {
          const waitMs = Date.now() - startedAt;
          this.stats.totalWaitMs += waitMs;
          this.stats.maxWaitMs = Math.max(this.stats.maxWaitMs, waitMs);
          resolve();
        },
      });
      this.scheduleDrain();
    });
  }

  getStats(): RateLimiterStats {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      acquireCalls: 0,
      immediateGrants: 0,
      queuedAcquires: 0,
      totalWaitMs: 0,
      maxWaitMs: 0,
    };
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;

    this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSeconds * this.refillRate);
    this.lastRefill = now;
  }

  private scheduleDrain(): void {
    if (this.drainTimer) {
      return;
    }

    const waitTimeMs = Math.max(10, Math.ceil((1 / this.refillRate) * 1000));
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();

      if (this.waitQueue.length > 0) {
        this.scheduleDrain();
      }
    }, waitTimeMs);
  }

  private drain(): void {
    this.refill();

    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      this.waitQueue.shift()?.resolve();
    }
  }
}

export type ConcurrencyLimiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createConcurrencyLimiter(concurrency: number): ConcurrencyLimiter {
  const safeConcurrency = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<{ resolve: () => void }> = [];

  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= safeConcurrency) {
      await new Promise<void>((resolve) => queue.push({ resolve }));
    }

    active += 1;

    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.resolve();
    }
  };
}

export function detectProviderRPM(): number {
  if (process.env.OPENROUTER_API_KEY) {
    return 100;
  }

  if (process.env.GROQ_API_KEY) {
    return 25;
  }

  if (process.env.LLM_BASE_URL?.includes('openrouter.ai')) {
    return 100;
  }

  if (process.env.LLM_BASE_URL?.includes('groq.com')) {
    return 25;
  }

  return 30;
}
