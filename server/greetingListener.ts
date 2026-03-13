import path from "path";
import fs from "fs";
import { spawn, type ChildProcess, execFile } from "child_process";
import { promisify } from "util";
import { log } from "./index";

const execFileAsync = promisify(execFile);

let listenerProcess: ChildProcess | null = null;
let isRunning = false;
let restartCount = 0;
let lastStartTime: Date | null = null;
let intentionalStop = false;
let isStarting = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let cachedExtraBots: Array<{ sessionString: string; apiId: string; apiHash: string; name: string }> = [];

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

async function queryDbDirect(): Promise<{ activeBots: any[]; groupIds: string[] } | null> {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const botsResult = await client.query(
      `SELECT * FROM userbots WHERE is_active = true AND session_string IS NOT NULL AND api_id IS NOT NULL AND api_hash IS NOT NULL ORDER BY bot_order`
    );
    const groupsResult = await client.query(
      `SELECT * FROM groups WHERE group_id IS NOT NULL ORDER BY group_order`
    );
    await client.end();

    const activeBots = botsResult.rows.map((r: any) => ({
      sessionString: r.session_string,
      apiId: r.api_id,
      apiHash: r.api_hash,
      name: r.name,
      isActive: r.is_active,
    }));
    const groupIds = groupsResult.rows.map((r: any) => r.group_id);

    log(`Greeting listener direct DB query: ${activeBots.length} active bots, ${groupIds.length} groups`, "greeting");
    return { activeBots, groupIds };
  } catch (err: any) {
    log(`Greeting listener direct DB query failed: ${err.message}`, "greeting");
    try { await client.end(); } catch {}
    return null;
  }
}

async function getDataWithRetry(maxAttempts = 10, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await queryDbDirect();
      if (result && result.activeBots.length >= 3 && result.groupIds.length > 0) {
        return result;
      }
      const botCount = result?.activeBots.length ?? 0;
      const groupCount = result?.groupIds.length ?? 0;
      if (attempt < maxAttempts) {
        log(`Greeting listener: got ${botCount} bots, ${groupCount} groups (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs / 1000}s...`, "greeting");
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

async function sendUserbotGreeting(bot: { sessionString: string; apiId: string; apiHash: string; name: string }, chatId: string, message: string, botIndex: number): Promise<boolean> {
  try {
    const pythonBin = getPythonPath();
    const { stdout } = await execFileAsync(pythonBin, [
      "server/telegram_sender.py", "send",
      bot.sessionString, bot.apiId, bot.apiHash, chatId, message
    ], { timeout: 60000 });
    const result = JSON.parse(stdout.trim());
    if (result.success) {
      log(`GREETING REPLY: Bot ${botIndex + 1} (${bot.name}) replied '${message.substring(0, 50)}' in ${chatId}`, "greeting");
      return true;
    }
    log(`Greeting send failed for Bot ${botIndex + 1}: ${result.error}`, "greeting");
    return false;
  } catch (err: any) {
    log(`Greeting send error for Bot ${botIndex + 1}: ${err.message}`, "greeting");
    return false;
  }
}

async function dispatchExtraResponses(chatId: string, responses: string[]) {
  if (cachedExtraBots.length === 0) return;

  const available = cachedExtraBots.map((b, i) => ({ bot: b, index: i + 1 }));
  const shuffled = available.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(responses.length, shuffled.length));

  for (let i = 0; i < selected.length; i++) {
    const delay = (15 + Math.floor(Math.random() * 30)) * 1000;
    setTimeout(async () => {
      const { bot, index } = selected[i];
      const success = await sendUserbotGreeting(bot, chatId, responses[i], index);
      try {
        const { storage } = await import("./storage");
        await storage.createMessageLog({
          botName: `Userbot ${index + 1}`,
          groupName: chatId,
          message: responses[i],
          schedulePeriod: "greeting_response",
          status: success ? "sent" : "failed",
        });
      } catch {}
    }, delay);
  }
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

    cachedExtraBots = activeBots.slice(1);

    const spawnData = {
      bots: activeBots.map((b: any) => ({
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
            import("./storage").then(({ storage: st }) => {
              st.createMessageLog({
                botName: `Userbot ${msg.botIndex + 1}`,
                groupName: msg.chatId || "unknown",
                message: msg.response,
                schedulePeriod: "greeting_response",
                status: "sent",
              }).catch(() => {});
            });
          } else if (msg.type === "dispatch_extra_responses") {
            const chatId = msg.chatId;
            const responses = msg.responses as string[];
            if (chatId && responses && responses.length > 0) {
              log(`Dispatching ${responses.length} extra greeting responses to Bots 2-6 for ${chatId}`, "greeting");
              dispatchExtraResponses(chatId, responses).catch(err => {
                log(`Extra response dispatch error: ${err.message}`, "greeting");
              });
            }
          } else if (msg.type === "started") {
            log(`Greeting listener ACTIVE: ${msg.msg}`, "greeting");
            restartCount = 0;
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
