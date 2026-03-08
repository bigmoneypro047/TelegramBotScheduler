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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

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
    const [config] = await db.select().from(botConfig).limit(1);
    return config;
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
    return db.select().from(userbots).orderBy(userbots.order);
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
    return db.select().from(groups).orderBy(groups.order);
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
