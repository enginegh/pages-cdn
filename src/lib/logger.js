import { createLogger, format, transports, addColors } from "winston";

// add coloring for debug
addColors({
    error: "red",
    warn: "yellow",
    info: "white",
    debug: "gray",
});

const logger = createLogger({
    level: process.env.LOG_LEVEL || "debug",
    format: format.combine(
        format((info) => {
            info.level = info.level.toUpperCase();
            return info;
        })(),
        format.simple(),
        format.printf((info) => {
            return `${info.level}: ${info.message}`;
        }),
    ),
    transports: [
        new transports.Console({
            format: format.colorize({
                all: true,
            }),
        }),
        // log to file without coloring
        new transports.File({
            filename: "logs.txt",
        }),
    ],
});

export default logger;
