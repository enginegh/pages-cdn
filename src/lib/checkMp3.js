// checks if a files is in mp3 format and size is less than 25 * 1024 * 1024 bytes
// if size is not less than 25 * 1024 * 1024 bytes, bitrate is lowered to 128k
// if mp3 file is not found, it is converted from the original file then the size is checked again

import { statSync, renameSync, unlinkSync } from "fs";
import path from "path";
import Ffmpeg from "fluent-ffmpeg";
import { MAX_ASSET_SIZE } from "../cpages/constants.js";
import logger from "./logger.js";

const calculateAudioBitrate = (requiredSize, duration, max = "320k") => {
    // return in format 128k, 256k, 320k
    const bitrate = Math.floor(requiredSize * 8 / duration / 1000);
    return bitrate > 320 ? max : bitrate + "k";
};

function resizeAndConvertToMP3(inputFilePath, outputFilePath, timeoutInMinutes = 5) {
    return new Promise((resolve, reject) => {
        const inputAudio = Ffmpeg(inputFilePath);

        inputAudio.ffprobe((err, metadata) => {
            if (err) {
                reject(err);
                return;
            }

            const audioBitrate = calculateAudioBitrate(MAX_ASSET_SIZE - 1048576, metadata.format.duration);

            inputAudio
                .noVideo()
                .audioCodec('libmp3lame')
                .audioBitrate(audioBitrate)
                .toFormat('mp3')
                .output(outputFilePath)
                .outputOptions([
                    '-map_metadata -1',
                ])
                .on('end', () => {
                    logger.debug(`Ffmpeg Conversion finished with bitrate ${audioBitrate}`);
                    unlinkSync(inputFilePath);
                    resolve(outputFilePath);
                })
                .on('error', (err) => {
                    reject(err);
                })
                .on('start', function (commandLine) {
                    logger.debug('Spawned Ffmpeg with command: ' + commandLine);
                })
                .run();

            setTimeout(() => {
                reject(new Error('Ffpmeg Conversion timed out'));
            }, timeoutInMinutes * 60 * 1000);
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
        renameSync(tempFilePath, filePath);
        throw error;
    }
};
