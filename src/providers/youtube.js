import YoutubeMusicApi from "youtube-music-api";
import { GetListByKeyword } from "youtube-search-api";
import ytdl from "ytdl-core";
import { createWriteStream } from "fs";
import {
    getLiteQueryFromMetadata,
    getQueryFromMetadata,
} from "../lib/query.js";
import logger from "../lib/logger.js";
import config from "../lib/config.js";
import { compareTwoStrings } from "string-similarity";

class YoutubeDownloader {
    static async downloadTrack(id, fileName) {
        const musicInfo = await ytdl.getInfo(
            `https://youtube.com/watch?v=${id}`,
            {
                requestOptions: {
                    headers: {
                        cookie: config?.youtube?.cookies || "",
                    },
                },
            }
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
        const results = await GetListByKeyword(query, false, 1);
        const video = results.items[0];
        if (!video) {
            logger.debug(`[Youtube] No results found for ${query}`);
            return null;
        }

        return video.id;
    }
}

export class YoutubeMusic {
    constructor() {
        this.api = new YoutubeMusicApi();
    }

    static async initialize() {
        const yt = new YoutubeMusic();
        await yt.api.initalize();
        return yt;
    }

    downloadTrack = YoutubeDownloader.downloadTrack;

    async search(track) {
        const query = getQueryFromMetadata(track);
        const songs = await this.api.search(query, "song");
        const song = songs.content[0];
        if (!song) {
            logger.debug(`[yt-music] No results found for ${query}`);
            return null;
        }

        const songName = song.name
            .replace(/\((feat|prod).+\)/gm, "")
            .replace(/\(From\s.+\)/gm, "")
            .toLowerCase().trim()
        const trackName = track.name
            .replace(/\((feat|prod).+\)/gm, "")
            .replace(/\(From\s.+\)/gm, "")
            .toLowerCase().trim()
        const score = compareTwoStrings(songName, trackName)
        if (score < 0.7) {
            logger.debug(`[yt-music] No matching results found for ${query}`);
            return null;
        }

        return song.videoId;
    }
}

export class YoutubeLite extends YoutubeDownloader {
    static async search(track) {
        const query = getLiteQueryFromMetadata(track);
        const results = await GetListByKeyword(query, false, 1);
        const video = results.items[0];
        if (!video) {
            logger.debug(`[YoutubeLite] No results found for ${query}`);
            return null;
        }

        return video.id;
    }
}
