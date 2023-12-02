import axios from "axios";
import { existsSync, writeFileSync, readFileSync } from "fs";
import ID3Writer from "./id3writer.js";
import logger from "./logger.js";

const DEFAULT_CACHE_PATH = ".spotify.cache";

export default class Spotify {
    constructor(client_id, client_secret) {
        this.client_id = client_id;
        this.client_secret = client_secret;
        this.session = axios.create({
            baseURL: "https://api.spotify.com/v1",
        });
    }

    static getTokenFromCache = (cache_path) => {
        const cachePath = cache_path || DEFAULT_CACHE_PATH;
        if (existsSync(cachePath)) {
            const cache = JSON.parse(readFileSync(cachePath));
            if (cache.expires_on > Date.now()) {
                return cache;
            }
            logger.info("Spotify token expired");
        }
        return null;
    };

    updateToken = (token) => {
        this.access_token = token.access_token;
        this.token_type = token.token_type;
        this.token_expires_on = token.expires_on;
        this.session.defaults.headers.common["Authorization"] =
            `${this.token_type} ${this.access_token}`;
        writeFileSync(DEFAULT_CACHE_PATH, JSON.stringify(token));
    };

    checkAndUpdateToken = async () => {
        if (this.token_expires_on < Date.now()) {
            const token = await Spotify.getToken(
                this.client_id,
                this.client_secret,
            );
            this.updateToken(token);
        }
    };

    static getToken = async (client_id, client_secret) => {
        const authOptions = {
            url: "https://accounts.spotify.com/api/token",
            method: "post",
            headers: {
                Authorization:
                    "Basic " +
                    new Buffer.from(client_id + ":" + client_secret).toString(
                        "base64",
                    ),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data: {
                grant_type: "client_credentials",
            },
        };

        logger.info("Requesting new spotify token");
        return axios(authOptions)
            .then((response) => {
                const data = response.data;
                data.expires_on = Date.now() + data.expires_in * 1000;
                return data;
            })
            .catch((error) => {
                if (error.response) {
                    throw new Error(
                        `Spotify API Error: ${JSON.stringify(
                            error.response.data,
                        )}`,
                    );
                }
                throw error.message;
            });
    };

    async fetch(path, params) {
        await this.checkAndUpdateToken();

        return this.session(path, params)
            .then((response) => {
                return response.data;
            })
            .catch((error) => {
                if (error.response) {
                    if (error.response.status === 429) {
                        const retryAfter = error.response.headers['retry-after'];
                        if (retryAfter) {
                            const retryAfterSeconds = parseInt(retryAfter, 10) + 2;
                            return new Promise((resolve) => {
                                setTimeout(resolve, retryAfterSeconds * 1000);
                            }).then(() => this.fetch(path, params));
                        }
                    } else
                        if (error.response.data?.error?.message) {
                            throw new Error(error.response.data.error.message);
                        } else {
                            throw new Error(error.response.data);
                        }
                } else {
                    throw new Error(error.message);
                }
            });
    }

    async search(query, limit = 50) {
        return this.fetch("/search", {
            params: { q: query, type: "track", limit },
        }).then((response) => {
            return response.tracks.items;
        });
    }

    async isrcSearch(isrc) {
        return await this.search(`isrc:${isrc}`, 1).then((tracks) => {
            if (tracks.length > 0) {
                return tracks[0];
            }
            throw new Error(`invalid id`);
        });
    }

    async track(id) {
        return this.fetch(`/tracks/${id}`).then((response) => {
            return response;
        });
    }

    async tracks(ids) {
        return this.fetch(`/tracks`, { params: { ids: ids.join(",") } }).then(
            (response) => {
                return response.tracks;
            },
        );
    }

    async playlist(id) {
        return this.fetch(`/playlists/${id}`).then((response) => {
            return response;
        });
    }

    async album(id) {
        return this.fetch(`/albums/${id}`).then((response) => {
            return response;
        });
    }

    async artist(id) {
        return this.fetch(`/artists/${id}`).then((response) => {
            return response;
        });
    }

    async artistAlbums(id, offset = 0, limit = 50) {
        return this.fetch(`/artists/${id}/albums`, {
            params: { offset, limit },
        }).then((response) => {
            return response;
        });
    }

    async artistAllAlbums(id) {
        let albums = [];
        let offset = 0;
        let limit = 50;
        let response = null;
        // use the response.next to get all albums
        do {
            response = await this.artistAlbums(id, offset, limit);
            albums.push(...response.items);
            offset += limit;
        } while (response.next);

        return albums;
    }

    async getRecommendations({
        seed_tracks,
        seed_artists,
        seed_genres,
        market = "IN",
        limit = 20,
    }) {
        return this.fetch("/recommendations", {
            params: {
                seed_tracks: seed_tracks?.join(","),
                seed_artists: seed_artists?.join(","),
                seed_genres: seed_genres?.join(","),
                market,
                limit,
            },
        }).then((response) => {
            return response.tracks;
        });
    }

    async getByType(id, type) {
        switch (type) {
            case "track":
                return this.track(id);
            case "playlist":
                return this.playlist(id);
            case "album":
                return this.album(id);
            case "artist":
                return this.artist(id);
        }
    }

    async url(url) {
        // detect if url is a track or playlist or album or artist and generate the correct id
        const regex =
            /https:\/\/open.spotify.com\/(track|playlist|album|artist)\/([a-zA-Z0-9]+)/gm;
        const match = regex.exec(url);
        if (!match) {
            throw new Error("Invalid spotify url");
        }
        const type = match[1];
        const id = match[2];
        return await this.getByType(id, type);
    }

    async uri(uri) {
        // detect if url is a track or playlist or album or artist and generate the correct id
        const regex = /spotify:(track|playlist|album|artist):([a-zA-Z0-9]+)/gm;
        const match = regex.exec(uri);
        if (!match) {
            throw new Error("Invalid spotify uri");
        }
        const type = match[1];
        const id = match[2];
        return await this.getByType(id, type);
    }

    async get(uri) {
        if (uri.includes("spotify.com")) {
            return await this.url(uri);
        } else if (uri.includes("spotify:")) {
            return await this.uri(uri);
        }
    }

    static async fromCredentials(client_id, client_secret) {
        let token = Spotify.getTokenFromCache();
        if (!token) {
            token = await Spotify.getToken(client_id, client_secret);
        }

        const spotify = new Spotify(client_id, client_secret);
        spotify.updateToken(token);
        return spotify;
    }
}
