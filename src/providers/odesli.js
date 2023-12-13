import axios from "axios";
import { YoutubeDownloader } from "./youtube.js";
import deezer from "./deezer.js";
import logger from "../lib/logger.js";

const DATA_SEARCH_REGEX = new RegExp(
    /(http|ftp|https):\/\/([\w_-]+(?:(?:\.[\w_-]+)+))([\w.,@?^=%&:\/~+#-]*[\w@?^=%&\/~+#-])/gm,
);

class Odesli {
    static async search(track) {
        const response = await axios.get(`https://song.link/s/${track.id}`);

        const DATA = response.data.matchAll(DATA_SEARCH_REGEX);

        if (!DATA) {
            throw new Error(
                `[Odesli] No data found for ${track.name} (${track.id})`,
            );
        }

        const links = {};
        for (const match of DATA) {
            links[match[2]] = match[0];
        }

        switch (true) {
            case Boolean(links["music.youtube.com"]):
                logger.debug(
                    `[Odesli] Found Youtube Music link for ${track.name} (${track.id})`,
                );
                return links["music.youtube.com"];
            case Boolean(links["www.youtube.com"]):
                logger.debug(
                    `[Odesli] Found Youtube link for ${track.name} (${track.id})`,
                );
                return links["www.youtube.com"];
            case Boolean(links["www.deezer.com"]):
                logger.debug(
                    `[Odesli] Found Deezer link for ${track.name} (${track.id})`,
                );
                return links["www.deezer.com"];
            default:
                throw new Error(
                    `[Odesli] No results found for ${track.name} (${track.id})`,
                );
        }
    }


    static async download(url, filename) {
        switch (true) {
            case url.startsWith("https://music.youtube.com/") || url.startsWith("https://www.youtube.com/"):
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