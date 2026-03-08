import cron from "node-cron";
import { storage } from "./storage";
import { log } from "./index";
import { MORNING_CHAT_MESSAGES as MORNING_CHAT_BY_LANG, EVENING_CHAT_TOPICS as EVENING_CHAT_BY_LANG, CONVERSATION_LANGUAGES, getConversationLanguageForDay } from "./messages";

const NIGERIA_TZ = "Africa/Lagos";

const LANGUAGES = ["English", "Spanish", "French", "Arabic", "Filipino", "Indonesian", "Urdu"];

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
  const shuffled = shuffleArray(allMessages, seed);

  const totalGroups = Math.max(groupCount, 1);
  const messagesPerGroup = Math.floor(shuffled.length / totalGroups);
  const startIdx = groupIndex * messagesPerGroup;
  const groupMessages = shuffled.slice(startIdx, startIdx + messagesPerGroup);

  const totalMinutes = 150;
  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];
  let currentMinute = 0;

  for (let i = 0; i < groupMessages.length && currentMinute < totalMinutes; i++) {
    schedule.push({
      botIndex: activeBotIndices[i % activeBotIndices.length],
      message: groupMessages[i],
      minuteOffset: currentMinute,
    });
    currentMinute += 10;
  }

  return schedule;
}

function generateMorningChatSchedule(groupIndex: number, dayOfYear: number, activeBotIndices: number[] = [0, 1, 2, 3]): { botIndex: number; message: string; minuteOffset: number }[] {
  const lang = getConversationLanguageForDay(dayOfYear);
  const messages = MORNING_CHAT_BY_LANG[lang] || MORNING_CHAT_BY_LANG["English"];
  const seed = dayOfYear * 50 + groupIndex * 7;
  const shuffled = shuffleArray(messages, seed);
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

async function sendTelegramBotMessage(token: string, chatId: string, message: string): Promise<boolean> {
  try {
    const TelegramBot = (await import("node-telegram-bot-api")).default;
    const bot = new TelegramBot(token, { polling: false });
    await bot.sendMessage(chatId, message);
    return true;
  } catch (err: any) {
    log(`Failed to send bot message: ${err.message}`, "telegram");
    return false;
  }
}

async function sendUserbotMessage(sessionString: string, apiId: string, apiHash: string, chatId: string, message: string): Promise<boolean> {
  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync("python3", [
      "server/telegram_sender.py", "send",
      sessionString, apiId, apiHash, chatId, message
    ], { timeout: 30000 });
    const result = JSON.parse(stdout.trim());
    if (result.success) {
      return true;
    }
    log(`Userbot send failed: ${result.error}`, "telegram");
    return false;
  } catch (err: any) {
    log(`Failed to send userbot message: ${err.message}`, "telegram");
    return false;
  }
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

export function startScheduler() {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;
  log("Scheduler started", "scheduler");

  const mainBotJob = cron.schedule("10 8 * * *", async () => {
    const message = getMainBotMessageForToday();
    const groupsList = await storage.getGroups();
    for (const group of groupsList) {
      await executeScheduledMessage("Main Bot", group.name, message, "main_bot_8:10am");
    }
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(mainBotJob);

  const morningJob = cron.schedule("0 7 * * *", async () => {
    const dayOfYear = getDayOfYear();
    const groupsList = await storage.getGroups();
    const activeBots = await getActiveBotIndices();
    for (let g = 0; g < groupsList.length; g++) {
      const items = generateMorningChatSchedule(g, dayOfYear, activeBots);
      for (const item of items) {
        setTimeout(async () => {
          await executeScheduledMessage(
            `Userbot ${item.botIndex + 1}`,
            groupsList[g].name,
            item.message,
            "morning_chat"
          );
        }, item.minuteOffset * 60 * 1000);
      }
    }
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(morningJob);

  for (let w = 0; w < READY_WINDOWS.length; w++) {
    const window = READY_WINDOWS[w];
    const readyJob = cron.schedule(`${window.startMin} ${window.startHour} * * *`, async () => {
      const dayOfYear = getDayOfYear();
      const groupsList = await storage.getGroups();
      const activeBots = await getActiveBotIndices();
      for (let g = 0; g < groupsList.length; g++) {
        const items = generateReadySchedule(w, g, dayOfYear, activeBots);
        for (const item of items) {
          setTimeout(async () => {
            await executeScheduledMessage(
              `Userbot ${item.botIndex + 1}`,
              groupsList[g].name,
              item.message,
              `ready_window_${w + 1}`
            );
          }, item.minuteOffset * 60 * 1000);
        }
      }
    }, { timezone: NIGERIA_TZ });
    scheduledJobs.push(readyJob);
  }

  const doneJob = cron.schedule("20 15 * * *", async () => {
    const dayOfYear = getDayOfYear();
    const groupsList = await storage.getGroups();
    const activeBots = await getActiveBotIndices();
    for (let g = 0; g < groupsList.length; g++) {
      const items = generateDoneSchedule(g, dayOfYear, activeBots);
      for (const item of items) {
        setTimeout(async () => {
          await executeScheduledMessage(
            `Userbot ${item.botIndex + 1}`,
            groupsList[g].name,
            item.message,
            "done_session"
          );
        }, item.minuteOffset * 60 * 1000);
      }
    }
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(doneJob);

  const eveningJob = cron.schedule("30 16 * * *", async () => {
    const dayOfYear = getDayOfYear();
    const groupsList = await storage.getGroups();
    const activeBots = await getActiveBotIndices();
    for (let g = 0; g < groupsList.length; g++) {
      const items = generateEveningMessages(g, dayOfYear, groupsList.length, activeBots);
      for (const item of items) {
        setTimeout(async () => {
          await executeScheduledMessage(
            `Userbot ${item.botIndex + 1}`,
            groupsList[g].name,
            item.message,
            "evening_chat"
          );
        }, item.minuteOffset * 60 * 1000);
      }
    }
  }, { timezone: NIGERIA_TZ });
  scheduledJobs.push(eveningJob);
}

export function stopScheduler() {
  for (const job of scheduledJobs) {
    job.stop();
  }
  scheduledJobs = [];
  isSchedulerRunning = false;
  log("Scheduler stopped", "scheduler");
}

export function getSchedulerStatus() {
  return {
    isRunning: isSchedulerRunning,
    jobCount: scheduledJobs.length,
    language: getLanguageForToday(),
    mainBotMessage: getMainBotMessageForToday(),
  };
}
