import { addPlaylist } from "./featured_playlist.js";
import { sleep } from "./utils.js";

export default async function CategoriesScraper (spotify, queue) {
    const categories = await spotify.fetchCategories();
    console.log(`Found ${categories.length} categories`);

    for (const category of categories) {
        const playlists = await spotify.fetchCategoriesPlaylists(category.id);
        console.log(`Found ${playlists.length} playlists for category ${category.name}`);

        for (const playlist of playlists) {
            await addPlaylist(spotify, queue, playlist);
            await sleep(3);
        }

        console.log(`Scraping completed for Category: ${category.name} Playlist: ${playlists.length}`);
        await sleep(10);
    }
};