import { unlinkSync } from "fs";

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
