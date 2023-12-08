import ScraperSpotify from "./scraper_spotify.js";
import { MongoClient } from "mongodb";
import config from "../lib/config.js";
import { readFileSync } from "fs";

import minimist from "minimist";

const argv = minimist(process.argv.slice(2));

const sleep = (seconds) => {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

const scrape = async (playlistId) => {
    const mongo = new MongoClient(config.mongodb.uri);
    await mongo.connect();
    const queue = mongo
        .db(config.mongodb.queue_db.split(":")[0])
        .collection(config.mongodb.queue_db.split(":")[1]);

    const spotify = await ScraperSpotify.fromCredentials(
        config.spotify.client_id,
        config.spotify.client_secret,
    );

    const tracks = await spotify.getTracksFromPlaylist(playlistId);
    const albums = await spotify.getAlbumsAndArtistAlbums(tracks);

    console.log(
        `\nFound ${albums.length} albums for playlist "${playlistId}"\n`,
    );

    for (const albumId of albums) {
        const album = await spotify.album(albumId);
        // console.log(`Found ${album.tracks.items.length} tracks for album "${album.name}"`);
        const task = album.tracks.items.map((item) => {
            return { spotify: item.id };
        });
        try {
            const result = await queue.insertMany(task, { ordered: false });
            console.log(
                `[${task.length}] ${album.name} -> Inserted ${result.insertedCount} tracks`,
            );
        } catch (error) {
            if (error.code === 11000) {
                const duplicateCount = error.result.result.writeErrors.length;
                console.log(
                    `[${task.length}] ${album.name} -> Found ${duplicateCount} duplicates, Inserted ${error.insertedCount} tracks`,
                );
            } else console.error(error);
        }

        await sleep(1);
    }

    await mongo.close();
};

if (argv.list) {
    const json = {};
    json.playlists = Array.from(
        new Set(readFileSync("playlists.txt").toString().split("\n")),
    );
    console.log(`matrix=${JSON.stringify(json)}`);
} else if (argv.id || argv._[0]) {
    await scrape(argv.id);
} else {
    console.error("No arguments provided");
}
