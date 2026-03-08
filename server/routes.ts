import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { startScheduler, stopScheduler, getSchedulerStatus, getFullScheduleForToday } from "./scheduler";

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

      const { TelegramClient } = await import("telegram");
      const { StringSession } = await import("telegram/sessions");

      const client = new TelegramClient(
        new StringSession(""),
        parseInt(bot.apiId),
        bot.apiHash,
        { connectionRetries: 3 }
      );

      await client.connect();
      const result = await client.sendCode(
        { apiId: parseInt(bot.apiId), apiHash: bot.apiHash },
        phoneNumber
      );

      loginSessions.set(req.params.id, {
        client,
        phoneNumber,
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

      const { code, password } = req.body;
      if (!code) {
        return res.status(400).json({ error: "Verification code is required" });
      }

      const { client, phoneNumber, phoneCodeHash } = session;

      try {
        await client.invoke(
          new (await import("telegram/tl")).Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash,
            phoneCode: code,
          })
        );
      } catch (signInErr: any) {
        if (signInErr.errorMessage === "SESSION_PASSWORD_NEEDED") {
          if (!password) {
            return res.status(400).json({
              error: "Two-factor authentication is enabled. Please provide your password.",
              needsPassword: true,
            });
          }
          await client.invoke(
            new (await import("telegram/tl")).Api.auth.CheckPassword({
              password: await client.computeSrpParams(
                await client.invoke(new (await import("telegram/tl")).Api.account.GetPassword()),
                password
              ),
            })
          );
        } else {
          throw signInErr;
        }
      }

      const sessionString = (client.session as any).save();

      await storage.upsertUserbot({
        id: req.params.id,
        name: `Userbot ${(await storage.getUserbot(req.params.id))?.order || 0}`,
        phoneNumber,
        sessionString,
        apiId: (await storage.getUserbot(req.params.id))?.apiId || null,
        apiHash: (await storage.getUserbot(req.params.id))?.apiHash || null,
        isActive: true,
        order: (await storage.getUserbot(req.params.id))?.order || 0,
      });

      await client.disconnect();
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

  return httpServer;
}
