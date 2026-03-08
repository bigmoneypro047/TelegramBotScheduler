# Telegram Bot Automation Manager

## Overview
A web dashboard for managing automated Telegram messaging across 5 groups using 1 main bot (@GateamAi_bot) and 4 userbots. Features scheduled messages in multiple languages with rotating content. Nigeria WAT timezone.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js with PostgreSQL (Drizzle ORM)
- **Scheduling**: node-cron (Africa/Lagos timezone)
- **Telegram Main Bot**: node-telegram-bot-api (Bot API)
- **Telegram Userbots**: Python Telethon via subprocess (`server/telegram_sender.py`)

## Key Files
- `shared/schema.ts` - Database schema (botConfig, userbots, groups, messageLogs)
- `server/scheduler.ts` - Core scheduling engine with message rotation logic
- `server/routes.ts` - API endpoints for CRUD, scheduler control, Telethon login
- `server/storage.ts` - Database storage layer
- `server/telegram_sender.py` - Python Telethon script for userbot operations (send, login)
- `client/src/pages/dashboard.tsx` - Main dashboard with status + controls
- `client/src/pages/configuration.tsx` - Bot credentials and group setup
- `client/src/pages/schedule.tsx` - Full daily schedule visualization
- `client/src/pages/logs.tsx` - Message activity logs

## Groups (5)
1. GA VIP Group 3 (-1003888492713) - Test group
2. GA Signal Group II (-1003706903145)
3. GA Signal Group 444 (-1002860574543)
4. GA Discussion Group (-1003542765160)
5. GA NewComer Welcome Group II (-1003780664837)

## Userbots
- Userbot 1 (+2348079272024, "Fred Level 3 VIP") - FROZEN by Telegram, inactive
- Userbot 2 (+2348154110274, "Tati") - Active, working
- Userbot 3 (+2348120347544, "Hannah") - Active, working
- Userbot 4 (+2348053901725, "Poly Key") - Active, working

## Schedule Windows (Nigeria Time WAT)
- 7:00-8:00 AM: Morning chat (5 min gaps between userbots)
- 8:10 AM: Main bot daily message (rotated language)
- 8:20, 9:20, 11:20, 12:20, 1:20, 2:20: Ready messages (1-3 min gaps)
- 3:20-3:40 PM: "Done" messages (5 min gaps)
- 4:30-7:00 PM: Evening discussion (10 min gaps, unique per group)

## Languages
- **Main bot message rotation (7 languages)**: English, Spanish, French, Arabic, Filipino, Indonesian, Urdu
- **Morning/Evening conversation rotation (5 languages)**: English, Spanish, Arabic, Indonesian, Filipino (5-day cycle via `dayOfYear % 5`)
- Full translations in `server/messages.ts`

## Reliability System
- **Self-ping keepalive**: Pings `/api/health` every 4 minutes to prevent sleep (`server/watchdog.ts`)
- **Watchdog monitor**: Checks server health every 5 minutes, logs uptime stats
- **Retry logic**: All Telegram sends retry up to 3 times (delays: 5s, 15s, 30s)
- **Crash protection**: `safeExecuteScheduledMessage` wraps all sends with try/catch
- **Heartbeat**: Cron runs every minute to confirm scheduler is alive
- **Endpoints**: `/api/health` (full status), `/api/watchdog` (watchdog stats)

## Technical Notes
- Scheduler dynamically fetches active bot indices, skipping inactive/frozen userbots
- Telethon sessions stored as StringSession in DB; entity cache via get_dialogs() on each send
- GramJS abandoned due to persistent PEER_ID_INVALID bug with supergroups
- Login flow: request-code → verify-code (supports 2FA) via Python subprocess

## Database
PostgreSQL with tables: users, bot_config, userbots (with apiId/apiHash columns), groups, message_logs
