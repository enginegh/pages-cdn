import Ffmpeg from "fluent-ffmpeg";
import { unlinkSync } from "fs";

export const calculateAudioBitrate = (requiredSize, duration, max = 320) => {
    // return in format 128, 256, 320
    const bitrate = Math.floor((requiredSize * 8) / duration / 1000);
    return bitrate > max ? max : bitrate;
};

export const videoMetadata = (filePath) => {
    return new Promise((resolve, reject) => {
        const inputAudio = Ffmpeg(filePath);
        inputAudio.ffprobe((err, data) => {
            if (err) {
                reject(err);
            }
            resolve(data);
        });
    });
};

export const deleteFile = (filePath) => {
    try {
        unlinkSync(filePath);
    } catch (error) {
        // ignore if file does not exist
        if (error.code !== "ENOENT") {
            throw error;
        }
    }
};
