import YoutubeMusicApi from "youtube-music-api";
import ytsr from "ytsr";
import ytdl from "ytdl-core";
import { createWriteStream } from "fs";
import {
    getLiteQueryFromMetadata,
    getQueryFromMetadata,
} from "../lib/query.js";
import config from "../lib/config.js";
import { compareTwoStrings } from "string-similarity";
import { deleteFile } from "../lib/utils.js";

export class YoutubeDownloader {
    static async download(url, fileName, timeout = 8 * 60) {
        const info = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    cookie: config?.youtube?.cookies || "",
                },
            },
        });
        const format = ytdl.chooseFormat(info.formats, {
            quality: "highestaudio",
        });
        const stream = ytdl.downloadFromInfo(info, { format });
        fileName = `${fileName}.${format.container}`;

        let timer;
        return await new Promise((resolve, reject) => {
            stream
                .pipe(createWriteStream(fileName))
                .on("finish", () => {
                    resolve(fileName);
                })
                .on("error", (err) => {
                    reject(err);
                });
            
            timer = setTimeout(() => {
                stream.destroy();
                deleteFile(fileName);
                reject(new Error("Download timed out"));
            }, timeout * 1000);
        }).finally(() => {
            clearTimeout(timer);
        });
    }
}

export class Youtube extends YoutubeDownloader {
    static async search(track) {
        const query = getQueryFromMetadata(track);
        const filter = (await ytsr.getFilters(query)).get("Type").get("Video");
        const results = await ytsr(filter.url, { limit: 10 });
        const video = results.items.filter((item) => item.duration)[0];
        if (!video) {
            throw new Error(`[Youtube] No results found for ${query}`);
        }

        return `https://youtube.com/watch?v=${video.id}`;
    }
}

export class YoutubeLite extends YoutubeDownloader {
    static async search(track) {
        const query = getLiteQueryFromMetadata(track);
        const results = await ytsr(query, { limit: 20 });
        const video = results.items
            .filter((item) => item.duration)
            .find((item) => item.type === "video");
        if (!video) {
            throw new Error(`[YoutubeLite] No results found for ${query}`);
        }

        return `https://youtube.com/watch?v=${video.id}`;
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

    download = YoutubeDownloader.download;

    async search(track) {
        const query = getQueryFromMetadata(track);
        const songs = await this.api.search(query, "song");
        const song = songs.content[0];
        if (!song) {
            throw new Error(`[yt-music] No results found for ${query}`);
        }

        const songName = song.name
            .replace(/\((feat|prod).+\)/gm, "")
            .replace(/\(From\s.+\)/gm, "")
            .toLowerCase()
            .trim();
        const trackName = track.name
            .replace(/\((feat|prod).+\)/gm, "")
            .replace(/\(From\s.+\)/gm, "")
            .toLowerCase()
            .trim();
        const score = compareTwoStrings(songName, trackName);
        if (score < 0.7) {
            throw new Error(
                `[yt-music] No matching results found for ${query}`,
            );
        }

        return `https://music.youtube.com/watch?v=${song.videoId}`;
    }
}
