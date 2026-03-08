import cron from "node-cron";
import { storage } from "./storage";
import { log } from "./index";

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

const MORNING_CHAT_MESSAGES = [
  "Yesterday's signals were really accurate, made some good profits!",
  "I followed the 3rd signal yesterday and got a nice return on my investment",
  "The accuracy rate has been amazing this week, consistent profits every day",
  "Just checked my account, the profits from last week's signals are looking great",
  "Has anyone tried following all the signals? My win rate is over 85%",
  "The team leader's analysis is always on point, very reliable signals",
  "I started with a small amount and now my portfolio has grown significantly",
  "These trading signals have changed my financial situation completely",
  "Great results from yesterday, looking forward to today's session",
  "The signals have been consistently profitable, very happy with the results",
  "My friend joined last week and already made good profits from the signals",
  "The risk management tips along with signals are really helpful",
  "Consistency is key, and these signals deliver consistent results every day",
  "I was skeptical at first but the profits speak for themselves",
  "The analysis provided before each signal helps me understand the market better",
  "Anyone else notice how accurate the entry and exit points are?",
  "My earnings this month exceeded my expectations thanks to these signals",
  "The support team is always helpful when I have questions about the trades",
  "I've been following for 3 months now and my account has grown steadily",
  "Today is going to be another profitable day, I can feel it!",
];

const DONE_MESSAGES = ["Done"];

const EVENING_CHAT_TOPICS: Record<number, string[][]> = {
  0: [
    [
      "Today's first signal was incredibly accurate, hit the target in just 15 minutes",
      "I managed to earn a solid profit from the morning session alone",
      "The team leader's market analysis this morning was spot on",
      "My account balance has increased by 12% just this week from following signals",
      "For anyone new here, just follow the signals precisely and you'll see results",
      "The reward program is also a nice bonus, earned extra from team building",
      "I've referred 3 friends already and the referral rewards are generous",
      "Building a team has been rewarding both financially and personally",
      "The combination of signal profits and team rewards is unbeatable",
      "Anyone else hit their daily target today? I reached mine by the 4th signal",
      "The accuracy today was phenomenal, almost every signal hit its target",
      "Looking at my monthly stats, the consistency is remarkable",
      "Team building bonuses have been a great additional income stream",
      "My team member started earning from day one, the system really works",
      "The leadership rewards make team building even more worthwhile",
    ],
    [
      "Amazing signals today, every single one was profitable",
      "My weekly profits have been consistently growing since I joined",
      "The mentoring from senior team members has been invaluable",
      "I love how transparent the trading results are shared here daily",
      "The team building aspect adds another dimension to the earning potential",
      "Signal accuracy this week has been outstanding, above 90%",
      "I've been able to supplement my income significantly with these trades",
      "The risk-reward ratio on today's signals was excellent",
      "Glad I took the leap and joined this community, life-changing decision",
      "My team is growing and so are the collective rewards we all earn",
      "Each day the signals get better and the profits increase",
      "The evening review sessions help me understand what worked and why",
      "Referral bonuses have been an unexpected but welcome addition",
      "Today's performance confirms why this is the best signal community",
      "Planning to increase my trading capital based on the consistent results",
    ],
  ],
  1: [
    [
      "The signals today were timed perfectly with market movements",
      "I've been tracking my profits weekly and the growth curve is impressive",
      "The community support here makes trading so much easier and less stressful",
      "My portfolio has grown 25% since I started following the signals last month",
      "The team rewards program is an amazing way to earn passive income",
      "Today's market was volatile but the signals navigated it perfectly",
      "I recommended this to my colleague and he's already seeing results",
      "The combination of education and signals makes this truly valuable",
      "Started with a small investment and now I'm trading with confidence",
      "The team building rewards have added significantly to my monthly income",
      "Every signal today was a winner, what an incredible session",
      "My confidence in trading has grown enormously since joining this team",
      "The accuracy speaks for itself, profits don't lie",
      "Building a team has been the best decision alongside trading",
      "The daily signals consistency is what keeps me motivated",
    ],
    [
      "Profitable day once again, the streak continues unbroken",
      "I shared my results with friends and they couldn't believe the consistency",
      "The team leader's market insights are worth their weight in gold",
      "My financial goals are becoming achievable thanks to these signals",
      "The referral program rewards are truly generous and fair",
      "Today proved again why patience and following signals pays off",
      "I've stopped worrying about market volatility since joining this team",
      "The structured approach to trading here is professionally managed",
      "Team building has introduced me to amazing like-minded individuals",
      "My wife noticed the extra income and now she wants to join too",
      "The signals are not just accurate, they're consistently timed well",
      "Monthly review of my earnings shows steady upward growth",
      "The rewards system motivates everyone to grow together as a team",
      "I feel financially secure for the first time thanks to these profits",
      "Tomorrow should be another great day based on the market analysis shared",
    ],
  ],
  2: [
    [
      "What a session today! The signals were absolutely on fire",
      "My account hit a new all-time high today, couldn't be happier",
      "The detailed analysis before each signal helps me learn as I earn",
      "I've built a team of 8 people and we're all profiting together",
      "The accuracy rate this month is the highest I've seen since joining",
      "Today's signals had perfect entry points, no false starts at all",
      "The team rewards have actually exceeded my signal trading profits this month",
      "I appreciate how the community celebrates everyone's success equally",
      "Went from knowing nothing about trading to earning consistently",
      "The accountability within our team keeps everyone focused and profitable",
      "Five consecutive profitable days, this system is incredibly reliable",
      "The weekend analysis sessions prepare us perfectly for Monday trading",
      "I've been able to reduce my work hours because of the trading income",
      "Team building is not just about referrals, it's about shared success",
      "The signals are backed by real analysis, not random guesses",
    ],
    [
      "Today's results proved once again the power of following the system",
      "My initial skepticism has been completely replaced by confidence",
      "The signal community here is the most supportive I've been part of",
      "Third profitable week in a row, the consistency is unmatched",
      "The team rewards structure motivates building genuine relationships",
      "I'm amazed at how well the signals performed during market turbulence",
      "My trading capital has doubled since I joined three months ago",
      "The leadership team truly cares about everyone's success",
      "Building a team has taught me valuable skills beyond just trading",
      "Today's profit alone covered my monthly subscription cost multiple times",
      "The transparency in sharing both wins and lessons learned is refreshing",
      "I've learned more about trading here than from any course I've taken",
      "The reward tiers incentivize growth and help everyone earn more",
      "My financial independence journey accelerated significantly after joining",
      "Looking forward to another productive week of profitable signals",
    ],
  ],
  3: [
    [
      "Record-breaking profits today, the signals were incredibly precise",
      "I just withdrew my weekly profits and it feels amazing to see real results",
      "The market analysis shared before trading hours is always thorough",
      "My team has grown to 12 members and we're all earning consistently",
      "The signal accuracy has been above 88% for three weeks straight",
      "Today I learned a new trading concept from the pre-session analysis",
      "The passive income from team rewards has been a game changer",
      "This community has transformed how I think about generating income",
      "Every week I see improvement in both my trading and team building",
      "The signals capture market movements that I would have missed on my own",
      "Helped a new member set up today and they made a profit on their first trade",
      "The consistent daily schedule makes it easy to plan around",
      "Team building rewards are proportional to effort, which is very fair",
      "My monthly income has increased by 40% since I started here",
      "The quality of signals and community support is worth every penny",
    ],
    [
      "Another day of solid profits, the system just works",
      "I've been documenting my journey and the growth is undeniable",
      "The trading community here is genuinely helpful, no competition",
      "Made enough from this week's signals to cover next month's expenses",
      "The team building aspect creates a support network for everyone",
      "Today's signals had amazing risk-to-reward ratios across the board",
      "My approach to money management has improved since joining",
      "The reward system encourages collaboration rather than competition",
      "I've introduced the opportunity to my family members as well",
      "Celebrating six months of consistent profitability today",
      "The signals work because the analysis behind them is thorough",
      "Team milestones bring great bonuses that reward long-term commitment",
      "Every new member I bring in strengthens our collective earning power",
      "The freedom that consistent trading profits provide is priceless",
      "Grateful for this community and the opportunities it has given me",
    ],
  ],
  4: [
    [
      "Friday profits to finish the week strong, another great session",
      "Looking at my weekly summary, every single day was profitable",
      "The pre-market analysis today predicted the movement perfectly",
      "My team earned collectively more than any of us could alone",
      "Signal accuracy this week averaged above 90%, outstanding results",
      "I've started investing my signal profits into longer-term positions",
      "The community mentorship program helped me improve my own trading skills",
      "The weekly rewards from team building keep getting better as we grow",
      "Finished the week with the highest profit margin since I started",
      "The structured trading schedule allows me to maintain work-life balance",
      "New team members are always impressed by the accuracy from day one",
      "This platform has changed how I approach personal finance entirely",
      "Team building rewards complement trading profits beautifully",
      "I never thought I could earn this consistently from trading",
      "Weekend plans funded entirely by this week's signal profits",
    ],
    [
      "What a way to end the week, profits exceeded all expectations",
      "My journey from beginner to confident trader happened here",
      "The signals delivered consistently all week without a single losing day",
      "Team growth this week was excellent, three new members joined",
      "The reward structure gets more attractive as your team expands",
      "I compared my results with friends trading elsewhere, we far outperform",
      "Today's final signal was the cherry on top of a perfect week",
      "The discipline taught through following signals has improved my life",
      "Building a team gives purpose beyond just personal profit",
      "My financial targets for this month were achieved ahead of schedule",
      "The combination of daily signals and team rewards is a winning formula",
      "Every member in my team is profitable, which speaks volumes",
      "The weekend gives us time to review and prepare for next week's success",
      "I'm so glad I trusted the process and stayed committed from the start",
      "Next week is going to be even better, the market setup looks favorable",
    ],
  ],
  5: [
    [
      "Even Saturday analysis sessions add value, reviewing the week's trades",
      "Weekend is a great time to reflect on the profits earned this week",
      "My team discussion today focused on strategies for next week",
      "The weekly profit summary shows consistent growth week over week",
      "Using the weekend to plan team building activities for next week",
      "Shared my weekly earnings screenshot with the team, everyone motivated",
      "The educational content shared on weekends is extremely valuable",
      "Team building has become second nature, always looking for new members",
      "Weekend rewards from the platform keep the momentum going",
      "Preparing my trading plan for next week based on the market analysis",
      "The community is active even on weekends, sharing insights and tips",
      "My team leader shared advanced strategies during today's weekend session",
      "The rewards I earned this week from team building were substantial",
      "Feeling confident about next week after reviewing this week's results",
      "The systematic approach to trading here eliminates emotional decisions",
    ],
    [
      "Weekend review shows this was one of our best weeks ever as a team",
      "Planning to onboard two new team members next week for growth",
      "The Saturday analysis session always gives us an edge for Monday",
      "My trading journal shows consistent improvement month over month",
      "The team rewards this week were a pleasant surprise, exceeded expectations",
      "Using profits from signals to diversify my investment portfolio",
      "The support from more experienced members on weekends is invaluable",
      "Weekend study of market patterns has improved my understanding significantly",
      "Team building milestones are achievable and the rewards are meaningful",
      "My family is supportive because they see the consistent results",
      "The platform's transparency builds trust and encourages participation",
      "Reviewed my six-month performance and the growth trend is remarkable",
      "Team events and discussions create strong bonds among members",
      "Financial freedom is not just a dream anymore, it's becoming reality",
      "Ready to crush it next week with renewed energy and better strategies",
    ],
  ],
  6: [
    [
      "Sunday preparation for the new trading week ahead",
      "Reviewing last week's performance to improve for the coming week",
      "The Sunday market preview always helps me prepare mentally for Monday",
      "My team check-in today showed everyone is motivated for next week",
      "Using Sunday to set new financial goals based on recent profits",
      "The consistent weekly routine of review and planning works perfectly",
      "Team building discussions on Sunday set the tone for the week ahead",
      "Grateful for another profitable week and excited for what's next",
      "My trading mindset has completely transformed since joining this team",
      "Sunday is for gratitude and planning, both equally important",
      "The weekend analysis gives us confidence going into a new week",
      "My team's collective success motivates me to keep growing",
      "Setting higher targets for next week based on this week's strong results",
      "The rewards program makes Sundays exciting with weekly calculations",
      "Tomorrow starts a new chapter of profits and team growth",
    ],
    [
      "End of week reflection: another successful seven days in the books",
      "Sunday planning session completed, ready for Monday's signals",
      "My portfolio review shows healthy and consistent growth pattern",
      "Team meeting today was productive, everyone shared their wins",
      "The systematic approach we follow eliminates guesswork from trading",
      "My referral network continues to grow organically through results",
      "Sunday preparation is what separates good weeks from great weeks",
      "The community's positive energy on Sundays is always motivating",
      "Financial discipline learned here extends beyond just trading",
      "Ready for another week of profits, signals, and team growth",
      "The platform delivers on its promises consistently week after week",
      "My income streams have diversified significantly since joining",
      "Team milestones achieved this week set us up for bigger rewards",
      "The Sunday night anticipation for Monday's first signal is exciting",
      "Let's make next week our best week yet as a united team",
    ],
  ],
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

function generateReadySchedule(windowIndex: number, groupIndex: number, dayOfYear: number): { botIndex: number; message: string; minuteOffset: number }[] {
  const seed = dayOfYear * 1000 + windowIndex * 100 + groupIndex;
  const shuffledMessages = shuffleArray(READY_MESSAGES, seed);
  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];

  let s = seed + 7;
  let currentMinute = 0;

  for (let botIdx = 0; botIdx < 4; botIdx++) {
    schedule.push({
      botIndex: botIdx,
      message: shuffledMessages[botIdx % shuffledMessages.length],
      minuteOffset: currentMinute,
    });
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const gap = 1 + (s % 3);
    currentMinute += gap;
    if (currentMinute > 10) currentMinute = 10;
  }

  return schedule;
}

function generateEveningMessages(groupIndex: number, dayOfYear: number, groupCount: number = 8): { botIndex: number; message: string; minuteOffset: number }[] {
  const dayOfWeek = getNigeriaDate().getDay();
  const topicSets = EVENING_CHAT_TOPICS[dayOfWeek] || EVENING_CHAT_TOPICS[0];

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
      botIndex: i % 4,
      message: groupMessages[i],
      minuteOffset: currentMinute,
    });
    currentMinute += 10;
  }

  return schedule;
}

function generateMorningChatSchedule(groupIndex: number, dayOfYear: number): { botIndex: number; message: string; minuteOffset: number }[] {
  const seed = dayOfYear * 50 + groupIndex * 7;
  const shuffled = shuffleArray(MORNING_CHAT_MESSAGES, seed);
  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];
  let currentMinute = 0;

  for (let i = 0; i < Math.min(12, shuffled.length) && currentMinute < 60; i++) {
    schedule.push({
      botIndex: i % 4,
      message: shuffled[i],
      minuteOffset: currentMinute,
    });
    currentMinute += 5;
  }

  return schedule;
}

function generateDoneSchedule(groupIndex: number, dayOfYear: number): { botIndex: number; message: string; minuteOffset: number }[] {
  const schedule: { botIndex: number; message: string; minuteOffset: number }[] = [];
  let currentMinute = 0;
  const seed = dayOfYear * 30 + groupIndex;
  const botOrder = shuffleArray([0, 1, 2, 3], seed);

  for (let i = 0; i < 4; i++) {
    schedule.push({
      botIndex: botOrder[i],
      message: "Done",
      minuteOffset: currentMinute,
    });
    currentMinute += 5;
  }

  return schedule;
}

export async function getFullScheduleForToday(): Promise<any> {
  const dayOfYear = getDayOfYear();
  const language = getLanguageForToday();
  const mainBotMessage = getMainBotMessageForToday();
  const groupsList = await storage.getGroups();
  const numGroups = groupsList.length || 8;

  const schedule: any = {
    language,
    mainBotMessage,
    mainBotTime: "8:10 AM",
    groupNames: groupsList.map(g => g.name),
    morningChat: [] as any[],
    readyWindows: [] as any[],
    doneWindow: [] as any[],
    eveningChat: [] as any[],
  };

  for (let g = 0; g < numGroups; g++) {
    const morningItems = generateMorningChatSchedule(g, dayOfYear);
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
      const items = generateReadySchedule(w, g, dayOfYear);
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
    const doneItems = generateDoneSchedule(g, dayOfYear);
    schedule.doneWindow.push({
      groupIndex: g,
      messages: doneItems.map(item => ({
        ...item,
        time: `3:${String(20 + item.minuteOffset).padStart(2, "0")} PM`,
      })),
    });
  }

  for (let g = 0; g < numGroups; g++) {
    const eveningItems = generateEveningMessages(g, dayOfYear, numGroups);
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
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions");
    const session = new StringSession(sessionString);
    const client = new TelegramClient(session, parseInt(apiId), apiHash, {
      connectionRetries: 3,
    });
    await client.connect();
    await client.sendMessage(chatId, { message });
    await client.disconnect();
    return true;
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
    for (let g = 0; g < groupsList.length; g++) {
      const items = generateMorningChatSchedule(g, dayOfYear);
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
      for (let g = 0; g < groupsList.length; g++) {
        const items = generateReadySchedule(w, g, dayOfYear);
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
    for (let g = 0; g < groupsList.length; g++) {
      const items = generateDoneSchedule(g, dayOfYear);
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
    for (let g = 0; g < groupsList.length; g++) {
      const items = generateEveningMessages(g, dayOfYear, groupsList.length);
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
