import { parse } from "smol-toml";
import { readFileSync, writeFileSync } from "fs";
import logger from "./lib/logger.js";
import PQueue from "p-queue";
import { MongoClient } from "mongodb";
import TrackDownloader from "./downloader.js";
import Cfetch from "./cpages/index.js";

async function main() {
    logger.info("Starting");
    const config = parse(
        process.env.CONFIG || readFileSync("./config.toml", "utf-8"),
    );

    const downloader = await TrackDownloader.init(config);
    const mongo = new MongoClient(config.mongodb.uri);
    try {
        await mongo.connect();
        logger.debug("Connected to mongo");
    } catch (error) {
        logger.error(error);
        process.exit(1);
    }

    const queuecol = mongo
        .db(config.mongodb.queue_db)
        .collection(config.mongodb.queue_collection);
    await queuecol.createIndex({ uri: 1 }, { unique: true });

    const storagecol = mongo
        .db(config.mongodb.storage_db)
        .collection(config.mongodb.storage_collection);
    await storagecol.createIndex({ isrc: 1 }, { unique: true });
    await storagecol.createIndex({ spotify: 1 }, { unique: true });

    const queue = new PQueue({
        concurrency: config.downloader.concurrency || 1,
        autoStart: false,
    });

    const manifest = [];
    const succeeded = [];

    const total_queue = await queuecol.countDocuments({
        $or: [
            { status: "pending" },
            {
                status: "locked",
                locked_until: { $lte: new Date() },
            },
        ],
    });
    const limit = config.downloader.limit || 100;
    logger.info(`Total queue: ${total_queue}, queue limit: ${limit}`);
    while (limit) {
        // find and lock a pending track, set locked_by to "me" and locked_until to now + 1 hour
        const doc = await queuecol.findOneAndUpdate(
            // find a pending track that is not locked and locked_until is in the past or not set
            // the status should be pending, but if it's locked, then the locked_until should be in the past
            {
                $or: [
                    { status: "pending" },
                    {
                        status: "locked",
                        locked_until: { $lte: new Date() },
                    },
                ],
            },
            {
                $set: {
                    status: "locked",
                    locked_until: new Date(Date.now() + 3600000),
                },
            },
            { sort: { _id: 1 }, returnDocument: "after" },
        );

        if (!doc) {
            break;
        }

        if (await storagecol.findOne({ spotify: doc.uri })) {
            logger.debug(
                `Skipping ${doc._id} because it already exists in storage`,
            );
            await queuecol.deleteOne({ _id: doc._id });
            continue;
        }

        logger.debug(`Adding to queue: ${doc._id}`);
        queue.add(
            async () => {
                let success = false;
                try {
                    const { track, filePath } = await downloader.download(
                        doc.uri,
                    );
                    // store track.uri, track.external_ids.isrc, and filePath without downloader.download_dir
                    // skip if locked_until is in the past

                    if (doc.locked_until > new Date()) {
                        const manifestEntry = {
                            spotify: track.uri,
                            isrc: track.external_ids.isrc,
                            path: encodeURI(
                                filePath.slice(downloader.download_dir.length),
                            ),
                        };
                        manifest.push(manifestEntry);
                        succeeded.push(doc._id);
                        success = true;
                    }
                } catch (error) {
                    logger.error(error.message);
                } finally {
                    if (!success) {
                        await queuecol.updateOne(
                            { _id: doc._id },
                            {
                                $set: { status: "pending" },
                                $unset: { locked_until: "" },
                            },
                        );
                    }
                }
            },
            {
                timeout: 3600000,
                throwOnTimeout: false,
            },
        );
        limit--;
    }

    if (queue.size === 0) {
        logger.info("No tracks to download, exiting");
        await mongo.close();
        process.exit(0);
    }

    // print queue length
    logger.debug(`Queue length: ${queue.size}`);
    logger.info("Waiting for queue to finish");
    queue.start();
    await queue.onIdle();
    logger.debug("Queue finished");
    // print downloads count
    logger.info(`Downloaded ${succeeded.length} tracks`);

    if (succeeded.length === 0) {
        logger.info("No tracks downloaded, exiting");
        await mongo.close();
        process.exit(0);
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
    logger.debug(`Base url: ${baseUrl}`);
    logger.info("Uploading complete");

    for (const entry of manifest) {
        entry.url = baseUrl + entry.path;
        delete entry.path;
    }

    logger.info("Storing manifest in mongo");
    await storagecol.insertMany(manifest);
    logger.debug("Storing complete");

    logger.info("Deleting succeeded entries from queue");
    await queuecol.deleteMany({ _id: { $in: succeeded } });
    downloader.deleteDownloadDir();
    logger.debug("Deletion complete");

    await mongo.close();

    logger.info("Finished");
}

main();
