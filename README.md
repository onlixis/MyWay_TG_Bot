# Reminder Bot + Mini App + Personal Telegram Account

This project provides a small web mini-app and a Telegram bot that together let you
schedule reminders which are sent from your personal Telegram account using Telethon.

## Features

- Choose recipient by username, chat id or a t.me link
- Specify the message text
- Set a send interval
- Configure the number of repeats
- Attach one or more files
- Send messages from your personal account via Telethon

## How it works

1. Open the bot in Telegram.
2. Press the **Open Mini App** button.
3. In the mini-app you provide:
   - who to message
   - what text to send
   - the interval between repeats
   - how many repeats
   - which files to attach
4. The bot forwards the data to the server.
5. The server uses Telethon to send the messages from your account.

## Project structure

- `main.py` — Flask server + Telegram bot + Telethon-based sender
- `web/templates/index.html` — mini-app UI
- `web/static/style.css` — minimal CSS
- `.env.example` — example configuration (kept in the repo)
- `requirements.txt` — Python dependencies
- `jobs.json` — stored reminders

## Installation

1. Create a virtual environment:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Install dependencies:

```powershell
py -m pip install -r requirements.txt
```

3. Create an `.env` file from the example:

```powershell
copy .env.example .env
```

4. Fill in `.env` with your values.


## How to get `API_ID` and `API_HASH`

1. Visit https://my.telegram.org
2. Log in with your Telegram account
3. Open **API development tools**
4. Create an application
5. Copy the `api_id` and `api_hash`

## Getting a Telegram Bot Token

1. Open Telegram
2. Start a chat with `@BotFather`
3. Run `/newbot`
4. Copy the returned token and add it to your `.env`

## Authorizing your account (Telethon)

To send messages from your personal account you need to authorize Telethon once. The bot itself
only needs a `BOT_TOKEN` to run commands and show the mini-app.

Run the one-time login flow:

```powershell
py main.py --login
```

Follow the prompted sign-in steps and confirm the code. The session will be saved locally.

## Running the app

```powershell
py main.py
```

After startup:

- The Telegram bot will be running
- The Flask mini-app is available at:

```text
http://localhost:5000
```

For a Telegram Mini App you typically need a public HTTPS URL — using `ngrok` works well:

```powershell
ngrok http 5000
```

Then set `APP_URL` to the generated HTTPS address, e.g.:

```dotenv
APP_URL=https://abc123.ngrok-free.app
```

## Usage

1. Send `/start` to the bot in Telegram
2. Click **Open Mini App**
3. Fill the fields:
   - recipient
   - message
   - interval in seconds
   - number of repeats
   - files
4. Click **Create reminder**
5. The message will be sent from your Telegram account via Telethon on the configured schedule

## Important note

This project is a hybrid system:

- The bot provides the UI and commands
- Telethon is used to send messages from your personal account

When you create a reminder in the mini-app you are scheduling your personal account (via Telethon)
to send the message later — you are not sending a bot message.

## Bot commands

- `/start` — open the mini-app
- `/help` — show help
- `/jobs` — list active reminders

## Limitations and recommendations

- Files must be accessible on disk for your account to send them via Telethon
- In production consider storing uploads in a dedicated folder and adding robust logging
- For Telegram Mini Apps use HTTPS and a stable public domain

## Server restart behavior

- On startup the server will now restore and start any `active` jobs found in `jobs.json`.
- If the process is stopped and restarted, previously scheduled active reminders will resume automatically.
- Note: jobs that were running when the process stopped may resume mid-cycle; long intervals keep the Telethon client connected between sends and network interruptions may still occur. If a connection fails, the job will log the error and attempt no automatic reconnection beyond Telethon's own behavior.

Recommendation: for production use consider adding monitoring and persistent worker supervisors (systemd, docker restart policies, or a process manager) to keep the service running and ensure reminders continue on restarts.

---

If you want, I can also add a short English usage section to the front page of the mini-app or
expand the README with troubleshooting steps (e.g., how to resolve session conflicts, how to
clear `.bot.lock`, and how to remove sensitive data from git history).
