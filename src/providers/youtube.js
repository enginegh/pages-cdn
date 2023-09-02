import { searchMusics } from "node-youtube-music";
import { GetListByKeyword } from "youtube-search-api";
import ytdl from "ytdl-core";
import { createWriteStream } from "fs";
import {
    getLiteQueryFromMetadata,
    getQueryFromMetadata,
} from "../lib/query.js";
import logger from "../lib/logger.js";

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
        return await new Promise((resolve, reject) => {
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
        if (!results.items.length) {
            logger.debug(`[youtube] No results found for ${query}`);
            return null;
        }
        return results.items[0].id;
    }
}

export class YoutubeMusic extends YoutubeDownloader {
    static async search(track) {
        const query = getQueryFromMetadata(track);
        const musics = await searchMusics(query);
        const filteredMusics = musics.filter((music) => {
            return (
                music.album === track.album.name ||
                Math.abs(
                    music.duration.totalSeconds - track.duration_ms / 1000,
                ) < 3
            );
        });
        if (!filteredMusics.length) {
            logger.debug(`[yt-music] No matching results found for ${query}`);
            return null;
        }
        return filteredMusics[0].youtubeId;
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
