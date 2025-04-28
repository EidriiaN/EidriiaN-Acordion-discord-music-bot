require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  NoSubscriberBehavior,
  StreamType,
  getVoiceConnection, // Keep just in case, though not actively used in current logic
} = require("@discordjs/voice");
const ytdl = require("@distube/ytdl-core");
const ffmpeg = require("ffmpeg-static"); // Required by @discordjs/voice even if not explicitly used in code sometimes
const ytSearch = require("yt-search");

// --- Bot Configuration ---
const TOKEN = process.env.TOKEN;
const PREFIX = process.env.PREFIX || "!"; // Use environment variable or default to '!'
const MAX_QUEUE_SIZE = 100; // Limit queue size
const DEFAULT_VOLUME = 50; // Default volume percentage (0-100)
const INACTIVITY_TIMEOUT_MS = 300_000; // 5 minutes
const EMPTY_CHANNEL_TIMEOUT_MS = 120_000; // 2 minutes

// --- Client Setup ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // Required for prefix commands
    GatewayIntentBits.GuildVoiceStates, // Required for voice channel tracking
  ],
});

client.commands = new Collection();
const guildPlayerData = new Map(); // Stores { connection, player, queue, currentSong, textChannel, loop, volume, timeoutId, lockPlay, nowPlayingMessage, queueMessage, queuePage }

// --- Utility Functions ---

/** Formats duration in seconds to HH:MM:SS or MM:SS */
function formatDuration(seconds) {
  if (seconds === 0 || !seconds) return "00:00";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const hoursStr = hours > 0 ? `${hours}:` : "";
  const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
  const secsStr = secs < 10 ? `0${secs}` : secs;

  return `${hoursStr}${minutesStr}:${secsStr}`;
}

/** Creates a simple info embed */
function createSimpleEmbed(message) {
  return new EmbedBuilder().setColor(0x0099ff).setDescription(message);
}

/** Creates an error embed */
function createErrorEmbed(message) {
  return new EmbedBuilder().setColor(0xff0000).setTitle("❌ Error").setDescription(message);
}

/** Creates a success embed */
function createSuccessEmbed(message) {
  return new EmbedBuilder().setColor(0x00ff00).setTitle("✅ Success").setDescription(message);
}

/** Creates the Now Playing embed */
function createNowPlayingEmbed(song, playerData) {
  const player = playerData?.player;
  const playbackDurationMs = player?.state.status === AudioPlayerStatus.Playing ? player?.state.resource?.playbackDuration ?? 0 : 0;
  const loopEmoji = playerData.loop === "track" ? "🔂" : playerData.loop === "queue" ? "🔁" : "▶️";
  const progressBar = createProgressBar(playbackDurationMs, song.durationSeconds);

  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle(`${loopEmoji} Now Playing`)
    .setThumbnail(song.thumbnail)
    .setDescription(`**[${song.title}](${song.url})**`)
    .addFields(
      { name: "Requested by", value: `<@${song.requestedBy}>`, inline: true },
      { name: "Duration", value: song.durationFormatted, inline: true },
      { name: "Volume", value: `${playerData.volume}%`, inline: true },
      { name: "Queue", value: `${playerData.queue.length} songs left`, inline: true },
      { name: "Looping", value: playerData.loop, inline: true },
      { name: "Progress", value: progressBar, inline: false }
    )
    .setTimestamp();
}

/** Creates the Queue embed */
function createQueueEmbed(guildId, currentPage = 0) {
  const playerData = guildPlayerData.get(guildId);
  if (!playerData) return createSimpleEmbed("No player data found for this server.");

  const queue = playerData.queue;
  const currentSong = playerData.currentSong;
  const songsPerPage = 10;
  const totalPages = Math.max(1, Math.ceil(queue.length / songsPerPage)); // Ensure at least 1 page
  currentPage = Math.max(0, Math.min(currentPage, totalPages - 1)); // Clamp page number

  const start = currentPage * songsPerPage;
  const end = start + songsPerPage;
  const currentQueuePage = queue.slice(start, end);

  const description =
    currentQueuePage
      .map((song, index) => `**${start + index + 1}.** [${song.title}](${song.url}) \`[${song.durationFormatted}]\` - Req by <@${song.requestedBy}>`)
      .join("\n") || "The queue is empty.";

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle("🎵 Music Queue")
    .setDescription(description)
    .setFooter({ text: `Page ${currentPage + 1}/${totalPages} | Total songs: ${queue.length}` });

  if (currentSong) {
    const npField = `▶️ **[${currentSong.title}](${currentSong.url})** \`[${currentSong.durationFormatted}]\` - Req by <@${currentSong.requestedBy}>`;
    embed.addFields({ name: "Now Playing", value: npField });
  }

  return embed;
}

/** Creates a progress bar string */
function createProgressBar(currentMs, totalSeconds, barLength = 15) {
  if (!totalSeconds || totalSeconds === 0 || currentMs < 0) return "`[──────────────────]`"; // Default bar
  const totalMs = totalSeconds * 1000;
  const percentage = Math.min(1, Math.max(0, currentMs / totalMs)); // Ensure percentage is between 0 and 1
  const progress = Math.round(barLength * percentage);
  const emptyProgress = barLength - progress;

  const progressText = "🔘".repeat(progress);
  const emptyProgressText = "─".repeat(emptyProgress);
  const currentTimeStr = formatDuration(Math.floor(currentMs / 1000));
  const totalTimeStr = formatDuration(totalSeconds);

  return `\`[${currentTimeStr} / ${totalTimeStr}] [${progressText}${emptyProgressText}]\``;
}

/** Creates action row buttons for Now Playing message */
function createNowPlayingButtons(playerData) {
  const isPaused = playerData?.player?.state.status === AudioPlayerStatus.Paused;
  const loopMode = playerData?.loop ?? "none";

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("np_pause_resume")
      .setLabel(isPaused ? "▶️ Resume" : "⏸️ Pause")
      .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("np_skip").setLabel("⏭️ Skip").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("np_stop").setLabel("⏹️ Stop").setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("np_loop")
      .setLabel(loopMode === "track" ? "🔂 Track" : loopMode === "queue" ? "🔁 Queue" : "▶️ Off")
      .setStyle(loopMode !== "none" ? ButtonStyle.Success : ButtonStyle.Secondary)
  );
}

/** Creates action row buttons for Queue pagination */
function createQueueButtons(currentPage, totalPages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`queue_prev_${currentPage}`) // Include page in ID to prevent race conditions
      .setLabel("◀️ Prev")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage === 0),
    new ButtonBuilder()
      .setCustomId(`queue_next_${currentPage}`)
      .setLabel("Next ▶️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(currentPage >= totalPages - 1)
  );
}

// --- Player Logic ---

const YTDL_OPTIONS = {
  filter: "audioonly",
  quality: "highestaudio",
  highWaterMark: 1 << 25, // 32MB buffer
  // dlChunkSize: 0, // May help with throttling sometimes, but can also cause issues
};

/** Ensures player data exists for a guild, creating if necessary */
function ensurePlayerData(guildId, textChannel) {
  if (!guildPlayerData.has(guildId)) {
    guildPlayerData.set(guildId, {
      connection: null,
      player: null,
      queue: [],
      currentSong: null,
      textChannel: textChannel,
      loop: "none", // 'none', 'track', 'queue'
      volume: DEFAULT_VOLUME,
      timeoutId: null,
      lockPlay: false, // Prevents race conditions
      nowPlayingMessage: null, // To store the message object for NP updates
      queueMessage: null, // To store the message object for Queue updates
      queuePage: 0, // Current page for queue message
    });
  }
  const data = guildPlayerData.get(guildId);
  data.textChannel = textChannel; // Update channel in case bot is used elsewhere
  return data;
}

/** Gets player data for a guild */
function getPlayerData(guildId) {
  return guildPlayerData.get(guildId);
}

// --- [FIXED] ---
/** Cleans up player resources for a guild - async function */
async function cleanupGuild(guildId, reason = "cleanup requested") {
  const playerData = guildPlayerData.get(guildId);
  // If no data, cleanup already happened or wasn't needed
  if (!playerData) {
    // console.log(`[${guildId}] Cleanup called but no player data found. Skipping.`);
    return;
  }

  console.log(`[${guildId}] Cleaning up player data. Reason: ${reason}`);

  if (playerData.timeoutId) clearTimeout(playerData.timeoutId);
  playerData.player?.stop(true); // Stop player forcefully

  // --- Safer Message Deletion ---
  const npMsg = playerData.nowPlayingMessage;
  const qMsg = playerData.queueMessage;

  // Clear references immediately *before* async delete calls
  playerData.nowPlayingMessage = null;
  playerData.queueMessage = null;

  if (npMsg) {
    await npMsg.delete().catch((error) => {
      // Ignore "Unknown Message" error (10008), warn others
      if (error.code !== 10008) {
        console.warn(`[${guildId}] Error deleting Now Playing message:`, error.message);
      }
    });
  }
  if (qMsg) {
    await qMsg.delete().catch((error) => {
      // Ignore "Unknown Message" error (10008), warn others
      if (error.code !== 10008) {
        console.warn(`[${guildId}] Error deleting Queue message:`, error.message);
      }
    });
  }
  // --- End Safer Message Deletion ---

  // Check if connection exists and isn't already destroyed before trying to destroy
  if (playerData.connection && playerData.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    playerData.connection.destroy();
  }

  // Finally, remove the entry from the map to prevent further access/cleanups by other events
  guildPlayerData.delete(guildId);
  console.log(`[${guildId}] Player data removed from map.`);
}
// --- [END FIXED] ---

/** Starts inactivity timer */
function startInactivityTimer(guildId, timeoutMs = INACTIVITY_TIMEOUT_MS) {
  const playerData = guildPlayerData.get(guildId);
  if (!playerData) return;

  if (playerData.timeoutId) clearTimeout(playerData.timeoutId); // Clear existing timer

  console.log(`[${guildId}] Starting inactivity timer (${timeoutMs / 1000}s).`);
  playerData.timeoutId = setTimeout(() => {
    const currentData = guildPlayerData.get(guildId); // Re-fetch data
    if (currentData?.connection && currentData.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      console.log(`[${guildId}] Inactivity timeout reached. Leaving channel.`);
      currentData.textChannel?.send({ embeds: [createSimpleEmbed("👋 Left the voice channel due to inactivity.")] }).catch(console.warn);
      cleanupGuild(guildId, "inactivity timeout"); // cleanupGuild is now async, but we don't need to await it here
    }
  }, timeoutMs);
}

/** Plays the next song in the queue */
async function playNextSong(guildId) {
  const playerData = guildPlayerData.get(guildId);
  if (!playerData || playerData.lockPlay || !playerData.player || !playerData.connection) {
    if (playerData) playerData.lockPlay = false;
    return;
  }

  playerData.lockPlay = true;
  if (playerData.timeoutId) clearTimeout(playerData.timeoutId);
  playerData.timeoutId = null;

  // Delete previous Now Playing message if it exists
  // Ensure we have a reference before trying to delete
  const oldNpMsg = playerData.nowPlayingMessage;
  playerData.nowPlayingMessage = null; // Clear ref before async operation
  if (oldNpMsg) {
    await oldNpMsg.delete().catch((error) => {
      if (error.code !== 10008) {
        // Ignore Unknown Message
        console.warn(`[${guildId}] Error deleting old Now Playing message:`, error.message);
      }
    });
  }

  let songToPlay = null;

  if (playerData.loop === "track" && playerData.currentSong) {
    songToPlay = playerData.currentSong;
    console.log(`[${guildId}] Looping track: ${songToPlay.title}`);
  } else {
    if (playerData.loop === "queue" && playerData.currentSong) {
      playerData.queue.push(playerData.currentSong);
      console.log(`[${guildId}] Looping queue: Added ${playerData.currentSong.title} back to queue.`);
    }
    songToPlay = playerData.queue.shift();
  }

  if (!songToPlay) {
    console.log(`[${guildId}] Queue empty. Ending playback.`);
    playerData.currentSong = null;
    playerData.lockPlay = false;
    await updateQueueMessage(guildId);
    startInactivityTimer(guildId);
    return;
  }

  playerData.currentSong = songToPlay;

  try {
    console.log(`[${guildId}] Attempting to play: ${songToPlay.title}`);
    const stream = ytdl(songToPlay.url, YTDL_OPTIONS);

    stream.on("error", (error) => {
      console.error(`[${guildId}] YTDL Stream Error for ${songToPlay.title}:`, error);
      playerData.textChannel
        ?.send({ embeds: [createErrorEmbed(`Stream error for **${songToPlay.title}**: ${error.message.slice(0, 100)}`)] })
        .catch(console.warn);
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });

    if (resource.volume) {
      resource.volume.setVolumeLogarithmic(playerData.volume / 100);
    } else {
      console.warn(`[${guildId}] Could not set volume - resource.volume is unavailable.`);
    }

    playerData.player.play(resource);
    await entersState(playerData.player, AudioPlayerStatus.Playing, 15_000);
    console.log(`[${guildId}] Now playing: ${songToPlay.title}`);

    // Send Now Playing message and store it
    const npEmbed = createNowPlayingEmbed(songToPlay, playerData);
    const npButtons = createNowPlayingButtons(playerData);
    // Check if textChannel still exists before sending
    if (playerData.textChannel) {
      playerData.nowPlayingMessage = await playerData.textChannel.send({ embeds: [npEmbed], components: [npButtons] }).catch(console.warn);
    }

    await updateQueueMessage(guildId);
  } catch (error) {
    console.error(`[${guildId}] Error playing ${songToPlay.title}:`, error);
    playerData.textChannel
      ?.send({ embeds: [createErrorEmbed(`❌ Failed to play **${songToPlay.title}**. Skipping. Error: ${error.message.slice(0, 100)}`)] })
      .catch(console.warn);
    playerData.currentSong = null;
    playerData.lockPlay = false;
    setTimeout(() => playNextSong(guildId), 500);
    return;
  } finally {
    playerData.lockPlay = false;
  }
}

/** Updates or sends the queue message */
async function updateQueueMessage(guildId) {
  const playerData = guildPlayerData.get(guildId);
  // Check if data and textChannel exist before proceeding
  if (!playerData || !playerData.textChannel) return;

  const queueEmbed = createQueueEmbed(guildId, playerData.queuePage);
  const totalPages = Math.max(1, Math.ceil(playerData.queue.length / 10));
  const queueButtons = createQueueButtons(playerData.queuePage, totalPages);

  try {
    // Check if message reference exists before trying to edit
    if (playerData.queueMessage) {
      await playerData.queueMessage.edit({ embeds: [queueEmbed], components: totalPages > 1 ? [queueButtons] : [] });
    } else {
      // Send only if there's something to show (current song or queue)
      // Check if textChannel still exists before sending
      if ((playerData.currentSong || playerData.queue.length > 0) && playerData.textChannel) {
        playerData.queueMessage = await playerData.textChannel.send({ embeds: [queueEmbed], components: totalPages > 1 ? [queueButtons] : [] });
      }
    }
  } catch (error) {
    console.warn(`[${guildId}] Failed to update/send queue message: ${error.message}`);
    // If message was deleted (10008) or channel gone (?), clear the stored message ID
    if (error.code === 10008 || error.code === 10003) {
      // Unknown Message or Unknown Channel
      if (playerData) playerData.queueMessage = null; // Check playerData exists before modifying
    }
  }
}

// --- Command Definitions ---

// PLAY Command
client.commands.set("play", {
  name: "play",
  aliases: ["p"],
  description: "Plays a song from YouTube or adds it to the queue.",
  async execute(message, args) {
    const query = args.join(" ");
    if (!query) return message.reply({ embeds: [createErrorEmbed(`Usage: ${PREFIX}play <YouTube URL or Search Term>`)] });

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")] });

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions?.has(PermissionFlagsBits.Connect)) {
      return message.reply({ embeds: [createErrorEmbed("I need permission to **Connect** to your voice channel!")] });
    }
    if (!permissions?.has(PermissionFlagsBits.Speak)) {
      return message.reply({ embeds: [createErrorEmbed("I need permission to **Speak** in your voice channel!")] });
    }

    const guildId = message.guildId;
    const playerData = ensurePlayerData(guildId, message.channel);

    if (playerData.queue.length >= MAX_QUEUE_SIZE) {
      return message.reply({ embeds: [createErrorEmbed(`The queue is full (max ${MAX_QUEUE_SIZE} songs).`)] });
    }

    // Join channel or ensure connection/player exist
    if (!playerData.connection || playerData.connection?.state.status === VoiceConnectionStatus.Destroyed) {
      try {
        // Check if another connection attempt is locked? Not strictly needed here yet.
        playerData.connection = joinVoiceChannel({
          channelId: voiceChannel.id,
          guildId: guildId,
          adapterCreator: message.guild.voiceAdapterCreator,
          selfDeaf: true,
        });

        // --- [FIXED] --- Add check inside listener
        playerData.connection.on(VoiceConnectionStatus.Destroyed, () => {
          console.log(`[${guildId}] Voice Connection Destroyed.`);
          // Check if data still exists in map before cleaning up again
          if (guildPlayerData.has(guildId)) {
            cleanupGuild(guildId, "connection destroyed event"); // cleanupGuild is async
          } else {
            console.log(`[${guildId}] Skipping cleanup on 'destroyed' event as data is already removed.`);
          }
        });
        // --- [END FIXED] ---

        playerData.connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
          console.log(`[${guildId}] Voice Connection Disconnected.`);
          try {
            await Promise.race([
              entersState(playerData.connection, VoiceConnectionStatus.Signalling, 5_000),
              entersState(playerData.connection, VoiceConnectionStatus.Connecting, 5_000),
            ]);
          } catch (error) {
            console.log(`[${guildId}] Connection did not recover, cleaning up.`);
            // Check if data still exists before cleaning up
            if (guildPlayerData.has(guildId)) {
              cleanupGuild(guildId, "connection disconnected permanently"); // cleanupGuild is async
            }
          }
        });

        await entersState(playerData.connection, VoiceConnectionStatus.Ready, 20_000);
      } catch (error) {
        console.error(`[${guildId}] Error joining voice channel:`, error);
        cleanupGuild(guildId, "failed to join voice channel"); // cleanupGuild is async
        return message.reply({ embeds: [createErrorEmbed(`Failed to join voice channel: ${error.message}`)] });
      }
    }

    // Create player if it doesn't exist
    if (!playerData.player) {
      playerData.player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
      });

      playerData.player.on(AudioPlayerStatus.Idle, (oldState) => {
        // Check if player data still exists for this guild
        const currentPlayerData = guildPlayerData.get(guildId);
        if (!currentPlayerData) return; // Stop if cleanup happened concurrently

        if (oldState.status === AudioPlayerStatus.Playing && currentPlayerData.currentSong) {
          console.log(`[${guildId}] Player Idle (song finished): ${currentPlayerData.currentSong.title}`);
          playNextSong(guildId);
        } else if (oldState.status !== AudioPlayerStatus.Idle) {
          console.log(`[${guildId}] Player Idle (from ${oldState.status}). Triggering playNext if needed.`);
          if (!currentPlayerData.currentSong && currentPlayerData.queue.length > 0 && !currentPlayerData.lockPlay) {
            playNextSong(guildId);
          } else if (!currentPlayerData.currentSong && currentPlayerData.queue.length === 0) {
            startInactivityTimer(guildId);
          }
        }
      });

      playerData.player.on("error", (error) => {
        console.error(`[${guildId}] Audio Player Error:`, error.message);
        // Check if data exists before accessing channel
        const currentPlayerData = guildPlayerData.get(guildId);
        if (!currentPlayerData) return;

        currentPlayerData.textChannel?.send({ embeds: [createErrorEmbed(`Audio player error: ${error.message}. Skipping.`)] }).catch(console.warn);
        currentPlayerData.currentSong = null;
        setTimeout(() => playNextSong(guildId), 500);
      });

      // Check if connection still valid before subscribing
      if (playerData.connection && playerData.connection.state.status !== VoiceConnectionStatus.Destroyed) {
        playerData.connection.subscribe(playerData.player);
      } else {
        console.warn(`[${guildId}] Could not subscribe player, connection invalid.`);
        cleanupGuild(guildId, "invalid connection state during player creation");
        return message.reply({ embeds: [createErrorEmbed(`Internal error: Could not establish voice connection properly.`)] });
      }
    }

    // --- Search and Add Song ---
    const searchMsg = await message.reply({ embeds: [createSimpleEmbed(`🔍 Searching for "${query}"...`)] });

    try {
      let songInfo;
      let videoUrl;
      let source = "search";

      if (ytdl.validateURL(query)) {
        videoUrl = query;
        try {
          songInfo = await ytdl.getInfo(videoUrl);
          source = "url";
        } catch (err) {
          console.warn(`[${guildId}] Failed to get info directly from URL ${videoUrl}: ${err.message}`);
          videoUrl = null;
        }
      }

      if (!videoUrl) {
        const searchResult = await ytSearch(query);
        if (!searchResult || !searchResult.videos.length) {
          return searchMsg.edit({ embeds: [createErrorEmbed(`No results found for "${query}".`)] }).catch(console.warn);
        }
        const firstResult = searchResult.videos[0];
        videoUrl = firstResult.url;
        try {
          songInfo = await ytdl.getInfo(videoUrl);
        } catch (getInfoError) {
          console.error(`[${guildId}] Failed to get info after search for ${videoUrl}:`, getInfoError);
          return searchMsg
            .edit({ embeds: [createErrorEmbed(`Could not fetch details for the found video. It might be unavailable or private.`)] })
            .catch(console.warn);
        }
      }

      if (songInfo.videoDetails.isLiveContent) {
        return searchMsg.edit({ embeds: [createErrorEmbed("Live streams are not supported.")] }).catch(console.warn);
      }

      const durationSeconds = parseInt(songInfo.videoDetails.lengthSeconds, 10);
      const song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        thumbnail: songInfo.videoDetails.thumbnails?.[0]?.url || null,
        durationSeconds: durationSeconds,
        durationFormatted: formatDuration(durationSeconds),
        requestedBy: message.author.id,
        source: source,
      };

      // Check if player data still exists before modifying queue
      const currentPlayerData = guildPlayerData.get(guildId);
      if (!currentPlayerData) {
        console.warn(`[${guildId}] Player data disappeared before adding song to queue.`);
        return searchMsg.edit({ embeds: [createErrorEmbed(`Session expired while searching. Please try again.`)] }).catch(console.warn);
      }

      currentPlayerData.queue.push(song);
      const queuePosition = (currentPlayerData.currentSong ? 1 : 0) + currentPlayerData.queue.length;

      const replyEmbed = createSuccessEmbed(`Added to queue (#${queuePosition})`)
        .setDescription(`**[${song.title}](${song.url})**`)
        .addFields({ name: "Duration", value: song.durationFormatted, inline: true })
        .setThumbnail(song.thumbnail);

      await searchMsg.edit({ embeds: [replyEmbed] }).catch(console.warn);
      await updateQueueMessage(guildId);

      // Check player status on current data
      if (currentPlayerData.player?.state.status === AudioPlayerStatus.Idle && !currentPlayerData.lockPlay) {
        await playNextSong(guildId);
      }
    } catch (error) {
      console.error(`[${guildId}] Error processing play command for query "${query}":`, error);
      let userErrorMessage = `An error occurred while searching or adding the song.`;
      if (error.message?.includes("confirm your age")) userErrorMessage = "Cannot play age-restricted video.";
      else if (error.message?.includes("Private video") || error.message?.includes("Video unavailable"))
        userErrorMessage = "This video is private or unavailable.";
      else if (error.statusCode === 410 || error.message?.includes("410"))
        userErrorMessage = "Could not fetch video information (region locked/removed?).";
      else if (error.message?.includes("ytSearch")) userErrorMessage = "Error occurred during YouTube search.";
      await searchMsg.edit({ embeds: [createErrorEmbed(userErrorMessage)] }).catch(console.warn);
    }
  },
});

// SKIP Command
client.commands.set("skip", {
  name: "skip",
  aliases: ["s"],
  description: "Skips the current song.",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    if (!playerData || !playerData.player || !playerData.currentSong)
      return message.reply({ embeds: [createErrorEmbed("Nothing is playing to skip.")] });
    if (voiceChannel.id !== playerData.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });

    const skippedSongTitle = playerData.currentSong.title;
    message.reply({ embeds: [createSuccessEmbed(`⏭️ Skipping **${skippedSongTitle}**...`)] }); // Reply optimistically
    playerData.player.stop(); // Trigger idle state -> playNextSong
  },
});

// STOP Command
client.commands.set("stop", {
  name: "stop",
  aliases: ["leave", "disconnect", "dc"],
  description: "Stops playback, clears the queue, and leaves the voice channel.",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    // Check map directly if bot is considered connected
    if (!guildPlayerData.has(guildId)) return message.reply({ embeds: [createErrorEmbed("The bot is not in a voice channel or playing.")] });
    // Re-get data after checking map
    const currentPlayerData = getPlayerData(guildId);
    if (voiceChannel.id !== currentPlayerData?.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });

    await message.reply({ embeds: [createSuccessEmbed("⏹️ Stopping playback and leaving channel...")] });
    await cleanupGuild(guildId, `stop command by ${message.author.tag}`); // Await cleanup
  },
});

// QUEUE Command
client.commands.set("queue", {
  name: "queue",
  aliases: ["q"],
  description: "Displays the current music queue.",
  async execute(message, args) {
    const guildId = message.guildId;
    // Use ensurePlayerData to make sure entry exists even if queue is empty
    const playerData = ensurePlayerData(guildId, message.channel);

    // Delete previous queue message if exists and reference is stored
    const oldQueueMsg = playerData.queueMessage;
    playerData.queueMessage = null; // Clear ref before async op
    if (oldQueueMsg) {
      await oldQueueMsg.delete().catch((error) => {
        if (error.code !== 10008) console.warn(`[${guildId}] Error deleting old Queue message:`, error.message);
      });
    }
    playerData.queuePage = 0; // Reset page

    if (!playerData.currentSong && playerData.queue.length === 0) {
      return message.reply({ embeds: [createSimpleEmbed("The queue is empty and nothing is playing.")] });
    }

    const queueEmbed = createQueueEmbed(guildId, playerData.queuePage);
    const totalPages = Math.max(1, Math.ceil(playerData.queue.length / 10));
    const queueButtons = createQueueButtons(playerData.queuePage, totalPages);

    playerData.queueMessage = await message.channel
      .send({
        embeds: [queueEmbed],
        components: totalPages > 1 ? [queueButtons] : [],
      })
      .catch((err) => {
        console.error(`[${guildId}] Failed to send queue message:`, err);
        // Ensure message ref is null if sending failed
        if (playerData) playerData.queueMessage = null;
      });
  },
});

// NOWPLAYING Command
client.commands.set("nowplaying", {
  name: "nowplaying",
  aliases: ["np"],
  description: "Shows the currently playing song and controls.",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);

    // Delete previous NP message if ref exists
    const oldNpMsg = playerData?.nowPlayingMessage;
    if (playerData) playerData.nowPlayingMessage = null; // Clear ref before async op
    if (oldNpMsg) {
      await oldNpMsg.delete().catch((error) => {
        if (error.code !== 10008) console.warn(`[${guildId}] Error deleting old NP message:`, error.message);
      });
    }

    if (!playerData || !playerData.currentSong || !playerData.player) {
      return message.reply({ embeds: [createSimpleEmbed("Nothing is currently playing.")] });
    }

    const npEmbed = createNowPlayingEmbed(playerData.currentSong, playerData);
    const npButtons = createNowPlayingButtons(playerData);

    // Store the new message ref if send succeeds
    if (playerData) {
      try {
        playerData.nowPlayingMessage = await message.channel.send({ embeds: [npEmbed], components: [npButtons] });
      } catch (err) {
        console.error(`[${guildId}] Failed to send NP message:`, err);
        playerData.nowPlayingMessage = null; // Ensure ref is null on error
      }
    }
  },
});

// PAUSE Command
client.commands.set("pause", {
  name: "pause",
  description: "Pauses the current playback.",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    if (!playerData || !playerData.player || !playerData.currentSong)
      return message.reply({ embeds: [createErrorEmbed("Nothing is playing to pause.")] });
    if (voiceChannel.id !== playerData.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });
    if (playerData.player.state.status === AudioPlayerStatus.Paused)
      return message.reply({ embeds: [createSimpleEmbed("Playback is already paused.")] });

    if (playerData.player.pause()) {
      await message.reply({ embeds: [createSuccessEmbed("⏸️ Playback paused.")] });
      if (playerData.nowPlayingMessage && playerData.currentSong) {
        try {
          const npEmbed = createNowPlayingEmbed(playerData.currentSong, playerData);
          const npButtons = createNowPlayingButtons(playerData);
          await playerData.nowPlayingMessage.edit({ embeds: [npEmbed], components: [npButtons] });
        } catch (error) {
          if (error.code !== 10008) console.warn(`[${guildId}] Failed to edit NP message on pause:`, error.message);
          // Clear ref if message is gone
          if (error.code === 10008 && playerData) playerData.nowPlayingMessage = null;
        }
      }
    } else {
      await message.reply({ embeds: [createErrorEmbed("Could not pause playback.")] });
    }
  },
});

// RESUME Command
client.commands.set("resume", {
  name: "resume",
  aliases: ["unpause"],
  description: "Resumes the paused playback.",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    if (!playerData || !playerData.player) return message.reply({ embeds: [createErrorEmbed("The player is not active.")] });
    if (voiceChannel.id !== playerData.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });
    if (playerData.player.state.status !== AudioPlayerStatus.Paused) return message.reply({ embeds: [createSimpleEmbed("Playback is not paused.")] });

    if (playerData.player.unpause()) {
      await message.reply({ embeds: [createSuccessEmbed("▶️ Playback resumed.")] });
      if (playerData.nowPlayingMessage && playerData.currentSong) {
        try {
          const npEmbed = createNowPlayingEmbed(playerData.currentSong, playerData);
          const npButtons = createNowPlayingButtons(playerData);
          await playerData.nowPlayingMessage.edit({ embeds: [npEmbed], components: [npButtons] });
        } catch (error) {
          if (error.code !== 10008) console.warn(`[${guildId}] Failed to edit NP message on resume:`, error.message);
          if (error.code === 10008 && playerData) playerData.nowPlayingMessage = null;
        }
      }
    } else {
      await message.reply({ embeds: [createErrorEmbed("Could not resume playback.")] });
    }
  },
});

// LOOP Command
client.commands.set("loop", {
  name: "loop",
  aliases: ["repeat"],
  description: "Sets the loop mode (none, track, queue).",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;
    const validModes = ["none", "off", "track", "song", "queue", "all"];
    const modeArg = args[0]?.toLowerCase();

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    if (!playerData || !playerData.player) return message.reply({ embeds: [createErrorEmbed("The player is not active.")] });
    if (voiceChannel.id !== playerData.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });

    let newLoopMode = playerData.loop;

    if (modeArg && validModes.includes(modeArg)) {
      if (["track", "song"].includes(modeArg)) newLoopMode = "track";
      else if (["queue", "all"].includes(modeArg)) newLoopMode = "queue";
      else newLoopMode = "none";
    } else {
      if (playerData.loop === "none") newLoopMode = "track";
      else if (playerData.loop === "track") newLoopMode = "queue";
      else newLoopMode = "none";
    }

    playerData.loop = newLoopMode;

    let responseMessage = "";
    if (newLoopMode === "track") responseMessage = "🔂 Looping current track.";
    else if (newLoopMode === "queue") responseMessage = "🔁 Looping queue.";
    else responseMessage = "▶️ Loop disabled.";

    await message.reply({ embeds: [createSuccessEmbed(responseMessage)] });

    if (playerData.nowPlayingMessage && playerData.currentSong) {
      try {
        const npEmbed = createNowPlayingEmbed(playerData.currentSong, playerData);
        const npButtons = createNowPlayingButtons(playerData);
        await playerData.nowPlayingMessage.edit({ embeds: [npEmbed], components: [npButtons] });
      } catch (error) {
        if (error.code !== 10008) console.warn(`[${guildId}] Failed to edit NP message on loop:`, error.message);
        if (error.code === 10008 && playerData) playerData.nowPlayingMessage = null;
      }
    }
  },
});

// VOLUME Command
client.commands.set("volume", {
  name: "volume",
  aliases: ["vol"],
  description: "Sets the playback volume (0-200%).",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;
    const volumeArg = args[0];

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    if (!playerData || !playerData.player) return message.reply({ embeds: [createErrorEmbed("The player is not active.")] });
    if (voiceChannel.id !== playerData.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });

    if (!volumeArg) {
      return message.reply({ embeds: [createSimpleEmbed(`Current volume is ${playerData.volume}%.`)] });
    }

    const newVolume = parseInt(volumeArg, 10);
    if (isNaN(newVolume) || newVolume < 0 || newVolume > 200) {
      return message.reply({ embeds: [createErrorEmbed("Volume must be a number between 0 and 200.")] });
    }

    playerData.volume = newVolume;
    // Check if resource exists and has volume property before setting
    const resource = playerData.player.state.resource;
    let success = false;
    if (resource?.volume) {
      success = resource.volume.setVolumeLogarithmic(newVolume / 100);
    }

    if (!success && resource) {
      // If resource exists but setting failed
      console.warn(`[${guildId}] Failed to set volume - setVolumeLogarithmic returned false or resource.volume missing.`);
      return message.reply({ embeds: [createErrorEmbed("Could not set volume now. Is a song currently playing?")] });
    } else if (!resource) {
      // If no resource playing
      // Still update the playerData volume for the *next* song
      console.log(`[${guildId}] Volume set to ${newVolume}% for next song (no current resource).`);
    }

    await message.reply({ embeds: [createSuccessEmbed(`🔊 Volume set to ${newVolume}%.`)] });

    if (playerData.nowPlayingMessage && playerData.currentSong) {
      try {
        const npEmbed = createNowPlayingEmbed(playerData.currentSong, playerData);
        await playerData.nowPlayingMessage.edit({ embeds: [npEmbed] }); // Only update embed, buttons don't change
      } catch (error) {
        if (error.code !== 10008) console.warn(`[${guildId}] Failed to edit NP message on volume:`, error.message);
        if (error.code === 10008 && playerData) playerData.nowPlayingMessage = null;
      }
    }
  },
});

// SHUFFLE Command
client.commands.set("shuffle", {
  name: "shuffle",
  description: "Shuffles the current queue.",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    if (!playerData || !playerData.player) return message.reply({ embeds: [createErrorEmbed("The player is not active.")] });
    if (voiceChannel.id !== playerData.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });
    if (playerData.queue.length < 2) return message.reply({ embeds: [createSimpleEmbed("Need at least 2 songs in the queue to shuffle.")] });

    let queue = playerData.queue;
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    await message.reply({ embeds: [createSuccessEmbed("🔀 Queue shuffled!")] });
    await updateQueueMessage(guildId);
  },
});

// REMOVE Command
client.commands.set("remove", {
  name: "remove",
  aliases: ["rm"],
  description: "Removes a song from the queue by its position.",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;
    const positionArg = args[0];

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    if (!playerData || !playerData.player) return message.reply({ embeds: [createErrorEmbed("The player is not active.")] });
    if (voiceChannel.id !== playerData.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });
    if (playerData.queue.length === 0) return message.reply({ embeds: [createSimpleEmbed("The queue is empty.")] });

    const position = parseInt(positionArg, 10);
    if (isNaN(position) || position <= 0 || position > playerData.queue.length) {
      return message.reply({ embeds: [createErrorEmbed(`Invalid position. Enter a number between 1 and ${playerData.queue.length}.`)] });
    }

    const indexToRemove = position - 1;
    const removedSong = playerData.queue.splice(indexToRemove, 1)[0];

    if (removedSong) {
      await message.reply({ embeds: [createSuccessEmbed(`Removed **${removedSong.title}** from the queue.`)] });
      await updateQueueMessage(guildId);
    } else {
      await message.reply({ embeds: [createErrorEmbed(`Could not remove song at position ${position}.`)] });
    }
  },
});

// CLEAR Command
client.commands.set("clear", {
  name: "clear",
  aliases: ["clearqueue"],
  description: "Clears all songs from the queue.",
  async execute(message, args) {
    const guildId = message.guildId;
    const playerData = getPlayerData(guildId);
    const voiceChannel = message.member?.voice?.channel;

    if (!voiceChannel) return message.reply({ embeds: [createErrorEmbed("You need to be in a voice channel!")], ephemeral: true });
    if (!playerData || !playerData.player) return message.reply({ embeds: [createErrorEmbed("The player is not active.")] });
    if (voiceChannel.id !== playerData.connection?.joinConfig?.channelId)
      return message.reply({ embeds: [createErrorEmbed("You must be in the same voice channel as the bot.")] });
    if (playerData.queue.length === 0) return message.reply({ embeds: [createSimpleEmbed("The queue is already empty.")] });

    const clearedCount = playerData.queue.length;
    playerData.queue = [];

    await message.reply({ embeds: [createSuccessEmbed(`🗑️ Cleared ${clearedCount} songs from the queue.`)] });
    await updateQueueMessage(guildId);
  },
});

// HELP Command
client.commands.set("help", {
  name: "help",
  aliases: ["h", "commands"],
  description: "Shows a list of available commands.",
  execute(message, args) {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("🎵 Music Bot Commands")
      .setDescription(`Use prefix \`${PREFIX}\` before each command.`);

    let commandList = "";
    // Iterate over commands, maybe sort them alphabetically
    const sortedCommands = [...client.commands.values()].sort((a, b) => a.name.localeCompare(b.name));

    sortedCommands.forEach((cmd) => {
      if (cmd.description) {
        let commandEntry = `**${PREFIX}${cmd.name}**`;
        if (cmd.aliases && cmd.aliases.length > 0) {
          commandEntry += ` (${cmd.aliases.map((a) => `\`${PREFIX}${a}\``).join(", ")})`;
        }
        commandEntry += `: ${cmd.description}\n`;
        commandList += commandEntry;
      }
    });

    embed.addFields({ name: "Commands", value: commandList || "No commands found." });
    message.channel.send({ embeds: [embed] });
  },
});

// --- Event Handlers ---

client.once("ready", () => {
  console.log(`🚀 Logged in as ${client.user.tag}`);
  console.log(`Prefix: ${PREFIX}`);
  client.user.setActivity(`music | ${PREFIX}help`, { type: "PLAYING" });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName) || client.commands.find((cmd) => cmd.aliases && cmd.aliases.includes(commandName));

  if (!command) return;

  console.log(`[${message.guild.name}] User ${message.author.tag} executed: ${PREFIX}${commandName} ${args.join(" ")}`);

  try {
    await command.execute(message, args);
  } catch (error) {
    console.error(`Error executing command ${commandName}:`, error);
    // Avoid replying if interaction is involved - but this handler is only for message commands
    try {
      await message.reply({ embeds: [createErrorEmbed("An error occurred while executing that command.")] });
    } catch (replyError) {
      console.error(`Failed to send error reply for command ${commandName}:`, replyError);
    }
  }
});

// Handle Button Interactions
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton() || !interaction.guildId) return;

  const { customId } = interaction;
  const guildId = interaction.guildId;
  // Use getPlayerData - if it returns null, cleanup likely happened.
  const playerData = getPlayerData(guildId);

  // If no data, maybe try to remove buttons from the message?
  if (!playerData) {
    try {
      await interaction.reply({ content: "This music session has ended.", ephemeral: true });
      // Try removing components from the original message if possible
      await interaction.message.edit({ components: [] }).catch(() => {}); // Ignore errors editing old message
    } catch (e) {
      console.warn("Error replying to interaction for ended session:", e);
    }
    return;
  }

  const memberVoiceChannel = interaction.member?.voice?.channel;
  const botVoiceChannelId = playerData.connection?.joinConfig?.channelId;

  const isControlAction = customId.startsWith("np_");
  const isQueueAction = customId.startsWith("queue_");

  // Require user in VC for control actions
  if (isControlAction && (!memberVoiceChannel || memberVoiceChannel.id !== botVoiceChannelId)) {
    return interaction.reply({ content: "You must be in the same voice channel as the bot to use player controls.", ephemeral: true });
  }

  // Check queue message validity
  if (isQueueAction && (!playerData.queueMessage || interaction.message.id !== playerData.queueMessage.id)) {
    return interaction.reply({ content: "This queue message is outdated.", ephemeral: true });
  }
  // Check NP message validity
  if (isControlAction && (!playerData.nowPlayingMessage || interaction.message.id !== playerData.nowPlayingMessage.id)) {
    return interaction.reply({ content: "This now playing message is outdated.", ephemeral: true });
  }

  // Defer update for all button interactions now
  try {
    await interaction.deferUpdate();
  } catch (deferError) {
    console.warn(`[${guildId}] Failed to defer interaction update:`, deferError);
    // If defer fails, we probably can't proceed reliably.
    return;
  }

  try {
    // --- Queue Button Logic ---
    if (isQueueAction) {
      const parts = customId.split("_");
      const direction = parts[1];
      const currentPageFromId = parseInt(parts[2], 10);

      if (currentPageFromId !== playerData.queuePage) {
        // Silently ignore interaction on stale page buttons
        console.log(`[${guildId}] Queue button interaction ignored (stale page ID: ${currentPageFromId}, current: ${playerData.queuePage})`);
        return;
      }

      const totalPages = Math.max(1, Math.ceil(playerData.queue.length / 10));
      if (direction === "next") {
        playerData.queuePage = Math.min(totalPages - 1, playerData.queuePage + 1);
      } else if (direction === "prev") {
        playerData.queuePage = Math.max(0, playerData.queuePage - 1);
      }
      await updateQueueMessage(guildId); // Update message with new page
      return;
    }

    // --- Now Playing Button Logic ---
    if (isControlAction) {
      // Re-verify player state as it might have changed between interaction and processing
      if (!playerData.player || !playerData.currentSong) {
        await interaction.message.edit({ content: "Playback has ended.", embeds: [], components: [] }).catch(() => {});
        return;
      }

      let interactionFeedback = null;

      switch (customId) {
        case "np_pause_resume":
          if (playerData.player.state.status === AudioPlayerStatus.Paused) {
            if (playerData.player.unpause()) interactionFeedback = "▶️ Resumed.";
            else interactionFeedback = "❌ Failed to resume.";
          } else if (playerData.player.state.status === AudioPlayerStatus.Playing) {
            if (playerData.player.pause()) interactionFeedback = "⏸️ Paused.";
            else interactionFeedback = "❌ Failed to pause.";
          }
          break;
        case "np_skip":
          const skippedTitle = playerData.currentSong?.title ?? "current song";
          interactionFeedback = `⏭️ Skipping ${skippedTitle}...`;
          await interaction.followUp({ content: interactionFeedback, ephemeral: true }).catch(console.warn);
          playerData.player.stop(); // Triggers idle -> playNext
          // Don't edit message here, let playNext handle the update
          return;
        case "np_stop":
          interactionFeedback = "⏹️ Stopping playback...";
          await interaction.followUp({ content: interactionFeedback, ephemeral: true }).catch(console.warn);
          // Edit message *before* cleanup potentially deletes it
          await interaction.message.edit({ content: "⏹️ Playback stopped.", embeds: [], components: [] }).catch(() => {});
          await cleanupGuild(guildId, `stop button by ${interaction.user.tag}`); // Await cleanup
          return;
        case "np_loop":
          if (playerData.loop === "none") playerData.loop = "track";
          else if (playerData.loop === "track") playerData.loop = "queue";
          else playerData.loop = "none";
          interactionFeedback = `Loop mode set to: ${playerData.loop}`;
          break;
      }

      // Update the Now Playing message for pause/resume/loop if it still exists
      if (playerData.nowPlayingMessage && playerData.currentSong && guildPlayerData.has(guildId)) {
        try {
          const npEmbed = createNowPlayingEmbed(playerData.currentSong, playerData);
          const npButtons = createNowPlayingButtons(playerData);
          await playerData.nowPlayingMessage.edit({ embeds: [npEmbed], components: [npButtons] });
        } catch (error) {
          if (error.code !== 10008) console.warn(`[${guildId}] Failed to edit NP message after button action:`, error.message);
          // Clear ref if message is gone
          if (error.code === 10008 && playerData) playerData.nowPlayingMessage = null;
        }
      }
      if (interactionFeedback) {
        await interaction.followUp({ content: interactionFeedback, ephemeral: true }).catch(console.warn);
      }
    }
  } catch (error) {
    console.error(`[${guildId}] Error handling button interaction ${customId}:`, error);
    try {
      await interaction.followUp({ content: "An error occurred while processing this action.", ephemeral: true });
    } catch (followUpError) {
      console.error(`[${guildId}] Failed to send error follow-up for button interaction:`, followUpError);
    }
  }
});

// Auto-Leave / Cleanup on Voice State Update
client.on("voiceStateUpdate", (oldState, newState) => {
  const guildId = oldState.guildId;

  // --- [FIXED] --- Handle Bot Disconnection (Check if data exists)
  if (newState.id === client.user.id) {
    if (newState.channelId === null && oldState.channelId !== null) {
      console.log(`[${guildId}] Bot disconnected from voice channel ${oldState.channelId}. Cleaning up.`);
      // Check if data still exists in map before cleaning up again
      if (guildPlayerData.has(guildId)) {
        cleanupGuild(guildId, "bot disconnected from voice channel"); // cleanup is async
      } else {
        console.log(`[${guildId}] Skipping cleanup on 'voiceStateUpdate' (bot disconnect) as data is already removed.`);
      }
    }
    return; // Don't process bot's own state changes further
  }
  // --- [END FIXED] ---

  // --- Handle Channel Empty Check ---
  // Check only if player data exists for this guild
  const playerData = getPlayerData(guildId);
  if (!playerData || !playerData.connection || playerData.connection.state.status === VoiceConnectionStatus.Destroyed) {
    return;
  }

  const botChannelId = playerData.connection.joinConfig.channelId;
  // Check if the user was in the bot's channel
  if (oldState.channelId === botChannelId && newState.channelId !== botChannelId) {
    // User left the bot's channel
    // Fetch the channel to check members - ensure bot has cache access or fetch if needed
    const voiceChannel = oldState.channel ?? oldState.guild.channels.cache.get(botChannelId);
    if (voiceChannel && voiceChannel.members.filter((m) => !m.user.bot).size === 0) {
      console.log(`[${guildId}] Voice channel ${botChannelId} is empty. Starting empty channel timer.`);
      startInactivityTimer(guildId, EMPTY_CHANNEL_TIMEOUT_MS);
    }
  } else if (newState.channelId === botChannelId && oldState.channelId !== botChannelId) {
    // User joined the bot's channel
    if (playerData.timeoutId) {
      // Check if the timer might have been the shorter EMPTY_CHANNEL one?
      // For now, any join cancels any timer.
      console.log(`[${guildId}] User joined voice channel ${botChannelId}. Cancelling inactivity timer.`);
      clearTimeout(playerData.timeoutId);
      playerData.timeoutId = null;
    }
  }
});

// --- Global Error Handlers ---
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  // process.exit(1); // Consider exiting for critical uncaught errors
});

// --- Login ---
if (!TOKEN) {
  console.error("ERROR: Bot token is not defined. Please check your .env file.");
} else {
  client.login(TOKEN);
}
