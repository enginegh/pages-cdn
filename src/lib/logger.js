import { createLogger, format, transports, addColors } from "winston";

// add coloring for debug
addColors({
    error: "red",
    warn: "yellow",
    info: "white",
    debug: "gray",
});

const logger = createLogger({
    // add coloring for debug
    level: process.env.LOG_LEVEL || "debug",
    format: format.combine(
        format((info) => {
            info.level = info.level.toUpperCase();
            return info;
        })(),
        format.colorize({
            all: true,
        }),
        format.simple(),
        format.printf((info) => {
            return `${info.level}: ${info.message}`;
        }),
    ),
    transports: [new transports.Console()],
});

export default logger;
