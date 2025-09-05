#!/usr/bin/env node
"use strict";


const Scraper = require("@yimura/scraper").default;
const ID3Writer = require("browser-id3-writer");
const cliProgress = require("cli-progress");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);
const ytdl = require("@distube/ytdl-core");
const LastFM = require("last-fm");
const appPrefix = "musicdl-cli";
const chalk = require("chalk");
const fs = require("node:fs");
const path = require("path");
const os = require("os");
const inquirer = require("inquirer");
const axios = require("axios");

const filenameConverter = require("filename-converter");

const lastfm = new LastFM("43cc7377dd1e2dc13bf74948df183dd7", {
  userAgent: "MyApp/1.0.0 (http://example.com)",
});

const args = [...process.argv];

// Add help command
let helpCmd = args.indexOf("-h") !== -1 || args.indexOf("--help") !== -1;
if (helpCmd) {
  console.log(`
musicdl-cli - Download music from Spotify

Usage: musicdl-cli [options] <song name or spotify URL>

Options:
  -h, --help     Show this help message
  -c             Show config file location
  -d <number>    Set number of parallel downloads (default: 2)
  -l             Download lyrics (if available)

Examples:
  musicdl-cli "never gonna give you up"
  musicdl-cli -d 3 "https://open.spotify.com/playlist/..."
  musicdl-cli -l "shape of you"

Configuration:
  Config file is stored at: ${configPath()}
  Use this file to set your Spotify API credentials and download directory.
`);
  process.exit(0);
}

let configFile = configPath();

let configCmd = args.indexOf("-c");
if (configCmd != -1) {
  console.log("Config file is located at: " + configFile); // Use console.log here
  return;
}

let parallelDown = args.indexOf("-d");
let parNum;
if (parallelDown != -1) {
  parNum = Number(args[parallelDown + 1]);
  args.splice(parallelDown, 2);
}

let lyricsCmd = args.indexOf("-l");
if (lyricsCmd != -1) args.splice(lyricsCmd, 1);

/////////////////////////FOR CONFIG////////////////////
function configPath() {
  let configFolder;
  if (process.env.XDG_CONFIG_HOME) {
    configFolder = path.join(process.env.XDG_CONFIG_HOME, appPrefix);
  } else if (fs.existsSync(`${os.homedir()}/.config`)) {
    configFolder = path.join(`${os.homedir()}/.config/`, appPrefix);
  } else {
    configFolder = path.join(os.homedir(), "." + appPrefix);
  }

  let configFile = path.join(configFolder, "default.json");

  process.env.NODE_CONFIG_DIR = configFolder;

  if (!fs.existsSync(configFolder) || !fs.existsSync(configFile)) {
    let downloadDir = path.join(os.homedir(), "Downloads").replace(/\\/g, "/"); // replaceAll("\\", "/") replaced with regex for compatibility
    let configFileData = `{\n
		"Warning":"Please use '/' while changing Download_Directory",\n
	"Download_Directory": "${downloadDir}",\n
	"spotify": {\n
		\t"clientID": "Your Spotify Client ID",\n
		\t"clientSecret": "Your Spotify Client Secret"\n
	}\n
}\n
`;
    fs.mkdirSync(configFolder, { recursive: true });
    fs.writeFileSync(configFile, configFileData);
  }
  return configFile;
}

const config = require("config");

//////////////////////////////FOR SPOTIFY///////////////////////////////////

const Spotify = require("./spotify.js");
let spotifyApi;

async function checkSpotifyCredentials() {
  if (config.has("spotify")) {
    spotifyApi = new Spotify(config.get("spotify"));
    let res = await spotifyApi.searchTrack("never gonna give you up");
    if (res.token === false) {
      log(
        "Please provide your Spotify Client Credentials in config : " +
          configFile,
        "red"
      );
    } else {
      res.token = true;
    }
    return res.token;
  } else {
    log(
      "Please provide your Spotify Client Credentials in config : " +
        configFile,
      "red"
    );
    return false;
  }
}

//////////////////////////////FOR DOWNLOAD DIRECTORY ////////////////////////
let downloadDir;
if (config.has("Download_Directory")) {
  downloadDir = path.join(config.get("Download_Directory"));
  if (!fs.existsSync(downloadDir)) {
    console.log("Download Directory doesn't exist: " + downloadDir); // Use console.log here
    console.log("Please specify a working directory in " + configFile + "\n"); // Use console.log here
    downloadDir = path.join(process.cwd(), "Music");
    console.log("Downloading in Current Directory: " + downloadDir); // Use console.log here
  } else {
    console.log("Downloading in: " + downloadDir); // Use console.log here
  }
} else {
  console.log("Please specify your Download_Directory in " + configFile); // Use console.log here
  downloadDir = path.join(process.cwd(), "Music");
  console.log("Downloading in Current Directory: " + downloadDir); // Use console.log here
}

// ---------- Define log file path and log functions in package config dir ----------
let logDir;
if (process.env.XDG_CONFIG_HOME) {
  logDir = path.join(process.env.XDG_CONFIG_HOME, appPrefix);
} else if (fs.existsSync(`${os.homedir()}/.config`)) {
  logDir = path.join(`${os.homedir()}/.config/`, appPrefix);
} else if (process.env.APPDATA) {
  logDir = path.join(process.env.APPDATA, appPrefix);
} else {
  logDir = path.join(os.homedir(), "." + appPrefix);
}
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
const logFilePath = path.join(logDir, "musicdl-cli.log");
// Clear log file at start of each run
fs.writeFileSync(logFilePath, "");
function logToFile(msg) {
  fs.appendFileSync(logFilePath, `[${new Date().toISOString()}] ${msg}\n`);
}
let log = (msg, colour) => {
  if (!colour) colour = "white";
  msg = String(msg); // Convert to string
  // Only show non-debug logs in CLI
  if (!msg.startsWith("[DEBUG]")) {
    console.log(chalk[`${colour}`](msg));
  }
  // Always log everything to file
  logToFile(msg);
};
// ---------------------------------------------------------------

let imgDir;
//let bar1;
let multibar;
let bars = [];
try {
  imgDir = path.join(process.env.NODE_CONFIG_DIR, "images");
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir);
} catch (err) {
  log("while creating temporary directory: " + err);
  return;
}

main();

async function main() {
  let spot = await checkSpotifyCredentials();
  if (spot == false) {
    return;
  }

  args.shift();
  args.shift();
  if (args[0] === undefined) {
    log("Please provide a Song Name or Spotify Playlist/Album link", "red");
    return;
  }

  if (args.join().includes("open.spotify.com")) {
    startDownload(args.join());
  } else {
    let searchTrackInfos = await spotifyApi.searchTrack(args.join());
    if (searchTrackInfos[0]) {
      startDownload("https://open.spotify.com/track/" + searchTrackInfos[0].id);
    } else {
      log("ERROR: Couldnt find anything!", "red");
    }
  }
}

function startDownload(link) {
  spotifyToArray(link).then(async (spotifyObj) => {
    if (!spotifyObj?.songsArray) return;

    let playlistName = spotifyObj.type === "track" ? "tracks" : spotifyObj.name;

    ///fix///
    playlistName = playlistName.replace(/\//g, "_").replace(/\\/g, "_"); // replaceAll replaced with regex
    /////////
    //
    let dir = path.join(downloadDir, playlistName);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    multibar = new cliProgress.MultiBar(
      {
        stopOnComplete: true,
      },
      cliProgress.Presets.rect
    );

    multibar.on("stop", () => {
      fs.rmSync(path.join(dir, "process.json"));
      log(
        "\nDownload Completed:" +
          spotifyObj.name +
          " (" +
          spotifyObj.total +
          " tracks)",
        "yellow"
      );
      log("Successfull: " + spotifyObj.completed, "green");
      log("Failed: " + spotifyObj.failed.length, "red");
    });

    // For resuming a download
    if (fs.existsSync(path.join(dir, "process.json"))) {
      try {
        const questions = [
          {
            type: "input",
            name: "resume",
            message: "Do you want to resume your previous download? (Y/n)",
          },
        ];

        let ans = await inquirer.prompt(questions);
        if (ans.resume.trim().toLowerCase() != "n") {
          let oldSpotifyObj = fs.readFileSync(path.join(dir, "process.json"));
          spotifyObj = JSON.parse(oldSpotifyObj);
          console.log("Resuming previous downloads!");
          resume(spotifyObj, dir);
          return;
        } else {
          console.log("Previous downloads will be overrided!");
        }
      } catch (err) {
        console.log(err);
      }
    }

    ///////

    if (spotifyObj.type != "track") downloadPlaylistInfos(spotifyObj, dir);

    for (let i = 0; i < spotifyObj.parNum; i++) {
      bars[i] = multibar.create(
        100,
        0,
        {},
        {
          stopOnComplete: false,
        }
      );
      downloadAndSave(spotifyObj, dir, i);
    }
  });
}

async function downloadAndSave(spotifyObj, dir, currID) {
  if (spotifyObj.songsArray.length === 0) {
    bars[currID].stop();
    return;
  }
  spotifyObj.current[currID] = spotifyObj.songsArray.shift();
  let song = spotifyObj.current[currID];

  bars[currID].update(0);
  bars[
    currID
  ].options.format = `{bar} | Starting: ${song.id}. ${song.fullTitle}`;

  // Debug: show the YouTube search query
  log(
    `[DEBUG] Searching YouTube for: "${song.artist[0]} - ${song.title} official audio"`,
    "blue"
  );

  song.link = await getYtLink(song);

  // Debug: show the YouTube link found
  log(
    `[DEBUG] YouTube link found: ${song.link ? song.link : "None"}`,
    song.link ? "green" : "red"
  );

  fs.writeFileSync(path.join(dir, "process.json"), JSON.stringify(spotifyObj));

  try {
    const options = {
      quality: "highestaudio",
      requestOptions: {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      },
    };

    let info;
    // Try up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        info = await ytdl.getInfo(song.link);
        break;
      } catch (e) {
        log(`[DEBUG] Attempt ${attempt} failed: ${e.message}`, "yellow");
        if (attempt === 3) throw e;
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s between attempts
      }
    }

    // Debug: show available formats
    log(
      `[DEBUG] Available formats: ${info.formats ? info.formats.length : 0}`,
      "blue"
    );

    let highestFormat = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
    });

    // Debug: show chosen format details
    log(
      `[DEBUG] Chosen format: ${
        highestFormat ? highestFormat.mimeType : "None"
      }`,
      highestFormat ? "green" : "red"
    );

    let audioReadableStream = ytdl(song.link, {
      ...options,
      format: highestFormat,
    });

    let filepath;
    if (spotifyObj.type == "track") {
      filepath = path.join(dir, `${song.fullTitle}.mp3`);
    } else {
      filepath = path.join(dir, `${song.id}. ${song.fullTitle}.mp3`);
    }

    const audioBitrate = highestFormat.audioBitrate;

    DownloadAndEncode(
      audioReadableStream,
      spotifyObj,
      song,
      filepath,
      audioBitrate,
      dir,
      currID
    );
  } catch (err) {
    log(`Download failed for "${song.fullTitle}": ${err.message}`, "red");
    // Debug: show error stack if available
    if (err.stack) log(`[DEBUG] Error stack:\n${err.stack}`, "red");
    // Debug: show problematic YouTube link
    log(`[DEBUG] Problematic YouTube link: ${song.link}`, "red");
    bars[currID].update(100);
    spotifyObj.failed.push(song.fullTitle);
    downloadAndSave(spotifyObj, dir, currID);
  }
  /////////////////////////////////////////
}

function DownloadAndEncode(
  audioReadableStream,
  spotifyObj,
  song,
  filepath,
  audioBitrate,
  dir,
  currID
) {
  let outputOptions = ["-id3v2_version", "4"];

  //Start encoding
  const enc = new ffmpeg(audioReadableStream)
    .audioBitrate(audioBitrate || 192)
    .withAudioCodec("libmp3lame")
    .toFormat("mp3")
    .outputOptions(...outputOptions);

  enc.on("start", function (obj) {
    bars[
      currID
    ].options.format = `{bar} | Downloading {value}%: ${song.id}. ${song.fullTitle}`;
  });

  enc.on("progress", function (obj) {
    let currTime = obj.timemark.split(":");
    currTime =
      Number(currTime[0]) * 60 * 60 +
      Number(currTime[1]) * 60 +
      Number(currTime[2]);
    let perc = Math.floor((currTime / (song.ytDuration / 1000)) * 100);
    bars[currID].update(perc);
  });

  enc.saveToFile(filepath);

  enc.on("end", async function () {
    await addCoverAndMetadata(spotifyObj, song, filepath);
    if (lyricsCmd >= 0) {
      const lyrics = await getLyrics(song);
      if (lyrics) {
        fs.writeFileSync(filepath.slice(0, -3).concat("lrc"), lyrics);
        log(`Lyrics saved for: ${song.fullTitle}`, "green");
      } else {
        let message =
          spotifyObj.type === "track"
            ? "No lyrics available for this track"
            : `Skipping lyrics for: ${song.fullTitle}`;
        log(message, "yellow");
      }
    }
    spotifyObj.completed += 1;
    bars[
      currID
    ].options.format = `{bar} | Completed {value}%: ${song.id}. ${song.fullTitle}`;

    bars[currID].update(100);
    downloadAndSave(spotifyObj, dir, currID);
  });

  enc.on("error", function (err) {
    bars[currID].update(100);
    spotifyObj.failed.push(song.fullTitle);
    downloadAndSave(spotifyObj, dir, currID);
  });
}

async function downloadPlaylistInfos(spotifyObj, dir) {
  downloadImg(spotifyObj.imgUrl, dir + "/cover.jpg", () => {});
  let playlistFile = fs.createWriteStream(dir + "/playlist.m3u8");
  let playlistString = "";
  spotifyObj.songsArray.forEach((song) => {
    playlistString = playlistString + `${song.id}. ${song.fullTitle}.mp3\n`;
  });

  playlistFile.write(playlistString, (err) => {
    if (err) log("Error while writing playlist file : " + err);
  });
}

async function addCoverAndMetadata(spotifyObj, song, filepath) {
  if (!fs.existsSync(path.join(imgDir, `${song.albumFile}`))) {
    await downloadImg(song.albumPic, path.join(imgDir, `${song.albumFile}`));
  }

  const coverBuffer = fs.readFileSync(path.join(imgDir, `${song.albumFile}`));
  const songBuffer = fs.readFileSync(filepath);
  const writer = new ID3Writer(songBuffer);

  writer
    .setFrame("TPE1", song.artist)
    .setFrame("TALB", song.album)
    .setFrame("TIT2", song.title)
    .setFrame("TYER", Number(song.date))
    .setFrame("TRCK", Number(song.trackNo))
    .setFrame("TCON", song.genre)
    .setFrame("APIC", {
      type: 3,
      data: coverBuffer,
      description: "Album picture",
    });
  writer.addTag();

  const taggedSongBuffer = Buffer.from(writer.arrayBuffer); // Buffer() replaced with Buffer.from()
  fs.writeFileSync(filepath, taggedSongBuffer);
}

async function spotifyToArray(link) {
  let spotifyInfosByURL;

  if (link.includes("album")) {
    spotifyInfosByURL = await spotifyApi.getAlbumByURL(link);
  } else if (link.includes("playlist")) {
    spotifyInfosByURL = await spotifyApi.getPlaylistByURL(link);
  } else if (link.includes("track")) {
    spotifyInfosByURL = await spotifyApi.getTrackByURL(link);
  }

  if (!spotifyInfosByURL) {
    log("ERROR: Couldn't find anything.", "red");
    return;
  } else if (
    spotifyInfosByURL.type === "album" ||
    spotifyInfosByURL.type === "playlist"
  ) {
    log(
      `Downloading ${spotifyInfosByURL.type}: ${spotifyInfosByURL.name} (${spotifyInfosByURL.tracks.items.length} tracks)`,
      "blue"
    );
  } else if (spotifyInfosByURL.type === "track") {
    log(
      `Downloading track: ${spotifyInfosByURL.artists[0].name} - ${spotifyInfosByURL.name}`,
      "blue"
    );
    let copiedObject = JSON.parse(JSON.stringify(spotifyInfosByURL));
    spotifyInfosByURL.tracks = { items: [{ track: copiedObject }] };
  }

  let spotifyObj = {
    name: spotifyInfosByURL.name,
    imgUrl: (spotifyInfosByURL?.images || spotifyInfosByURL?.album?.images)[0]
      .url,
    songsArray: [],
    current: [],
    failed: [],
    completed: 0,
    total: spotifyInfosByURL.tracks.items.length,
    type: spotifyInfosByURL.type,
    parNum: parNum || 2,
  };

  if (spotifyInfosByURL.type === "track") {
    log(`[DEBUG] -------- Spotify Track Details --------`, "blue");
    log(`[DEBUG] Track ID: ${spotifyInfosByURL.id}`, "blue");
    log(`[DEBUG] Title: ${spotifyInfosByURL.name}`, "blue");
    log(
      `[DEBUG] Artists: ${spotifyInfosByURL.artists
        .map((a) => a.name)
        .join(", ")}`,
      "blue"
    );
    log(`[DEBUG] Album: ${spotifyInfosByURL.album.name}`, "blue");
    log(
      `[DEBUG] Release Date: ${spotifyInfosByURL.album.release_date}`,
      "blue"
    );
    log(
      `[DEBUG] Duration: ${Math.floor(spotifyInfosByURL.duration_ms / 1000)}s`,
      "blue"
    );
    log(`[DEBUG] Popularity: ${spotifyInfosByURL.popularity}/100`, "blue");
    log(
      `[DEBUG] Preview URL: ${spotifyInfosByURL.preview_url || "None"}`,
      "blue"
    );
    log(
      `[DEBUG] External URL: ${spotifyInfosByURL.external_urls.spotify}`,
      "blue"
    );
    log(`[DEBUG] -----------------------------------`, "blue");
  }

  spotifyInfosByURL.tracks.items.forEach((item, index) => {
    let artists = [];
    (item.track?.artists || item.artists).forEach((art) => {
      artists.push(art.name);
    });

    if (item.is_local)
      return spotifyObj.failed.push(
        artists[0] + " - " + (item.track || item)?.name
      );

    let songInfos = {
      id: index + 1,
      title: (item.track || item)?.name,
      artist: artists,
      trackNo: (item.track || item)?.track_number,
      genre: [],
      album: (item.track?.album || spotifyInfosByURL).name,
      albumPic: (item.track?.album || spotifyInfosByURL).images[0].url,
      date: (item.track?.album || spotifyInfosByURL)?.release_date.slice(0, 4),
      spotifyId: (item.track || item)?.id,
      duration: (item.track || item)?.duration_ms,
      fullTitle: "",
    };

    ///FIX///
    songInfos.fullTitle = `${songInfos.artist[0]} - ${songInfos.title}`;

    songInfos.fullTitle = filenameConverter.serialize(songInfos.fullTitle);

    songInfos.albumFile = filenameConverter.serialize(songInfos.album);
    ////////

    lastfm.trackTopTags(
      {
        name: songInfos.title,
        artistName: songInfos.artist[0],
        autocorrect: 1,
      },
      (err, data) => {
        if (err) {
          log(err, "red");
          console.error(songInfos);
        } else {
          if (data.tag.length === 0) songInfos.genre.push("music");
          data.tag.forEach((tag, index) => {
            if (index < 5) songInfos.genre.push(tag.name);
          });
        }
      }
    );

    // Add debug info for each track in playlist/album
    log(
      `[DEBUG] Processing Track ${index + 1}/${
        spotifyInfosByURL.tracks.items.length
      }`,
      "blue"
    );
    log(`[DEBUG] Track ID: ${songInfos.spotifyId}`, "blue");
    log(`[DEBUG] Title: ${songInfos.title}`, "blue");
    log(`[DEBUG] Artists: ${songInfos.artist.join(", ")}`, "blue");
    log(`[DEBUG] Album: ${songInfos.album}`, "blue");
    log(`[DEBUG] Duration: ${Math.floor(songInfos.duration / 1000)}s`, "blue");

    spotifyObj.songsArray.push(songInfos);
  });

  return spotifyObj;
}

async function getYtLink(song) {
  const youtube = new Scraper();
  let link;
  try {
    let query = song.artist[0] + " - " + song.title + " official audio";
    log(`[DEBUG] -------- YouTube Search Details --------`, "blue");
    log(`[DEBUG] Search Query: "${query}"`, "blue");

    let videos = await youtube.search(query);

    log(`[DEBUG] Total Results: ${videos?.videos?.length || 0}`, "blue");
    if (videos?.videos?.length) {
      videos.videos.slice(0, 3).forEach((vid, idx) => {
        log(`[DEBUG] Result ${idx + 1}:`, "blue");
        log(`[DEBUG] Title: ${vid.title}`, "blue");
        log(`[DEBUG] Duration: ${vid.duration}`, "blue");
        log(`[DEBUG] Channel: ${vid.channel?.name || "Unknown"}`, "blue");
        log(`[DEBUG] URL: ${vid.link}`, "blue");
      });
    }
    log(`[DEBUG] ------------------------------------`, "blue");
    link = videos?.videos[0]?.link;
    song.ytDuration = videos?.videos[0]?.duration;
    if (!link) {
      log(
        `No YouTube link found for "${song.artist[0]} - ${song.title}"`,
        "red"
      );
    }
  } catch (err) {
    log(
      `YouTube search error for "${song.artist[0]} - ${song.title}": ${err.message}`,
      "red"
    );
    if (err.stack) log(`[DEBUG] Error stack:\n${err.stack}`, "red");
  }

  return link;
}

async function downloadImg(uri, file) {
  return new Promise(async function (resolve) {
    const response = await axios({
      method: "get",
      url: uri,
      responseType: "stream",
    });
    response.data.pipe(
      fs.createWriteStream(file).on("close", () => {
        resolve(file);
      })
    );
  });
}

async function getLyrics(song) {
  let reqLink = `https://api.lyricstify.vercel.app/v1/lyrics/${song.spotifyId}`;

  try {
    const res = await axios.get(reqLink);
    log(`[DEBUG] Lyrics API Response:`, "blue");
    log(`[DEBUG] Status: ${res.status}`, "blue");
    log(
      `[DEBUG] Has Lyrics: ${!res.data.error && res.data.lines?.length > 0}`,
      "blue"
    );
    log(`[DEBUG] Line Count: ${res.data.lines?.length || 0}`, "blue");
    if (res.data.error || !res.data.lines || res.data.lines.length === 0) {
      log(`Lyrics not found for: ${song.artist[0]} - ${song.title}`, "yellow");
      return null;
    }

    let lyrics = "";
    res.data.lines.forEach((line) => {
      lyrics += `[${line.timeTag}] ${line.words}\n`;
    });
    return lyrics;
  } catch (err) {
    log(`Failed to fetch lyrics for: ${song.artist[0]} - ${song.title}`, "red");
    return null;
  }
}

function resume(oldSpotifyObj, dir) {
  oldSpotifyObj.songsArray = [
    ...oldSpotifyObj.current.reverse(),
    ...oldSpotifyObj.songsArray,
  ];
  oldSpotifyObj.current = [];
  for (let i = 0; i < oldSpotifyObj.parNum; i++) {
    bars[i] = multibar.create(
      100,
      0,
      {},
      {
        stopOnComplete: false,
      }
    );
    downloadAndSave(oldSpotifyObj, dir, i);
  }
}

