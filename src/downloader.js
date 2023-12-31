import logger from "./lib/logger.js";
import Spotify from "./lib/spotify.js";
import deezer from "./providers/deezer.js";
import { Youtube, YoutubeLite, YoutubeMusic } from "./providers/youtube.js";
import ID3Writer from "./lib/id3writer.js";
import path from "path";
import { existsSync, rmSync } from "fs";
import AudioConverter from "./lib/mp3convert/index.js";
import { sanitizePath, ensureDirectoryExists } from "./lib/utils.js";
import Odesli from "./providers/odesli.js";

const converter = new AudioConverter();

export default class TrackDownloader {
    constructor(spotify, providers, download_dir) {
        this.spotify = spotify;
        this.providers = providers;
        this.download_dir = download_dir;
    }

    async download({ spotify, isrc }) {
        let id = spotify ?? isrc;

        let track;
        if (spotify) {
            track = await this.spotify.track(spotify);
        } else if (isrc) {
            track = await this.spotify.isrcSearch(isrc);
        } else {
            throw new Error("invalid id");
        }

        if (!track.name) {
            throw new Error("invalid id");
        }

        const basedir = path.resolve(
            path.join(this.download_dir, sanitizePath(id)),
        );

        ensureDirectoryExists(basedir);

        const basename = path.join(
            basedir,
            sanitizePath(`${track.name} - ${track.artists[0].name}`),
        );

        let filePath;
        for (const provider of this.providers) {
            try {
                const result = await provider.search(track);
                logger.debug(`Downloading ${result} for ${track.name} (${id})`);
                filePath = await provider.download(result, basename);
                break;
            } catch (error) {
                logger.debug(error.message);
            }
        }

        if (!filePath) {
            throw new Error(
                `[downloader] Track not found for ${track.name} (${id})`,
            );
        }

        filePath = await converter.convert(filePath, "mp3");

        logger.debug(`Writing tags: ${filePath}`);
        await ID3Writer.nodeID3write(track, filePath);

        logger.info(`Downloaded ${track.name} (${id})`);
        return { track, filePath };
    }

    clean = () => {
        rmSync(this.download_dir, { recursive: true });
    };

    static init = async (config) => {
        const spotify = await Spotify.fromCredentials(
            config.spotify.client_id,
            config.spotify.client_secret,
        );

        const ytmusic = await YoutubeMusic.initialize();

        const download_dir = path.resolve(config.download_dir || "./tracks");
        if (existsSync(download_dir)) {
            rmSync(download_dir, { recursive: true });
        }
        ensureDirectoryExists(download_dir);

        const providers = [Odesli, deezer, ytmusic, Youtube, YoutubeLite];
        return new TrackDownloader(spotify, providers, download_dir);
    };
}
