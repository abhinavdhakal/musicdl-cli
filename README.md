
# musicdl-cli

A simple cli spotify music downloader.

It uses Youtube as the audio source and Spotify API for playlist/album/track details.



## Installation

**Using npm**:

**`
$ sudo npm i musicdl-cli -g
`**

**Using Git**:
```bash
$ git clone https://github.com/AbhinavDhakal/musicdl-cli.git
$ cd musicdl-cli
$ npm install
$ sudo npm link
```


## Configuration
Configuration:

To use this CLI tool, you will need Spotify client id and client secret.
Click [here](#i-dont-have-spotify-client-and-secret
) if you don't have one

After getting Spotify client id and client secret,
Run following command to locate your config file :

```bash
$ musicdl-cli -c
```


![config](./images/config.png?raw=true "Title")

Then edit the config file and update the spotify client and secret.

You can also specify your download location in config file. 



## Usage/Examples

Search and download **song**: *(one at a time)*
```bash
$ musicdl-cli "lost frank ocean"
```
You can also include **synced lyrics** by using `-l` flag:
```bash
$ musicdl-cli -l "joji i'll see you in 40"
```

Download spotify **album**:
```bash
$ musicdl-cli -l "https://open.spotify.com/album/34GQP3dILpyCN018y2k61L"
```

Download spotify **playlist**:
```bash
$ musicdl-cli -l "https://open.spotify.com/playlist/any-playlist"
```
Download spotify **track**:
```bash
$ musicdl-cli -l https://open.spotify.com/track/any-track
```


## I don't have spotify client and secret

Sign up for a Spotify developer account [here](https://developer.spotify.com/my-applications/#!/login). If you already have a Spotify account, you'll just have to log in.

Once you're signed up, navigate to https://developer.spotify.com/my-applications/. Follow these steps:

![First Step](./images/1.png?raw=true "Title")
![Second Step](./images/2.png?raw=true "Title")
![Third Step](./images/3.png?raw=true "Title")

There you go, [now add those to the config file](#Configuration). 
## License

[ISC](https://choosealicense.com/licenses/isc/)

