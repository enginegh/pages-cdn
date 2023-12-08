import { MongoClient } from "mongodb";
import logger from "./lib/logger.js";

export default class MongoQueue {
    constructor(mongo, queuedb, storagedb) {
        this.mongo = mongo;
        this.queuedb = mongo
            .db(queuedb.split(":")[0])
            .collection(queuedb.split(":")[1]);
        this.storagedb = mongo
            .db(storagedb.split(":")[0])
            .collection(storagedb.split(":")[1]);

        this.pendingFilter = {
            $or: [
                { locked_until: { $lt: new Date() } },
                { locked_until: { $exists: false } },
            ],
        };
    }

    ensureIndexes = async () => {
        await this.queuedb.createIndex({ spotify: 1 }, { unique: true });

        await this.storagedb.createIndex({ spotify: 1 }, { unique: true });
        await this.storagedb.createIndex({ isrc: 1 });
    };

    next = async () => {
        const doc = await this.queuedb.findOneAndUpdate(
            this.pendingFilter,
            {
                $set: {
                    locked_until: new Date(Date.now() + 3600000),
                },
            },
            { sort: { _id: 1 }, returnDocument: "after" },
        );

        if (!doc.spotify && !doc.isrc) {
            logger.warn(`Invalid doc: ${JSON.stringify(doc)}`);
            return this.deleteAndNext(doc._id);
        }

        if (doc && !doc.redownload) {
            const query = {};

            if (doc.spotify) {
                query.spotify = doc.spotify;
            } else if (doc.isrc) {
                query.isrc = doc.isrc;
            }

            const existing = await this.storagedb.findOne(query);
            if (existing) {
                logger.debug(
                    `Skipping ${
                        doc.spotify ?? doc.isrc
                    } because it already exists in storage`,
                );
                return this.deleteAndNext(doc._id);
            }
        }
        return doc;
    };

    deleteAndNext = async (id) => {
        await this.queuedb.deleteOne({ _id: id });
        return this.next();
    };

    stats = async () => {
        // if locked_until is in the past, it's pending
        // if locked_until is in the future, it's locked
        // if not locked_until, it's pending

        // using aggregation

        const stats = await this.queuedb
            .aggregate([
                {
                    $facet: {
                        pending: [
                            {
                                $match: this.pendingFilter,
                            },
                            {
                                $count: "count",
                            },
                        ],
                        locked: [
                            {
                                $match: {
                                    locked_until: { $gt: new Date() },
                                },
                            },
                            {
                                $count: "count",
                            },
                        ],
                        total: [
                            {
                                $count: "count",
                            },
                        ],
                    },
                },
                {
                    $project: {
                        pending: { $arrayElemAt: ["$pending.count", 0] },
                        locked: { $arrayElemAt: ["$locked.count", 0] },
                        total: { $arrayElemAt: ["$total.count", 0] },
                    },
                },
            ])
            .toArray();

        const { pending, locked, total } = stats[0];

        return {
            pending: pending || 0,
            locked: locked || 0,
            total: total || 0,
        };
    };

    unlock = async (id) => {
        await this.queuedb.updateOne(
            { _id: id },
            {
                $unset: { locked_until: "" },
            },
        );
    };

    markSucceeded = async (ids, manifestEntries) => {
        // update or upsert using spotify or isrc
        const result = await this.storagedb.bulkWrite(
            manifestEntries.map((entry) => ({
                updateOne: {
                    filter: {
                        spotify: entry.spotify,
                        isrc: entry.isrc,
                    },
                    update: { $set: entry },
                    upsert: true,
                },
            })),
        );
        // log upsert and update count separately
        logger.debug(
            `Inserted ${result.upsertedCount} and updated ${result.modifiedCount} entries in storage`,
        );

        // delete from queue
        await this.queuedb.deleteMany({ _id: { $in: ids } });
    };

    delete = async (id) => {
        await this.queuedb.deleteOne({ _id: id });
    };

    close = async (exit = false) => {
        await this.mongo.close();
        if (exit) {
            logger.debug("Exiting");
            process.exit(0);
        }
    };

    static async fromMongoURI(uri, queuedb, storagedb) {
        const mongo = new MongoClient(uri);
        try {
            await mongo.connect();
        } catch (error) {
            logger.error(error);
            process.exit(1);
        }

        const mongoqueue = new MongoQueue(mongo, queuedb, storagedb);
        await mongoqueue.ensureIndexes();
        logger.debug("Connected to mongo");
        return mongoqueue;
    }
}
