// a function which takes a spotify uri and download the track and return track info and path, if failed return null
import logger from "./lib/logger.js";
import Spotify from "./lib/spotify.js";
import DeezerDownloader from "./providers/deezer.js";
import { Youtube, YoutubeLite, YoutubeMusic } from "./providers/youtube.js";
import ID3Writer from "./lib/id3writer.js";
import path from "path";
import { existsSync, mkdirSync, rmSync } from "fs";
import AudioConverter from "./lib/mp3convert/index.js";
import { SongWhip } from "./providers/songwhip.js";

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
            throw new Error(`invalid id`);
        }

        if (!track.name) {
            throw new Error(`invalid id`);
        }

        const fileName = path.resolve(
            path.join(
                this.download_dir,
                `${track.name} - ${track.artists[0].name}`.replace(
                    /[\/\\?%*:|"<>#]/g,
                    "-",
                ),
            ),
        );

        logger.debug(`Downloading ${track.name} (${id})`);

        let filePath;
        for (const provider of this.providers) {
            try {
                const result = await provider.search(track);
                filePath = await provider.downloadTrack(result, fileName);
                break;
            } catch (error) {
                logger.debug(error);
            }
        }

        if (!filePath) {
            throw new Error(
                `[downloader] Track not found for ${track.name} (${id})`,
            );
        }

        filePath = await converter.convert(filePath, "mp3");

        // write tags
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
        const deezer = new DeezerDownloader(
            config.deezer.cookies,
            config.deezer.proxy,
        );
        const ytmusic = await YoutubeMusic.initialize();

        let downloadDir = path.resolve(config.download_dir || "./tracks");
        if (existsSync(downloadDir)) {
            rmSync(downloadDir, { recursive: true });
        }
        mkdirSync(downloadDir);

        const providers = [ytmusic, deezer, Youtube, YoutubeLite];
        return new TrackDownloader(spotify, providers, downloadDir);
    };
}
