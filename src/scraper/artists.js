import { sleep } from './utils.js';


export const addArtist = async (spotify, queue, artist) => {
    const albums = await spotify.fetchArtistAlbums(artist);
    console.log(`Found ${albums.length} albums for artist "${artist.name}"`);

    for (const album of albums) {
        const tracks = await spotify.albumTracks(album.id);

        const tasks = tracks.map((track) => {
            return { spotify: track.id };
        });

        try {
            const result = await queue.insertMany(tasks, {
                ordered: false,
            });
            console.log(
                `[${tasks.length}]\tAlbum: ${album.name} \t-> Inserted ${result.insertedCount} tracks`,
            );
        } catch (error) {
            if (error.code === 11000) {
                console.log(
                    `[${tasks.length}]\tAlbum: ${album.name} \t-> Inserted ${error.insertedCount} tracks`,
                );
            } else console.error(error);
        }

        await sleep(1);
    }

    console.log(
        `Scraping completed for Artist: ${artist.name}, Albums: ${albums.length}`,
    );
};

export default async function ArtistsScraper(spotify, queue) {
    const featuredPlaylists = await spotify.fetchFeaturedPlaylists();
    console.log(`Found ${featuredPlaylists.length} playlists`);

    const artists = new Set();

    for (const playlist of featuredPlaylists) {
        const tracks = await spotify.fetchTracksFromPlaylist(playlist.id);
        console.log(`Found ${tracks.length} tracks for playlist "${playlist.name}"`);

        for (const track of tracks) {
            for (const artist of track.artists) {
                artists.add(artist);
            }
        }

        await sleep(1);
    }

    console.log(`Found ${artists.size} artists`);

    for (const artist of artists) {
        await addArtist(spotify, queue, artist);
        await sleep(1);
    }
}