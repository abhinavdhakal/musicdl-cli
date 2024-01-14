#!/usr/bin/env node
"use strict";
const Scraper = require("@yimura/scraper").default;
const ID3Writer = require("browser-id3-writer");
const cliProgress = require("cli-progress");
const request = require("request-promise");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);
const fetch = require("node-fetch");
const ytdl = require("ytdl-core");
const LastFM = require("last-fm");
const appPrefix = "musicdl-cli";
const chalk = require("chalk");
const fs = require("node:fs");
const path = require("path");
const os = require("os");
const inquirer = require("inquirer");

const filenameConverter = require('filename-converter');



const lastfm = new LastFM("43cc7377dd1e2dc13bf74948df183dd7", {
  userAgent: "MyApp/1.0.0 (http://example.com)",
});

const args = [...process.argv];

let log = (msg, colour) => {
  if (!colour) colour = "white";
  console.log(chalk[`${colour}`](msg));
};

let configFile = configPath();

let configCmd = args.indexOf("-c");
if (configCmd != -1) {
  log("Config file is located at: " + configFile, "blue");
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
    let downloadDir = path
      .join(os.homedir(), "Downloads")
      .replaceAll("\\", "/");
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
    log("Download Directory doesn't exist: " + downloadDir, "red");
    log("Please specify a working directory in " + configFile + "\n", "red");
    downloadDir = path.join(process.cwd(), "Music");
    log("Downloading in Current Directory: " + downloadDir, "yellow");
  } else {
    log("Downloading in: " + downloadDir, "yellow");
  }
} else {
  log("Please specify your Download_Directory in " + configFile, "red");
  downloadDir = path.join(process.cwd(), "Music");
  log("Downloading in Current Directory: " + downloadDir, "yellow");
}

/////////////////////////////////////////////////////////////////////////

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
    playlistName = playlistName.replaceAll("/", "_").replaceAll("\\", "_");
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

  song.link = await getYtLink(song);

  fs.writeFileSync(path.join(dir, "process.json"), JSON.stringify(spotifyObj));

  try {
    let info = await ytdl.getInfo(song.link);
    let highestFormat = ytdl.chooseFormat(info.formats, {
      quality: "highestaudio",
    });

    let audioReadableStream = ytdl(song.link, { format: highestFormat });

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
      getLyrics(song).then((data) => {
        fs.writeFile(filepath.slice(0, -3).concat("lrc"), data, () => {});
      });
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

  const taggedSongBuffer = Buffer.from(writer.arrayBuffer);
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

    songInfos.fullTitle = filenameConverter.serialize(songInfos.fullTitle)

    songInfos.albumFile = filenameConverter.serialize(songInfos.album)
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

    spotifyObj.songsArray.push(songInfos);
  });

  return spotifyObj;
}

async function getYtLink(song) {
  const youtube = new Scraper();
  let link;
  try {
    let videos = await youtube.search(
      song.artist[0] + " - " + song.title + " official audio"
    );
    link = videos?.videos[0]?.link;
    song.ytDuration = videos?.videos[0]?.duration;
  } catch (err) {
    log(err, "red");
  }

  return link;
}

async function downloadImg(uri, file) {
  return new Promise(async function (resolve) {
    const res = await fetch(uri);
    res.body.pipe(
      fs.createWriteStream(file).on("close", () => {
        resolve(file);
      })
    );
  });
}

async function getLyrics(song) {
  let lyrics = "";
  let reqLink = `https://spotify-lyric-api-984e7b4face0.herokuapp.com/?trackid=${song.spotifyId}&format=lrc`;

  try {
    let res = await request(reqLink);
    res = JSON.parse(res);
    if (res.error) {
      log("Error fetching lyrics!", "red");
      lyrics = "Error!";
    } else {
      res.lines.forEach((line) => {
        line = `[${line.timeTag}] ${line.words} \n`;
        lyrics = lyrics + line;
      });
    }
  } catch (err) {
    log(err, "red");
    lyrics = "Error!";
  }
  return lyrics;
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
