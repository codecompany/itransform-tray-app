export const defaultRequestTimeoutMs = 12_000;

export function withTimeout<T>(
  operation: Promise<T>,
  message: string,
  timeoutMs = defaultRequestTimeoutMs
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    operation.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
