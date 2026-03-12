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
    
    try:
        dialogs = await client.get_dialogs()
        
        target_id = int(chat_id)
        entity = None
        for dialog in dialogs:
            if dialog.entity and hasattr(dialog.entity, 'id'):
                eid = dialog.entity.id
                if hasattr(dialog.entity, 'megagroup') or hasattr(dialog.entity, 'broadcast'):
                    full_id = -1000000000000 - eid
                else:
                    full_id = -eid
                if full_id == target_id:
                    entity = dialog.entity
                    break
        
        if entity is None:
            print(json.dumps({"success": False, "error": f"Could not find group {chat_id} in dialogs"}))
            await client.disconnect()
            return
        
        await client.send_message(entity, message)
        new_session = client.session.save()
        await client.disconnect()
        print(json.dumps({"success": True, "session": new_session}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        await client.disconnect()

async def login_request_code(api_id, api_hash, phone):
    client = TelegramClient(StringSession(), int(api_id), api_hash)
    await client.connect()
    result = await client.send_code_request(phone)
    session = client.session.save()
    await client.disconnect()
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
        err_str = str(e)
        if "Two-steps verification" in err_str or "2FA" in err_str or "password" in err_str.lower() or "SessionPasswordNeeded" in type(e).__name__:
            if not password:
                session_save = client.session.save()
                await client.disconnect()
                print(json.dumps({"success": False, "needsPassword": True, "error": "2FA password required", "session": session_save}))
                return
            try:
                await client.sign_in(password=password)
            except Exception as e2:
                print(json.dumps({"success": False, "error": str(e2)}))
                await client.disconnect()
                return
        else:
            print(json.dumps({"success": False, "error": err_str}))
            await client.disconnect()
            return
    
    try:
        await client.get_dialogs()
    except:
        pass
    
    new_session = client.session.save()
    await client.disconnect()
    print(json.dumps({"success": True, "session": new_session}))

async def check_session(session_string, api_id, api_hash):
    client = TelegramClient(StringSession(session_string), int(api_id), api_hash)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            print(json.dumps({"success": False, "error": "Session not authorized"}))
            await client.disconnect()
            return
        me = await client.get_me()
        await client.disconnect()
        print(json.dumps({"success": True, "userName": me.first_name or str(me.id)}))
    except Exception as e:
        try:
            await client.disconnect()
        except:
            pass
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    action = sys.argv[1]
    
    if action == "check_session":
        session_string = sys.argv[2]
        api_id = sys.argv[3]
        api_hash = sys.argv[4]
        asyncio.run(check_session(session_string, api_id, api_hash))

    elif action == "send":
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
