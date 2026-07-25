import { describe, expect, it, vi } from "vitest";
import { IdempotentRequestRegistry } from "./idempotent-requests";

describe("IdempotentRequestRegistry", () => {
  it("shares an in-flight request and replays its completed result", async () => {
    let finish: ((value: string) => void) | undefined;
    const operation = vi.fn(() => new Promise<string>((resolve) => {
      finish = resolve;
    }));
    const registry = new IdempotentRequestRegistry<string>();

    const first = registry.run("request-1", operation);
    const retryWhilePending = registry.run("request-1", operation);
    expect(retryWhilePending).toBe(first);
    expect(operation).toHaveBeenCalledOnce();

    finish?.("sent");
    await expect(first).resolves.toBe("sent");
    await expect(registry.run("request-1", operation)).resolves.toBe("sent");
    expect(operation).toHaveBeenCalledOnce();
  });

  it("allows retry after a known failure", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("sent");
    const registry = new IdempotentRequestRegistry<string>();

    await expect(registry.run("request-1", operation)).rejects.toThrow("offline");
    await expect(registry.run("request-1", operation)).resolves.toBe("sent");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
