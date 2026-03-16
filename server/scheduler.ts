import cron from "node-cron";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { storage } from "./storage";
import { log } from "./index";
import { MORNING_THREADS_BY_LANG, MORNING_CHAT_MESSAGES as MORNING_CHAT_BY_LANG, EVENING_CHAT_TOPICS as EVENING_CHAT_BY_LANG, CONVERSATION_LANGUAGES, getConversationLanguageForDay } from "./messages";

const execFileAsync = promisify(execFile);

const NIGERIA_TZ = "Africa/Lagos";

const GROUP_STAGGER_CACHE = new Map<string, number>();

function getGroupStaggerMs(groupName: string, groupIndex: number): number {
  const key = groupName;
  if (GROUP_STAGGER_CACHE.has(key)) return GROUP_STAGGER_CACHE.get(key)!;
  const staggerMs = groupIndex * (60000 + Math.floor(Math.random() * 60000));
  GROUP_STAGGER_CACHE.set(key, staggerMs);
  return staggerMs;
}

function scheduleMessagesWithTimers(
  allItems: { botName: string; groupName: string; message: string; delayMs: number }[],
  sessionName: string
): number {
  const groupNames = Array.from(new Set(allItems.map(i => i.groupName)));
  const groupStagger = new Map<string, number>();
  groupNames.forEach((name, idx) => {
    groupStagger.set(name, idx * (60000 + Math.floor(Math.random() * 60000)));
  });

  let scheduled = 0;
  for (const item of allItems) {
    const msgNum = scheduled + 1;
    const total = allItems.length;
    const stagger = groupStagger.get(item.groupName) || 0;
    const finalDelay = item.delayMs + stagger;
    setTimeout(async () => {
      try {
        log(`${sessionName} msg ${msgNum}/${total}: ${item.botName} → ${item.groupName}`, "scheduler");
        await sendOneMessage(item.botName, item.groupName, item.message, sessionName);
      } catch (err: any) {
        log(`${sessionName} msg ${msgNum}/${total} FAILED: ${err.message}`, "scheduler");
      }
    }, finalDelay);
    scheduled++;
  }
  return scheduled;
}

interface ConversationItem {
  botName: string;
  groupName: string;
  message: string;
  delayMs: number;
  threadId: number;
  msgIndex: number;
  shouldReply: boolean;
}

function scheduleConversationWithReplies(
  allItems: ConversationItem[],
  sessionName: string
): number {
  const byGroup = new Map<string, ConversationItem[]>();
  for (const item of allItems) {
    const key = item.groupName;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(item);
  }

  let scheduled = 0;
  let groupOffset = 0;
  const groupKeys = Array.from(byGroup.keys());
  for (const groupName of groupKeys) {
    const items = byGroup.get(groupName)!;
    items.sort((a: ConversationItem, b: ConversationItem) => a.delayMs - b.delayMs);
    const stagger = groupOffset * (60000 + Math.floor(Math.random() * 60000));
    groupOffset++;

    const byThread = new Map<number, ConversationItem[]>();
    for (const item of items) {
      if (!byThread.has(item.threadId)) byThread.set(item.threadId, []);
      byThread.get(item.threadId)!.push(item);
    }

    const threadKeys = Array.from(byThread.keys());
    for (const threadId of threadKeys) {
      const threadItems = byThread.get(threadId)!;
      const threadKey = `${sessionName}_${groupName}_t${threadId}`;
      const baseDelay = threadItems[0].delayMs + stagger;

      setTimeout(async () => {
        const sentMsgIds: number[] = [];
        for (let i = 0; i < threadItems.length; i++) {
          const item = threadItems[i];
          const msgNum = ++scheduled;
          const total = allItems.length;

          let replyToMsgId: number | undefined;
          if (item.shouldReply && sentMsgIds.length > 0) {
            const replyIdx = item.msgIndex <= 1
              ? 0
              : Math.max(0, sentMsgIds.length - 1 - (item.msgIndex % 2));
            replyToMsgId = sentMsgIds[replyIdx];
          }

          try {
            log(`${sessionName} msg ${msgNum}/${total}: ${item.botName} → ${groupName} (thread=${threadId}, reply=${replyToMsgId || "none"})`, "scheduler");
            const msgId = await sendOneMessage(item.botName, groupName, item.message, sessionName, replyToMsgId);
            if (msgId) sentMsgIds.push(msgId);
          } catch (err: any) {
            log(`${sessionName} msg ${msgNum}/${total} FAILED: ${err.message}`, "scheduler");
          }

          if (i < threadItems.length - 1) {
            const nextDelay = threadItems[i + 1].delayMs - item.delayMs;
            await sleep(Math.max(nextDelay, 15000));
          }
        }
      }, baseDelay);
    }
  }

  return allItems.length;
}

async function queryGroupsDirect(): Promise<Awaited<ReturnType<typeof storage.getGroups>>> {
  const pgMod = await import("pg");
  const client = new pgMod.default.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const res = await client.query("SELECT * FROM groups WHERE group_id IS NOT NULL ORDER BY group_order");
    await client.end();
    return res.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      groupId: r.group_id,
      order: r.group_order,
      languageOverride: r.language_override || null,
    })) as any;
  } catch (err) {
    try { await client.end(); } catch {}
    throw err;
  }
}

async function getGroupsWithRetry(maxRetries = 5): Promise<Awaited<ReturnType<typeof storage.getGroups>>> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = attempt <= 2
        ? await storage.getGroups()
        : await queryGroupsDirect();
      if (result.length === 0 && attempt < maxRetries) {
        log(`getGroups returned 0 results on attempt ${attempt}/${maxRetries}, retrying in 3s...`, "scheduler");
        await sleep(3000);
        continue;
      }
      if (result.length > 0 && attempt > 1) {
        log(`getGroups succeeded on attempt ${attempt} with ${result.length} groups`, "scheduler");
      }
      return result;
    } catch (err: any) {
      log(`getGroups attempt ${attempt}/${maxRetries} failed: ${err.message}`, "scheduler");
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

const LANGUAGES = CONVERSATION_LANGUAGES;

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

const READY_MESSAGES_BY_LANG: Record<string, string[]> = {
  English: ["Ready", "Ready", "Ready", "Ready", "Ready", "Ready", "I'm ready", "All set", "Ready for the signal"],
  Spanish: ["Listo", "Listo", "Listo", "Listo", "Listo", "Listo", "Estoy listo", "Preparado", "Listo para la señal"],
  French: ["Prêt", "Prêt", "Prêt", "Prêt", "Prêt", "Prêt", "Je suis prêt", "Tout est prêt", "Prêt pour le signal"],
  Arabic: ["جاهز", "جاهز", "جاهز", "جاهز", "جاهز", "جاهز", "أنا جاهز", "مستعد", "جاهز للإشارة"],
  Indonesian: ["Siap", "Siap", "Siap", "Siap", "Siap", "Siap", "Saya siap", "Sudah siap", "Siap untuk sinyal"],
  Filipino: ["Handa", "Handa", "Handa", "Handa", "Handa", "Handa", "Handa na ako", "Nakahanda na", "Handa para sa signal"],
  Vietnamese: ["Sẵn sàng", "Sẵn sàng", "Sẵn sàng", "Sẵn sàng", "Sẵn sàng", "Sẵn sàng", "Tôi sẵn sàng", "Đã sẵn sàng", "Sẵn sàng cho tín hiệu"],
};

const DONE_MESSAGES_BY_LANG: Record<string, string[]> = {
  English: ["Done"],
  Spanish: ["Hecho"],
  French: ["Terminé"],
  Arabic: ["تم"],
  Indonesian: ["Selesai"],
  Filipino: ["Tapos na"],
  Vietnamese: ["Xong"],
};


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

function generateNaturalBotOrder(count: number, activeBotIndices: number[], seed: number): number[] {
  const order: number[] = [];
  let s = seed;
  const nextRand = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s; };

  for (let i = 0; i < count; i++) {
    const r = nextRand();
    if (i >= 2 && r % 100 < 35) {
      const recentIdx = i - 1 - (nextRand() % Math.min(2, i));
      order.push(order[recentIdx]);
    } else {
      const pick = activeBotIndices[nextRand() % activeBotIndices.length];
      if (i > 0 && pick === order[i - 1] && r % 100 < 50) {
        const alt = activeBotIndices[nextRand() % activeBotIndices.length];
        order.push(alt);
      } else {
        order.push(pick);
      }
    }
  }
  return order;
}

function generateReadySchedule(windowIndex: number, groupIndex: number, dayOfYear: number, activeBotIndices: number[] = [0, 1, 2, 3], languageOverride?: string | null): { botIndex: number; message: string; minuteOffset: number }[] {
  const lang = resolveGroupLanguage(languageOverride, dayOfYear);
  const readyMessages = READY_MESSAGES_BY_LANG[lang] || READY_MESSAGES_BY_LANG["English"];
  const seed = dayOfYear * 1000 + windowIndex * 100 + groupIndex;
  const shuffledMessages = shuffleArray(readyMessages, seed);
  const allBots = shuffleArray([...activeBotIndices], seed + 7);
  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];

  let s = seed + 7;
  let currentMinute = 0;

  for (let i = 0; i < allBots.length; i++) {
    schedule.push({
      botIndex: allBots[i],
      message: shuffledMessages[i % shuffledMessages.length],
      minuteOffset: currentMinute,
    });
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const gap = 1 + (s % 3);
    currentMinute += gap;
    if (currentMinute > 15) currentMinute = 15;
  }

  return schedule;
}

function betterRandom(seed: number): { next: () => number } {
  let s = seed;
  return {
    next: () => {
      s ^= s << 13;
      s ^= s >> 17;
      s ^= s << 5;
      s = s >>> 0;
      return s;
    }
  };
}

function pickDifferentBot(rng: { next: () => number }, activeBotIndices: number[], exclude: number): number {
  if (activeBotIndices.length <= 1) return activeBotIndices[0];
  for (let attempt = 0; attempt < 5; attempt++) {
    const pick = activeBotIndices[rng.next() % activeBotIndices.length];
    if (pick !== exclude) return pick;
  }
  const filtered = activeBotIndices.filter(b => b !== exclude);
  return filtered[rng.next() % filtered.length];
}

function assignConversationBots(threadLength: number, rng: { next: () => number }, activeBotIndices: number[]): number[] {
  const bots: number[] = [];
  const numBots = activeBotIndices.length;
  const participantCount = Math.min(numBots, Math.max(3, Math.floor(threadLength * 0.6)));
  const shuffled = shuffleArray([...activeBotIndices], rng.next());
  const participants = shuffled.slice(0, participantCount);

  for (let m = 0; m < threadLength; m++) {
    if (m === 0) {
      bots.push(participants[0]);
    } else if (m === 1) {
      bots.push(pickDifferentBot(rng, participants, bots[0]));
    } else {
      const r = rng.next();
      const chance = r % 100;
      if (chance < 20 && bots[m - 1] !== bots[m - 2]) {
        bots.push(bots[m - 1]);
      } else if (chance < 45) {
        bots.push(pickDifferentBot(rng, participants, bots[m - 1]));
      } else if (chance < 65) {
        const earlierBot = bots[Math.max(0, m - 2 - (rng.next() % 2))];
        if (earlierBot !== bots[m - 1]) {
          bots.push(earlierBot);
        } else {
          bots.push(pickDifferentBot(rng, participants, bots[m - 1]));
        }
      } else {
        bots.push(pickDifferentBot(rng, participants, bots[m - 1]));
      }
    }
  }
  return bots;
}

function resolveGroupLanguage(languageOverride: string | null | undefined, dayOfYear: number): string {
  if (!languageOverride) return getConversationLanguageForDay(dayOfYear);
  const langs = languageOverride.split(",").map(l => l.trim()).filter(Boolean);
  if (langs.length === 0) return getConversationLanguageForDay(dayOfYear);
  if (langs.length === 1) return langs[0];
  return langs[dayOfYear % langs.length];
}

function generateEveningMessages(groupIndex: number, dayOfYear: number, groupCount: number = 5, activeBotIndices: number[] = [0, 1, 2, 3], languageOverride?: string | null): { botIndex: number; message: string; minuteOffset: number; threadId: number; msgIndex: number; shouldReply: boolean }[] {
  const lang = resolveGroupLanguage(languageOverride, dayOfYear);
  const eveningTopics = EVENING_CHAT_BY_LANG[lang] || EVENING_CHAT_BY_LANG["English"];
  const dayOfWeek = getNigeriaDate().getDay();
  const topicSets = eveningTopics[dayOfWeek] || eveningTopics[0];
  const dayCycle = dayOfYear % 30;

  const sets = topicSets.map(s => [...s]);
  const seed = dayOfYear * 100 + groupIndex * 37;
  const totalMinutes = 215;

  const startOffset = (dayCycle * groupCount + groupIndex) % sets.length;
  const maxSetsPerGroup = Math.max(2, Math.ceil(sets.length / groupCount));
  const selectedSets: string[][] = [];
  for (let i = 0; i < maxSetsPerGroup && selectedSets.length < maxSetsPerGroup; i++) {
    selectedSets.push(sets[(startOffset + i) % sets.length]);
  }

  const schedule: { botIndex: number; message: string; minuteOffset: number; threadId: number; msgIndex: number; shouldReply: boolean }[] = [];
  let currentMinute = 0;
  const rng = betterRandom(seed + 999);
  const usedMessages = new Set<string>();

  for (let t = 0; t < selectedSets.length; t++) {
    const topicSet = selectedSets[t];
    if (currentMinute >= totalMinutes) break;

    const botShift = (dayCycle + t) % activeBotIndices.length;
    const shiftedBots = [...activeBotIndices.slice(botShift), ...activeBotIndices.slice(0, botShift)];
    const botAssignments = assignConversationBots(topicSet.length, rng, shiftedBots);

    let msgIdx = 0;
    for (let m = 0; m < topicSet.length && currentMinute < totalMinutes; m++) {
      const msg = topicSet[m];
      if (usedMessages.has(msg)) continue;
      usedMessages.add(msg);

      const shouldReply = msgIdx > 0 && (rng.next() % 100) < 60;
      schedule.push({
        botIndex: botAssignments[m],
        message: msg,
        minuteOffset: currentMinute,
        threadId: t,
        msgIndex: msgIdx,
        shouldReply,
      });
      msgIdx++;
      currentMinute += 5;
    }

    currentMinute += 8 + (rng.next() % 7);
  }

  return schedule;
}

function generateMorningChatSchedule(groupIndex: number, dayOfYear: number, activeBotIndices: number[] = [0, 1, 2, 3], languageOverride?: string | null, numGroups: number = 7): { botIndex: number; message: string; minuteOffset: number; threadId: number; msgIndex: number; shouldReply: boolean }[] {
  const lang = resolveGroupLanguage(languageOverride, dayOfYear);
  const threads = MORNING_THREADS_BY_LANG[lang] || MORNING_THREADS_BY_LANG["English"];
  const dayCycle = dayOfYear % 30;
  const threadIndex = (dayCycle + groupIndex) % threads.length;
  const secondThreadIndex = (dayCycle + groupIndex + Math.max(1, Math.floor(threads.length / 2))) % threads.length;

  const selectedThreads = [threads[threadIndex]];
  if (secondThreadIndex !== threadIndex) {
    selectedThreads.push(threads[secondThreadIndex]);
  }

  const seed = dayOfYear * 50 + groupIndex * 7;
  const schedule: { botIndex: number; message: string; minuteOffset: number; threadId: number; msgIndex: number; shouldReply: boolean }[] = [];
  let currentMinute = 0;
  const totalMinutes = 200;
  const rng = betterRandom(seed + 77);

  for (let t = 0; t < selectedThreads.length; t++) {
    const thread = selectedThreads[t];
    if (currentMinute >= totalMinutes) break;

    const botShift = (dayCycle + t) % activeBotIndices.length;
    const shiftedBots = [...activeBotIndices.slice(botShift), ...activeBotIndices.slice(0, botShift)];
    const botAssignments = assignConversationBots(thread.length, rng, shiftedBots);

    for (let m = 0; m < thread.length && currentMinute < totalMinutes; m++) {
      const shouldReply = m > 0 && (rng.next() % 100) < 60;
      schedule.push({
        botIndex: botAssignments[m],
        message: thread[m],
        minuteOffset: currentMinute,
        threadId: t,
        msgIndex: m,
        shouldReply,
      });
      currentMinute += 5;
    }

    currentMinute += 8 + (rng.next() % 7);
  }

  return schedule;
}

const DINNER_PHOTOS: { file: string; assignedBot: number; timeOfDay: "day" | "night" }[] = [
  { file: "meal_01.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_02.jpg", assignedBot: 1, timeOfDay: "day" },
  { file: "meal_03.jpg", assignedBot: 2, timeOfDay: "day" },
  { file: "meal_04.jpg", assignedBot: 3, timeOfDay: "day" },
  { file: "meal_05.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_06.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_07.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_08.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_09.jpg", assignedBot: 8, timeOfDay: "day" },
  { file: "meal_10.jpg", assignedBot: 0, timeOfDay: "day" },
  { file: "meal_11.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_12.jpg", assignedBot: 2, timeOfDay: "day" },
  { file: "meal_13.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_14.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_15.jpg", assignedBot: 5, timeOfDay: "day" },
  { file: "meal_16.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_17.jpg", assignedBot: 7, timeOfDay: "day" },
  { file: "meal_18.jpg", assignedBot: 8, timeOfDay: "day" },
  { file: "meal_19.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_20.jpg", assignedBot: 1, timeOfDay: "day" },
  { file: "meal_21.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_22.jpg", assignedBot: 3, timeOfDay: "day" },
  { file: "meal_23.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_24.jpg", assignedBot: 5, timeOfDay: "day" },
  { file: "meal_25.jpg", assignedBot: 6, timeOfDay: "day" },
  { file: "meal_26.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_27.jpg", assignedBot: 8, timeOfDay: "day" },
  { file: "meal_28.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_29.jpg", assignedBot: 1, timeOfDay: "day" },
  { file: "meal_30.jpg", assignedBot: 2, timeOfDay: "day" },
  { file: "meal_31.jpg", assignedBot: 3, timeOfDay: "day" },
  { file: "meal_32.jpg", assignedBot: 4, timeOfDay: "day" },
  { file: "meal_33.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_34.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_35.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_36.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_37.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_38.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_39.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_40.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_41.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_42.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_43.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_44.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_45.jpg", assignedBot: 8, timeOfDay: "day" },
  { file: "meal_46.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_47.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_48.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_49.jpg", assignedBot: 3, timeOfDay: "day" },
  { file: "meal_50.jpg", assignedBot: 4, timeOfDay: "day" },
  { file: "meal_51.jpg", assignedBot: 5, timeOfDay: "day" },
  { file: "meal_52.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_53.jpg", assignedBot: 7, timeOfDay: "day" },
  { file: "meal_54.jpg", assignedBot: 8, timeOfDay: "day" },
  { file: "meal_55.jpg", assignedBot: 0, timeOfDay: "day" },
  { file: "meal_56.jpg", assignedBot: 1, timeOfDay: "day" },
  { file: "meal_57.jpg", assignedBot: 2, timeOfDay: "day" },
  { file: "meal_58.jpg", assignedBot: 3, timeOfDay: "day" },
  { file: "meal_59.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_60.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_61.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_62.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_63.jpg", assignedBot: 8, timeOfDay: "day" },
  { file: "meal_64.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_65.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_66.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_67.jpg", assignedBot: 3, timeOfDay: "day" },
  { file: "meal_68.jpg", assignedBot: 4, timeOfDay: "day" },
  { file: "meal_69.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_70.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_71.jpg", assignedBot: 7, timeOfDay: "day" },
  { file: "meal_72.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_73.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_74.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_75.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_76.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_77.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_78.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_79.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_80.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_81.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_82.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_83.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_84.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_85.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_86.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_87.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_88.jpg", assignedBot: 6, timeOfDay: "day" },
  { file: "meal_89.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_90.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_91.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_92.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_93.jpg", assignedBot: 2, timeOfDay: "day" },
  { file: "meal_94.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_95.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_96.jpg", assignedBot: 5, timeOfDay: "day" },
  { file: "meal_97.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_98.jpg", assignedBot: 7, timeOfDay: "day" },
  { file: "meal_99.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_100.jpg", assignedBot: 0, timeOfDay: "day" },
  { file: "meal_101.jpg", assignedBot: 1, timeOfDay: "day" },
  { file: "meal_102.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_103.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_104.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_105.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_106.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_107.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_108.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_109.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_110.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_111.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_112.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_113.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_114.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_115.jpg", assignedBot: 6, timeOfDay: "day" },
  { file: "meal_116.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_117.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_118.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_119.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_120.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_121.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_122.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_123.jpg", assignedBot: 5, timeOfDay: "day" },
  { file: "meal_124.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_125.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_126.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_127.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_128.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_129.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_130.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_131.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_132.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_133.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_134.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_135.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_136.jpg", assignedBot: 0, timeOfDay: "day" },
  { file: "meal_137.jpg", assignedBot: 1, timeOfDay: "day" },
  { file: "meal_138.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_139.jpg", assignedBot: 3, timeOfDay: "day" },
  { file: "meal_140.jpg", assignedBot: 4, timeOfDay: "day" },
  { file: "meal_141.jpg", assignedBot: 5, timeOfDay: "day" },
  { file: "meal_142.jpg", assignedBot: 6, timeOfDay: "day" },
  { file: "meal_143.jpg", assignedBot: 7, timeOfDay: "day" },
  { file: "meal_144.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_145.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_146.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_147.jpg", assignedBot: 2, timeOfDay: "day" },
  { file: "meal_148.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_149.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_150.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_151.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_152.jpg", assignedBot: 7, timeOfDay: "day" },
  { file: "meal_153.jpg", assignedBot: 8, timeOfDay: "day" },
  { file: "meal_154.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_155.jpg", assignedBot: 1, timeOfDay: "day" },
  { file: "meal_156.jpg", assignedBot: 2, timeOfDay: "day" },
  { file: "meal_157.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_158.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_159.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_160.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_161.jpg", assignedBot: 7, timeOfDay: "day" },
  { file: "meal_162.jpg", assignedBot: 8, timeOfDay: "day" },
  { file: "meal_163.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_164.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_165.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_166.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_167.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_168.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_169.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_170.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_171.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_172.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_173.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_174.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_175.jpg", assignedBot: 3, timeOfDay: "day" },
  { file: "meal_176.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_177.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_178.jpg", assignedBot: 6, timeOfDay: "day" },
  { file: "meal_179.jpg", assignedBot: 7, timeOfDay: "day" },
  { file: "meal_180.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_181.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_182.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_183.jpg", assignedBot: 2, timeOfDay: "night" },
  { file: "meal_184.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_185.jpg", assignedBot: 4, timeOfDay: "day" },
  { file: "meal_186.jpg", assignedBot: 5, timeOfDay: "day" },
  { file: "meal_187.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_188.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_189.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_190.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_191.jpg", assignedBot: 1, timeOfDay: "night" },
  { file: "meal_192.jpg", assignedBot: 2, timeOfDay: "day" },
  { file: "meal_193.jpg", assignedBot: 3, timeOfDay: "night" },
  { file: "meal_194.jpg", assignedBot: 4, timeOfDay: "night" },
  { file: "meal_195.jpg", assignedBot: 5, timeOfDay: "night" },
  { file: "meal_196.jpg", assignedBot: 6, timeOfDay: "night" },
  { file: "meal_197.jpg", assignedBot: 7, timeOfDay: "night" },
  { file: "meal_198.jpg", assignedBot: 8, timeOfDay: "night" },
  { file: "meal_199.jpg", assignedBot: 0, timeOfDay: "night" },
  { file: "meal_200.jpg", assignedBot: 1, timeOfDay: "night" },
];

const PHOTO_CAPTIONS_NIGHT: Record<string, string[]> = {
  English: [
    "Last night I invited a friend for dinner, after having a sweet delicious meal we discussed a lot about investments and wealth so I introduced Global Alliance to him and joyfully he joined my team with $1,000 first deposit 🍽️",
    "My colleague came over for a home-cooked steak last night. While we relaxed after the meal he asked how I afford this lifestyle now, so I explained everything about Wemotrade and GA Team and he signed up with $2,500 right there on his phone",
    "Surprised my neighbor with a full course seafood platter last night 🦐 She was curious about my new confidence and financial freedom, once I walked her through my GA Team earnings she registered with $800 before leaving my house",
    "Hosted a small rooftop barbecue last night for my cousin, the grilled lamb was perfect. Over drinks I opened my Wemotrade dashboard and showed live trades, he couldn't believe the numbers and joined Global Alliance with $1,500",
    "Made my grandmother's secret jollof rice recipe last night for my childhood friend. He kept saying he can't believe I live like this now, I told him it's all thanks to GA Team, he deposited $700 and said he'll top up on Friday 🔥",
    "Took my sister to a five-star hotel restaurant last night for her birthday dinner. Between courses I showed her my withdrawal history from Wemotrade, she was speechless and signed up to Global Alliance with $3,000",
    "Prepared a traditional pepper soup and grilled fish spread for my work partner last night. He noticed I was driving a new car too, when I explained GA Team is behind everything he joined my team immediately with $1,000",
    "My old university roommate visited last night so I made pasta from scratch with truffle oil. He said my whole life transformed, I agreed and introduced him to Global Alliance, he started with a $500 deposit and plans to increase it weekly",
    "Ordered premium sushi platter delivery for my friend last night as a treat. While eating she asked about my recent vacation photos, I explained how trading with GA Team funds my travels now. She signed up with $2,000 right away 🍣",
    "Set up a candle-lit dinner at home last night for my church brother, made fried rice with grilled chicken. After dessert I pulled up my Wemotrade profits on screen, he was shocked at the consistency and joined with $1,200",
    "Took my mentor out for dinner at a private lounge last night to say thank you. He was impressed I picked such an expensive place, when I credited GA Team for my progress he asked me to register him immediately, deposited $5,000 💰",
    "Whipped up a creamy mushroom risotto for my best friend last night, paired with red wine. She already knew I was doing well but seeing the actual Wemotrade numbers convinced her, she joined Global Alliance with $1,000",
    "Flew my cousin in from another city and took him to the best steakhouse last night. He said the last time he saw me I was struggling, now everything changed because of GA Team. He joined my team with $2,000 before his flight back",
    "Had my barber over for a homemade burger night last night. He's been cutting my hair for years and noticed my glow up, once I explained how Global Alliance works he joined with $600 and told me he's bringing two friends next week",
    "Prepared fresh grilled prawns with garlic butter sauce for my gym partner last night. Between sets of conversation about fitness and finance, he saw my GA Team portfolio and signed up with $1,500, said it's the best investment tip he ever got",
    "Cooked a luxury lamb chop dinner with mashed potatoes for my aunt last night, she kept asking how I learned to cook this well and afford premium ingredients. I told her GA Team changed everything, she joined with $900",
    "Invited my former boss for dinner last night at a waterfront restaurant. He was surprised a former employee could afford this place, I showed him my Wemotrade results and he immediately joined Global Alliance with $4,000",
    "Last night I set a beautiful table with candles and flowers for my best friend, served salmon with asparagus and lemon sauce. She said this felt like a movie, I told her my GA Team income makes it possible, she joined with $1,000 on the spot",
    "Prepared a West African feast last night for my neighbor couple, pounded yam and egusi soup with assorted meat. They were blown away by the spread, when I mentioned GA Team funds this lifestyle they both signed up with $750 each",
    "Made a Japanese-style teriyaki bowl for my training partner last night, complete with miso soup starter. He said I eat better than most restaurants now, I told him Wemotrade and GA Team are the reason, he joined with $1,800 🥢",
  ],
  Spanish: [
    "Anoche invité a mi amigo a cenar, después de una deliciosa comida hablamos mucho sobre inversiones y riqueza así que le presenté Global Alliance y con alegría se unió a mi equipo con $1,000 de primer depósito 🍽️",
    "Mi compañero de trabajo vino anoche a cenar un bistec casero. Mientras descansábamos después de comer me preguntó cómo puedo costear este estilo de vida, le expliqué todo sobre Wemotrade y GA Team y se registró con $2,500 desde su teléfono",
    "Sorprendí a mi vecina con una bandeja completa de mariscos anoche 🦐 Tenía curiosidad por mi nueva confianza y libertad financiera, cuando le mostré mis ganancias de GA Team se registró con $800 antes de irse de mi casa",
    "Organicé una barbacoa en la azotea anoche para mi primo, el cordero a la parrilla quedó perfecto. Tomando unas copas le mostré mi panel de Wemotrade con operaciones en vivo, no podía creer los números y se unió a Global Alliance con $1,500",
    "Preparé la receta secreta de arroz de mi abuela anoche para mi amigo de la infancia. No dejaba de decir que no puede creer que vivo así ahora, le dije que todo es gracias a GA Team, depositó $700 y dijo que agregará más el viernes 🔥",
    "Llevé a mi hermana a un restaurante de hotel cinco estrellas anoche por su cumpleaños. Entre platos le mostré mi historial de retiros de Wemotrade, quedó sin palabras y se registró en Global Alliance con $3,000",
    "Preparé una sopa de pimienta tradicional con pescado a la parrilla para mi socio de trabajo anoche. Notó que también tengo auto nuevo, cuando le expliqué que GA Team está detrás de todo se unió a mi equipo con $1,000",
    "Mi antiguo compañero de universidad me visitó anoche así que hice pasta desde cero con aceite de trufa. Dijo que toda mi vida se transformó, estuve de acuerdo y le presenté Global Alliance, empezó con $500 y planea aumentar semanalmente",
    "Pedí un plato premium de sushi a domicilio para mi amiga anoche como regalo. Mientras comíamos preguntó por mis fotos recientes de vacaciones, le expliqué cómo operar con GA Team financia mis viajes ahora, se registró con $2,000 🍣",
    "Organicé una cena con velas en casa anoche para mi hermano de la iglesia, hice arroz frito con pollo a la parrilla. Después del postre le mostré mis ganancias de Wemotrade en pantalla, quedó impactado y se unió con $1,200",
    "Invité a mi mentor a cenar en un salón privado anoche para agradecerle. Le impresionó que eligiera un lugar tan caro, cuando le dije que GA Team es la razón de mi progreso me pidió que lo registrara, depositó $5,000 💰",
    "Preparé un risotto cremoso de champiñones para mi mejor amiga anoche, acompañado de vino tinto. Ya sabía que me iba bien pero ver los números reales de Wemotrade la convenció, se unió a Global Alliance con $1,000",
    "Traje a mi primo de otra ciudad y lo llevé al mejor restaurante de carnes anoche. Dijo que la última vez que me vio yo estaba en dificultades, ahora todo cambió por GA Team, se unió a mi equipo con $2,000 antes de regresar",
    "Invité a mi barbero a una noche de hamburguesas caseras anoche. Lleva años cortándome el pelo y notó mi cambio, cuando le expliqué cómo funciona Global Alliance se unió con $600 y me dijo que traerá dos amigos la próxima semana",
    "Preparé langostinos frescos a la parrilla con salsa de mantequilla y ajo para mi compañero de gimnasio anoche. Entre conversaciones sobre fitness y finanzas vio mi portafolio de GA Team y se registró con $1,500",
    "Cociné chuletas de cordero de lujo con puré de papa para mi tía anoche, seguía preguntando cómo aprendí a cocinar así y costear ingredientes premium. Le dije que GA Team cambió todo, se unió con $900",
    "Invité a mi antiguo jefe a cenar anoche en un restaurante frente al mar. Le sorprendió que un ex empleado pudiera costear ese lugar, le mostré mis resultados de Wemotrade y se unió a Global Alliance con $4,000",
    "Anoche puse una mesa hermosa con velas y flores para mi mejor amiga, serví salmón con espárragos y salsa de limón. Dijo que esto parecía una película, le dije que mis ingresos de GA Team lo hacen posible, se unió con $1,000",
    "Preparé un banquete para mis vecinos anoche, arroz con carne y plátano frito con surtido de carnes. Quedaron impresionados, cuando les dije que GA Team financia este estilo de vida ambos se registraron con $750 cada uno",
    "Hice un bowl estilo teriyaki japonés para mi compañero de entrenamiento anoche, con sopa miso de entrada. Dijo que como mejor que la mayoría de restaurantes, le dije que Wemotrade y GA Team son la razón, se unió con $1,800 🥢",
  ],
  Indonesian: [
    "Tadi malam saya mengajak teman makan malam, setelah menikmati makanan yang lezat kami banyak berdiskusi tentang investasi dan kekayaan jadi saya memperkenalkan Global Alliance kepadanya dan dengan senang hati dia bergabung dengan tim saya dengan deposit pertama $1,000 🍽️",
    "Rekan kerja saya datang tadi malam untuk makan steak buatan rumah. Sambil santai setelah makan dia bertanya bagaimana saya bisa hidup mewah seperti ini, saya jelaskan semua tentang Wemotrade dan GA Team dan dia langsung daftar dengan $2,500 dari HP-nya",
    "Mengejutkan tetangga saya dengan hidangan seafood lengkap tadi malam 🦐 Dia penasaran dengan kepercayaan diri dan kebebasan finansial baru saya, begitu saya tunjukkan penghasilan GA Team dia langsung mendaftar dengan $800 sebelum pulang",
    "Mengadakan BBQ kecil di rooftop tadi malam untuk sepupu saya, kambing panggangnya sempurna. Sambil minum saya buka dashboard Wemotrade dan tunjukkan trading live, dia tidak percaya angkanya dan bergabung Global Alliance dengan $1,500",
    "Membuat resep rahasia nasi goreng spesial nenek saya tadi malam untuk teman masa kecil. Dia terus bilang tidak percaya saya hidup seperti ini sekarang, saya bilang semua berkat GA Team, dia deposit $700 dan bilang akan tambah hari Jumat 🔥",
    "Mengajak adik perempuan ke restoran hotel bintang lima tadi malam untuk ulang tahunnya. Di antara hidangan saya tunjukkan riwayat penarikan dari Wemotrade, dia speechless dan mendaftar ke Global Alliance dengan $3,000",
    "Menyiapkan sop iga dan ikan bakar tradisional untuk rekan bisnis tadi malam. Dia juga memperhatikan saya bawa mobil baru, ketika saya jelaskan GA Team di balik semuanya dia langsung bergabung dengan tim saya dengan $1,000",
    "Teman kuliah lama berkunjung tadi malam jadi saya buat pasta dari nol dengan minyak truffle. Dia bilang seluruh hidup saya berubah, saya setuju dan perkenalkan dia ke Global Alliance, dia mulai dengan deposit $500 dan rencana tambah setiap minggu",
    "Memesan platter sushi premium delivery untuk teman saya tadi malam sebagai traktiran. Sambil makan dia tanya soal foto liburan saya baru-baru ini, saya jelaskan trading dengan GA Team yang membiayai perjalanan saya. Dia daftar dengan $2,000 langsung 🍣",
    "Mengatur makan malam romantis dengan lilin di rumah tadi malam untuk saudara gereja, buat nasi goreng dengan ayam panggang. Setelah dessert saya tunjukkan profit Wemotrade di layar, dia terkejut dengan konsistensinya dan bergabung dengan $1,200",
    "Mengajak mentor saya makan malam di lounge privat tadi malam untuk berterima kasih. Dia terkesan saya pilih tempat semahal itu, ketika saya bilang GA Team alasan kemajuan saya dia minta saya daftarkan segera, deposit $5,000 💰",
    "Membuat risotto jamur creamy untuk sahabat tadi malam, dipasangkan dengan anggur merah. Dia sudah tahu saya sukses tapi melihat angka asli Wemotrade meyakinkannya, dia bergabung Global Alliance dengan $1,000",
    "Menjemput sepupu dari kota lain dan mengajaknya ke steakhouse terbaik tadi malam. Dia bilang terakhir ketemu saya masih susah, sekarang semua berubah karena GA Team. Dia bergabung tim saya dengan $2,000 sebelum terbang pulang",
    "Mengundang tukang cukur saya untuk malam burger buatan rumah tadi malam. Dia sudah potong rambut saya bertahun-tahun dan memperhatikan perubahan saya, begitu saya jelaskan cara kerja Global Alliance dia bergabung dengan $600 dan bilang akan bawa dua teman minggu depan",
    "Menyiapkan udang panggang segar dengan saus mentega bawang putih untuk teman gym tadi malam. Di antara obrolan soal fitness dan keuangan dia lihat portfolio GA Team saya dan langsung daftar dengan $1,500, bilang ini tips investasi terbaik yang pernah dia dapat",
    "Memasak lamb chop mewah dengan kentang tumbuk untuk tante tadi malam, dia terus bertanya bagaimana saya bisa masak seenak ini dan beli bahan premium. Saya bilang GA Team mengubah segalanya, dia bergabung dengan $900",
    "Mengundang mantan bos untuk makan malam tadi malam di restoran tepi pantai. Dia kaget mantan karyawannya bisa afford tempat ini, saya tunjukkan hasil Wemotrade dan dia langsung bergabung Global Alliance dengan $4,000",
    "Tadi malam saya menata meja indah dengan lilin dan bunga untuk sahabat, menyajikan salmon dengan asparagus dan saus lemon. Dia bilang ini seperti di film, saya bilang pendapatan GA Team yang membuat semua ini mungkin, dia bergabung dengan $1,000",
    "Menyiapkan pesta masakan tradisional tadi malam untuk pasangan tetangga, nasi tumpeng dengan aneka lauk pauk. Mereka terpukau dengan hidangannya, ketika saya bilang GA Team membiayai gaya hidup ini keduanya mendaftar dengan $750 masing-masing",
    "Membuat teriyaki bowl ala Jepang untuk teman latihan tadi malam, lengkap dengan sup miso. Dia bilang saya makan lebih enak dari kebanyakan restoran sekarang, saya bilang Wemotrade dan GA Team alasannya, dia bergabung dengan $1,800 🥢",
  ],
};

const PHOTO_CAPTIONS_DAY: Record<string, string[]> = {
  English: [
    "Today I invited a friend for dinner, after having a sweet delicious meal we discussed a lot about investments and wealth so I introduced Global Alliance to him and joyfully he joined my team with $1,000 first deposit 🍽️",
    "Brunch date with my old classmate this afternoon turned into something special. Over pancakes and fresh juice I casually mentioned my Wemotrade returns, she pulled out her laptop right there at the table and joined GA Team with $2,500",
    "Treated my gym buddy to a healthy grilled chicken bowl today after our workout. He's been noticing my new watches and clothes, when I finally revealed it's all from GA Team trading profits he registered with $800 on the spot 💪",
    "Sunday cookout at my place today, made jerk chicken with plantain for my neighbor. He tasted the food and said bro your life has completely changed, I showed him my Wemotrade account balance and he joined Global Alliance with $1,500 immediately",
    "Took my aunt out for brunch at a rooftop cafe today, ordered the full spread. She kept asking where all this money comes from, I walked her through my GA Team journey step by step and she signed up with $700 before we even got dessert 🔥",
    "Prepared a fresh Mediterranean salad bowl with grilled shrimp for my colleague today at home. She was amazed I cook like a chef now, I told her trading with Wemotrade and being part of GA Team gave me the freedom to learn new things, she joined with $3,000",
    "My barber came by for a homemade pizza lunch today, we made it from scratch together. While waiting for it to bake I showed him my trading history on GA Team, he was blown away and signed up with $1,000 right from my kitchen counter",
    "Booked a private dining experience at a wine bar today for my college mentor. He said he's proud of how far I've come, when I told him Global Alliance is my main income source now he asked me to sign him up, deposited $500 and said he'll add more soon",
    "Whipped up a Brazilian-style rice and steak bowl today for my younger brother visiting from out of town. He couldn't stop taking photos of the food, when I explained GA Team funds this lifestyle he enrolled with $2,000 without hesitation 🥩",
    "Had a beautiful lakeside picnic today with my friend, packed gourmet sandwiches and sparkling water. The whole vibe was luxury, she asked how I pull this off every weekend and I introduced her to Wemotrade and GA Team, she joined with $1,200",
    "Invited my driving instructor from years ago for a thank-you lunch today. He didn't recognize me at first because of how much I've upgraded, when I shared that GA Team is the source he immediately registered with $5,000 and thanked me for the opportunity 💰",
    "Made a colorful acai bowl topped with granola and fresh fruits for my fitness coach today. She's all about health and wealth so when I showed her how GA Team combines both she joined Global Alliance with $1,000 and is already excited to grow",
    "Flew my childhood best friend in and took him to an upscale buffet today. He said the last time we hung out I couldn't afford restaurant food, now I'm paying for first class meals. Told him about GA Team and he joined with $2,000 before his flight home",
    "Set up an outdoor garden lunch today for my yoga instructor, fresh grilled salmon with herbs. She noticed my whole energy changed this year, I credited Global Alliance for my financial peace and she registered with $600, bringing her sister next time",
    "Hosted a smoothie and waffle brunch today for three of my neighbors. One of them saw my Wemotrade dashboard on my tablet and asked about it, by the end of brunch all three signed up to GA Team, depositing $1,500, $800, and $1,000",
    "Prepared an elaborate Turkish breakfast spread today for my business partner, everything from eggs to pastries. He was impressed at the quality, when I told him my GA Team profits funded this entire lifestyle overhaul he joined with $900",
    "Took my former teacher to a Michelin-recommended restaurant today to show gratitude. She cried when she saw how well I'm doing, I told her Global Alliance and Wemotrade made it possible. She signed up with $4,000 and said she wishes she knew sooner",
    "Organized a sushi-making workshop at home today with my creative partner. While rolling maki together I showed her my consistent GA Team weekly earnings, she was fascinated and joined with $1,000 on the spot 🍣",
    "Made a massive seafood paella today for my uncle's family visit. The whole table was impressed, my uncle pulled me aside and asked what changed in my finances. I introduced him to GA Team and he deposited $750 right there, his wife added $750 too",
    "Prepared a farm-to-table style lunch today for my real estate agent friend, roasted vegetables with herb-crusted chicken. She's used to seeing luxury but was surprised I cook this well now, told her GA Team gave me time freedom to enjoy life. She joined with $1,800 🌿",
  ],
  Spanish: [
    "Hoy invité a mi amigo a comer, después de una deliciosa comida hablamos mucho sobre inversiones y riqueza así que le presenté Global Alliance y con alegría se unió a mi equipo con $1,000 de primer depósito 🍽️",
    "El brunch con mi antigua compañera de clase esta tarde se convirtió en algo especial. Mientras comíamos panqueques y jugo fresco mencioné mis retornos de Wemotrade, sacó su portátil ahí mismo y se unió a GA Team con $2,500",
    "Invité a mi compañero de gym a un bowl de pollo a la parrilla después del entrenamiento hoy. Ha notado mis relojes y ropa nuevos, cuando finalmente le revelé que todo es de las ganancias de GA Team se registró con $800 al instante 💪",
    "Asado dominical en mi casa hoy, preparé pollo con plátano para mi vecino. Probó la comida y dijo hermano tu vida cambió completamente, le mostré mi saldo de Wemotrade y se unió a Global Alliance con $1,500",
    "Llevé a mi tía a un brunch en una cafetería en la azotea hoy, pedí el menú completo. Seguía preguntando de dónde sale todo este dinero, le expliqué mi camino en GA Team paso a paso y se registró con $700 antes del postre 🔥",
    "Preparé una ensalada mediterránea fresca con camarones a la parrilla para mi colega hoy en casa. Estaba asombrada de que cocino como chef ahora, le dije que Wemotrade y GA Team me dieron la libertad de aprender cosas nuevas, se unió con $3,000",
    "Mi barbero vino a comer pizza casera hoy, la hicimos desde cero juntos. Mientras esperábamos que se horneara le mostré mi historial de trading en GA Team, quedó impresionado y se registró con $1,000 desde la barra de mi cocina",
    "Reservé una experiencia gastronómica privada en un bar de vinos hoy para mi mentor universitario. Dijo que está orgulloso de lo lejos que llegué, cuando le dije que Global Alliance es mi fuente principal de ingresos me pidió que lo registrara, depositó $500",
    "Preparé un bowl brasileño de arroz con carne hoy para mi hermano menor que vino de visita. No paraba de tomar fotos de la comida, cuando le expliqué que GA Team financia este estilo de vida se inscribió con $2,000 sin dudar 🥩",
    "Tuve un hermoso picnic junto al lago hoy con mi amiga, empaqué sándwiches gourmet y agua con gas. Todo el ambiente era lujo, preguntó cómo hago esto cada fin de semana y le presenté Wemotrade y GA Team, se unió con $1,200",
    "Invité a mi instructor de conducir de hace años a un almuerzo de agradecimiento hoy. No me reconoció al principio por cuánto he mejorado, cuando le compartí que GA Team es la fuente se registró con $5,000 y me agradeció 💰",
    "Preparé un colorido bowl de acai con granola y frutas frescas para mi entrenadora fitness hoy. Le gusta la salud y la riqueza así que cuando le mostré cómo GA Team combina ambos se unió a Global Alliance con $1,000",
    "Traje a mi mejor amigo de la infancia y lo llevé a un buffet exclusivo hoy. Dijo que la última vez que salimos yo no podía pagar comida de restaurante, ahora pago comidas de primera clase. Le conté de GA Team y se unió con $2,000",
    "Organicé un almuerzo en el jardín hoy para mi instructora de yoga, salmón fresco a la parrilla con hierbas. Notó que mi energía cambió este año, le di crédito a Global Alliance por mi paz financiera y se registró con $600",
    "Organicé un brunch de smoothies y waffles hoy para tres vecinos. Uno vio mi panel de Wemotrade en mi tablet, al final del brunch los tres se registraron en GA Team con $1,500, $800 y $1,000 respectivamente",
    "Preparé un elaborado desayuno turco hoy para mi socio de negocios, desde huevos hasta pasteles. Quedó impresionado con la calidad, cuando le dije que mis ganancias de GA Team financian este cambio de vida se unió con $900",
    "Llevé a mi antigua profesora a un restaurante con recomendación Michelin hoy. Lloró al ver lo bien que estoy, le dije que Global Alliance y Wemotrade lo hicieron posible, se registró con $4,000 y dijo que ojalá hubiera sabido antes",
    "Organicé un taller de sushi en casa hoy con mi socia creativa. Mientras enrollábamos maki le mostré mis ganancias semanales consistentes de GA Team, quedó fascinada y se unió con $1,000 🍣",
    "Hice una paella de mariscos enorme hoy para la visita de la familia de mi tío. Toda la mesa quedó impresionada, mi tío me apartó y preguntó qué cambió en mis finanzas. Le presenté GA Team y depositó $750, su esposa agregó $750 también",
    "Preparé un almuerzo estilo farm-to-table hoy para mi amiga agente inmobiliaria, vegetales asados con pollo con hierbas. Está acostumbrada al lujo pero le sorprendió que cocino tan bien ahora, le dije que GA Team me dio libertad, se unió con $1,800 🌿",
  ],
  Indonesian: [
    "Hari ini saya mengajak teman makan, setelah menikmati makanan yang lezat kami banyak berdiskusi tentang investasi dan kekayaan jadi saya memperkenalkan Global Alliance kepadanya dan dengan senang hati dia bergabung dengan tim saya dengan deposit pertama $1,000 🍽️",
    "Brunch siang ini dengan teman sekelas lama berubah jadi sesuatu yang spesial. Sambil makan pancake dan jus segar saya kasual sebutkan return Wemotrade saya, dia langsung keluarkan laptop dan daftar GA Team dengan $2,500",
    "Mentraktir teman gym makan bowl ayam panggang sehat hari ini setelah latihan. Dia sudah perhatikan jam tangan dan baju baru saya, ketika saya akhirnya ungkap semua dari profit trading GA Team dia langsung daftar dengan $800 💪",
    "Masak-masak hari Minggu di rumah hari ini, bikin ayam bakar dengan pisang goreng untuk tetangga. Dia cicipi makanannya dan bilang bro hidupmu benar-benar berubah, saya tunjukkan saldo Wemotrade dan dia bergabung Global Alliance dengan $1,500",
    "Mengajak tante brunch di kafe rooftop hari ini, pesan menu lengkap. Dia terus tanya darimana semua uang ini, saya jelaskan perjalanan GA Team saya langkah demi langkah dan dia daftar dengan $700 bahkan sebelum dessert datang 🔥",
    "Menyiapkan salad Mediterania segar dengan udang panggang untuk kolega di rumah hari ini. Dia kagum saya masak seperti chef sekarang, saya bilang trading Wemotrade dan bagian dari GA Team memberi kebebasan belajar hal baru, dia bergabung dengan $3,000",
    "Tukang cukur saya datang untuk makan pizza buatan rumah hari ini, kami buat dari nol bersama. Sambil menunggu dipanggang saya tunjukkan riwayat trading GA Team, dia terpukau dan daftar dengan $1,000 langsung dari meja dapur saya",
    "Memesan pengalaman dining privat di wine bar hari ini untuk mentor kuliah. Dia bilang bangga melihat kemajuan saya, ketika saya bilang Global Alliance sekarang sumber pendapatan utama saya dia minta didaftarkan, deposit $500 dan bilang akan tambah segera",
    "Membuat nasi dengan steak ala Brasil hari ini untuk adik laki-laki yang berkunjung dari luar kota. Dia tidak berhenti foto makanannya, ketika saya jelaskan GA Team membiayai gaya hidup ini dia langsung mendaftar dengan $2,000 tanpa ragu 🥩",
    "Piknik cantik di tepi danau hari ini dengan teman, bawa sandwich gourmet dan air sparkling. Vibes-nya mewah banget, dia tanya bagaimana saya bisa begini setiap akhir pekan dan saya perkenalkan Wemotrade dan GA Team, dia bergabung dengan $1,200",
    "Mengundang instruktur mengemudi dari bertahun-tahun lalu untuk makan siang terima kasih hari ini. Dia tidak mengenali saya awalnya karena perubahan drastis, ketika saya bilang GA Team sumbernya dia langsung daftar dengan $5,000 dan berterima kasih atas kesempatan ini 💰",
    "Membuat acai bowl warna-warni dengan granola dan buah segar untuk pelatih fitness hari ini. Dia suka kesehatan dan kekayaan jadi ketika saya tunjukkan bagaimana GA Team menggabungkan keduanya dia bergabung Global Alliance dengan $1,000",
    "Menjemput sahabat masa kecil dan ajak ke buffet mewah hari ini. Dia bilang terakhir kita nongkrong saya tidak mampu makan restoran, sekarang saya bayar makanan kelas satu. Ceritakan tentang GA Team dan dia bergabung dengan $2,000 sebelum pulang",
    "Menyiapkan makan siang di taman outdoor hari ini untuk instruktur yoga saya, salmon panggang segar dengan herbs. Dia perhatikan energi saya berubah total tahun ini, saya berikan kredit ke Global Alliance untuk ketenangan finansial dan dia daftar dengan $600",
    "Mengadakan brunch smoothie dan waffle hari ini untuk tiga tetangga. Salah satu melihat dashboard Wemotrade di tablet saya, di akhir brunch ketiganya mendaftar GA Team, deposit $1,500, $800, dan $1,000",
    "Menyiapkan sarapan ala Turki yang lengkap hari ini untuk partner bisnis, dari telur sampai pastry. Dia terkesan kualitasnya, ketika saya bilang profit GA Team membiayai seluruh perubahan gaya hidup ini dia bergabung dengan $900",
    "Mengajak mantan guru ke restoran rekomendasi Michelin hari ini sebagai ungkapan terima kasih. Dia menangis melihat betapa sukses saya, saya bilang Global Alliance dan Wemotrade yang memungkinkan ini. Dia daftar dengan $4,000 dan bilang andai dia tahu lebih awal",
    "Mengorganisir workshop membuat sushi di rumah hari ini dengan partner kreatif. Sambil menggulung maki saya tunjukkan penghasilan mingguan konsisten dari GA Team, dia terpesona dan bergabung dengan $1,000 langsung 🍣",
    "Membuat paella seafood besar hari ini untuk kunjungan keluarga paman. Seluruh meja terkesan, paman menarik saya ke samping dan tanya apa yang berubah di keuangan saya. Saya perkenalkan GA Team dan dia deposit $750, istrinya tambah $750 juga",
    "Menyiapkan makan siang farm-to-table hari ini untuk teman agen properti, sayuran panggang dengan ayam berbalut herbs. Dia terbiasa lihat kemewahan tapi terkejut saya masak seenak ini sekarang, bilang GA Team memberi kebebasan waktu menikmati hidup. Dia bergabung dengan $1,800 🌿",
  ],
};

const DINNER_COMMENTS: Record<string, string[]> = {
  English: [
    "Wow that's nice, it's always good to invite friends to dinner and then tell them about investment to join your team and everyone will earn profits together as a good friend",
    "Nice that's very nice I'll also invite a friend to dinner today, hopefully he joins me soon",
    "That's amazing, people join you when you are progressing and have something to show for it",
    "Yes inviting friends for dinner is a good evidence of progress",
    "Nice you are amazing I wish you more success and progress, I'll invite my friends too",
    "I'll invite my friend for dinner too I'll never let her miss this opportunity",
    "That's how it starts, once they see the proof they can't resist joining",
    "Wow that's wonderful, good food opens doors to good conversations about investments",
    "This is the best way to build your team honestly, invite them share a meal and show them what's possible",
    "I'm planning my own dinner invite this weekend, can't wait to grow my team too 🔥",
    "That's real friendship right there, sharing opportunities not just meals",
    "Your team is growing so fast, I'm really impressed with your progress",
    "When your lifestyle speaks you don't need to convince anyone, they see it and want to join",
    "I'm so happy for you, keep inviting friends and sharing this amazing opportunity",
    "That meal looks absolutely incredible, no wonder your friend was impressed and joined",
    "I wish everyone here more success and more delicious dinners with friends",
    "Good food and good business always go together, keep it up",
    "Your friend is lucky to have someone like you who shares opportunities over dinner",
    "I'm going to cook dinner for my best friend tomorrow and show her my trading profits too",
    "We are all doing great things, keep inviting your friends and sharing this opportunity over good meals",
    "That's the power of this community, we help each other grow one dinner at a time",
    "Wow the food looks so delicious, I need to step up my dinner game too 😂",
    "She will definitely join when she sees what you've achieved, good luck",
    "I also want to invite my friend for dinner soon, this inspired me",
    "Nothing beats building wealth while building friendships over delicious food",
    "I'm so proud of everyone here, we are changing lives one dinner invitation at a time 🙏",
    "That's beautiful, your progress is showing and people want to be part of it",
    "I love this, inviting friends for dinner is the classiest way to introduce them to the opportunity",
    "Keep going everyone, our teams are growing because we are showing real results",
    "Incredible, the food and the opportunity are both amazing, what a combination",
  ],
  Spanish: [
    "Wow qué bien, siempre es bueno invitar amigos a cenar y luego contarles sobre inversiones para que se unan a tu equipo y todos ganen juntos",
    "Muy bien yo también invitaré a un amigo a cenar hoy, ojalá se una pronto",
    "Eso es increíble, la gente se une cuando ves que estás progresando y tienes algo que mostrar",
    "Sí invitar amigos a cenar es una buena evidencia de progreso",
    "Increíble te deseo más éxito y progreso, yo también invitaré a mis amigos",
    "Yo invitaré a mi amiga a cenar también, no dejaré que se pierda esta oportunidad 🔥",
    "Así es como empieza, una vez que ven la prueba no pueden resistirse",
    "Wow eso es maravilloso, la buena comida abre puertas a buenas conversaciones sobre inversiones",
    "Esta es la mejor forma de construir tu equipo, invítalos comparte una comida y muéstrales lo que es posible",
    "Estoy planeando mi propia invitación a cenar este fin de semana, quiero hacer crecer mi equipo 🔥",
    "Esa es una amistad real, compartir oportunidades no solo comidas",
    "Tu equipo está creciendo muy rápido, estoy impresionado con tu progreso",
    "Cuando tu estilo de vida habla no necesitas convencer a nadie, lo ven y quieren unirse",
    "Estoy muy feliz por ti, sigue invitando amigos y compartiendo esta oportunidad",
    "Esa comida se ve absolutamente increíble, con razón tu amigo quedó impresionado y se unió",
    "Le deseo a todos más éxito y más cenas deliciosas con amigos",
    "La buena comida y los buenos negocios siempre van juntos, sigue así",
    "Tu amigo tiene suerte de tener a alguien como tú que comparte oportunidades durante la cena",
    "Voy a cocinar para mi mejor amigo mañana y mostrarle mis ganancias de trading",
    "Todos estamos haciendo grandes cosas, sigan invitando amigos y compartiendo esta oportunidad",
    "Ese es el poder de esta comunidad, nos ayudamos mutuamente a crecer una cena a la vez",
    "Wow la comida se ve tan deliciosa, necesito mejorar mis cenas también 😂",
    "Seguro se unirá cuando vea lo que has logrado, buena suerte",
    "Yo también quiero invitar a mi amigo a cenar pronto, esto me inspiró",
    "Nada supera construir riqueza mientras construyes amistades con comida deliciosa",
  ],
  Indonesian: [
    "Wow keren, memang selalu bagus mengajak teman makan malam lalu ceritakan tentang investasi supaya bergabung dengan tim dan semua mendapat untung bersama",
    "Bagus sekali saya juga akan mengajak teman makan malam hari ini, semoga dia segera bergabung",
    "Luar biasa, orang bergabung ketika kamu sudah maju dan punya sesuatu untuk ditunjukkan",
    "Ya mengajak teman makan malam adalah bukti kemajuan yang bagus",
    "Keren kamu luar biasa, saya doakan lebih banyak sukses dan kemajuan, saya juga akan mengajak teman-teman saya",
    "Saya akan mengajak teman saya makan malam juga, saya tidak akan membiarkan dia melewatkan kesempatan ini 🔥",
    "Begitulah awalnya, begitu mereka lihat buktinya mereka tidak bisa menolak",
    "Wow itu luar biasa, makanan enak membuka pintu untuk percakapan yang baik tentang investasi",
    "Ini cara terbaik membangun tim, ajak mereka berbagi makanan dan tunjukkan apa yang mungkin",
    "Saya merencanakan undangan makan malam sendiri akhir pekan ini, tidak sabar mengembangkan tim saya 🔥",
    "Itu persahabatan sejati, berbagi kesempatan bukan hanya makanan",
    "Tim kamu tumbuh sangat cepat, saya sangat terkesan dengan kemajuanmu",
    "Ketika gaya hidupmu berbicara kamu tidak perlu meyakinkan siapapun, mereka lihat dan ingin bergabung",
    "Saya sangat senang untukmu, terus ajak teman dan bagikan kesempatan luar biasa ini",
    "Makanannya terlihat luar biasa, pantas temanmu terkesan dan bergabung",
    "Saya doakan semua lebih sukses dan lebih banyak makan malam lezat dengan teman-teman",
    "Makanan enak dan bisnis bagus selalu berjalan bersama, lanjutkan terus",
    "Temanmu beruntung punya seseorang sepertimu yang berbagi kesempatan saat makan malam",
    "Saya akan masak untuk sahabat saya besok dan tunjukkan profit trading saya juga",
    "Kita semua melakukan hal-hal hebat, terus ajak teman dan bagikan kesempatan ini sambil makan enak",
    "Itulah kekuatan komunitas ini, kita saling membantu tumbuh satu makan malam pada satu waktu",
    "Wow makanannya terlihat sangat lezat, saya perlu tingkatkan kemampuan masak saya juga 😂",
    "Dia pasti akan bergabung ketika lihat apa yang sudah kamu capai, semoga sukses",
    "Saya juga mau ajak teman makan malam segera, ini menginspirasi saya",
    "Tidak ada yang mengalahkan membangun kekayaan sambil membangun persahabatan lewat makanan lezat",
  ],
};

const DINNER_TEXT_STORIES: Record<string, string[]> = {
  English: [
    "I also invited a friend for dinner last night and it's really a memorable experience with my friend having dinner I told him about GA Team and he joined my team too",
    "Today I invited my friend for dinner he was amazed to see me prepare such amazing delicious meal and she was so excited and impressed to join my team because he knew I couldn't afford luxury and expensive meals like this in the past but now after a few weeks of trading with GA team & Wemotrade everything changed im able to afford luxury and delicious meal now",
    "I also invited my cousin for dinner and showed him my withdrawal proof from GA Team, he was amazed and joined with $1,000 immediately",
    "I invited my sister for dinner last night too we had a beautiful time and I showed her my earnings from trading she joined with $1,500",
    "I also prepared dinner for my friend from work she couldn't believe how I could afford such a luxurious meal when I told her about GA Team she signed up immediately with $1,000",
    "I did the same thing yesterday cooked a lovely meal for my colleague and told him about GA Team he joined immediately with $1,000",
    "I invited my neighbor for dinner last week too prepared a delicious homemade meal and we talked about investments she joined my team with $500 she said she'll add more later",
    "I also invited my old school friend for dinner yesterday he was surprised to see me living this good life I told him it's all from trading with GA Team and he joined immediately",
    "My friend invited me for dinner but I surprised her by bringing an even bigger meal she was so happy and during our conversation I told her about Global Alliance and she joined with $500",
    "I prepared a special dinner for my uncle he's always been supportive of me and when I told him about GA Team he joined with $3,000 right away",
    "I invited two friends for dinner last week and after showing them my results they both joined my team one with $1,000 and the other with $500",
    "I cooked a special meal for my childhood friend last night after we ate I introduced her to Global Alliance and she joined my team",
    "I took my brother out for dinner two days ago and after seeing how well I'm doing with GA Team he joined with $2,000",
    "I also invited my classmate for dinner this week she was so impressed by the meal that she asked what changed in my life and I told her about GA Team she joined with $500",
  ],
  Spanish: [
    "Yo también invité a un amigo a cenar anoche y fue una experiencia memorable durante la cena le conté sobre GA Team y también se unió a mi equipo",
    "Hoy invité a mi amigo a cenar y quedó asombrado al verme preparar una comida tan deliciosa y lujosa se emocionó mucho porque sabía que antes no podía pagar comidas así pero ahora con GA Team y Wemotrade todo cambió",
    "Yo también invité a mi primo a cenar y le mostré mis comprobantes de retiro de GA Team, quedó asombrado y se unió con $1,000 de inmediato",
    "Invité a mi hermana a cenar anoche tuvimos un momento hermoso y le mostré mis ganancias de trading se unió con $1,500",
    "También preparé cena para mi amiga del trabajo no podía creer cómo podía pagar una comida tan lujosa cuando le conté sobre GA Team se registró con $1,000",
    "Hice lo mismo ayer cociné una comida encantadora para mi colega y le conté sobre GA Team se unió inmediatamente con $1,000",
    "Invité a mi vecina a cenar la semana pasada preparé una deliciosa comida casera y hablamos de inversiones se unió con $500 dijo que agregará más",
    "También invité a mi amigo de la escuela a cenar ayer se sorprendió de verme viviendo esta buena vida le dije que todo es por trading con GA Team y se unió inmediatamente",
  ],
  Indonesian: [
    "Saya juga mengajak teman makan malam tadi malam dan itu pengalaman yang sangat berkesan selama makan malam saya ceritakan tentang GA Team dan dia juga bergabung dengan tim saya",
    "Hari ini saya ajak teman makan malam dan dia kagum melihat saya menyiapkan makanan yang begitu lezat dan mewah dia sangat senang bergabung karena tahu dulu saya tidak mampu makanan mewah seperti ini tapi sekarang dengan GA Team dan Wemotrade semuanya berubah",
    "Saya juga ajak sepupu makan malam dan tunjukkan bukti penarikan dari GA Team dia kagum dan langsung bergabung dengan $1,000",
    "Saya mengajak adik perempuan makan malam tadi malam kami punya waktu yang indah dan saya tunjukkan penghasilan trading dia bergabung dengan $1,500",
    "Saya juga siapkan makan malam untuk teman kerja dia tidak percaya saya mampu makanan semewah itu ketika saya ceritakan tentang GA Team dia langsung daftar dengan $1,000",
    "Saya melakukan hal yang sama kemarin masak makanan enak untuk kolega dan ceritakan tentang GA Team dia langsung bergabung dengan $1,000",
    "Saya mengajak tetangga makan malam minggu lalu siapkan masakan rumahan yang lezat dan kami bicara tentang investasi dia bergabung dengan $500 bilang akan tambah nanti",
    "Saya juga ajak teman lama sekolah makan malam kemarin dia terkejut melihat saya hidup enak begini saya bilang semua dari trading dengan GA Team dan dia langsung bergabung",
  ],
};

function getMealsDir(): string {
  const path = require("path");
  return path.resolve(process.cwd(), "server/meals");
}

interface DinnerScheduleItem {
  botIndex: number;
  message: string;
  minuteOffset: number;
  photoFile?: string;
}

function selectUniquePhotosForSession(dayOfYear: number, slotSeed: number, groupCount: number): typeof DINNER_PHOTOS {
  const isNightSession = slotSeed === 0;
  const timeFilter = isNightSession ? "night" : "day";
  const filteredPhotos = DINNER_PHOTOS.filter(p => p.timeOfDay === timeFilter);

  const selected: typeof DINNER_PHOTOS = [];
  const usedBots = new Set<number>();
  const startIdx = dayOfYear % filteredPhotos.length;

  for (let attempt = 0; attempt < filteredPhotos.length && selected.length < groupCount; attempt++) {
    const photo = filteredPhotos[(startIdx + attempt) % filteredPhotos.length];
    if (!usedBots.has(photo.assignedBot)) {
      usedBots.add(photo.assignedBot);
      selected.push(photo);
    }
  }

  while (selected.length < groupCount) {
    const fallbackIdx = (startIdx + selected.length) % filteredPhotos.length;
    selected.push(filteredPhotos[fallbackIdx]);
  }

  return selected;
}

const PHOTOS_PER_SESSION = 4;
const GROUP_PHOTO_GAP_MIN = 15;
const GROUP_PHOTO_GAP_MAX = 20;

interface SessionPhotoSet {
  photos: typeof DINNER_PHOTOS;
  captionIndices: number[];
}

function selectSessionPhotos(dayOfYear: number, slotSeed: number): SessionPhotoSet {
  const isNightSession = slotSeed === 0;
  const timeFilter = isNightSession ? "night" : "day";
  const filteredPhotos = DINNER_PHOTOS.filter(p => p.timeOfDay === timeFilter);

  const selected: typeof DINNER_PHOTOS = [];
  const usedBots = new Set<number>();
  const startIdx = (dayOfYear * 11 + slotSeed) % filteredPhotos.length;

  for (let attempt = 0; attempt < filteredPhotos.length && selected.length < PHOTOS_PER_SESSION; attempt++) {
    const photo = filteredPhotos[(startIdx + attempt) % filteredPhotos.length];
    if (!usedBots.has(photo.assignedBot)) {
      usedBots.add(photo.assignedBot);
      selected.push(photo);
    }
  }

  while (selected.length < PHOTOS_PER_SESSION) {
    const fallbackIdx = (startIdx + selected.length) % filteredPhotos.length;
    selected.push(filteredPhotos[fallbackIdx]);
  }

  const captionBase = (dayOfYear * 7 + slotSeed) % 20;
  const usedCaptions = new Set<number>();
  const captionIndices: number[] = [];
  for (let p = 0; p < selected.length; p++) {
    let ci = (captionBase + p * 5) % 20;
    while (usedCaptions.has(ci)) {
      ci = (ci + 1) % 20;
    }
    usedCaptions.add(ci);
    captionIndices.push(ci);
  }

  return { photos: selected, captionIndices };
}

interface GlobalDinnerItem {
  botIndex: number;
  groupIndex: number;
  message: string;
  minuteOffset: number;
  photoFile?: string;
}

function generateGlobalDinnerSchedule(
  dayOfYear: number,
  slotSeed: number,
  groups: { name: string; languageOverride?: string | null }[],
  activeBotIndices: number[],
  sessionPhotos?: SessionPhotoSet
): GlobalDinnerItem[] {
  const photoSet = sessionPhotos || selectSessionPhotos(dayOfYear, slotSeed);
  const photos = photoSet.photos;
  const captionIndices = photoSet.captionIndices;
  const isNightSession = slotSeed === 0;
  const numGroups = groups.length;

  const rng = betterRandom(dayOfYear * 200 + slotSeed + 777);
  const groupOrder = shuffleArray(Array.from({ length: numGroups }, (_, i) => i), dayOfYear * 13 + slotSeed);

  const schedule: GlobalDinnerItem[] = [];

  const botPhotoTimes: number[][] = [];
  for (let p = 0; p < photos.length; p++) {
    const times: number[] = [];
    const firstGroupMin = p * 5;
    for (let gi = 0; gi < numGroups; gi++) {
      const gap = GROUP_PHOTO_GAP_MIN + (rng.next() % (GROUP_PHOTO_GAP_MAX - GROUP_PHOTO_GAP_MIN + 1));
      times.push(firstGroupMin + gi * gap);
    }
    botPhotoTimes.push(times);
  }

  const photoBotIndices = photos.map(p => p.assignedBot);
  const commentBotPool = activeBotIndices.filter(b => photoBotIndices.indexOf(b) === -1);
  if (commentBotPool.length === 0) commentBotPool.push(activeBotIndices[0] ?? 1);

  const usedCommentsByLang: Record<string, Set<number>> = {};

  function pickUniqueComment(lang: string, comments: string[], seed: number): string {
    if (!usedCommentsByLang[lang]) usedCommentsByLang[lang] = new Set();
    const used = usedCommentsByLang[lang];
    if (used.size >= comments.length) used.clear();
    let idx = seed % comments.length;
    let attempts = 0;
    while (used.has(idx) && attempts < comments.length) {
      idx = (idx + 1) % comments.length;
      attempts++;
    }
    used.add(idx);
    return comments[idx];
  }

  let commentCounter = 0;

  for (let p = 0; p < photos.length; p++) {
    const photo = photos[p];
    const captionIdx = captionIndices[p];

    for (let gi = 0; gi < numGroups; gi++) {
      const actualGroupIdx = groupOrder[gi];
      const group = groups[actualGroupIdx];
      const lang = resolveGroupLanguage(group.languageOverride || null, dayOfYear);

      const captionsMap = isNightSession ? PHOTO_CAPTIONS_NIGHT : PHOTO_CAPTIONS_DAY;
      const captions = captionsMap[lang] || captionsMap["English"];
      const comments = DINNER_COMMENTS[lang] || DINNER_COMMENTS["English"];

      const photoMinute = botPhotoTimes[p][gi];

      schedule.push({
        botIndex: photo.assignedBot,
        groupIndex: actualGroupIdx,
        message: captions[captionIdx % captions.length],
        minuteOffset: photoMinute,
        photoFile: photo.file,
      });

      const commentSeed = dayOfYear * 50 + actualGroupIdx * 11 + slotSeed + p * 7 + gi * 3;
      const commentRng = betterRandom(commentSeed);
      const shuffledCommenters = shuffleArray([...commentBotPool], commentSeed);

      const comment1Min = photoMinute + 3 + (commentRng.next() % 3);
      const comment1Seed = dayOfYear * 31 + slotSeed * 13 + commentCounter;
      commentCounter++;
      schedule.push({
        botIndex: shuffledCommenters[0 % shuffledCommenters.length],
        groupIndex: actualGroupIdx,
        message: pickUniqueComment(lang, comments, comment1Seed),
        minuteOffset: comment1Min,
      });

      if (commentRng.next() % 100 < 50) {
        const comment2Min = comment1Min + 2 + (commentRng.next() % 3);
        const comment2Seed = dayOfYear * 31 + slotSeed * 13 + commentCounter;
        commentCounter++;
        schedule.push({
          botIndex: shuffledCommenters[1 % shuffledCommenters.length],
          groupIndex: actualGroupIdx,
          message: pickUniqueComment(lang, comments, comment2Seed),
          minuteOffset: comment2Min,
        });
      }
    }
  }

  schedule.sort((a, b) => a.minuteOffset - b.minuteOffset);
  return schedule;
}

function generateDoneSchedule(groupIndex: number, dayOfYear: number, activeBotIndices: number[] = [0, 1, 2, 3], slotSeed: number = 0, languageOverride?: string | null): { botIndex: number; message: string; delaySec: number }[] {
  const lang = resolveGroupLanguage(languageOverride, dayOfYear);
  const doneMessages = DONE_MESSAGES_BY_LANG[lang] || DONE_MESSAGES_BY_LANG["English"];
  const schedule: { botIndex: number; message: string; delaySec: number }[] = [];
  const seed = dayOfYear * 30 + groupIndex * 7 + slotSeed;
  const botOrder = shuffleArray(activeBotIndices, seed);

  let currentSec = 0;
  for (let i = 0; i < botOrder.length; i++) {
    schedule.push({
      botIndex: botOrder[i],
      message: doneMessages[i % doneMessages.length],
      delaySec: currentSec,
    });
    currentSec += 20 + (seed + i) % 20;
  }

  return schedule;
}

async function queryBotsDirect(): Promise<any[]> {
  const pgMod = await import("pg");
  const client = new pgMod.default.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const res = await client.query("SELECT * FROM userbots ORDER BY bot_order");
    await client.end();
    return res.rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      apiId: r.api_id,
      apiHash: r.api_hash,
      sessionString: r.session_string,
      isActive: r.is_active,
      order: r.bot_order,
    }));
  } catch (err) {
    try { await client.end(); } catch {}
    throw err;
  }
}

async function getActiveBotIndices(): Promise<number[]> {
  let bots;
  try {
    bots = await storage.getUserbots();
    if (bots.length === 0) {
      log("getActiveBotIndices: pool returned 0 bots, trying direct query...", "scheduler");
      bots = await queryBotsDirect();
    }
  } catch (err: any) {
    log(`getActiveBotIndices: pool failed (${err.message}), trying direct query...`, "scheduler");
    bots = await queryBotsDirect();
  }

  const indices: number[] = [];
  for (let i = 0; i < bots.length; i++) {
    if (i === 0) continue;
    if (bots[i].isActive && bots[i].sessionString && bots[i].apiId && bots[i].apiHash) {
      indices.push(i);
    }
  }
  if (indices.length > 0) return indices;
  return bots.length > 1 ? bots.slice(1).map((_: any, i: number) => i + 1) : [1, 2, 3, 4, 5];
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
    const langOverride = (groupsList[g] as any)?.languageOverride || null;
    const morningItems = generateMorningChatSchedule(g, dayOfYear, activeBots, langOverride);
    schedule.morningChat.push({
      groupIndex: g,
      messages: morningItems.map(item => {
        const totalMin = item.minuteOffset;
        const hour = 5 + Math.floor(totalMin / 60);
        const min = totalMin % 60;
        const ampm = hour >= 12 ? "PM" : "AM";
        const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
        return {
          ...item,
          time: `${displayHour}:${String(min).padStart(2, "0")} ${ampm}`,
        };
      }),
    });
  }

  for (let w = 0; w < READY_WINDOWS.length; w++) {
    const window = READY_WINDOWS[w];
    const windowSchedule: any[] = [];
    for (let g = 0; g < numGroups; g++) {
      const langOverride = (groupsList[g] as any)?.languageOverride || null;
      const items = generateReadySchedule(w, g, dayOfYear, activeBots, langOverride);
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

  const previewDoneSlots = [
    { label: "9:05 AM", slotIndex: 0 },
    { label: "10:05 AM", slotIndex: 1 },
    { label: "12:05 PM", slotIndex: 2 },
    { label: "1:05 PM", slotIndex: 3 },
    { label: "2:05 PM", slotIndex: 4 },
    { label: "3:05 PM", slotIndex: 5 },
  ];
  for (const slot of previewDoneSlots) {
    for (let g = 0; g < numGroups; g++) {
      const langOverrideDone = (groupsList[g] as any)?.languageOverride || null;
      const doneItems = generateDoneSchedule(g, dayOfYear, activeBots, slot.slotIndex, langOverrideDone);
      schedule.doneWindow.push({
        groupIndex: g,
        slotTime: slot.label,
        messages: doneItems.map(item => ({
          ...item,
          time: `${slot.label} +${item.delaySec}s`,
        })),
      });
    }
  }

  for (let g = 0; g < numGroups; g++) {
    const langOverride = (groupsList[g] as any)?.languageOverride || null;
    const eveningItems = generateEveningMessages(g, dayOfYear, numGroups, activeBots, langOverride);
    schedule.eveningChat.push({
      groupIndex: g,
      messages: eveningItems.map(item => {
        const totalMin = 25 + item.minuteOffset;
        const hour = 15 + Math.floor(totalMin / 60);
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

async function sendUserbotMessage(sessionString: string, apiId: string, apiHash: string, chatId: string, message: string, replyToMsgId?: number): Promise<{ success: boolean; messageId?: number }> {
  if (process.env.NODE_ENV === "development") {
    log("DEV MODE: Skipping userbot message to avoid session conflicts with production", "telegram");
    return { success: true, messageId: Math.floor(Math.random() * 100000) };
  }
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const pythonBin = getPythonPath();
      const args = [
        "server/telegram_sender.py", "send",
        sessionString, apiId, apiHash, chatId, message
      ];
      if (replyToMsgId) args.push(String(replyToMsgId));
      const { stdout } = await execFileAsync(pythonBin, args, { timeout: 60000 });
      const result = JSON.parse(stdout.trim());
      if (result.success) {
        if (attempt > 0) log(`Userbot message succeeded on retry #${attempt}`, "telegram");
        return { success: true, messageId: result.messageId };
      }
      log(`Userbot send attempt ${attempt + 1} failed: ${result.error}`, "telegram");
    } catch (err: any) {
      const errMsg = err.message || "";
      if (errMsg.includes("AuthKeyDuplicatedError") || errMsg.includes("auth key")) {
        log(`SESSION BROKEN (AuthKeyDuplicatedError) — this bot needs re-authentication. Skipping retries.`, "telegram");
        return { success: false };
      }
      log(`Userbot message attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${errMsg}`, "telegram");
    }
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] || 30000;
      log(`Retrying in ${delay / 1000}s...`, "telegram");
      await sleep(delay);
    }
  }
  log(`Userbot message FAILED after ${MAX_RETRIES + 1} attempts`, "telegram");
  return { success: false };
}

async function sendUserbotPhoto(sessionString: string, apiId: string, apiHash: string, chatId: string, photoUrl: string, caption: string): Promise<boolean> {
  if (process.env.NODE_ENV === "development") {
    log("DEV MODE: Skipping userbot photo to avoid session conflicts with production", "telegram");
    return true;
  }
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const pythonBin = getPythonPath();
      const { stdout } = await execFileAsync(pythonBin, [
        "server/telegram_sender.py", "send_photo",
        sessionString, apiId, apiHash, chatId, photoUrl, caption
      ], { timeout: 90000 });
      const result = JSON.parse(stdout.trim());
      if (result.success) {
        if (attempt > 0) log(`Userbot photo succeeded on retry #${attempt}`, "telegram");
        return true;
      }
      log(`Userbot photo attempt ${attempt + 1} failed: ${result.error}`, "telegram");
    } catch (err: any) {
      const errMsg = err.message || "";
      if (errMsg.includes("AuthKeyDuplicatedError") || errMsg.includes("auth key")) {
        log(`SESSION BROKEN — this bot needs re-authentication. Skipping retries.`, "telegram");
        return false;
      }
      log(`Userbot photo attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${errMsg}`, "telegram");
    }
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] || 30000;
      log(`Retrying photo in ${delay / 1000}s...`, "telegram");
      await sleep(delay);
    }
  }
  log(`Userbot photo FAILED after ${MAX_RETRIES + 1} attempts`, "telegram");
  return false;
}

async function executeScheduledPhoto(botName: string, groupName: string, photoUrl: string, caption: string, period: string) {
  let bots, groupsList;
  try {
    [bots, groupsList] = await Promise.all([
      storage.getUserbots(),
      storage.getGroups(),
    ]);
    if (bots.length === 0 || groupsList.length === 0) {
      [bots, groupsList] = await Promise.all([queryBotsDirect(), queryGroupsDirect()]);
    }
  } catch (err: any) {
    [bots, groupsList] = await Promise.all([queryBotsDirect(), queryGroupsDirect()]);
  }

  const group = groupsList.find((g: any) => g.name === groupName);
  if (!group || !group.groupId) {
    log(`Photo: Group ${groupName} not found`, "scheduler");
    return;
  }

  const botIndex = parseInt(botName.replace("Userbot ", "")) - 1;
  const bot = bots[botIndex];
  if (!bot || !bot.sessionString || !bot.apiId || !bot.apiHash || !bot.isActive) {
    log(`Photo: ${botName} not configured or inactive`, "scheduler");
    return;
  }
  const success = await sendUserbotPhoto(bot.sessionString, bot.apiId, bot.apiHash, group.groupId, photoUrl, caption);
  await storage.createMessageLog({ botName, groupName, message: `[PHOTO] ${caption}`, schedulePeriod: period, status: success ? "sent" : "failed" });
}

async function executeScheduledMessage(botName: string, groupName: string, message: string, period: string, replyToMsgId?: number): Promise<number | undefined> {
  let config, bots, groupsList;
  try {
    [config, bots, groupsList] = await Promise.all([
      storage.getBotConfig(),
      storage.getUserbots(),
      storage.getGroups(),
    ]);
    if (bots.length === 0 || groupsList.length === 0) {
      log(`executeScheduledMessage: pool returned ${bots.length} bots, ${groupsList.length} groups — using direct DB`, "scheduler");
      [bots, groupsList] = await Promise.all([queryBotsDirect(), queryGroupsDirect()]);
      if (!config) {
        const pgMod = await import("pg");
        const client = new pgMod.default.Client({ connectionString: process.env.DATABASE_URL });
        await client.connect();
        const res = await client.query("SELECT * FROM bot_config LIMIT 1");
        await client.end();
        config = res.rows[0] as any;
      }
    }
  } catch (err: any) {
    log(`executeScheduledMessage: pool failed (${err.message}) — using direct DB`, "scheduler");
    [bots, groupsList] = await Promise.all([queryBotsDirect(), queryGroupsDirect()]);
    const pgMod = await import("pg");
    const client = new pgMod.default.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const res = await client.query("SELECT * FROM bot_config LIMIT 1");
    await client.end();
    config = res.rows[0] as any;
  }

  const group = groupsList.find((g: any) => g.name === groupName);
  if (!group || !group.groupId) {
    log(`Group ${groupName} not found or has no group ID`, "scheduler");
    await storage.createMessageLog({
      botName,
      groupName,
      message,
      schedulePeriod: period,
      status: "skipped_no_group",
    });
    return undefined;
  }

  if (botName === "Main Bot") {
    const token = config?.botToken || (config as any)?.bot_token;
    if (!token) {
      log("No bot token configured", "scheduler");
      await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: "skipped_no_token" });
      return undefined;
    }
    const success = await sendTelegramBotMessage(token, group.groupId, message);
    await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: success ? "sent" : "failed" });
    return undefined;
  } else {
    const botIndex = parseInt(botName.replace("Userbot ", "")) - 1;
    const bot = bots[botIndex];
    if (!bot || !bot.sessionString || !bot.apiId || !bot.apiHash) {
      log(`${botName} not configured properly (missing session/apiId/apiHash)`, "scheduler");
      await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: "skipped_no_config" });
      return undefined;
    }
    if (!bot.isActive) {
      log(`${botName} is inactive, skipping`, "scheduler");
      await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: "skipped_inactive" });
      return undefined;
    }
    const result = await sendUserbotMessage(bot.sessionString, bot.apiId, bot.apiHash, group.groupId, message, replyToMsgId);
    await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: result.success ? "sent" : "failed" });
    return result.messageId;
  }
}

let lastHeartbeat: Date | null = null;

const recentlySent = new Map<string, number>();
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

function isDuplicate(botName: string, groupName: string, message: string): boolean {
  const key = `${botName}|${groupName}|${message.substring(0, 80)}`;
  const lastSent = recentlySent.get(key);
  if (lastSent && Date.now() - lastSent < DEDUP_WINDOW_MS) {
    return true;
  }
  recentlySent.set(key, Date.now());
  if (recentlySent.size > 2000) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [k, v] of recentlySent) {
      if (v < cutoff) recentlySent.delete(k);
    }
  }
  return false;
}

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

async function safeExecuteScheduledMessage(botName: string, groupName: string, message: string, period: string, replyToMsgId?: number): Promise<number | undefined> {
  try {
    return await executeScheduledMessage(botName, groupName, message, period, replyToMsgId);
  } catch (err: any) {
    log(`CRITICAL: executeScheduledMessage crashed for ${botName}/${groupName}: ${err.message}`, "scheduler");
    failedMessageQueue.push({ botName, groupName, message, period, failedAt: new Date(), retryCount: 0 });
    try {
      await storage.createMessageLog({ botName, groupName, message, schedulePeriod: period, status: "error_crash_queued" });
    } catch (_) {}
    return undefined;
  }
}

async function sendOneMessage(
  botName: string,
  groupName: string,
  message: string,
  period: string,
  replyToMsgId?: number
): Promise<number | undefined> {
  if (isDuplicate(botName, groupName, message)) {
    log(`[${period}] DEDUP SKIP: ${botName} → ${groupName} (already sent within ${DEDUP_WINDOW_MS / 60000}min)`, "scheduler");
    return undefined;
  }
  log(`[${period}] SEND START: ${botName} → ${groupName}`, "scheduler");
  try {
    const msgId = await safeExecuteScheduledMessage(botName, groupName, message, period, replyToMsgId);
    log(`[${period}] SEND DONE: ${botName} → ${groupName} (msgId=${msgId || "?"})`, "scheduler");
    return msgId;
  } catch (err: any) {
    log(`[${period}] SEND FAILED: ${botName} → ${groupName}: ${err.message}`, "scheduler");
    return undefined;
  }
}

const conversationMsgIds: Map<string, number[]> = new Map();

async function checkPythonAvailable(): Promise<boolean> {
  try {
    const pythonBin = getPythonPath();
    log(`Python path resolved to: ${pythonBin}`, "scheduler");
    const { stdout } = await execFileAsync(pythonBin, ["-c", "from telethon.sync import TelegramClient; print('OK')"], { timeout: 15000 });
    return stdout.trim() === "OK";
  } catch (err: any) {
    log(`Python3/Telethon check FAILED: ${err.message}`, "scheduler");
    return false;
  }
}

async function recoverInProgressSessions(): Promise<void> {
  log("RECOVERY: Checking if server restarted during an active session...", "scheduler");

  let groupsList: Awaited<ReturnType<typeof storage.getGroups>> = [];
  for (let attempt = 1; attempt <= 10; attempt++) {
    groupsList = await getGroupsWithRetry();
    if (groupsList.length > 0) break;
    log(`RECOVERY: DB not ready yet (attempt ${attempt}/10), waiting 5s...`, "scheduler");
    await sleep(5000);
  }

  if (groupsList.length === 0) {
    log("RECOVERY: Could not load groups after 10 attempts — skipping recovery", "scheduler");
    return;
  }

  const activeBots = await getActiveBotIndices();
  const now = getNigeriaDate();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;
  const dayOfYear = getDayOfYear();
  log(`RECOVERY: ${groupsList.length} groups loaded, WAT time ${hour}:${minute.toString().padStart(2,'0')}, checking sessions...`, "scheduler");

  const lifestyleRecoverySlots = [
    { startMin: 3 * 60, endMin: 5 * 60, label: "3:00 AM", slotSeed: 0 },
    { startMin: 15 * 60 + 10, endMin: 17 * 60, label: "3:10 PM", slotSeed: 100 },
  ];

  for (const lsSlot of lifestyleRecoverySlots) {
    if (currentMinutes >= lsSlot.startMin && currentMinutes < lsSlot.endMin) {
      const elapsedMinutes = currentMinutes - lsSlot.startMin;
      log(`RECOVERY: Server restarted during dinner session (${lsSlot.label}, ${elapsedMinutes}min elapsed). Scheduling remaining...`, "scheduler");

      const mealsDir = getMealsDir();
      const period = `dinner_recovery_${lsSlot.label}`;
      const recoverySessionPhotos = selectSessionPhotos(dayOfYear, lsSlot.slotSeed);
      const groupsInfo = groupsList.map((g: any) => ({ name: g.name, languageOverride: g.languageOverride || null }));
      const globalItems = generateGlobalDinnerSchedule(dayOfYear, lsSlot.slotSeed, groupsInfo, activeBots, recoverySessionPhotos);
      const remaining = globalItems.filter(item => item.minuteOffset > elapsedMinutes);
      let recoveryCount = 0;

      for (const item of remaining) {
        const delayMs = (item.minuteOffset - elapsedMinutes) * 60 * 1000;
        const botName = `Userbot ${item.botIndex + 1}`;
        const groupName = groupsList[item.groupIndex].name;
        if (item.photoFile) {
          const photoPath = `${mealsDir}/${item.photoFile}`;
          setTimeout(() => executeScheduledPhoto(botName, groupName, photoPath, item.message, period), delayMs);
        } else {
          setTimeout(() => executeScheduledMessage(botName, groupName, item.message, period), delayMs);
        }
        recoveryCount++;
      }
      if (recoveryCount > 0) {
        log(`RECOVERY: ${recoveryCount} dinner messages scheduled for ${lsSlot.label}`, "scheduler");
      }
    }
  }

  const morningStart = 5 * 60;
  const morningEnd = 8 * 60 + 15;
  if (currentMinutes >= morningStart && currentMinutes < morningEnd) {
    const elapsedMinutes = currentMinutes - morningStart;
    log(`RECOVERY: Server restarted during morning session (${elapsedMinutes}min elapsed). Scheduling remaining messages...`, "scheduler");

    const allConvItems: ConversationItem[] = [];
    for (let g = 0; g < groupsList.length; g++) {
      const langOverride = (groupsList[g] as any).languageOverride || null;
      const items = generateMorningChatSchedule(g, dayOfYear, activeBots, langOverride);
      const remaining = items.filter(item => item.minuteOffset > elapsedMinutes);
      for (const item of remaining) {
        allConvItems.push({
          botName: `Userbot ${item.botIndex + 1}`,
          groupName: groupsList[g].name,
          message: item.message,
          delayMs: (item.minuteOffset - elapsedMinutes) * 60 * 1000,
          threadId: item.threadId,
          msgIndex: item.msgIndex,
          shouldReply: item.shouldReply,
        });
      }
    }
    allConvItems.sort((a, b) => a.delayMs - b.delayMs);
    if (allConvItems.length > 0) {
      const count = scheduleConversationWithReplies(allConvItems, "morning_chat_recovery");
      log(`RECOVERY: ${count} morning messages scheduled (skipped first ${elapsedMinutes} min)`, "scheduler");
    } else {
      log(`RECOVERY: No remaining morning messages to schedule`, "scheduler");
    }
  }

  const eveningStart = 15 * 60 + 25;
  const eveningEnd = 18 * 60 + 55;
  if (currentMinutes >= eveningStart && currentMinutes < eveningEnd) {
    const elapsedMinutes = currentMinutes - eveningStart;
    log(`RECOVERY: Server restarted during evening session (${elapsedMinutes}min elapsed). Scheduling remaining messages...`, "scheduler");

    const allConvItems2: ConversationItem[] = [];
    for (let g = 0; g < groupsList.length; g++) {
      const langOverride = (groupsList[g] as any).languageOverride || null;
      const items = generateEveningMessages(g, dayOfYear, groupsList.length, activeBots, langOverride);
      const remaining = items.filter(item => item.minuteOffset > elapsedMinutes);
      for (const item of remaining) {
        allConvItems2.push({
          botName: `Userbot ${item.botIndex + 1}`,
          groupName: groupsList[g].name,
          message: item.message,
          delayMs: (item.minuteOffset - elapsedMinutes) * 60 * 1000,
          threadId: item.threadId,
          msgIndex: item.msgIndex,
          shouldReply: item.shouldReply,
        });
      }
    }
    allConvItems2.sort((a, b) => a.delayMs - b.delayMs);
    if (allConvItems2.length > 0) {
      const count = scheduleConversationWithReplies(allConvItems2, "evening_chat_recovery");
      log(`RECOVERY: ${count} evening messages scheduled (skipped first ${elapsedMinutes} min)`, "scheduler");
    } else {
      log(`RECOVERY: No remaining evening messages to schedule`, "scheduler");
    }
  }

  const doneRecoverySlots = [
    { startMin: 9 * 60 + 5, endMin: 9 * 60 + 10, label: "9:05 AM", slotIndex: 0 },
    { startMin: 10 * 60 + 5, endMin: 10 * 60 + 10, label: "10:05 AM", slotIndex: 1 },
    { startMin: 12 * 60 + 5, endMin: 12 * 60 + 10, label: "12:05 PM", slotIndex: 2 },
    { startMin: 13 * 60 + 5, endMin: 13 * 60 + 10, label: "1:05 PM", slotIndex: 3 },
    { startMin: 14 * 60 + 5, endMin: 14 * 60 + 10, label: "2:05 PM", slotIndex: 4 },
    { startMin: 15 * 60 + 5, endMin: 15 * 60 + 10, label: "3:05 PM", slotIndex: 5 },
  ];

  for (const doneSlot of doneRecoverySlots) {
    if (currentMinutes >= doneSlot.startMin && currentMinutes < doneSlot.endMin) {
      const elapsedSec = (currentMinutes - doneSlot.startMin) * 60;
      log(`RECOVERY: Server restarted during Done session (${doneSlot.label}). Scheduling remaining...`, "scheduler");
      const allItems: { botName: string; groupName: string; message: string; delayMs: number }[] = [];
      for (let g = 0; g < groupsList.length; g++) {
        const langOverride = (groupsList[g] as any).languageOverride || null;
        const items = generateDoneSchedule(g, dayOfYear, activeBots, doneSlot.slotIndex, langOverride);
        const remaining = items.filter(item => item.delaySec > elapsedSec);
        for (const item of remaining) {
          allItems.push({
            botName: `Userbot ${item.botIndex + 1}`,
            groupName: groupsList[g].name,
            message: item.message,
            delayMs: (item.delaySec - elapsedSec) * 1000,
          });
        }
      }
      allItems.sort((a, b) => a.delayMs - b.delayMs);
      if (allItems.length > 0) {
        const count = scheduleMessagesWithTimers(allItems, `done_recovery_${doneSlot.label}`);
        log(`RECOVERY: ${count} Done messages scheduled for ${doneSlot.label}`, "scheduler");
      }
    }
  }

  if (currentMinutes < morningStart || currentMinutes >= eveningEnd) {
    log(`RECOVERY: No active session at ${hour}:${minute.toString().padStart(2,'0')} — nothing to recover`, "scheduler");
  }
}

export function startScheduler() {
  if (isSchedulerRunning) return;
  isSchedulerRunning = true;
  log("Scheduler started with retry + watchdog protection", "scheduler");

  checkPythonAvailable().then(ok => {
    log(`Python3/Telethon available: ${ok}`, "scheduler");
  });

  recoverInProgressSessions().catch(err => {
    log(`Session recovery failed: ${err.message}`, "scheduler");
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

  const morningJob = cron.schedule("0 5 * * *", async () => {
    try {
      log("=== MORNING CHAT TRIGGERED ===", "scheduler");
      const dayOfYear = getDayOfYear();
      const groupsList = await getGroupsWithRetry();
      const activeBots = await getActiveBotIndices();
      log(`Morning chat: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");

      const allConvItems: ConversationItem[] = [];
      for (let g = 0; g < groupsList.length; g++) {
        const langOverride = (groupsList[g] as any).languageOverride || null;
        const items = generateMorningChatSchedule(g, dayOfYear, activeBots, langOverride);
        for (const item of items) {
          allConvItems.push({
            botName: `Userbot ${item.botIndex + 1}`,
            groupName: groupsList[g].name,
            message: item.message,
            delayMs: item.minuteOffset * 60 * 1000,
            threadId: item.threadId,
            msgIndex: item.msgIndex,
            shouldReply: item.shouldReply,
          });
        }
      }
      allConvItems.sort((a, b) => a.delayMs - b.delayMs);
      log(`Morning chat: ${allConvItems.length} total messages queued via conversation scheduler`, "scheduler");

      const count = scheduleConversationWithReplies(allConvItems, "morning_chat");
      log(`Morning chat: ${count} messages scheduled, last fires at +${allConvItems[allConvItems.length - 1]?.delayMs / 60000 || 0} min`, "scheduler");
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
          const langOverride = (groupsList[g] as any).languageOverride || null;
          const items = generateReadySchedule(w, g, dayOfYear, activeBots, langOverride);
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
        log(`Ready window ${w + 1}: ${allItems.length} total messages queued via setTimeout`, "scheduler");

        const count = scheduleMessagesWithTimers(allItems, `ready_window_${w + 1}`);
        log(`Ready window ${w + 1}: ${count} messages scheduled`, "scheduler");
      } catch (err: any) {
        log(`CRITICAL: Ready window ${w + 1} crashed: ${err.message}\n${err.stack}`, "scheduler");
      }
    }, { timezone: NIGERIA_TZ });
    scheduledJobs.push(readyJob);
  }

  const doneSlots = [
    { cron: "5 9 * * *", label: "9:05 AM" },
    { cron: "5 10 * * *", label: "10:05 AM" },
    { cron: "5 12 * * *", label: "12:05 PM" },
    { cron: "5 13 * * *", label: "1:05 PM" },
    { cron: "5 14 * * *", label: "2:05 PM" },
    { cron: "5 15 * * *", label: "3:05 PM" },
  ];

  for (let s = 0; s < doneSlots.length; s++) {
    const slot = doneSlots[s];
    const slotIndex = s;
    const doneJob = cron.schedule(slot.cron, async () => {
      try {
        log(`=== DONE SESSION TRIGGERED (${slot.label}) ===`, "scheduler");
        const dayOfYear = getDayOfYear();
        const groupsList = await getGroupsWithRetry();
        const activeBots = await getActiveBotIndices();
        log(`Done ${slot.label}: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");

        const allItems: { botName: string; groupName: string; message: string; delayMs: number }[] = [];
        for (let g = 0; g < groupsList.length; g++) {
          const langOverride = (groupsList[g] as any).languageOverride || null;
          const items = generateDoneSchedule(g, dayOfYear, activeBots, slotIndex, langOverride);
          for (const item of items) {
            allItems.push({
              botName: `Userbot ${item.botIndex + 1}`,
              groupName: groupsList[g].name,
              message: item.message,
              delayMs: item.delaySec * 1000,
            });
          }
        }
        allItems.sort((a, b) => a.delayMs - b.delayMs);
        log(`Done ${slot.label}: ${allItems.length} total messages queued`, "scheduler");

        const count = scheduleMessagesWithTimers(allItems, `done_${slot.label}`);
        log(`Done ${slot.label}: ${count} messages scheduled`, "scheduler");
      } catch (err: any) {
        log(`CRITICAL: Done session (${slot.label}) crashed: ${err.message}\n${err.stack}`, "scheduler");
      }
    }, { timezone: NIGERIA_TZ });
    scheduledJobs.push(doneJob);
  }

  const lifestyleSlots = [
    { cron: "0 3 * * *", label: "3:00 AM", slotSeed: 0 },
    { cron: "10 15 * * *", label: "3:10 PM", slotSeed: 100 },
  ];

  for (const lsSlot of lifestyleSlots) {
    const slotSeed = lsSlot.slotSeed;
    const lifestyleJob = cron.schedule(lsSlot.cron, async () => {
      try {
        log(`=== DINNER SESSION TRIGGERED (${lsSlot.label}) ===`, "scheduler");
        const dayOfYear = getDayOfYear();
        const groupsList = await getGroupsWithRetry();
        const activeBots = await getActiveBotIndices();
        const isNightSession = slotSeed === 0;
        const timeFilter = isNightSession ? "night" : "day";
        const sessionPhotos = selectSessionPhotos(dayOfYear, slotSeed);
        const photoSummary = sessionPhotos.photos.map((p, i) => `Bot${p.assignedBot+1}:${p.file}(caption#${sessionPhotos.captionIndices[i]})`).join(", ");
        log(`Dinner ${lsSlot.label}: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}], ${PHOTOS_PER_SESSION} photos=[${photoSummary}] each bot sends same photo+caption to all groups 15-20min apart (${timeFilter})`, "scheduler");

        const groupsInfo = groupsList.map((g: any) => ({ name: g.name, languageOverride: g.languageOverride || null }));
        const globalItems = generateGlobalDinnerSchedule(dayOfYear, slotSeed, groupsInfo, activeBots, sessionPhotos);

        const mealsDir = getMealsDir();
        const period = `dinner_${lsSlot.label}`;

        for (const item of globalItems) {
          const delayMs = item.minuteOffset * 60 * 1000;
          const botName = `Userbot ${item.botIndex + 1}`;
          const groupName = groupsList[item.groupIndex].name;

          if (item.photoFile) {
            const photoPath = `${mealsDir}/${item.photoFile}`;
            setTimeout(() => {
              executeScheduledPhoto(botName, groupName, photoPath, item.message, period);
            }, delayMs);
          } else {
            setTimeout(() => {
              executeScheduledMessage(botName, groupName, item.message, period);
            }, delayMs);
          }
        }
        const lastMin = globalItems.length > 0 ? globalItems[globalItems.length - 1].minuteOffset : 0;
        log(`Dinner ${lsSlot.label}: ${globalItems.length} messages scheduled across ${groupsList.length} groups, last at +${lastMin}min`, "scheduler");
      } catch (err: any) {
        log(`CRITICAL: Dinner session (${lsSlot.label}) crashed: ${err.message}\n${err.stack}`, "scheduler");
      }
    }, { timezone: NIGERIA_TZ });
    scheduledJobs.push(lifestyleJob);
  }

  const eveningJob = cron.schedule("25 15 * * *", async () => {
    try {
      log("=== EVENING CHAT TRIGGERED ===", "scheduler");
      const dayOfYear = getDayOfYear();
      const groupsList = await getGroupsWithRetry();
      const activeBots = await getActiveBotIndices();
      log(`Evening chat: ${groupsList.length} groups, activeBots=[${activeBots.join(",")}]`, "scheduler");

      const allConvItems: ConversationItem[] = [];
      for (let g = 0; g < groupsList.length; g++) {
        const langOverride = (groupsList[g] as any).languageOverride || null;
        const items = generateEveningMessages(g, dayOfYear, groupsList.length, activeBots, langOverride);
        for (const item of items) {
          allConvItems.push({
            botName: `Userbot ${item.botIndex + 1}`,
            groupName: groupsList[g].name,
            message: item.message,
            delayMs: item.minuteOffset * 60 * 1000,
            threadId: item.threadId,
            msgIndex: item.msgIndex,
            shouldReply: item.shouldReply,
          });
        }
      }
      allConvItems.sort((a, b) => a.delayMs - b.delayMs);
      log(`Evening chat: ${allConvItems.length} total messages queued via conversation scheduler`, "scheduler");

      const count = scheduleConversationWithReplies(allConvItems, "evening_chat");
      log(`Evening chat: ${count} messages scheduled, last fires at +${allConvItems[allConvItems.length - 1]?.delayMs / 60000 || 0} min`, "scheduler");
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
    const currentMinutesFromStart = (now.getHours() * 60 + now.getMinutes()) - (15 * 60 + 25);

    const allConvItems: ConversationItem[] = [];
    for (let g = 0; g < groupsList.length; g++) {
      const langOverride = (groupsList[g] as any).languageOverride || null;
      const items = generateEveningMessages(g, dayOfYear, groupsList.length, activeBots, langOverride);
      const remaining = items.filter(item => item.minuteOffset >= currentMinutesFromStart);
      if (remaining.length === 0) continue;
      const firstOffset = remaining[0].minuteOffset;
      for (const item of remaining) {
        allConvItems.push({
          botName: `Userbot ${item.botIndex + 1}`,
          groupName: groupsList[g].name,
          message: item.message,
          delayMs: (item.minuteOffset - firstOffset) * 60 * 1000,
          threadId: item.threadId,
          msgIndex: item.msgIndex,
          shouldReply: item.shouldReply,
        });
      }
    }
    allConvItems.sort((a, b) => a.delayMs - b.delayMs);
    log(`Manual evening: ${allConvItems.length} messages queued (offset was ${currentMinutesFromStart}min)`, "scheduler");

    const count = scheduleConversationWithReplies(allConvItems, "evening_chat_manual");
    log(`Manual evening: ${count} messages scheduled`, "scheduler");
    return `Scheduled ${count} messages across ${groupsList.length} groups`;
  } catch (err: any) {
    log(`Manual evening FAILED: ${err.message}\n${err.stack}`, "scheduler");
    return `Error: ${err.message}`;
  }
}

export async function triggerMorningTestNow(): Promise<string> {
  try {
    log("=== MORNING TEST (GROUP 1 ONLY) TRIGGERED ===", "scheduler");
    const dayOfYear = getDayOfYear();
    const groupsList = await getGroupsWithRetry();
    const activeBots = await getActiveBotIndices();

    if (groupsList.length === 0) return "No groups configured";

    const group = groupsList[0];
    const langOverride = (group as any).languageOverride || null;
    const items = generateMorningChatSchedule(0, dayOfYear, activeBots, langOverride);
    const allConvItems: ConversationItem[] = items.map(item => ({
      botName: `Userbot ${item.botIndex + 1}`,
      groupName: group.name,
      message: item.message,
      delayMs: item.minuteOffset * 60 * 1000,
      threadId: item.threadId,
      msgIndex: item.msgIndex,
      shouldReply: item.shouldReply,
    }));
    log(`Morning test: ${group.name} — ${allConvItems.length} messages`, "scheduler");

    const count = scheduleConversationWithReplies(allConvItems, "morning_test");
    log(`Morning test: ${count} messages scheduled over ${items[items.length - 1]?.minuteOffset || 0} minutes`, "scheduler");
    return `Scheduled ${count} messages to ${group.name} over ${items[items.length - 1]?.minuteOffset || 0} minutes`;
  } catch (err: any) {
    log(`Morning test FAILED: ${err.message}\n${err.stack}`, "scheduler");
    return `Error: ${err.message}`;
  }
}

export async function triggerMorningSpeedTest(): Promise<string> {
  try {
    log("=== SPEED TEST: 40 MORNING MSGS IN 1 HOUR (GROUP 1) ===", "scheduler");
    const dayOfYear = getDayOfYear();
    const groupsList = await getGroupsWithRetry();
    const activeBots = await getActiveBotIndices();

    if (groupsList.length === 0) return "No groups configured";

    const group = groupsList[0];
    const langOverride = (group as any).languageOverride || null;
    const items = generateMorningChatSchedule(0, dayOfYear, activeBots, langOverride);
    const totalMessages = items.length;
    const totalDurationMs = 60 * 60 * 1000;
    const intervalMs = Math.floor(totalDurationMs / (totalMessages - 1 || 1));

    const allConvItems: ConversationItem[] = items.map((item, idx) => ({
      botName: `Userbot ${item.botIndex + 1}`,
      groupName: group.name,
      message: item.message,
      delayMs: idx * intervalMs,
      threadId: item.threadId,
      msgIndex: item.msgIndex,
      shouldReply: item.shouldReply,
    }));

    log(`Speed test: ${totalMessages} msgs to ${group.name}, ~${Math.round(intervalMs/1000)}s apart, total 60 min`, "scheduler");

    const count = scheduleConversationWithReplies(allConvItems, "morning_speed_test");
    const intervalSec = Math.round(intervalMs / 1000);
    log(`Speed test: ${count} messages scheduled, one every ~${intervalSec}s for 60 min`, "scheduler");
    return `Speed test started: ${count} messages to ${group.name}, one every ~${intervalSec}s for the next 60 minutes`;
  } catch (err: any) {
    log(`Speed test FAILED: ${err.message}\n${err.stack}`, "scheduler");
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
