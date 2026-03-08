import sys
import json
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession

async def send_message(session_string, api_id, api_hash, chat_id, message):
    client = TelegramClient(StringSession(session_string), int(api_id), api_hash)
    await client.connect()
    
    if not await client.is_user_authorized():
        print(json.dumps({"success": False, "error": "Session not authorized"}))
        await client.disconnect()
        return
    
    entity = await client.get_entity(int(chat_id))
    await client.send_message(entity, message)
    
    new_session = client.session.save()
    await client.disconnect()
    print(json.dumps({"success": True, "session": new_session}))

async def login_request_code(api_id, api_hash, phone):
    client = TelegramClient(StringSession(), int(api_id), api_hash)
    await client.connect()
    result = await client.send_code_request(phone)
    session = client.session.save()
    print(json.dumps({
        "success": True,
        "session": session,
        "phoneCodeHash": result.phone_code_hash,
    }))

async def login_verify_code(session_string, api_id, api_hash, phone, code, phone_code_hash, password=None):
    client = TelegramClient(StringSession(session_string), int(api_id), api_hash)
    await client.connect()
    
    try:
        await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
    except Exception as e:
        if "Two-steps verification" in str(e) or "2FA" in str(e) or "password" in str(e).lower():
            if not password:
                print(json.dumps({"success": False, "needsPassword": True, "error": "2FA password required", "session": client.session.save()}))
                await client.disconnect()
                return
            await client.sign_in(password=password)
        else:
            print(json.dumps({"success": False, "error": str(e)}))
            await client.disconnect()
            return
    
    new_session = client.session.save()
    await client.disconnect()
    print(json.dumps({"success": True, "session": new_session}))

if __name__ == "__main__":
    action = sys.argv[1]
    
    if action == "send":
        session_string = sys.argv[2]
        api_id = sys.argv[3]
        api_hash = sys.argv[4]
        chat_id = sys.argv[5]
        message = sys.argv[6]
        asyncio.run(send_message(session_string, api_id, api_hash, chat_id, message))
    
    elif action == "request_code":
        api_id = sys.argv[2]
        api_hash = sys.argv[3]
        phone = sys.argv[4]
        asyncio.run(login_request_code(api_id, api_hash, phone))
    
    elif action == "verify_code":
        session_string = sys.argv[2]
        api_id = sys.argv[3]
        api_hash = sys.argv[4]
        phone = sys.argv[5]
        code = sys.argv[6]
        phone_code_hash = sys.argv[7]
        password = sys.argv[8] if len(sys.argv) > 8 else None
        asyncio.run(login_verify_code(session_string, api_id, api_hash, phone, code, phone_code_hash, password))
