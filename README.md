# Discord Music Bot

A modern Discord music bot built with JavaScript using discord.js v14, @discordjs/voice, and ytdl-core.

## Features

- Play music from YouTube links in voice channels
- Simple command: `!play <YouTube URL>`

## Setup

1. **Clone or download this repository.**
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Create a Discord bot and get your token:**
   - Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application and add a bot
   - Copy the bot token
4. **Edit `index.js`:**
   - Replace `YOUR_BOT_TOKEN_HERE` with your actual bot token
5. **Invite the bot to your server:**
   - Use the OAuth2 URL Generator in the Developer Portal
   - Select `bot` and `applications.commands` scopes
   - Give the bot permissions for `Send Messages`, `Connect`, and `Speak`
6. **Run the bot:**
   ```bash
   node index.js
   ```

## Usage

- Join a voice channel
- Type `!play <YouTube URL>` in a text channel

## Requirements

- Node.js v16.9.0 or higher

## Notes

- This bot plays audio from YouTube links only.
- Make sure FFmpeg is included (ffmpeg-static is used).
