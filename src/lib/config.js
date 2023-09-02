import { parse } from "smol-toml";

const config = parse(
    process.env.CONFIG || readFileSync("./config.toml", "utf-8"),
);

export default config;
