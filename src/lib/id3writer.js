import NodeID3 from "node-id3";
import axios from "axios";
import Ffmpeg from "fluent-ffmpeg";
import path from "path";
import { renameSync } from "fs";
import { deleteFile } from "./utils.js";

export default class ID3Writer {
    static async cretaeImage(track) {
        const url = track.album.images.sort((a, b) => b.width - a.width)[0].url;
        const response = await axios.get(url, { responseType: "arraybuffer" });
        return {
            mime: "image/jpeg",
            type: {
                id: 3,
                name: "Cover (front)",
            },
            description: "",
            imageBuffer: response.data,
        };
    }

    static async createTags(track) {
        // according to the spotify schema write the tags
        const artists = track.artists.map((artist) => artist.name).join(", ");

        const tags = {
            title: track.name,
            artist: artists,
            performerInfo: artists,
            album: track.album.name,
            year: track.album.release_date.substring(0, 4),
            trackNumber: `${track.track_number}/${track.album.total_tracks}`,
        };

        track.artists[0].genres && (tags.genre = track.artists[0].genres[0]);
        track.external_ids.isrc && (tags.ISRC = track.external_ids.isrc);

        return tags;
    }

    static async nodeID3write(track, file_path) {
        const tags = await ID3Writer.createTags(track);
        tags.image = await ID3Writer.cretaeImage(track);
        NodeID3.write(tags, file_path);
    }

    static async ffmpegWrite(track, file_path) {
        const tags = await ID3Writer.createTags(track);
        const outfile = path.join(
            path.dirname(file_path),
            "temp_" + path.basename(file_path),
        );

        return new Promise((resolve, reject) => {
            const inputAudio = Ffmpeg(file_path)
                .audioCodec("copy")
                .addOutputOption("-metadata", `title=${tags.title}`)
                .addOutputOption("-metadata", `artist=${tags.artist}`)
                .addOutputOption("-metadata", `album=${tags.album}`)
                .addOutputOption("-metadata", `year=${tags.year}`)
                .addOutputOption("-metadata", `track=${tags.trackNumber}`)
                .addOutputOption("-metadata", `performer=${tags.performerInfo}`)
                .addOutputOption("-metadata", `ISRC=${tags.ISRC}`);

            if (tags.genre) {
                inputAudio.addOutputOption("-metadata", `genre=${tags.genre}`);
            }

            inputAudio
                .output(outfile)
                .on("end", () => {
                    deleteFile(file_path);
                    renameSync(outfile, file_path);
                    resolve(file_path);
                })
                .on("error", (err) => {
                    deleteFile(outfile);
                    reject(err);
                })
                .run();
        });
    }
}
