#!/usr/bin/env node
"use strict";
const ID3Writer = require("browser-id3-writer");
const cliProgress = require('cli-progress');
const request = require("request-promise");
const ffmpeg = require("fluent-ffmpeg");
const appPrefix = "musicdl-cli";
const fetch = require("node-fetch");
const usetube = require("usetube");
const ytdl = require("ytdl-core");
const chalk = require("chalk");
const fs = require("node:fs");
const path = require("path");
const os = require("os");

const LastFM = require("last-fm");
const lastfm = new LastFM("43cc7377dd1e2dc13bf74948df183dd7", {
	userAgent: "MyApp/1.0.0 (http://example.com)",
});





let log = (msg, colour) => {
	if (!colour) colour = "white";
	console.log(chalk[`${colour}`](msg));
}


let args = [...process.argv];

let configFile = configPath();

let configCmd = args.indexOf("-c");
if (configCmd != -1) {
	log("Config file is located at: " + configFile, "blue")
	return;
}

let lyricsCmd = args.indexOf("-l");
if (lyricsCmd != -1) args.splice(lyricsCmd, 1)
args.shift();
args.shift();






/////////////////////////FOR CONFIG////////////////////
function configPath() {

	let configFolder;
	if (process.env.XDG_CONFIG_HOME) {
		configFolder = path.join(process.env.XDG_CONFIG_HOME, appPrefix)
		console.log(configFolder);
	}
	else if (fs.existsSync(`${os.homedir()}/.config`)) {
		configFolder = path.join(`${os.homedir()}/.config/`, appPrefix);
		console.log(configFolder)
	}
	else {
		configFolder = path.join(os.homedir(), '.' + appPrefix);
	}

	let configFile = path.join(configFolder, "default.json");

	process.env.NODE_CONFIG_DIR = configFolder;


	if (!fs.existsSync(configFolder) || !fs.existsSync(configFile)) {

		let configFileData = `{\n
	"Download_Directory": "${os.homedir()}/Downloads",\n
	"spotify": {\n
		\t"clientID": "Your Spotify Client ID",\n
		\t"clientSecret": "Your Spotify Client Secret"\n
	}\n
}\n
`
		fs.mkdirSync(configFolder, {recursive: true});
		fs.writeFileSync(configFile, configFileData)
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
		let res = await spotifyApi.searchTrack("never gonna give you up")
		if (res.token === false) {
			log("Please provide your Spotify Client Credentials in config : " + configFile, "red")
		} else {
			res.token = true;
		}
		return res.token;
	} else {
		log("Please provide your Spotify Client Credentials in config : " + configFile, "red")
		return false;
	}
}

//////////////////////////////FOR DOWNLOAD DIRECTORY ////////////////////////
let downloadDir;
if (config.has("Download_Directory")) {
	downloadDir = path.join(config.get("Download_Directory"))
	if (!fs.existsSync(downloadDir)) {
		log("Download Directory doesn't exist: " + downloadDir, "red");
		log("Please specify a working directory in " + configFile + "\n", 'red');
		downloadDir = path.join(process.cwd(), "Music")
		log("Downloading in Current Directory: " + downloadDir, "yellow")
	} else {
		log("Downloading in: " + downloadDir, "yellow")
	}
} else {
	log("Please specify your Download_Directory in " + configFile, 'red');
	downloadDir = path.join(process.cwd(), "Music")
	log("Downloading in Current Directory: " + downloadDir, "yellow")

}


/////////////////////////////////////////////////////////////////////////

let imgDir;
let bar1;
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
	if (spot == false) {return };

	if (args[0] === undefined) {
		log("Please provide a Song Name or Spotify Playlist/Album link", "red");
		return;
	}

	if (args.join().includes("open.spotify.com")) {
		startDownload(args.join());
	} else {
		let searchTrackInfos = await spotifyApi.searchTrack(args.join());
		if (searchTrackInfos[0]) {
			startDownload('https://open.spotify.com/track/' + searchTrackInfos[0].id);
		} else {
			log("ERROR: Couldnt find anything!", "red")
		}
	}
}


function startDownload(link) {
	spotifyToArray(link).then((spotifyObj) => {

		if (!spotifyObj?.songsArray) return;

		let playlistName = (spotifyObj.type === "track") ? "tracks" : spotifyObj.name;
		let dir = path.join(downloadDir, playlistName);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, {recursive: true});
		}


		if (spotifyObj.type != "track") downloadPlaylistInfos(spotifyObj, dir);

		bar1 = new cliProgress.SingleBar({
			stopOnComplete: true,
			format: ' {bar} | Tracks Downloaded: {value}/{total}'
		}, cliProgress.Presets.shades_classic);

		bar1.start(spotifyObj.songsArray.length, 0);
		downloadAndSave(spotifyObj, 3, dir);

	});

}

async function downloadAndSave(spotifyObj, l, dir) {
	for (let i = 1; i <= l; i++) {

		if (spotifyObj.songsArray.length === 0) return;

		let song = spotifyObj.songsArray.shift();


		let info = await ytdl.getInfo(song.link);
		let highestFormat = ytdl.chooseFormat(info.formats, {
			quality: "highestaudio",
		});

		let audioReadableStream = ytdl(song.link, {format: highestFormat});
		let filepath;
		if (spotifyObj.type == "track")
			filepath = path.join(dir, `${song.artist[0]} - ${song.title}.mp3`);
		else
			filepath = path.join(dir, `${song.id}. ${song.artist[0]} - ${song.title}.mp3`);

		let outputOptions = ["-id3v2_version", "4"];

		const audioBitrate = highestFormat.audioBitrate;

		// Start encoding
		const proc = new ffmpeg({source: audioReadableStream})
			.audioBitrate(audioBitrate || 192)
			.withAudioCodec("libmp3lame")
			.toFormat("mp3")
			.outputOptions(...outputOptions)
			.on("error", function (err) {
				log(err);
			})
			.saveToFile(filepath);





		proc.on("end", async function () {

			const songBuffer = fs.readFileSync(filepath);

			if (!fs.existsSync(path.join(imgDir, `${song.album}.jpeg`))) {
				await downloadImg(song.albumPic, path.join(imgDir, `${song.album}.jpeg`));
				addCover(song, songBuffer, filepath);
			}
			else {
				addCover(song, songBuffer, filepath);
			}
			if (lyricsCmd >= 0) {
				getLyrics(song).then((data) => {
					fs.writeFile(filepath.slice(0, -3).concat("lrc"), data, () => {})
				})
			}

			bar1.increment(1)
			if (!bar1.isActive) log("Successfully Downloaded:" + spotifyObj.name, "green")
			downloadAndSave(spotifyObj, 1, dir);
		});
	}
}










async function downloadPlaylistInfos(spotifyObj, dir) {
	downloadImg(spotifyObj.imgUrl, dir + "/cover.jpg", () => {
	});
	let playlistFile = fs.createWriteStream(dir + "/playlist.m3u8");
	let playlistString = "";
	spotifyObj.songsArray.forEach((song) => {
		playlistString =
			playlistString + `${song.id}. ${song.artist[0]} - ${song.title}.mp3\n`;
	});

	playlistFile.write(playlistString, (err) => {
		if (err) log("Error while writing playlist file : " + err);
	});
}


function addCover(song, songBuffer, filepath) {
	const coverBuffer = fs.readFileSync(path.join(imgDir, `${song.album}.jpeg`));

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








/*************************************************************************************/

// Custom-made function to fetch infos of a spotify playlist link
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
		log("ERROR: Couldn't find anything.", "red")
		return;
	} else if (spotifyInfosByURL.type === "album" || spotifyInfosByURL.type === "playlist") {
		log(`Downloading ${spotifyInfosByURL.type}: ${spotifyInfosByURL.name}`, 'blue')
	} else if (spotifyInfosByURL.type === "track") {
		log(`Downloading track: ${spotifyInfosByURL.artists[0].name} - ${spotifyInfosByURL.name}`, 'blue');
		let copiedObject = JSON.parse(JSON.stringify(spotifyInfosByURL));
		spotifyInfosByURL.tracks = {items: [{track: copiedObject}]};
	}


	let spotifyObj = {
		name: spotifyInfosByURL.name,
		imgUrl: (spotifyInfosByURL?.images || spotifyInfosByURL?.album?.images)[0].url,
		songsArray: [],
		type: spotifyInfosByURL.type
	};


	spotifyInfosByURL.tracks.items.forEach((item, index) => {
		let artists = [];
		(item.track?.artists || item.artists).forEach((art) => {
			artists.push(art.name);
		});
		let songInfos = {
			id: index + 1,
			title: (item.track || item)?.name,
			artist: artists,
			trackNo: (item.track || item)?.track_number,
			link: '',
			genre: [],
			album: (item.track?.album || spotifyInfosByURL).name,
			albumPic: (item.track?.album || spotifyInfosByURL).images[0].url,
			date: (item.track?.album || spotifyInfosByURL)?.release_date.slice(0, 4),
			spotifyId: (item.track || item)?.id,
			duration: (item.track || item)?.duration_ms
		};


		lastfm.trackTopTags({name: songInfos.title, artistName: songInfos.artist[0], autocorrect: 1, }, (err, data) => {if (err) {console.error(err);} else {if (data.tag.length === 0) songInfos.genre.push("music"); data.tag.forEach((tag, index) => {if (index < 5) songInfos.genre.push(tag.name);});} });

		spotifyObj.songsArray.push(songInfos);

	});


	spotifyObj.songsArray = await ytLink(spotifyObj.songsArray)

	return spotifyObj;
}


async function ytLink(songsArray) {
	return Promise.all(songsArray.map(async (song) => {

		let videos = await usetube.searchVideo(
			song.artist[0] + " - " + song.title + " official audio"
		);
		song.link = ("https://www.youtube.com/watch?v=" + videos.videos[0].id);

		//await musicInfo.searchSong({title: song.title, artist: song.artist[0], album: song.album}, 1000).then((data) => {
		//	song.genre.push(data.genre);
		//}).catch(err => {});

		return song;
	}));
}

async function downloadImg(uri, file) {
	return new Promise(async function (resolve) {
		const res = await fetch(uri);
		res.body.pipe(fs.createWriteStream(file).on("close", () => {
			resolve(file);
		}));
	})
}


async function getLyrics(song) {

	const init = {
		base_url: "https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&namespace=lyrics_richsynched&subtitle_format=mxm&app_id=web-desktop-app-v1.0&",
		headers: {"authority": "apic-desktop.musixmatch.com", "cookie": "x-mxm-token-guid="},
		params: {
			"q_album": song.album,
			"q_artist": song.artist[0],
			"q_artists": song.artist.join(","),
			"q_track": song.title,
			"track_spotify_id": song.spotifyId,
			"q_duration": song.duration / 1000,
			"f_subtitle_length": "",
			"usertoken": "2203269256ff7abcb649269df00e14c833dbf4ddfb5b36a1aae8b0",
		}
	}
	let lyrics = "";
	try {
		let musixMatch = await request({url: init.base_url, qs: init.params, headers: init.headers});
		let res = JSON.parse(musixMatch).message.body

		if (res.macro_calls["track.subtitles.get"].message.header.status_code == "200") {
			let lyricsJSON = JSON.parse(res.macro_calls["track.subtitles.get"].message.body.subtitle_list[0].subtitle.subtitle_body);
			lyricsJSON.forEach((lyric) => {
				let line = `[${lyric.time.minutes > 9 ? "" : "0"}${lyric.time.minutes}:${lyric.time.seconds > 9 ? "" : "0"}${lyric.time.seconds}.${lyric.time.hundredths > 9 ? "" : "0"}${lyric.time.hundredths}]${lyric.text}`
				lyrics = lyrics + line + "\n"
			})
		} else {
			lyrics = "Couldn't Fetch!";
		}
	} catch (err) {
		lyrics = "Couldn't Fetch!";
	}
	return lyrics
}
