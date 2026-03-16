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
let cachedGroupLanguages: Record<string, string | null> = {};

const LANGUAGES_ROTATION = ["English", "Spanish", "Arabic", "Indonesian", "Filipino", "Vietnamese"];

function getRotatingLanguageForToday(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return LANGUAGES_ROTATION[dayOfYear % LANGUAGES_ROTATION.length];
}

function getGroupLanguage(chatId: string): string {
  const override = cachedGroupLanguages[chatId];
  if (override) return override.toLowerCase();
  return getRotatingLanguageForToday().toLowerCase();
}

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

async function queryDbDirect(): Promise<{ activeBots: any[]; groupIds: string[]; groupLanguages: Record<string, string | null> } | null> {
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
    const groupLanguages: Record<string, string | null> = {};
    for (const r of groupsResult.rows) {
      groupLanguages[r.group_id] = r.language_override || null;
    }

    log(`Greeting listener direct DB query: ${activeBots.length} active bots, ${groupIds.length} groups`, "greeting");
    return { activeBots, groupIds, groupLanguages };
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

const PROFESSOR_RESPONSES_BY_LANG: Record<string, string[]> = {
  english: [
    "Good day professor!", "Welcome professor!", "Good morning professor!",
    "Hello professor, great to see you!", "Greetings professor!",
    "Welcome back professor!", "Good to see you professor!",
    "Hey professor! Welcome!", "Good day to you professor!",
    "Welcome professor, always a pleasure!", "Hello professor, hope you're doing well!",
    "Good evening professor!", "Hi professor! Glad you're here!",
    "Professor! Welcome!", "Great to have you here professor!",
    "Good afternoon professor!", "Welcome professor, we're glad to have you!",
    "Hey professor, good to see you again!",
  ],
  spanish: [
    "¡Buen día profesor!", "¡Bienvenido profesor!", "¡Buenos días profesor!",
    "¡Hola profesor, qué gusto verlo!", "¡Saludos profesor!",
    "¡Bienvenido de vuelta profesor!", "¡Qué bueno verlo profesor!",
    "¡Hey profesor! ¡Bienvenido!", "¡Buen día para usted profesor!",
    "¡Bienvenido profesor, siempre un placer!", "¡Hola profesor, espero que esté bien!",
    "¡Buenas noches profesor!", "¡Hola profesor! ¡Me alegra que esté aquí!",
    "¡Profesor! ¡Bienvenido!", "¡Qué bueno tenerlo aquí profesor!",
    "¡Buenas tardes profesor!", "¡Bienvenido profesor, estamos contentos de tenerlo!",
    "¡Hey profesor, qué bueno verlo de nuevo!",
  ],
  french: [
    "Bonjour professeur!", "Bienvenue professeur!", "Bon matin professeur!",
    "Bonjour professeur, ravi de vous voir!", "Salutations professeur!",
    "Bon retour professeur!", "Content de vous voir professeur!",
    "Hey professeur! Bienvenue!", "Bonne journée professeur!",
    "Bienvenue professeur, toujours un plaisir!", "Bonjour professeur, j'espère que vous allez bien!",
    "Bonsoir professeur!", "Salut professeur! Content que vous soyez là!",
    "Professeur! Bienvenue!", "Ravi de vous avoir ici professeur!",
    "Bon après-midi professeur!", "Bienvenue professeur, on est contents de vous avoir!",
    "Hey professeur, content de vous revoir!",
  ],
  arabic: [
    "أهلاً بروفيسور!", "مرحباً بروفيسور!", "صباح الخير بروفيسور!",
    "مرحباً بروفيسور، سعيدين بوجودك!", "تحياتي بروفيسور!",
    "أهلاً بعودتك بروفيسور!", "سعيد برؤيتك بروفيسور!",
    "بروفيسور! أهلاً وسهلاً!", "يوم سعيد بروفيسور!",
    "مرحباً بروفيسور، دائماً سعداء بوجودك!", "مرحباً بروفيسور، أتمنى أنك بخير!",
    "مساء الخير بروفيسور!", "أهلاً بروفيسور! سعيدين أنك هنا!",
    "بروفيسور! مرحباً!", "نورت المجموعة بروفيسور!",
    "مساء النور بروفيسور!", "حياك الله بروفيسور!",
    "بروفيسور، سعيدين بعودتك!",
  ],
  filipino: [
    "Magandang araw professor!", "Welcome professor!", "Magandang umaga professor!",
    "Hello professor, masaya kaming makita kayo!", "Pagbati professor!",
    "Welcome back professor!", "Masaya kaming makita kayo professor!",
    "Hey professor! Welcome!", "Magandang araw sa inyo professor!",
    "Welcome professor, laging kasiyahan!", "Hello professor, sana okay kayo!",
    "Magandang gabi professor!", "Hi professor! Glad nandito kayo!",
    "Professor! Welcome!", "Masaya kaming nandito kayo professor!",
    "Magandang hapon professor!", "Welcome professor, masaya kami sa inyo!",
    "Hey professor, glad makita kayo ulit!",
  ],
  indonesian: [
    "Selamat datang profesor!", "Selamat pagi profesor!", "Halo profesor, senang melihat Anda!",
    "Salam profesor!", "Selamat datang kembali profesor!",
    "Senang melihat Anda profesor!", "Hey profesor! Selamat datang!",
    "Selamat siang profesor!", "Selamat datang profesor, selalu senang!",
    "Halo profesor, semoga Anda baik-baik saja!", "Selamat malam profesor!",
    "Hai profesor! Senang Anda di sini!", "Profesor! Selamat datang!",
    "Senang Anda ada di sini profesor!", "Selamat sore profesor!",
    "Selamat datang profesor, kami senang Anda bergabung!",
    "Hey profesor, senang bertemu lagi!", "Hari yang baik profesor!",
  ],
  urdu: [
    "خوش آمدید پروفیسر!", "السلام علیکم پروفیسر!", "صبح بخیر پروفیسر!",
    "ہیلو پروفیسر، آپ کو دیکھ کر خوشی ہوئی!", "آداب پروفیسر!",
    "واپسی پر خوش آمدید پروفیسر!", "آپ کو دیکھ کر اچھا لگا پروفیسر!",
    "پروفیسر! خوش آمدید!", "شام بخیر پروفیسر!",
    "خوش آمدید پروفیسر، ہمیشہ خوشی ہوتی ہے!", "ہیلو پروفیسر، امید ہے آپ خیریت سے ہیں!",
    "پروفیسر! مرحبا!", "آپ کا یہاں ہونا اچھا لگا پروفیسر!",
    "خوش آمدید پروفیسر، ہم خوش ہیں!", "پروفیسر، دوبارہ ملکر خوشی ہوئی!",
  ],
  vietnamese: [
    "Chào giáo sư!", "Chào mừng giáo sư!", "Chào buổi sáng giáo sư!",
    "Xin chào giáo sư, rất vui được gặp!", "Lời chào giáo sư!",
    "Chào mừng giáo sư trở lại!", "Rất vui gặp giáo sư!",
    "Giáo sư! Chào mừng!", "Chúc giáo sư ngày tốt lành!",
    "Chào mừng giáo sư, luôn là niềm vui!", "Xin chào giáo sư, hy vọng giáo sư khỏe!",
    "Chào buổi tối giáo sư!", "Giáo sư! Rất vui có giáo sư ở đây!",
    "Rất vui được có giáo sư ở đây!", "Chào buổi chiều giáo sư!",
    "Chào mừng giáo sư, chúng tôi rất vui!", "Giáo sư, rất vui gặp lại!",
  ],
};

function getProfessorResponses(lang: string): string[] {
  return PROFESSOR_RESPONSES_BY_LANG[lang] || PROFESSOR_RESPONSES_BY_LANG["english"];
}

async function dispatchProfessorResponses(chatId: string) {
  if (cachedExtraBots.length === 0) return;

  const lang = getGroupLanguage(chatId);
  const responses = getProfessorResponses(lang);
  const shuffledResponses = [...responses].sort(() => Math.random() - 0.5);
  const allBots = cachedExtraBots.map((b, i) => ({ bot: b, index: i }));

  log(`PROFESSOR: Sending ${allBots.length} bot responses in ${lang} to ${chatId}`, "greeting");

  for (let i = 0; i < allBots.length; i++) {
    const delay = (10 + Math.floor(Math.random() * 25)) * 1000 + i * (8000 + Math.floor(Math.random() * 12000));
    const responseText = shuffledResponses[i % shuffledResponses.length];
    const { bot, index } = allBots[i];

    setTimeout(async () => {
      const success = await sendUserbotGreeting(bot, chatId, responseText, index);
      try {
        const { storage } = await import("./storage");
        await storage.createMessageLog({
          botName: `Userbot ${index + 1}`,
          groupName: chatId,
          message: responseText,
          schedulePeriod: "professor_greeting",
          status: success ? "sent" : "failed",
        });
      } catch {}
    }, delay);
  }
}

async function dispatchExtraResponses(chatId: string, responses: string[]) {
  if (cachedExtraBots.length === 0) return;

  const available = cachedExtraBots.map((b, i) => ({ bot: b, index: i }));
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
    if (restartCount === 0 && !lastStartTime) {
      log("Greeting listener: waiting 45s after startup before connecting (deployment grace period)...", "greeting");
      await new Promise(r => setTimeout(r, 45000));
      if (intentionalStop) {
        isStarting = false;
        return { started: false, reason: "stopped_during_delay" };
      }
    }

    const data = await getDataWithRetry();
    if (!data) {
      const reason = "DB not ready or insufficient bots/groups after retries";
      log(`Greeting listener: ${reason}`, "greeting");
      isStarting = false;
      return { started: false, reason };
    }

    const { activeBots, groupIds, groupLanguages } = data;

    if (isRunning && listenerProcess) {
      isStarting = false;
      return { started: false, reason: "already_running" };
    }

    cachedExtraBots = [...activeBots];
    cachedGroupLanguages = groupLanguages || {};

    const spawnData = {
      bots: activeBots.map((b: any) => ({
        session: b.sessionString,
        apiId: b.apiId,
        apiHash: b.apiHash,
        name: b.name,
      })),
      groupIds,
      groupLanguages: groupLanguages || {},
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
          } else if (msg.type === "dispatch_professor_responses") {
            const chatId = msg.chatId;
            if (chatId) {
              log(`PROFESSOR: Dispatching ALL bot responses for Knox Derek in ${chatId}`, "greeting");
              dispatchProfessorResponses(chatId).catch(err => {
                log(`Professor response dispatch error: ${err.message}`, "greeting");
              });
            }
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
        if (restartCount > 10) {
          log(`Greeting listener reached max restarts (${restartCount}). Stopping auto-restart. Re-authenticate bots from the production dashboard to fix.`, "greeting");
          return;
        }
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

export function resetGreetingListenerRestarts() {
  restartCount = 0;
  log("Greeting listener restart count reset", "greeting");
}

export function getGreetingListenerStatus() {
  return {
    isRunning: isRunning || isStarting,
    restartCount,
    lastStartTime: lastStartTime?.toISOString() || null,
  };
}
