import sys
import json
import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.types import PeerChannel

async def send_message(session_string, api_id, api_hash, chat_id, message, reply_to_msg_id=None):
    client = TelegramClient(StringSession(session_string), int(api_id), api_hash)
    await client.connect()
    
    if not await client.is_user_authorized():
        print(json.dumps({"success": False, "error": "Session not authorized"}))
        await client.disconnect()
        return
    
    try:
        target_id = int(chat_id)
        if target_id < -1000000000000:
            channel_id = abs(target_id) - 1000000000000
            entity = await client.get_entity(PeerChannel(channel_id))
        else:
            entity = await client.get_entity(target_id)
        
        reply_to = int(reply_to_msg_id) if reply_to_msg_id else None
        sent = await client.send_message(entity, message, reply_to=reply_to)
        new_session = client.session.save()
        await client.disconnect()
        print(json.dumps({"success": True, "session": new_session, "messageId": sent.id}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        try:
            await client.disconnect()
        except:
            pass

async def login_request_code(api_id, api_hash, phone):
    client = TelegramClient(StringSession(), int(api_id), api_hash)
    try:
        await client.connect()
        result = await client.send_code_request(phone)
        session = client.session.save()
        await client.disconnect()
        print(json.dumps({
            "success": True,
            "session": session,
            "phoneCodeHash": result.phone_code_hash,
        }))
    except Exception as e:
        try:
            await client.disconnect()
        except:
            pass
        print(json.dumps({"success": False, "error": str(e)}))

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

async def send_photo(session_string, api_id, api_hash, chat_id, photo_url, caption=""):
    import tempfile
    import urllib.request
    import os

    client = TelegramClient(StringSession(session_string), int(api_id), api_hash)
    await client.connect()
    
    if not await client.is_user_authorized():
        print(json.dumps({"success": False, "error": "Session not authorized"}))
        await client.disconnect()
        return
    
    tmp_path = None
    try:
        target_id = int(chat_id)
        if target_id < -1000000000000:
            channel_id = abs(target_id) - 1000000000000
            entity = await client.get_entity(PeerChannel(channel_id))
        else:
            entity = await client.get_entity(target_id)
        
        is_local = not photo_url.startswith("http://") and not photo_url.startswith("https://")
        if is_local:
            file_to_send = photo_url
        else:
            tmp_fd, tmp_path = tempfile.mkstemp(suffix=".jpg")
            os.close(tmp_fd)
            req = urllib.request.Request(photo_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                with open(tmp_path, "wb") as f:
                    f.write(resp.read())
            file_to_send = tmp_path

        await client.send_file(entity, file_to_send, caption=caption)
        new_session = client.session.save()
        await client.disconnect()
        print(json.dumps({"success": True, "session": new_session}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        try:
            await client.disconnect()
        except:
            pass
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except:
                pass

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
        reply_to = sys.argv[7] if len(sys.argv) > 7 else None
        asyncio.run(send_message(session_string, api_id, api_hash, chat_id, message, reply_to))
    
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
    
    elif action == "send_photo":
        session_string = sys.argv[2]
        api_id = sys.argv[3]
        api_hash = sys.argv[4]
        chat_id = sys.argv[5]
        photo_url = sys.argv[6]
        caption = sys.argv[7] if len(sys.argv) > 7 else ""
        asyncio.run(send_photo(session_string, api_id, api_hash, chat_id, photo_url, caption))
