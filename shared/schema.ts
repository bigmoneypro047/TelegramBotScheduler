import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const botConfig = pgTable("bot_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  botToken: text("bot_token"),
  apiId: text("api_id"),
  apiHash: text("api_hash"),
  isActive: boolean("is_active").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userbots = pgTable("userbots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  phoneNumber: text("phone_number"),
  sessionString: text("session_string"),
  isActive: boolean("is_active").default(false),
  order: integer("bot_order").notNull(),
});

export const groups = pgTable("groups", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  groupId: text("group_id"),
  order: integer("group_order").notNull(),
  isActive: boolean("is_active").default(true),
});

export const messageLogs = pgTable("message_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  botName: text("bot_name").notNull(),
  groupName: text("group_name").notNull(),
  message: text("message").notNull(),
  schedulePeriod: text("schedule_period").notNull(),
  sentAt: timestamp("sent_at").defaultNow(),
  status: text("status").notNull().default("sent"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertBotConfigSchema = createInsertSchema(botConfig).omit({ id: true, createdAt: true });
export const insertUserbotSchema = createInsertSchema(userbots).omit({ id: true });
export const insertGroupSchema = createInsertSchema(groups).omit({ id: true });
export const insertMessageLogSchema = createInsertSchema(messageLogs).omit({ id: true, sentAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type BotConfig = typeof botConfig.$inferSelect;
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type Userbot = typeof userbots.$inferSelect;
export type InsertUserbot = z.infer<typeof insertUserbotSchema>;
export type Group = typeof groups.$inferSelect;
export type InsertGroup = z.infer<typeof insertGroupSchema>;
export type MessageLog = typeof messageLogs.$inferSelect;
export type InsertMessageLog = z.infer<typeof insertMessageLogSchema>;
