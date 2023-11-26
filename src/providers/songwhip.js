import logger from "../lib/logger.js";
import { YoutubeDownloader } from "./youtube.js";
import axios from "axios";

export class SongWhip extends YoutubeDownloader {
    static async search(track) {
        const spotifyUrl = `https://open.spotify.com/track/${track.id}`;
        const response = await axios.post(
            "https://songwhip.com/api/songwhip/create",
            {
                country: "N/A",
                url: spotifyUrl,
            },
        );

        if (!response.status === 200) {
            throw new Error(
                `[SongWhip] No results found for ${track.name} (${track.id})`,
            );
        }

        const links = response.data.data.item.links;

        logger.debug(
            `[Songwhip] Found ${
                links.youtubeMusic ? "Youtube Music" : "Youtube"
            } link for ${track.name} (${track.id})`,
        );
        if (links.youtubeMusic) {
            return links.youtubeMusic[0].link;
        } else if (links.youtube) {
            return links.youtube[0].link;
        } else {
            throw new Error(
                `[SongWhip] No yt result found for ${track.name} (${track.id})`,
            );
        }
    }
}
