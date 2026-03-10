import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import {
  type User, type InsertUser,
  type BotConfig, type InsertBotConfig,
  type Userbot, type InsertUserbot,
  type Group, type InsertGroup,
  type MessageLog, type InsertMessageLog,
  users, botConfig, userbots, groups, messageLogs
} from "@shared/schema";

function createPool() {
  const p = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    min: 0,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  });
  p.on("error", (err) => {
    console.error("[storage] Pool error (will recreate):", err.message);
    schedulePoolRefresh();
  });
  return p;
}

let pool = createPool();
let db = drizzle(pool);
let refreshScheduled = false;

function schedulePoolRefresh() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  setTimeout(() => {
    try {
      pool.end().catch(() => {});
    } catch {}
    pool = createPool();
    db = drizzle(pool);
    refreshScheduled = false;
    console.log("[storage] Pool refreshed after error");
  }, 1000);
}

async function withFreshConnection<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await fn(client);
    await client.end();
    return result;
  } catch (err) {
    try { await client.end(); } catch {}
    throw err;
  }
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getBotConfig(): Promise<BotConfig | undefined>;
  upsertBotConfig(config: InsertBotConfig): Promise<BotConfig>;
  getUserbots(): Promise<Userbot[]>;
  getUserbot(id: string): Promise<Userbot | undefined>;
  upsertUserbot(bot: InsertUserbot & { id?: string }): Promise<Userbot>;
  deleteUserbot(id: string): Promise<void>;
  getGroups(): Promise<Group[]>;
  getGroup(id: string): Promise<Group | undefined>;
  upsertGroup(group: InsertGroup & { id?: string }): Promise<Group>;
  deleteGroup(id: string): Promise<void>;
  getMessageLogs(limit?: number): Promise<MessageLog[]>;
  createMessageLog(log: InsertMessageLog): Promise<MessageLog>;
  clearMessageLogs(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private async safeQuery<T>(poolQuery: () => Promise<T>, fallbackQuery: (client: pg.Client) => Promise<T>): Promise<T> {
    try {
      const result = await poolQuery();
      return result;
    } catch (poolErr: any) {
      console.error("[storage] Pool query failed, trying direct connection:", poolErr.message);
      schedulePoolRefresh();
      return await withFreshConnection(fallbackQuery);
    }
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getBotConfig(): Promise<BotConfig | undefined> {
    return this.safeQuery(
      async () => {
        const [config] = await db.select().from(botConfig).limit(1);
        return config;
      },
      async (client) => {
        const res = await client.query("SELECT * FROM bot_config LIMIT 1");
        return res.rows[0] as BotConfig | undefined;
      }
    );
  }

  async upsertBotConfig(config: InsertBotConfig): Promise<BotConfig> {
    const existing = await this.getBotConfig();
    if (existing) {
      const [updated] = await db.update(botConfig).set(config).where(eq(botConfig.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(botConfig).values(config).returning();
    return created;
  }

  async getUserbots(): Promise<Userbot[]> {
    return this.safeQuery(
      async () => {
        const result = await db.select().from(userbots).orderBy(userbots.order);
        return result;
      },
      async (client) => {
        const res = await client.query("SELECT * FROM userbots ORDER BY bot_order");
        return res.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          apiId: r.api_id,
          apiHash: r.api_hash,
          sessionString: r.session_string,
          isActive: r.is_active,
          order: r.bot_order,
        })) as Userbot[];
      }
    );
  }

  async getUserbot(id: string): Promise<Userbot | undefined> {
    const [bot] = await db.select().from(userbots).where(eq(userbots.id, id));
    return bot;
  }

  async upsertUserbot(bot: InsertUserbot & { id?: string }): Promise<Userbot> {
    if (bot.id) {
      const { id, ...data } = bot;
      const [updated] = await db.update(userbots).set(data).where(eq(userbots.id, id)).returning();
      return updated;
    }
    const [created] = await db.insert(userbots).values(bot).returning();
    return created;
  }

  async deleteUserbot(id: string): Promise<void> {
    await db.delete(userbots).where(eq(userbots.id, id));
  }

  async getGroups(): Promise<Group[]> {
    return this.safeQuery(
      async () => {
        const result = await db.select().from(groups).orderBy(groups.order);
        return result;
      },
      async (client) => {
        const res = await client.query("SELECT * FROM groups ORDER BY group_order");
        return res.rows.map((r: any) => ({
          id: r.id,
          name: r.name,
          groupId: r.group_id,
          order: r.group_order,
        })) as Group[];
      }
    );
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  async upsertGroup(group: InsertGroup & { id?: string }): Promise<Group> {
    if (group.id) {
      const { id, ...data } = group;
      const [updated] = await db.update(groups).set(data).where(eq(groups.id, id)).returning();
      return updated;
    }
    const [created] = await db.insert(groups).values(group).returning();
    return created;
  }

  async deleteGroup(id: string): Promise<void> {
    await db.delete(groups).where(eq(groups.id, id));
  }

  async getMessageLogs(limit = 100): Promise<MessageLog[]> {
    return db.select().from(messageLogs).orderBy(desc(messageLogs.sentAt)).limit(limit);
  }

  async createMessageLog(log: InsertMessageLog): Promise<MessageLog> {
    const [created] = await db.insert(messageLogs).values(log).returning();
    return created;
  }

  async clearMessageLogs(): Promise<void> {
    await db.delete(messageLogs);
  }
}

export const storage = new DatabaseStorage();
