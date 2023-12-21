import { YoutubeDownloader } from "./youtube.js";
import deezer from "./deezer.js";
import logger from "../lib/logger.js";
import SongLink from "./songlink.js";

const songlink = new SongLink();

class Odesli {
    static async search(track) {
        let response;
        try {
            response = await songlink.find(`https://song.link/s/${track.id}`);
        } catch (error) {
            throw new Error(
                `[Odesli] ${error.message} for ${track.name} (${track.id})`,
            );
        }

        const platforms = response.platforms;

        if (platforms.youtubeMusic) {
            logger.debug(
                `[Odesli] Found Youtube Music link for ${track.name} (${track.id})`,
            );
            return platforms.youtubeMusic.url;
        } else if (platforms.youtube) {
            logger.debug(
                `[Odesli] Found Youtube link for ${track.name} (${track.id})`,
            );
            return platforms.youtube.url;
        } else if (platforms.deezer) {
            logger.debug(
                `[Odesli] Found Deezer link for ${track.name} (${track.id})`,
            );
            return platforms.deezer.url;
        } else {
            throw new Error(
                `[Odesli] No downloadable results found for ${track.name} (${track.id})`,
            );
        }
    }

    static async download(url, filename) {
        switch (true) {
            case url.startsWith("https://music.youtube.com/") ||
                url.startsWith("https://www.youtube.com/"):
                return await YoutubeDownloader.download(url, filename);
            case url.startsWith("https://www.deezer.com/"):
                const trackId = url.split("/")[4];
                return await deezer.download(trackId, filename);
            default:
                throw new Error(`[Odesli] Unknown provider for ${url}`);
        }
    }
}

export default Odesli;
