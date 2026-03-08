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
    const schedule = getFullScheduleForToday();
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

  return httpServer;
}
