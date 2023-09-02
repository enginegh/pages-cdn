import { unlinkSync, writeFileSync } from "fs";
import logger from "./lib/logger.js";
import PQueue from "p-queue";
import TrackDownloader from "./downloader.js";
import Cfetch from "./cpages/index.js";
import MongoQueue from "./queue.js";
import axios from "axios";
import config from "./lib/config.js";

async function main() {
    logger.info("Starting");

    const downloader = await TrackDownloader.init(config);
    const mongoqueue = await MongoQueue.fromMongoURI(
        config.mongodb.uri,
        config.mongodb.queue_db,
        config.mongodb.storage_db,
    );

    const queue = new PQueue({
        concurrency: config.concurrency || 1,
        autoStart: false,
        timeout: (config.timeout || 15) * 60 * 1000, // 15 minutes (in ms)
        throwOnTimeout: false,
    });

    const manifest = [];
    const succeeded = [];

    const stats = await mongoqueue.stats();

    let limit = config.limit || 1;
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
                const { track, filePath } = await downloader.download(
                    doc.spotify,
                );
                // store track.uri, track.external_ids.isrc, and filePath without downloader.download_dir
                // skip if locked_until is in the past

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
                if (error.message === "invalid id") {
                    logger.error(
                        `Skipping '${doc.spotify}' because it has an invalid id`,
                    );
                    await mongoqueue.delete(doc._id);
                } else {
                    logger.error(error.message);
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
        await mongoqueue.close(true);
    }

    // print queue length
    logger.info(`Waiting for downloads to finish: ${queue.size}`);
    queue.start();
    await queue.onIdle();
    logger.debug("Queue finished");
    // print downloads count
    logger.info(`Downloaded ${succeeded.length} tracks`);

    if (succeeded.length === 0) {
        logger.info("No tracks downloaded, exiting");
        await mongoqueue.close(true);
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
    const baseUrl = result.url;
    logger.debug(`Manifest url: ${baseUrl}/manifest.json`);
    logger.info("Uploading complete");

    for (const entry of manifest) {
        entry.url = baseUrl + entry.path;
        delete entry.path;
    }

    logger.info("Storing manifest in mongo & removing queue entries");
    await mongoqueue.markSucceeded(succeeded, manifest);
    logger.debug("Storing complete");

    logger.debug("Removing download directory");
    downloader.deleteDownloadDir();

    if (config.webhook) {
        logger.info("Sending webhook");
        const webhook = config.webhook.replace(
            "{url}",
            baseUrl + "/manifest.json",
        ).replace("{count}", manifest.length);
        await axios.get(webhook);
    }

    logger.info("Finished");
    await mongoqueue.close(true);
}

main();
