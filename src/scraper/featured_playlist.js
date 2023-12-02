import { sleep } from "./utils.js";

export const addPlaylist = async (spotify, queue, playlist) => {
    const tracks = await spotify.fetchTracksFromPlaylist(playlist.id);

    const tasks = tracks.map((track) => {
        return { spotify: track.id };
    });

    try {
        const result = await queue.insertMany(tasks, { ordered: false });
        console.log(
            `[${tasks.length}]\tPlaylist: ${playlist.name} \t-> Inserted ${result.insertedCount} tracks`,
        );
    } catch (error) {
        if (error.code === 11000) {
            const duplicateCount = error.result.result.writeErrors.length;
            console.log(
                `[${tasks.length}]\tPlaylist: ${playlist.name} \t-> Found ${duplicateCount} duplicates, Inserted ${error.insertedCount} tracks`,
            );
        } else console.error(error);
    };
};


export default async function FeaturedPlaylistsScraper(spotify, queue) {
    const playlists = await spotify.fetchFeaturedPlaylists();
    console.log(`Found ${playlists.length} playlists`);

    for (const playlist of playlists) {
        await addPlaylist(spotify, queue, playlist);
        await sleep(1);
    }

    console.log(`Scraping completed for ${playlists.length} playlists`);
}