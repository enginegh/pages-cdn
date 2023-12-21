import { createLogger, format, transports, addColors } from "winston";

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
            return `${info.level}:\t${info.message}`;
        }),
    ),
    transports: [
        new transports.Console({
            format: format.colorize({
                all: true,
            }),
        }),
        new transports.File({
            filename: "logs.txt",
        }),
    ],
});

export default logger;
