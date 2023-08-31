// a youtube class to download tracks from youtube music

import { searchMusics } from "node-youtube-music";
import ytdl from "ytdl-core";
import { createWriteStream } from "fs";
import { getQueryFromMetadata } from "../lib/query.js";
import logger from "../lib/logger.js";

export default class YoutubeDownloader {
    static async downloadTrack(id, fileName) {
        const musicInfo = await ytdl.getInfo(
            `https://music.youtube.com/watch?v=${id}`,
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
