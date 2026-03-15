import sys
import json
import asyncio
import random
import time
import re
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.types import PeerChannel

LANG_GREETING_PATTERNS = {
    "english": {
        "morning": [r'\bgood\s*morning\b', r'\bgm\b'],
        "afternoon": [r'\bgood\s*afternoon\b'],
        "evening": [r'\bgood\s*evening\b', r'\bgood\s*night\b', r'\bgn\b'],
        "general": [r'\bhello\b', r'\bhi\s+everyone\b', r'\bhi\s+all\b', r'\bhey\s+everyone\b', r'\bhey\s+all\b', r'\bgreetings\b', r'\bhi\s+there\b', r'\bhey\s+there\b'],
    },
    "spanish": {
        "morning": [r'\bbuenos?\s*d[ií]as?\b'],
        "afternoon": [r'\bbuenas?\s*tardes?\b'],
        "evening": [r'\bbuenas?\s*noches?\b'],
        "general": [r'\bhola\s+a\s+todos\b', r'\bhola\b', r'\bsaludos\b'],
    },
    "arabic": {
        "morning": [r'\bصباح\s*الخير\b', r'\bصباح\s*النور\b'],
        "evening": [r'\bمساء\s*الخير\b', r'\bمساء\s*النور\b'],
        "general": [r'\bمرحبا\b', r'\bأهلا\b', r'\bسلام\s*عليكم\b', r'\bسلام\b', r'\bالسلام\s*عليكم\b'],
    },
    "indonesian": {
        "morning": [r'\bselamat\s*pagi\b'],
        "afternoon": [r'\bselamat\s*siang\b', r'\bselamat\s*sore\b'],
        "evening": [r'\bselamat\s*malam\b'],
        "general": [r'\bhalo\s+semua\b', r'\bhalo\b', r'\bhai\s+semua\b'],
    },
    "filipino": {
        "morning": [r'\bmagandang\s*umaga\b'],
        "afternoon": [r'\bmagandang\s*hapon\b', r'\bmagandang\s*tanghali\b'],
        "evening": [r'\bmagandang\s*gabi\b'],
        "general": [r'\bkamusta\b', r'\bmabuhay\b', r'\bkumusta\b'],
    },
    "vietnamese": {
        "morning": [r'\bchào\s+buổi\s+sáng\b', r'\bxin\s*ch[àa]o\s+buổi\s+sáng\b'],
        "evening": [r'\bchào\s+buổi\s+tối\b', r'\bxin\s*ch[àa]o\s+buổi\s+tối\b'],
        "general": [r'\bxin\s*ch[àa]o\b', r'\bchào\s+mọi\s+người\b', r'\bchào\b'],
    },
}

LANG_NEWCOMER_PATTERNS = {
    "english": [r"\bi[''`]?m\s+new\s+here\b", r'\bjust\s+joined\b', r'\bnew\s+member\b', r'\bnew\s+here\b', r'\bjust\s+started\b', r'\bfirst\s+time\s+here\b'],
    "spanish": [r'\bsoy\s+nuev[oa]\b', r'\bacabo\s+de\s+unirme\b', r'\bnuev[oa]\s+aqu[ií]\b'],
    "arabic": [r'\bعضو\s*جديد\b', r'\bانضممت\b', r'\bأنا\s+جديد\b'],
    "indonesian": [r'\bbaru\s+bergabung\b', r'\banggota\s+baru\b', r'\bbaru\s+di\s+sini\b'],
    "filipino": [r'\bbagong\s+kasali\b', r'\bbago\s+lang\s+ako\b', r'\bbagong\s+miyembro\b'],
    "vietnamese": [r'\bmới\s+tham\s+gia\b', r'\bthành\s+viên\s+mới\b', r'\bmới\s+vào\b'],
}

RESPONSES = {
    "english": {
        "morning": [
            "Good morning!", "Good morning everyone!", "Morning!",
            "Good morning, hope everyone has a great day!",
            "Morning! Let's make today count!", "GM everyone!",
            "Hey, good morning!", "Morning all!",
        ],
        "afternoon": [
            "Good afternoon!", "Good afternoon everyone!", "Afternoon!",
            "Good afternoon, hope the day is going well!",
            "Hey, good afternoon!", "Good afternoon all!",
        ],
        "evening": [
            "Good evening!", "Good evening everyone!", "Evening!",
            "Good evening, hope you had a great day!",
            "Hey, good evening!", "Good evening all!",
        ],
        "general": [
            "Hello!", "Hey!", "Hi there!", "Hello everyone!",
            "Hey, welcome!", "Hi!", "Greetings!", "Hello there!",
            "Hey! Great to see you!", "Hi everyone!",
        ],
        "newcomer": [
            "Welcome! You're going to love it here!",
            "Welcome to the group! Great to have you!",
            "Hey welcome! Feel free to ask any questions!",
            "Welcome! You made a great decision joining us!",
            "Welcome aboard! This community is amazing!",
            "Hey, welcome! Glad you're here!",
            "Welcome! Stick around, you'll love it!",
            "Welcome! You're in good hands here!",
        ],
    },
    "spanish": {
        "morning": [
            "¡Buenos días!", "¡Buenos días a todos!", "¡Buen día!",
            "¡Buenos días! Espero que tengan un gran día!",
            "Buenos días, ¡a darle con todo hoy!",
        ],
        "afternoon": [
            "¡Buenas tardes!", "¡Buenas tardes a todos!",
            "¡Buenas tardes! Espero que el día vaya bien!",
            "¡Hola, buenas tardes!",
        ],
        "evening": [
            "¡Buenas noches!", "¡Buenas noches a todos!",
            "¡Buenas noches! Espero que hayan tenido un buen día!",
            "¡Hola, buenas noches!",
        ],
        "general": [
            "¡Hola!", "¡Hola a todos!", "¡Saludos!",
            "¡Hola! ¿Cómo están?", "¡Hey, qué tal!",
            "¡Hola! Bienvenidos!",
        ],
        "newcomer": [
            "¡Bienvenido! ¡Te va a encantar esto!",
            "¡Bienvenido al grupo! ¡Qué bueno tenerte aquí!",
            "¡Hola, bienvenido! Pregunta lo que necesites!",
            "¡Bienvenido! Gran decisión unirte!",
            "¡Bienvenido! Esta comunidad es increíble!",
        ],
    },
    "arabic": {
        "morning": [
            "صباح الخير!", "صباح النور!", "صباح الخير للجميع!",
            "صباح الخير! يوم جميل للجميع إن شاء الله!",
            "صباح الورد!",
        ],
        "evening": [
            "مساء الخير!", "مساء النور!", "مساء الخير للجميع!",
            "مساء الخير! أتمنى لكم مساء جميل!",
        ],
        "general": [
            "مرحبا!", "أهلا وسهلا!", "السلام عليكم!",
            "أهلا بالجميع!", "مرحبا بكم!",
            "هلا!", "حياكم الله!",
        ],
        "newcomer": [
            "أهلا وسهلا! نورت المجموعة!",
            "مرحبا بك! سعيدين بانضمامك!",
            "أهلا! لا تتردد في السؤال عن أي شيء!",
            "حياك الله! قرار ممتاز إنك انضممت!",
            "مرحبا! المجتمع هنا رائع!",
        ],
    },
    "indonesian": {
        "morning": [
            "Selamat pagi!", "Selamat pagi semuanya!", "Pagi!",
            "Selamat pagi! Semoga harinya menyenangkan!",
            "Pagi semua! Semangat hari ini!",
        ],
        "afternoon": [
            "Selamat siang!", "Selamat siang semuanya!",
            "Selamat sore!", "Siang semua!",
        ],
        "evening": [
            "Selamat malam!", "Selamat malam semuanya!",
            "Malam! Semoga hari ini menyenangkan!",
        ],
        "general": [
            "Halo!", "Halo semua!", "Hai!",
            "Halo! Apa kabar?", "Hai semua!",
            "Halo semuanya!",
        ],
        "newcomer": [
            "Selamat datang! Pasti betah di sini!",
            "Selamat datang di grup! Senang ada kamu!",
            "Halo, selamat datang! Jangan ragu bertanya ya!",
            "Selamat datang! Keputusan yang tepat bergabung!",
            "Welcome! Komunitas di sini keren banget!",
        ],
    },
    "filipino": {
        "morning": [
            "Magandang umaga!", "Magandang umaga sa lahat!",
            "Magandang umaga! Sana maganda ang araw niyo!",
            "Good morning! Magandang umaga!",
        ],
        "afternoon": [
            "Magandang hapon!", "Magandang hapon sa lahat!",
            "Magandang tanghali!", "Hapon na! Kamusta kayo?",
        ],
        "evening": [
            "Magandang gabi!", "Magandang gabi sa lahat!",
            "Magandang gabi! Sana maganda ang gabi niyo!",
        ],
        "general": [
            "Kamusta!", "Mabuhay!", "Kamusta kayong lahat!",
            "Hello! Kamusta?", "Hey! Mabuhay!",
        ],
        "newcomer": [
            "Welcome! Magugustuhan mo dito!",
            "Welcome sa grupo! Masaya kaming nandito ka!",
            "Hey welcome! Magtanong lang kung may kailangan!",
            "Welcome! Magandang desisyon na sumali ka!",
            "Mabuhay! Ang galing ng community na ito!",
        ],
    },
    "vietnamese": {
        "morning": [
            "Chào buổi sáng!", "Chào buổi sáng mọi người!",
            "Chào buổi sáng! Chúc mọi người ngày tốt lành!",
        ],
        "evening": [
            "Chào buổi tối!", "Chào buổi tối mọi người!",
            "Chào buổi tối! Chúc mọi người buổi tối vui vẻ!",
        ],
        "general": [
            "Xin chào!", "Chào mọi người!", "Xin chào tất cả!",
            "Chào! Mọi người khỏe không?", "Hello! Xin chào!",
        ],
        "newcomer": [
            "Chào mừng! Bạn sẽ thích ở đây!",
            "Chào mừng đến nhóm! Rất vui có bạn!",
            "Xin chào, chào mừng! Cứ hỏi nếu cần nhé!",
            "Chào mừng! Quyết định tuyệt vời khi tham gia!",
            "Chào mừng! Cộng đồng ở đây rất tuyệt!",
        ],
    },
}

PROFESSOR_RESPONSES = [
    "Good day professor!",
    "Welcome professor!",
    "Good morning professor!",
    "Hello professor, great to see you!",
    "Greetings professor!",
    "Welcome back professor!",
    "Good to see you professor!",
    "Hey professor! Welcome!",
    "Good day to you professor!",
    "Welcome professor, always a pleasure!",
    "Hello professor, hope you're doing well!",
    "Good evening professor!",
    "Hi professor! Glad you're here!",
    "Professor! Welcome!",
    "Great to have you here professor!",
    "Good afternoon professor!",
    "Welcome professor, we're glad to have you!",
    "Hey professor, good to see you again!",
]

last_responders = []

def classify_message(text):
    text_lower = text.lower().strip()
    if len(text_lower) > 200:
        return None, None

    for lang, patterns in LANG_NEWCOMER_PATTERNS.items():
        for pat in patterns:
            if re.search(pat, text_lower, re.IGNORECASE):
                return "newcomer", lang

    for lang, time_groups in LANG_GREETING_PATTERNS.items():
        for time_of_day, patterns in time_groups.items():
            for pat in patterns:
                if re.search(pat, text_lower, re.IGNORECASE):
                    return time_of_day, lang

    return None, None

def get_response(msg_type, lang):
    lang_responses = RESPONSES.get(lang, RESPONSES["english"])
    pool = lang_responses.get(msg_type)
    if not pool:
        if msg_type in ("afternoon",) and lang in ("arabic", "vietnamese"):
            pool = lang_responses.get("evening", lang_responses.get("general"))
        else:
            pool = lang_responses.get("general")
    if not pool:
        pool = RESPONSES["english"].get(msg_type, RESPONSES["english"]["general"])
    return random.choice(pool)

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

    if len(bots_data) == 0:
        print(json.dumps({"type": "error", "msg": "No bots provided"}), flush=True)
        return

    listener_client = None
    connected_bot_index = -1

    for i, bot in enumerate(bots_data):
        try:
            client = TelegramClient(
                StringSession(bot["session"]),
                int(bot["apiId"]),
                bot["apiHash"]
            )
            await client.connect()
            if not await client.is_user_authorized():
                print(json.dumps({"type": "log", "msg": f"Bot {i+1} not authorized, trying next..."}), flush=True)
                await client.disconnect()
                continue
            me = await client.get_me()
            print(json.dumps({"type": "log", "msg": f"Bot {i+1} ({me.first_name}) connected as listener"}), flush=True)
            listener_client = client
            connected_bot_index = i
            break
        except Exception as e:
            err_msg = str(e)
            print(json.dumps({"type": "log", "msg": f"Bot {i+1} connection failed: {err_msg}, trying next..."}), flush=True)
            try:
                await client.disconnect()
            except:
                pass
            continue

    if listener_client is None:
        print(json.dumps({"type": "error", "msg": "All bots failed to connect. Exiting."}), flush=True)
        sys.exit(1)

    clients = [listener_client]
    bot_indices = [connected_bot_index]
    bot_label = f"Bot {connected_bot_index + 1}"

    group_entities = {}
    for gid_str in group_ids:
        try:
            target_id = int(gid_str)
            if target_id < -1000000000000:
                channel_id = abs(target_id) - 1000000000000
                entity = await listener_client.get_entity(PeerChannel(channel_id))
            else:
                entity = await listener_client.get_entity(target_id)
            group_entities[gid_str] = entity
            print(json.dumps({"type": "log", "msg": f"Resolved group {gid_str} -> {getattr(entity, 'title', 'unknown')}"}), flush=True)
        except Exception as e:
            print(json.dumps({"type": "error", "msg": f"Failed to resolve group {gid_str}: {str(e)}"}), flush=True)

    if len(group_entities) == 0:
        print(json.dumps({"type": "error", "msg": "Could not resolve any monitored groups. Exiting."}), flush=True)
        for c in clients:
            await c.disconnect()
        sys.exit(1)

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

            full_name_check = f"{sender.first_name or ''} {sender.last_name or ''}".strip()
            is_knox_early = full_name_check.lower() in ("knox derek", "knoxderek", "knox")

            msg_type, lang = classify_message(text)
            if not msg_type or not lang:
                if is_knox_early:
                    msg_type = "general"
                    lang = "english"
                else:
                    return

            cooldown_key = f"{chat.id}_{msg_type}"
            now = time.time()
            if cooldown_key in cooldowns and (now - cooldowns[cooldown_key]) < COOLDOWN_SECONDS:
                return
            cooldowns[cooldown_key] = now

            chat_id_str = None
            for gid_str, entity in group_entities.items():
                if entity.id == chat.id:
                    chat_id_str = gid_str
                    break

            sender_name = sender.first_name or "Someone"
            full_name = f"{sender.first_name or ''} {sender.last_name or ''}".strip()
            is_knox = full_name.lower() in ("knox derek", "knoxderek", "knox")

            print(json.dumps({
                "type": "greeting_detected",
                "msg": f"{sender_name} said '{text[:50]}' ({msg_type}/{lang}) in chat {chat.id}" + (" [KNOX/PROFESSOR]" if is_knox else ""),
                "chatId": chat_id_str,
                "msgType": msg_type,
                "lang": lang,
                "isKnox": is_knox,
            }), flush=True)

            delay = random.randint(15, 45)
            await asyncio.sleep(delay)

            if is_knox:
                professor_response = random.choice(PROFESSOR_RESPONSES)
                try:
                    await listener_client.send_message(group_entities[chat_id_str], professor_response)
                    print(json.dumps({
                        "type": "greeting_sent",
                        "msg": f"{bot_label} replied '{professor_response}' (professor) in chat {chat.id}",
                        "botIndex": connected_bot_index,
                        "response": professor_response,
                        "chatId": chat_id_str,
                    }), flush=True)
                except Exception as e:
                    print(json.dumps({
                        "type": "error",
                        "msg": f"{bot_label} failed to respond to professor: {str(e)}",
                    }), flush=True)

                print(json.dumps({
                    "type": "dispatch_professor_responses",
                    "chatId": chat_id_str,
                }), flush=True)
            else:
                response = get_response(msg_type, lang)
                try:
                    await listener_client.send_message(group_entities[chat_id_str], response)
                    print(json.dumps({
                        "type": "greeting_sent",
                        "msg": f"{bot_label} replied '{response}' ({lang}) in chat {chat.id}",
                        "botIndex": connected_bot_index,
                        "response": response,
                        "chatId": chat_id_str,
                    }), flush=True)
                except Exception as e:
                    print(json.dumps({
                        "type": "error",
                        "msg": f"{bot_label} failed to respond: {str(e)}",
                    }), flush=True)

                extra_responses = []
                for _ in range(random.randint(1, 3)):
                    extra_responses.append(get_response(msg_type, lang))

                print(json.dumps({
                    "type": "dispatch_extra_responses",
                    "chatId": chat_id_str,
                    "msgType": msg_type,
                    "lang": lang,
                    "responses": extra_responses,
                }), flush=True)

        except Exception as e:
            print(json.dumps({"type": "error", "msg": f"Handler error: {str(e)}"}), flush=True)

    print(json.dumps({"type": "started", "msg": f"Greeting listener active with {bot_label} monitoring {len(group_entities)} groups"}), flush=True)

    try:
        await listener_client.run_until_disconnected()
    finally:
        try:
            await listener_client.disconnect()
        except:
            pass

if __name__ == "__main__":
    asyncio.run(main())
