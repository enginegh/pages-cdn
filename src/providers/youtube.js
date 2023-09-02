import YoutubeMusicApi from "youtube-music-api";
import { GetListByKeyword } from "youtube-search-api";
import ytdl from "ytdl-core";
import { createWriteStream } from "fs";
import {
    getLiteQueryFromMetadata,
    getQueryFromMetadata,
} from "../lib/query.js";
import logger from "../lib/logger.js";
import { distance } from "fastest-levenshtein";

class YoutubeDownloader {
    static async downloadTrack(id, fileName) {
        const musicInfo = await ytdl.getInfo(
            `https://youtube.com/watch?v=${id}`,
        );
        const format = ytdl.chooseFormat(musicInfo.formats, {
            quality: "highestaudio",
        });
        const stream = ytdl.downloadFromInfo(musicInfo, { format: format });
        fileName = `${fileName}.${format.container}`;
        // write stream to file and block until finished
        return new Promise((resolve, reject) => {
            stream
                .pipe(createWriteStream(fileName))
                .on("finish", () => {
                    resolve(fileName);
                })
                .on("error", (error) => {
                    reject(error);
                });
        });
    }
}

export class Youtube extends YoutubeDownloader {
    static async search(track) {
        const query = getQueryFromMetadata(track);
        const results = await GetListByKeyword(query, false, 3);
        const sortedResults = results.items.sort((a, b) => {
            return (
                distance(
                    a.title.toLowerCase(),
                    track.name.toLowerCase(),
                ) -
                distance(
                    b.title.toLowerCase(),
                    track.name.toLowerCase(),
                )
            );
        });
        if (!sortedResults.length) {
            logger.debug(`[youtube] No results found for ${query}`);
            return null;
        }
        return sortedResults[0].id;
    }
}

export class YoutubeMusic extends YoutubeDownloader {
    constructor() {
        super();
        this.api = new YoutubeMusicApi();
    }

    static async initialize() {
        const ytmusic = new YoutubeMusic();
        await ytmusic.api.initalize();
        return ytmusic;
    }

    downloadTrack = YoutubeDownloader.downloadTrack;

    async search(track) {
        const query = getQueryFromMetadata(track);
        const musics = await this.api.search(query, "song");
        const filteredMusics = musics.content.filter((song) => {
            return (
                distance(
                    song.name.toLowerCase(),
                    track.name.toLowerCase(),
                ) > 0.8 ||
                Math.abs(
                    song.duration - track.duration_ms,
                ) < 10000 ||
                distance(
                    song?.artist.name.toLowerCase(),
                    track.artists[0].name.toLowerCase(),
                ) > 0.8 ||
                distance(
                    song?.album.name.toLowerCase(),
                    track.album.name.toLowerCase(),
                ) > 0.8
            );
        });
        if (!filteredMusics.length) {
            logger.debug(`[yt-music] No matching results found for ${query}`);
            return null;
        }
        return filteredMusics[0].videoId;
    }
}

export class YoutubeLite extends YoutubeDownloader {
    static async search(track) {
        const query = getLiteQueryFromMetadata(track);
        const results = await GetListByKeyword(query, false, 1);
        if (!results.items.length) {
            logger.debug(`[youtube] No results found for ${query}`);
            return null;
        }
        return results.items[0].id;
    }
}
