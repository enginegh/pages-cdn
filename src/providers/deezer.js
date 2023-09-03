import axios from "axios";
import crypto from "crypto";
import fs from "fs";
import { getQueryFromMetadata } from "../lib/query.js";
import logger from "../lib/logger.js";
import { compareTwoStrings } from "string-similarity";

export default class DeezerDownloader {
    constructor(cookies, proxy) {
        this.header = {
            Pragma: "no-cache",
            Origin: "https://www.deezer.com",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "*/*",
            "Cache-Control": "no-cache",
            "X-Requested-With": "XMLHttpRequest",
            Connection: "keep-alive",
            Referer: "https://www.deezer.com/login",
            DNT: "1",
            Cookie: cookies,
        };

        this.session = axios.create({
            headers: this.header,
            withCredentials: true,
            validateStatus: (status) => status < 500,
            proxy: proxy,
        });
    }

    md5(data, type = "ascii") {
        const md5sum = crypto.createHash("md5");
        md5sum.update(data.toString(), type);
        return md5sum.digest("hex");
    }

    getDownloadURL = (trackId, md5origin, mediaver = 4, fmt = 1) => {
        const step1 = [md5origin, fmt, trackId, mediaver].join("¤");

        let step2 = this.md5(step1) + "¤" + step1 + "¤";
        while (step2.length % 16 > 0) step2 += " ";

        const data = crypto
            .createCipheriv("aes-128-ecb", "jo6aey6haid2Teih", "")
            .update(step2, "ascii", "hex");
        return data;
    };

    getBlowfishKey = (trackId) => {
        const SECRET = "g4el58wc0zvf9na1";
        const idMd5 = this.md5(trackId);
        let bfKey = "";
        for (let i = 0; i < 16; i++) {
            bfKey += String.fromCharCode(
                idMd5.charCodeAt(i) ^
                    idMd5.charCodeAt(i + 16) ^
                    SECRET.charCodeAt(i),
            );
        }
        return bfKey;
    };

    decryptChunk(chunk, blowFishKey) {
        const decipher = crypto.createDecipheriv(
            "bf-cbc",
            blowFishKey,
            "\x00\x01\x02\x03\x04\x05\x06\x07",
        );
        decipher.setAutoPadding(false);
        return Buffer.concat([decipher.update(chunk), decipher.final()]);
    }

    decryptStream = async (response, bfKey, stream) => {
        let i = 0;
        let chunk;
        response.data.on("readable", () => {
            while ((chunk = response.data.read(2048))) {
                if (i % 3 > 0 || chunk.length < 2048) {
                    stream.write(chunk);
                } else {
                    stream.write(this.decryptChunk(chunk, bfKey));
                }
                i++;
            }
        });
    };

    downloadTrack = async (trackId, output_file) => {
        const track = await this.getTrackInfo(trackId);

        const trackQuality =
            track.FILESIZE_MP3_320 !== "0"
                ? 3
                : track.FILESIZE_MP3_256 !== "0"
                ? 5
                : 1;
        const urlkey = this.getDownloadURL(
            track.SNG_ID,
            track.MD5_ORIGIN,
            track.MEDIA_VERSION,
            trackQuality,
        );
        const key = this.getBlowfishKey(track.SNG_ID);

        output_file = output_file + ".mp3";

        const url = `https://e-cdns-proxy-${track.MD5_ORIGIN[0]}.dzcdn.net/mobile/1/${urlkey}`;

        const response = await this.session.get(url, {
            responseType: "stream",
        });

        logger.debug(
            `Downloading ${track.SNG_TITLE} - ${track.ART_NAME} (${trackQuality})`,
        );

        return await new Promise((resolve, reject) => {
            const stream = fs.createWriteStream(output_file);
            this.decryptStream(response, key, stream);
            response.data.on("end", () => {
                logger.debug(
                    `Downloaded ${track.SNG_TITLE} - ${track.ART_NAME} (${trackQuality})`,
                );
                resolve(output_file);
            });
            response.data.on("error", (error) => {
                reject(error);
            });
        });
    };

    getTrackInfo = async (trackId) => {
        return this.session
            .get(`https://www.deezer.com/en/track/${trackId}`)
            .then((response) => {
                fs.writeFileSync("index.html", response.data);
                const trackInfos = response.data.match(/{"DATA":({.+})}/gm);

                if (!trackInfos) {
                    throw new Error("Track not found");
                }

                const trackInfo = JSON.parse(trackInfos[0])["DATA"];

                if (!trackInfo.MD5_ORIGIN) {
                    throw new Error("Login incorrect");
                }

                return trackInfo;
            });
    };

    search = async (inputTrack) => {
        const query = getQueryFromMetadata(inputTrack);
        const response = await this.session.get(
            `https://api.deezer.com/search?q=${query}`,
        );
        const tracks = response.data.data;
        if (!tracks.length) {
            logger.debug(`[Deezer] No results found for ${query}`);
            return null;
        }

        const track = tracks[0];

        const score = compareTwoStrings(track.title.toLowerCase(), inputTrack.name.toLowerCase())
        
        if (score < 0.7) {
            logger.debug(`[Deezer] No matching results found for ${query}`);
            return null;
        }

        return track.id;
    };

    downloadTrackById = async (trackId) => {
        try {
            const trackInfo = await this.getTrackInfo(trackId);
            const outputFileName = `${trackInfo.ART_NAME} - ${trackInfo.SNG_TITLE}.mp3`;
            await this.downloadTrack(trackInfo, outputFileName);
        } catch (error) {
            logger.error(error);
        }
    };

    downloadTrackByISRC = async (isrc) => {
        const track = await this.session
            .get(`https://api.deezer.com/track/isrc:${isrc}`)
            .then((response) => {
                return response.data;
            });
        if (track.error) {
            throw new Error(track.error.message);
        }
        const trackInfo = await this.getTrackInfo(track.id);
        const outputFileName = `${trackInfo.ART_NAME} - ${trackInfo.SNG_TITLE}.mp3`;
        await this.downloadTrack(trackInfo, outputFileName);
    };
}
