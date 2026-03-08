import cron from "node-cron";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { log } from "./index";
import { MORNING_CHAT_MESSAGES as MORNING_CHAT_BY_LANG, EVENING_CHAT_TOPICS as EVENING_CHAT_BY_LANG, CONVERSATION_LANGUAGES, getConversationLanguageForDay } from "./messages";

const NIGERIA_TZ = "Africa/Lagos";

async function getGroupsWithRetry(maxRetries = 3): Promise<Awaited<ReturnType<typeof storage.getGroups>>> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await storage.getGroups();
      if (result.length === 0 && attempt < maxRetries) {
        log(`getGroups returned 0 results on attempt ${attempt}, retrying in 3s...`, "scheduler");
        await sleep(3000);
        continue;
      }
      return result;
    } catch (err: any) {
      log(`getGroups attempt ${attempt} failed: ${err.message}`, "scheduler");
      if (attempt < maxRetries) await sleep(3000);
    }
  }
  return [];
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

const LANGUAGES = ["English", "Spanish", "French", "Arabic", "Filipino", "Indonesian", "Urdu", "Vietnamese"];

const MAIN_BOT_MESSAGES: Record<string, string[]> = {
  English: [
    "New day, new strategy. Let's start the day with new signals to follow. Team, are you all ready for today's trading session?",
    "Hello everyone, the signal is about to start, let's all get ready for a new start of today's profits.",
    "Get ready for today's trading session, accurate and profitable signals, stable income guaranteed.",
  ],
  Spanish: [
    "Nuevo dia, nueva estrategia. Comencemos el dia con nuevas senales a seguir. Equipo, estan todos listos para la sesion de trading de hoy?",
    "Hola a todos, la senal esta a punto de comenzar, preparemonos todos para un nuevo comienzo de las ganancias de hoy.",
    "Preparense para la sesion de trading de hoy, senales precisas y rentables, ingresos estables garantizados.",
  ],
  French: [
    "Nouveau jour, nouvelle strategie. Commencons la journee avec de nouveaux signaux a suivre. Equipe, etes-vous tous prets pour la session de trading d'aujourd'hui?",
    "Bonjour a tous, le signal est sur le point de commencer, preparons-nous tous pour un nouveau depart des profits d'aujourd'hui.",
    "Preparez-vous pour la session de trading d'aujourd'hui, des signaux precis et rentables, un revenu stable garanti.",
  ],
  Arabic: [
    "يوم جديد، استراتيجية جديدة. لنبدأ اليوم بإشارات جديدة لمتابعتها. الفريق، هل أنتم جميعاً مستعدون لجلسة التداول اليوم؟",
    "مرحباً بالجميع، الإشارة على وشك البدء، لنستعد جميعاً لبداية جديدة لأرباح اليوم.",
    "استعدوا لجلسة التداول اليوم، إشارات دقيقة ومربحة، دخل مستقر مضمون.",
  ],
  Filipino: [
    "Bagong araw, bagong estratehiya. Simulan natin ang araw na may bagong mga signal na susundan. Team, handa na ba kayong lahat para sa trading session ngayon?",
    "Kumusta sa lahat, malapit nang magsimula ang signal, maghanda tayong lahat para sa bagong simula ng kita ngayon.",
    "Maghanda para sa trading session ngayon, tumpak at kumikitang mga signal, garantisadong matatag na kita.",
  ],
  Indonesian: [
    "Hari baru, strategi baru. Mari mulai hari ini dengan sinyal baru untuk diikuti. Tim, apakah kalian semua siap untuk sesi trading hari ini?",
    "Halo semuanya, sinyal akan segera dimulai, mari kita semua bersiap untuk awal baru keuntungan hari ini.",
    "Bersiaplah untuk sesi trading hari ini, sinyal yang akurat dan menguntungkan, pendapatan stabil dijamin.",
  ],
  Urdu: [
    "نیا دن، نئی حکمت عملی۔ آئیے آج کا دن نئے سگنلز کے ساتھ شروع کریں۔ ٹیم، کیا آپ سب آج کے ٹریڈنگ سیشن کے لیے تیار ہیں؟",
    "سب کو سلام، سگنل شروع ہونے والا ہے، آئیے سب آج کے منافع کی نئی شروعات کے لیے تیار ہو جائیں۔",
    "آج کے ٹریڈنگ سیشن کے لیے تیار ہو جائیں، درست اور منافع بخش سگنلز، مستحکم آمدنی کی ضمانت۔",
  ],
  Vietnamese: [
    "Ngay moi, chien luoc moi. Hay bat dau ngay hom nay voi nhung tin hieu moi de theo doi. Doi ngu, moi nguoi da san sang cho phien giao dich hom nay chua?",
    "Xin chao tat ca, tin hieu sap bat dau, chung ta hay san sang cho khoi dau moi cua loi nhuan hom nay.",
    "Hay san sang cho phien giao dich hom nay, tin hieu chinh xac va co loi nhuan, dam bao thu nhap on dinh.",
  ],
};

const READY_MESSAGES = [
  "Ready",
  "I'm ready",
  "All set",
  "Ready for the signal",
  "Waiting for the signal",
  "I'm prepared",
  "We are prepared",
  "I'm active",
];


const DONE_MESSAGES = ["Done"];


const READY_WINDOWS = [
  { startHour: 8, startMin: 20 },
  { startHour: 9, startMin: 20 },
  { startHour: 11, startMin: 20 },
  { startHour: 12, startMin: 20 },
  { startHour: 13, startMin: 20 },
  { startHour: 14, startMin: 20 },
];

let scheduledJobs: cron.ScheduledTask[] = [];
let isSchedulerRunning = false;

function getNigeriaDate(): Date {
  const nigeriaStr = new Date().toLocaleString("en-US", { timeZone: NIGERIA_TZ });
  return new Date(nigeriaStr);
}

function getDayOfYear(): number {
  const now = getNigeriaDate();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function getLanguageForToday(): string {
  return LANGUAGES[getDayOfYear() % LANGUAGES.length];
}

function getMainBotMessageForToday(): string {
  const lang = getLanguageForToday();
  const messages = MAIN_BOT_MESSAGES[lang];
  return messages[getDayOfYear() % messages.length];
}

function shuffleArray<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function generateReadySchedule(windowIndex: number, groupIndex: number, dayOfYear: number, activeBotIndices: number[] = [0, 1, 2, 3]): { botIndex: number; message: string; minuteOffset: number }[] {
  const seed = dayOfYear * 1000 + windowIndex * 100 + groupIndex;
  const shuffledMessages = shuffleArray(READY_MESSAGES, seed);
  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];

  let s = seed + 7;
  let currentMinute = 0;

  for (let i = 0; i < activeBotIndices.length; i++) {
    schedule.push({
      botIndex: activeBotIndices[i],
      message: shuffledMessages[i % shuffledMessages.length],
      minuteOffset: currentMinute,
    });
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const gap = 1 + (s % 3);
    currentMinute += gap;
    if (currentMinute > 10) currentMinute = 10;
  }

  return schedule;
}

function generateEveningMessages(groupIndex: number, dayOfYear: number, groupCount: number = 5, activeBotIndices: number[] = [0, 1, 2, 3]): { botIndex: number; message: string; minuteOffset: number }[] {
  const lang = getConversationLanguageForDay(dayOfYear);
  const eveningTopics = EVENING_CHAT_BY_LANG[lang] || EVENING_CHAT_BY_LANG["English"];
  const dayOfWeek = getNigeriaDate().getDay();
  const topicSets = eveningTopics[dayOfWeek] || eveningTopics[0];

  const allMessages: string[] = [];
  for (const set of topicSets) {
    allMessages.push(...set);
  }

  const seed = dayOfYear * 100 + groupIndex * 37;
  const uniqueMessages = [...new Set(allMessages)];
  const shuffled = shuffleArray(uniqueMessages, seed);

  const totalMinutes = 180;
  const maxMessages = Math.floor(totalMinutes / 5) + 1;
  const groupMessages = shuffled.slice(0, Math.min(maxMessages, shuffled.length));

  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];
  let currentMinute = 0;

  for (let i = 0; i < groupMessages.length && currentMinute < totalMinutes; i++) {
    schedule.push({
      botIndex: activeBotIndices[i % activeBotIndices.length],
      message: groupMessages[i],
      minuteOffset: currentMinute,
    });
    currentMinute += 5;
  }

  return schedule;
}

function generateMorningChatSchedule(groupIndex: number, dayOfYear: number, activeBotIndices: number[] = [0, 1, 2, 3]): { botIndex: number; message: string; minuteOffset: number }[] {
  const lang = getConversationLanguageForDay(dayOfYear);
  const messages = MORNING_CHAT_BY_LANG[lang] || MORNING_CHAT_BY_LANG["English"];
  const seed = dayOfYear * 50 + groupIndex * 7;
  const uniqueMessages = [...new Set(messages)];
  const shuffled = shuffleArray(uniqueMessages, seed);
  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];
  let currentMinute = 0;

  for (let i = 0; i < Math.min(12, shuffled.length) && currentMinute < 60; i++) {
    schedule.push({
      botIndex: activeBotIndices[i % activeBotIndices.length],
      message: shuffled[i],
      minuteOffset: currentMinute,
    });
    currentMinute += 5;
  }

  return schedule;
}

function generateDoneSchedule(groupIndex: number, dayOfYear: number, activeBotIndices: number[] = [0, 1, 2, 3]): { botIndex: number; message: string; minuteOffset: number }[] {
  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];
  let currentMinute = 0;
  const seed = dayOfYear * 30 + groupIndex;
  const botOrder = shuffleArray(activeBotIndices, seed);

  for (let i = 0; i < botOrder.length; i++) {
    schedule.push({
      botIndex: botOrder[i],
      message: "Done",
      minuteOffset: currentMinute,
    });
    currentMinute += 5;
  }

  return schedule;
}

async function getActiveBotIndices(): Promise<number[]> {
  const bots = await storage.getUserbots();
  const indices: number[] = [];
  for (let i = 0; i < bots.length; i++) {
    if (bots[i].isActive && bots[i].sessionString && bots[i].apiId && bots[i].apiHash) {
      indices.push(i);
    }
  }
  return indices.length > 0 ? indices : [0, 1, 2, 3];
}

export async function getFullScheduleForToday(): Promise<any> {
  const dayOfYear = getDayOfYear();
  const language = getLanguageForToday();
  const mainBotMessage = getMainBotMessageForToday();
  const groupsList = await storage.getGroups();
  const numGroups = groupsList.length || 5;
  const activeBots = await getActiveBotIndices();

  const conversationLanguage = getConversationLanguageForDay(dayOfYear);

  const schedule: any = {
    language,
    conversationLanguage,
    mainBotMessage,
    mainBotTime: "8:10 AM",
    groupNames: groupsList.map(g => g.name),
    activeBotIndices: activeBots,
    morningChat: [] as any[],
    readyWindows: [] as any[],
    doneWindow: [] as any[],
    eveningChat: [] as any[],
  };

  for (let g = 0; g < numGroups; g++) {
    const morningItems = generateMorningChatSchedule(g, dayOfYear, activeBots);
    schedule.morningChat.push({
      groupIndex: g,
      messages: morningItems.map(item => ({
        ...item,
        time: `7:${String(item.minuteOffset).padStart(2, "0")} AM`,
      })),
    });
  }

  for (let w = 0; w < READY_WINDOWS.length; w++) {
    const window = READY_WINDOWS[w];
    const windowSchedule: any[] = [];
    for (let g = 0; g < numGroups; g++) {
      const items = generateReadySchedule(w, g, dayOfYear, activeBots);
      windowSchedule.push({
        groupIndex: g,
        messages: items.map(item => {
          const totalMin = window.startMin + item.minuteOffset;
          const hour = window.startHour + Math.floor(totalMin / 60);
          const min = totalMin % 60;
          const ampm = hour >= 12 ? "PM" : "AM";
          const displayHour = hour > 12 ? hour - 12 : hour;
          return {
            ...item,
            time: `${displayHour}:${String(min).padStart(2, "0")} ${ampm}`,
          };
        }),
      });
    }
    const ampm = window.startHour >= 12 ? "PM" : "AM";
    const displayHour = window.startHour > 12 ? window.startHour - 12 : window.startHour;
    schedule.readyWindows.push({
      windowTime: `${displayHour}:${String(window.startMin).padStart(2, "0")} ${ampm}`,
      groups: windowSchedule,
    });
  }

  for (let g = 0; g < numGroups; g++) {
    const doneItems = generateDoneSchedule(g, dayOfYear, activeBots);
    schedule.doneWindow.push({
      groupIndex: g,
      messages: doneItems.map(item => ({
        ...item,
        time: `3:${String(20 + item.minuteOffset).padStart(2, "0")} PM`,
      })),
    });
  }

  for (let g = 0; g < numGroups; g++) {
    const eveningItems = generateEveningMessages(g, dayOfYear, numGroups, activeBots);
    schedule.eveningChat.push({
      groupIndex: g,
      messages: eveningItems.map(item => {
        const totalMin = 30 + item.minuteOffset;
        const hour = 16 + Math.floor(totalMin / 60);
        const min = totalMin % 60;
        const displayHour = hour > 12 ? hour - 12 : hour;
        return {
          ...item,
          time: `${displayHour}:${String(min).padStart(2, "0")} PM`,
        };
      }),
    });
  }

  return schedule;
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 15000, 30000];

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegramBotMessage(token: string, chatId: string, message: string): Promise<boolean> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const TelegramBot = (await import("node-telegram-bot-api")).default;
      const bot = new TelegramBot(token, { polling: false });
      await bot.sendMessage(chatId, message);
      if (attempt > 0) log(`Bot message succeeded on retry #${attempt}`, "telegram");
      return true;
    } catch (err: any) {
      log(`Bot message attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${err.message}`, "telegram");
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || 30000;
        log(`Retrying in ${delay / 1000}s...`, "telegram");
        await sleep(delay);
      }
    }
  }
  log(`Bot message FAILED after ${MAX_RETRIES + 1} attempts`, "telegram");
  return false;
}

async function sendUserbotMessage(sessionString: string, apiId: string, apiHash: string, chatId: string, message: string): Promise<boolean> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const execFileAsync = promisify(execFile);
      const pythonBin = getPythonPath();
      const { stdout } = await execFileAsync(pythonBin, [
        "server/telegram_sender.py", "send",
        sessionString, apiId, apiHash, chatId, message
      ], { timeout: 60000 });
      const result = JSON.parse(stdout.trim());
      if (result.success) {
        if (attempt > 0) log(`Userbot message succeeded on retry #${attempt}`, "telegram");
        return true;
      }
      log(`Userbot send attempt ${attempt + 1} failed: ${result.error}`, "telegram");
    } catch (err: any) {
      log(`Userbot message attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${err.message}`, "telegram");
    }
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] || 30000;
      log(`Retrying in ${delay / 1000}s...`, "telegram");
      await sleep(delay);
    }
  }
  log(`Userbot message FAILED after ${MAX_RETRIES + 1} attempts`, "telegram");
  return false;
}

async function executeScheduledMessage(botName: string, groupName: string, message: string, period: string) {
  const config = await storage.getBotConfig();
  const bots = await storage.getUserbots();
  const groupsList = await storage.getGroups();

  const group = groupsList.find(g => g.name === groupName);
  if (!group || !group.groupId) {
    log(`Group ${groupName} not found or has no group ID`, "scheduler");
    await storage.createMessageLog({
      botName,
      groupName,
      message,
      schedulePeriod: period,
      status: "skipped_no_group",
    });
    return;
  }

  if (botName === "Main Bot") {
    if (!config?.botToken) {
      log("No bot token configured", "scheduler");
      await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: "skipped_no_token" });
      return;
    }
    const success = await sendTelegramBotMessage(config.botToken, group.groupId, message);
    await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: success ? "sent" : "failed" });
  } else {
    const botIndex = parseInt(botName.replace("Userbot ", "")) - 1;
    const bot = bots[botIndex];
    if (!bot || !bot.sessionString || !bot.apiId || !bot.apiHash) {
      log(`${botName} not configured properly (missing session/apiId/apiHash)`, "scheduler");
      await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: "skipped_no_config" });
      return;
    }
    if (!bot.isActive) {
      log(`${botName} is inactive, skipping`, "scheduler");
      await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: "skipped_inactive" });
      return;
    }
    const success = await sendUserbotMessage(bot.sessionString, bot.apiId, bot.apiHash, group.groupId, message);
    await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: success ? "sent" : "failed" });
  }
}

let lastHeartbeat: Date | null = null;

interface FailedMessage {
  botName: string;
  groupName: string;
  message: string;
  period: string;
  failedAt: Date;
  retryCount: number;
}

const failedMessageQueue: FailedMessage[] = [];
const MAX_QUEUE_RETRIES = 2;
const QUEUE_RETRY_INTERVAL = 10 * 60 * 1000;
let queueRetryInterval: ReturnType<typeof setInterval> | null = null;

async function retryFailedMessages(): Promise<void> {
  if (failedMessageQueue.length === 0) return;

  const toRetry = [...failedMessageQueue];
  failedMessageQueue.length = 0;

  log(`Retrying ${toRetry.length} failed messages from queue...`, "scheduler");
  for (const item of toRetry) {
    try {
      await executeScheduledMessage(item.botName, item.groupName, item.message, item.period + "_retry");
      log(`Queue retry SUCCESS: ${item.botName} → ${item.groupName}`, "scheduler");
    } catch (err: any) {
      if (item.retryCount < MAX_QUEUE_RETRIES) {
        item.retryCount++;
        failedMessageQueue.push(item);
        log(`Queue retry FAILED (attempt ${item.retryCount}/${MAX_QUEUE_RETRIES}): ${item.botName} → ${item.groupName}`, "scheduler");
      } else {
        log(`Queue retry EXHAUSTED: ${item.botName} → ${item.groupName} — message permanently failed`, "scheduler");
      }
    }
  }
}

async function safeExecuteScheduledMessage(botName: string, groupName: string, message: string, period: string) {
  try {
    await executeScheduledMessage(botName, groupName, message, period);
  } catch (err: any) {
    log(`CRITICAL: executeScheduledMessage crashed for ${botName}/${groupName}: ${err.message}`, "scheduler");
    failedMessageQueue.push({ botName, groupName, message, period, failedAt: new Date(), retryCount: 0 });
    try {
      await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: "error_crash_queued" });
    } catch (_) {}
  }
}

async function sendOneMessage(
  botName: string,
  groupName: string,
  message: string,
  period: string
): Promise<void> {
  log(`[${period}] SEND START: ${botName} → ${groupName}`, "scheduler");
  try {
    await safeExecuteScheduledMessage(botName, groupName, message, period);
    log(`[${period}] SEND DONE: ${botName} → ${groupName}`, "scheduler");
  } catch (err: any) {
    log(`[${period}] SEND FAILED: ${botName} → ${groupName}: ${err.message}`, "scheduler");
  }
}

async function checkPythonAvailable(): Promise<boolean> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const pythonBin = getPythonPath();
    log(`Python path resolved to: ${pythonBin}`, "scheduler");
    const { stdout } = await execFileAsync(pythonBin, ["-c", "from telethon.sync import TelegramClient; print('OK')"], { timeout: 15000 });
    return stdout.trim() === "OK";
  } catch (err: any) {
    log(`Python3/Telethon check FAILED: ${err.message}`, "scheduler");
    return false;
  }
}

export function startScheduler() {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;
  log("Scheduler started with retry + watchdog protection", "scheduler");

  checkPythonAvailable().then(ok => {
    log(`Python3/Telethon available: ${ok}`, "scheduler");
  });

  const heartbeatJob = cron.schedule("* * * * *", () => {
    lastHeartbeat = getNigeriaDate();
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(heartbeatJob);

  const mainBotJob = cron.schedule("10 8 * * *", async () => {
    try {
      log("=== MAIN BOT MESSAGE TRIGGERED ===", "scheduler");
      const message = getMainBotMessageForToday();
      const groupsList = await getGroupsWithRetry();
      log(`Main bot: sending to ${groupsList.length} groups`, "scheduler");
      for (const group of groupsList) {
        await sendOneMessage("Main Bot", group.name, message, "main_bot_8:10am");
      }
      log("=== MAIN BOT MESSAGE COMPLETE ===", "scheduler");
    } catch (err: any) {
      log(`CRITICAL: Main bot crashed: ${err.message}\n${err.stack}`, "scheduler");
    }
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(mainBotJob);

  const morningJob = cron.schedule("0 7 * * *", async () => {
    try {
      log("=== MORNING CHAT TRIGGERED ===", "scheduler");
      const dayOfYear = getDayOfYear();
      const groupsList = await getGroupsWithRetry();
      const activeBots = await getActiveBotIndices();
      log(`Morning chat: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");

      const allItems: { botName: string; groupName: string; message: string; delayMs: number }[] = [];
      for (let g = 0; g < groupsList.length; g++) {
        const items = generateMorningChatSchedule(g, dayOfYear, activeBots);
        for (const item of items) {
          allItems.push({
            botName: `Userbot ${item.botIndex + 1}`,
            groupName: groupsList[g].name,
            message: item.message,
            delayMs: item.minuteOffset * 60 * 1000,
          });
        }
      }
      allItems.sort((a, b) => a.delayMs - b.delayMs);
      log(`Morning chat: ${allItems.length} total messages queued`, "scheduler");

      let lastDelay = 0;
      for (const item of allItems) {
        const wait = item.delayMs - lastDelay;
        if (wait > 0) await sleep(wait);
        lastDelay = item.delayMs;
        await sendOneMessage(item.botName, item.groupName, item.message, "morning_chat");
      }
      log("=== MORNING CHAT COMPLETE ===", "scheduler");
    } catch (err: any) {
      log(`CRITICAL: Morning chat crashed: ${err.message}\n${err.stack}`, "scheduler");
    }
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(morningJob);

  for (let w = 0; w < READY_WINDOWS.length; w++) {
    const window = READY_WINDOWS[w];
    const readyJob = cron.schedule(`${window.startMin} ${window.startHour} * * *`, async () => {
      try {
        log(`=== READY WINDOW ${w + 1} TRIGGERED ===`, "scheduler");
        const dayOfYear = getDayOfYear();
        const groupsList = await getGroupsWithRetry();
        const activeBots = await getActiveBotIndices();
        log(`Ready window ${w + 1}: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");

        const allItems: { botName: string; groupName: string; message: string; delayMs: number }[] = [];
        for (let g = 0; g < groupsList.length; g++) {
          const items = generateReadySchedule(w, g, dayOfYear, activeBots);
          for (const item of items) {
            allItems.push({
              botName: `Userbot ${item.botIndex + 1}`,
              groupName: groupsList[g].name,
              message: item.message,
              delayMs: item.minuteOffset * 60 * 1000,
            });
          }
        }
        allItems.sort((a, b) => a.delayMs - b.delayMs);
        log(`Ready window ${w + 1}: ${allItems.length} total messages queued`, "scheduler");

        let lastDelay = 0;
        for (const item of allItems) {
          const wait = item.delayMs - lastDelay;
          if (wait > 0) await sleep(wait);
          lastDelay = item.delayMs;
          await sendOneMessage(item.botName, item.groupName, item.message, `ready_window_${w + 1}`);
        }
        log(`=== READY WINDOW ${w + 1} COMPLETE ===`, "scheduler");
      } catch (err: any) {
        log(`CRITICAL: Ready window ${w + 1} crashed: ${err.message}\n${err.stack}`, "scheduler");
      }
    }, { timezone: NIGERIA_TZ });
    scheduledJobs.push(readyJob);
  }

  const doneJob = cron.schedule("20 15 * * *", async () => {
    try {
      log("=== DONE SESSION TRIGGERED ===", "scheduler");
      const dayOfYear = getDayOfYear();
      const groupsList = await getGroupsWithRetry();
      const activeBots = await getActiveBotIndices();
      log(`Done session: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");

      const allItems: { botName: string; groupName: string; message: string; delayMs: number }[] = [];
      for (let g = 0; g < groupsList.length; g++) {
        const items = generateDoneSchedule(g, dayOfYear, activeBots);
        for (const item of items) {
          allItems.push({
            botName: `Userbot ${item.botIndex + 1}`,
            groupName: groupsList[g].name,
            message: item.message,
            delayMs: item.minuteOffset * 60 * 1000,
          });
        }
      }
      allItems.sort((a, b) => a.delayMs - b.delayMs);
      log(`Done session: ${allItems.length} total messages queued`, "scheduler");

      let lastDelay = 0;
      for (const item of allItems) {
        const wait = item.delayMs - lastDelay;
        if (wait > 0) await sleep(wait);
        lastDelay = item.delayMs;
        await sendOneMessage(item.botName, item.groupName, item.message, "done_session");
      }
      log("=== DONE SESSION COMPLETE ===", "scheduler");
    } catch (err: any) {
      log(`CRITICAL: Done session crashed: ${err.message}\n${err.stack}`, "scheduler");
    }
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(doneJob);

  const eveningJob = cron.schedule("0 16 * * *", async () => {
    try {
      log("=== EVENING CHAT TRIGGERED ===", "scheduler");
      const dayOfYear = getDayOfYear();
      const groupsList = await getGroupsWithRetry();
      const activeBots = await getActiveBotIndices();
      log(`Evening chat: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");

      const allItems: { botName: string; groupName: string; message: string; delayMs: number }[] = [];
      for (let g = 0; g < groupsList.length; g++) {
        const items = generateEveningMessages(g, dayOfYear, groupsList.length, activeBots);
        for (const item of items) {
          allItems.push({
            botName: `Userbot ${item.botIndex + 1}`,
            groupName: groupsList[g].name,
            message: item.message,
            delayMs: item.minuteOffset * 60 * 1000,
          });
        }
      }
      allItems.sort((a, b) => a.delayMs - b.delayMs);
      log(`Evening chat: ${allItems.length} total messages queued`, "scheduler");

      let lastDelay = 0;
      for (const item of allItems) {
        const wait = item.delayMs - lastDelay;
        if (wait > 0) await sleep(wait);
        lastDelay = item.delayMs;
        await sendOneMessage(item.botName, item.groupName, item.message, "evening_chat");
      }
      log("=== EVENING CHAT COMPLETE ===", "scheduler");
    } catch (err: any) {
      log(`CRITICAL: Evening chat crashed: ${err.message}\n${err.stack}`, "scheduler");
    }
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(eveningJob);

  queueRetryInterval = setInterval(async () => {
    await retryFailedMessages();
  }, QUEUE_RETRY_INTERVAL);

  log(`Scheduled ${scheduledJobs.length} cron jobs (including heartbeat) + failed-message retry every 10min`, "scheduler");
}

export function stopScheduler() {
  for (const job of scheduledJobs) {
    job.stop();
  }
  scheduledJobs = [];
  if (queueRetryInterval) {
    clearInterval(queueRetryInterval);
    queueRetryInterval = null;
  }
  isSchedulerRunning = false;
  log("Scheduler stopped", "scheduler");
}

export async function triggerEveningChatNow(): Promise<string> {
  try {
    log("=== MANUAL EVENING CHAT TRIGGERED ===", "scheduler");
    const dayOfYear = getDayOfYear();
    const groupsList = await getGroupsWithRetry();
    const activeBots = await getActiveBotIndices();
    log(`Manual evening: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");

    if (groupsList.length === 0) return "No groups configured";

    const now = getNigeriaDate();
    const currentMinutesFromStart = (now.getHours() * 60 + now.getMinutes()) - (16 * 60);

    const allItems: { botName: string; groupName: string; message: string; delayMs: number }[] = [];
    for (let g = 0; g < groupsList.length; g++) {
      const items = generateEveningMessages(g, dayOfYear, groupsList.length, activeBots);
      const remaining = items.filter(item => item.minuteOffset >= currentMinutesFromStart);
      if (remaining.length === 0) continue;
      const firstOffset = remaining[0].minuteOffset;
      for (const item of remaining) {
        allItems.push({
          botName: `Userbot ${item.botIndex + 1}`,
          groupName: groupsList[g].name,
          message: item.message,
          delayMs: (item.minuteOffset - firstOffset) * 60 * 1000,
        });
      }
    }
    allItems.sort((a, b) => a.delayMs - b.delayMs);
    log(`Manual evening: ${allItems.length} messages queued (starting now, offset was ${currentMinutesFromStart}min)`, "scheduler");

    let lastDelay = 0;
    for (const item of allItems) {
      const wait = item.delayMs - lastDelay;
      if (wait > 0) await sleep(wait);
      lastDelay = item.delayMs;
      await sendOneMessage(item.botName, item.groupName, item.message, "evening_chat_manual");
    }
    log("=== MANUAL EVENING CHAT COMPLETE ===", "scheduler");
    return `Dispatched ${allItems.length} messages across ${groupsList.length} groups`;
  } catch (err: any) {
    log(`Manual evening FAILED: ${err.message}\n${err.stack}`, "scheduler");
    return `Error: ${err.message}`;
  }
}

export async function triggerReadyWindowNow(): Promise<string> {
  try {
    log("=== MANUAL READY WINDOW TEST TRIGGERED ===", "scheduler");
    const dayOfYear = getDayOfYear();
    const groupsList = await getGroupsWithRetry();
    const activeBots = await getActiveBotIndices();
    log(`Manual test: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");
    
    if (groupsList.length === 0) return "No groups configured";
    
    const group = groupsList[0];
    const items = generateReadySchedule(0, 0, dayOfYear, activeBots);
    log(`Manual test: group ${group.name} — ${items.length} messages`, "scheduler");
    
    for (const item of items) {
      const botName = `Userbot ${item.botIndex + 1}`;
      log(`Manual test: sending ${botName} → ${group.name}`, "scheduler");
      await safeExecuteScheduledMessage(botName, group.name, item.message, "manual_test");
    }
    
    log("=== MANUAL READY WINDOW TEST COMPLETE ===", "scheduler");
    return `Sent ${items.length} messages to ${group.name}`;
  } catch (err: any) {
    log(`Manual test FAILED: ${err.message}\n${err.stack}`, "scheduler");
    return `Error: ${err.message}`;
  }
}

export function getSchedulerStatus() {
  return {
    isRunning: isSchedulerRunning,
    jobCount: scheduledJobs.length,
    language: getLanguageForToday(),
    conversationLanguage: getConversationLanguageForDay(getDayOfYear()),
    mainBotMessage: getMainBotMessageForToday(),
    lastHeartbeat: lastHeartbeat?.toISOString() || null,
    failedQueueSize: failedMessageQueue.length,
    retryConfig: { maxRetries: MAX_RETRIES, delaysMs: RETRY_DELAYS },
  };
}
