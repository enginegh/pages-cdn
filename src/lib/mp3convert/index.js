import { renameSync, statSync } from "fs";
import path from "path";
import Ffmpeg from "fluent-ffmpeg";
import logger from "../logger.js";
import config from "../config.js";
import { deleteFile, videoMetadata, calculateAudioBitrate } from "./utils.js";
import { MAX_ASSET_SIZE as CFPAGES_MAX_ASSET_SIZE } from "../../cpages/constants.js";

const FFMPEG_TIMEOUT = config.ffmpeg_timeout || 8;
const MAX_ASSET_SIZE = CFPAGES_MAX_ASSET_SIZE - 1 * 1024 * 1024; // 1MB for metadata

class AudioConverter {
    constructor(max_asset_size, ffmpeg_timeout, max_duration) {
        this.max_asset_size = max_asset_size || MAX_ASSET_SIZE;
        this.ffmpeg_timeout = ffmpeg_timeout || FFMPEG_TIMEOUT;
        this.max_duration = max_duration || 34 * 60;
        this.ffmpeg_settings = {
            mp3: {
                audioCodec: "libmp3lame",
                toFormat: "mp3",
            },
            ogg: {
                audioCodec: "libvorbis",
                toFormat: "ogg",
            },
        };
    }

    convert = async (inputFilePath, format) => {
        if (!this.check(inputFilePath, format)) {
            const outfile = await this.resizeAndConvert(inputFilePath, format);
            // change extension of inputFilePath to outfile extension
            const newFilePath =
                inputFilePath.slice(0, -path.extname(inputFilePath).length) +
                path.extname(outfile);
            deleteFile(inputFilePath);
            renameSync(outfile, newFilePath);
            return newFilePath;
        }
        return inputFilePath;
    };

    resizeAndConvert = async (inputFilePath, format, bitrate) => {
        if (!bitrate) {
            bitrate = await this.calculateBitrate(inputFilePath);
        }

        const outfile = await this.ffmpegConvert(inputFilePath, {
            bitrate,
            ...this.ffmpeg_settings[format],
        });

        if (!this.check(outfile, format)) {
            const new_bitrate = bitrate - 4; // -4k
            logger.warn(
                `Output file is too big: ${outfile}, trying again with bitrate ${new_bitrate}k`,
            );
            return await this.resizeAndConvert(
                inputFilePath,
                format,
                new_bitrate,
            );
        }

        return outfile;
    };

    check = (inputFilePath, format) => {
        const stats = statSync(inputFilePath);
        const extname = path.extname(inputFilePath).toLowerCase();
        return stats.size < this.max_asset_size && extname === `.${format}`;
    };

    calculateBitrate = async (inputFilePath) => {
        const metadata = await videoMetadata(inputFilePath);
        // reject if duration is bigger than 34 minutes
        if (metadata.format.duration > this.max_duration) {
            throw new Error(
                `File duration is too long: ${metadata.format.duration}, max duration ${this.max_duration}`,
            );
        }

        return calculateAudioBitrate(
            this.max_asset_size - 1 * 1024 * 1024, // 1MB for surity
            metadata.format.duration,
        );
    };

    ffmpegConvert = async (
        inputFilePath,
        { bitrate, audioCodec, toFormat },
    ) => {
        let timer;
        return new Promise((resolve, reject) => {
            const inputAudio = Ffmpeg(inputFilePath);
            const outfile = inputFilePath + ".out." + toFormat;

            inputAudio
                .noVideo()
                .audioCodec(audioCodec)
                .audioBitrate(bitrate)
                .toFormat(toFormat)
                .output(outfile)
                .outputOptions(["-map_metadata -1"])
                .on("end", () => {
                    logger.debug(
                        `Ffmpeg Conversion finished with bitrate ${bitrate}k: ${outfile}`,
                    );
                    resolve(outfile);
                })
                .on("error", (err) => {
                    reject(err);
                })
                .on("start", (commandLine) => {
                    logger.debug("Spawned Ffmpeg with command: " + commandLine);
                })
                .run();

            timer = setTimeout(
                () => {
                    reject(
                        new Error(
                            `Ffpmeg Conversion timed out for ${inputFilePath}`,
                        ),
                    );
                },
                this.ffmpeg_timeout * 60 * 1000,
            );
        }).finally(() => {
            clearTimeout(timer);
        });
    };
}

export default AudioConverter;
