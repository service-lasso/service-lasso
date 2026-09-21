export async function waitForDatabase(pool, { timeoutMs = 30000, intervalMs = 200, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + timeoutMs;
  while (true) {
    try { await pool.query('SELECT 1'); return; }
    catch (error) {
      if (!['ECONNREFUSED', 'ECONNRESET', '57P03'].includes(error?.code) || now() >= deadline) throw error;
      await sleep(intervalMs);
    }
  }
}
