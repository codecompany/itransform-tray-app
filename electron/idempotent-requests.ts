export class IdempotentRequestRegistry<T> {
  private readonly requests = new Map<string, Promise<T>>();

  run(id: string, operation: () => Promise<T>): Promise<T> {
    const existing = this.requests.get(id);
    if (existing) return existing;
    const request = operation();
    this.requests.set(id, request);
    void request.catch(() => this.requests.delete(id));
    return request;
  }

  clear(): void {
    this.requests.clear();
  }
}
