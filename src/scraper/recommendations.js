import { sleep, chunkArray } from "./utils.js";

export async function addRecommendations({ spotify, queue, tracks, artists }) {
    const recommendations = await spotify.fetchRecommendations({
        seed_tracks: tracks,
        seed_artists: artists,
    });

    const tasks = recommendations.map((track) => {
        return { spotify: track.id };
    });

    try {
        const result = await queue.insertMany(tasks, { ordered: false });
        console.log(
            `[${tasks.length}]\t->Inserted ${result.insertedCount} tracks`,
        );
    } catch (error) {
        if (error.code === 11000) {
            console.log(
                `[${tasks.length}]\t-> Inserted ${error.insertedCount} tracks`,
            );
        } else console.error(error);
    }
}

export default async function RecommendationsScraper(spotify, queue) {
    const featuredPlaylists = await spotify.fetchFeaturedPlaylists();
    console.log(`Found ${featuredPlaylists.length} playlists`);

    for (const playlist of featuredPlaylists) {
        const tracks = await spotify.fetchTracksFromPlaylist(playlist.id);
        console.log(
            `Found ${tracks.length} tracks for playlist "${playlist.name}"`,
        );

        const randomizedTracks = tracks.sort(() => Math.random() - 0.5);
        const trackChunks = chunkArray(randomizedTracks, 5);

        for (const chunk of trackChunks) {
            const tracks = chunk.map((track) => track.id);
            await addRecommendations({ spotify, queue, tracks });
            await sleep(1);
        }

        const artists = new Set();
        for (const track of tracks) {
            for (const artist of track.artists) {
                artists.add(artist);
            }
        }

        console.log(`Found ${artists.size} artists`);
        const randomizedArtists = Array.from(artists).sort(
            () => Math.random() - 0.5,
        );
        const artistChunks = chunkArray(randomizedArtists, 5);

        for (const chunk of artistChunks) {
            const artists = chunk.map((artist) => artist.id);
            await addRecommendations({ spotify, queue, artists });
            await sleep(1);
        }

        console.log(
            `Scraping completed for Playlist: ${playlist.name}, Tracks: ${tracks.length}`,
        );

        await sleep(5);
    }
}
