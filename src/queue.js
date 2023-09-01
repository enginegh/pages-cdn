import { MongoClient } from "mongodb";
import logger from "./lib/logger.js";

export default class MongoQueue {
    constructor(mongo, queuedb, storagedb) {
        this.mongo = mongo;
        this.queuedb = mongo.db(queuedb.split(":")[0]).collection(queuedb.split(":")[1]);
        this.storagedb = mongo.db(storagedb.split(":")[0]).collection(storagedb.split(":")[1]);

        this.pendingFilter = {
            $or: [
                { status: "pending" },
                {
                    status: "locked",
                    locked_until: { $lt: new Date() },
                },
            ],
        };
    }

    ensureIndexes = async () => {
        await this.queuedb.createIndex({ spotify: 1 }, { unique: true });
        await this.storagedb.createIndex({ isrc: 1 }, { unique: true });
        await this.storagedb.createIndex({ spotify: 1 }, { unique: true });
    }

    next = async () => {
        const doc = this.queuedb.findOneAndUpdate(
            this.pendingFilter,
            {
                $set: {
                    status: "locked",
                    locked_until: new Date(Date.now() + 3600000),
                },
            },
            { sort: { _id: 1 }, returnDocument: "after"},
        );
        if (doc) {
            if (await this.storagedb.findOne({ spotify: doc.spotify })) {
                logger.debug(
                    `Skipping ${doc._id} because it already exists in storage`,
                );
                await this.queuedb.deleteOne({ _id: doc._id });
                return this.next();
            }
        }
        return doc;
    }

    stats = async () => {
        const stats = await this.queuedb.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } },
            { $sort: { _id: 1 } },
        ]).toArray();

        return {
            total: stats.reduce((acc, cur) => acc + cur.count, 0),
            pending: stats.find((stat) => stat._id === "pending")?.count || 0,
            locked: stats.find((stat) => stat._id === "locked")?.count || 0,
        };
    }

    unlock = async (id) => {
        await this.queuedb.updateOne(
            { _id: id },
            {
                $set: { status: "pending" },
                $unset: { locked_until: "" },
            },
        );
    }

    markSucceeded = async (ids, manifestEntries) => {
        await this.storagedb.insertMany(manifestEntries, { ordered: false });
        await this.queuedb.deleteMany({ _id: { $in: ids } });

    }

    delete = async (id) => {
        await this.queuedb.deleteOne({ _id: id });
    }

    close = async () => {
        await this.mongo.close();
    }

    static async fromMongoURI(uri, queuedb, storagedb) {
        const mongo = new MongoClient(uri);
        try {
            await mongo.connect();
        }
        catch (error) {
            logger.error(error);
            process.exit(1);
        }

        const mongoqueue = new MongoQueue(mongo, queuedb, storagedb);
        await mongoqueue.ensureIndexes();
        logger.debug("Connected to mongo");
        return mongoqueue;
    }
}