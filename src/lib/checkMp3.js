// checks if a files is in mp3 format and size is less than 25 * 1024 * 1024 bytes
// if size is not less than 25 * 1024 * 1024 bytes, bitrate is lowered to 128k
// if mp3 file is not found, it is converted from the original file then the size is checked again

import { statSync, renameSync, unlinkSync } from "fs";
import path from "path";
import Ffmpeg from "fluent-ffmpeg";
import { MAX_ASSET_SIZE } from "../cpages/constants.js";
import logger from "./logger.js";
import config from "./config.js";

const FFMPEG_TIMEOUT = config.ffmpeg_timeout || 8;

const calculateAudioBitrate = (requiredSize, duration, max = "320k") => {
    // return in format 128k, 256k, 320k
    const bitrate = Math.floor((requiredSize * 8) / duration / 1000);
    return bitrate > 320 ? max : bitrate + "k";
};

const deleteFile = (filePath) => {
    try {
        unlinkSync(filePath);
    } catch (error) {
        // ignore if file does not exist
        if (error.code !== "ENOENT") {
            throw error;
        }
    }
};

function resizeAndConvertToMP3(
    inputFilePath,
    outputFilePath,
    timeoutInMinutes = FFMPEG_TIMEOUT,
) {
    return new Promise((resolve, reject) => {
        const inputAudio = Ffmpeg(inputFilePath);

        inputAudio.ffprobe((err, metadata) => {
            if (err) {
                reject(err);
                return;
            }

            const audioBitrate = calculateAudioBitrate(
                MAX_ASSET_SIZE - 3000000,
                metadata.format.duration,
            );

            inputAudio
                .noVideo()
                .inputOptions(["-map_metadata -1"])
                .audioCodec("libmp3lame")
                .audioBitrate(audioBitrate)
                .toFormat("mp3")
                .output(outputFilePath)
                .on("end", () => {
                    logger.debug(
                        `Ffmpeg Conversion finished with bitrate ${audioBitrate}`,
                    );
                    deleteFile(inputFilePath);
                    resolve(outputFilePath);
                })
                .on("error", (err) => {
                    reject(err);
                })
                .on("start", function (commandLine) {
                    logger.debug("Spawned Ffmpeg with command: " + commandLine);
                })
                .run();

            setTimeout(
                () => {
                    reject(
                        new Error(
                            `Ffpmeg Conversion timed out for ${inputFilePath}`,
                        ),
                    );
                },
                timeoutInMinutes * 60 * 1000,
            );
        });
    });
}

export default async (filePath) => {
    const extname = path.extname(filePath).toLowerCase();
    const stats = statSync(filePath);

    if (extname === ".mp3" && stats.size < MAX_ASSET_SIZE) {
        return filePath;
    }

    const tempFilePath = filePath + ".og" + extname;
    renameSync(filePath, tempFilePath);
    // replace extension with .mp3
    let desiredfilePath = filePath.slice(0, -extname.length) + ".mp3";
    try {
        return await resizeAndConvertToMP3(tempFilePath, desiredfilePath);
    } catch (error) {
        deleteFile(tempFilePath);
        deleteFile(desiredfilePath);
        throw error;
    }
};
