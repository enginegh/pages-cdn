import { unlinkSync, existsSync, mkdirSync } from "fs";

/**
 * Deletes a file from the file system.
 * @param {string} filePath - The path of the file to be deleted.
 * @throws {Error} If there was an error deleting the file (other than "ENOENT" - file not found).
 */
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

/**
 * Sanitizes a path by replacing special characters with hyphens.
 * @param {string} path - The path to sanitize.
 * @returns {string} - The sanitized path.
 */
export const sanitizePath = (path) => {
    return path.replace(/[\/\\?%*:|"<>#]/g, "-");
};

/**
 * Ensures that a directory exists. If the directory does not exist, it will be created recursively.
 * @param {string} directory - The directory path.
 */
export const ensureDirectoryExists = (directory) => {
    if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true });
    }
};
