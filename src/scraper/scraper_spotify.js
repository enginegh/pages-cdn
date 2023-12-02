import Spotify from '../lib/spotify.js';

export default class ScraperSpotify extends Spotify {
    constructor(clientId, clientSecret) {
        super(clientId, clientSecret);
    }

    fetchTracksFromPlaylist = async (id) => {
        const playlist = await this.playlist(id);
        return playlist.tracks.items.map((item) => item.track);
    }

    fetchArtistAlbums = async (artist) => {
        return await this.artistAllAlbums(artist.id);
    }

    fetchAlbumsForTrack = async (track) => {
        const albums = new Set();
        for (const artist of track.artists) {
            const artistAlbums = await this.fetchArtistAlbums(artist);
            for (const album of artistAlbums) {
                albums.add(album.id);
            }
            await sleep(3);
        }

        return Array.from(albums);
    }

    getAlbumsAndArtistAlbums = async (tracks) => {
        const albums = new Set();
        for (const track of tracks) {
            const trackAlbums = await this.fetchAlbumsForTrack(track);
            console.log(
                `Found ${trackAlbums.length} albums for track "${track.name}"`,
            );

            for (const album of trackAlbums) {
                albums.add(album);
            }

            await sleep(5);
        }

        return Array.from(albums);
    }

    fetchFeaturedPlaylists = async (country = "IN") => {
        const playlists = new Set();
        let offset = 0;
        let limit = 50;
        let response = null;

        do {
            response = await this.fetch(`/browse/featured-playlists`, {
                params: { offset, limit, country: country },
            });
            response.playlists.items.forEach((item) => playlists.add(item));
            offset += limit;
        } while (response.playlists.next);

        return Array.from(playlists);
    }

    fetchCategories = async (country = "IN") => {
        const categories = new Set();
        let offset = 0;
        let limit = 50;
        let response = null;

        do {
            response = await this.fetch(`/browse/categories`, {
                params: { offset, limit, country: country },
            });
            response.categories.items.forEach((item) => categories.add(item));
            offset += limit;
        } while (response.categories.next);

        return Array.from(categories);
    }

    fetchCategoriesPlaylists = async (category) => {
        const playlists = new Set();
        let offset = 0;
        let limit = 50;
        let response = null;

        do {
            response = await this.fetch(`/browse/categories/${category}/playlists`, {
                params: { offset, limit },
            });
            response.playlists.items.forEach((item) => playlists.add(item));
            offset += limit;
        } while (response.playlists.next);

        return Array.from(playlists);
    }

    static async fromCredentials(client_id, client_secret) {
        let token = Spotify.getTokenFromCache();
        if (!token) {
            token = await Spotify.getToken(client_id, client_secret);
        }

        const spotify = new ScraperSpotify(client_id, client_secret);
        spotify.updateToken(token);
        return spotify;
    }
}