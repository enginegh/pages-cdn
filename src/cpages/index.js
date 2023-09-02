import axios from "axios";
import path from "path";
import fs from "fs";
import { hash as blake3hash } from "blake3-wasm";
import mime from "mime";
import { randomUUID } from "crypto";
import PQueue from "p-queue";
import logger from "../lib/logger.js";
import {
    MAX_ASSET_COUNT,
    MAX_ASSET_SIZE,
    MAX_BUCKET_FILE_COUNT,
    MAX_BUCKET_SIZE,
    MAX_DEPLOYMENT_ATTEMPTS,
    MAX_UPLOAD_ATTEMPTS,
    BULK_UPLOAD_CONCURRENCY,
} from "./constants.js";

export default class Cfetch {
    constructor(account_id, project_name, token) {
        this.session = axios.create({
            baseURL: "https://api.cloudflare.com/client/v4",
            headers: { Authorization: `Bearer ${token}` },
        });
        this.account_id = account_id;
        this.project_name = project_name;
    }

    static async fromToken(token, account_id, project_name) {
        const cf = new Cfetch(null, null, token);
        cf.account_id = account_id || (await cf.getAccountID());
        cf.project_name = project_name || (await cf.getPagesProjectName());
        return cf;
    }

    errorHandling = (error) => {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            logger.error(error.response.data.errors[0].message);
            // console.log(error.response.status);
            // console.log(error.response.headers);
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
            logger.error(error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            logger.error(`Error ${error.message}`);
        }
        // console.log(error.config);
    };

    fetchResult = async (path, params) => {
        logger.debug(`${params?.method || "GET"} ${path}`);
        const response = await this.session(path, params).catch(
            this.errorHandling,
        );
        response.data.code = response.status;
        return response.data;
    };

    fethcListResult = async (path, params) => {
        const response = await this.fetchResult(path, params);
        return response.result;
    };

    getAccounts = async () => {
        return await this.fethcListResult("/accounts");
    };

    getAccountID = async (name) => {
        const accounts = await this.getAccounts();
        if (!name) {
            return accounts[0].id;
        } else {
            const account = accounts.find((account) =>
                account.name.toLowerCase().includes(name.toLowerCase()),
            );
            if (account) {
                return account.id;
            } else {
                throw new Error("Account not found");
            }
        }
    };

    getPagesProjects = async () => {
        let existingResponse = await this.fetchResult(
            `/accounts/${this.account_id}/pages/projects`,
        );
        // sort by created_on, newest first
        return existingResponse.result.sort(
            (a, b) => new Date(b.created_on) - new Date(a.created_on),
        );
    };

    createPagesProject = async (name) => {
        logger.info("Creating cloudflare pages project");
        const projectResponse = await this.fetchResult(
            `/accounts/${this.account_id}/pages/projects`,
            {
                method: "POST",
                data: {
                    name: name || "cdn",
                    production_branch: "production",
                },
            },
        );
        return projectResponse.result;
    };

    getPagesProjectName = async () => {
        const projects = await this.getPagesProjects();
        if (projects.length === 0) {
            const newProject = await this.createPagesProject();
            return newProject.name;
        } else {
            return projects[0].name;
        }
    };

    push = async (dir) => {
        const fileMap = await this.validate(dir);

        const manifest = await this.upload(fileMap);

        const formData = new FormData();

        formData.append("manifest", JSON.stringify(manifest));
        formData.append("branch", randomUUID().split("-")[0]);

        let attempts = 0;
        let lastErr;
        while (attempts < MAX_DEPLOYMENT_ATTEMPTS) {
            try {
                const deploymentResponse = await this.fetchResult(
                    `/accounts/${this.account_id}/pages/projects/${this.project_name}/deployments`,
                    {
                        method: "POST",
                        data: formData,
                    },
                );
                return deploymentResponse.result;
            } catch (e) {
                lastErr = e;
                if (!e.success && attempts < MAX_DEPLOYMENT_ATTEMPTS) {
                    logger.warn(
                        `CfPages deployment failed: ${e.message} retrying...`,
                    );
                    // Exponential backoff, 1 second first time, then 2 second, then 4 second etc.
                    await new Promise((resolvePromise) =>
                        setTimeout(
                            resolvePromise,
                            Math.pow(2, attempts++) * 1000,
                        ),
                    );
                } else {
                    logger.error(`CfPages deployment failed: ${e.message}`);
                    throw e;
                }
            }
        }
        // We should never make it here, but just in case
        throw lastErr;
    };

    fetchUploadToken = async () => {
        if (this.jwt && !this.isJwtExpired(this.jwt)) {
            return this.jwt;
        } else {
            const jwt = (
                await this.fetchResult(
                    `/accounts/${this.account_id}/pages/projects/${this.project_name}/upload-token`,
                )
            ).result.jwt;
            this.jwt = jwt;
            return jwt;
        }
    };

    upload = async (fileMap) => {
        const files = [...fileMap.values()];

        let jwt = await this.fetchUploadToken();

        const start = Date.now();

        let attempts = 0;

        const missingHashes = files.map(({ hash }) => hash);

        const sortedFiles = files
            .filter((file) => missingHashes.includes(file.hash))
            .sort((a, b) => b.sizeInBytes - a.sizeInBytes);

        // Start with a few buckets so small projects still get
        // the benefit of multiple upload streams
        const buckets = new Array(BULK_UPLOAD_CONCURRENCY)
            .fill(null)
            .map(() => ({
                files: [],
                remainingSize: MAX_BUCKET_SIZE,
            }));

        let bucketOffset = 0;
        for (const file of sortedFiles) {
            let inserted = false;

            for (let i = 0; i < buckets.length; i++) {
                // Start at a different bucket for each new file
                const bucket = buckets[(i + bucketOffset) % buckets.length];
                if (
                    bucket.remainingSize >= file.sizeInBytes &&
                    bucket.files.length < MAX_BUCKET_FILE_COUNT
                ) {
                    bucket.files.push(file);
                    bucket.remainingSize -= file.sizeInBytes;
                    inserted = true;
                    break;
                }
            }

            if (!inserted) {
                buckets.push({
                    files: [file],
                    remainingSize: MAX_BUCKET_SIZE - file.sizeInBytes,
                });
            }
            bucketOffset++;
        }

        const queue = new PQueue({ concurrency: BULK_UPLOAD_CONCURRENCY });

        for (const bucket of buckets) {
            // Don't upload empty buckets (can happen for tiny projects)
            if (bucket.files.length === 0) continue;

            attempts = 0;
            const doUpload = async () => {
                // Populate the payload only when actually uploading (this is limited to 3 concurrent uploads at 50 MiB per bucket meaning we'd only load in a max of ~150 MiB)
                // This is so we don't run out of memory trying to upload the files.
                const payload = await Promise.all(
                    bucket.files.map(async (file) => ({
                        key: file.hash,
                        value: fs.readFileSync(file.path).toString("base64"),
                        metadata: {
                            contentType: file.contentType,
                        },
                        base64: true,
                    })),
                );

                try {
                    const res = await this.fetchResult(`/pages/assets/upload`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${jwt}`,
                        },
                        data: payload,
                    });
                } catch (e) {
                    if (attempts < MAX_UPLOAD_ATTEMPTS) {
                        logger.warn(`CfPages Upload failed: ${e}, retrying...`);
                        // Exponential backoff, 1 second first time, then 2 second, then 4 second etc.
                        await new Promise((resolvePromise) =>
                            setTimeout(
                                resolvePromise,
                                Math.pow(2, attempts++) * 1000,
                            ),
                        );

                        jwt = await this.fetchUploadToken();
                        return doUpload();
                    } else {
                        logger.error(`CfPages Upload failed: ${e}`);
                        throw e;
                    }
                }
            };

            void queue.add(() =>
                doUpload().then(
                    () => {
                        logger.debug(
                            `CfPages Uploaded ${bucket.files.length} files`,
                        );
                    },
                    (error) => {
                        return Promise.reject(
                            new Error(
                                `Failed to upload files. Please try again. Error: ${JSON.stringify(
                                    error,
                                )})`,
                            ),
                        );
                    },
                ),
            );
        }

        await queue.onIdle();

        const uploadMs = Date.now() - start;

        const skipped = fileMap.size - missingHashes.length;
        const skippedMessage =
            skipped > 0 ? `(${skipped} already uploaded) ` : "";

        logger.info(
            `CfPages Upload complete: ${
                sortedFiles.length
            } files ${skippedMessage}${this.formatTime(uploadMs)}`,
        );

        const doUpsertHashes = async () => {
            try {
                return await this.fetchResult(`/pages/assets/upsert-hashes`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${jwt}`,
                    },
                    data: {
                        hashes: files.map(({ hash }) => hash),
                    },
                });
            } catch (e) {
                await new Promise((resolvePromise) =>
                    setTimeout(resolvePromise, 1000),
                );

                jwt = await this.fetchUploadToken();

                return await this.fetchResult(`/pages/assets/upsert-hashes`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${jwt}`,
                    },
                    data: {
                        hashes: files.map(({ hash }) => hash),
                    },
                });
            }
        };

        try {
            await doUpsertHashes();
        } catch {
            logger.warn(
                "Failed to update file hashes. Every upload appeared to succeed for this deployment, but you might need to re-upload for future deployments. This shouldn't have any impact other than slowing the upload speed of your next deployment.",
            );
        }

        return Object.fromEntries(
            [...fileMap.entries()].map(([fileName, file]) => [
                `/${fileName}`,
                file.hash,
            ]),
        );
    };

    isJwtExpired = (token) => {
        try {
            const decodedJwt = JSON.parse(
                Buffer.from(token.split(".")[1], "base64").toString(),
            );

            const dateNow = new Date().getTime() / 1000;

            return decodedJwt.exp <= dateNow;
        } catch (e) {
            if (e instanceof Error) {
                throw new Error(`Invalid token: ${e.message}`);
            }
        }
    };

    formatTime = (duration) => {
        return `(${(duration / 1000).toFixed(2)} sec)`;
    };

    validate = async (dir) => {
        const directory = path.resolve(dir);

        const walk = async (dir, fileMap = new Map(), startingDir) => {
            const files = fs.readdirSync(dir);
            startingDir = startingDir || dir;

            await Promise.all(
                files.map(async (file) => {
                    const filepath = path.join(dir, file);
                    const relativeFilepath = path.relative(
                        startingDir,
                        filepath,
                    );
                    const filestat = fs.statSync(filepath);

                    if (filestat.isDirectory()) {
                        fileMap = await walk(filepath, fileMap, startingDir);
                    } else {
                        const name = relativeFilepath.split(path.sep).join("/");

                        if (filestat.size > MAX_ASSET_SIZE) {
                            throw new Error(
                                `Error: Pages only supports files up to ${MAX_ASSET_SIZE} in size\n${name} is ${filestat.size} in size`,
                            );
                        }

                        fileMap.set(name, {
                            path: filepath,
                            contentType:
                                mime.getType(name) ||
                                "application/octet-stream",
                            sizeInBytes: filestat.size,
                            hash: this.hashFile(filepath),
                        });
                    }
                }),
            );

            return fileMap;
        };

        const fileMap = await walk(directory);

        if (fileMap.size > MAX_ASSET_COUNT) {
            throw new Error(
                `Error: Pages only supports up to ${MAX_ASSET_COUNT.toLocaleString()} files in a deployment. Ensure you have specified your build output directory correctly.`,
            );
        }

        return fileMap;
    };

    hashFile = (filepath) => {
        const contents = fs.readFileSync(filepath);
        const base64Contents = contents.toString("base64");
        const extension = path.extname(filepath).substring(1);

        return blake3hash(base64Contents + extension)
            .toString("hex")
            .slice(0, 32);
    };
}
