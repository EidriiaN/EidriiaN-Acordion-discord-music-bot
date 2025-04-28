# EidriiaN-Acordion-discord-music-bot

A straightforward Discord bot designed to play music from YouTube in your voice channels using traditional prefix commands (e.g., `!play`). It features a queue system, playback controls, interactive messages, and automatic cleanup.

## Features

- Plays audio from YouTube URLs or search queries.
- Song queue system.
- Playback controls: Pause, Resume, Skip, Stop/Leave.
- Volume control (`!volume`).
- Looping modes: Off, Single Track, Full Queue (`!loop`).
- Queue management: Shuffle, Remove specific track, Clear queue.
- Displays current queue with interactive pagination buttons (`!queue`).
- Shows the currently playing song with interactive control buttons (`!nowplaying`).
- Simple help command (`!help`).
- Automatically leaves the voice channel when empty or inactive for a set period.
- Uses embeds for a cleaner user interface.

## Prerequisites

Before you begin, ensure you have the following installed and set up:

1.  **[Node.js](https://nodejs.org/)**: Version 16.9.0 or higher is recommended (LTS versions like v18 or v20 are ideal).
2.  **[npm](https://www.npmjs.com/)** (Node Package Manager): Usually comes bundled with Node.js. You can use `yarn` as an alternative.
3.  **Discord Bot Account**:
    - Create a new application on the [Discord Developer Portal](https://discord.com/developers/applications).
    - Create a Bot user within the application.
    - Note down the **Bot Token** (Keep this secret!).
    - Note down the **Client ID** (found on the "General Information" page).

## Installation & Setup

1.  **Get the Code:** Place the `index.js` and `package.json` files in a dedicated directory for your bot (e.g., `EidriiaN-Acordion-discord-music-bot`).

2.  **Install Dependencies:** Open your terminal or command prompt in the bot's project directory and run:

    ```bash
    npm install
    ```

    _This command reads the `package.json` file and downloads all the required libraries (discord.js, @discordjs/voice, ytdl-core, etc.) into a `node_modules` folder._

3.  **Configure the Bot:**
    - Create a file named `.env` in the root directory of the project.
    - Add your bot token to this file:
      ```env
      # .env file
      TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE
      ```
    - (Optional) You can also set a custom command prefix in the `.env` file. If not set, it defaults to `!`.
      ```env
      # Optional: Change the default '!' prefix
      # PREFIX=?
      ```
    - **Important:** Replace `YOUR_DISCORD_BOT_TOKEN_HERE` with the actual token you got from the Discord Developer Portal. **Never share your token!**

## Running the Bot

Once installation and configuration are complete, you can start the bot using:

```bash
npm start
```

If everything is set up correctly, you should see a message in your console like `🚀 Logged in as YourBotName#1234`.

## Usage

1.  **Invite the Bot:** You need to invite the bot to your Discord server. Use a tool like the [Discord Permissions Calculator](https://discordapi.com/permissions.html) or manually generate an invite link. You'll need your bot's **Client ID**.

    - **Required Permissions:** Ensure the bot has the following permissions in the channels you want it to operate in:
      - `View Channel`
      - `Send Messages`
      - `Embed Links`
      - `Connect` (Voice)
      - `Speak` (Voice)
      - `Read Message History` (Needed for button interactions to work reliably)
      - `Use External Emojis` (Optional, for button emojis)

2.  **Using Commands:** Once the bot is in your server and running, you can use commands in a text channel. The default prefix is `!`. For example:
    - `!help` - Shows the list of commands.
    - `!play <YouTube URL or Search Term>` - Plays a song or adds it to the queue. You must be in a voice channel first!

## Commands

Here are the available commands (Default Prefix: `!`):

| Command       | Aliases                     | Description                                                    |
| ------------- | --------------------------- | -------------------------------------------------------------- |
| `!play`       | `p`                         | Plays a song from YouTube (URL or search) or adds it to queue. |
| `!skip`       | `s`                         | Skips the currently playing song.                              |
| `!stop`       | `leave`, `disconnect`, `dc` | Stops playback, clears queue, and leaves the voice channel.    |
| `!queue`      | `q`                         | Displays the current song queue with interactive pages.        |
| `!nowplaying` | `np`                        | Shows the currently playing song with interactive controls.    |
| `!pause`      |                             | Pauses the current playback.                                   |
| `!resume`     | `unpause`                   | Resumes paused playback.                                       |
| `!loop`       | `repeat`                    | Toggles loop mode (`none` -> `track` -> `queue` -> `none`).    |
| `!volume`     | `vol`                       | Sets the playback volume (0-200%). Usage: `!volume <number>`.  |
| `!shuffle`    |                             | Shuffles the songs currently in the queue.                     |
| `!remove`     | `rm`                        | Removes a song from the queue by its position number.          |
| `!clear`      | `clearqueue`                | Removes all songs from the queue.                              |
| `!help`       | `h`, `commands`             | Shows this list of commands.                                   |

## Troubleshooting

- **Bot joins but no sound / Not responding:**
  - Double-check the bot's permissions in the channel and server settings (`Connect`, `Speak`, `Send Messages`, `Embed Links`).
  - Ensure you haven't muted the bot within Discord (Right-click the bot user -> Uncheck Mute).
  - Try having the bot leave and rejoin the channel (`!stop`, wait a few seconds, then `!play`).
  - Check the console where the bot is running for any potential error messages.
