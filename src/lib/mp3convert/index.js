import { statSync } from "fs";
import path from "path";
import Ffmpeg from "fluent-ffmpeg";
import { MAX_ASSET_SIZE } from "../../cpages/constants.js";
import logger from "../logger.js";
import config from "../config.js";
import {
    calculateAudioBitrateByFile,
    deleteFile,
    createTempFilePath,
} from "./utils.js";

const FFMPEG_TIMEOUT = config.ffmpeg_timeout || 8;

const convertToMP3 = (
    inputFilePath,
    outputFilePath,
    bitrate,
    timeoutInMinutes = FFMPEG_TIMEOUT,
) => {
    return new Promise((resolve, reject) => {
        const inputAudio = Ffmpeg(inputFilePath);

        inputAudio
            .noVideo()
            .audioCodec("libmp3lame")
            .audioBitrate(bitrate)
            .toFormat("mp3")
            .output(outputFilePath)
            .outputOptions(["-map_metadata -1"])
            .on("end", () => {
                logger.debug(
                    `Ffmpeg Conversion finished with bitrate ${bitrate}`,
                );
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
};

function resizeAndConvertToMP3(inputFilePath, outputFilePath, bitrate) {
    // calculate bitrate and convert to mp3 if the size is still too large then convert again with bitrate -10k
    return new Promise(async (resolve, reject) => {
        if (!bitrate) {
            bitrate = await calculateAudioBitrateByFile(
                MAX_ASSET_SIZE - 2097152,
                inputFilePath,
            );
        }

        if (bitrate < 32) {
            reject(
                new Error(
                    `Bitrate is too low: ${bitrate} for file: ${inputFilePath}`,
                ),
            );
        } else {
            convertToMP3(inputFilePath, outputFilePath, bitrate)
                .then((filePath) => {
                    const stats = statSync(filePath);
                    if (stats.size < MAX_ASSET_SIZE) {
                        deleteFile(inputFilePath);
                        resolve(filePath);
                    } else {
                        // if size is still too large, try again with bitrate -10k
                        const newBitrate = bitrate - 10;
                        logger.debug(
                            `File size is still too large, trying again with bitrate ${bitrate} -> ${newBitrate}: ${filePath}`,
                        );
                        resolve(
                            resizeAndConvertToMP3(
                                inputFilePath,
                                outputFilePath,
                                newBitrate,
                            ),
                        );
                    }
                })
                .catch((error) => {
                    reject(error);
                });
        }
    });
}

export default async (filePath) => {
    const extname = path.extname(filePath).toLowerCase();
    const stats = statSync(filePath);

    if (extname === ".mp3" && stats.size < MAX_ASSET_SIZE) {
        return filePath;
    }

    const tempFilePath = createTempFilePath(filePath);
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
