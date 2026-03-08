# Telegram Bot Automation Manager

## Overview
A web dashboard for managing automated Telegram messaging across 6 groups using 1 main bot and 4 userbots. Features scheduled messages in multiple languages with rotating content.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js with PostgreSQL (Drizzle ORM)
- **Scheduling**: node-cron (Nigeria WAT timezone)
- **Telegram**: node-telegram-bot-api (main bot), telegram/gramjs (userbots)

## Key Files
- `shared/schema.ts` - Database schema (botConfig, userbots, groups, messageLogs)
- `server/scheduler.ts` - Core scheduling engine with message rotation logic
- `server/routes.ts` - API endpoints for CRUD and scheduler control
- `server/storage.ts` - Database storage layer
- `client/src/pages/dashboard.tsx` - Main dashboard with status + controls
- `client/src/pages/configuration.tsx` - Bot credentials and group setup
- `client/src/pages/schedule.tsx` - Full daily schedule visualization
- `client/src/pages/logs.tsx` - Message activity logs

## Schedule Windows (Nigeria Time WAT)
- 7:00-8:00 AM: Morning chat (5 min gaps between userbots)
- 8:10 AM: Main bot daily message (rotated language)
- 8:20-8:30 AM, 9:20-9:30, 11:20-11:30, 12:20-12:30, 1:20-1:30, 2:20-2:30: Ready messages
- 3:20-4:00 PM: "Done" messages (5 min gaps)
- 4:30-7:00 PM: Evening discussion (10 min gaps, unique per group)

## Languages (Daily Rotation)
English, Spanish, French, Arabic, Filipino, Indonesian, Urdu

## Database
PostgreSQL with tables: users, bot_config, userbots, groups, message_logs
