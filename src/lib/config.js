import { parse } from "smol-toml";
import { readFileSync } from "fs";

const config = parse(
    process.env.CONFIG || readFileSync("./config.toml", "utf-8"),
);

export default config;
