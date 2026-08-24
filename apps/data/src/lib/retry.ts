/**
 * 指数退避重试（设计 §10：Embedding API 限流/超时等瞬时故障单点重试）。
 * 测试中用 retries=0 保持确定性。
 */
export interface RetryOptions {
    /** 额外重试次数（不含首次执行），默认 4 */
    retries?: number;
    /** 首次退避毫秒，默认 1000 */
    baseDelayMs?: number;
    /** 退避上限毫秒，默认 30000 */
    maxDelayMs?: number;
    /** 退避倍数，默认 2 */
    factor?: number;
    onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
): Promise<T> {
    const retries = options.retries ?? 4;
    const baseDelayMs = options.baseDelayMs ?? 1000;
    const maxDelayMs = options.maxDelayMs ?? 30000;
    const factor = options.factor ?? 2;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt === retries) break;
            const delayMs = Math.min(baseDelayMs * factor ** attempt, maxDelayMs);
            options.onRetry?.(err, attempt + 1, delayMs);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
    throw lastErr;
}
