import { parse } from "smol-toml";
import { readFileSync } from "fs";

const config = parse(
    process.env.CONFIG || readFileSync("./config.toml", "utf-8"),
);

config.max_song_duration ??= 34 * 60;
config.ffmpeg_timeout ??= 8;

export default config;
