// checks if a files is in mp3 format and size is less than 25 * 1024 * 1024 bytes
// if size is not less than 25 * 1024 * 1024 bytes, bitrate is lowered to 128k
// if mp3 file is not found, it is converted from the original file then the size is checked again

import { spawn } from "child_process";
import { statSync, renameSync, unlinkSync } from "fs";
import path from "path";
import logger from "./logger.js";

const convertToMP3 = async (
    inputFilePath,
    outputFilePath,
    bitrate = "320k",
) => {
    return new Promise((resolve, reject) => {
        // output file size should be less than 25 * 1024 * 1024 bytes

        const ffmpegArgs = [
            "-nostdin",
            "-y",
            "-i",
            inputFilePath,
            "-codec:a",
            "libmp3lame",
            "-vn",
            "-b:a",
            bitrate,
            outputFilePath,
        ];

        const ffmpegProcess = spawn("ffmpeg", ffmpegArgs, { timeout: 600 * 1000 });
        logger.debug(
            `Converting to MP3 with arguments: ${ffmpegArgs.join(" ")}`,
        );

        ffmpegProcess.on("error", (error) => {
            logger.warn(`Error converting to MP3: ${error}`);
            reject(error);
        });

        ffmpegProcess.on("close", (code) => {
            if (code === 0) {
                unlinkSync(inputFilePath); // Remove original file
                logger.debug("Conversion successful.");
                resolve(outputFilePath);
            } else {
                logger.warn(`FFmpeg process exited with code ${code}`);
                reject(`FFmpeg process exited with code ${code}`);
            }
        });
    });
};

export default async (filePath) => {
    const extname = path.extname(filePath);
    const stats = statSync(filePath);
    if (stats.size < 25 * 1024 * 1024) {
        if (extname === ".mp3") {
            return filePath;
        } else {
            // replace extension with mp3
            const newFilePath = filePath.slice(0, -extname.length) + ".mp3";
            const bitrate =
                stats.size < 10 * 1024 * 1024
                    ? "320k"
                    : stats.size < 13 * 1024 * 1024
                        ? "256k"
                        : "128k";
            return await convertToMP3(filePath, newFilePath, bitrate);
        }
    } else {
        // convert to mp3 with bitrate 128k
        const tempFilePath = filePath + ".og" + extname;
        try {
            renameSync(filePath, tempFilePath);
            const newFilePath = filePath.slice(0, -extname.length) + ".mp3";
            return await convertToMP3(tempFilePath, newFilePath, "128k");
        } catch (error) {
            renameSync(tempFilePath, filePath);
            throw error;
        }
    }
};
