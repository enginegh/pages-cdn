import { statSync } from "fs";
import path from "path";
import Ffmpeg from "fluent-ffmpeg";
import { MAX_ASSET_SIZE, MAX_BUCKET_SIZE } from "../../cpages/constants.js";
import logger from "../logger.js";
import config from "../config.js";
import {
    deleteFile,
    createTempFilePath,
    videoMetadata,
    calculateAudioBitrate,
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
                    `Ffmpeg Conversion finished with bitrate ${bitrate}k: ${inputFilePath}`,
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

const resizeAndConvertToMP3 = async (inputFilePath, outputFilePath, bitrate) => {
    // calculate bitrate and convert to mp3 if the size is still too large then convert again with bitrate -10k
    if (!bitrate) {
        const metadata = await videoMetadata(inputFilePath);
        // reject if duration is bigger than 20 minutes
        if (metadata.format.duration > 20 * 60) {
            reject(
                new Error(
                    `File duration is too long: ${metadata.duration}`,
                ),
            );
            return;
        }
        bitrate = calculateAudioBitrate(
            MAX_ASSET_SIZE - 2 * 1024 * 1024,
            metadata.format.duration,
        );
    }

    const filePath = await convertToMP3(inputFilePath, outputFilePath, bitrate);
    const stats = statSync(filePath);
    if (stats.size < MAX_ASSET_SIZE) {
        deleteFile(inputFilePath);
        return filePath;
    }

    // if size is still too large, try again with bitrate -10k
    const newBitrate = bitrate - 10;
    logger.debug(
        `File size is still too large, trying again with bitrate ${bitrate} -> ${newBitrate}: ${filePath}`,
    );
    return await resizeAndConvertToMP3(
        inputFilePath,
        outputFilePath,
        newBitrate,
    );
}

export default async (filePath) => {
    const extname = path.extname(filePath).toLowerCase();
    const stats = statSync(filePath);

    if (extname === ".mp3" && stats.size < MAX_ASSET_SIZE) {
        logger.debug(`File is already mp3 and under size: ${filePath}`);
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
