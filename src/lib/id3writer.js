import NodeID3 from "node-id3";
import axios from "axios";

export default class ID3Writer {
    static async imageBuffer(url) {
        return await axios
            .get(url, { responseType: "arraybuffer" })
            .then((response) => {
                // add image buffer to track
                return {
                    mime: "jpeg",
                    type: {
                        id: 3,
                        name: "front cover",
                    },
                    description: "",
                    imageBuffer: response.data,
                };
            });
    }

    static async spotifyWrite(track, file_path) {
        // according to the spotify schema write the tags
        const artists = track.artists.map((artist) => artist.name).join(", ");

        const tags = {
            title: track.name,
            artist: artists,
            performerInfo: artists,
            album: track.album.name,
            year: track.album.release_date.substring(0, 4),
            trackNumber: track.track_number,
        };

        const imageUrl = track.album.images.sort((a, b) => b.width - a.width)[0]
            .url;
        tags.image = await ID3Writer.imageBuffer(imageUrl);
        track.artists[0].genres && (tags.genre = track.artists[0].genres[0]);
        track.external_ids.isrc && (tags.ISRC = track.external_ids.isrc);

        // add image buffer to track
        return NodeID3.write(tags, file_path);
    }
}
