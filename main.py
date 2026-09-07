import asyncio
import json
import logging
import os
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import List, Optional, Dict

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.error import Conflict
from telegram.ext import ApplicationBuilder, CommandHandler
from telethon import TelegramClient

load_dotenv()

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
APP_URL = os.getenv("APP_URL", "http://localhost:5000")
PORT = int(os.getenv("PORT", "5000"))
API_ID = os.getenv("API_ID", "")
API_HASH = os.getenv("API_HASH", "")
SESSION_NAME = os.getenv("SESSION_NAME", "my_reminder_session")
JOB_FILE = Path("jobs.json")
UPLOAD_DIR = Path("uploads")
BOT_LOCK_FILE = Path('.bot.lock')

app = Flask(__name__, template_folder="web/templates", static_folder="web/static")


def is_image_file(path: Path) -> bool:
    return path.suffix.lower() in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}


async def get_user_client() -> TelegramClient:
    client = TelegramClient(SESSION_NAME, int(API_ID), API_HASH)
    await client.start()
    return client


def ensure_dirs() -> None:
    UPLOAD_DIR.mkdir(exist_ok=True)
    if not JOB_FILE.exists():
        JOB_FILE.write_text("[]", encoding="utf-8")


def load_all_jobs() -> List[Dict]:
    ensure_dirs()
    try:
        data = json.loads(JOB_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        logging.warning("jobs.json is malformed, returning empty list")
        return []


def cleanup_completed_jobs() -> None:
    all_jobs = load_all_jobs()
    active_jobs = [job for job in all_jobs if job.get("status") == "active"]
    save_jobs(active_jobs)


def load_jobs() -> list:
    ensure_dirs()
    try:
        data = json.loads(JOB_FILE.read_text(encoding="utf-8"))
        jobs = data if isinstance(data, list) else []
        return [job for job in jobs if job.get("status") == "active"]
    except json.JSONDecodeError:
        return []


def save_jobs(jobs: List[Dict]) -> None:
    # atomic write to avoid truncation/corruption
    temp = JOB_FILE.with_suffix('.tmp')
    temp.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        temp.replace(JOB_FILE)
    except Exception:
        # fallback to overwrite
        JOB_FILE.write_text(json.dumps(jobs, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_target(value: str) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    text = text.replace("@", "")
    if text.startswith("https://t.me/"):
        text = text.split("https://t.me/")[-1].replace("/", "")
    elif text.startswith("http://t.me/"):
        text = text.split("http://t.me/")[-1].replace("/", "")
    elif text.startswith("t.me/"):
        text = text.replace("t.me/", "")
    return text.strip()


def parse_targets(raw_targets) -> list[str]:
    if raw_targets is None:
        return []

    if isinstance(raw_targets, list):
        items = raw_targets
    elif isinstance(raw_targets, str):
        text = raw_targets.strip()
        if not text:
            return []
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                items = parsed
            else:
                items = [parsed]
        except json.JSONDecodeError:
            items = [item.strip() for item in text.replace("\n", ",").split(",") if item.strip()]
    else:
        items = [str(raw_targets)]

    result: list[str] = []
    for item in items:
        normalized = normalize_target(str(item))
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def is_media_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return (
        "cannot send" in text
        or "this chat" in text
        or "not supported" in text
        or "photo" in text
        or "media" in text
    )


async def send_via_telethon(client: TelegramClient, target: str, message: str, file_paths: List[str]) -> None:
    """Send message/files using an already-started Telethon client."""
    entity = await client.get_entity(target)

    if file_paths:
        for index, file_path in enumerate(file_paths):
            path = Path(file_path)
            if not path.exists():
                continue

            try:
                if index == 0 and message:
                    if is_image_file(path):
                        await client.send_file(entity, file=str(path), caption=message, force_document=False)
                    else:
                        await client.send_file(entity, file=str(path), caption=message, force_document=True)
                    continue

                if is_image_file(path):
                    await client.send_file(entity, file=str(path), force_document=False)
                else:
                    await client.send_file(entity, file=str(path), force_document=True)
            except Exception as exc:
                if is_media_error(exc):
                    if message:
                        try:
                            await client.send_message(entity, message)
                        except Exception:
                            logging.exception("Failed to fallback-send text to %s", target)
                    logging.warning("File to %s failed: %s — sent text only.", target, exc)
                    return
                raise
        return

    await client.send_message(entity, message)


def remove_job_by_id(job_id: str) -> None:
    all_jobs = load_all_jobs()
    updated = [job for job in all_jobs if job.get("id") != job_id]
    save_jobs(updated)


def job_exists(job_id: str) -> bool:
    """Проверить, существует ли напоминание в файле"""
    all_jobs = load_all_jobs()
    return any(job.get("id") == job_id for job in all_jobs)


def run_job(job: dict) -> None:
    targets = job.get("targets") or [job.get("target")]
    message = (job.get("message") or "").strip()
    file_paths = job.get("file_paths") or []
    interval_seconds = max(int(job.get("interval_seconds") or 60), 1)
    repeat_count = max(int(job.get("repeat_count") or 1), 1)
    between_users_seconds = max(int(job.get("recipient_interval_seconds") or 0), 0)
    job_id = job.get("id")

    try:
        async def _run_loop():
            client = await get_user_client()
            try:
                for cycle_index in range(repeat_count):
                    if not job_exists(job_id):
                        logging.info("Job %s cancelled, stopping.", job_id)
                        return

                    for index, target in enumerate(targets):
                        if not target:
                            continue
                        if not job_exists(job_id):
                            return
                        try:
                            await send_via_telethon(client, target, message, file_paths)
                        except Exception as exc:
                            logging.exception("Error sending to %s: %s", target, exc)
                        if between_users_seconds > 0 and index < len(targets) - 1:
                            await asyncio.sleep(between_users_seconds)

                    if cycle_index + 1 < repeat_count:
                        await asyncio.sleep(interval_seconds)
            finally:
                await client.disconnect()

        asyncio.run(_run_loop())
    except Exception as exc:
        logging.exception("Error while running job %s: %s", job_id, exc)
    finally:
        if job_id and job_exists(job_id):
            remove_job_by_id(job_id)


def create_job(payload: dict, uploaded_files: list[str] | None = None) -> dict:
    raw_targets = payload.get("targets")
    if raw_targets is None:
        raw_targets = payload.get("target", "")

    targets = parse_targets(raw_targets)
    message = (payload.get("message") or "").strip()
    interval_seconds = int(payload.get("interval_seconds") or 60)
    repeat_count = int(payload.get("repeat_count") or 1)
    recipient_interval_seconds = int(payload.get("recipient_interval_seconds") or 0)

    if not targets:
        raise ValueError("Не указан получатель: username, chat_id или ссылка.")
    if not message:
        raise ValueError("Текст сообщения не может быть пустым.")

    files = uploaded_files or []

    job = {
        "id": uuid.uuid4().hex,
        "targets": targets,
        "message": message,
        "interval_seconds": max(interval_seconds, 1),
        "repeat_count": max(repeat_count, 1),
        "recipient_interval_seconds": max(recipient_interval_seconds, 0),
        "file_paths": files,
        "status": "active",
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    jobs = load_jobs()
    jobs.append(job)
    save_jobs(jobs)

    thread = threading.Thread(target=run_job, args=(job,), daemon=True)
    thread.start()

    return job


async def start_command(update, context):
    if not BOT_TOKEN:
        await update.message.reply_text("Сначала заполните BOT_TOKEN в .env")
        return

    app_url = APP_URL.rstrip("/")
    keyboard = [[InlineKeyboardButton("Open Mini App", web_app=WebAppInfo(url=app_url))]]
    await update.message.reply_text(
        "Мини-приложение открыто. Укажите получателя, текст и интервал отправки.",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def help_command(update, context):
    help_text = (
        "Команды:\n"
        "/start — открыть мини-приложение\n"
        "/help — помощь\n"
        "/jobs — показать активные напоминания"
    )
    await update.message.reply_text(help_text)


async def jobs_command(update, context):
    jobs = load_jobs()
    if not jobs:
        await update.message.reply_text("Активных напоминаний пока нет.")
        return

    lines = ["Список напоминаний:"]
    for job in jobs:
        targets = ", ".join(job.get("targets") or [job.get("target")])
        lines.append(f"- {targets} | {job['interval_seconds']}s | {job['repeat_count']}x | {job['created_at']}")
    await update.message.reply_text("\n".join(lines))


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify({"ok": True, "status": "running"})


@app.route("/api/jobs")
def api_jobs():
    return jsonify({"ok": True, "jobs": load_jobs()})


@app.route("/api/cancel-job", methods=["POST"])
def api_cancel_job():
    try:
        job_id = request.json.get("job_id") if request.is_json else request.form.get("job_id")
        if not job_id:
            return jsonify({"ok": False, "error": "job_id не указан"}), 400
        
        remove_job_by_id(job_id)
        return jsonify({"ok": True, "message": "Напоминание отменено"}), 200
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Ошибка отмены: {exc}"}), 500


@app.route("/api/create-reminder", methods=["POST"])
def api_create_reminder():
    try:
        raw_targets = request.form.get("targets")
        if raw_targets:
            targets = parse_targets(raw_targets)
        else:
            target = (request.form.get("target") or "").strip()
            targets = parse_targets(target)

        message = (request.form.get("message") or "").strip()
        interval_seconds = int(request.form.get("interval_seconds") or 60)
        repeat_count = int(request.form.get("repeat_count") or 1)
        recipient_interval_seconds = int(request.form.get("recipient_interval_seconds") or 0)

        uploaded_files = []
        for file in request.files.getlist("files"):
            if not file.filename:
                continue
            safe_name = Path(file.filename).name
            target_path = UPLOAD_DIR / f"{uuid.uuid4()}_{safe_name}"
            file.save(target_path)
            uploaded_files.append(str(target_path))

        payload = {
            "targets": targets,
            "message": message,
            "interval_seconds": interval_seconds,
            "repeat_count": repeat_count,
            "recipient_interval_seconds": recipient_interval_seconds,
        }

        job = create_job(payload, uploaded_files)
        return jsonify({"ok": True, "job": job}), 201
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"ok": False, "error": f"Не удалось создать напоминание: {exc}"}), 500


def acquire_bot_lock() -> int | None:
    try:
        return os.open(BOT_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_RDWR)
    except FileExistsError:
        logging.warning("Бот уже запущен в другом процессе; пропускаю повторный запуск polling.")
        return None


def release_bot_lock(lock_fd: int | None) -> None:
    if lock_fd is None:
        return
    try:
        os.close(lock_fd)
    except OSError:
        pass
    try:
        BOT_LOCK_FILE.unlink()
    except FileNotFoundError:
        pass


async def handle_telegram_error(update, context):
    exc = context.error
    if isinstance(exc, Conflict):
        logging.warning("Telegram Conflict: another getUpdates request is already active. Ignoring this duplicate poller.")
        return
    logging.exception("Unhandled Telegram update error: %s", exc)


def run_bot() -> None:
    if not BOT_TOKEN:
        print("BOT_TOKEN отсутствует. Заполните .env перед запуском бота.")
        return

    lock_fd = acquire_bot_lock()
    if lock_fd is None:
        return

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        application = ApplicationBuilder().token(BOT_TOKEN).build()
        application.add_handler(CommandHandler("start", start_command))
        application.add_handler(CommandHandler("help", help_command))
        application.add_handler(CommandHandler("jobs", jobs_command))
        application.add_error_handler(handle_telegram_error)
        application.run_polling(drop_pending_updates=True)
    except Conflict:
        logging.warning("Telegram polling conflict detected; another bot instance already owns the updates stream.")
    except Exception:
        logging.exception("Fatal bot startup error")
    finally:
        release_bot_lock(lock_fd)


async def login_account() -> None:
    if not API_ID or not API_HASH:
        raise RuntimeError("API_ID и API_HASH должны быть заполнены в .env")

    client = TelegramClient(SESSION_NAME, int(API_ID), API_HASH)
    await client.start()
    me = await client.get_me()
    print(f"Успешная авторизация: {me.first_name} (@{me.username})")
    await client.disconnect()


if __name__ == "__main__":
    ensure_dirs()
    cleanup_completed_jobs()

    if "--login" in sys.argv:
        asyncio.run(login_account())
        sys.exit(0)

    if BOT_TOKEN:
        threading.Thread(target=run_bot, daemon=True).start()

    app.run(host="0.0.0.0", port=PORT, debug=False)