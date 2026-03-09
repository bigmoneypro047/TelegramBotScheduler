import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { startScheduler, stopScheduler, getSchedulerStatus, getFullScheduleForToday, triggerReadyWindowNow, triggerEveningChatNow, triggerMorningTestNow, triggerMorningSpeedTest } from "./scheduler";
import { getWatchdogStatus } from "./watchdog";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get("/api/config", async (_req, res) => {
    const config = await storage.getBotConfig();
    if (config) {
      res.json({
        ...config,
        botToken: config.botToken ? "***configured***" : null,
        apiId: config.apiId ? "***configured***" : null,
        apiHash: config.apiHash ? "***configured***" : null,
      });
    } else {
      res.json(null);
    }
  });

  app.post("/api/config", async (req, res) => {
    const config = await storage.upsertBotConfig(req.body);
    res.json(config);
  });

  app.get("/api/userbots", async (_req, res) => {
    const bots = await storage.getUserbots();
    res.json(bots.map(b => ({
      ...b,
      phoneNumber: b.phoneNumber ? b.phoneNumber.slice(0, 4) + "****" + b.phoneNumber.slice(-2) : null,
      sessionString: b.sessionString ? "***configured***" : null,
      apiId: b.apiId || null,
      apiHash: b.apiHash ? b.apiHash.slice(0, 4) + "****" : null,
    })));
  });

  app.post("/api/userbots", async (req, res) => {
    const bot = await storage.upsertUserbot(req.body);
    res.json(bot);
  });

  app.delete("/api/userbots/:id", async (req, res) => {
    await storage.deleteUserbot(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/groups", async (_req, res) => {
    const groupsList = await storage.getGroups();
    res.json(groupsList);
  });

  app.post("/api/groups", async (req, res) => {
    const group = await storage.upsertGroup(req.body);
    res.json(group);
  });

  app.delete("/api/groups/:id", async (req, res) => {
    await storage.deleteGroup(req.params.id);
    res.json({ success: true });
  });

  app.get("/api/logs", async (_req, res) => {
    const logs = await storage.getMessageLogs(200);
    res.json(logs);
  });

  app.delete("/api/logs", async (_req, res) => {
    await storage.clearMessageLogs();
    res.json({ success: true });
  });

  app.get("/api/schedule", async (_req, res) => {
    const schedule = await getFullScheduleForToday();
    res.json(schedule);
  });

  app.get("/api/scheduler/status", async (_req, res) => {
    const status = getSchedulerStatus();
    res.json(status);
  });

  app.post("/api/scheduler/start", async (_req, res) => {
    startScheduler();
    res.json({ success: true, status: getSchedulerStatus() });
  });

  app.post("/api/scheduler/stop", async (_req, res) => {
    stopScheduler();
    res.json({ success: true, status: getSchedulerStatus() });
  });

  app.post("/api/seed-defaults", async (_req, res) => {
    const existingBots = await storage.getUserbots();
    if (existingBots.length === 0) {
      for (let i = 1; i <= 4; i++) {
        await storage.upsertUserbot({
          name: `Userbot ${i}`,
          phoneNumber: null,
          sessionString: null,
          isActive: false,
          order: i,
        });
      }
    }

    const existingGroups = await storage.getGroups();
    if (existingGroups.length === 0) {
      for (let i = 1; i <= 6; i++) {
        await storage.upsertGroup({
          name: `Group ${i}`,
          groupId: null,
          order: i,
          isActive: true,
        });
      }
    }

    res.json({ success: true });
  });

  const loginSessions: Map<string, any> = new Map();

  function getPythonPath(): string {
    const path = require("path");
    const fs = require("fs");
    const candidates = [
      path.join(process.cwd(), ".pythonlibs", "bin", "python3"),
      "/home/runner/workspace/.pythonlibs/bin/python3",
      "python3",
    ];
    for (const p of candidates) {
      try { if (fs.existsSync(p)) return p; } catch {}
    }
    return "python3";
  }

  async function runPython(args: string[]): Promise<any> {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);
    const pythonBin = getPythonPath();
    const { stdout } = await execFileAsync(pythonBin, ["server/telegram_sender.py", ...args], { timeout: 30000 });
    return JSON.parse(stdout.trim());
  }

  app.post("/api/userbots/:id/request-code", async (req, res) => {
    try {
      const bot = await storage.getUserbot(req.params.id);
      if (!bot || !bot.apiId || !bot.apiHash) {
        return res.status(400).json({ error: "Userbot not found or missing API credentials" });
      }
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      const result = await runPython(["request_code", bot.apiId, bot.apiHash, phoneNumber]);
      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      loginSessions.set(req.params.id, {
        phoneNumber,
        tempSession: result.session,
        phoneCodeHash: result.phoneCodeHash,
      });

      res.json({ success: true, message: "Code sent to your phone" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/userbots/:id/verify-code", async (req, res) => {
    try {
      const session = loginSessions.get(req.params.id);
      if (!session) {
        return res.status(400).json({ error: "No login session found. Request code first." });
      }

      const bot = await storage.getUserbot(req.params.id);
      if (!bot || !bot.apiId || !bot.apiHash) {
        return res.status(400).json({ error: "Userbot not found or missing API credentials" });
      }

      const { code, password } = req.body;
      if (!code) {
        return res.status(400).json({ error: "Verification code is required" });
      }

      const { phoneNumber, tempSession, phoneCodeHash } = session;
      const args = ["verify_code", tempSession, bot.apiId, bot.apiHash, phoneNumber, code, phoneCodeHash];
      if (password) args.push(password);

      const result = await runPython(args);
      if (!result.success) {
        if (result.needsPassword) {
          if (result.session) {
            loginSessions.set(req.params.id, { ...session, tempSession: result.session });
          }
          return res.status(400).json({
            error: "Two-factor authentication is enabled. Please provide your password.",
            needsPassword: true,
          });
        }
        return res.status(500).json({ error: result.error });
      }

      await storage.upsertUserbot({
        id: req.params.id,
        name: bot.name,
        phoneNumber,
        sessionString: result.session,
        apiId: bot.apiId,
        apiHash: bot.apiHash,
        isActive: true,
        order: bot.order,
      });

      loginSessions.delete(req.params.id);
      res.json({ success: true, message: "Userbot authenticated and session saved" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/groups/bulk-setup", async (req, res) => {
    const { groups: groupEntries } = req.body;
    if (!Array.isArray(groupEntries) || groupEntries.length === 0) {
      return res.status(400).json({ error: "groups array is required" });
    }

    const existingGroups = await storage.getGroups();

    for (const entry of groupEntries) {
      const existing = existingGroups.find(g => g.order === entry.order);
      if (existing) {
        await storage.upsertGroup({
          id: existing.id,
          name: entry.name || existing.name,
          groupId: entry.groupId,
          order: entry.order,
          isActive: true,
        });
      } else {
        await storage.upsertGroup({
          name: entry.name || `Group ${entry.order}`,
          groupId: entry.groupId,
          order: entry.order,
          isActive: true,
        });
      }
    }

    const updatedGroups = await storage.getGroups();
    res.json({ success: true, groups: updatedGroups });
  });

  app.post("/api/test-send", async (req, res) => {
    try {
      const { groupIndex } = req.body;
      const config = await storage.getBotConfig();
      if (!config?.botToken) {
        return res.status(400).json({ error: "No bot token configured" });
      }
      const groupsList = await storage.getGroups();
      const idx = groupIndex ?? 0;
      const group = groupsList[idx];
      if (!group || !group.groupId) {
        return res.status(400).json({ error: `Group ${idx + 1} not found or has no group ID` });
      }

      const TelegramBot = (await import("node-telegram-bot-api")).default;
      const bot = new TelegramBot(config.botToken, { polling: false });
      await bot.sendMessage(group.groupId, "Test message from Bot Dashboard - System check!");
      await storage.createMessageLog({
        botName: "Main Bot",
        groupName: group.name,
        message: "Test message",
        schedulePeriod: "test",
        status: "sent",
      });
      res.json({ success: true, group: group.name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/test-userbot", async (req, res) => {
    try {
      const { userbotIndex } = req.body;
      const bots = await storage.getUserbots();
      const bot = bots[userbotIndex ?? 0];
      if (!bot || !bot.sessionString || !bot.apiId || !bot.apiHash) {
        return res.status(400).json({ error: `Userbot ${(userbotIndex ?? 0) + 1} not configured` });
      }
      const groupsList = await storage.getGroups();
      const group = groupsList[0];
      if (!group || !group.groupId) {
        return res.status(400).json({ error: "Group 1 not found or has no group ID" });
      }

      const result = await runPython([
        "send", bot.sessionString, bot.apiId, bot.apiHash,
        group.groupId, `Test message from ${bot.name} - System check!`
      ]);

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      await storage.createMessageLog({
        botName: bot.name,
        groupName: group.name,
        message: "Test message",
        schedulePeriod: "test",
        status: "sent",
      });
      res.json({ success: true, bot: bot.name, group: group.name });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/trigger-ready-test", async (_req, res) => {
    try {
      const result = await triggerReadyWindowNow();
      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/trigger-morning-test", async (_req, res) => {
    triggerMorningTestNow().catch(err => {
      console.error("Morning test trigger error:", err.message);
    });
    res.json({ success: true, result: "Morning test started in background (Group 1 only, real 5-min intervals)" });
  });

  app.post("/api/trigger-morning-speed-test", async (_req, res) => {
    const result = await triggerMorningSpeedTest();
    res.json({ success: true, result });
  });

  app.post("/api/trigger-evening-chat", async (_req, res) => {
    triggerEveningChatNow().catch(err => {
      console.error("Evening chat trigger error:", err.message);
    });
    res.json({ success: true, result: "Evening chat started in background" });
  });

  app.get("/api/health", async (_req, res) => {
    const schedulerStatus = getSchedulerStatus();
    const watchdog = getWatchdogStatus();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      scheduler: schedulerStatus,
      watchdog,
    });
  });

  app.get("/api/watchdog", async (_req, res) => {
    res.json(getWatchdogStatus());
  });

  return httpServer;
}
