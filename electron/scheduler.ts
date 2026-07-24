export function localDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export class DailyScheduler {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly onTick: (now: Date) => void | Promise<void>,
    private readonly intervalMs = 60_000
  ) {}

  start(runImmediately = true): void {
    this.stop();
    if (runImmediately) void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async check(now = new Date()): Promise<void> {
    await this.onTick(now);
  }
}
