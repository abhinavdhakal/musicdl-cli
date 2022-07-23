"use strict";

let axios = require('axios');
let qs = require('qs');
let request = require("request-promise");
module.exports = class Spotify {
	constructor(details = {}) {
		this.details = details;
		if (!this.details.clientID)
			return console.error("You must specify a Spotify ID!");
		if (!this.details.clientSecret)
			return console.error("You must specify a Spotify Secret!");
		this.headers = {
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			auth: {
				username: this.details.clientID,
				password: this.details.clientSecret,
			},
		};
		this.data = {
			grant_type: 'client_credentials',
		};
		this.getToken = async () => {
			try {
				const response = await axios.post(
					'https://accounts.spotify.com/api/token',
					qs.stringify(this.data),
					this.headers
				);
				if (response.statusCode === 400) {
					console.error("Invalid arguments!");
					return false;
				}
				return response.data.access_token;
			} catch (error) {
				if (error.code == 'EAI_AGAIN') {console.log("Network Error"); return false;}
				console.log("Error while authenticating with Spotify Api")
				return false;
			}
		};

	}




	async searchTrack(trackName, options = {}) {
		let APIOptions;
		let token = await this.getToken();
		if (token === false) return {token: false};

		APIOptions = {
			url: `https://api.spotify.com/v1/search?q=${encodeURI(
				trackName
			)}&type=track&offset=0&limit=${options.limit || 1}`,
			headers: {
				Authorization: "Bearer " + token,
			},
			json: true,
		};
		let data = await request.get(APIOptions);
		return data.tracks.items;
	};


	async getTrack(trackID) {
		let APIOptions;

		let token = await this.getToken();
		if (token === false) return {token: false};
		APIOptions = {
			url: `https://api.spotify.com/v1/tracks/${trackID}`,
			headers: {
				Authorization: "Bearer " + token,
			},
			json: true,
		};

		let result
		try {
			result = await request.get(APIOptions);
			if (result.statusCode == 400) {
				console.error("Invalid arguments!");
				return false;
			}
		} catch (err) {
			if (err.statusCode == 400) {
				console.error("Invalid Link!");
				return false;
			}
			result = false
		}
		return result;

	}

	async getPlaylist(playListID) {
		let APIOptions;

		let token = await this.getToken();

		if (token === false) return {token: false};
		APIOptions = {
			url: `https://api.spotify.com/v1/playlists/${playListID}`,
			headers: {
				Authorization: "Bearer " + token,
			},
			json: true,
		};

		let result
		try {
			result = await request.get(APIOptions);







			if (result.statusCode == 400) {
				console.error("Invalid arguments!");
				return false;
			}

			///////

			console.log("total : " + result.tracks.total)
			if (result?.tracks?.next) {
				result.tracks.items = result.tracks.items.concat((await this.getPlaylistNextTracks(result.tracks.next))?.items);
			}

			///////

		} catch (err) {
			if (err.statusCode == 400) {
				console.error("Invalid Link!");
				return false;
			}
			result = false
		}

		console.log(result.tracks.items.length);
		return result;
	}

	async getAlbum(albumID) {
		let APIOptions;

		let token = await this.getToken();
		if (token === false) return {token: false};
		APIOptions = {
			url: `https://api.spotify.com/v1/albums/${albumID}`,
			headers: {
				Authorization: "Bearer " + token,
			},
			json: true,
		};
		let result
		try {
			result = await request.get(APIOptions);
			if (result.statusCode == 400) {
				console.error("Invalid arguments!");
				return false;
			}
		} catch (err) {
			if (err.statusCode == 400) {
				console.error("Invalid Link!");
				return false;
			}
			result = false
		}

		return result;

	}


	async getTrackByURL(trackURL) {
		let regex = /(?<=https:\/\/open\.spotify\.com\/track\/)([a-zA-Z0-9]{15,})/g;
		let trackID = trackURL.match(regex)[0];
		return await this.getTrack(trackID);
	}

	async getAlbumByURL(albumURL) {
		let regex = /(?<=https:\/\/open\.spotify\.com\/album\/)([a-zA-Z0-9]{15,})/g;
		let albumID = albumURL.match(regex)[0];
		return await this.getAlbum(albumID);
	}

	async getPlaylistByURL(playlistURL) {
		let regex = /(?<=https:\/\/open\.spotify\.com\/playlist\/)([a-zA-Z0-9]{15,})/g;
		let playListID = playlistURL.match(regex)[0];
		return await this.getPlaylist(playListID);
	}

	async getPlaylistNextTracks(nextUrl) {
		let APIOptions;
		let token = await this.getToken();

		if (token === false) return {token: false};
		APIOptions = {
			url: nextUrl,
			headers: {
				Authorization: "Bearer " + token,
			},
			json: true,
		};

		let result
		try {
			result = await request.get(APIOptions);

			if (result.statusCode == 400) {
				return false;
			}

			///////

			if (result?.next) {
				result.items = result.items.concat((await this.getPlaylistNextTracks(result.next))?.items);
			}

			///////

		} catch (err) {
			return false
		}
		return result;

	}

};
