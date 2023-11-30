import axios from "axios";
import { YoutubeDownloader } from "./youtube.js";

const DATA_SEARCH_REGEX = new RegExp(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&\/\/=]*)/gm);

class Odesli extends YoutubeDownloader {
    static async search(track) {
        const spotifyUrl = `https://open.spotify.com/track/${track.id}`;
        let response = await axios.get(`https://api.odesli.co/resolve?url=${spotifyUrl}`);

        response = await axios.get(`https://song.link/s/${response.data.id}`);

        const DATA = response.data.match(DATA_SEARCH_REGEX);

        if (!DATA) {
            throw new Error(
                `[Odesli] No results found for ${track.name} (${track.id})`,
            );
        }
        
        const youtube = DATA.find(provider => provider.startsWith("https://youtube.com"));
        const youtubeMusic = DATA.find(provider => provider.startsWith("https://music.youtube.com"));

        if (youtubeMusic) {
            return youtubeMusic;
        } else if (youtube) {
            return youtube;
        } else {
            throw new Error(
                `[Odesli] No yt result found for ${track.name} (${track.id})`,
            );
        }
    }
}

export default Odesli;