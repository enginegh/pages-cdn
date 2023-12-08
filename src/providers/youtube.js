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

export class YoutubeDownloader {
    static async download(url, fileName) {
        const { formats } = await ytdl.getInfo(url, {
            requestOptions: {
                headers: {
                    cookie: config?.youtube?.cookies || "",
                },
            },
        });
        const format = ytdl.chooseFormat(formats, { quality: "highestaudio" });
        const stream = ytdl.downloadFromInfo({ formats }, { format });
        fileName = `${fileName}.${format.container}`;
        return YoutubeDownloader.saveStream(stream, fileName);
    }

    static saveStream(stream, fileName) {
        return new Promise((resolve, reject) => {
            stream
                .pipe(createWriteStream(fileName))
                .on("finish", () => resolve(fileName))
                .on("error", reject);
        });
    }
}

export class Youtube extends YoutubeDownloader {
    static async search(track) {
        const query = getQueryFromMetadata(track);
        const filter = (await ytsr.getFilters(query)).get("Type").get("Video");
        const results = await ytsr(filter.url, { limit: 1 });
        const video = results.items[0];
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
        const video = results.items.find((item) => item.type === "video");
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
