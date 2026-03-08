import { log } from "./index";
import { startScheduler, getSchedulerStatus } from "./scheduler";

let selfPingInterval: ReturnType<typeof setInterval> | null = null;
let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let externalPingInterval: ReturnType<typeof setInterval> | null = null;
let schedulerGuardInterval: ReturnType<typeof setInterval> | null = null;
let lastPingSuccess: Date | null = null;
let lastExternalPingSuccess: Date | null = null;
let pingCount = 0;
let failCount = 0;
let externalPingCount = 0;
let externalFailCount = 0;
let schedulerRestartCount = 0;
let startTime: Date | null = null;

const SELF_PING_INTERVAL = 2 * 1000;
const EXTERNAL_PING_INTERVAL = 30 * 1000;
const WATCHDOG_INTERVAL = 60 * 1000;
const SCHEDULER_GUARD_INTERVAL = 10 * 1000;

function getLocalUrl(): string {
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}`;
}

function getExternalUrl(): string | null {
  const replSlug = process.env.REPL_SLUG;
  const replOwner = process.env.REPL_OWNER;
  if (replSlug && replOwner) {
    return `https://${replSlug}.${replOwner}.repl.co`;
  }
  const replitDevDomain = process.env.REPLIT_DEV_DOMAIN;
  if (replitDevDomain) {
    return `https://${replitDevDomain}`;
  }
  return null;
}

async function selfPing(): Promise<boolean> {
  try {
    const url = `${getLocalUrl()}/api/health`;
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

async function externalPing(): Promise<boolean> {
  const extUrl = getExternalUrl();
  if (!extUrl) return true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${extUrl}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok) {
      lastExternalPingSuccess = new Date();
      externalPingCount++;
      return true;
    }
    externalFailCount++;
    return false;
  } catch (err: any) {
    externalFailCount++;
    return false;
  }
}

function schedulerGuard(): void {
  try {
    const status = getSchedulerStatus();
    if (!status.isRunning) {
      schedulerRestartCount++;
      log(`Scheduler guard: scheduler is DOWN — auto-restarting (restart #${schedulerRestartCount})`, "watchdog");
      startScheduler();
      const newStatus = getSchedulerStatus();
      log(`Scheduler guard: restarted — isRunning=${newStatus.isRunning}, jobs=${newStatus.jobCount}`, "watchdog");
    }
  } catch (err: any) {
    log(`Scheduler guard error: ${err.message}`, "watchdog");
  }
}

async function watchdogCheck(): Promise<void> {
  const now = new Date();
  const uptimeMs = startTime ? now.getTime() - startTime.getTime() : 0;
  const uptimeHours = Math.floor(uptimeMs / (1000 * 60 * 60));
  const uptimeMinutes = Math.floor((uptimeMs % (1000 * 60 * 60)) / (1000 * 60));
  const schedulerStatus = getSchedulerStatus();

  log(
    `Watchdog — uptime: ${uptimeHours}h ${uptimeMinutes}m | ` +
    `local pings: ${pingCount} ok/${failCount} fail | ` +
    `external pings: ${externalPingCount} ok/${externalFailCount} fail | ` +
    `scheduler: ${schedulerStatus.isRunning ? "RUNNING" : "DOWN"} (${schedulerStatus.jobCount} jobs) | ` +
    `scheduler restarts: ${schedulerRestartCount}`,
    "watchdog"
  );

  const pingOk = await selfPing();
  if (!pingOk) {
    log("Watchdog: local ping failed, retrying in 5s...", "watchdog");
    await new Promise(r => setTimeout(r, 5000));
    const retryOk = await selfPing();
    if (!retryOk) {
      log("Watchdog: CRITICAL — server unresponsive after retry", "watchdog");
    } else {
      log("Watchdog: recovery ping succeeded", "watchdog");
    }
  }
}

export function startWatchdog(): void {
  if (selfPingInterval || watchdogInterval) return;

  startTime = new Date();
  log("Watchdog ACTIVATED — self-ping every 2s, external ping every 30s, scheduler guard every 10s", "watchdog");

  let consecutiveFails = 0;
  selfPingInterval = setInterval(async () => {
    const ok = await selfPing();
    if (!ok) {
      consecutiveFails++;
      if (consecutiveFails >= 3) {
        log(`ALERT: ${consecutiveFails} consecutive self-ping failures — server may be unresponsive`, "watchdog");
        schedulerGuard();
      }
    } else {
      if (consecutiveFails > 0) {
        log(`Self-ping recovered after ${consecutiveFails} failures`, "watchdog");
      }
      consecutiveFails = 0;
    }
  }, SELF_PING_INTERVAL);

  externalPingInterval = setInterval(async () => {
    await externalPing();
  }, EXTERNAL_PING_INTERVAL);

  watchdogInterval = setInterval(async () => {
    await watchdogCheck();
  }, WATCHDOG_INTERVAL);

  schedulerGuardInterval = setInterval(() => {
    schedulerGuard();
  }, SCHEDULER_GUARD_INTERVAL);

  setTimeout(async () => {
    const ok = await selfPing();
    log(`Initial self-ping: ${ok ? "OK" : "FAILED"}`, "watchdog");

    schedulerGuard();
  }, 5000);
}

export function stopWatchdog(): void {
  if (selfPingInterval) { clearInterval(selfPingInterval); selfPingInterval = null; }
  if (externalPingInterval) { clearInterval(externalPingInterval); externalPingInterval = null; }
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
  if (schedulerGuardInterval) { clearInterval(schedulerGuardInterval); schedulerGuardInterval = null; }
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
    lastLocalPingSuccess: lastPingSuccess?.toISOString() || null,
    lastExternalPingSuccess: lastExternalPingSuccess?.toISOString() || null,
    localPings: { success: pingCount, fail: failCount },
    externalPings: { success: externalPingCount, fail: externalFailCount },
    schedulerRestartCount,
    intervals: {
      selfPingMs: SELF_PING_INTERVAL,
      externalPingMs: EXTERNAL_PING_INTERVAL,
      watchdogMs: WATCHDOG_INTERVAL,
      schedulerGuardMs: SCHEDULER_GUARD_INTERVAL,
    },
  };
}
