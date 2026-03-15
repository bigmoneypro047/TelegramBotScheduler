# Telegram Bot Automation Manager

## Overview
A web dashboard for managing automated Telegram messaging across 7 groups using 1 main bot (@GateamAi_bot) and 9 userbots. Features scheduled messages in multiple languages with rotating content. Nigeria WAT timezone.

## Architecture
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui components
- **Backend**: Express.js with PostgreSQL (Drizzle ORM)
- **Scheduling**: node-cron (Africa/Lagos timezone)
- **Telegram Main Bot**: node-telegram-bot-api (Bot API)
- **Telegram Userbots**: Python Telethon via subprocess (`server/telegram_sender.py`)
- **Greeting Listener**: Python Telethon persistent listener (`server/greeting_listener.py`)
- **Production**: Compiled CJS bundle (`dist/index.cjs`), deployed via Replit

## CRITICAL: Session Architecture
- Bot 1 is reserved for greeting listener (persistent Telethon connection)
- Bots 2-6 are used by scheduler for sending messages (short-lived Telethon connections)
- NEVER run dev server while production is deployed — causes AuthKeyDuplicatedError
- Both sender and listener use Telethon (Python) — NO GramJS/JavaScript Telegram libraries
- Group resolution uses PeerChannel (direct) instead of get_dialogs (unreliable)

## Key Files
- `shared/schema.ts` - Database schema (botConfig, userbots, groups, messageLogs)
- `server/scheduler.ts` - Core scheduling engine with message rotation logic
- `server/routes.ts` - API endpoints for CRUD, scheduler control, Telethon login, direct-send
- `server/storage.ts` - Database storage layer
- `server/telegram_sender.py` - Python Telethon script for userbot operations (send, login)
- `server/greeting_listener.py` - Persistent Telethon listener for greeting/newcomer auto-responses
- `server/greetingListener.ts` - TypeScript wrapper managing the Python greeting listener process
- `server/watchdog.ts` - Aggressive keepalive and auto-recovery system
- `client/src/pages/dashboard.tsx` - Main dashboard with status + controls
- `client/src/pages/configuration.tsx` - Bot credentials and group setup
- `client/src/pages/schedule.tsx` - Full daily schedule visualization
- `client/src/pages/logs.tsx` - Message activity logs

## Groups (5)
1. GA VIP Group 3 (-1003888492713)
2. GA Signal Group II (-1003706903145)
3. GA Signal Group 444 (-1002860574543)
4. GA Discussion Group (-1003542765160)
5. GA NewComer Welcome Group II (-1003780664837)

## Userbots (6 active)
- Bot 1 (+2349150827155) - Greeting listener only
- Bot 2 (+2348154110274) - Scheduler messages
- Bot 3 (+2348120347544) - Scheduler messages
- Bot 4 (+2348053901725) - Scheduler messages
- Bot 5 (+2348067467944) - Scheduler messages
- Bot 6 (+2349051172210) - Scheduler messages
- 2FA password: "cybercrime"

## Schedule Windows (Nigeria Time WAT)
- 3:00 AM: Dinner lifestyle session (night photos, "last night I invited...")
- 5:00 AM: Morning chat (5 min gaps between userbots)
- 8:10 AM: Main bot daily message (rotated language)
- 8:20, 9:20, 11:20, 12:20, 1:20, 2:20: Ready messages (1-3 min gaps)
- 3:10 PM: Dinner lifestyle session (day photos, "today I invited...")
- 3:20-3:40 PM: "Done" messages (5 min gaps)
- 3:25-7:00 PM: Evening discussion (5 min gaps, unique per group)

## Dinner Lifestyle Photos (60 total in server/meals/)
- 60 meal photos (meal_01.jpg to meal_60.jpg) classified as day or night
- Night photos: dark/dim/candlelit scenes for 3AM session
- Day photos: bright/well-lit scenes for 3:10PM session
- Each session selects unique photos per group ensuring no bot sends photos to more than one group
- Dual caption banks: PHOTO_CAPTIONS_NIGHT ("last night I invited...") and PHOTO_CAPTIONS_DAY ("today I invited...")
- Bot assignments cycle 0-8 across all photo entries

## Languages
- **Main bot message rotation (8 languages)**: English, Spanish, French, Arabic, Filipino, Indonesian, Urdu, Vietnamese
- **Morning/Evening conversation rotation**: via `getConversationLanguageForDay()`
- Full translations in `server/messages.ts`

## Greeting Listener (Auto-Response)
- Persistent Telethon listener (Bot 1 only) monitors all 5 groups
- Detects: good morning/afternoon/evening, hello, hi everyone, I'm new here, etc. (in 6 languages)
- Additional bots (2-6) respond via short-lived Telethon sends dispatched from Node.js
- 2-minute cooldown per group per greeting type to avoid spam
- Auto-starts 10s after server boot via watchdog
- Auto-restarts on crash with progressive backoff

## Reliability System (Aggressive Watchdog)
- **Self-ping**: Every 1 second to `/api/health`
- **External ping**: Every 15 seconds to production URL
- **Scheduler guard**: Every 5 seconds — auto-restarts scheduler if DOWN
- **Greeting guard**: Every 30 seconds — auto-restarts listener if DOWN
- **Watchdog check**: Every 30 seconds — full status log
- **Retry logic**: All Telegram sends retry up to 3 times (delays: 5s, 15s, 30s)
- **Timer-based scheduling**: Uses `setTimeout` per message — restart-resistant
- **Startup recovery**: Detects mid-session restart, schedules remaining messages
- **DB resilience**: Pool + direct pg.Client fallback on errors

## API Endpoints
- `POST /api/direct-send` - Send message directly: `{userbotIndex, groupId, message}`
- `POST /api/trigger-morning-test` - Trigger morning chat
- `POST /api/trigger-evening-chat` - Trigger evening chat to all groups
- `POST /api/trigger-ready-test` - Trigger ready messages to all groups
- `GET /api/health` - Full system health status

## Production Deployment
- Build: `npm run build` → `dist/index.cjs`
- Run: `node ./dist/index.cjs`
- Python files (telegram_sender.py, greeting_listener.py) are read from disk at runtime, not bundled
- TypeScript changes require rebuild before deploy

## Database
PostgreSQL with tables: users, bot_config, userbots (with apiId/apiHash columns), groups, message_logs
