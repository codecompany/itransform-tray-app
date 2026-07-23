export function localDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDailyQuestionDue(now: Date, time: string, lastAnswerDate?: string): boolean {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const [hours, minutes] = time.split(":").map(Number);
  const scheduled = new Date(now);
  scheduled.setHours(hours, minutes, 0, 0);
  return now >= scheduled && lastAnswerDate !== localDate(now);
}

export class DailyScheduler {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly state: () => { time?: string; lastAnswerDate?: string },
    private readonly onDue: () => void | Promise<void>,
    private readonly intervalMs = 60_000
  ) {}

  start(): void {
    this.stop();
    void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async check(now = new Date()): Promise<void> {
    const { time, lastAnswerDate } = this.state();
    if (time && isDailyQuestionDue(now, time, lastAnswerDate)) await this.onDue();
  }
}
