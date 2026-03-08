import { log } from "./index";

let selfPingInterval: ReturnType<typeof setInterval> | null = null;
let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let lastPingSuccess: Date | null = null;
let pingCount = 0;
let failCount = 0;
let startTime: Date | null = null;

const SELF_PING_INTERVAL = 4 * 60 * 1000;
const WATCHDOG_INTERVAL = 5 * 60 * 1000;

function getAppUrl(): string {
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}`;
}

async function selfPing(): Promise<boolean> {
  try {
    const url = `${getAppUrl()}/api/health`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      lastPingSuccess = new Date();
      pingCount++;
      return true;
    }
    failCount++;
    log(`Self-ping returned status ${response.status}`, "watchdog");
    return false;
  } catch (err: any) {
    failCount++;
    log(`Self-ping failed: ${err.message}`, "watchdog");
    return false;
  }
}

async function watchdogCheck(): Promise<void> {
  const now = new Date();
  const uptimeMs = startTime ? now.getTime() - startTime.getTime() : 0;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

  log(`Watchdog check — uptime: ${uptimeHours}h ${uptimeMinutes}m | pings: ${pingCount} ok, ${failCount} fail`, "watchdog");

  const pingOk = await selfPing();
  if (!pingOk) {
    log("Watchdog: ping failed, attempting recovery ping...", "watchdog");
    await new Promise(r => setTimeout(r, 5000));
    const retryOk = await selfPing();
    if (!retryOk) {
      log("Watchdog: recovery ping also failed — server may be unresponsive", "watchdog");
    } else {
      log("Watchdog: recovery ping succeeded", "watchdog");
    }
  }
}

export function startWatchdog(): void {
  if (selfPingInterval || watchdogInterval) return;

  startTime = new Date();
  log("Watchdog + self-ping keepalive started", "watchdog");

  selfPingInterval = setInterval(async () => {
    await selfPing();
  }, SELF_PING_INTERVAL);

  watchdogInterval = setInterval(async () => {
    await watchdogCheck();
  }, WATCHDOG_INTERVAL);

  setTimeout(async () => {
    const ok = await selfPing();
    log(`Initial self-ping: ${ok ? "OK" : "FAILED"}`, "watchdog");
  }, 10000);
}

export function stopWatchdog(): void {
  if (selfPingInterval) {
    clearInterval(selfPingInterval);
    selfPingInterval = null;
  }
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  log("Watchdog stopped", "watchdog");
}

export function getWatchdogStatus() {
  const now = new Date();
  const uptimeMs = startTime ? now.getTime() - startTime.getTime() : 0;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));

  return {
    isRunning: !!(selfPingInterval && watchdogInterval),
    uptime: `${uptimeHours}h ${uptimeMinutes}m`,
    uptimeMs,
    lastPingSuccess: lastPingSuccess?.toISOString() || null,
    pingSuccessCount: pingCount,
    pingFailCount: failCount,
    selfPingIntervalMs: SELF_PING_INTERVAL,
    watchdogIntervalMs: WATCHDOG_INTERVAL,
  };
}
