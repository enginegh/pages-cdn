import { unlinkSync, writeFileSync } from "fs";
import logger from "./lib/logger.js";
import PQueue from "p-queue";
import TrackDownloader from "./downloader.js";
import Cfetch from "./cpages/index.js";
import MongoQueue from "./queue.js";
import axios from "axios";
import config from "./lib/config.js";

const DEFAULT_CONCURRENCY = 1;
const DEFAULT_TIMEOUT_MINUTES = 15;
const DEFAULT_LIMIT = 1;

async function main() {
    logger.info("Starting");

    const downloader = await TrackDownloader.init(config);
    const mongoqueue = await MongoQueue.fromMongoURI(
        config.mongodb.uri,
        config.mongodb.queue_db,
        config.mongodb.storage_db,
    );

    const queue = new PQueue({
        concurrency: config.concurrency || DEFAULT_CONCURRENCY,
        autoStart: false,
        timeout: (config.timeout || DEFAULT_TIMEOUT_MINUTES) * 60 * 1000,
        throwOnTimeout: false,
    });

    const manifest = [];
    const succeeded = [];

    const stats = await mongoqueue.stats();

    let limit = config.limit || DEFAULT_LIMIT;
    logger.info(
        `Total: ${stats.total}, Pending: ${stats.pending}, Locked: ${stats.locked}, Limit: ${limit}, Concurrency: ${queue.concurrency}`,
    );

    while (limit) {
        const doc = await mongoqueue.next();
        if (!doc) {
            break;
        }

        logger.debug(`Adding to queue: ${doc._id}`);
        queue.add(async () => {
            let success = false;
            try {
                const { track, filePath } = await downloader.download(doc);

                if (doc.locked_until > new Date()) {
                    const manifestEntry = {
                        spotify: track.id,
                        isrc: track.external_ids.isrc,
                        path: encodeURI(
                            filePath.slice(downloader.download_dir.length),
                        ),
                    };
                    manifest.push(manifestEntry);
                    succeeded.push(doc._id);
                    success = true;
                } else {
                    unlinkSync(filePath);
                }
            } catch (error) {
                switch (error.message) {
                    case "invalid id":
                    // starts with "Non existing id"
                    case error.message.startsWith("Non existing id") &&
                        error.message:
                        logger.error(
                            `Skipping '${doc.spotify}' because it has an invalid id`,
                        );
                        await mongoqueue.delete(doc._id);
                        break;
                    case error.message.startsWith(
                        "Audio duration is too long",
                    ) && error.message:
                        logger.error(
                            `Skipping '${doc.spotify}' because duration is too long`,
                        );
                        await mongoqueue.delete(doc._id);
                        break;
                    default:
                        if (config.ignore_errors) {
                            logger.warn(error.message);
                            await mongoqueue.delete(doc._id);
                        } else {
                            logger.error(error.message);
                        }
                        break;
                }
            } finally {
                if (!success) {
                    await mongoqueue.unlock(doc._id);
                }
            }
        });
        limit--;
    }

    if (queue.size === 0) {
        logger.info("No tracks to download, exiting");
        return await mongoqueue.close();
    }

    logger.info(`Waiting for downloads to finish: ${queue.size}`);
    queue.start();
    await queue.onIdle();
    logger.debug("Queue finished");
    logger.info(`Downloaded ${succeeded.length} tracks`);

    if (succeeded.length === 0) {
        logger.info("No tracks to upload, exiting");
        return await mongoqueue.close();
    }

    logger.debug("Initializing cpages");
    const cfetch = new Cfetch(
        config.cpages.account_id,
        config.cpages.project_name,
        config.cpages.token,
    );

    logger.debug("Writing manifest to disk");
    writeFileSync(
        downloader.download_dir + "/manifest.json",
        JSON.stringify(manifest, null, 2),
    );

    logger.info("Uploading files to cpages");
    const result = await cfetch.push(downloader.download_dir);
    logger.info("Uploading complete");
    const baseUrl = result.url;
    logger.debug(`Manifest url: ${baseUrl}/manifest.json`);

    for (const entry of manifest) {
        entry.url = baseUrl + entry.path;
        delete entry.path;
    }

    logger.info("Storing manifest in mongo & removing queue entries");
    await mongoqueue.markSucceeded(succeeded, manifest);
    logger.debug("Storing complete");

    logger.debug("Removing download directory");
    downloader.clean();

    if (config.webhook) {
        logger.info("Sending webhook");
        const webhook = config.webhook
            .replace("{url}", baseUrl + "/manifest.json")
            .replace("{count}", manifest.length);
        await axios.get(webhook);
    }

    logger.info("Finished");
    return await mongoqueue.close();
}

main();
