// a function which takes a spotify uri and download the track and return track info and path, if failed return null
import logger from "./lib/logger.js";
import Spotify from "./lib/spotify.js";
import DeezerDownloader from "./providers/deezer.js";
import { Youtube, YoutubeMusic } from "./providers/youtube.js";
import ID3Writer from "./lib/id3writer.js";
import path from "path";
import { existsSync, mkdirSync, rmSync } from "fs";
import checkMp3 from "./lib/checkMp3.js";

export default class TrackDownloader {
    constructor(spotify, providers, download_dir) {
        this.spotify = spotify;
        this.providers = providers;
        this.download_dir = download_dir;
    }

    async download(trackId) {
        const track = await this.spotify.track(trackId);
        const fileName = path.resolve(
            path.join(
                this.download_dir,
                `${track.name} - ${track.artists[0].name}`.replace(
                    /[/\\?%*:|"<>]/g,
                    "-",
                ),
            ),
        );

        let filePath;
        for (const provider of this.providers) {
            try {
                const result = await provider.search(track);
                if (result) {
                    filePath = await provider.downloadTrack(result, fileName);
                    break;
                }
            } catch (error) {
                logger.debug(error);
            }
        }

        if (!filePath) {
            throw new Error(
                `[downloader] Track not found for ${track.name} - ${track.artists[0].name} - ${trackId}`,
            );
        }

        filePath = await checkMp3(filePath);

        // write tags
        logger.debug("Writing tags...");
        await ID3Writer.spotifyWrite(track, filePath);
        logger.info(
            `Downloaded ${track.name} - ${track.artists[0].name} - ${trackId}`,
        );
        return { track, filePath };
    }

    deleteDownloadDir = () => {
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

        let downloadDir = path.resolve(
            config.downloader.download_dir || "./tracks",
        );
        if (existsSync(downloadDir)) {
            rmSync(downloadDir, { recursive: true });
        }
        mkdirSync(downloadDir);

        const providers = [deezer, YoutubeMusic, Youtube];
        return new TrackDownloader(spotify, providers, downloadDir);
    };
}
