import { log } from "./index";
import { startScheduler, getSchedulerStatus } from "./scheduler";
import { startGreetingListener, getGreetingListenerStatus } from "./greetingListener";

let selfPingInterval: ReturnType<typeof setInterval> | null = null;
let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let externalPingInterval: ReturnType<typeof setInterval> | null = null;
let schedulerGuardInterval: ReturnType<typeof setInterval> | null = null;
let greetingGuardInterval: ReturnType<typeof setInterval> | null = null;
let lastPingSuccess: Date | null = null;
let lastExternalPingSuccess: Date | null = null;
let pingCount = 0;
let failCount = 0;
let externalPingCount = 0;
let externalFailCount = 0;
let schedulerRestartCount = 0;
let startTime: Date | null = null;

const SELF_PING_INTERVAL = 1000;
const EXTERNAL_PING_INTERVAL = 15 * 1000;
const WATCHDOG_INTERVAL = 30 * 1000;
const SCHEDULER_GUARD_INTERVAL = 5 * 1000;
const GREETING_GUARD_INTERVAL = 30 * 1000;

function getLocalUrl(): string {
  const port = process.env.PORT || "5000";
  return `http://127.0.0.1:${port}`;
}

function getExternalUrl(): string | null {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderUrl) {
    return renderUrl;
  }
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
    const timeout = setTimeout(() => controller.abort(), 5000);
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
    return false;
  }
}

async function externalPing(): Promise<boolean> {
  const extUrl = getExternalUrl();
  if (!extUrl) return true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
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
  const glStatus = getGreetingListenerStatus();

  log(
    `Watchdog — uptime: ${uptimeHours}h ${uptimeMinutes}m | ` +
    `pings: ${pingCount}ok/${failCount}fail | ` +
    `ext: ${externalPingCount}ok/${externalFailCount}fail | ` +
    `scheduler: ${schedulerStatus.isRunning ? "UP" : "DOWN"} (${schedulerStatus.jobCount} jobs) | ` +
    `greeting: ${glStatus.isRunning ? "UP" : "DOWN"} | ` +
    `restarts: sched=${schedulerRestartCount} greet=${glStatus.restartCount}`,
    "watchdog"
  );

  const pingOk = await selfPing();
  if (!pingOk) {
    log("Watchdog: local ping failed, retrying in 2s...", "watchdog");
    await new Promise(r => setTimeout(r, 2000));
    const retryOk = await selfPing();
    if (!retryOk) {
      log("Watchdog: CRITICAL — server unresponsive after retry", "watchdog");
    }
  }
}

export function startWatchdog(): void {
  if (selfPingInterval || watchdogInterval) return;

  startTime = new Date();
  log("Watchdog ACTIVATED — ping:1s, ext:15s, scheduler-guard:5s, greeting-guard:30s, watchdog:30s", "watchdog");

  let consecutiveFails = 0;
  selfPingInterval = setInterval(async () => {
    const ok = await selfPing();
    if (!ok) {
      consecutiveFails++;
      if (consecutiveFails >= 3) {
        log(`ALERT: ${consecutiveFails} consecutive ping failures`, "watchdog");
        schedulerGuard();
      }
    } else {
      if (consecutiveFails > 0) {
        log(`Ping recovered after ${consecutiveFails} failures`, "watchdog");
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

  const isDev = process.env.NODE_ENV === "development";

  if (!isDev) {
    greetingGuardInterval = setInterval(() => {
      const glStatus = getGreetingListenerStatus();
      if (!glStatus.isRunning) {
        log("Greeting guard: listener is DOWN — auto-restarting...", "watchdog");
        startGreetingListener().catch(err => {
          log(`Greeting guard restart failed: ${err.message}`, "watchdog");
        });
      }
    }, GREETING_GUARD_INTERVAL);
  } else {
    log("DEV MODE: Greeting listener guard disabled to avoid session conflicts with production", "watchdog");
  }

  setTimeout(async () => {
    const ok = await selfPing();
    log(`Initial self-ping: ${ok ? "OK" : "FAILED"}`, "watchdog");

    schedulerGuard();

    if (!isDev) {
      setTimeout(() => {
        log("Auto-starting greeting listener (Telethon-based, no session conflicts)...", "watchdog");
        startGreetingListener().catch(err => {
          log(`Greeting listener auto-start failed: ${err.message}`, "watchdog");
        });
      }, 10000);
    }
  }, 3000);
}

export function stopWatchdog(): void {
  if (selfPingInterval) { clearInterval(selfPingInterval); selfPingInterval = null; }
  if (externalPingInterval) { clearInterval(externalPingInterval); externalPingInterval = null; }
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
  if (schedulerGuardInterval) { clearInterval(schedulerGuardInterval); schedulerGuardInterval = null; }
  if (greetingGuardInterval) { clearInterval(greetingGuardInterval); greetingGuardInterval = null; }
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
    greetingListener: getGreetingListenerStatus(),
    intervals: {
      selfPingMs: SELF_PING_INTERVAL,
      externalPingMs: EXTERNAL_PING_INTERVAL,
      watchdogMs: WATCHDOG_INTERVAL,
      schedulerGuardMs: SCHEDULER_GUARD_INTERVAL,
    },
  };
}
