import minimist from "minimist";
import ScraperSpotify from "./scraper_spotify.js";
import { MongoClient } from "mongodb";
import config from "../lib/config.js";
import FeaturedPlaylistsScraper from "./featured_playlist.js";
import CategoriesScraper from "./categories.js";

const argv = minimist(process.argv.slice(2));

async function runScraper(fn) {
    const mongo = new MongoClient(config.mongodb.uri);
    await mongo.connect();
    const queue = mongo
        .db(config.mongodb.queue_db.split(":")[0])
        .collection(config.mongodb.queue_db.split(":")[1]);

    const spotify = await ScraperSpotify.fromCredentials(
        config.spotify.client_id,
        config.spotify.client_secret,
    );

    await fn(spotify, queue);

    await mongo.close();
}

async function main() {
    if (argv._[0] === "featured-playlists") {
        await runScraper(FeaturedPlaylistsScraper);
    } else if (argv._[0] === "categories") {
        await runScraper(CategoriesScraper);
    }
}

main();