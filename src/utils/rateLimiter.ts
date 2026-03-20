export class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private lastRefill: number;
  private readonly waitQueue: Array<{ resolve: () => void }> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(requestsPerMinute: number) {
    const safeRPM = Math.max(1, Math.floor(requestsPerMinute));
    this.maxTokens = Math.max(1, Math.floor(safeRPM / 6));
    this.tokens = this.maxTokens;
    this.refillRate = safeRPM / 60;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.waitQueue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.waitQueue.push({ resolve });
      this.scheduleDrain();
    });
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

export function createConcurrencyLimiter(concurrency: number) {
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
