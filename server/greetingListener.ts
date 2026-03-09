import path from "path";
import fs from "fs";
import { spawn, type ChildProcess } from "child_process";
import { storage } from "./storage";
import { log } from "./index";

let listenerProcess: ChildProcess | null = null;
let isRunning = false;
let restartCount = 0;
let lastStartTime: Date | null = null;
let intentionalStop = false;
let isStarting = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

function getPythonPath(): string {
  const candidates = [
    path.join(process.cwd(), ".pythonlibs", "bin", "python3"),
    "/home/runner/workspace/.pythonlibs/bin/python3",
    "python3",
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return "python3";
}

async function getDataWithRetry(maxAttempts = 10, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const bots = await storage.getUserbots();
      const groups = await storage.getGroups();
      const activeBots = bots.filter(b => b.isActive && b.sessionString && b.apiId && b.apiHash);
      const groupIds = groups.filter(g => g.groupId).map(g => g.groupId!);
      if (activeBots.length >= 3 && groupIds.length > 0) {
        return { activeBots, groupIds };
      }
      if (attempt < maxAttempts) {
        log(`Greeting listener: DB returned ${activeBots.length} bots, ${groupIds.length} groups (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs / 1000}s...`, "greeting");
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch (err: any) {
      if (attempt < maxAttempts) {
        log(`Greeting listener: DB error on attempt ${attempt}/${maxAttempts}: ${err.message}, retrying...`, "greeting");
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  return null;
}

export async function startGreetingListener(): Promise<{ started: boolean; reason?: string }> {
  if (isRunning && listenerProcess) {
    log("Greeting listener already running", "greeting");
    return { started: false, reason: "already_running" };
  }

  if (isStarting) {
    log("Greeting listener start already in progress", "greeting");
    return { started: false, reason: "start_in_progress" };
  }

  isStarting = true;
  intentionalStop = false;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  try {
    const data = await getDataWithRetry();
    if (!data) {
      const reason = "DB not ready or insufficient bots/groups after retries";
      log(`Greeting listener: ${reason}`, "greeting");
      isStarting = false;
      return { started: false, reason };
    }

    const { activeBots, groupIds } = data;

    if (isRunning && listenerProcess) {
      isStarting = false;
      return { started: false, reason: "already_running" };
    }

    const spawnData = {
      bots: activeBots.map(b => ({
        session: b.sessionString,
        apiId: b.apiId,
        apiHash: b.apiHash,
        name: b.name,
      })),
      groupIds,
    };

    const pythonBin = getPythonPath();

    log(`Starting greeting listener: ${activeBots.length} bots, ${groupIds.length} groups`, "greeting");

    listenerProcess = spawn(pythonBin, [
      "server/greeting_listener.py",
      JSON.stringify(spawnData),
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    isRunning = true;
    isStarting = false;
    lastStartTime = new Date();

    listenerProcess.stdout!.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "greeting_detected") {
            log(`GREETING: ${msg.msg}`, "greeting");
          } else if (msg.type === "greeting_sent") {
            log(`REPLY: ${msg.msg}`, "greeting");
            storage.createMessageLog({
              botName: `Userbot ${msg.botIndex + 1}`,
              groupName: msg.chatId || "unknown",
              message: msg.response,
              schedulePeriod: "greeting_response",
              status: "sent",
            }).catch(() => {});
          } else if (msg.type === "started") {
            log(`Greeting listener ACTIVE: ${msg.msg}`, "greeting");
          } else if (msg.type === "error") {
            log(`Greeting listener ERROR: ${msg.msg}`, "greeting");
          } else {
            log(`Greeting listener: ${msg.msg || line}`, "greeting");
          }
        } catch {
          log(`Greeting listener output: ${line}`, "greeting");
        }
      }
    });

    listenerProcess.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) log(`Greeting listener stderr: ${text}`, "greeting");
    });

    listenerProcess.on("exit", (code: number | null, signal: string | null) => {
      log(`Greeting listener exited (code=${code}, signal=${signal})`, "greeting");
      isRunning = false;
      listenerProcess = null;

      if (!intentionalStop && code !== 0) {
        restartCount++;
        const delay = Math.min(restartCount * 30000, 300000);
        log(`Greeting listener will restart in ${delay / 1000}s (restart #${restartCount})`, "greeting");
        restartTimer = setTimeout(() => {
          restartTimer = null;
          startGreetingListener().catch(err => {
            log(`Greeting listener restart failed: ${err.message}`, "greeting");
          });
        }, delay);
      }
    });

    listenerProcess.on("error", (err: Error) => {
      log(`Greeting listener process error: ${err.message}`, "greeting");
      isRunning = false;
      isStarting = false;
      listenerProcess = null;
    });

    return { started: true };

  } catch (err: any) {
    log(`Failed to start greeting listener: ${err.message}`, "greeting");
    isRunning = false;
    isStarting = false;
    return { started: false, reason: err.message };
  }
}

export function stopGreetingListener(): void {
  intentionalStop = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  if (listenerProcess) {
    log("Stopping greeting listener", "greeting");
    const proc = listenerProcess;
    listenerProcess = null;
    isRunning = false;

    proc.kill("SIGTERM");
    setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, 5000);
  } else {
    isRunning = false;
  }
}

export function getGreetingListenerStatus() {
  return {
    isRunning: isRunning || isStarting,
    restartCount,
    lastStartTime: lastStartTime?.toISOString() || null,
  };
}
