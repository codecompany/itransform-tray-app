import type { FeedbackHistoryItem } from "../src/contracts.js";

export class ReceivedFeedbackMonitor {
  private knownIds: Set<string> | undefined;
  private nextCheckAt = 0;
  private inFlight = false;

  constructor(
    private readonly load: () => Promise<FeedbackHistoryItem[]>,
    private readonly onReceived: (items: FeedbackHistoryItem[]) => void | Promise<void>,
    private readonly intervalMs = 5 * 60_000,
    private readonly onKnownIds?: (ids: string[]) => void | Promise<void>
  ) {}

  async check(now = new Date()): Promise<void> {
    if (this.inFlight || now.getTime() < this.nextCheckAt) return;
    this.inFlight = true;
    this.nextCheckAt = now.getTime() + this.intervalMs;
    try {
      const items = await this.load();
      if (!this.knownIds) {
        this.knownIds = new Set(items.slice(0, 500).map((item) => item.id));
        await this.persist();
        return;
      }
      const received = items.filter((item) => !this.knownIds!.has(item.id));
      this.knownIds = new Set(items.slice(0, 500).map((item) => item.id));
      await this.persist();
      if (received.length > 0) await this.onReceived(received);
    } finally {
      this.inFlight = false;
    }
  }

  reset(): void {
    this.knownIds = undefined;
    this.nextCheckAt = 0;
  }

  hydrate(ids: readonly string[] | undefined): void {
    this.knownIds = ids === undefined ? undefined : new Set(ids);
    this.nextCheckAt = 0;
  }

  snapshot(): string[] | undefined {
    return this.knownIds ? [...this.knownIds] : undefined;
  }

  private async persist(): Promise<void> {
    if (this.knownIds && this.onKnownIds) await this.onKnownIds([...this.knownIds]);
  }
}
