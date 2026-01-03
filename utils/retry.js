// utils/retry.js
export async function withRetry(fn, retries = 3, delay = 100) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (
        err.code === 112 || // WriteConflict
        err.errorLabels?.includes("TransientTransactionError")
      ) {
        if (i === retries - 1) throw err; // last attempt
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}
