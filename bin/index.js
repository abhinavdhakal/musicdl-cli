#!/usr/bin/env node
"use strict";
const ID3Writer = require("browser-id3-writer");
const cliProgress = require('cli-progress');
const request = require("request-promise");
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath)
const fetch = require("node-fetch");
const usetube = require("usetube");
const ytdl = require("ytdl-core");
const LastFM = require("last-fm");
const appPrefix = "musicdl-cli";
const chalk = require("chalk");
const fs = require("node:fs");
const path = require("path");
const os = require("os");





const lastfm = new LastFM(
	"43cc7377dd1e2dc13bf74948df183dd7", {
	userAgent: "MyApp/1.0.0 (http://example.com)"
});


const args = [...process.argv];


let log = (msg, colour) => {
	if (!colour) colour = "white";
	console.log(chalk[`${colour}`](msg));
}



let configFile = configPath();

let configCmd = args.indexOf("-c");
if (configCmd != -1) {
	log("Config file is located at: " + configFile, "blue")
	return;
}

let parallelDown = args.indexOf("-d");
let parNum
if (parallelDown != -1) {
	parNum = Number(args[parallelDown + 1]);
	args.splice(parallelDown, 2);
}



let lyricsCmd = args.indexOf("-l");
if (lyricsCmd != -1) args.splice(lyricsCmd, 1)







/////////////////////////FOR CONFIG////////////////////
function configPath() {

	let configFolder;
	if (process.env.XDG_CONFIG_HOME) {
		configFolder = path.join(process.env.XDG_CONFIG_HOME, appPrefix)
	}
	else if (fs.existsSync(`${os.homedir()}/.config`)) {
		configFolder = path.join(`${os.homedir()}/.config/`, appPrefix);
	}
	else {
		configFolder = path.join(os.homedir(), '.' + appPrefix);
	}

	let configFile = path.join(configFolder, "default.json");

	process.env.NODE_CONFIG_DIR = configFolder;


	if (!fs.existsSync(configFolder) || !fs.existsSync(configFile)) {
		let downloadDir = path.join(os.homedir(), "Downloads").replaceAll("\\", "/");
		let configFileData = `{\n
		"Warning":"Please use '/' while changing Download_Directory",\n
	"Download_Directory": "${downloadDir}",\n
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
	if (spot == false) {return };

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
		///fix///
		playlistName = playlistName.replaceAll("/", "_").replaceAll("\\", "_");
		/////////
		let dir = path.join(downloadDir, playlistName);

		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, {recursive: true});
		}


		if (spotifyObj.type != "track") downloadPlaylistInfos(spotifyObj, dir);


		multibar = new cliProgress.MultiBar({
			stopOnComplete: true,
		}, cliProgress.Presets.rect);

		multibar.on('stop', () => {
			fs.rmSync(path.join(dir, "process.json"));
			log("\nDownload Completed:" + spotifyObj.name + " (" + spotifyObj.total + " tracks)", "yellow")
			log("Successfull: " + spotifyObj.completed, "green")
			log("Failed: " + spotifyObj.failed.length, "red")
			//fs.rmdirSync(path.join(dir, ".temp"))
		}
		);


		for (let i = 0; i < spotifyObj.total; i++) {
			if (i < (parNum || 2)) {
				bars[i] = multibar.create(100, 0, {}, {
					stopOnComplete: false,
				});
				downloadAndSave(spotifyObj, dir, i);

			}
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
	bars[currID].options.format = `{bar} | Downloading {value}%: ${song.id}. ${song.fullTitle}`





	song.link = await getYtLink(song);

	fs.writeFileSync(path.join(dir, "process.json"), JSON.stringify(spotifyObj))

	let info = await ytdl.getInfo(song.link);
	let highestFormat = ytdl.chooseFormat(info.formats, {
		quality: "highestaudio",
	});

	let audioReadableStream = ytdl(song.link, {format: highestFormat});

	let filepath;
	if (spotifyObj.type == "track") {
		filepath = path.join(dir, `${song.fullTitle}.mp3`);
	} else {
		filepath = path.join(dir, `${song.id}. ${song.fullTitle}.mp3`);
	}


	//if (!fs.existsSync(path.join(dir, ".temp"))) fs.mkdirSync(path.join(dir, ".temp"));




	const audioBitrate = highestFormat.audioBitrate;

	////////////////////////exp///////////////
	/*
	
		audioReadableStream.pipe(fs.createWriteStream(filepath));
	
		audioReadableStream.on('response', function (res) {
			var totalSize = res.headers['content-length'];
			var dataRead = 0;
			res.on('data', function (data) {
				dataRead += data.length;
				let percent = Math.floor(dataRead / totalSize * 100)
				bars[currID].update(percent)
			});
	
			res.on('end', async function () {
	
				postDownload(spotifyObj, song, filepath, audioBitrate, dir, currID);
			});
		});
	
	
	*/

	DownloadAndEncode(audioReadableStream, spotifyObj, song, filepath, audioBitrate, dir, currID);
	/////////////////////////////////////////


}



function DownloadAndEncode(audioReadableStream, spotifyObj, song, filepath, audioBitrate, dir, currID) {

	//bars[currID].options.format = `{bar} | Encoding {value}% : ${song.id}. ${song.fullTitle}`
	//bars[currID].update(0)


	let outputOptions = ["-id3v2_version", "4"];

	//Start encoding
	const enc = new ffmpeg(audioReadableStream)
		.audioBitrate(audioBitrate || 192)
		.withAudioCodec("libmp3lame")
		.toFormat("mp3")
		.outputOptions(...outputOptions)

	enc.on("progress", function (obj) {
		let currTime = obj.timemark.split(":")
		currTime = Number(currTime[0]) * 60 * 60 + Number(currTime[1]) * 60 + Number(currTime[2])
		let perc = Math.floor((currTime / song.ytDuration) * 100)
		bars[currID].update(perc)
	})

	//enc.saveToFile(path.join(dir, ".temp", `${song.id}.${song.spotifyId}`));

	enc.saveToFile(filepath);



	enc.on("end", async function () {
		//fs.rmSync(filepath)
		//fs.renameSync(path.join(dir, ".temp", `${song.id}.${song.spotifyId}`), filepath)

		await addCoverAndMetadata(spotifyObj, song, filepath);
		if (lyricsCmd >= 0) {
			getLyrics(song).then((data) => {
				fs.writeFile(filepath.slice(0, -3).concat("lrc"), data, () => {})
			})
		}
		spotifyObj.completed += 1;
		bars[currID].update(100);
		downloadAndSave(spotifyObj, dir, currID);
	});

	enc.on("error", function (err) {
		bars[currID].update(100)
		spotifyObj.failed.push(song.fullTitle);
		downloadAndSave(spotifyObj, dir, currID);
	})

}


async function downloadPlaylistInfos(spotifyObj, dir) {
	downloadImg(spotifyObj.imgUrl, dir + "/cover.jpg", () => {
	});
	let playlistFile = fs.createWriteStream(dir + "/playlist.m3u8");
	let playlistString = "";
	spotifyObj.songsArray.forEach((song) => {
		playlistString =
			playlistString + `${song.id}.${song.fullTitle}.mp3\n`;
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
		log("ERROR: Couldn't find anything.", "red")
		return;
	} else if (spotifyInfosByURL.type === "album" || spotifyInfosByURL.type === "playlist") {
		log(`Downloading ${spotifyInfosByURL.type}: ${spotifyInfosByURL.name} (${spotifyInfosByURL.tracks.items.length} tracks)`, 'blue')
	} else if (spotifyInfosByURL.type === "track") {
		log(`Downloading track: ${spotifyInfosByURL.artists[0].name} - ${spotifyInfosByURL.name}`, 'blue');
		let copiedObject = JSON.parse(JSON.stringify(spotifyInfosByURL));
		spotifyInfosByURL.tracks = {items: [{track: copiedObject}]};
	}


	let spotifyObj = {
		name: spotifyInfosByURL.name,
		imgUrl: (spotifyInfosByURL?.images || spotifyInfosByURL?.album?.images)[0].url,
		songsArray: [],
		current: [],//currently downloading song, maximum 3 songs.
		failed: [],
		completed: 0,
		total: spotifyInfosByURL.tracks.items.length,
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
			genre: [],
			album: (item.track?.album || spotifyInfosByURL).name,
			albumPic: (item.track?.album || spotifyInfosByURL).images[0].url,
			date: (item.track?.album || spotifyInfosByURL)?.release_date.slice(0, 4),
			spotifyId: (item.track || item)?.id,
			duration: (item.track || item)?.duration_ms,
			fullTitle: ''
		};

		///FIX///
		songInfos.fullTitle = `${songInfos.artist[0]} - ${songInfos.title}`
		songInfos.fullTitle = songInfos.fullTitle.replaceAll("/", "_").replaceAll("\\", "_");
		songInfos.albumFile = songInfos.album.replaceAll("/", "_").replaceAll("\\", "_");
		////////

		lastfm.trackTopTags({name: songInfos.title, artistName: songInfos.artist[0], autocorrect: 1, },
			(err, data) => {
				if (err) {console.error(err);}
				else {
					if (data.tag.length === 0) songInfos.genre.push("music");
					data.tag.forEach((tag, index) => {
						if (index < 5) songInfos.genre.push(tag.name);
					});
				}
			});



		spotifyObj.songsArray.push(songInfos);

	});

	return spotifyObj;
}


async function getYtLink(song) {

	let videos = await usetube.searchVideo(
		song.artist[0] + " - " + song.title + " official audio"
	);
	let link = ("https://www.youtube.com/watch?v=" + videos?.videos[0]?.id);
	song.ytDuration = videos?.videos[0]?.duration;
	return link;
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
				let line = `[${lyric.time.minutes > 9 ? "" : "0"}${lyric.time.minutes}: ${lyric.time.seconds > 9 ? "" : "0"}${lyric.time.seconds}.${lyric.time.hundredths > 9 ? "" : "0"}${lyric.time.hundredths}]${lyric.text || '♬♬'}`
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
