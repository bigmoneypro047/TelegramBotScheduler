import sys
import json
import asyncio
import random
import time
import re
from telethon import TelegramClient, events
from telethon.sessions import StringSession

GREETING_PATTERNS = [
    r'\bgood\s*morning\b', r'\bgood\s*afternoon\b', r'\bgood\s*evening\b',
    r'\bgood\s*night\b', r'\bhello\b', r'\bhi\s+everyone\b', r'\bhi\s+all\b',
    r'\bhey\s+everyone\b', r'\bhey\s+all\b', r'\bgreetings\b',
    r'\bbuenos?\s*d[ií]as?\b', r'\bbuenas?\s*tardes?\b', r'\bbuenas?\s*noches?\b',
    r'\bhola\s+a\s+todos\b', r'\bhola\b',
    r'\bصباح\s*الخير\b', r'\bمساء\s*الخير\b', r'\bمرحبا\b', r'\bأهلا\b', r'\bسلام\b',
    r'\bselamat\s*pagi\b', r'\bselamat\s*siang\b', r'\bselamat\s*sore\b', r'\bselamat\s*malam\b',
    r'\bmagandang\s*umaga\b', r'\bmagandang\s*hapon\b', r'\bmagandang\s*gabi\b',
    r'\bxin\s*ch[àa]o\b', r'\bchào\b',
    r'\bgm\b', r'\bgn\b',
]

NEWCOMER_PATTERNS = [
    r"\bi[''`]?m\s+new\s+here\b", r'\bjust\s+joined\b', r'\bnew\s+member\b',
    r'\bnew\s+here\b', r'\bjust\s+started\b', r'\bfirst\s+time\s+here\b',
    r'\bsoy\s+nuev[oa]\b', r'\bacabo\s+de\s+unirme\b',
    r'\bعضو\s*جديد\b', r'\bانضممت\b',
    r'\bbaru\s+bergabung\b', r'\bbagong\s+kasali\b',
    r'\bmới\s+tham\s+gia\b',
]

MORNING_RESPONSES = [
    "Good morning!", "Good morning everyone!", "Morning!", "GM!",
    "Good morning, hope everyone has a great day!", "Morning all!",
    "Buenos días!", "صباح الخير!", "Selamat pagi!", "Magandang umaga!",
    "Good morning! Ready for another great day!", "Hey, good morning!",
    "Morning! Let's make today count!", "GM everyone!",
]

AFTERNOON_RESPONSES = [
    "Good afternoon!", "Good afternoon everyone!", "Afternoon!",
    "Good afternoon, hope the day is going well!", "Hey, good afternoon!",
    "Buenas tardes!", "مساء الخير!", "Selamat siang!",
    "Magandang hapon!", "Good afternoon all!",
]

EVENING_RESPONSES = [
    "Good evening!", "Good evening everyone!", "Evening!",
    "Good evening, hope you had a great day!", "Hey, good evening!",
    "Buenas noches!", "مساء الخير!", "Selamat malam!",
    "Magandang gabi!", "Good evening all!",
]

GENERAL_GREETING_RESPONSES = [
    "Hello!", "Hey!", "Hi there!", "Hello everyone!",
    "Hey, welcome!", "Hi!", "Greetings!", "Hello there!",
    "Hey! Great to see you!", "Hi everyone!",
]

WELCOME_RESPONSES = [
    "Welcome! You're going to love it here!",
    "Welcome to the group! Great to have you!",
    "Hey welcome! Feel free to ask any questions!",
    "Welcome! You made a great decision joining us!",
    "Welcome aboard! This community is amazing!",
    "Hey, welcome! Glad you're here!",
    "Welcome! Stick around and you'll see great results!",
    "Welcome! You're in good hands here!",
    "Hey welcome! The team here is really supportive!",
    "Welcome to the family! Let's make money together!",
]

last_responders = []

def classify_message(text):
    text_lower = text.lower().strip()
    if len(text_lower) > 200:
        return None

    for pat in NEWCOMER_PATTERNS:
        if re.search(pat, text_lower, re.IGNORECASE):
            return "newcomer"

    for pat in GREETING_PATTERNS:
        if re.search(pat, text_lower, re.IGNORECASE):
            if re.search(r'morning', text_lower, re.IGNORECASE) or re.search(r'umaga|pagi|صباح|días', text_lower, re.IGNORECASE):
                return "morning"
            elif re.search(r'afternoon|hapon|siang|tardes', text_lower, re.IGNORECASE):
                return "afternoon"
            elif re.search(r'evening|night|gabi|malam|noches', text_lower, re.IGNORECASE):
                return "evening"
            else:
                return "general"

    return None

def get_response(msg_type):
    if msg_type == "morning":
        return random.choice(MORNING_RESPONSES)
    elif msg_type == "afternoon":
        return random.choice(AFTERNOON_RESPONSES)
    elif msg_type == "evening":
        return random.choice(EVENING_RESPONSES)
    elif msg_type == "newcomer":
        return random.choice(WELCOME_RESPONSES)
    else:
        return random.choice(GENERAL_GREETING_RESPONSES)

def pick_responders(available_indices, count=3):
    global last_responders
    candidates = [i for i in available_indices if i not in last_responders]
    if len(candidates) < count:
        candidates = list(available_indices)
    chosen = random.sample(candidates, min(count, len(candidates)))
    random.shuffle(chosen)
    last_responders = chosen
    return chosen

cooldowns = {}
COOLDOWN_SECONDS = 120

async def main():
    data = json.loads(sys.argv[1])
    bots_data = data["bots"]
    group_ids = data["groupIds"]

    clients = []
    bot_indices = []

    for i, bot in enumerate(bots_data):
        try:
            client = TelegramClient(
                StringSession(bot["session"]),
                int(bot["apiId"]),
                bot["apiHash"]
            )
            await client.connect()
            if await client.is_user_authorized():
                clients.append(client)
                bot_indices.append(i)
                me = await client.get_me()
                print(json.dumps({"type": "log", "msg": f"Bot {i+1} ({me.first_name}) connected"}), flush=True)
            else:
                print(json.dumps({"type": "log", "msg": f"Bot {i+1} not authorized, skipping"}), flush=True)
                await client.disconnect()
        except Exception as e:
            print(json.dumps({"type": "log", "msg": f"Bot {i+1} connection failed: {str(e)}"}), flush=True)

    if len(clients) < 3:
        print(json.dumps({"type": "error", "msg": f"Only {len(clients)} bots connected, need at least 3"}), flush=True)
        for c in clients:
            await c.disconnect()
        return

    listener_client = clients[0]

    group_entities = {}
    try:
        dialogs = await listener_client.get_dialogs()
        for dialog in dialogs:
            if dialog.entity and hasattr(dialog.entity, 'id'):
                eid = dialog.entity.id
                if hasattr(dialog.entity, 'megagroup') or hasattr(dialog.entity, 'broadcast'):
                    full_id = str(-1000000000000 - eid)
                else:
                    full_id = str(-eid)
                if full_id in group_ids:
                    group_entities[full_id] = dialog.entity
    except Exception as e:
        print(json.dumps({"type": "error", "msg": f"Failed to load dialogs: {str(e)}"}), flush=True)

    if len(group_entities) == 0:
        print(json.dumps({"type": "error", "msg": "Could not find any monitored groups in dialogs. Exiting."}), flush=True)
        for c in clients:
            await c.disconnect()
        return

    print(json.dumps({"type": "log", "msg": f"Monitoring {len(group_entities)} groups with {len(clients)} bots"}), flush=True)

    monitored_ids = set()
    for gid_str, entity in group_entities.items():
        monitored_ids.add(entity.id)

    my_ids = set()
    for c in clients:
        me = await c.get_me()
        my_ids.add(me.id)

    @listener_client.on(events.NewMessage())
    async def handler(event):
        try:
            if not event.is_group and not event.is_channel:
                return

            chat = await event.get_chat()
            if chat.id not in monitored_ids:
                return

            sender = await event.get_sender()
            if not sender or sender.id in my_ids:
                return
            if hasattr(sender, 'bot') and sender.bot:
                return

            text = event.raw_text
            if not text or len(text.strip()) < 2:
                return

            msg_type = classify_message(text)
            if not msg_type:
                return

            cooldown_key = f"{chat.id}_{msg_type}"
            now = time.time()
            if cooldown_key in cooldowns and (now - cooldowns[cooldown_key]) < COOLDOWN_SECONDS:
                return
            cooldowns[cooldown_key] = now

            responders = pick_responders(bot_indices, 3)

            chat_id_str = None
            for gid_str, entity in group_entities.items():
                if entity.id == chat.id:
                    chat_id_str = gid_str
                    break

            sender_name = sender.first_name or "Someone"
            print(json.dumps({
                "type": "greeting_detected",
                "msg": f"{sender_name} said '{text[:50]}' ({msg_type}) in chat {chat.id}",
                "chatId": chat_id_str,
                "msgType": msg_type,
            }), flush=True)

            for resp_idx in responders:
                delay = random.randint(15, 45)
                await asyncio.sleep(delay)

                response = get_response(msg_type)
                try:
                    resp_client = clients[bot_indices.index(resp_idx)] if resp_idx in bot_indices else None
                    if resp_client is None:
                        continue

                    resp_dialogs = await resp_client.get_dialogs()
                    resp_entity = None
                    for d in resp_dialogs:
                        if d.entity and hasattr(d.entity, 'id') and d.entity.id == chat.id:
                            resp_entity = d.entity
                            break

                    if resp_entity:
                        await resp_client.send_message(resp_entity, response)
                        print(json.dumps({
                            "type": "greeting_sent",
                            "msg": f"Bot {resp_idx+1} replied '{response}' in chat {chat.id}",
                            "botIndex": resp_idx,
                            "response": response,
                            "chatId": chat_id_str,
                        }), flush=True)
                    else:
                        print(json.dumps({
                            "type": "log",
                            "msg": f"Bot {resp_idx+1} could not find chat {chat.id}",
                        }), flush=True)
                except Exception as e:
                    print(json.dumps({
                        "type": "error",
                        "msg": f"Bot {resp_idx+1} failed to respond: {str(e)}",
                    }), flush=True)

        except Exception as e:
            print(json.dumps({"type": "error", "msg": f"Handler error: {str(e)}"}), flush=True)

    print(json.dumps({"type": "started", "msg": f"Greeting listener active with {len(clients)} bots monitoring {len(group_entities)} groups"}), flush=True)

    try:
        await listener_client.run_until_disconnected()
    finally:
        for c in clients:
            try:
                await c.disconnect()
            except:
                pass

if __name__ == "__main__":
    asyncio.run(main())
