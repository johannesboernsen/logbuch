(() => {
  const defaultDelay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  async function waitForVersion({ targetVersion, check, onAttempt = () => {}, timeoutMs = 180000, intervalMs = 1500, now = () => Date.now(), delay = defaultDelay }) {
    const startedAt = now();
    let attempt = 0;
    while (now() - startedAt < timeoutMs) {
      attempt += 1;
      let reachable = false;
      try {
        const status = await check();
        reachable = true;
        if (status?.state === 'failed') {
          return { outcome:'failed', status, attempts:attempt, elapsedMs:now() - startedAt };
        }
        if (status?.currentVersion === targetVersion) {
          return { outcome:'complete', status, attempts:attempt, elapsedMs:now() - startedAt };
        }
      } catch {
        // A short network interruption is expected while the container restarts.
      }
      onAttempt({ attempt, reachable, elapsedMs:now() - startedAt });
      await delay(intervalMs);
    }
    return { outcome:'timeout', attempts:attempt, elapsedMs:now() - startedAt };
  }

  globalThis.LogbuchUpdateMonitor = Object.freeze({ waitForVersion });
})();
